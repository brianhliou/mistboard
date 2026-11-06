// FFQ banqi (翻翻棋): rules as implemented by Huorongrong (mistboard#800).
// Hidden canonical spec FFQ_BANQI_SPEC_ID; the server tenant is unregistered.
// Canonical state is server-secret. Only getFFQBanqiPlayerView and
// ffqBanqiStateToFen may cross a player/engine boundary, even at game end.
import type { AbortReason } from './types.js';
import {
  assertValidBanqiDeal,
  BANQI_PIECE_COUNTS,
  type BanqiColor,
  type BanqiDeal,
  type BanqiPiece,
  type BanqiPieceRole,
  type BanqiVisibleBoardEntry,
  createBanqiDeal,
  oppositeBanqiColor,
} from './variants-banqi.js';

export const FFQ_BANQI_WIDTH = 4;
export const FFQ_BANQI_HEIGHT = 8;
export const FFQ_BANQI_START_HP = 60;
export const FFQ_BANQI_NO_PROGRESS_LIMIT = 30;
export const FFQ_BANQI_CHASE_LIMIT = 4;
export const FFQ_BANQI_FACE_UP_SQUARES = [6, 15, 16, 25] as const;
export const FFQ_BANQI_DAMAGE: Readonly<Record<BanqiPieceRole, number>> = {
  soldier: 2,
  cannon: 5,
  horse: 5,
  chariot: 5,
  elephant: 5,
  advisor: 10,
  general: 30,
};
export const FFQ_BANQI_ROLE_ORDER: readonly BanqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];

/** The card's nine rules, implemented from its specification, independently of
 * the source engine. Tencent's live app has not been verified: first check the
 * cannon's capture-only movement and friendly covered captures. See
 * docs/ffq-banqi-rules.md for the source and the disclosure boundary.
 */
export const FFQ_BANQI_RULES = {
  board: { width: FFQ_BANQI_WIDTH, height: FFQ_BANQI_HEIGHT, indexing: 'y*4+x' },
  piecesPerColor: { ...BANQI_PIECE_COUNTS },
  setupFaceUpSquares: FFQ_BANQI_FACE_UP_SQUARES,
  seatColors: 'fixed-red-first-black-second',
  startingHP: FFQ_BANQI_START_HP,
  captureDamage: FFQ_BANQI_DAMAGE,
  simultaneousZeroHP: 'draw',
  flipEitherColor: true,
  nonCannonStep: 'one-orthogonal',
  captureRankOrder: FFQ_BANQI_ROLE_ORDER,
  generalTakesSoldier: false,
  soldierTargets: ['soldier', 'general'],
  nonCannonCoveredCapture: false,
  cannonQuietMove: false,
  cannonScreens: 1,
  cannonCoveredTargets: 'either-color',
  coveredCaptureDisclosure: 'capturer-only',
  noProgressPlies: FFQ_BANQI_NO_PROGRESS_LIMIT,
  flipAndCaptureResetClockAndBothChases: true,
  chase: 'quiet-step-attacks-any-capturable-adjacent-face-up-enemy',
  consecutiveChaseLimit: FFQ_BANQI_CHASE_LIMIT,
  nonChaseResets: 'mover-only',
  noLegalMove: 'loss-without-chase-exception',
  resultPrecedence: ['hp', 'no-progress', 'no-legal-move'],
} as const;

/** Indices 0..31, with x = index % 4 and y = floor(index / 4). */
export type FFQBanqiBoard = Array<BanqiPiece | null>;
/** from === to flips a covered tile; all other actions move/capture. */
export type FFQBanqiMove = { from: number; to: number };
export type FFQBanqiStatus =
  | { type: 'playing'; turn: BanqiColor }
  | { type: 'finished'; winner: BanqiColor | null; reason: FFQBanqiEndReason }
  | { type: 'aborted'; reason: AbortReason };
