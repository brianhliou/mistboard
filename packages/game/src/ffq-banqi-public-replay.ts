// Fanfanqi replay from public observations. There is no sampled deal: a back
// has occupancy alone until this line flips or captures it. The ordinary
// kernel owns legality, HP, chase, the draw clock and result precedence.
import { banqiPieceLetter } from './banqi-fen.js';
import { ffqBanqiStateToFen } from './ffq-banqi-fen.js';
import { BANQI_PIECE_COUNTS, type BanqiColor, type BanqiPieceRole } from './variants-banqi.js';
import {
  applyFFQBanqiKernelMove,
  FFQ_BANQI_FACE_UP_SQUARES,
  FFQ_BANQI_START_HP,
  type FFQBanqiMove,
  type FFQBanqiReplayState,
  getFFQBanqiPlayerView,
  isFFQBanqiLegalMove,
} from './variants-ffq-banqi.js';

export const FFQ_BANQI_PUBLIC_REPLAY = 'ffq-banqi-public-v1';
export type FFQBanqiReplayIdentity = { color: BanqiColor; role: BanqiPieceRole };
export type FFQBanqiReplayMove = FFQBanqiMove & {
  revealed?: FFQBanqiReplayIdentity;
  capturedHidden?: FFQBanqiReplayIdentity;
};

const ROLE: Record<string, BanqiPieceRole> = {
  G: 'general',
  A: 'advisor',
  E: 'elephant',
  R: 'chariot',
  H: 'horse',
  C: 'cannon',
  S: 'soldier',
};

function fail(): never {
  throw new Error('Inconsistent Fanfanqi public replay.');
}

function validIdentity(piece: FFQBanqiReplayIdentity | undefined): piece is FFQBanqiReplayIdentity {
  return Boolean(
    piece &&
      ['red', 'black'].includes(piece.color) &&
      Object.hasOwn(BANQI_PIECE_COUNTS, piece.role),
  );
}

function available(state: FFQBanqiReplayState, piece: FFQBanqiReplayIdentity): boolean {
  return (
    validIdentity(piece) &&
    getFFQBanqiPlayerView(state, 'observer').pool[piece.color][piece.role] > 0
  );
}

/** The four identities are in FFQ_BANQI_FACE_UP_SQUARES order (6,15,16,25).
 * Only these public observations enter the root; 28 backs stay anonymous. */
export function createInitialFFQBanqiReplayState(
  id: string,
  initialRevealed: readonly FFQBanqiReplayIdentity[],
): FFQBanqiReplayState {
  if (!Array.isArray(initialRevealed) || initialRevealed.length !== 4) return fail();
  const state: FFQBanqiReplayState = {
    id,
    board: Array.from({ length: 32 }, () => ({ faceDown: true })),
    status: { type: 'playing', turn: 'red' },
    ply: 0,
    moveNumber: 1,
    hp: { red: FFQ_BANQI_START_HP, black: FFQ_BANQI_START_HP },
    noProgressClock: 0,
    chaseCounts: { red: 0, black: 0 },
    captures: [],
  };
  FFQ_BANQI_FACE_UP_SQUARES.forEach((square, i) => {
    const piece = initialRevealed[i]!;
    if (!available(state, piece)) fail();
    state.board[square] = { color: piece.color, role: piece.role, faceDown: false };
  });
  return state;
}

/** Validate an opening FEN, never a composition, dealt root or later snapshot.
 * Comparing the complete snapshot also checks HP, pools, turn and counters. */
export function parseFFQBanqiReplayStartFen(fen: string, id = 'record'): FFQBanqiReplayState {
  const rows = fen.split(' ')[0]!.split('/');
  if (rows.length !== 8 || rows.some((row) => !/^[XGAERHCSgaerhcs]{4}$/.test(row))) return fail();
  const letters = rows.reverse().join('');
  const open: readonly number[] = FFQ_BANQI_FACE_UP_SQUARES;
  if ([...letters].some((letter, i) => (letter !== 'X') !== open.includes(i))) return fail();
  const state = createInitialFFQBanqiReplayState(
    id,
    open.map((square) => fromLetter(letters[square]!)),
  );
  if (ffqBanqiStateToFen(state) !== fen) return fail();
  return state;
}

function fromLetter(letter: string): FFQBanqiReplayIdentity {
  return {
    color: letter === letter.toUpperCase() ? 'red' : 'black',
    role: ROLE[letter.toUpperCase()]!,
  };
}

const square = (index: number): string =>
  `${String.fromCharCode(97 + (index % 4))}${Math.floor(index / 4)}`;
const index = (sq: string): number => Number(sq[1]) * 4 + sq.charCodeAt(0) - 97;

/** Outcome-bearing tree tokens use engine coordinates a0-d7. Bare flips are
 * deliberately unreadable; a branch cannot borrow a future observation. */
export function parseFFQBanqiReplayMove(token: string): FFQBanqiReplayMove | null {
  const flip = /^@([a-d][0-7]):([GAERHCSgaerhcs])$/.exec(token);
  if (flip) return { from: index(flip[1]!), to: index(flip[1]!), revealed: fromLetter(flip[2]!) };
  const move = /^([a-d][0-7])([a-d][0-7])(?:x:([GAERHCSgaerhcs]))?$/.exec(token);
  if (!move || move[1] === move[2]) return null;
  return {
    from: index(move[1]!),
    to: index(move[2]!),
    ...(move[3] ? { capturedHidden: fromLetter(move[3]) } : {}),
  };
}

export function ffqBanqiReplayMoveToUci(move: FFQBanqiReplayMove): string {
  if (![move.from, move.to].every((n) => Number.isInteger(n) && n >= 0 && n < 32)) return fail();
  if (move.from === move.to) {
    if (!validIdentity(move.revealed) || move.capturedHidden !== undefined) return fail();
    return `@${square(move.from)}:${banqiPieceLetter(move.revealed)}`;
  }
  if (
    move.revealed !== undefined ||
    (move.capturedHidden !== undefined && !validIdentity(move.capturedHidden))
  )
    return fail();
  return `${square(move.from)}${square(move.to)}${move.capturedHidden ? `x:${banqiPieceLetter(move.capturedHidden)}` : ''}`;
}

/** Supply exactly the identity this legal action discloses, then consume it
 * through the shared kernel. No other covered tile acquires an identity. */
export function applyFFQBanqiReplayMove(
  state: FFQBanqiReplayState,
  move: FFQBanqiReplayMove,
): FFQBanqiReplayState {
  if (!isFFQBanqiLegalMove(state, move)) return fail();
  const flip = move.from === move.to;
  const coveredCapture = !flip && state.board[move.to]?.faceDown;
  if (
    flip !== (move.revealed !== undefined) ||
    Boolean(coveredCapture) !== (move.capturedHidden !== undefined)
  )
    return fail();
  const piece = flip ? move.revealed : move.capturedHidden;
  let before = state;
  if (piece) {
    if (!available(state, piece)) return fail();
    const board = [...state.board];
    const observed = { color: piece.color, role: piece.role, faceDown: true as const };
    board[flip ? move.from : move.to] = observed;
    before = { ...state, board };
  }
  const after = applyFFQBanqiKernelMove(before, { from: move.from, to: move.to });
  if (after === before) return fail();
  return after;
}
