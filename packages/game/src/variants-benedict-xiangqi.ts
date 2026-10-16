// Benedict Xiangqi — standard xiangqi geometry, Benedict's capture rule.
//
// Benedict Chess is W. D. Troyka's (2002), named for Benedict Arnold, the
// general who changed sides. This applies its rule to the xiangqi board.
//
// The rule:
//   1. There are no captures. A move may only land on an EMPTY point.
//   2. At the end of a move, every enemy piece attacked BY THE PIECE THAT MOVED
//      flips to the mover's colour. A standing attack is inert - the piece has
//      to move to convert.
//   3. You win by making a move after which the moved piece attacks the enemy
//      general.
//
// Porting that to xiangqi forced four decisions with no default answer, and
// they are the design:
//
//   A. THE GENERALS STILL MAY NEVER FACE. A move that would leave the two
//      generals bearing on each other down a clear file is illegal, exactly as
//      in ordinary xiangqi.
//
//      This replaced a win condition, and the reason is worth recording. The
//      first version made a move that attacks the enemy general win on the
//      spot, which is the same rule conversion uses - only the piece that MOVED
//      counts. Applied to generals that produces something nobody wants: the
//      two generals may sit facing each other while the game continues, because
//      the piece that unblocked the file is not the general and a standing
//      attack is inert, and then the position resolves when someone shuffles
//      their general one step along the file to claim it. Uniform with the rest
//      of the rules, and unplayable to look at.
//
//      The alternative was to make facing a win for whoever creates it, which
//      needs a carve-out from the moved-piece rule. Keeping xiangqi's
//      prohibition needs no carve-out at all, so that is what this does.
//
//   B. ADVISORS, ELEPHANTS AND GENERALS ARE BOUND TO THE PALACE OR HALF THEY
//      STAND IN, not their owner's. A converted advisor keeps playing inside
//      the enemy palace and can never come home. Stated this way it is a pure
//      generalisation: from the standard array it is identical to ordinary
//      xiangqi, because every advisor already stands in its owner's palace.
//
//   C. SOLDIERS STAY OWNER-BOUND. Forward direction and river-crossed status
//      recompute for whoever owns the soldier now, so a converted soldier turns
//      around and marches back. This is the OPPOSITE call to (B) and it has to
//      be: a region-bound soldier would march away from its own side forever.
//
//   D. DRAWS NEED A PROGRESS CLOCK. With no captures, almost every move is
//      reversible, so three-fold repetition alone is not enough. The progress
//      clock resets on a conversion or a soldier move - the only two
//      irreversible events in the game.
//
// Material is conserved: all 32 pieces stay on the board for the whole game.
//
// NOT A SHIPPED VARIANT, and deliberately so. This kernel has no GameSpecId, no
// entry in the tenant registry or the request gate, and is not re-exported from
// packages/game's index, so it never reaches a bundle. It exists because the
// brianhliou.com write-up's boards are generated from it and assert themselves
// against it (scripts/gen-benedict-diagrams.mts), and because the measurements
// behind that post need a reference implementation the Rust engine can be
// checked against. The engine, the harnesses and a copy of this file are public
// at github.com/brianhliou/benedict-xiangqi.
//
// The game is not shippable as it stands: the first mover wins ~78%, and Red's
// 42 legal first moves range from 0% to 92%. Registering it would need that
// fixed first.

import type { AbortReason } from './types.js';

export type BenedictXiangqiColor = 'red' | 'black';

export type BenedictXiangqiPieceRole =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'horse'
  | 'chariot'
  | 'cannon'
  | 'soldier';

export type BenedictXiangqiPiece = {
  color: BenedictXiangqiColor;
  role: BenedictXiangqiPieceRole;
};

export type BenedictXiangqiCoord = { file: number; rank: number };

const FILE_CHARS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
type BenedictFileChar = (typeof FILE_CHARS)[number];
type BenedictRankNum = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type BenedictXiangqiSquare = `${BenedictFileChar}${BenedictRankNum}`;

export type BenedictXiangqiBoard = Partial<Record<BenedictXiangqiSquare, BenedictXiangqiPiece>>;

export type BenedictXiangqiMove = {
  from: BenedictXiangqiSquare;
  to: BenedictXiangqiSquare;
};

