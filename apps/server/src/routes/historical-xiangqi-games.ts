import type { IncomingMessage, ServerResponse } from 'node:http';
import { PGN_CONTENT_TYPE } from './../game-export-shared.js';
import { buildHistoricalXiangqiPgn } from './../historical-xiangqi-export.js';
import * as persistence from './../persistence.js';
import { type HttpApiContext, requireMethod, requirePersistence, writeJson } from './lib.js';

type ParseResult =
  | { ok: true; filters: persistence.HistoricalXiangqiGameQueryFilters }
  | { ok: false; error: string };

const RESULTS = new Set<persistence.HistoricalXiangqiResult>(['1-0', '0-1', '1/2-1/2', '*']);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED_SOURCES = new Set(['mistboard', 'broadcast']);

// `tags` is the source's own row, stored verbatim so an import stays lossless and
// re-derivable. Serving it verbatim is a different decision, and the wrong one:
// ElephantChess rows carry `redPlayerId`/`blackPlayerId` (pseudonymous keys that
// are stable within a dump, so publishing them hands out a join key linking one
// player's games) plus `sourceFile`, their internal CSV name. None of that is
// ours to publish and none of it is read by anything.
//
// Allowlist, not denylist: a new source's tags arrive unreviewed, so the default
// has to be "not served". These seven are exactly what the archive page renders
// (see historicalProvenance in historical-xiangqi-postgame.ts). The stored row is
// untouched — this redacts the response, not the import.
const PUBLIC_TAG_KEYS = [
  'timeControl',
  'timeControlCategory',
  'ratingMode',
  'redEloBefore',
  'redEloAfter',
  'blackEloBefore',
  'blackEloAfter',
] as const;

export function publicTags(tags: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_TAG_KEYS) {
    if (tags[key] !== undefined && tags[key] !== null) out[key] = tags[key];
  }
  return out;
}

type UnifiedXiangqiSearchItem = {
  id: string;
  kind: 'mistboard' | 'historical' | 'broadcast';
  reviewUrl: string;
  sourceSlug: string;
  sourceName: string;
  sourceGameId: string | null;
  sourceUrl: string | null;
  eventName: string | null;
  eventNameEn: string | null;
  site: string | null;
  round: string | null;
  roundNameEn: string | null;
  board: string | null;
  playedOn: string | null;
  sortAt: string | null;
  redNameRaw: string | null;
  redNameEn: string | null;
  blackNameRaw: string | null;
  blackNameEn: string | null;
  result: persistence.HistoricalXiangqiResult;
  plyCount: number;
  moveFormat: string;
};

