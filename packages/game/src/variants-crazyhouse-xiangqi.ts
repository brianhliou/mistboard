// Crazyhouse Xiangqi: xiangqi where a captured piece changes sides, and the
// advisors and elephants start in hand.
//
// The rules, on top of xiangqi:
//
//   - the start: each side's advisors and elephants begin in hand (two of
//     each), so the back rank reads chariot, horse, empty, empty, general,
//     empty, empty, horse, chariot; every other piece stands where it does in
//     xiangqi;
//   - a captured piece goes to the capturer's hand, and on your turn you may
//     instead drop a piece from your hand onto an empty point:
//       - advisors and elephants: any point of your own half;
//       - chariots, horses, cannons and soldiers: any empty point (a soldier
//         dropped on its own half steps forward from there, as if it had
//         walked; 2026-10-03, replacing the soldier files' home ranks);
//       - the general is never in hand (it is mated, never taken);
//   - advisors move one diagonal step and elephants two (the eye blocks, as in
//     xiangqi), anywhere on their own half; neither ever crosses the river;
//   - a drop may give check, and mate;
//   - no nifu: any number of soldiers may share a file.
//
// Everything else is xiangqi: the general stays in its palace, the generals
// may not face, you may not leave your general attacked, checkmate and
// stalemate both lose for the side with no move, and a three-fold repetition
// is a draw unless one side checked on every move of the cycle, which loses
// ('chasing', as standard xiangqi spells it). Repetition counts whole
// positions, hands included; a capture does not reset it, because a captured
// piece can be dropped back and the position rebuilt.
//
// The lab name is s9-hand-free-check (docs-private/drop-game-lab/fullboard/,
// Sweeps 9-11); it replaced "one-sentence C" (standard start, palace-bound
// advisors, no drop check) on 2026-10-02. The engine is stock Fairy-Stockfish
// with apps/server/src/crazyhouse-xiangqi.ini;
// packages/game/src/fixtures/crazyhouse-xiangqi-parity.json holds its legal
// moves and perft-2 counts over real game positions, and the test beside this
// file requires this kernel to agree at every one of them.
//
// Geometry is the configurable rule kernel's (xiangqi-rule-kernel.ts) with
// advisors freed to the own half: piece moves, regions, the placement codec.
// This module adds the hands, the drops, a fast reverse attack test (the
// kernel's forward one is too slow to filter ~300 drops a position), and the
// production shape: an abortable status, the end reasons persistence knows,
// a player view.

import type { AbortReason } from './types.js';
import type {
  XiangqiBoard,
  XiangqiColor,
  XiangqiMove,
  XiangqiPiece,
  XiangqiPieceRole,
  XiangqiSquare,
} from './variants-xiangqi.js';
import {
  allXiangqiSquares,
  coordOf,
  inBounds,
  inOwnHalf,
  inPalace,
  parsePlacement,
  placementOf,
  pseudoMovesFrom,
  resolveXiangqiRules,
  squareOf,
} from './xiangqi-rule-kernel.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type CrazyhouseXiangqiColor = XiangqiColor;
export type CrazyhouseXiangqiSquare = XiangqiSquare;
export type CrazyhouseXiangqiBoard = XiangqiBoard;
export type CrazyhouseXiangqiBoardMove = XiangqiMove;

/** Every role but the general can be captured into hand and dropped back. */
export type CrazyhouseXiangqiDropRole = Exclude<XiangqiPieceRole, 'general'>;

export type CrazyhouseXiangqiDropMove = {
  drop: CrazyhouseXiangqiDropRole;
  to: CrazyhouseXiangqiSquare;
};

export type CrazyhouseXiangqiMove = CrazyhouseXiangqiBoardMove | CrazyhouseXiangqiDropMove;

export type CrazyhouseXiangqiHand = Partial<Record<CrazyhouseXiangqiDropRole, number>>;
export type CrazyhouseXiangqiHands = Record<CrazyhouseXiangqiColor, CrazyhouseXiangqiHand>;

/** What legality depends on: the board, both hands, the side to move. */
export type CrazyhouseXiangqiPosition = {
  board: CrazyhouseXiangqiBoard;
  hands: CrazyhouseXiangqiHands;
  turn: CrazyhouseXiangqiColor;
};

/**
 * A subset of XiangqiGameEndReason on purpose, so the xiangqi board, postgame
 * and persistence map read a crazyhouse game as they read a xiangqi one.
 */