export type BenedictXiangqiGameEndReason =
  // The moved piece bears on the enemy general. There is no check and no
  // checkmate in this variant, so this is its own reason rather than a
  // 'checkmate' alias - a total Record maps it at the persistence boundary.
  | 'general-flipped'
  | 'stalemate'
  | 'repetition'
  | 'progress'
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export type BenedictXiangqiGameStatus =
  | { type: 'playing'; turn: BenedictXiangqiColor }
  | {
      type: 'finished';
      winner: BenedictXiangqiColor | null;
      reason: BenedictXiangqiGameEndReason;
    }
  | { type: 'aborted'; reason: AbortReason };

export type BenedictXiangqiGameState = {
  id: string;
  board: BenedictXiangqiBoard;
  status: BenedictXiangqiGameStatus;
  moveNumber: number;
  lastMove?: BenedictXiangqiMove;
  /** Squares converted by the last move. Drives the board highlight. */
  lastFlipped?: readonly BenedictXiangqiSquare[];
  positionCounts: Record<string, number>;
  /** Plies since the last conversion or soldier move. See decision (D). */
  progressPlies: number;
};

// Perfect information: the view is the board. No redaction, unlike the fog
// variants.
export type BenedictXiangqiPlayerView = {
  id: string;
  perspective: BenedictXiangqiColor;
  board: BenedictXiangqiBoard;
  legalMoves: BenedictXiangqiMove[];
  status: BenedictXiangqiGameStatus;
  moveNumber: number;
  lastMove?: BenedictXiangqiMove;
  lastFlipped?: readonly BenedictXiangqiSquare[];
};

const FILES = 9;
const RANKS = 10;
/** Plies without a conversion or a soldier move before the game is drawn. */
export const BENEDICT_XIANGQI_PROGRESS_LIMIT = 120;

export const BENEDICT_XIANGQI_START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

// ── Squares ────────────────────────────────────────────────────────────────

export function benedictXiangqiInBounds(file: number, rank: number): boolean {
  return file >= 0 && file < FILES && rank >= 0 && rank < RANKS;
}

export function benedictXiangqiSquareOf(file: number, rank: number): BenedictXiangqiSquare {
  if (!benedictXiangqiInBounds(file, rank)) {
    throw new Error(`square out of bounds: ${file},${rank}`);
  }
  return `${FILE_CHARS[file]}${(rank + 1) as BenedictRankNum}` as BenedictXiangqiSquare;
}

export function benedictXiangqiCoordOf(square: BenedictXiangqiSquare): BenedictXiangqiCoord {
  const file = FILE_CHARS.indexOf(square[0] as BenedictFileChar);
  const rank = Number.parseInt(square.slice(1), 10) - 1;
  if (file < 0 || !benedictXiangqiInBounds(file, rank)) {
    throw new Error(`bad square: ${square}`);
  }
  return { file, rank };
}

export function oppositeBenedictXiangqiColor(color: BenedictXiangqiColor): BenedictXiangqiColor {
  return color === 'red' ? 'black' : 'red';
}

let allSquaresCache: readonly BenedictXiangqiSquare[] | null = null;
export function allBenedictXiangqiSquares(): readonly BenedictXiangqiSquare[] {
  if (!allSquaresCache) {
    const out: BenedictXiangqiSquare[] = [];
    for (let rank = 0; rank < RANKS; rank++) {
      for (let file = 0; file < FILES; file++) out.push(benedictXiangqiSquareOf(file, rank));
    }
    allSquaresCache = out;
  }
  return allSquaresCache;
}

// ── Regions ────────────────────────────────────────────────────────────────
//
// These are the functions decision (B) turns on. They answer "which palace is
// this point in", NOT "is this point in that colour's palace" - the difference
// is the whole variant.

/** Which palace a point belongs to, or null outside both. */
export function benedictXiangqiPalaceOf(
  square: BenedictXiangqiSquare,
): BenedictXiangqiColor | null {
  const { file, rank } = benedictXiangqiCoordOf(square);
  if (file < 3 || file > 5) return null;
  if (rank <= 2) return 'red';
  if (rank >= 7) return 'black';
  return null;
}

/** Which half of the river a point is on. Every point is in exactly one. */
export function benedictXiangqiHalfOf(square: BenedictXiangqiSquare): BenedictXiangqiColor {
  return benedictXiangqiCoordOf(square).rank <= 4 ? 'red' : 'black';
}

/** Owner-relative, per decision (C). */
export function benedictXiangqiSoldierCrossed(
  color: BenedictXiangqiColor,
  square: BenedictXiangqiSquare,
): boolean {
  const { rank } = benedictXiangqiCoordOf(square);
  return color === 'red' ? rank >= 5 : rank <= 4;
}