export type FFQBanqiEndReason =
  | 'hp'
  | 'no-progress'
  | 'no-legal-move'
  // Endings produced by the live-room lifecycle.
  | 'timeout'
  | 'resignation'
  | 'abandonment'
  | 'agreement';
export type FFQBanqiCapture = {
  owner: BanqiColor;
  role: BanqiPieceRole;
  capturedBy: BanqiColor;
  wasFaceDown: boolean;
};
export type FFQBanqiState = {
  id: string;
  board: FFQBanqiBoard;
  status: FFQBanqiStatus;
  ply: number;
  moveNumber: number;
  hp: Record<BanqiColor, number>;
  noProgressClock: number;
  chaseCounts: Record<BanqiColor, number>;
  captures: FFQBanqiCapture[];
  lastMove?: FFQBanqiMove;
};
/** HP discloses the victim's ink; a covered victim's exact role is capturer-only. */
export type FFQBanqiCapturedView = Omit<FFQBanqiCapture, 'role'> & { role: BanqiPieceRole | null };
export type FFQBanqiPlayerView = {
  id: string;
  perspective: BanqiColor | 'observer';
  board: Array<BanqiVisibleBoardEntry | null>;
  status: FFQBanqiStatus;
  ply: number;
  moveNumber: number;
  hp: Record<BanqiColor, number>;
  noProgressClock: number;
  chaseCounts: Record<BanqiColor, number>;
  captured: FFQBanqiCapturedView[];
  // Candidates include covered captures whose roles this viewer does not know.
  pool: Record<BanqiColor, Record<BanqiPieceRole, number>>;
  // Captured roles still included in this viewer's pool.
  unknownCaptured: Record<BanqiColor, number>;
  legalMoves: FFQBanqiMove[];
  lastMove?: FFQBanqiMove;
};

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const inBounds = (x: number, y: number) =>
  x >= 0 && x < FFQ_BANQI_WIDTH && y >= 0 && y < FFQ_BANQI_HEIGHT;
const NEIGHBORS = Array.from({ length: 32 }, (_, square) =>
  ORTHO.flatMap(([dx, dy]) => {
    const x = (square % 4) + dx;
    const y = Math.floor(square / 4) + dy;
    return inBounds(x, y) ? [y * 4 + x] : [];
  }),
);

/** Reproducible test/replay deal. A future live adapter must supply a secret,
 * crypto-backed RNG instead of a predictable numeric seed. No seed is retained.
 */
export function createFFQBanqiDeal(seed: number | (() => number)): BanqiDeal {
  let value = typeof seed === 'number' ? seed >>> 0 : 0;
  return createBanqiDeal(
    typeof seed === 'function'
      ? seed
      : () => {
          value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
          return value / 0x100000000;
        },
  );
}

export function createInitialFFQBanqiState(
  id: string,
  seed: number | (() => number),
): FFQBanqiState {
  const open: readonly number[] = FFQ_BANQI_FACE_UP_SQUARES;
  return {
    id,
    board: createFFQBanqiDeal(seed).map((piece, square) => ({
      ...piece,
      faceDown: !open.includes(square),
    })),
    status: { type: 'playing', turn: 'red' },
    ply: 0,
    moveNumber: 1,
    hp: { red: FFQ_BANQI_START_HP, black: FFQ_BANQI_START_HP },
    noProgressClock: 0,
    chaseCounts: { red: 0, black: 0 },
    captures: [],
  };
}

/** Server-secret replay setup: persist once, never send to a client. */
export type FFQBanqiSetup = { deal: BanqiDeal };

export function createFFQBanqiSetup(rng: () => number): FFQBanqiSetup {
  return { deal: createFFQBanqiDeal(rng) };
}

