import { XIANGQI_SPEC_ID } from './game-specs.js';
import {
  ARBITER_ADJUDICATED_DRAWS,
  createInitialXiangqiState,
  type XiangqiGameEndReason,
  type XiangqiMove,
  type XiangqiSquare,
} from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
  resumeAdjudicatedDraw,
} from './variants-xiangqi-standard.js';

export const XIANGQI_BROADCAST_SCHEMA = 'mistboard.xiangqi.broadcast.v1' as const;
export const XIANGQI_BROADCAST_TAPE_SCHEMA = 'mistboard.xiangqi.broadcast-tape.v1' as const;

export type XiangqiBroadcastResult = '*' | '1-0' | '0-1' | '1/2-1/2';

export type XiangqiBroadcastBoardStatus = 'scheduled' | 'live' | 'complete';

export type XiangqiBroadcastPlayerTag = {
  name: string;
  /** Cached English/romanized form of `name`; recomputed at ingestion time. */
  nameEn?: string;
  federation?: string;
  /** Cached English/romanized form of `federation`; recomputed at ingestion. */
  federationEn?: string;
  title?: string;
  sourceId?: string;
};

export type XiangqiBroadcastTour = {
  schema: typeof XIANGQI_BROADCAST_SCHEMA;
  slug: string;
  name: string;
  /** Cached English translation of `name`; recomputed at ingestion time. */
  nameEn?: string;
  location?: string;
  sourceUrl?: string;
  startsAt?: string;
  endsAt?: string;
};

export type XiangqiBroadcastRound = {
  schema: typeof XIANGQI_BROADCAST_SCHEMA;
  id: string;
  tourSlug: string;
  name: string;
  /** Cached English translation of `name`; recomputed at ingestion time. */
  nameEn?: string;
  startsAt?: string;
  sourceUrl?: string;
};

/** How a game was played, as the source states it: 慢棋 standard, 快棋 rapid,
 *  超快棋 blitz (a team league's tiebreak). */
export type XiangqiBroadcastGameKind = 'standard' | 'rapid' | 'blitz';

/**
 * What a source says about the game beyond the moves: which team match it
 * belongs to, the table, which game of the table's pair, how it was played.
 * A team league round is a set of matches (北京-江苏), each with four tables
 * that play twice with colours swapped, plus blitz tiebreaks when a match is
 * level; without these a round reads as the same pairings listed twice.
 * Every field is optional: archive and WXF pages carry few of them.
 */
export type XiangqiBroadcastGameDetails = {
  /** The team match as the source names it, "北京-江苏". */
  match?: string;
  /** Cached English form of `match`; recomputed at ingestion. */
  matchEn?: string;
  /** Table within the match (第04台). */
  table?: number;
  /** Game within the table's pairing (第1局). */
  game?: number;
  kind?: XiangqiBroadcastGameKind;
  /** The time control as the source writes it, "40分＋20秒". */
  timeControl?: string;
  /** When the game was played, ISO with the event's offset. */
  playedAt?: string;
  /** Opening as the source classifies it, "B05 中炮对进左马". */
  opening?: string;
};

export type XiangqiBroadcastBoard = {
  schema: typeof XIANGQI_BROADCAST_SCHEMA;
  id: string;
  tourSlug: string;
  roundId: string;
  sourceBoardId: string;
  boardNumber: number;
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  status: XiangqiBroadcastBoardStatus;
  result: XiangqiBroadcastResult;
  moves: XiangqiMove[];
  sourceUrl?: string;
  details?: XiangqiBroadcastGameDetails;
  /** Set on a finished game the source published a record for that we do not
   *  replay, with the reason: `ambiguous`, the record reads two legal ways
   *  (a lost front/rear marker the stored check marks cannot settle). The
   *  board carries the players and the result, no moves, and a `sourceUrl`
   *  for the reader to see the record there. */
  recordWithheld?: XiangqiBroadcastRecordWithheld;
};

export type XiangqiBroadcastRecordWithheld = 'ambiguous';