const ELEPHANT_POINTS = new Set<BenedictXiangqiSquare>(
  (
    [
      [2, 0],
      [6, 0],
      [0, 2],
      [4, 2],
      [8, 2],
      [2, 4],
      [6, 4],
      [2, 9],
      [6, 9],
      [0, 7],
      [4, 7],
      [8, 7],
      [2, 5],
      [6, 5],
    ] as const
  ).map(([f, r]) => benedictXiangqiSquareOf(f, r)),
);

const ORTHO: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];
const DIAG: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// ── Geometry ───────────────────────────────────────────────────────────────

function stepTargets(
  square: BenedictXiangqiSquare,
  steps: readonly (readonly [number, number])[],
  samePalaceOnly: boolean,
): BenedictXiangqiSquare[] {
  const { file, rank } = benedictXiangqiCoordOf(square);
  const home = benedictXiangqiPalaceOf(square);
  const out: BenedictXiangqiSquare[] = [];
  for (const [df, dr] of steps) {
    const nf = file + df;
    const nr = rank + dr;
    if (!benedictXiangqiInBounds(nf, nr)) continue;
    const target = benedictXiangqiSquareOf(nf, nr);
    // Decision (B): the palace it STANDS in, not its owner's.
    if (samePalaceOnly && benedictXiangqiPalaceOf(target) !== home) continue;
    out.push(target);
  }
  return out;
}

function elephantTargets(
  square: BenedictXiangqiSquare,
): { to: BenedictXiangqiSquare; eye: BenedictXiangqiSquare }[] {
  if (!ELEPHANT_POINTS.has(square)) return [];
  const { file, rank } = benedictXiangqiCoordOf(square);
  const home = benedictXiangqiHalfOf(square);
  const out: { to: BenedictXiangqiSquare; eye: BenedictXiangqiSquare }[] = [];
  for (const [df, dr] of DIAG) {
    const nf = file + 2 * df;
    const nr = rank + 2 * dr;
    if (!benedictXiangqiInBounds(nf, nr)) continue;
    const to = benedictXiangqiSquareOf(nf, nr);
    // Decision (B) again: the half it stands in.
    if (benedictXiangqiHalfOf(to) !== home) continue;
    out.push({ to, eye: benedictXiangqiSquareOf(file + df, rank + dr) });
  }
  return out;
}

function horseTargets(
  square: BenedictXiangqiSquare,
): { to: BenedictXiangqiSquare; leg: BenedictXiangqiSquare }[] {
  const { file, rank } = benedictXiangqiCoordOf(square);
  const out: { to: BenedictXiangqiSquare; leg: BenedictXiangqiSquare }[] = [];
  for (const [df, dr] of [
    [1, 2],
    [-1, 2],
    [1, -2],
    [-1, -2],
    [2, 1],
    [2, -1],
    [-2, 1],
    [-2, -1],
  ] as const) {
    const nf = file + df;
    const nr = rank + dr;
    if (!benedictXiangqiInBounds(nf, nr)) continue;
    const legFile = file + (Math.abs(df) === 2 ? Math.sign(df) : 0);
    const legRank = rank + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
    out.push({
      to: benedictXiangqiSquareOf(nf, nr),
      leg: benedictXiangqiSquareOf(legFile, legRank),
    });
  }
  return out;
}

function ray(square: BenedictXiangqiSquare, df: number, dr: number): BenedictXiangqiSquare[] {
  const { file, rank } = benedictXiangqiCoordOf(square);
  const out: BenedictXiangqiSquare[] = [];
  let nf = file + df;
  let nr = rank + dr;
  while (benedictXiangqiInBounds(nf, nr)) {
    out.push(benedictXiangqiSquareOf(nf, nr));
    nf += df;
    nr += dr;
  }
  return out;
}

function soldierSteps(
  square: BenedictXiangqiSquare,
  color: BenedictXiangqiColor,
): BenedictXiangqiSquare[] {
  const { file, rank } = benedictXiangqiCoordOf(square);
  const out: BenedictXiangqiSquare[] = [];
  // Decision (C): forward is owner-relative.
  const forwardRank = color === 'red' ? rank + 1 : rank - 1;
  if (benedictXiangqiInBounds(file, forwardRank)) {
    out.push(benedictXiangqiSquareOf(file, forwardRank));
  }
  if (benedictXiangqiSoldierCrossed(color, square)) {
    for (const df of [-1, 1]) {
      if (benedictXiangqiInBounds(file + df, rank)) {
        out.push(benedictXiangqiSquareOf(file + df, rank));
      }
    }
  }
  return out;
}