export type CrazyhouseXiangqiGameEndReason =
  | 'checkmate'
  // Xiangqi: the side with no legal move loses.
  | 'stalemate'
  // Three-fold repetition, drawn.
  | 'repetition'
  // Three-fold repetition where one side checked on every move of the cycle:
  // that side loses. Spelled as standard xiangqi spells it.
  | 'chasing'
  // Sixty plies without a capture.
  | 'progress-clock'
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export type CrazyhouseXiangqiGameStatus =
  | { type: 'playing'; turn: CrazyhouseXiangqiColor }
  | {
      type: 'finished';
      winner: CrazyhouseXiangqiColor | null;
      reason: CrazyhouseXiangqiGameEndReason;
    }
  | { type: 'aborted'; reason: AbortReason };

export type CrazyhouseXiangqiGameState = {
  id: string;
  board: CrazyhouseXiangqiBoard;
  hands: CrazyhouseXiangqiHands;
  status: CrazyhouseXiangqiGameStatus;
  /** Full moves, incremented after black's move; starts at 1. */
  moveNumber: number;
  /** Plies played. */
  ply: number;
  /** Plies since the last capture. */
  progressClock: number;
  lastMove?: CrazyhouseXiangqiMove;
  /** Occurrences of each position (board, hands, side to move) this game. */
  positionCounts: Record<string, number>;
  /**
   * Every position of the game, oldest first, each with whether the move that
   * produced it gave check. The perpetual-check law reads the cycle from here.
   */
  history: { key: string; check: boolean }[];
};

/** Perfect information: the whole truth, shaped for a client. */
export type CrazyhouseXiangqiPlayerView = {
  id: string;
  perspective: CrazyhouseXiangqiColor;
  board: CrazyhouseXiangqiBoard;
  hands: CrazyhouseXiangqiHands;
  /** For the side to move, whoever is asking. */
  legalMoves: CrazyhouseXiangqiMove[];
  /** The perspective's general is attacked. */
  inCheck: boolean;
  status: CrazyhouseXiangqiGameStatus;
  moveNumber: number;
  lastMove?: CrazyhouseXiangqiMove;
};

// ── Constants ──────────────────────────────────────────────────────────────

/** Display and FEN order for a hand: xiangqi's R N B A C P. */
export const CRAZYHOUSE_XIANGQI_DROP_ROLES = [
  'chariot',
  'horse',
  'elephant',
  'advisor',
  'cannon',
  'soldier',
] as const satisfies readonly CrazyhouseXiangqiDropRole[];

/** The start placement: xiangqi without its advisors and elephants, which begin in hand. */
const START_PLACEMENT = 'rn2k2nr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RN2K2NR';

/** Each side's hand at the start. */
const START_HAND: CrazyhouseXiangqiHand = { elephant: 2, advisor: 2 };

/** The start as crazyhouseXiangqiFen writes it (pocket in R N B A C P order). */
export const CRAZYHOUSE_XIANGQI_START_FEN = `${START_PLACEMENT}[BBAAbbaa] w - - 0 1`;

/** Plies without a capture before the game is drawn: the site's xiangqi rule. */
export const CRAZYHOUSE_XIANGQI_PROGRESS_CLOCK_LIMIT = 60;

/** Occurrences of one position (board, hands, side to move) that end the game. */
export const CRAZYHOUSE_XIANGQI_REPETITION_COUNT = 3;

/**
 * The geometry every move here uses: xiangqi's, except that an advisor steps
 * diagonally anywhere on its own half instead of only in its palace. The
 * elephant's region is already the own half; only the general keeps a palace.
 */
const RULES = resolveXiangqiRules({ advisorRegion: 'ownHalf' });

const SQUARES = allXiangqiSquares();

/** Square name by [file][rank], so the attack test never builds a string. */
const SQ: readonly (readonly XiangqiSquare[])[] = Array.from({ length: 9 }, (_, file) =>
  Array.from({ length: 11 }, (_, rank) =>
    rank >= 1 ? squareOf(file, rank) : ('' as XiangqiSquare),
  ),
);

const ORTHO: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
/** [df, dr, legDf, legDr]: a horse's jump and the leg that hobbles it. */
const HORSE: readonly (readonly [number, number, number, number])[] = [
  [1, 2, 0, 1],
  [-1, 2, 0, 1],
  [1, -2, 0, -1],
  [-1, -2, 0, -1],
  [2, 1, 1, 0],
  [2, -1, 1, 0],
  [-2, 1, -1, 0],
  [-2, -1, -1, 0],
];

// ── Colours, moves, regions ────────────────────────────────────────────────