export type XiangqiBroadcastTapeEvent = {
  atMs: number;
  boardId: string;
  moves?: XiangqiMove[];
  append?: XiangqiMove[];
  status?: XiangqiBroadcastBoardStatus;
  result?: XiangqiBroadcastResult;
};

export type XiangqiBroadcastTape = {
  schema: typeof XIANGQI_BROADCAST_TAPE_SCHEMA;
  tourSlug: string;
  events: XiangqiBroadcastTapeEvent[];
};

export type XiangqiBroadcastValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

/**
 * Points where our kernel called the game over but the record kept going.
 * Not errors: see ARBITER_ADJUDICATED_DRAWS.
 */
export type XiangqiBroadcastAdjudication = { ply: number; reason: XiangqiGameEndReason };

export type XiangqiBroadcastReplayResult =
  | {
      ok: true;
      boardId: string;
      plies: number;
      finalStatus: ReturnType<typeof createInitialXiangqiState>['status'];
      adjudications: XiangqiBroadcastAdjudication[];
    }
  | {
      ok: false;
      boardId: string;
      ply: number;
      move: XiangqiMove;
      reason: string;
    };

const RESULTS = new Set<XiangqiBroadcastResult>(['*', '1-0', '0-1', '1/2-1/2']);
const BOARD_STATUSES = new Set<XiangqiBroadcastBoardStatus>(['scheduled', 'live', 'complete']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isXiangqiBroadcastSquare(value: unknown): value is XiangqiSquare {
  return typeof value === 'string' && /^[a-i](?:[1-9]|10)$/.test(value);
}

function validateSchema(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (value.schema !== XIANGQI_BROADCAST_SCHEMA) {
    errors.push(`${path}.schema must be ${XIANGQI_BROADCAST_SCHEMA}`);
  }
}

function validateOptionalString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): void {
  if (value[key] !== undefined && typeof value[key] !== 'string') {
    errors.push(`${path}.${key} must be a string when present`);
  }
}

function validatePlayer(value: unknown, path: string, errors: string[]): XiangqiBroadcastPlayerTag {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return { name: '' };
  }
  if (!nonEmptyString(value.name)) errors.push(`${path}.name must be a non-empty string`);
  validateOptionalString(value, 'nameEn', path, errors);
  validateOptionalString(value, 'federation', path, errors);
  validateOptionalString(value, 'federationEn', path, errors);
  validateOptionalString(value, 'title', path, errors);
  validateOptionalString(value, 'sourceId', path, errors);
  return value as XiangqiBroadcastPlayerTag;
}

function validateMove(value: unknown, path: string, errors: string[]): XiangqiMove {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return { from: 'a1', to: 'a1' };
  }
  if (!isXiangqiBroadcastSquare(value.from)) errors.push(`${path}.from must be a valid square`);
  if (!isXiangqiBroadcastSquare(value.to)) errors.push(`${path}.to must be a valid square`);
  return value as XiangqiMove;
}

function validateMoveList(value: unknown, path: string, errors: string[]): XiangqiMove[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  return value.map((move, index) => validateMove(move, `${path}[${index}]`, errors));
}

export function validateXiangqiBroadcastTour(
  value: unknown,
): XiangqiBroadcastValidationResult<XiangqiBroadcastTour> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['tour must be an object'] };
  validateSchema(value, 'tour', errors);
  if (!nonEmptyString(value.slug)) errors.push('tour.slug must be a non-empty string');
  if (!nonEmptyString(value.name)) errors.push('tour.name must be a non-empty string');
  validateOptionalString(value, 'nameEn', 'tour', errors);
  validateOptionalString(value, 'location', 'tour', errors);
  validateOptionalString(value, 'sourceUrl', 'tour', errors);
  validateOptionalString(value, 'startsAt', 'tour', errors);
  validateOptionalString(value, 'endsAt', 'tour', errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as XiangqiBroadcastTour };
}