type UnifiedXiangqiSearchChunk = {
  games: UnifiedXiangqiSearchItem[];
  total: number;
};

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  const exportMatch = pathname.match(/^\/api\/historical-xiangqi\/games\/([^/]+)\/export\.pgn$/);
  if (exportMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const game = await persistence.getHistoricalXiangqiGame(decodeURIComponent(exportMatch[1]!));
    // Same by-id gate as the detail route below: unlisted games are linked and
    // serve, only 'private' stays hidden.
    if (!game || game.visibility === 'private') {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    // A download republishes the source's game verbatim, so, like the opening
    // explorer's aggregates (listAggregatableXiangqiGames), it waits on the
    // source being license-cleared. Fail-closed: an unknown source is not cleared.
    const source = await persistence.getHistoricalXiangqiSource(game.sourceId);
    if (source?.licenseStatus !== 'cleared') {
      writeJson(response, 403, { error: 'source_not_cleared' });
      return true;
    }
    response.writeHead(200, {
      'content-type': PGN_CONTENT_TYPE,
      'content-disposition': `inline; filename="mistboard-historical-${game.id}.pgn"`,
    });
    response.end(buildHistoricalXiangqiPgn(game, source));
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/historical-xiangqi\/games\/([^/]+)$/);
  if (detailMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const game = await persistence.getHistoricalXiangqiGame(decodeURIComponent(detailMatch[1]!));
    // Direct-id access serves unlisted games too: an unlisted corpus is absent
    // from the browsable list (the search route below still gates on public) but
    // its individual games ARE linked — the opening explorer's "Top games" point
    // straight here. Only 'private' stays hidden by id.
    if (!game || game.visibility === 'private') {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    // `pgnExport` tells the review page whether the PGN download above would
    // answer 200, so it renders the link only for license-cleared sources
    // instead of offering one that 403s.
    const source = await persistence.getHistoricalXiangqiSource(game.sourceId);
    writeJson(response, 200, {
      game: {
        ...game,
        tags: publicTags(game.tags),
        pgnExport: source?.licenseStatus === 'cleared',
      },
    });
    return true;
  }

  if (pathname !== '/api/historical-xiangqi/games') return false;
  if (!requireMethod(request, response, 'GET')) return true;
  if (!requirePersistence(response)) return true;

  const parsed = parseHistoricalXiangqiGameQuery(parsedUrl.searchParams);
  if (!parsed.ok) {
    writeJson(response, 400, { error: parsed.error });
    return true;
  }

  const page = await queryUnifiedXiangqiGames(parsed.filters);
  writeJson(response, 200, {
    games: page.games,
    total: page.total,
    offset: parsed.filters.offset ?? 0,
    limit: parsed.filters.limit ?? 50,
  });
  return true;
}

// Every lane is sorted on its own, so placing page N of the merge needs each
// lane's first (offset + limit) rows, not just its first page. Lanes are read in
// LANE_PAGE chunks (the persistence queries cap a single read at 200), and the
// window bounds how deep that walk may go: past it a page is empty, never wrong.
const LANE_PAGE = 200;
export const SEARCH_WINDOW = 5000;

type LaneReader = (offset: number, limit: number) => Promise<UnifiedXiangqiSearchChunk>;

async function readLaneHead(read: LaneReader, need: number): Promise<UnifiedXiangqiSearchChunk> {
  const games: UnifiedXiangqiSearchItem[] = [];
  let total = 0;
  for (let offset = 0; offset < need; offset += LANE_PAGE) {
    const want = Math.min(LANE_PAGE, need - offset);
    const chunk = await read(offset, want);
    total = chunk.total;
    games.push(...chunk.games);
    if (chunk.games.length < want) break;
  }
  return { games, total };
}

export async function pageAcrossLanes(
  lanes: LaneReader[],
  offset: number,
  limit: number,
  sort: persistence.HistoricalXiangqiGameQueryFilters['sort'],
): Promise<UnifiedXiangqiSearchChunk> {
  const need = Math.min(SEARCH_WINDOW, offset + limit);
  const chunks = await Promise.all(lanes.map((read) => readLaneHead(read, need)));
  const games = chunks
    .flatMap((chunk) => chunk.games)
    .sort((a, b) => compareSearchItems(a, b, sort))
    .slice(offset, Math.min(need, offset + limit));
  return { games, total: chunks.reduce((sum, chunk) => sum + chunk.total, 0) };
}

async function queryUnifiedXiangqiGames(filters: persistence.HistoricalXiangqiGameQueryFilters) {
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
  const offset = Math.max(0, filters.offset ?? 0);
  const source = filters.sourceSlug;
  const lanes: LaneReader[] = [];

  if (!source || source === 'mistboard') {
    lanes.push((at, count) => queryMistboardXiangqiGames(filters, at, count));
  }
  if (!source || source === 'broadcast') {
    lanes.push((at, count) => queryBroadcastXiangqiGames(filters, at, count));
  }
  if (!source || !RESERVED_SOURCES.has(source)) {
    lanes.push((at, count) => queryHistoricalXiangqiGames(filters, at, count));
  }
  return pageAcrossLanes(lanes, offset, limit, filters.sort);
}

async function queryHistoricalXiangqiGames(
  filters: persistence.HistoricalXiangqiGameQueryFilters,
  offset: number,
  limit: number,
): Promise<UnifiedXiangqiSearchChunk> {
  const page = await persistence.queryHistoricalXiangqiGames({
    ...filters,
    visibility: 'public',
    offset,
    limit,
  });
  return {
    games: page.games.map((game) => ({
      id: game.id,
      kind: 'historical',
      reviewUrl: `/historical-xiangqi/game/${encodeURIComponent(game.id)}`,
      sourceSlug: game.sourceSlug,
      sourceName: game.sourceName,
      sourceGameId: game.sourceGameId ?? null,
      sourceUrl: game.sourceUrl ?? null,
      eventName: game.eventName ?? null,
      eventNameEn: null,
      site: game.site ?? null,
      round: game.round ?? null,
      roundNameEn: null,
      board: game.board ?? null,
      playedOn: game.playedOn ?? null,
      sortAt: game.playedOn ?? null,
      redNameRaw: game.redNameRaw ?? null,
      redNameEn: null,
      blackNameRaw: game.blackNameRaw ?? null,
      blackNameEn: null,
      result: game.result,
      plyCount: game.plyCount,
      moveFormat: game.moveFormat,
    })),
    total: page.total,
  };
}

// Modes the public games database lists. Engine-vs-engine rows are lab output —
// a calibration run between two of our own bots, not a game anyone played — and
// they outnumber everything else, so leaving them in buries the real games under
// Pikafish-vs-Fairy-Stockfish self-play. They stay reachable by id and in the
// admin browser; they are just not what "browse xiangqi games" means.
const PUBLIC_GAME_MODES: persistence.GameMode[] = ['pvp', 'pve'];

async function queryMistboardXiangqiGames(
  filters: persistence.HistoricalXiangqiGameQueryFilters,
  offset: number,
  limit: number,
): Promise<UnifiedXiangqiSearchChunk> {
  const result = mistboardResult(filters.result);
  if (filters.result && !result) return { games: [], total: 0 };
  // Every filter goes to SQL. Post-filtering the fetched page (the old shape)
  // both under-reports — rows matching the filter past the limit never load —
  // and makes an honest total impossible, since the count would describe the
  // unfiltered slice.
  const page = await persistence.queryGames({
    variant: 'xiangqi',
    ...(filters.sort ? { sort: filters.sort } : {}),
    modes: PUBLIC_GAME_MODES,
    visibility: 'public',
    ...(result ? { result } : {}),
    ...(filters.player ? { player: filters.player } : {}),
    ...(filters.event ? { event: filters.event } : {}),
    ...(typeof filters.plyMin === 'number' ? { plyMin: filters.plyMin } : {}),
    ...(typeof filters.plyMax === 'number' ? { plyMax: filters.plyMax } : {}),
    ...(filters.playedFrom ? { endedFrom: new Date(`${filters.playedFrom}T00:00:00.000Z`) } : {}),
    ...(filters.playedTo ? { endedTo: new Date(`${filters.playedTo}T00:00:00.000Z`) } : {}),
    offset,
    limit,
  });
  const games: UnifiedXiangqiSearchItem[] = page.games.map((game) => ({
    id: game.roomId,
    kind: 'mistboard',
    reviewUrl: `/xiangqi/game/${encodeURIComponent(game.roomId)}`,
    sourceSlug: 'mistboard',
    sourceName: 'Mistboard',
    sourceGameId: game.roomId,
    sourceUrl: null,
    eventName: game.corpusId,
    eventNameEn: null,
    site: null,
    round: null,
    roundNameEn: null,
    board: null,
    playedOn: game.endedAt.toISOString().slice(0, 10),
    sortAt: game.endedAt.toISOString(),
    redNameRaw: seatName(game, 'white'),
    redNameEn: null,
    blackNameRaw: seatName(game, 'black'),
    blackNameEn: null,
    result: historicalResult(game.result),
    plyCount: game.plyCount,
    moveFormat: 'mistboard',
  }));
  return { games, total: page.total };
}

// games.white_name / black_name are only populated for the lab rows; a live PvP
// or PvE game keeps its seat names on game_participants, which is why the
// listing used to render real games as a nameless pair.
//
// The two stores disagree on what the first seat is called. The games row calls
// it white (the generic chess-family column), while game_participants records
// the seat in the VARIANT's own vocabulary: a xiangqi game stores 'red', not
// 'white'. Matching only 'white' silently drops every red seat, so accept both
// spellings of the same seat. GameParticipantColor is `Color | XiangqiColor` for
// exactly this reason.
const SEAT_COLORS = {
  white: ['white', 'red'],
  black: ['black'],
} as const satisfies Record<string, readonly persistence.GameParticipantColor[]>;

function seatName(game: persistence.RecentEveGameRecord, seat: 'white' | 'black'): string | null {
  const stored = seat === 'white' ? game.whiteName : game.blackName;
  if (stored) return stored;
  const accepted: readonly string[] = SEAT_COLORS[seat];
  const participant = game.participants.find((entry) => accepted.includes(entry.color));
  return participant?.displayName ?? null;
}

async function queryBroadcastXiangqiGames(
  filters: persistence.HistoricalXiangqiGameQueryFilters,
  offset: number,
  limit: number,
): Promise<UnifiedXiangqiSearchChunk> {
  if (filters.result === '*') return { games: [], total: 0 };
  const page = await persistence.queryCompletedXiangqiBroadcastBoards({
    ...(filters.sort ? { sort: filters.sort } : {}),
    player: filters.player,
    event: filters.event,
    result: filters.result,
    playedFrom: filters.playedFrom,
    playedTo: filters.playedTo,
    plyMin: filters.plyMin,
    plyMax: filters.plyMax,
    offset,
    limit,
  });
  const games: UnifiedXiangqiSearchItem[] = page.boards.map((board) => ({
    id: board.id,
    kind: 'broadcast',
    reviewUrl: `/broadcast/xiangqi/board/${encodeURIComponent(board.id)}`,
    sourceSlug: 'broadcast',
    sourceName: 'Broadcast',
    sourceGameId: board.sourceBoardId,
    sourceUrl: board.sourceUrl,
    eventName: board.tourName,
    eventNameEn: board.tourNameEn,
    site: null,
    round: board.roundName,
    roundNameEn: board.roundNameEn,
    board: String(board.boardNumber),
    playedOn: board.playedOn,
    sortAt: board.playedOn ?? board.updatedAt.toISOString(),
    redNameRaw: board.redName,
    redNameEn: board.redNameEn,
    blackNameRaw: board.blackName,
    blackNameEn: board.blackNameEn,
    result: board.result,
    plyCount: board.plyCount,
    moveFormat: 'broadcast',
  }));
  return { games, total: page.total };
}

// MUST agree with the ORDER BY each lane pushes down (historicalOrderBy,
// broadcastOrderBy, playedGamesOrderBy). Each lane returns its own top N and
// this merges them; if the keys disagree the page is drawn from the wrong
// candidate set and reads as plausible nonsense rather than an error.
export function compareSearchItems(
  a: UnifiedXiangqiSearchItem,
  b: UnifiedXiangqiSearchItem,
  sort: persistence.XiangqiGameSort | undefined,
): number {
  if (sort === 'longest' || sort === 'shortest') {
    if (a.plyCount !== b.plyCount) {
      return sort === 'longest' ? b.plyCount - a.plyCount : a.plyCount - b.plyCount;
    }
    return sort === 'longest' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
  }
  const left = a.sortAt ?? '';
  const right = b.sortAt ?? '';
  if (left !== right) {
    return sort === 'oldest' ? left.localeCompare(right) : right.localeCompare(left);
  }
  return sort === 'oldest' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
}

function mistboardResult(
  result: persistence.HistoricalXiangqiResult | undefined,
): persistence.GameResult | null {
  if (!result) return null;
  if (result === '1-0') return 'red-wins';
  if (result === '0-1') return 'black-wins';
  if (result === '1/2-1/2') return 'draw';
  return null;
}

function historicalResult(result: string): persistence.HistoricalXiangqiResult {
  if (result === 'red-wins' || result === 'white-wins') return '1-0';
  if (result === 'black-wins') return '0-1';
  if (result === 'draw') return '1/2-1/2';
  return '*';
}

export function parseHistoricalXiangqiGameQuery(search: URLSearchParams): ParseResult {
  const filters: persistence.HistoricalXiangqiGameQueryFilters = {};
  setTrimmed(filters, 'sourceSlug', search.get('source'));
  setTrimmed(filters, 'player', search.get('player'));
  setTrimmed(filters, 'event', search.get('event'));

  const result = search.get('result');
  if (result) {
    if (!RESULTS.has(result as persistence.HistoricalXiangqiResult)) {
      return { ok: false, error: 'invalid_result' };
    }
    filters.result = result as persistence.HistoricalXiangqiResult;
  }

  const from = search.get('from');
  if (from) {
    if (!isDateOnly(from)) return { ok: false, error: 'invalid_from' };
    filters.playedFrom = from;
  }

  const to = search.get('to');
  if (to) {
    if (!isDateOnly(to)) return { ok: false, error: 'invalid_to' };
    filters.playedTo = nextUtcDate(to);
  }

  const plyMin = parseBoundedInt(search.get('plyMin'), 0, 1000);
  if (!plyMin.ok) return { ok: false, error: 'invalid_ply_min' };
  if (plyMin.value !== null) filters.plyMin = plyMin.value;

  const plyMax = parseBoundedInt(search.get('plyMax'), 0, 1000);
  if (!plyMax.ok) return { ok: false, error: 'invalid_ply_max' };
  if (plyMax.value !== null) filters.plyMax = plyMax.value;

  const sort = search.get('sort');
  if (sort) {
    if (!persistence.isXiangqiGameSort(sort)) return { ok: false, error: 'invalid_sort' };
    filters.sort = sort;
  }

  const offset = parseBoundedInt(search.get('offset'), 0, 1_000_000);
  if (!offset.ok) return { ok: false, error: 'invalid_offset' };
  if (offset.value !== null) filters.offset = offset.value;

  const limit = parseBoundedInt(search.get('limit'), 1, 200);
  if (!limit.ok) return { ok: false, error: 'invalid_limit' };
  if (limit.value !== null) filters.limit = limit.value;

  return { ok: true, filters };
}

function setTrimmed<T extends Record<string, unknown>, K extends keyof T>(
  target: T,
  key: K,
  value: string | null,
): void {
  const trimmed = value?.trim();
  if (trimmed) target[key] = trimmed as T[K];
}

function isDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextUtcDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function parseBoundedInt(
  value: string | null,
  min: number,
  max: number,
): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value.trim() === '') return { ok: true, value: null };
  if (!/^\d+$/.test(value)) return { ok: false };
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return { ok: false };
  return { ok: true, value: parsed };
}