export function oppositeCrazyhouseXiangqiColor(
  color: CrazyhouseXiangqiColor,
): CrazyhouseXiangqiColor {
  return color === 'red' ? 'black' : 'red';
}

export function isCrazyhouseXiangqiDropMove(
  move: CrazyhouseXiangqiMove,
): move is CrazyhouseXiangqiDropMove {
  return 'drop' in move;
}

/**
 * Could a `color` piece of `role` stand on `square` in this game? This is
 * the drop rule, and the bar the FEN parser holds a position to: the general
 * in its palace, advisors and elephants anywhere on their own half, soldiers
 * on the points a soldier can reach, everything else anywhere.
 */
export function crazyhouseXiangqiCanStand(
  role: XiangqiPieceRole,
  color: CrazyhouseXiangqiColor,
  square: CrazyhouseXiangqiSquare,
): boolean {
  switch (role) {
    case 'general': {
      const { file, rank } = coordOf(square);
      return inPalace(color, file, rank);
    }
    case 'advisor':
    case 'elephant':
      return inOwnHalf(color, coordOf(square).rank);
    default:
      return true;
  }
}

/** The points a `role` may be dropped on by `color`, empty or not. */
export function crazyhouseXiangqiDropRegion(
  role: CrazyhouseXiangqiDropRole,
  color: CrazyhouseXiangqiColor,
): CrazyhouseXiangqiSquare[] {
  return SQUARES.filter((square) => crazyhouseXiangqiCanStand(role, color, square));
}

// ── Engine dialect (Fairy-Stockfish) ───────────────────────────────────────

const ROLE_LETTER: Record<XiangqiPieceRole, string> = {
  general: 'K',
  advisor: 'A',
  elephant: 'B',
  horse: 'N',
  chariot: 'R',
  cannon: 'C',
  soldier: 'P',
};
const LETTER_DROP_ROLE: Record<string, CrazyhouseXiangqiDropRole> = {
  A: 'advisor',
  B: 'elephant',
  N: 'horse',
  R: 'chariot',
  C: 'cannon',
  P: 'soldier',
};

const UCI_BOARD = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;
const UCI_DROP = /^([ABNRCP])@([a-i](?:10|[1-9]))$/;

/** Board moves as from+to; drops as Fairy-Stockfish writes them, `P@e5` for either side. */
export function crazyhouseXiangqiMoveToUci(move: CrazyhouseXiangqiMove): string {
  return isCrazyhouseXiangqiDropMove(move)
    ? `${ROLE_LETTER[move.drop]}@${move.to}`
    : `${move.from}${move.to}`;
}

/** Inverse of crazyhouseXiangqiMoveToUci. Parse only, no legality. */
export function crazyhouseXiangqiMoveFromUci(uci: string): CrazyhouseXiangqiMove | null {
  const drop = UCI_DROP.exec(uci);
  if (drop) return { drop: LETTER_DROP_ROLE[drop[1]!]!, to: drop[2] as XiangqiSquare };
  const board = UCI_BOARD.exec(uci);
  if (board) return { from: board[1] as XiangqiSquare, to: board[2] as XiangqiSquare };
  return null;
}

function pocketOf(hands: CrazyhouseXiangqiHands): string {
  let out = '';
  for (const color of ['red', 'black'] as const) {
    for (const role of CRAZYHOUSE_XIANGQI_DROP_ROLES) {
      const letter = ROLE_LETTER[role];
      out += (color === 'red' ? letter : letter.toLowerCase()).repeat(hands[color][role] ?? 0);
    }
  }
  return out;
}

/**
 * Fairy-Stockfish FEN for the crazyhousexiangqi variant: the placement, the
 * pocket in brackets (always present, `[]` when both hands are empty, as the
 * .ini's startFen writes it), the side to move, the plies since the last
 * capture and the move number.
 */
export function crazyhouseXiangqiFen(state: CrazyhouseXiangqiGameState): string {
  const turn = state.status.type === 'playing' && state.status.turn === 'black' ? 'b' : 'w';
  return `${placementOf(state.board)}[${pocketOf(state.hands)}] ${turn} - - ${state.progressClock} ${state.moveNumber}`;
}

/** The repetition key: board, both hands, side to move. */
export function crazyhouseXiangqiPositionKey(position: CrazyhouseXiangqiPosition): string {
  return `${placementOf(position.board)}[${pocketOf(position.hands)}] ${position.turn === 'red' ? 'w' : 'b'}`;
}

export type ParseCrazyhouseXiangqiFenResult =
  | { ok: true; state: CrazyhouseXiangqiGameState }
  | { ok: false; error: string };