export function validateXiangqiBroadcastRound(
  value: unknown,
): XiangqiBroadcastValidationResult<XiangqiBroadcastRound> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['round must be an object'] };
  validateSchema(value, 'round', errors);
  if (!nonEmptyString(value.id)) errors.push('round.id must be a non-empty string');
  if (!nonEmptyString(value.tourSlug)) errors.push('round.tourSlug must be a non-empty string');
  if (!nonEmptyString(value.name)) errors.push('round.name must be a non-empty string');
  validateOptionalString(value, 'nameEn', 'round', errors);
  validateOptionalString(value, 'startsAt', 'round', errors);
  validateOptionalString(value, 'sourceUrl', 'round', errors);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: value as XiangqiBroadcastRound };
}

export function validateXiangqiBroadcastBoard(
  value: unknown,
): XiangqiBroadcastValidationResult<XiangqiBroadcastBoard> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['board must be an object'] };
  validateSchema(value, 'board', errors);
  if (!nonEmptyString(value.id)) errors.push('board.id must be a non-empty string');
  if (!nonEmptyString(value.tourSlug)) errors.push('board.tourSlug must be a non-empty string');
  if (!nonEmptyString(value.roundId)) errors.push('board.roundId must be a non-empty string');
  if (!nonEmptyString(value.sourceBoardId)) {
    errors.push('board.sourceBoardId must be a non-empty string');
  }
  if (!Number.isInteger(value.boardNumber) || Number(value.boardNumber) < 1) {
    errors.push('board.boardNumber must be a positive integer');
  }
  validatePlayer(value.red, 'board.red', errors);
  validatePlayer(value.black, 'board.black', errors);
  if (!BOARD_STATUSES.has(value.status as XiangqiBroadcastBoardStatus)) {
    errors.push('board.status must be scheduled, live, or complete');
  }
  if (!RESULTS.has(value.result as XiangqiBroadcastResult)) {
    errors.push('board.result must be *, 1-0, 0-1, or 1/2-1/2');
  }
  if (value.status === 'complete' && value.result === '*') {
    errors.push('board.result must be decided when board.status is complete');
  }
  if (value.status !== 'complete' && value.result !== '*') {
    errors.push('board.result must be * until board.status is complete');
  }
  validateMoveList(value.moves, 'board.moves', errors);
  validateOptionalString(value, 'sourceUrl', 'board', errors);
  if (value.details !== undefined) validateGameDetails(value.details, errors);
  if (value.recordWithheld !== undefined) validateRecordWithheld(value, errors);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: value as XiangqiBroadcastBoard };
}

const RECORD_WITHHELD = new Set<XiangqiBroadcastRecordWithheld>(['ambiguous']);

// A withheld record is a finished result with nothing to replay and a page
// that has the record: anything else would show a start position as the game.
function validateRecordWithheld(value: Record<string, unknown>, errors: string[]): void {
  if (!RECORD_WITHHELD.has(value.recordWithheld as XiangqiBroadcastRecordWithheld)) {
    errors.push('board.recordWithheld must be ambiguous when present');
  }
  if (value.status !== 'complete') {
    errors.push('board.recordWithheld needs board.status complete');
  }
  if (Array.isArray(value.moves) && value.moves.length > 0) {
    errors.push('board.recordWithheld needs board.moves to be empty');
  }
  if (!nonEmptyString(value.sourceUrl)) {
    errors.push('board.recordWithheld needs board.sourceUrl, the page with the record');
  }
}

const GAME_KINDS = new Set<XiangqiBroadcastGameKind>(['standard', 'rapid', 'blitz']);

function validateGameDetails(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('board.details must be an object');
    return;
  }
  for (const key of ['match', 'matchEn', 'timeControl', 'playedAt', 'opening'] as const) {
    validateOptionalString(value, key, 'board.details', errors);
  }
  for (const key of ['table', 'game'] as const) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) < 1)) {
      errors.push(`board.details.${key} must be a positive integer`);
    }
  }
  if (value.kind !== undefined && !GAME_KINDS.has(value.kind as XiangqiBroadcastGameKind)) {
    errors.push('board.details.kind must be standard, rapid, or blitz');
  }
}