/** Reconnects must replay the stored deal, never silently generate another. */
export function createFFQBanqiStateFromSetup(id: string, setup: unknown): FFQBanqiState {
  if (typeof setup !== 'object' || setup === null || !('deal' in setup)) {
    throw new Error('invalid FFQ banqi setup: no deal');
  }
  const deal = setup.deal;
  if (!Array.isArray(deal)) throw new Error('invalid FFQ banqi setup: no deal');
  assertValidBanqiDeal(deal);
  const open: readonly number[] = FFQ_BANQI_FACE_UP_SQUARES;
  return {
    ...createInitialFFQBanqiState(id, 0),
    board: deal.map((piece, square) => ({ ...piece, faceDown: !open.includes(square) })),
  };
}

export function ffqBanqiSeatToMove(state: Pick<FFQBanqiState, 'ply'>): BanqiColor {
  return state.ply % 2 === 0 ? 'red' : 'black';
}

function canTake(attacker: BanqiPieceRole, victim: BanqiPieceRole): boolean {
  if (attacker === 'soldier') return victim === 'soldier' || victim === 'general';
  if (attacker === 'general' && victim === 'soldier') return false;
  return FFQ_BANQI_ROLE_ORDER.indexOf(attacker) <= FFQ_BANQI_ROLE_ORDER.indexOf(victim);
}

/** Only public geometry is read. In particular a covered victim's ink/role
 * cannot affect legality, even if capturing it will end the game for the mover.
 */
function boardDests(board: FFQBanqiBoard, from: number, piece: BanqiPiece): number[] {
  if (piece.role !== 'cannon')
    return NEIGHBORS[from].filter((to) => {
      const target = board[to];
      return (
        !target ||
        (!target.faceDown && target.color !== piece.color && canTake(piece.role, target.role))
      );
    });
  const dests: number[] = [];
  for (const [dx, dy] of ORTHO) {
    let screens = 0;
    for (let x = (from % 4) + dx, y = Math.floor(from / 4) + dy; inBounds(x, y); x += dx, y += dy) {
      const to = y * 4 + x;
      const target = board[to];
      if (!target) continue;
      if (screens === 0) {
        screens += 1;
        continue;
      }
      if (target.faceDown || target.color !== piece.color) dests.push(to);
      break;
    }
  }
  return dests;
}

function isChase(state: FFQBanqiState, move: FFQBanqiMove): boolean {
  const piece = state.board[move.from];
  if (
    !piece ||
    piece.faceDown ||
    piece.role === 'cannon' ||
    move.from === move.to ||
    state.board[move.to]
  )
    return false;
  return NEIGHBORS[move.to].some((square) => {
    // The mover's old square is now empty. No identity beneath a back is read.
    const target = square === move.from ? null : state.board[square];
    return (
      target && !target.faceDown && target.color !== piece.color && canTake(piece.role, target.role)
    );
  });
}

export function getFFQBanqiLegalMoves(state: FFQBanqiState): FFQBanqiMove[] {
  if (
    state.status.type !== 'playing' ||
    state.hp.red <= 0 ||
    state.hp.black <= 0 ||
    state.noProgressClock >= FFQ_BANQI_NO_PROGRESS_LIMIT
  )
    return [];
  const seat = ffqBanqiSeatToMove(state);
  const moves: FFQBanqiMove[] = [];
  for (let from = 0; from < 32; from += 1) {
    const piece = state.board[from];
    if (!piece) continue;
    if (piece.faceDown) {
      moves.push({ from, to: from });
      continue;
    }
    if (piece.color !== seat) continue;
    for (const to of boardDests(state.board, from, piece)) {
      const move = { from, to };
      if (state.chaseCounts[seat] < FFQ_BANQI_CHASE_LIMIT || !isChase(state, move))
        moves.push(move);
    }
  }
  return moves;
}

export function isFFQBanqiLegalMove(state: FFQBanqiState, move: FFQBanqiMove): boolean {
  return getFFQBanqiLegalMoves(state).some(
    (candidate) => candidate.from === move.from && candidate.to === move.to,
  );
}