/** Copies of each role across both sets: a capture changes a piece's owner, not its count. */
const ROLE_SUPPLY: Record<XiangqiPieceRole, number> = {
  general: 2,
  advisor: 4,
  elephant: 4,
  horse: 4,
  chariot: 4,
  cannon: 4,
  soldier: 10,
};

/**
 * Inverse of crazyhouseXiangqiFen. Rejects what play can never produce: a
 * piece on a point it could not stand on, more copies of a role than the two
 * sets hold (board and hands together), a general in hand, facing generals,
 * and a side not to move whose general is attacked.
 */
export function parseCrazyhouseXiangqiFen(
  fen: string,
  gameId = 'fen-import',
): ParseCrazyhouseXiangqiFenResult {
  const fields = fen.trim().split(/\s+/);
  const first = fields[0];
  if (!first) return { ok: false, error: 'Empty FEN.' };
  let placement = first;
  let pocketText = '';
  const bracket = first.indexOf('[');
  if (bracket >= 0) {
    if (!first.endsWith(']')) return { ok: false, error: 'Unclosed "[" in the pocket field.' };
    placement = first.slice(0, bracket);
    pocketText = first.slice(bracket + 1, -1);
  }
  const board = parsePlacement(placement);
  if (!board) return { ok: false, error: 'The placement is not a 9x10 xiangqi board.' };

  const supply: Partial<Record<XiangqiPieceRole, number>> = {};
  const generals: Partial<Record<CrazyhouseXiangqiColor, number>> = {};
  for (const square of SQUARES) {
    const piece = board[square];
    if (!piece) continue;
    if (!crazyhouseXiangqiCanStand(piece.role, piece.color, square)) {
      return { ok: false, error: `A ${piece.color} ${piece.role} cannot stand on ${square}.` };
    }
    if (piece.role === 'general') generals[piece.color] = (generals[piece.color] ?? 0) + 1;
    supply[piece.role] = (supply[piece.role] ?? 0) + 1;
  }
  for (const color of ['red', 'black'] as const) {
    if (generals[color] !== 1) return { ok: false, error: `Expected one ${color} general.` };
  }

  const hands = emptyHands();
  for (const ch of pocketText) {
    const upper = ch.toUpperCase();
    if (upper === 'K') return { ok: false, error: 'A general can never be in hand.' };
    const role = LETTER_DROP_ROLE[upper];
    if (!role) return { ok: false, error: `Unknown pocket piece "${ch}".` };
    const color: CrazyhouseXiangqiColor = ch === upper ? 'red' : 'black';
    hands[color][role] = (hands[color][role] ?? 0) + 1;
    supply[role] = (supply[role] ?? 0) + 1;
  }
  for (const [role, count] of Object.entries(supply)) {
    const max = ROLE_SUPPLY[role as XiangqiPieceRole];
    if (count > max) {
      return { ok: false, error: `Too many ${role}s: ${count} on board and in hand (max ${max}).` };
    }
  }

  const turnToken = fields[1] ?? 'w';
  let turn: CrazyhouseXiangqiColor;
  if (turnToken === 'w' || turnToken === 'r') turn = 'red';
  else if (turnToken === 'b') turn = 'black';
  else return { ok: false, error: `Unknown side to move "${turnToken}" (expected w/r or b).` };

  const kings = generalSquares(board);
  if (generalsFaceAt(board, kings.red!, kings.black!)) {
    return { ok: false, error: 'The generals face each other on an open file.' };
  }
  const waiting = oppositeCrazyhouseXiangqiColor(turn);
  if (attackedBy(board, turn, kings[waiting]!)) {
    return {
      ok: false,
      error: `Illegal position: the ${waiting} general is in check with ${turn} to move.`,
    };
  }

  const progressField = fields[4];
  const moveField = fields[5];
  const progressClock = progressField && /^\d+$/.test(progressField) ? Number(progressField) : 0;
  const moveNumber =
    moveField && /^\d+$/.test(moveField) && Number(moveField) >= 1 ? Number(moveField) : 1;
  return {
    ok: true,
    state: stateFrom(gameId, board, hands, turn, progressClock, moveNumber),
  };
}

// ── State ──────────────────────────────────────────────────────────────────

function emptyHands(): CrazyhouseXiangqiHands {
  return { red: {}, black: {} };
}

function cloneHands(hands: CrazyhouseXiangqiHands): CrazyhouseXiangqiHands {
  return { red: { ...hands.red }, black: { ...hands.black } };
}