export function validateXiangqiBroadcastTape(
  value: unknown,
): XiangqiBroadcastValidationResult<XiangqiBroadcastTape> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['tape must be an object'] };
  if (value.schema !== XIANGQI_BROADCAST_TAPE_SCHEMA) {
    errors.push(`tape.schema must be ${XIANGQI_BROADCAST_TAPE_SCHEMA}`);
  }
  if (!nonEmptyString(value.tourSlug)) errors.push('tape.tourSlug must be a non-empty string');
  if (!Array.isArray(value.events)) {
    errors.push('tape.events must be an array');
  } else {
    let lastAtMs = -1;
    value.events.forEach((event, index) => {
      const path = `tape.events[${index}]`;
      if (!isRecord(event)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (!Number.isInteger(event.atMs) || Number(event.atMs) < 0) {
        errors.push(`${path}.atMs must be a non-negative integer`);
      } else if (Number(event.atMs) < lastAtMs) {
        errors.push(`${path}.atMs must be ordered ascending`);
      } else {
        lastAtMs = Number(event.atMs);
      }
      if (!nonEmptyString(event.boardId)) errors.push(`${path}.boardId must be a non-empty string`);
      if (event.moves !== undefined) validateMoveList(event.moves, `${path}.moves`, errors);
      if (event.append !== undefined) validateMoveList(event.append, `${path}.append`, errors);
      if (event.moves !== undefined && event.append !== undefined) {
        errors.push(`${path} cannot include both moves and append`);
      }
      if (
        event.status !== undefined &&
        !BOARD_STATUSES.has(event.status as XiangqiBroadcastBoardStatus)
      ) {
        errors.push(`${path}.status must be scheduled, live, or complete`);
      }
      if (event.result !== undefined && !RESULTS.has(event.result as XiangqiBroadcastResult)) {
        errors.push(`${path}.result must be *, 1-0, 0-1, or 1/2-1/2`);
      }
      if (event.status === 'complete' && event.result === '*') {
        errors.push(`${path}.result must be decided when status is complete`);
      }
      if (event.status !== undefined && event.status !== 'complete' && event.result !== undefined) {
        if (event.result !== '*') errors.push(`${path}.result must be * until status is complete`);
      }
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as XiangqiBroadcastTape };
}

export function validateXiangqiBroadcastBoards(
  value: unknown,
): XiangqiBroadcastValidationResult<XiangqiBroadcastBoard[]> {
  if (!Array.isArray(value)) return { ok: false, errors: ['boards must be an array'] };
  const boards: XiangqiBroadcastBoard[] = [];
  const errors: string[] = [];
  value.forEach((entry, index) => {
    const result = validateXiangqiBroadcastBoard(entry);
    if (result.ok) {
      boards.push(result.value);
    } else {
      errors.push(...result.errors.map((error) => `boards[${index}]: ${error}`));
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: boards };
}

export type ReplayXiangqiBroadcastBoardOptions = {
  /**
   * Keep replaying when the kernel auto-draws on an arbiter-adjudicated reason.
   * Broadcast and archive ingestion set this: dropping such a board loses a
   * real game. Live play must NOT set it — there the auto-draw is the ruling.
   */
  continuePastAdjudicatedDraw?: boolean;
};

export function replayXiangqiBroadcastBoard(
  board: XiangqiBroadcastBoard,
  options: ReplayXiangqiBroadcastBoardOptions = {},
): XiangqiBroadcastReplayResult {
  let state = createInitialXiangqiState(board.id);
  const adjudications: XiangqiBroadcastAdjudication[] = [];
  for (let i = 0; i < board.moves.length; i += 1) {
    const move = board.moves[i]!;
    // A finished state generates no legal moves, so an adjudicated draw would
    // otherwise read as a corrupt record from here to the end of the game.
    if (
      options.continuePastAdjudicatedDraw &&
      state.status.type === 'finished' &&
      ARBITER_ADJUDICATED_DRAWS.has(state.status.reason)
    ) {
      adjudications.push({ ply: i + 1, reason: state.status.reason });
      state = resumeAdjudicatedDraw(state);
    }
    const legal = getStandardXiangqiLegalMoves(state).some(
      (candidate) => candidate.from === move.from && candidate.to === move.to,
    );
    if (!legal) {
      return {
        ok: false,
        boardId: board.id,
        ply: i + 1,
        move,
        reason: `illegal move at ply ${i + 1}: ${move.from}${move.to}`,
      };
    }
    state = applyStandardXiangqiMove(state, move);
  }
  return {
    ok: true,
    boardId: board.id,
    plies: board.moves.length,
    finalStatus: state.status,
    adjudications,
  };
}

export function xiangqiBroadcastVariant(): typeof XIANGQI_SPEC_ID {
  return XIANGQI_SPEC_ID;
}

// A midnight reading is a day the source wrote with no time: dpxq dates a
// record 2026-04-03 and older imports stored that as 00:00 China time, which
// put a Houston round at "12:00 AM". Read it back as the day.
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function dayOrMoment(value: string): string {
  return MIDNIGHT.exec(value)?.[1] ?? value;
}

/**
 * When a round started, for every surface that shows it (round menu, round
 * header, events card): its games' own dates over the seeded schedule. A seed
 * is a guess made before the event (the 2026 league was seeded one round a day
 * at 14:30 and played two a day, 13:00 and 19:00), and a round the poller added
 * from the source has no seed at all. A game time with a clock wins; a game
 * that states only its day keeps the seed's time when the seed falls on that
 * day, and shows the day alone when it does not.
 */
export function xiangqiBroadcastRoundStart(
  playedAt: Iterable<string | null | undefined>,
  startsAt: string | null | undefined,
): string | undefined {
  let earliest: string | undefined;
  for (const raw of playedAt) {
    if (!raw || Number.isNaN(Date.parse(raw))) continue;
    if (!earliest || Date.parse(raw) < Date.parse(earliest)) earliest = raw;
  }
  const seeded = startsAt ? dayOrMoment(startsAt) : undefined;
  if (!earliest) return seeded;
  const played = dayOrMoment(earliest);
  if (played.includes('T')) return played;
  if (seeded?.includes('T') && seeded.slice(0, 10) === played) return seeded;
  return played;
}

/**
 * Where a tour's or round's records came from, derived from the provenance each
 * board already carries.
 *
 * Board provenance determines who gets credit. `tour.sourceUrl` is normally
 * a poll target, so it cannot establish provenance by itself; when it names
 * a public page on the credited source, it can give the reader a specific
 * event to open. dpxq's discovery targets use the reviewed tour mapping.
 *
 * Shared because both surfaces need the same answer: the web client renders it
 * under a round's boards, and the tour API derives it server-side because the
 * tour payload carries no boards for the client to inspect. Two copies would
 * drift and the failure mode is silent -- a page crediting nobody.
 */
/**
 * The page a reader can open for a tour's source, from the URL the poller uses.
 *
 * `tour.sourceUrl` is the POLL TARGET, and since 2026-09-13 a tour polled from
 * dpxq's game list carries a discovery URL there
 * (`mistboard-discover://dpxq-tour?tour=12524&...`), which is not a page at
 * all: rendered as an href it is a dead link on the tour hero. Map it back to
 * the human page the provider reads; pass an http(s) target through; give
 * nothing for anything else, so an unknown scheme is a missing button rather
 * than a broken one.
 */
export function broadcastSourcePageHref(sourceUrl: string | undefined): string | undefined {
  if (!sourceUrl) return undefined;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return sourceUrl;
  if (url.protocol !== 'mistboard-discover:') return undefined;
  const provider = (url.host || url.pathname.replace(/^\/+/, '')).toLowerCase();
  const tour = url.searchParams.get('tour')?.trim();
  if (provider === 'dpxq-tour' && tour && /^\d+$/.test(tour)) {
    return `http://www.dpxq.com/hldcg/movelist_${tour}.html`;
  }
  return undefined;
}

// Tours imported by hand, whose source URL names a game page (or nothing)
// rather than the dpxq tour, mapped to that tour: the calendar lists each event
// once by it, and the records credit links the tour's own dpxq page. Reviewed
// in the same diff as the tour it maps, like the level grades.
export const HAND_IMPORTED_DPXQ_TOURS: Readonly<Record<string, string>> = {
  // 象甲"腾讯天天象棋"预选赛, Aug 17-19: 99 games pasted from movelist_12656.
  '2026-league-qualifier': '12656',
  // 10th North American Championship, Houston, Apr 3-5: 75 games from tour_12473.
  '2026-north-american-championship': '12473',
};

/** dpxq's own page for a tour: the event, its rounds and its games. */
export function dpxqTourPageUrl(tourId: string): string {
  return `http://www.dpxq.com/hldcg/tour_${tourId}.html`;
}

/** The dpxq tour a tour of ours relays, from its discovery URL or the
 *  hand-import map; null for a tour from anywhere else. */
export function dpxqTourIdForTour(tour: {
  slug: string;
  sourceUrl?: string | null;
}): string | null {
  if (tour.sourceUrl?.startsWith('mistboard-discover://dpxq-tour')) {
    try {
      const id = new URL(tour.sourceUrl).searchParams.get('tour');
      if (id && /^\d+$/.test(id)) return id;
    } catch {
      // Fall through to the hand-import map.
    }
  }
  return HAND_IMPORTED_DPXQ_TOURS[tour.slug] ?? null;
}

// Record databases published on another organisation's site, credited by the
// database's name rather than the host: the publisher asked for the name. The
// HCMC Chess Federation hosts XQBase's Vietnamese records on vietnamchess.vn
// and agreed on 2026-10-26 to community use with credit to XQBase and a link
// back to its databank.
const NAMED_RECORD_SOURCES: ReadonlyArray<{ host: string; pathPrefix: string; name: string }> = [
  { host: 'vietnamchess.vn', pathPrefix: '/databank/xqbase-vietnamchess', name: 'XQBase' },
];

/** The database a record's source URL belongs to, when it has a name of its
 *  own (XQBase on vietnamchess.vn); null for a plain site. */
export function broadcastRecordsSourceName(sourceUrl: string | undefined): string | null {
  if (!sourceUrl) return null;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.host.replace(/^www\./, '');
  const source = NAMED_RECORD_SOURCES.find(
    (entry) =>
      entry.host === host &&
      (url.pathname === entry.pathPrefix || url.pathname.startsWith(`${entry.pathPrefix}/`)),
  );
  return source?.name ?? null;
}

/**
 * The credit links the page a reader can check the records against: the
 * tour's own dpxq page when known, otherwise a public tour URL on the same
 * source as the records. Fall back to the source's site when no such page
 * is available; never send one provider's credit to another provider.
 */
export function broadcastRecordsCredit(
  boards: readonly { sourceUrl?: string }[],
  tour?: { slug: string; sourceUrl?: string | null } | null,
): { host: string; href: string; name?: string } | null {
  const origins = new Map<string, string>();
  // The database name, kept only while every voting board agrees on it.
  const names = new Set<string | null>();
  for (const board of boards) {
    if (!board.sourceUrl) continue;
    try {
      const url = new URL(board.sourceUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      origins.set(url.host.replace(/^www\./, ''), url.origin);
      names.add(broadcastRecordsSourceName(board.sourceUrl));
    } catch {
      // A board with an unparseable source simply does not vote.
    }
  }
  // Two origins would need a list, and no import path produces one today.
  // Credit only what can be stated without qualification.
  if (origins.size !== 1) return null;
  const [entry] = [...origins.entries()];
  const [host, origin] = entry!;
  const [onlyName] = names.size === 1 ? [...names] : [null];
  const credit = (href: string) => (onlyName ? { host, href, name: onlyName } : { host, href });
  const dpxqTour = host === 'dpxq.com' && tour ? dpxqTourIdForTour(tour) : null;
  if (dpxqTour) return credit(dpxqTourPageUrl(dpxqTour));
  if (tour?.sourceUrl) {
    try {
      const page = new URL(tour.sourceUrl);
      if (
        (page.protocol === 'http:' || page.protocol === 'https:') &&
        page.host.replace(/^www\./, '') === host &&
        !page.username &&
        !page.password &&
        (page.pathname !== '/' || page.search !== '')
      ) {
        return credit(page.href);
      }
    } catch {
      // Invalid poll targets cannot replace the known source's site link.
    }
  }
  return credit(origin);
}
