// GET /api/data: the /data page's listing (closed months by variant, imported
// collections, which files are built). GET /api/data/monthly/<YYYY-MM>/<variant>
// .<jsonl|pgn>.gz and /api/data/collections/<corpus id>.<jsonl|pgn>.gz: the
// files themselves, built on first request and stored (game-data-files.ts).
//
// Fail closed: a malformed month is 400; an unknown variant, a format the
// variant does not export, a month that is not closed or has no games, and an
// unknown collection are 404. Nothing falls back to another variant's file.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAuthRateLimiter } from '../auth-rate-limit.js';
import {
  ALL_VARIANTS_KEY,
  buildDataListing,
  currentMonthStart,
  DATA_API_PREFIX,
  DATA_VARIANTS,
  type DataFileTarget,
  type DataListing,
  dataFileKey,
  dataFileName,
  dataFormatsForVariant,
  EmptyDataFileError,
  ensureDataFile,
  isClosedMonth,
  listableCollections,
  parseDataFilePath,
  parseMonth,
} from '../game-data-files.js';
import { getGameSummaries, loadRoomsEvents } from '../persistence.js';
import {
  countPublishedGamesByMonth,
  getStoredDataFile,
  insertDataFileIfAbsent,
  listCollectionRoomIds,
  listCollectionRows,
  listPublishedRoomIds,
  listStoredDataFiles,
} from '../persistence-game-data.js';
import { clientIpForRateLimit } from '../server-policy.js';
import { type HttpApiContext, requireMethod, requirePersistence, writeJson } from './lib.js';

// Serving a stored file is one row read; building one is a month of games, but
// it happens once per file ever, and builds run one at a time. Thirty files per
// ten minutes per address covers someone taking every variant of a month, and
// stops a loop from pinning the database.
const DOWNLOAD_LIMIT = 30;
const DOWNLOAD_WINDOW_MS = 10 * 60 * 1000;
let downloadLimiter = createAuthRateLimiter(DOWNLOAD_LIMIT, DOWNLOAD_WINDOW_MS);

/** Tests only: start every case with an empty bucket. */
export function resetDataDownloadLimiterForTests(): void {
  downloadLimiter = createAuthRateLimiter(DOWNLOAD_LIMIT, DOWNLOAD_WINDOW_MS);
}

// The listing is a few GROUP BYs; a minute of staleness is fine for a page whose
// newest file appears once a month. A build clears it so sizes show at once.
const LISTING_TTL_MS = 60_000;
let listingCache: { at: number; monthStart: number; listing: DataListing } | null = null;

export function clearDataListingCache(): void {
  listingCache = null;
}

export async function loadDataListing(now: Date = new Date()): Promise<DataListing> {
  const monthStart = currentMonthStart(now).getTime();
  if (
    listingCache &&
    listingCache.monthStart === monthStart &&
    now.getTime() - listingCache.at < LISTING_TTL_MS
  ) {
    return listingCache.listing;
  }
  const [counts, stored, collectionRows] = await Promise.all([
    countPublishedGamesByMonth(DATA_VARIANTS, new Date(monthStart)),
    listStoredDataFiles(),
    listCollectionRows(),
  ]);
  const listing = buildDataListing({
    counts,
    stored,
    collections: listableCollections(collectionRows),
    now,
  });
  listingCache = { at: now.getTime(), monthStart, listing };
  return listing;
}

type ResolvedTarget =
  | { roomIds: () => Promise<readonly string[]> }
  | { status: 404; error: string };

// The rooms a not-yet-built file will hold, or why there is no such file.
async function resolveTarget(target: DataFileTarget, now: Date): Promise<ResolvedTarget> {
  if (target.kind === 'monthly') {
    const range = parseMonth(target.month)!;
    if (!isClosedMonth(range, now)) return { status: 404, error: 'month_not_closed' };
    const variants = target.variant === ALL_VARIANTS_KEY ? DATA_VARIANTS : [target.variant];
    const roomIds = await listPublishedRoomIds(variants, range.from, range.to);
    if (roomIds.length === 0) return { status: 404, error: 'no_games' };
    return { roomIds: async () => roomIds };
  }
  const collection = listableCollections(await listCollectionRows()).find(
    (row) => row.corpusId === target.corpusId,
  );
  if (!collection) return { status: 404, error: 'unknown_collection' };
  if (!dataFormatsForVariant(collection.variant).includes(target.format)) {
    return { status: 404, error: 'format_not_available' };
  }
  return { roomIds: () => listCollectionRoomIds(target.corpusId) };
}

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === DATA_API_PREFIX) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const listing = await loadDataListing();
    writeJson(response, 200, listing, { 'cache-control': 'public, max-age=60' });
    return true;
  }

  if (!pathname.startsWith(`${DATA_API_PREFIX}/`)) return false;
  const parsed = parseDataFilePath(pathname);
  if (!parsed) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  if (!requireMethod(request, response, 'GET', 'HEAD')) return true;
  if (!parsed.ok) {
    writeJson(response, parsed.status, { error: parsed.error });
    return true;
  }
  if (!requirePersistence(response)) return true;
  if (!downloadLimiter.check(clientIpForRateLimit(request))) {
    writeJson(response, 429, { error: 'rate_limited' }, { 'retry-after': '600' });
    return true;
  }

  const target = parsed.target;
  // A stored file is served as stored: it was a closed month (or a collection)
  // when it was built, and a closed month does not change.
  let file = await getStoredDataFile(dataFileKey(target));
  if (!file) {
    const resolved = await resolveTarget(target, new Date());
    if ('status' in resolved) {
      writeJson(response, resolved.status, { error: resolved.error });
      return true;
    }
    try {
      file = await ensureDataFile(target, resolved.roomIds, {
        getGameSummaries,
        loadRoomsEvents,
        getStoredDataFile,
        insertDataFileIfAbsent,
        log: (message) => console.warn(message),
      });
    } catch (error) {
      if (!(error instanceof EmptyDataFileError)) throw error;
      writeJson(response, 404, { error: 'no_games' });
      return true;
    }
    clearDataListingCache();
  }

  const etag = `"${file.sha256}"`;
  const headers = {
    'content-type': 'application/gzip',
    'content-disposition': `attachment; filename="${dataFileName(target)}"`,
    'cache-control': 'public, max-age=31536000, immutable',
    etag,
    'x-mistboard-games': String(file.gameCount),
    'x-mistboard-sha256': file.sha256,
  };
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }
  response.writeHead(200, { ...headers, 'content-length': String(file.byteSize) });
  response.end(request.method === 'HEAD' ? undefined : file.content);
  return true;
}