export function getFFQBanqiResult(state: FFQBanqiState): FFQBanqiStatus {
  if (state.status.type !== 'playing') return state.status;
  if (state.hp.red <= 0 || state.hp.black <= 0)
    return {
      type: 'finished',
      reason: 'hp',
      winner: state.hp.red <= 0 && state.hp.black <= 0 ? null : state.hp.red <= 0 ? 'black' : 'red',
    };
  if (state.noProgressClock >= FFQ_BANQI_NO_PROGRESS_LIMIT)
    return { type: 'finished', winner: null, reason: 'no-progress' };
  if (getFFQBanqiLegalMoves(state).length === 0)
    return {
      type: 'finished',
      winner: oppositeBanqiColor(ffqBanqiSeatToMove(state)),
      reason: 'no-legal-move',
    };
  return { type: 'playing', turn: ffqBanqiSeatToMove(state) };
}

/** Illegal moves return the same state, matching the other banqi kernels. */
export function applyFFQBanqiMove(state: FFQBanqiState, move: FFQBanqiMove): FFQBanqiState {
  if (!isFFQBanqiLegalMove(state, move)) return state;
  const seat = ffqBanqiSeatToMove(state);
  const piece = state.board[move.from]!;
  const flip = move.from === move.to;
  const target = flip ? null : state.board[move.to];
  const board = [...state.board];
  const hp = { ...state.hp };
  let captures = state.captures;
  if (flip) board[move.from] = { ...piece, faceDown: false };
  else {
    board[move.to] = { ...piece };
    board[move.from] = null;
    if (target) {
      hp[target.color] = Math.max(0, hp[target.color] - FFQ_BANQI_DAMAGE[target.role]);
      captures = [
        ...captures,
        { owner: target.color, role: target.role, capturedBy: seat, wasFaceDown: target.faceDown },
      ];
    }
  }
  const progress = flip || target !== null;
  const chaseCounts = progress
    ? { red: 0, black: 0 }
    : {
        ...state.chaseCounts,
        [seat]: isChase(state, move) ? state.chaseCounts[seat] + 1 : 0,
      };
  const ply = state.ply + 1;
  const next: FFQBanqiState = {
    ...state,
    board,
    hp,
    captures,
    chaseCounts,
    ply,
    moveNumber: Math.floor(ply / 2) + 1,
    noProgressClock: progress ? 0 : state.noProgressClock + 1,
    status: { type: 'playing', turn: oppositeBanqiColor(seat) },
    lastMove: { ...move },
  };
  next.status = getFFQBanqiResult(next);
  return next;
}

export function getFFQBanqiPlayerView(
  state: FFQBanqiState,
  perspective: BanqiColor | 'observer',
): FFQBanqiPlayerView {
  const board: FFQBanqiPlayerView['board'] = state.board.map((piece) =>
    !piece
      ? null
      : piece.faceDown
        ? { faceDown: true }
        : { color: piece.color, role: piece.role, faceDown: false },
  );
  const captured = state.captures.map(({ owner, role, capturedBy, wasFaceDown }) => ({
    owner,
    role: wasFaceDown && capturedBy !== perspective ? null : role,
    capturedBy,
    wasFaceDown,
  }));
  const pool = { red: { ...BANQI_PIECE_COUNTS }, black: { ...BANQI_PIECE_COUNTS } };
  for (const piece of board) if (piece && !piece.faceDown) pool[piece.color][piece.role] -= 1;
  const unknownCaptured = { red: 0, black: 0 };
  for (const capture of captured) {
    if (capture.role === null) unknownCaptured[capture.owner] += 1;
    else pool[capture.owner][capture.role] -= 1;
  }
  return {
    id: state.id,
    perspective,
    board,
    captured,
    pool,
    unknownCaptured,
    status: { ...state.status },
    ply: state.ply,
    moveNumber: state.moveNumber,
    hp: { ...state.hp },
    noProgressClock: state.noProgressClock,
    chaseCounts: { ...state.chaseCounts },
    legalMoves: perspective === ffqBanqiSeatToMove(state) ? getFFQBanqiLegalMoves(state) : [],
    ...(state.lastMove ? { lastMove: { ...state.lastMove } } : {}),
  };
}