function stateFrom(
  id: string,
  board: CrazyhouseXiangqiBoard,
  hands: CrazyhouseXiangqiHands,
  turn: CrazyhouseXiangqiColor,
  progressClock: number,
  moveNumber: number,
): CrazyhouseXiangqiGameState {
  const key = crazyhouseXiangqiPositionKey({ board, hands, turn });
  return {
    id,
    board,
    hands,
    status: { type: 'playing', turn },
    moveNumber,
    ply: (moveNumber - 1) * 2 + (turn === 'black' ? 1 : 0),
    progressClock,
    positionCounts: { [key]: 1 },
    history: [{ key, check: false }],
  };
}

export function createInitialCrazyhouseXiangqiState(gameId: string): CrazyhouseXiangqiGameState {
  const board = parsePlacement(START_PLACEMENT);
  if (!board) throw new Error('crazyhouse-xiangqi: bad start placement');
  return stateFrom(
    gameId,
    board,
    { red: { ...START_HAND }, black: { ...START_HAND } },
    'red',
    0,
    1,
  );
}

function positionOf(state: CrazyhouseXiangqiGameState): CrazyhouseXiangqiPosition | null {
  if (state.status.type !== 'playing') return null;
  return { board: state.board, hands: state.hands, turn: state.status.turn };
}

// ── Attack ─────────────────────────────────────────────────────────────────

type Kings = Partial<Record<CrazyhouseXiangqiColor, XiangqiSquare>>;

function generalSquares(board: CrazyhouseXiangqiBoard): Kings {
  const out: Kings = {};
  for (const [square, piece] of Object.entries(board) as [
    XiangqiSquare,
    XiangqiPiece | undefined,
  ][]) {
    if (piece?.role === 'general') out[piece.color] = square;
  }
  return out;
}

function at(board: CrazyhouseXiangqiBoard, file: number, rank: number): XiangqiPiece | undefined {
  return board[SQ[file]![rank]!];
}

/**
 * Is `target` attacked by a piece of `by`? Looks outward from the target for
 * each way a xiangqi piece can reach it, which is what makes filtering every
 * drop affordable. Same answers as the rule kernel's isAttacked (piece moves
 * only; facing generals are a separate rule).
 */
function attackedBy(
  board: CrazyhouseXiangqiBoard,
  by: CrazyhouseXiangqiColor,
  target: XiangqiSquare,
): boolean {
  const { file: tf, rank: tr } = coordOf(target);
  // Chariot (first piece on a line), cannon (second), general (adjacent, in its palace).
  for (const [df, dr] of ORTHO) {
    let f = tf + df;
    let r = tr + dr;
    let screened = false;
    while (inBounds(f, r)) {
      const piece = at(board, f, r);
      if (piece) {
        if (!screened) {
          if (piece.color === by) {
            if (piece.role === 'chariot') return true;
            if (piece.role === 'general' && f === tf + df && r === tr + dr && inPalace(by, tf, tr))
              return true;
          }
          screened = true;
        } else {
          if (piece.color === by && piece.role === 'cannon') return true;
          break;
        }
      }
      f += df;
      r += dr;
    }
  }
  // Horse: it stands a jump away and its leg, beside it towards the target, is empty.
  for (const [df, dr, legDf, legDr] of HORSE) {
    const hf = tf - df;
    const hr = tr - dr;
    if (!inBounds(hf, hr)) continue;
    const piece = at(board, hf, hr);
    if (piece?.color !== by || piece.role !== 'horse') continue;
    if (!at(board, hf + legDf, hr + legDr)) return true;
  }
  // Soldier: from behind the target, or beside it once across the river.
  const forward = by === 'red' ? 1 : -1;
  if (inBounds(tf, tr - forward)) {
    const piece = at(board, tf, tr - forward);
    if (piece?.color === by && piece.role === 'soldier') return true;
  }
  const crossed = by === 'red' ? tr >= 6 : tr <= 5;
  if (crossed) {
    for (const df of [-1, 1]) {
      if (!inBounds(tf + df, tr)) continue;
      const piece = at(board, tf + df, tr);
      if (piece?.color === by && piece.role === 'soldier') return true;
    }
  }
  // Advisor and elephant, for completeness: neither leaves its own half, so
  // neither can reach an enemy general.
  if (inOwnHalf(by, tr)) {
    for (const [df, dr] of DIAG) {
      if (!inBounds(tf + df, tr + dr)) continue;
      const piece = at(board, tf + df, tr + dr);
      if (piece?.color === by && piece.role === 'advisor') return true;
    }
  }
  if (inOwnHalf(by, tr)) {
    for (const [df, dr] of DIAG) {
      if (!inBounds(tf + 2 * df, tr + 2 * dr)) continue;
      const piece = at(board, tf + 2 * df, tr + 2 * dr);
      if (piece?.color !== by || piece.role !== 'elephant') continue;
      if (!at(board, tf + df, tr + dr)) return true;
    }
  }
  return false;
}

