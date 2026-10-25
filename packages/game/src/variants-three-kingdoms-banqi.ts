// Three Kingdoms banqi (三國暗棋), engine only (#628). No GameSpecId or tenant.
// Seats use Banqi's convention: red = first mover, black = second mover;
// a seat's INK is bound by the opening flip, independently of its seat token.
// Canonical state is server-secret. Only getThreeKingdomsBanqiPlayerView and
// threeKingdomsBanqiStateToFen may cross a player/engine boundary, even at game end.
import { banqiPieceLetter } from './banqi-fen.js';
import {
  type BanqiCapture,
  type BanqiColor,
  type BanqiDeal,
  type BanqiPiece,
  type BanqiPieceRole,
  type BanqiSeat,
  type BanqiVisibleBoardEntry,
  banqiInkForSeat,
  createBanqiDeal,
  oppositeBanqiSeat,
} from './variants-banqi.js';

export const THREE_KINGDOMS_BANQI_WIDTH = 9;
export const THREE_KINGDOMS_BANQI_HEIGHT = 5;
export const THREE_KINGDOMS_BANQI_SCORE_TARGET = 100;
export const THREE_KINGDOMS_BANQI_NO_PROGRESS_LIMIT = 40;
// The seventh consecutive chase is refused, so only six may be played.
export const THREE_KINGDOMS_BANQI_CHASE_LIMIT = 7;

/** Provisional defaults from #628. Each policy is implemented here once;
 * a future rules revision can replace it without changing the rule callers.
 * No alternate rulesets are exposed to players.
 */
export const THREE_KINGDOMS_BANQI_DEFAULTS = {
  // The general is ordinary: neither check nor facing generals restrict a move.
  generalSafety: (_state: ThreeKingdomsBanqiState, _move: ThreeKingdomsBanqiMove): boolean => true,
  // Face-down occupancy is public, but its ink/role cannot affect move legality.
  faceDownTarget: (): boolean => false,
  captureResetsNoProgress: true,
  chaseMoveAllowed: (count: number): boolean => count < THREE_KINGDOMS_BANQI_CHASE_LIMIT,
  noLegalMoveWinner: (seat: BanqiSeat): BanqiSeat | null => oppositeBanqiSeat(seat),
  noPiecesWinner: (seat: BanqiSeat): BanqiSeat | null => oppositeBanqiSeat(seat),
} as const;

export const THREE_KINGDOMS_BANQI_POINTS: Readonly<Record<BanqiPieceRole, number>> = {
  soldier: 5,
  advisor: 5,
  elephant: 5,
  cannon: 10,
  horse: 10,
  chariot: 15,
  general: 20,
};

export type ThreeKingdomsBanqiSquare = `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i'}${
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'}`;
export type ThreeKingdomsBanqiBoard = Partial<Record<ThreeKingdomsBanqiSquare, BanqiPiece>>;
export type ThreeKingdomsBanqiMove = {
  from: ThreeKingdomsBanqiSquare;
  to: ThreeKingdomsBanqiSquare;
};
export type ThreeKingdomsBanqiStatus =
  | { type: 'playing'; turn: BanqiSeat }
  | {
      type: 'finished';
      winner: BanqiSeat | null;
      reason: 'score' | 'no-progress' | 'no-legal-move' | 'no-pieces';
    };
export type ThreeKingdomsBanqiChase = { target: ThreeKingdomsBanqiSquare; count: number };
export type ThreeKingdomsBanqiState = {
  id: string;
  board: ThreeKingdomsBanqiBoard;
  status: ThreeKingdomsBanqiStatus;
  ply: number;
  moveNumber: number;
  firstColor: BanqiColor | null;
  // Scores and chase runs are keyed by SEAT, never by ink.
  scores: Record<BanqiSeat, number>;
  noProgressClock: number;
  captures: BanqiCapture[];
  lastMove?: ThreeKingdomsBanqiMove;
  chases: Partial<Record<BanqiSeat, ThreeKingdomsBanqiChase>>;
};
export type ThreeKingdomsBanqiPlayerView = {
  id: string;
  perspective: BanqiSeat;
  board: Partial<Record<ThreeKingdomsBanqiSquare, BanqiVisibleBoardEntry>>;
  status: ThreeKingdomsBanqiStatus;
  ply: number;
  moveNumber: number;
  firstColor: BanqiColor | null;
  scores: Record<BanqiSeat, number>;
  noProgressClock: number;
  captured: BanqiCapture[];
  legalMoves: ThreeKingdomsBanqiMove[];
  lastMove?: ThreeKingdomsBanqiMove;
};

