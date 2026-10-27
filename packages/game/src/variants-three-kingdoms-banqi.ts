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
// A chase move may not make its resulting position appear for this many times.
export const THREE_KINGDOMS_BANQI_CHASE_REPETITION_LIMIT = 3;

/** Mistboard's decided rules for #628 (Brian, 2026-10-25). Gamesofa's app
 * level-locks the mode and its help has no Three Kingdoms section, so these are
 * our reasoned rules, not a transcription of theirs. Each is implemented here
 * once, so a later revision replaces one policy without touching its callers.
 * Evidence: docs-private/research/banqi-ruleset-2026-10/three-kingdoms-rules.md
 * § Decisions (2026-10-25). No alternate rulesets are exposed to players.
 */
export const THREE_KINGDOMS_BANQI_RULES = {
  // The general is ordinary: neither check nor facing generals restrict a move.
  generalSafety: (_state: ThreeKingdomsBanqiState, _move: ThreeKingdomsBanqiMove): boolean => true,
  // Rule 3: a face-down piece cannot be captured, by the cannon or anything else.
  // Its occupancy is public; its ink/role never affects move legality.
  faceDownTarget: (): boolean => false,
  // Rule 2: both a capture and a flip reset the 40-ply no-progress count.
  captureResetsNoProgress: true,
  flipResetsNoProgress: true,
  // Rule 1: a chase move is refused when its resulting position would appear
  // for the third time (see "Perpetual chase" below). `occurrences` counts the
  // resulting position including this move.
  chaseMoveAllowed: (occurrences: number): boolean =>
    occurrences < THREE_KINGDOMS_BANQI_CHASE_REPETITION_LIMIT,
  // Rule 5: a player with no legal move on their turn loses.
  noLegalMoveWinner: (seat: BanqiSeat): BanqiSeat | null => oppositeBanqiSeat(seat),
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
      // No 'no-pieces' reason: rule 4, wipe-out cannot happen (see getThreeKingdomsBanqiResult).
      reason: 'score' | 'no-progress' | 'no-legal-move';
    };
export type ThreeKingdomsBanqiState = {
  id: string;
  board: ThreeKingdomsBanqiBoard;
  status: ThreeKingdomsBanqiStatus;
  ply: number;
  moveNumber: number;
  firstColor: BanqiColor | null;
  // Scores are keyed by SEAT, never by ink.
  scores: Record<BanqiSeat, number>;
  noProgressClock: number;
  captures: BanqiCapture[];
  lastMove?: ThreeKingdomsBanqiMove;
  // The square of the piece the previous ply chased, if it was a chase move
  // (a mutual chase sets it too). Read only to classify the next move as a flee.
  chasedSquare?: ThreeKingdomsBanqiSquare;
  // Occurrences of each position since the last flip or capture, keyed by
  // threeKingdomsBanqiPositionKey. Public: it is a function of the move list.
  repCounts: Record<string, number>;
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
    repCounts: {},
  };
}

export function threeKingdomsBanqiSeatToMove(
  state: Pick<ThreeKingdomsBanqiState, 'ply'>,
): BanqiSeat {
  return state.ply % 2 === 0 ? 'red' : 'black';
}

/** Ordinary piece geometry only: no royal general, check, palace or river
 * (THREE_KINGDOMS_BANQI_RULES.generalSafety). All revealed enemies are capturable.
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
    (target.faceDown ? THREE_KINGDOMS_BANQI_RULES.faceDownTarget() : target.color !== piece.color);

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

// ── Perpetual chase (rule 1) ─────────────────────────────────────────────────
//
// Ported from mistboard banqi's 長捉 rule (variants-banqi.ts, "Perpetual chase"),
// with this variant's capture test: any face-up piece captures any face-up enemy
// it can reach under the 9x5 geometry below (no rank ladder).
//
// A CHASE MOVE is a quiet move (no flip, no capture) after which the moved piece
// could capture the enemy piece that moved on the previous ply. Whether that
// target is protected does not matter. A FLEE is a move of the piece the previous
// ply chased. A move that is both (the chased piece steps to a square from which
// it threatens its chaser, 一捉一) is an ordinary move. The threat test reads only
// face-up pieces and square occupancy, both public, so the rule leaks nothing.
//
// The rule: a chase move that would make its resulting position appear for the
// third time is illegal, unless the side to move has no other legal move (flips
// count as legal moves). Only the chaser is limited: a flee, a mutual chase and
// every other move are never restricted, and a chase that herds its target onto
// new squares never repeats, so it is never limited.
//
// Three Kingdoms has NO repetition draw. Banqi's clause 2 (which repetitions end
// the game) is not imported: an ordinary repetition does not end the game, it runs
// on until the 40-ply no-progress count settles it on score. Positions are counted
// only to enforce the chase restriction.

/** `board` after the quiet move `move` (no flip, no capture). */
function boardAfterQuietMove(
  board: ThreeKingdomsBanqiBoard,
  move: ThreeKingdomsBanqiMove,
): ThreeKingdomsBanqiBoard {
  const next: ThreeKingdomsBanqiBoard = { ...board, [move.to]: board[move.from] };
  delete next[move.from];
  return next;
}

/**
 * If `move` is a chase move in `state`, the square of the piece it chases (the
 * enemy piece that moved on the previous ply); else null. `move` must be legal.
 */
function chaseTargetOf(
  state: ThreeKingdomsBanqiState,
  move: ThreeKingdomsBanqiMove,
): ThreeKingdomsBanqiSquare | null {
  if (move.from === move.to) return null; // flip
  if (state.board[move.to]) return null; // capture
  const last = state.lastMove;
  if (!last || last.from === last.to) return null; // nothing moved last ply
  const board = boardAfterQuietMove(state.board, move);
  // boardDests only lands on empty points and face-up enemies, so a hit on the
  // occupied last.to is exactly "could capture it".
  return boardDests(board, move.to).includes(last.to) ? last.to : null;
}

