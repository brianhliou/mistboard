// GET /api/data: the /data page's listing (closed months by variant, the
// scheduled engine games' months, imported collections, which files are built).
// The files, content-addressed (game-data-files.ts):
//
//   /api/data/monthly/<YYYY-MM>/<variant>.<jsonl|pgn>.gz,
//   /api/data/engine-monthly/<YYYY-MM>/<variant>.<jsonl|pgn>.gz (#488) and
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
import { botOpponentById } from '@mistboard/game';
import { createAuthRateLimiter } from '../auth-rate-limit.js';
import { parsePublicBotId } from '../bot-profile-policy.js';
import { firstPartyBotForId } from '../first-party-bots.js';
import {
  ALL_VARIANTS_KEY,
  buildDataListing,
  currentMonthStart,
  DATA_API_PREFIX,
  DATA_VARIANTS,
  type DataFileTarget,
  type DataListing,
  type DataScope,
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
  type BotFilter,
  countPublishedGamesByMonth,
  getStoredDataFile,
  getStoredDataFileMeta,
  insertDataFileIfAbsent,
  listCollectionRoomIds,
  listCollectionRows,
  listPublicDataBots,
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
const listingCache = new Map<string, { at: number; monthStart: number; listing: DataListing }>();

export function clearDataListingCache(): void {
  listingCache.clear();
}

type PublicDataBot = Awaited<ReturnType<typeof listPublicDataBots>>[number];

// What a bot or opponent filter selects: the bot ids whose games it holds and
// the variants it plays, or null when nothing public matches (a 404). An
// opponent is every level of one map entry (bot-opponents.ts) that is a public
// data bot; its variants are the union of theirs.
function resolveScope(
  scope: DataScope,
  bots: readonly PublicDataBot[],
): { filter: BotFilter; variants: readonly string[] } | null {
  if (scope.botId) {
    const bot = bots.find((candidate) => candidate.id === scope.botId);
    return bot ? { filter: bot.id, variants: bot.variants } : null;
  }
  if (scope.opponentId) {
    const opponent = botOpponentById(scope.opponentId);
    // A one-bot opponent's files are that bot's (the listing normalizes it),
    // so the same games never sit under a second URL.
    if (!opponent || opponent.members.length < 2) return null;
    const memberIds = new Set(opponent.members.map((member) => member.botId));
    const members = bots.filter((bot) => memberIds.has(bot.id));
    if (members.length === 0) return null;
    const played = new Set(members.flatMap((bot) => bot.variants));
    return {
      filter: members.map((bot) => bot.id),
      variants: DATA_VARIANTS.filter((variant) => played.has(variant)),
    };
  }
  return null;
}

// The start of the month after `now`'s (UTC): counts run up to it, so a
// variant whose only games are this month can say when its first file comes.
function nextMonthStart(now: Date): Date {
  const start = currentMonthStart(now);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

export async function loadDataListing(
  now: Date = new Date(),
  scopeOrBotId?: DataScope | string,
): Promise<DataListing> {
  const scope: DataScope =
    typeof scopeOrBotId === 'string' ? { botId: scopeOrBotId } : (scopeOrBotId ?? {});
  const monthStart = currentMonthStart(now).getTime();
  const key = scope.botId
    ? `bot:${scope.botId}`
    : scope.opponentId
      ? `opponent:${scope.opponentId}`
      : '';
  const bots = await listPublicDataBots(DATA_VARIANTS);
  const filtered = scope.botId || scope.opponentId;
  const resolved = filtered ? resolveScope(scope, bots) : null;
  if (filtered && !resolved) throw new UnknownDataBotError();
  const cached = listingCache.get(key);
  if (cached && cached.monthStart === monthStart && now.getTime() - cached.at < LISTING_TTL_MS) {
    return cached.listing;
  }
  const variants = resolved?.variants ?? DATA_VARIANTS;
  const until = nextMonthStart(now);
  const [counts, engineCounts, stored, collectionRows] = await Promise.all([
    countPublishedGamesByMonth(variants, until, 'human', resolved?.filter),
    countPublishedGamesByMonth(variants, until, 'engine', resolved?.filter),
    listStoredDataFiles(),
    filtered ? Promise.resolve([]) : listCollectionRows(),
  ]);
  const listing = {
    ...buildDataListing({
      counts,
      engineCounts,
      stored,
      collections: listableCollections(collectionRows),
      now,
      ...scope,
      offeredVariants: variants,
    }),
    bots,
  };
  listingCache.set(key, { at: now.getTime(), monthStart, listing });
  return listing;
}

class UnknownDataBotError extends Error {}

async function scopeFor(target: DataFileTarget) {
  if (target.kind === 'collection') return null;
  return resolveScope(target, await listPublicDataBots(DATA_VARIANTS));
}

type ResolvedTarget =
  | { roomIds: () => Promise<readonly string[]> }
  | { status: 404; error: string };

// The rooms a not-yet-built file will hold, or why there is no such file.
async function resolveTarget(target: DataFileTarget, now: Date): Promise<ResolvedTarget> {
  if (target.kind !== 'collection') {
    const range = parseMonth(target.month)!;
    if (!isClosedMonth(range, now)) return { status: 404, error: 'month_not_closed' };
    const scoped = target.botId || target.opponentId ? await scopeFor(target) : null;
    if ((target.botId || target.opponentId) && !scoped) return { status: 404, error: 'not_found' };
    const supported = scoped?.variants ?? DATA_VARIANTS;
    if (target.variant !== ALL_VARIANTS_KEY && !supported.includes(target.variant))
      return { status: 404, error: 'not_found' };
    const variants = target.variant === ALL_VARIANTS_KEY ? supported : [target.variant];
    const roomIds = await listPublishedRoomIds(
      variants,
      range.from,
      range.to,
      target.kind === 'engine-monthly' ? 'engine' : 'human',
      scoped?.filter,
    );
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
    const requested = parsedUrl?.searchParams.get('bot');
    const parsedBot = requested ? parsePublicBotId(requested) : null;
    if (requested && !parsedBot) {
      writeJson(response, 400, { error: 'invalid_bot_id' }, { 'cache-control': NO_STORE });
      return true;
    }
    const opponentParam = parsedUrl?.searchParams.get('opponent') ?? null;
    if (opponentParam !== null && (requested || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(opponentParam))) {
      writeJson(response, 400, { error: 'invalid_opponent' }, { 'cache-control': NO_STORE });
      return true;
    }
    const opponent = opponentParam ? botOpponentById(opponentParam) : null;
    if (opponentParam && !opponent) {
      writeJson(response, 404, { error: 'not_found' }, { 'cache-control': NO_STORE });
      return true;
    }
    // A one-bot opponent is that bot: one listing, one set of file URLs.
    const scope: DataScope = parsedBot
      ? { botId: firstPartyBotForId(parsedBot)?.id ?? parsedBot }
      : opponent
        ? opponent.members.length === 1
          ? { botId: opponent.members[0]!.botId }
          : { opponentId: opponent.id }
        : {};
    try {
      const listing = await loadDataListing(new Date(), scope);
      writeJson(response, 200, listing, { 'cache-control': 'public, max-age=60' });
    } catch (error) {
      if (!(error instanceof UnknownDataBotError)) throw error;
      writeJson(response, 404, { error: 'not_found' }, { 'cache-control': NO_STORE });
    }
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
  // Recheck visibility even for a previously built file, before redirecting or serving it.
  if (target.kind !== 'collection' && (target.botId || target.opponentId)) {
    const variants = (await scopeFor(target))?.variants;
    if (!variants || (target.variant !== ALL_VARIANTS_KEY && !variants.includes(target.variant))) {
      writeJson(response, 404, { error: 'not_found' }, noStore);
      return true;
    }
  }
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
