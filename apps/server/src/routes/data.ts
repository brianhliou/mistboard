// GET /api/data: the /data page's listing (closed months by variant, imported
// collections, which files are built). The files, content-addressed
// (game-data-files.ts):
//
//   /api/data/monthly/<YYYY-MM>/<variant>.<jsonl|pgn>.gz and
//   /api/data/collections/<corpus id>.<jsonl|pgn>.gz build the file on first
//   request and store it, then 302 to the build's own URL, cached a minute.
//
//   The same paths with .<12 hex of the sha256> before the format serve the
//   stored bytes, immutable for a year. A hash that is not the stored file's
//   (it was rebuilt) is a 404 naming the current URL: a hashed URL never
//   answers with bytes other than the ones it names, so no cache in front of
//   the site can hold a stale copy under it.
//
// Fail closed: a malformed month is 400; an unknown variant, a format the
// variant does not export, a month that is not closed or has no games, and an
// unknown collection are 404. Nothing falls back to another variant's file. A
// query string on a file URL is a 400: Cloudflare keys its cache on the whole
// URL, and `?anything` would otherwise mint a second cached copy of a file.

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
  dataFileHash,
  dataFileKey,
  dataFileName,
  dataFormatsForVariant,
  EmptyDataFileError,
  ensureDataFile,
  hashedDataFilePath,
  isClosedMonth,
  listableCollections,
  parseDataFilePath,
  parseMonth,
} from '../game-data-files.js';
import { getGameSummaries, loadRoomsEvents } from '../persistence.js';
import {
  countPublishedGamesByMonth,
  getStoredDataFile,
  getStoredDataFileMeta,
  insertDataFileIfAbsent,
  listCollectionRoomIds,
  listCollectionRows,
  listPublishedRoomIds,
  listStoredDataFiles,
} from '../persistence-game-data.js';
import { clientIpForRateLimit } from '../server-policy.js';
import { type HttpApiContext, requireMethod, requirePersistence, writeJson } from './lib.js';

// The redirect from a plain URL to its build: long enough to absorb a burst of
// clicks at the edge, short enough that a rebuilt file's new URL takes over
// within a minute.
const REDIRECT_CACHE = 'public, max-age=60';
// Errors are never cached: a 404 for a hash may be answered differently once
// the month is built, and a 429 is per address.
const NO_STORE = 'no-store';

// Serving a stored file is one row read; building one is a month of games, but
// it happens once per file ever, and builds run one at a time. A download is
// two requests (the plain URL's redirect, then the file), so sixty per ten
// minutes per address is thirty files: someone taking every variant of a
// month. It stops a loop from pinning the database.
const DOWNLOAD_LIMIT = 60;
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
  parsedUrl?: URL,
): Promise<boolean> {
  if (pathname === DATA_API_PREFIX) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const listing = await loadDataListing();
    writeJson(response, 200, listing, { 'cache-control': 'public, max-age=60' });
    return true;
  }

  if (!pathname.startsWith(`${DATA_API_PREFIX}/`)) return false;
  const noStore = { 'cache-control': NO_STORE };
  const parsed = parseDataFilePath(pathname);
  if (!parsed) {
    writeJson(response, 404, { error: 'not_found' }, noStore);
    return true;
  }
  if (!requireMethod(request, response, 'GET', 'HEAD')) return true;
  if (!parsed.ok) {
    writeJson(response, parsed.status, { error: parsed.error }, noStore);
    return true;
  }
  if (parsedUrl?.search) {
    writeJson(response, 400, { error: 'unexpected_query' }, noStore);
    return true;
  }
  if (!requirePersistence(response)) return true;
  if (!downloadLimiter.check(clientIpForRateLimit(request))) {
    writeJson(response, 429, { error: 'rate_limited' }, { ...noStore, 'retry-after': '600' });
    return true;
  }

  const target = parsed.target;
  if (parsed.hash) {
    await serveHashedFile(request, response, target, parsed.hash);
    return true;
  }

  // The plain URL: build if this is the file's first request, then send the
  // reader to the build's own URL. A stored file was a closed month (or a
  // collection) when it was built, so it is never rebuilt here.
  let sha256 = (await getStoredDataFileMeta(dataFileKey(target)))?.sha256 ?? null;
  if (!sha256) {
    const resolved = await resolveTarget(target, new Date());
    if ('status' in resolved) {
      writeJson(response, resolved.status, { error: resolved.error }, noStore);
      return true;
    }
    try {
      const file = await ensureDataFile(target, resolved.roomIds, {
        getGameSummaries,
        loadRoomsEvents,
        getStoredDataFile,
        insertDataFileIfAbsent,
        log: (message) => console.warn(message),
      });
      sha256 = file.sha256;
    } catch (error) {
      if (!(error instanceof EmptyDataFileError)) throw error;
      writeJson(response, 404, { error: 'no_games' }, noStore);
      return true;
    }
    clearDataListingCache();
  }
  response.writeHead(302, {
    location: hashedDataFilePath(target, sha256),
    'cache-control': REDIRECT_CACHE,
  });
  response.end();
  return true;
}

async function serveHashedFile(
  request: IncomingMessage,
  response: ServerResponse,
  target: DataFileTarget,
  hash: string,
): Promise<void> {
  const file = await getStoredDataFile(dataFileKey(target));
  if (!file || dataFileHash(file.sha256) !== hash) {
    // Not these bytes: never built, or rebuilt since this URL was handed out.
    // Name the current build so a person or a script can follow it on purpose;
    // a redirect would quietly hand over different bytes under a URL whose
    // whole point is to name one exact file (and a 301 is cached for good).
    writeJson(
      response,
      404,
      {
        error: file ? 'stale_hash' : 'not_built',
        ...(file ? { current: hashedDataFilePath(target, file.sha256) } : {}),
      },
      { 'cache-control': NO_STORE },
    );
    return;
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
    return;
  }
  response.writeHead(200, { ...headers, 'content-length': String(file.byteSize) });
  response.end(request.method === 'HEAD' ? undefined : file.content);
}