// ── Moves and attacks ──────────────────────────────────────────────────────
//
// A chariot and a cannon slide identically when they are not capturing, and
// Benedict has no captures, so their MOVE sets are the same. Only their ATTACK
// sets differ: the chariot bears on the first piece along a ray, the cannon on
// the first piece beyond exactly one screen.

/** Destinations for the piece on `square`. Benedict: empty points only. */
/**
 * Decision (A): do the two generals bear on each other down a clear file?
 *
 * Conversions never move a piece, only recolour it, so the only thing a move
 * changes about file occupancy is the moved piece itself. That is what makes
 * this checkable from the resulting board alone.
 */
function benedictXiangqiGeneralsFace(board: BenedictXiangqiBoard): boolean {
  const red = generalSquare(board, 'red');
  const black = generalSquare(board, 'black');
  if (!red || !black) return false;
  const a = benedictXiangqiCoordOf(red);
  const b = benedictXiangqiCoordOf(black);
  if (a.file !== b.file) return false;
  const lo = Math.min(a.rank, b.rank) + 1;
  const hi = Math.max(a.rank, b.rank);
  for (let rank = lo; rank < hi; rank++) {
    if (board[benedictXiangqiSquareOf(a.file, rank)]) return false;
  }
  return true;
}

/** The board a move produces, ignoring conversions, which never relocate. */
function benedictXiangqiAfterMove(
  board: BenedictXiangqiBoard,
  from: BenedictXiangqiSquare,
  to: BenedictXiangqiSquare,
): BenedictXiangqiBoard {
  const next: BenedictXiangqiBoard = { ...board };
  const piece = next[from];
  delete next[from];
  if (piece) next[to] = piece;
  return next;
}

export function benedictXiangqiMovesFrom(
  board: BenedictXiangqiBoard,
  square: BenedictXiangqiSquare,
): BenedictXiangqiSquare[] {
  // Decision (A) is enforced HERE and nowhere else. Filtering the move list is
  // what makes a facing position unreachable rather than merely undesirable,
  // and it is colour-blind: a position with the generals facing is illegal
  // whoever produced it, so the filter does not need to know whose turn it is.
  return benedictXiangqiPseudoMovesFrom(board, square).filter(
    (to) => !benedictXiangqiGeneralsFace(benedictXiangqiAfterMove(board, square, to)),
  );
}

/** Move geometry alone, before decision (A) is applied. */
function benedictXiangqiPseudoMovesFrom(
  board: BenedictXiangqiBoard,
  square: BenedictXiangqiSquare,
): BenedictXiangqiSquare[] {
  const piece = board[square];
  if (!piece) return [];
  const empty = (s: BenedictXiangqiSquare) => board[s] === undefined;
  switch (piece.role) {
    case 'general':
      return stepTargets(square, ORTHO, true).filter(empty);
    case 'advisor':
      return stepTargets(square, DIAG, true).filter(empty);
    case 'elephant':
      return elephantTargets(square)
        .filter(({ to, eye }) => empty(to) && empty(eye))
        .map(({ to }) => to);
    case 'horse':
      return horseTargets(square)
        .filter(({ to, leg }) => empty(to) && empty(leg))
        .map(({ to }) => to);
    case 'chariot':
    case 'cannon': {
      const out: BenedictXiangqiSquare[] = [];
      for (const [df, dr] of ORTHO) {
        for (const target of ray(square, df, dr)) {
          if (!empty(target)) break;
          out.push(target);
        }
      }
      return out;
    }
    case 'soldier':
      return soldierSteps(square, piece.color).filter(empty);
  }
}

/**
 * Points the piece on `square` bears on, under normal xiangqi capture
 * geometry. Colour-blind: callers filter.
 *
 * Deliberately does NOT include the flying-general line. Decision (A) makes a
 * facing position illegal rather than winning, so the rule belongs in move
 * legality and lives there alone; a general that "attacks" down the file here
 * would be a second, unreachable copy of it.
 */
