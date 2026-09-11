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
};

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
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: value as XiangqiBroadcastBoard };
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
      state = { ...state, status: { type: 'playing', turn: i % 2 === 0 ? 'red' : 'black' } };
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

/**
 * Where a tour's or round's records came from, derived from the provenance each
 * board already carries.
 *
 * NOT `tour.sourceUrl`, which is a POLL TARGET: the poller re-anchors it every
 * run, it has to be a page carrying move data, and for a tour imported from an
 * archive there is no URL shape that says "all of this came from there". A
 * credit is editorial and must not depend on any of that.
 *
 * Shared because both surfaces need the same answer: the web client renders it
 * under a round's boards, and the tour API derives it server-side because the
 * tour payload carries no boards for the client to inspect. Two copies would
 * drift and the failure mode is silent -- a page crediting nobody.
 */
export function broadcastRecordsCredit(
  boards: readonly { sourceUrl?: string }[],
): { host: string; href: string } | null {
  const origins = new Map<string, string>();
  for (const board of boards) {
    if (!board.sourceUrl) continue;
    try {
      const url = new URL(board.sourceUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      origins.set(url.host.replace(/^www\./, ''), url.origin);
    } catch {
      // A board with an unparseable source simply does not vote.
    }
  }
  // Two origins would need a list, and no import path produces one today.
  // Credit only what can be stated without qualification.
  if (origins.size !== 1) return null;
  const [entry] = [...origins.entries()];
  const [host, href] = entry!;
  return { host, href };
}