function generalsFaceAt(
  board: CrazyhouseXiangqiBoard,
  red: XiangqiSquare,
  black: XiangqiSquare,
): boolean {
  const a = coordOf(red);
  const b = coordOf(black);
  if (a.file !== b.file) return false;
  for (let rank = a.rank + 1; rank < b.rank; rank += 1) if (at(board, a.file, rank)) return false;
  return true;
}

/** Is `color`'s general attacked on `board`? */
export function isCrazyhouseXiangqiGeneralInCheck(
  board: CrazyhouseXiangqiBoard,
  color: CrazyhouseXiangqiColor,
): boolean {
  const general = generalSquares(board)[color];
  return general !== undefined && attackedBy(board, oppositeCrazyhouseXiangqiColor(color), general);
}

// ── Legal moves ────────────────────────────────────────────────────────────

/**
 * Can a piece on `square` change whether the general on `general` is
 * attacked? Only on the general's file or rank (a line piece, a block, a
 * cannon screen) or within two points of it (a horse, its leg, a soldier, an
 * advisor, an elephant and its eye). Anywhere else a drop leaves every attack
 * on that general as it was.
 */
function nearGeneral(square: XiangqiSquare, general: XiangqiSquare): boolean {
  const a = coordOf(square);
  const b = coordOf(general);
  return (
    a.file === b.file ||
    a.rank === b.rank ||
    (Math.abs(a.file - b.file) <= 2 && Math.abs(a.rank - b.rank) <= 2)
  );
}

function legalBoardMoves(
  position: CrazyhouseXiangqiPosition,
  kings: Kings,
  from?: XiangqiSquare,
): CrazyhouseXiangqiBoardMove[] {
  const { board, turn } = position;
  const enemy = oppositeCrazyhouseXiangqiColor(turn);
  const own = kings[turn];
  const theirs = kings[enemy];
  if (!own || !theirs) return [];
  const out: CrazyhouseXiangqiBoardMove[] = [];
  // One working copy, moved and restored per candidate.
  const work: Record<string, XiangqiPiece | undefined> = { ...board };
  const origins = from ? [from] : (Object.keys(board) as XiangqiSquare[]);
  for (const origin of origins) {
    const piece = board[origin];
    if (!piece || piece.color !== turn) continue;
    for (const to of pseudoMovesFrom(board, origin, RULES)) {
      const captured = work[to];
      // A general is mated, never taken; legal play never offers it.
      if (captured?.role === 'general') continue;
      work[to] = piece;
      work[origin] = undefined;
      const ownAt = piece.role === 'general' ? to : own;
      const legal =
        !(turn === 'red'
          ? generalsFaceAt(work as XiangqiBoard, ownAt, theirs)
          : generalsFaceAt(work as XiangqiBoard, theirs, ownAt)) &&
        !attackedBy(work as XiangqiBoard, enemy, ownAt);
      work[origin] = piece;
      work[to] = captured;
      if (legal) out.push({ from: origin, to });
    }
  }
  return out;
}

function legalDrops(
  position: CrazyhouseXiangqiPosition,
  kings: Kings,
  only?: CrazyhouseXiangqiDropRole,
): CrazyhouseXiangqiDropMove[] {
  const { board, hands, turn } = position;
  const enemy = oppositeCrazyhouseXiangqiColor(turn);
  const own = kings[turn];
  if (!own || !kings[enemy]) return [];
  const roles = CRAZYHOUSE_XIANGQI_DROP_ROLES.filter(
    (role) => (hands[turn][role] ?? 0) > 0 && (only === undefined || role === only),
  );
  if (roles.length === 0) return [];
  const inCheck = attackedBy(board, enemy, own);
  const out: CrazyhouseXiangqiDropMove[] = [];
  const work: Record<string, XiangqiPiece | undefined> = { ...board };
  for (const square of SQUARES) {
    if (board[square]) continue;
    const nearOwn = nearGeneral(square, own);
    // Away from your own general, a drop cannot parry a check, nor expose one.
    if (inCheck && !nearOwn) continue;
    for (const role of roles) {
      if (!crazyhouseXiangqiCanStand(role, turn, square)) continue;
      // Near it, the drop must not leave your general attacked: it must parry
      // a check, and must not become the screen for an enemy cannon. A drop
      // that gives check, or mates, is legal.
      if (nearOwn) {
        work[square] = { color: turn, role };
        const exposed = attackedBy(work as XiangqiBoard, enemy, own);
        work[square] = undefined;
        if (exposed) continue;
      }
      out.push({ drop: role, to: square });
    }
  }
  return out;
}