const FILES = 'abcdefghi';
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const HORSE: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];
const squareOf = (file: number, rank: number) =>
  `${FILES[file]}${rank}` as ThreeKingdomsBanqiSquare;
const inBounds = (file: number, rank: number) =>
  file >= 0 &&
  file < THREE_KINGDOMS_BANQI_WIDTH &&
  rank >= 1 &&
  rank <= THREE_KINGDOMS_BANQI_HEIGHT;
export const ALL_THREE_KINGDOMS_BANQI_SQUARES: readonly ThreeKingdomsBanqiSquare[] = Array.from(
  { length: THREE_KINGDOMS_BANQI_WIDTH * THREE_KINGDOMS_BANQI_HEIGHT },
  (_, i) =>
    squareOf(i % THREE_KINGDOMS_BANQI_WIDTH, Math.floor(i / THREE_KINGDOMS_BANQI_WIDTH) + 1),
);
export const THREE_KINGDOMS_BANQI_SETUP_SQUARES = ALL_THREE_KINGDOMS_BANQI_SQUARES.filter(
  (square) => square[0] !== 'e' && square[1] !== '3',
);

/** Reproducible test/replay deal. A future live caller must supply a secret,
 * crypto-backed RNG instead of a predictable seed; no live adapter exists here.
 */