export function benedictXiangqiAttacksFrom(
  board: BenedictXiangqiBoard,
  square: BenedictXiangqiSquare,
): BenedictXiangqiSquare[] {
  const piece = board[square];
  if (!piece) return [];
  const occupied = (s: BenedictXiangqiSquare) => board[s] !== undefined;
  switch (piece.role) {
    case 'general':
      return stepTargets(square, ORTHO, true).filter(occupied);
    case 'advisor':
      return stepTargets(square, DIAG, true).filter(occupied);
    case 'elephant':
      return elephantTargets(square)
        .filter(({ to, eye }) => occupied(to) && !occupied(eye))
        .map(({ to }) => to);
    case 'horse':
      return horseTargets(square)
        .filter(({ to, leg }) => occupied(to) && !occupied(leg))
        .map(({ to }) => to);
    case 'chariot': {
      const out: BenedictXiangqiSquare[] = [];
      for (const [df, dr] of ORTHO) {
        for (const target of ray(square, df, dr)) {
          if (occupied(target)) {
            out.push(target);
            break;
          }
        }
      }
      return out;
    }
    case 'cannon': {
      const out: BenedictXiangqiSquare[] = [];
      for (const [df, dr] of ORTHO) {
        let screened = false;
        for (const target of ray(square, df, dr)) {
          if (!occupied(target)) continue;
          if (!screened) {
            screened = true;
            continue;
          }
          out.push(target);
          break;
        }
      }
      return out;
    }
    case 'soldier':
      return soldierSteps(square, piece.color).filter(occupied);
  }
}

function generalSquare(
  board: BenedictXiangqiBoard,
  color: BenedictXiangqiColor,
): BenedictXiangqiSquare | null {
  for (const square of allBenedictXiangqiSquares()) {
    const piece = board[square];
    if (piece && piece.role === 'general' && piece.color === color) return square;
  }
  return null;
}

// ── Initial position ───────────────────────────────────────────────────────

export function createInitialBenedictXiangqiBoard(): BenedictXiangqiBoard {
  const board: BenedictXiangqiBoard = {};
  const back: BenedictXiangqiPieceRole[] = [
    'chariot',
    'horse',
    'elephant',
    'advisor',
    'general',
    'advisor',
    'elephant',
    'horse',
    'chariot',
  ];
  for (let file = 0; file < FILES; file++) {
    board[benedictXiangqiSquareOf(file, 0)] = { color: 'red', role: back[file] };
    board[benedictXiangqiSquareOf(file, 9)] = { color: 'black', role: back[file] };
  }
  for (const file of [1, 7]) {
    board[benedictXiangqiSquareOf(file, 2)] = { color: 'red', role: 'cannon' };
    board[benedictXiangqiSquareOf(file, 7)] = { color: 'black', role: 'cannon' };
  }
  for (const file of [0, 2, 4, 6, 8]) {
    board[benedictXiangqiSquareOf(file, 3)] = { color: 'red', role: 'soldier' };
    board[benedictXiangqiSquareOf(file, 6)] = { color: 'black', role: 'soldier' };
  }
  return board;
}