/** How `move` relates to a chase: the two kinds the rule singles out, or neither. */
function chaseKindOf(
  state: ThreeKingdomsBanqiState,
  move: ThreeKingdomsBanqiMove,
): 'chase' | 'flee' | null {
  const chases = chaseTargetOf(state, move) !== null;
  const flees = state.chasedSquare !== undefined && move.from === state.chasedSquare;
  if (chases === flees) return null; // neither, or a mutual chase (ordinary move)
  return chases ? 'chase' : 'flee';
}

/**
 * The repetition key: every square (face-down tiles as 'x', so the deal is
 * excluded), the seat to move and the colour binding. Scores and captures are
 * left out because the count restarts at every flip and capture: a capture
 * removes a piece and a flip removes a face-down tile, so no earlier position
 * can recur, and within one window the scores are fixed.
 */
export function threeKingdomsBanqiPositionKey(
  state: Pick<ThreeKingdomsBanqiState, 'board' | 'ply' | 'firstColor'>,
): string {
  const squares = ALL_THREE_KINGDOMS_BANQI_SQUARES.map((square) => {
    const piece = state.board[square];
    if (!piece) return '.';
    return piece.faceDown ? 'x' : banqiPieceLetter(piece);
  }).join('');
  return `${squares}|${state.ply % 2}|${state.firstColor ?? '?'}`;
}

/** Chase moves (from `moves`) the repetition limit refuses. */
function forbiddenChaseMoves(
  state: ThreeKingdomsBanqiState,
  moves: ThreeKingdomsBanqiMove[],
): ThreeKingdomsBanqiMove[] {
  return moves.filter((move) => {
    if (chaseKindOf(state, move) !== 'chase') return false;
    const key = threeKingdomsBanqiPositionKey({
      board: boardAfterQuietMove(state.board, move),
      ply: state.ply + 1,
      firstColor: state.firstColor,
    });
    return !THREE_KINGDOMS_BANQI_RULES.chaseMoveAllowed((state.repCounts[key] ?? 0) + 1);
  });
}

function enumerateThreeKingdomsBanqiMoves(
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
        if (THREE_KINGDOMS_BANQI_RULES.generalSafety(state, move)) moves.push(move);
      }
    }
  }
  return moves;
}

/**
 * The moves rule 1 takes away from the side to move right now: empty when none,
 * or when they are its only moves and so stay legal.
 */
export function getThreeKingdomsBanqiForbiddenChaseMoves(
  state: ThreeKingdomsBanqiState,
): ThreeKingdomsBanqiMove[] {
  const moves = enumerateThreeKingdomsBanqiMoves(state);
  const forbidden = forbiddenChaseMoves(state, moves);
  return forbidden.length < moves.length ? forbidden : [];
}

export function getThreeKingdomsBanqiLegalMoves(
  state: ThreeKingdomsBanqiState,
): ThreeKingdomsBanqiMove[] {
  const moves = enumerateThreeKingdomsBanqiMoves(state);
  const forbidden = forbiddenChaseMoves(state, moves);
  if (forbidden.length === 0) return moves;
  const allowed = moves.filter((move) => !forbidden.includes(move));
  // The only-move exception: if repeating the chase is all the side can do, it stays legal.
  return allowed.length > 0 ? allowed : moves;
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
  // Rule 4, wipe-out cannot happen, so there is no elimination check. A side
  // loses pieces only to enemy captures, each scoring for the captor, and its
  // sixteen pieces total 135. The thirteen cheapest total 85, so the fourteenth
  // capture of one side's pieces always reaches 100 and ends the game before the
  // sixteenth could be taken. (A hand-built board with no pieces for one side
  // just reaches the no-legal-move rule below.)
  if (getThreeKingdomsBanqiLegalMoves(state).length === 0) {
    return {
      type: 'finished',
      winner: THREE_KINGDOMS_BANQI_RULES.noLegalMoveWinner(threeKingdomsBanqiSeatToMove(state)),
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
  if (flip) {
    board[move.from] = { ...piece, faceDown: false };
    if (firstColor === null) firstColor = piece.color;
  } else {
    board[move.to] = { ...piece };
    delete board[move.from];
    if (target) {
      scores[seat] += THREE_KINGDOMS_BANQI_POINTS[target.role];
      captures = [...captures, { owner: target.color, role: target.role }];
    }
  }
  // A flip or capture can never be undone, so it opens a fresh repetition window.
  const irreversible = flip || target !== undefined;
  const chased = irreversible ? null : chaseTargetOf(state, move);
  const ply = state.ply + 1;
  const next: ThreeKingdomsBanqiState = {
    ...state,
    board,
    firstColor,
    scores,
    captures,
    repCounts: irreversible ? {} : { ...state.repCounts },
    ply,
    moveNumber: Math.floor(ply / 2) + 1,
    noProgressClock:
      (flip && THREE_KINGDOMS_BANQI_RULES.flipResetsNoProgress) ||
      (target && THREE_KINGDOMS_BANQI_RULES.captureResetsNoProgress)
        ? 0
        : state.noProgressClock + 1,
    lastMove: { ...move },
    status: { type: 'playing', turn: other },
  };
  delete next.chasedSquare;
  if (chased !== null) next.chasedSquare = chased;
  const key = threeKingdomsBanqiPositionKey(next);
  next.repCounts[key] = (next.repCounts[key] ?? 0) + 1;
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