/** Every legal move in a position: board moves first, then drops. */
export function crazyhouseXiangqiLegalMovesOn(
  position: CrazyhouseXiangqiPosition,
): CrazyhouseXiangqiMove[] {
  const kings = generalSquares(position.board);
  return [...legalBoardMoves(position, kings), ...legalDrops(position, kings)];
}

/** The position after `move`, captured piece in hand. Does not check legality. */
export function crazyhouseXiangqiPositionAfter(
  position: CrazyhouseXiangqiPosition,
  move: CrazyhouseXiangqiMove,
): CrazyhouseXiangqiPosition & { captured?: XiangqiPiece } {
  const { board, turn } = position;
  const hands = cloneHands(position.hands);
  const next: CrazyhouseXiangqiBoard = { ...board };
  const nextTurn = oppositeCrazyhouseXiangqiColor(turn);
  if (isCrazyhouseXiangqiDropMove(move)) {
    const count = (hands[turn][move.drop] ?? 0) - 1;
    if (count > 0) hands[turn][move.drop] = count;
    else delete hands[turn][move.drop];
    next[move.to] = { color: turn, role: move.drop };
    return { board: next, hands, turn: nextTurn };
  }
  const piece = board[move.from];
  if (!piece) throw new Error(`crazyhouse-xiangqi: no piece on ${move.from}`);
  const captured = board[move.to];
  delete next[move.from];
  next[move.to] = piece;
  if (captured) {
    if (captured.role === 'general')
      throw new Error('crazyhouse-xiangqi: a general is never taken');
    hands[turn][captured.role] = (hands[turn][captured.role] ?? 0) + 1;
    return { board: next, hands, turn: nextTurn, captured };
  }
  return { board: next, hands, turn: nextTurn };
}

/** Leaf count of the legal-move tree to `depth`, for the engine parity test. */
export function crazyhouseXiangqiPerft(position: CrazyhouseXiangqiPosition, depth: number): number {
  if (depth <= 0) return 1;
  const moves = crazyhouseXiangqiLegalMovesOn(position);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const move of moves) {
    total += crazyhouseXiangqiPerft(crazyhouseXiangqiPositionAfter(position, move), depth - 1);
  }
  return total;
}

export function getCrazyhouseXiangqiLegalMoves(
  state: CrazyhouseXiangqiGameState,
): CrazyhouseXiangqiMove[] {
  const position = positionOf(state);
  return position ? crazyhouseXiangqiLegalMovesOn(position) : [];
}

export function getCrazyhouseXiangqiLegalMovesFrom(
  state: CrazyhouseXiangqiGameState,
  from: CrazyhouseXiangqiSquare,
): CrazyhouseXiangqiBoardMove[] {
  const position = positionOf(state);
  if (!position) return [];
  return legalBoardMoves(position, generalSquares(position.board), from);
}

/** The legal drops of one role (or every role) for the side to move. */
export function getCrazyhouseXiangqiLegalDrops(
  state: CrazyhouseXiangqiGameState,
  role?: CrazyhouseXiangqiDropRole,
): CrazyhouseXiangqiDropMove[] {
  const position = positionOf(state);
  if (!position) return [];
  return legalDrops(position, generalSquares(position.board), role);
}

export function isCrazyhouseXiangqiLegalMove(
  state: CrazyhouseXiangqiGameState,
  move: CrazyhouseXiangqiMove,
): boolean {
  if (isCrazyhouseXiangqiDropMove(move)) {
    return getCrazyhouseXiangqiLegalDrops(state, move.drop).some((m) => m.to === move.to);
  }
  return getCrazyhouseXiangqiLegalMovesFrom(state, move.from).some((m) => m.to === move.to);
}

// ── Apply ──────────────────────────────────────────────────────────────────

/**
 * Play a legal move and adjudicate. Order: checkmate > stalemate > three-fold
 * repetition (perpetual check loses) > the progress clock, as standard
 * xiangqi orders them. Throws on an illegal move or a game not in progress.
 */