export function createThreeKingdomsBanqiDeal(seed: number | (() => number)): BanqiDeal {
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

export function createInitialThreeKingdomsBanqiState(
  id: string,
  seed: number | (() => number),
): ThreeKingdomsBanqiState {
  const board: ThreeKingdomsBanqiBoard = {};
  createThreeKingdomsBanqiDeal(seed).forEach((piece, i) => {
    board[THREE_KINGDOMS_BANQI_SETUP_SQUARES[i]] = { ...piece, faceDown: true };
  });
  return {
    id,
    board,
    status: { type: 'playing', turn: 'red' },
    ply: 0,
    moveNumber: 1,
    firstColor: null,
    scores: { red: 0, black: 0 },
    noProgressClock: 0,
    captures: [],
    chases: {},
  };
}

export function threeKingdomsBanqiSeatToMove(
  state: Pick<ThreeKingdomsBanqiState, 'ply'>,
): BanqiSeat {
  return state.ply % 2 === 0 ? 'red' : 'black';
}

/** Ordinary piece geometry only: no royal general, check, palace or river
 * (THREE_KINGDOMS_BANQI_DEFAULTS.generalSafety). All revealed enemies are capturable.
 */
function boardDests(
  board: ThreeKingdomsBanqiBoard,
  from: ThreeKingdomsBanqiSquare,
): ThreeKingdomsBanqiSquare[] {
  const piece = board[from];
  if (!piece || piece.faceDown) return [];
  const file = FILES.indexOf(from[0]);
  const rank = Number(from[1]);
  const dests: ThreeKingdomsBanqiSquare[] = [];
  const mayLand = (target: BanqiPiece | undefined) =>
    !target ||
    (target.faceDown
      ? THREE_KINGDOMS_BANQI_DEFAULTS.faceDownTarget()
      : target.color !== piece.color);

  if (piece.role === 'chariot' || piece.role === 'general' || piece.role === 'cannon') {
    for (const [df, dr] of ORTHO) {
      let screen = false;
      for (let f = file + df, r = rank + dr; inBounds(f, r); f += df, r += dr) {
        const to = squareOf(f, r);
        const target = board[to];
        if (piece.role !== 'cannon') {
          if (mayLand(target)) dests.push(to);
          if (target) break; // face-down targets block (default), as do own pieces
        } else if (!screen) {
          if (!target) dests.push(to);
          else screen = true; // any occupied square is a cannon screen
        } else if (target) {
          if (mayLand(target)) dests.push(to);
          break;
        }
      }
    }
    return dests;
  }
  const steps = piece.role === 'horse' ? HORSE : piece.role === 'soldier' ? ORTHO : DIAGONAL;
  const scale = piece.role === 'elephant' ? 2 : 1;
  for (const [df, dr] of steps) {
    const f = file + df * scale;
    const r = rank + dr * scale;
    // Horse legs and elephant eyes are intentionally ignored.
    if (inBounds(f, r) && mayLand(board[squareOf(f, r)])) dests.push(squareOf(f, r));
  }
  return dests;
}

/** A QUIET move by a revealed piece starts a run even if the threatened enemy
 * has not moved yet. The target must then flee between threats to continue the
 * run. Targets are tracked by square so identical roles cannot be confused.
 * A different target, a non-chase by the chaser, or any flip/capture breaks a run.
 * Unlike banqi's repetition rule there is no mutual-chase or only-move exemption.
 */
function chaseAfter(
  state: ThreeKingdomsBanqiState,
  move: ThreeKingdomsBanqiMove,
): ThreeKingdomsBanqiChase | undefined {
  if (move.from === move.to || state.board[move.to]) return undefined;
  const board = { ...state.board, [move.to]: state.board[move.from] };
  delete board[move.from];
  // Occupied destinations are revealed enemies by boardDests' landing rules.
  const targets = boardDests(board, move.to).filter((to) => board[to]);
  const run = state.chases[threeKingdomsBanqiSeatToMove(state)];
  const last = state.lastMove;
  const target =
    run && targets.includes(run.target)
      ? run.target
      : last && targets.includes(last.to)
        ? last.to
        : targets[0];
  if (!target) return undefined;
  return { target, count: run?.target === target ? run.count + 1 : 1 };
}

export function getThreeKingdomsBanqiLegalMoves(
  state: ThreeKingdomsBanqiState,
): ThreeKingdomsBanqiMove[] {
  if (state.status.type !== 'playing') return [];
  const ink = banqiInkForSeat(state, threeKingdomsBanqiSeatToMove(state));
  const moves: ThreeKingdomsBanqiMove[] = [];
  for (const from of ALL_THREE_KINGDOMS_BANQI_SQUARES) {
    const piece = state.board[from];
    if (!piece) continue;
    if (piece.faceDown) moves.push({ from, to: from });
    else if (piece.color === ink) {
      for (const to of boardDests(state.board, from)) {
        const move = { from, to };
        if (
          THREE_KINGDOMS_BANQI_DEFAULTS.generalSafety(state, move) &&
          THREE_KINGDOMS_BANQI_DEFAULTS.chaseMoveAllowed(chaseAfter(state, move)?.count ?? 0)
        )
          moves.push(move);
      }
    }
  }
  return moves;
}

export function getThreeKingdomsBanqiResult(
  state: ThreeKingdomsBanqiState,
): ThreeKingdomsBanqiStatus {
  if (state.status.type === 'finished') return state.status;
  for (const seat of ['red', 'black'] as const) {
    if (state.scores[seat] >= THREE_KINGDOMS_BANQI_SCORE_TARGET)
      return { type: 'finished', winner: seat, reason: 'score' };
  }
  if (state.noProgressClock >= THREE_KINGDOMS_BANQI_NO_PROGRESS_LIMIT) {
    return {
      type: 'finished',
      winner:
        state.scores.red === state.scores.black
          ? null
          : state.scores.red > state.scores.black
            ? 'red'
            : 'black',
      reason: 'no-progress',
    };
  }
  // Elimination is checked from PUBLIC material: fixed starting set minus
  // revealed captures. Never inspect a face-down tile's ink for adjudication.
  for (const seat of ['red', 'black'] as const) {
    const ink = banqiInkForSeat(state, seat);
    const publiclyEliminated =
      state.captures.filter((capture) => capture.owner === ink).length === 16 ||
      !Object.values(state.board).some((piece) => piece && (piece.faceDown || piece.color === ink));
    if (ink !== null && publiclyEliminated) {
      return {
        type: 'finished',
        winner: THREE_KINGDOMS_BANQI_DEFAULTS.noPiecesWinner(seat),
        reason: 'no-pieces',
      };
    }
  }
  if (getThreeKingdomsBanqiLegalMoves(state).length === 0) {
    return {
      type: 'finished',
      winner: THREE_KINGDOMS_BANQI_DEFAULTS.noLegalMoveWinner(threeKingdomsBanqiSeatToMove(state)),
      reason: 'no-legal-move',
    };
  }
  return { type: 'playing', turn: threeKingdomsBanqiSeatToMove(state) };
}

export function applyThreeKingdomsBanqiMove(
  state: ThreeKingdomsBanqiState,
  move: ThreeKingdomsBanqiMove,
): ThreeKingdomsBanqiState {
  if (
    !getThreeKingdomsBanqiLegalMoves(state).some(
      (candidate) => candidate.from === move.from && candidate.to === move.to,
    )
  )
    return state;
  const seat = threeKingdomsBanqiSeatToMove(state);
  const other = oppositeBanqiSeat(seat);
  const piece = state.board[move.from]!;
  const flip = move.from === move.to;
  const target = flip ? undefined : state.board[move.to];
  const board = { ...state.board };
  const scores = { ...state.scores };
  let captures = state.captures;
  let firstColor = state.firstColor;
  const chases: ThreeKingdomsBanqiState['chases'] = {};
  if (flip) {
    board[move.from] = { ...piece, faceDown: false };
    if (firstColor === null) firstColor = piece.color;
  } else {
    board[move.to] = { ...piece };
    delete board[move.from];
    if (target) {
      scores[seat] += THREE_KINGDOMS_BANQI_POINTS[target.role];
      captures = [...captures, { owner: target.color, role: target.role }];
    } else {
      const chase = chaseAfter(state, move);
      if (chase) chases[seat] = chase;
      const otherRun = state.chases[other];
      if (otherRun?.target === move.from) chases[other] = { ...otherRun, target: move.to };
      else if (
        otherRun &&
        state.lastMove &&
        boardDests(state.board, state.lastMove.to).includes(move.from)
      ) {
        // The opening threat also counts when another threatened piece flees.
        chases[other] = { target: move.to, count: 1 };
      }
    }
  }
  const ply = state.ply + 1;
  const next: ThreeKingdomsBanqiState = {
    ...state,
    board,
    firstColor,
    scores,
    captures,
    chases,
    ply,
    moveNumber: Math.floor(ply / 2) + 1,
    noProgressClock:
      flip || (target && THREE_KINGDOMS_BANQI_DEFAULTS.captureResetsNoProgress)
        ? 0
        : state.noProgressClock + 1,
    lastMove: { ...move },
    status: { type: 'playing', turn: oppositeBanqiSeat(seat) },
  };
  next.status = getThreeKingdomsBanqiResult(next);
  return next;
}

export function getThreeKingdomsBanqiPlayerView(
  state: ThreeKingdomsBanqiState,
  seat: BanqiSeat,
): ThreeKingdomsBanqiPlayerView {
  const board: ThreeKingdomsBanqiPlayerView['board'] = {};
  for (const square of ALL_THREE_KINGDOMS_BANQI_SQUARES) {
    const piece = state.board[square];
    if (piece)
      board[square] = piece.faceDown
        ? { faceDown: true }
        : { color: piece.color, role: piece.role, faceDown: false };
  }
  return {
    id: state.id,
    perspective: seat,
    board,
    status: { ...state.status },
    ply: state.ply,
    moveNumber: state.moveNumber,
    firstColor: state.firstColor,
    scores: { ...state.scores },
    noProgressClock: state.noProgressClock,
    captured: state.captures.map((capture) => ({ ...capture })),
    legalMoves:
      threeKingdomsBanqiSeatToMove(state) === seat ? getThreeKingdomsBanqiLegalMoves(state) : [],
    ...(state.lastMove ? { lastMove: { ...state.lastMove } } : {}),
  };
}

/** PUBLIC FEN-like snapshot, not a canonical save format. Top rank first;
 * X = hidden tile, UPPER/lower = revealed red/black. Then seat to move (r/b),
 * firstColor (r/b/-), red-seat score, black-seat score, clock, fullmove number.
 * Never includes a deal, seed, hidden identity field or per-square hidden pool.
 * Replay requires the server-secret initial deal + moves, not this projection.
 */
export function threeKingdomsBanqiStateToFen(state: ThreeKingdomsBanqiState): string {
  const rows: string[] = [];
  for (let rank = THREE_KINGDOMS_BANQI_HEIGHT; rank >= 1; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < THREE_KINGDOMS_BANQI_WIDTH; file += 1) {
      const piece = state.board[squareOf(file, rank)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      row += piece.faceDown ? 'X' : banqiPieceLetter(piece);
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${threeKingdomsBanqiSeatToMove(state)[0]} ${state.firstColor?.[0] ?? '-'} ${state.scores.red} ${state.scores.black} ${state.noProgressClock} ${state.moveNumber}`;
}