export function createInitialBenedictXiangqiState(gameId: string): BenedictXiangqiGameState {
  const board = createInitialBenedictXiangqiBoard();
  const state: BenedictXiangqiGameState = {
    id: gameId,
    board,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  state.positionCounts[benedictXiangqiPositionRepetitionKey(state)] = 1;
  return state;
}

// ── Legality ───────────────────────────────────────────────────────────────
//
// There is no check, so there is no "would this leave my general attacked"
// filter. Exposing your general simply loses, which is the whole tension.

export function getBenedictXiangqiLegalMoves(
  state: BenedictXiangqiGameState,
): BenedictXiangqiMove[] {
  if (state.status.type !== 'playing') return [];
  const turn = state.status.turn;
  const moves: BenedictXiangqiMove[] = [];
  for (const from of allBenedictXiangqiSquares()) {
    const piece = state.board[from];
    if (!piece || piece.color !== turn) continue;
    for (const to of benedictXiangqiMovesFrom(state.board, from)) moves.push({ from, to });
  }
  return moves;
}

export function isBenedictXiangqiLegalMove(
  state: BenedictXiangqiGameState,
  move: BenedictXiangqiMove,
): boolean {
  if (state.status.type !== 'playing') return false;
  const piece = state.board[move.from];
  if (!piece || piece.color !== state.status.turn) return false;
  return benedictXiangqiMovesFrom(state.board, move.from).includes(move.to);
}

/**
 * Squares the moved piece would convert, and whether the move wins.
 *
 * Note the ordering: a move that bears on the enemy general ends the game, and
 * flips are not applied. That is what keeps generals from ever changing colour,
 * which in turn is what makes "the general's square" safe to track.
 */
export function benedictXiangqiResolveMove(
  board: BenedictXiangqiBoard,
  move: BenedictXiangqiMove,
): { board: BenedictXiangqiBoard; flipped: BenedictXiangqiSquare[]; wins: boolean } {
  const piece = board[move.from];
  if (!piece) return { board, flipped: [], wins: false };
  const mover = piece.color;
  const enemy = oppositeBenedictXiangqiColor(mover);

  const next: BenedictXiangqiBoard = { ...board };
  delete next[move.from];
  next[move.to] = piece;

  const enemyGeneral = generalSquare(next, enemy);
  const attacked = benedictXiangqiAttacksFrom(next, move.to);
  if (enemyGeneral && attacked.includes(enemyGeneral)) {
    return { board: next, flipped: [], wins: true };
  }

  const flipped: BenedictXiangqiSquare[] = [];
  for (const target of attacked) {
    const victim = next[target];
    if (!victim || victim.color !== enemy) continue;
    next[target] = { color: mover, role: victim.role };
    flipped.push(target);
  }
  return { board: next, flipped, wins: false };
}

export function benedictXiangqiPositionRepetitionKey(state: BenedictXiangqiGameState): string {
  const turn = state.status.type === 'playing' ? state.status.turn : '-';
  const cells: string[] = [];
  for (const square of allBenedictXiangqiSquares()) {
    const piece = state.board[square];
    // The whole role, not its first letter: chariot and cannon both start with c.
    if (piece) cells.push(`${square}:${piece.color[0]}.${piece.role}`);
  }
  return `${cells.join(',')}|${turn}`;
}

export function applyBenedictXiangqiMove(
  state: BenedictXiangqiGameState,
  move: BenedictXiangqiMove,
): BenedictXiangqiGameState {
  if (state.status.type !== 'playing') return state;
  if (!isBenedictXiangqiLegalMove(state, move)) return state;

  const mover = state.status.turn;
  const opponent = oppositeBenedictXiangqiColor(mover);
  const moved = state.board[move.from];
  const { board, flipped, wins } = benedictXiangqiResolveMove(state.board, move);

  if (wins) {
    return {
      ...state,
      board,
      status: { type: 'finished', winner: mover, reason: 'general-flipped' },
      moveNumber: state.moveNumber + 1,
      lastMove: move,
      lastFlipped: [],
      progressPlies: 0,
    };
  }

  // Decision (D): conversions and soldier moves are the only irreversible
  // events, so they are what resets the progress clock.
  const progressed = flipped.length > 0 || moved?.role === 'soldier';
  const progressPlies = progressed ? 0 : state.progressPlies + 1;

  const next: BenedictXiangqiGameState = {
    ...state,
    board,
    status: { type: 'playing', turn: opponent },
    moveNumber: state.moveNumber + 1,
    lastMove: move,
    lastFlipped: flipped,
    progressPlies,
    // A conversion changes the position irreversibly, so repetition counts
    // start over. Without this a flipped-and-flipped-back cycle would be
    // undercounted against the three-fold rule.
    positionCounts: progressed ? {} : { ...state.positionCounts },
  };

  const key = benedictXiangqiPositionRepetitionKey(next);
  const seen = (next.positionCounts[key] ?? 0) + 1;
  next.positionCounts[key] = seen;

  if (seen >= 3) {
    next.status = { type: 'finished', winner: null, reason: 'repetition' };
    return next;
  }
  if (progressPlies >= BENEDICT_XIANGQI_PROGRESS_LIMIT) {
    next.status = { type: 'finished', winner: null, reason: 'progress' };
    return next;
  }
  // Standard xiangqi: no legal move is a loss, not a draw.
  if (getBenedictXiangqiLegalMoves(next).length === 0) {
    next.status = { type: 'finished', winner: mover, reason: 'stalemate' };
  }
  return next;
}

export function getBenedictXiangqiPlayerView(
  state: BenedictXiangqiGameState,
  perspective: BenedictXiangqiColor,
): BenedictXiangqiPlayerView {
  const toMove = state.status.type === 'playing' && state.status.turn === perspective;
  return {
    id: state.id,
    perspective,
    board: { ...state.board },
    legalMoves: toMove ? getBenedictXiangqiLegalMoves(state) : [],
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
    lastFlipped: state.lastFlipped,
  };
}