export function applyCrazyhouseXiangqiMove(
  state: CrazyhouseXiangqiGameState,
  move: CrazyhouseXiangqiMove,
): CrazyhouseXiangqiGameState {
  const position = positionOf(state);
  if (!position) throw new Error('game is not in progress');
  if (!isCrazyhouseXiangqiLegalMove(state, move)) {
    throw new Error(`illegal move: ${crazyhouseXiangqiMoveToUci(move)}`);
  }
  const mover = position.turn;
  const after = crazyhouseXiangqiPositionAfter(position, move);
  const next = after.turn;
  const key = crazyhouseXiangqiPositionKey(after);
  const check = isCrazyhouseXiangqiGeneralInCheck(after.board, next);
  const positionCounts = { ...state.positionCounts, [key]: (state.positionCounts[key] ?? 0) + 1 };
  const history = [...state.history, { key, check }];
  const progressClock = after.captured ? 0 : state.progressClock + 1;
  const moved: CrazyhouseXiangqiGameState = {
    ...state,
    board: after.board,
    hands: after.hands,
    status: { type: 'playing', turn: next },
    moveNumber: mover === 'black' ? state.moveNumber + 1 : state.moveNumber,
    ply: state.ply + 1,
    progressClock,
    lastMove: move,
    positionCounts,
    history,
  };
  const finish = (
    winner: CrazyhouseXiangqiColor | null,
    reason: CrazyhouseXiangqiGameEndReason,
  ): CrazyhouseXiangqiGameState => ({ ...moved, status: { type: 'finished', winner, reason } });

  if (crazyhouseXiangqiLegalMovesOn(after).length === 0) {
    return finish(mover, check ? 'checkmate' : 'stalemate');
  }
  if ((positionCounts[key] ?? 0) >= CRAZYHOUSE_XIANGQI_REPETITION_COUNT) {
    const checker = perpetualChecker(history, mover);
    if (checker) return finish(oppositeCrazyhouseXiangqiColor(checker), 'chasing');
    return finish(null, 'repetition');
  }
  if (progressClock >= CRAZYHOUSE_XIANGQI_PROGRESS_CLOCK_LIMIT) {
    return finish(null, 'progress-clock');
  }
  return moved;
}

/**
 * The side that checked on every one of its moves in the cycle that closed
 * the repetition, if exactly one did. The cycle is the moves after the
 * repeated position's previous occurrence, through now; `mover` made the
 * last of them. Mutual or check-free cycles return null, a draw.
 */
function perpetualChecker(
  history: readonly { key: string; check: boolean }[],
  mover: CrazyhouseXiangqiColor,
): CrazyhouseXiangqiColor | null {
  const last = history.length - 1;
  const key = history[last]!.key;
  let previous = last - 1;
  while (previous >= 0 && history[previous]!.key !== key) previous -= 1;
  if (previous < 0) return null;
  const cycle = history.slice(previous + 1);
  const checkedThroughout = (color: CrazyhouseXiangqiColor): boolean => {
    const own = cycle.filter((_, i) => (cycle.length - 1 - i) % 2 === (color === mover ? 0 : 1));
    return own.length > 0 && own.every((entry) => entry.check);
  };
  const moverAll = checkedThroughout(mover);
  const otherAll = checkedThroughout(oppositeCrazyhouseXiangqiColor(mover));
  if (moverAll && !otherAll) return mover;
  if (otherAll && !moverAll) return oppositeCrazyhouseXiangqiColor(mover);
  return null;
}

export function finishCrazyhouseXiangqiGame(
  state: CrazyhouseXiangqiGameState,
  winner: CrazyhouseXiangqiColor | null,
  reason: CrazyhouseXiangqiGameEndReason,
): CrazyhouseXiangqiGameState {
  return { ...state, status: { type: 'finished', winner, reason } };
}

export function abortCrazyhouseXiangqiGame(
  state: CrazyhouseXiangqiGameState,
  reason: AbortReason,
): CrazyhouseXiangqiGameState {
  return { ...state, status: { type: 'aborted', reason } };
}

// ── View ───────────────────────────────────────────────────────────────────

export function getCrazyhouseXiangqiPlayerView(
  state: CrazyhouseXiangqiGameState,
  perspective: CrazyhouseXiangqiColor,
): CrazyhouseXiangqiPlayerView {
  return {
    id: state.id,
    perspective,
    board: { ...state.board },
    hands: cloneHands(state.hands),
    legalMoves: getCrazyhouseXiangqiLegalMoves(state),
    inCheck:
      state.status.type === 'playing' &&
      isCrazyhouseXiangqiGeneralInCheck(state.board, perspective),
    status: state.status,
    moveNumber: state.moveNumber,
    ...(state.lastMove ? { lastMove: state.lastMove } : {}),
  };
}
