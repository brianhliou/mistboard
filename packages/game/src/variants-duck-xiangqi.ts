// Duck Xiangqi — standard xiangqi geometry, Duck Chess's shared blocker.
//
// Duck Chess is Dr Tim Paulden's (early 2016, duckchess.com), named for the
// rubber duck both players share control of. This applies its rule to the
// xiangqi board. As far as a 2026-09-08 prior-art sweep could find, nobody had.
//
// The rule:
//   1. A turn is a legal xiangqi move, THEN a duck move. Always that order.
//   2. The duck must move every turn, to a DIFFERENT empty point. It starts off
//      the board and enters as the second half of Red's first turn.
//   3. The duck can never be captured.
//   4. There is no check. You win by CAPTURING the enemy general.
//
// Porting that to xiangqi forced decisions the chess game never had to make,
// because chess has one blocking geometry and xiangqi has four. They are the
// design, and they are recorded here because the kernel is the only place they
// are actually true.
//
//   D1. THE DUCK IS AN ORDINARY BLOCKING PIECE. It simply cannot be captured
//       and must move every turn. Wherever xiangqi asks "is there a piece on
//       this point", the duck is a piece: it screens for cannons, blocks the
//       horse's leg, blocks the elephant's eye, and breaks a flying-general
//       file.
//
//       An earlier draft read the duck as an ABSOLUTE WALL, reasoning that the
//       chess duck blocks knights and no chess piece blocks a knight, so the
//       duck was never really a piece. That reading forces a carve-out at the
//       cannon: the duck has to be either transparent to screen counting, which
//       is incoherent (it blocks the slide but not the sight line), or a
//       shot-killer that overrides screen counting, which is a new rule. D1
//       needs neither. The chess duck only LOOKS like a wall because chess has
//       no screen; on a board with four blocking geometries, "ordinary piece"
//       is both simpler and more xiangqi.
//
//   D2. THE DUCK SCREENS FOR CANNONS. Corollary of D1, and the decision with
//       the largest effect on play: because you place the duck at the END of
//       your turn, THE SCREEN YOU PLACE IS THE SCREEN YOUR OPPONENT SHOOTS
//       OVER. Duck placement is never a cannon platform for yourself.
//
//   D3. A DUCK ON THE HORSE'S LEG BLOCKS THE HORSE, AND ON THE ELEPHANT'S EYE
//       BLOCKS THE ELEPHANT. Corollary of D1, and a deliberate divergence from
//       the chess game, where the duck does NOT block a knight. A chess knight
//       has no path to block. Xiangqi's horse has a leg, the leg is a real
//       point, and real pieces really block it. This makes the duck far
//       stronger here than in chess: it freezes a horse from a point it does
//       not occupy.
//
//   D4. NO CHECK. Straight from the original. You may leave your general
//       attacked, and you win by actually capturing it.
//
//   D5. THE GENERALS MAY FACE, AND THEN ONE OF THEM DIES. The flying general
//       becomes a real capture: a general may fly down a clear file and take
//       the enemy general, which ends the game. Leaving the generals facing is
//       legal and normally loses.
//
//       REVISED 2026-09-10. This kernel first kept xiangqi's prohibition
//       intact (a move leaving the generals facing was simply not legal),
//       checked after each half-turn separately, on the grounds that a facing
//       position "is not a position a xiangqi player accepts looking at." That
//       was an argument about taste, and it was overruled by the one xiangqi
//       player whose taste it was protecting.
//
//       The argument that beat it is consistency. Xiangqi's prohibition is not
//       a free-standing rule: the generals attack each other down an open file,
//       so leaving them facing is self-check, and self-check is what is
//       actually forbidden. D4 deletes check. Keeping the prohibition while
//       deleting the thing it rests on kept a consequence without its cause.
//
//       Note this is NOT the same as deleting flyingGeneral. Deleting it gives
//       a third game where the generals may face and neither can do anything
//       about it. Here the rule is PROMOTED: it stops being a prohibition and
//       starts being a capture, which is the same move Duck Chess already
//       allows for kings ("it is permissible to make a move / capture with your
//       king that places it on an attacked square", and you win by capturing
//       the king outright).
//
//       What this buys, measured on a board where the generals share a file
//       and the duck is the only blocker: the duck used to be confined to the
//       7 open points on that file out of 85 empty ones, a 92% confiscation of
//       the shared resource that nothing on the board announced. Now all 85 are
//       legal and 78 of them lose immediately. An invisible legality constraint
//       became a visible blunder, which is what D4 did for every other attack.
//
//       The old D5a (facing checked once per half-turn) is gone with it: there
//       is nothing left to check twice.
//
//   D9. STALEMATE: THE PLAYER WITH NO LEGAL TURN LOSES. Xiangqi's rule, and the
//       one place the two parents flatly contradict each other - Duck Chess
//       inverts stalemate into a WIN for the immobilised player (the "fowling"
//       rule). Taking xiangqi's answer is what makes the D5a squeeze a winning
//       tactic instead of a way to lose on purpose.
//
// Draws are ORIGINAL WORK, because Duck Chess never defined any: the inventor
// wrote none, and the implementations that have them inherited them from a
// chess base class. See D8 in docs-private/duck-xiangqi/plan.md.
//
// NOT A SHIPPED VARIANT YET. This kernel has no GameSpecId, no tenant registry
// entry and no request-gate entry, so it never reaches a bundle. It exists to
// be the reference implementation the engine is checked against, and to
// generate the write-up's diagrams. Nothing registers until the balance
// measurement has a verdict.

import type { AbortReason } from './types.js';

export type DuckXiangqiColor = 'red' | 'black';

export type DuckXiangqiPieceRole =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'horse'
  | 'chariot'
  | 'cannon'
  | 'soldier';

export type DuckXiangqiPiece = {
  color: DuckXiangqiColor;
  role: DuckXiangqiPieceRole;
};

export type DuckXiangqiCoord = { file: number; rank: number };

const FILES = 9;
const RANKS = 10;

const FILE_CHARS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
type DuckFileChar = (typeof FILE_CHARS)[number];
type DuckRankNum = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type DuckXiangqiSquare = `${DuckFileChar}${DuckRankNum}`;

export type DuckXiangqiBoard = Partial<Record<DuckXiangqiSquare, DuckXiangqiPiece>>;

/**
 * A whole turn: the xiangqi move, then where the duck goes.
 *
 * `duckTo` is null on exactly one kind of turn - one whose move captures the
 * enemy general. The game ends on the capture, so the duck never moves. Any
 * other turn with a null `duckTo` is illegal, which is what stops "I decline to
 * move the duck" from being playable.
 */
export type DuckXiangqiTurn = {
  from: DuckXiangqiSquare;
  to: DuckXiangqiSquare;
  duckTo: DuckXiangqiSquare | null;
};

export type DuckXiangqiGameEndReason =
  // The enemy general was captured. There is no check and no checkmate here, so
  // this is its own reason rather than a 'checkmate' alias - a total Record maps
  // it at the persistence boundary. (Casting an end reason into a
  // CHECK-constrained union is how a finish transaction dies silently.)
  | 'general-captured'
  // D9: the side to move has no legal turn and loses.
  | 'stalemate'
  | 'repetition'
  // D8: 60 moves with no capture. Xiangqi's own no-capture limit, and the only
  // thing that actually ends a drawn Duck Xiangqi game - see the comment on
  // DUCK_XIANGQI_PROGRESS_LIMIT.
  | 'progress'
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export type DuckXiangqiGameStatus =
  | { type: 'playing'; turn: DuckXiangqiColor }
  | {
      type: 'finished';
      winner: DuckXiangqiColor | null;
      reason: DuckXiangqiGameEndReason;
    }
  | { type: 'aborted'; reason: AbortReason };

/**
 * What a client is shown. Duck Xiangqi is perfect information, so this is the
 * whole truth - it exists to shape the PAYLOAD, not to hide anything.
 *
 * It carries legal PIECE MOVES, not legal turns, and that is deliberate. There
 * are ~2,554 legal turns from the opening array; serialising them would put
 * roughly 38KB on the wire every frame, against ~660 bytes for the 44 piece
 * moves. The client resolves phase two locally with
 * `duckXiangqiDuckDestinations`, which it can do because the kernel is a shared
 * package and the position is public. The server still validates the whole turn
 * on arrival - the client's copy is a convenience, never an authority.
 */
export type DuckXiangqiPlayerView = {
  id: string;
  perspective: DuckXiangqiColor;
  board: DuckXiangqiBoard;
  /** Undefined only before Red's first turn. */
  duck?: DuckXiangqiSquare;
  /** First half of every legal turn. Pair with duckXiangqiDuckDestinations. */
  legalPieceMoves: { from: DuckXiangqiSquare; to: DuckXiangqiSquare }[];
  status: DuckXiangqiGameStatus;
  moveNumber: number;
  /**
   * Named `lastMove`, not `lastTurn`, on purpose: the shared last-move renderer
   * and the generic tenant plumbing both read `lastMove`, and the kernel's state
   * field is `lastTurn`. Translating here keeps that mismatch in one place
   * instead of every consumer.
   */
  lastMove?: { from: DuckXiangqiSquare; to: DuckXiangqiSquare };
  /** Where the duck stood before the last turn, so the board can mark it. */
  lastDuck?: DuckXiangqiSquare;
};

export type DuckXiangqiGameState = {
  id: string;
  board: DuckXiangqiBoard;
  /** Undefined only before Red's first turn: the duck starts off the board. */
  duck?: DuckXiangqiSquare;
  status: DuckXiangqiGameStatus;
  moveNumber: number;
  lastTurn?: DuckXiangqiTurn;
  positionCounts: Record<string, number>;
  /** Plies since the last capture. See D8. */
  progressPlies: number;
};

export const DUCK_XIANGQI_START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

// ── Squares ────────────────────────────────────────────────────────────────

export function duckXiangqiInBounds(file: number, rank: number): boolean {
  return file >= 0 && file < FILES && rank >= 0 && rank < RANKS;
}

export function duckXiangqiSquareOf(file: number, rank: number): DuckXiangqiSquare {
  if (!duckXiangqiInBounds(file, rank)) {
    throw new Error(`square out of bounds: ${file},${rank}`);
  }
  return `${FILE_CHARS[file]}${(rank + 1) as DuckRankNum}` as DuckXiangqiSquare;
}

export function duckXiangqiCoordOf(square: DuckXiangqiSquare): DuckXiangqiCoord {
  const file = FILE_CHARS.indexOf(square[0] as DuckFileChar);
  const rank = Number.parseInt(square.slice(1), 10) - 1;
  if (file < 0 || !duckXiangqiInBounds(file, rank)) {
    throw new Error(`bad square: ${square}`);
  }
  return { file, rank };
}

export function oppositeDuckXiangqiColor(color: DuckXiangqiColor): DuckXiangqiColor {
  return color === 'red' ? 'black' : 'red';
}

let allSquaresCache: readonly DuckXiangqiSquare[] | null = null;
export function allDuckXiangqiSquares(): readonly DuckXiangqiSquare[] {
  if (!allSquaresCache) {
    const out: DuckXiangqiSquare[] = [];
    for (let rank = 0; rank < RANKS; rank++) {
      for (let file = 0; file < FILES; file++) out.push(duckXiangqiSquareOf(file, rank));
    }
    allSquaresCache = out;
  }
  return allSquaresCache;
}

// ── Regions ────────────────────────────────────────────────────────────────
//
// Ordinary xiangqi regions, owner-relative. Benedict's kernel deliberately made
// these region-bound rather than owner-bound because its pieces change sides;
// nothing changes sides here, so these are the standard rules verbatim.

export function duckXiangqiInPalace(color: DuckXiangqiColor, file: number, rank: number): boolean {
  if (file < 3 || file > 5) return false;
  return color === 'red' ? rank <= 2 : rank >= 7;
}

export function duckXiangqiInOwnHalf(color: DuckXiangqiColor, rank: number): boolean {
  return color === 'red' ? rank <= 4 : rank >= 5;
}

export function duckXiangqiHasCrossedRiver(color: DuckXiangqiColor, rank: number): boolean {
  return color === 'red' ? rank >= 5 : rank <= 4;
}

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
const HORSE_STEPS: readonly (readonly [number, number])[] = [
  [1, 2],
  [-1, 2],
  [1, -2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
];

// ── Occupancy ──────────────────────────────────────────────────────────────
//
// D1 lives HERE and nowhere else. Every geometry function below asks
// `occupied()` rather than reading the board directly, so the duck is a piece
// to all four blocking rules by construction rather than by four separate
// remembered edits. Getting one of them wrong is the bug this shape prevents.

function occupied(
  board: DuckXiangqiBoard,
  duck: DuckXiangqiSquare | undefined,
  square: DuckXiangqiSquare,
): boolean {
  return board[square] !== undefined || duck === square;
}

/**
 * The enemy general this general can fly down the file and take, or null.
 *
 * Same file, nothing between. The duck counts as something (D1), so a duck on
 * the file is what stops this, and it has to move every turn.
 */
function flyingGeneralTarget(
  board: DuckXiangqiBoard,
  duck: DuckXiangqiSquare | undefined,
  from: DuckXiangqiSquare,
  color: DuckXiangqiColor,
): DuckXiangqiSquare | null {
  const { file, rank } = duckXiangqiCoordOf(from);
  for (const step of [-1, 1]) {
    // Ranks are 0-indexed here; the label adds the 1. Walk with the bounds
    // helper rather than literals so this cannot drift from the convention.
    for (let r = rank + step; duckXiangqiInBounds(file, r); r += step) {
      const square = duckXiangqiSquareOf(file, r);
      const piece = board[square];
      if (duck === square) break;
      if (!piece) continue;
      if (piece.role === 'general' && piece.color !== color) return square;
      break;
    }
  }
  return null;
}

// ── Geometry ───────────────────────────────────────────────────────────────

function ray(square: DuckXiangqiSquare, df: number, dr: number): DuckXiangqiSquare[] {
  const { file, rank } = duckXiangqiCoordOf(square);
  const out: DuckXiangqiSquare[] = [];
  let nf = file + df;
  let nr = rank + dr;
  while (duckXiangqiInBounds(nf, nr)) {
    out.push(duckXiangqiSquareOf(nf, nr));
    nf += df;
    nr += dr;
  }
  return out;
}

const ELEPHANT_POINTS = new Set<DuckXiangqiSquare>(
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
  ).map(([f, r]) => duckXiangqiSquareOf(f, r)),
);

/** Elephant destinations with the eye that has to be clear. */
function elephantTargets(
  square: DuckXiangqiSquare,
  color: DuckXiangqiColor,
): { to: DuckXiangqiSquare; eye: DuckXiangqiSquare }[] {
  if (!ELEPHANT_POINTS.has(square)) return [];
  const { file, rank } = duckXiangqiCoordOf(square);
  const out: { to: DuckXiangqiSquare; eye: DuckXiangqiSquare }[] = [];
  for (const [df, dr] of DIAG) {
    const nf = file + 2 * df;
    const nr = rank + 2 * dr;
    if (!duckXiangqiInBounds(nf, nr)) continue;
    // Owner-relative, unlike Benedict: an elephant never crosses the river.
    if (!duckXiangqiInOwnHalf(color, nr)) continue;
    out.push({
      to: duckXiangqiSquareOf(nf, nr),
      eye: duckXiangqiSquareOf(file + df, rank + dr),
    });
  }
  return out;
}

/** Horse destinations with the leg that has to be clear. */
function horseTargets(
  square: DuckXiangqiSquare,
): { to: DuckXiangqiSquare; leg: DuckXiangqiSquare }[] {
  const { file, rank } = duckXiangqiCoordOf(square);
  const out: { to: DuckXiangqiSquare; leg: DuckXiangqiSquare }[] = [];
  for (const [df, dr] of HORSE_STEPS) {
    const nf = file + df;
    const nr = rank + dr;
    if (!duckXiangqiInBounds(nf, nr)) continue;
    const legFile = file + (Math.abs(df) === 2 ? Math.sign(df) : 0);
    const legRank = rank + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
    out.push({
      to: duckXiangqiSquareOf(nf, nr),
      leg: duckXiangqiSquareOf(legFile, legRank),
    });
  }
  return out;
}

function soldierSteps(square: DuckXiangqiSquare, color: DuckXiangqiColor): DuckXiangqiSquare[] {
  const { file, rank } = duckXiangqiCoordOf(square);
  const out: DuckXiangqiSquare[] = [];
  const forwardRank = color === 'red' ? rank + 1 : rank - 1;
  if (duckXiangqiInBounds(file, forwardRank)) {
    out.push(duckXiangqiSquareOf(file, forwardRank));
  }
  if (duckXiangqiHasCrossedRiver(color, rank)) {
    for (const df of [-1, 1]) {
      if (duckXiangqiInBounds(file + df, rank)) {
        out.push(duckXiangqiSquareOf(file + df, rank));
      }
    }
  }
  return out;
}

// ── Piece moves ────────────────────────────────────────────────────────────

/**
 * Where the piece on `square` can go, before the facing rule (D5) is applied.
 *
 * A destination is legal if it is empty or holds an enemy piece. The duck's
 * point is neither, so nothing can ever land on it and it can never be
 * captured - that falls out of `occupied()` rather than needing its own check.
 */
export function duckXiangqiPseudoMovesFrom(
  board: DuckXiangqiBoard,
  duck: DuckXiangqiSquare | undefined,
  square: DuckXiangqiSquare,
): DuckXiangqiSquare[] {
  const piece = board[square];
  if (!piece) return [];
  const { color, role } = piece;
  const { file, rank } = duckXiangqiCoordOf(square);
  const out: DuckXiangqiSquare[] = [];

  /** Empty, or an enemy piece. Never the duck. */
  const landable = (target: DuckXiangqiSquare): boolean => {
    if (duck === target) return false;
    const occupant = board[target];
    return occupant === undefined || occupant.color !== color;
  };

  switch (role) {
    case 'general': {
      for (const [df, dr] of ORTHO) {
        const nf = file + df;
        const nr = rank + dr;
        if (!duckXiangqiInBounds(nf, nr)) continue;
        if (!duckXiangqiInPalace(color, nf, nr)) continue;
        const target = duckXiangqiSquareOf(nf, nr);
        if (landable(target)) out.push(target);
      }
      // D5: the flying general, as an actual capture. Xiangqi has always said
      // the generals bear on each other down a clear file; standard xiangqi
      // just never lets you find out, because leaving them facing is
      // self-check. D4 removes check, so the attack becomes a move you can
      // play. This is the ONLY way a general leaves its palace, and the game
      // ends the instant it does.
      const enemyGeneral = flyingGeneralTarget(board, duck, square, color);
      if (enemyGeneral) out.push(enemyGeneral);
      break;
    }
    case 'advisor': {
      for (const [df, dr] of DIAG) {
        const nf = file + df;
        const nr = rank + dr;
        if (!duckXiangqiInBounds(nf, nr)) continue;
        if (!duckXiangqiInPalace(color, nf, nr)) continue;
        const target = duckXiangqiSquareOf(nf, nr);
        if (landable(target)) out.push(target);
      }
      break;
    }
    case 'elephant': {
      for (const { to, eye } of elephantTargets(square, color)) {
        // D3: the duck blocks the eye like any piece.
        if (occupied(board, duck, eye)) continue;
        if (landable(to)) out.push(to);
      }
      break;
    }
    case 'horse': {
      for (const { to, leg } of horseTargets(square)) {
        // D3: the duck blocks the leg like any piece. This is the divergence
        // from Duck Chess, where a knight jumps the duck.
        if (occupied(board, duck, leg)) continue;
        if (landable(to)) out.push(to);
      }
      break;
    }
    case 'chariot': {
      for (const [df, dr] of ORTHO) {
        for (const target of ray(square, df, dr)) {
          if (!occupied(board, duck, target)) {
            out.push(target);
            continue;
          }
          // First blocker: capturable if it is an enemy piece, never if it is
          // the duck. Either way the ray stops.
          if (landable(target)) out.push(target);
          break;
        }
      }
      break;
    }
    case 'cannon': {
      for (const [df, dr] of ORTHO) {
        let screened = false;
        for (const target of ray(square, df, dr)) {
          const blocked = occupied(board, duck, target);
          if (!screened) {
            // Before the screen: quiet moves onto empty points only.
            if (!blocked) {
              out.push(target);
              continue;
            }
            // D2: the duck counts as the screen, exactly like a piece.
            screened = true;
            continue;
          }
          // Past exactly one screen: the first occupied point is the target.
          if (!blocked) continue;
          if (landable(target)) out.push(target);
          break;
        }
      }
      break;
    }
    case 'soldier': {
      for (const target of soldierSteps(square, color)) {
        if (landable(target)) out.push(target);
      }
      break;
    }
  }
  return out;
}

// ── The facing rule (D5) ───────────────────────────────────────────────────

function generalSquare(board: DuckXiangqiBoard, color: DuckXiangqiColor): DuckXiangqiSquare | null {
  for (const square of allDuckXiangqiSquares()) {
    const piece = board[square];
    if (piece && piece.role === 'general' && piece.color === color) return square;
  }
  return null;
}

/**
 * Do the two generals bear on each other down a clear file?
 *
 * No longer a legality test. Since D5 changed, this is a THREAT predicate: it
 * says the side to move can capture the enemy general outright by flying down
 * the file, and equivalently that the side who just moved has blundered. Kept
 * exported for the UI and the diagrams, which want to mark the position rather
 * than forbid it.
 *
 * The duck counts as a blocker (D1), so a duck standing on the file is what
 * holds the position together, and it has to move every turn.
 */
export function duckXiangqiGeneralsFace(
  board: DuckXiangqiBoard,
  duck: DuckXiangqiSquare | undefined,
): boolean {
  const red = generalSquare(board, 'red');
  const black = generalSquare(board, 'black');
  if (!red || !black) return false;
  const a = duckXiangqiCoordOf(red);
  const b = duckXiangqiCoordOf(black);
  if (a.file !== b.file) return false;
  const lo = Math.min(a.rank, b.rank) + 1;
  const hi = Math.max(a.rank, b.rank);
  for (let rank = lo; rank < hi; rank++) {
    if (occupied(board, duck, duckXiangqiSquareOf(a.file, rank))) return false;
  }
  return true;
}

/** The board a piece move produces. */
function boardAfterMove(
  board: DuckXiangqiBoard,
  from: DuckXiangqiSquare,
  to: DuckXiangqiSquare,
): DuckXiangqiBoard {
  const next: DuckXiangqiBoard = { ...board };
  const piece = next[from];
  delete next[from];
  if (piece) next[to] = piece;
  return next;
}

function capturesGeneral(
  board: DuckXiangqiBoard,
  to: DuckXiangqiSquare,
  mover: DuckXiangqiColor,
): boolean {
  const target = board[to];
  return target !== undefined && target.role === 'general' && target.color !== mover;
}

// ── Legal turns ────────────────────────────────────────────────────────────

/**
 * Where the duck may go after a piece has moved from `from` to `to`.
 *
 * Two constraints, both mechanical: the point must be empty on the board the
 * move produced (so the vacated `from` is available and `to` is not), and it
 * must differ from where the duck already is, because the duck may never stand
 * still.
 *
 * There is no third constraint since D5 changed. The duck may leave the general
 * file open; that is a losing placement, not an illegal one, and the player is
 * the one who has to notice. This also removed the special case that used to
 * dominate the cost here.
 */
export function duckXiangqiDuckDestinations(
  board: DuckXiangqiBoard,
  duck: DuckXiangqiSquare | undefined,
  from: DuckXiangqiSquare,
  to: DuckXiangqiSquare,
): DuckXiangqiSquare[] {
  const next = boardAfterMove(board, from, to);
  const out: DuckXiangqiSquare[] = [];
  for (const square of allDuckXiangqiSquares()) {
    if (next[square] !== undefined) continue;
    if (duck === square) continue;
    out.push(square);
  }
  return out;
}

/**
 * The legal xiangqi moves for the piece on `square` - the FIRST half of a turn,
 * complete on its own.
 *
 * Identical to the pseudo-moves since D5 changed: there is no move a general
 * can be forbidden from making, because there is nothing left to be in check
 * from. Opening the general file is a move you are allowed to play and usually
 * lose to, exactly like stepping in front of a chariot.
 */
export function duckXiangqiMovesFrom(
  board: DuckXiangqiBoard,
  duck: DuckXiangqiSquare | undefined,
  square: DuckXiangqiSquare,
): DuckXiangqiSquare[] {
  return duckXiangqiPseudoMovesFrom(board, duck, square);
}

/**
 * Every legal turn for the side to move.
 *
 * Both halves are filtered, and the duck stays where it is for the first check:
 * a duck already blocking the general file is still blocking it while the piece
 * moves, and only has to keep blocking once it moves too.
 */
export function getDuckXiangqiLegalTurns(state: DuckXiangqiGameState): DuckXiangqiTurn[] {
  if (state.status.type !== 'playing') return [];
  const mover = state.status.turn;
  const { board, duck } = state;
  const out: DuckXiangqiTurn[] = [];

  for (const from of allDuckXiangqiSquares()) {
    const piece = board[from];
    if (!piece || piece.color !== mover) continue;
    for (const to of duckXiangqiMovesFrom(board, duck, from)) {
      // D4: capturing the general ends the game, so the duck never moves and
      // the facing rule has nothing left to constrain.
      if (capturesGeneral(board, to, mover)) {
        out.push({ from, to, duckTo: null });
        continue;
      }
      for (const duckTo of duckXiangqiDuckDestinations(board, duck, from, to)) {
        out.push({ from, to, duckTo });
      }
    }
  }
  return out;
}

/**
 * The legal piece moves for the side to move - the first half of every turn.
 *
 * Separated from `getDuckXiangqiLegalTurns` because almost nothing wants the
 * full cross product. At ~2,554 turns from the opening array, materialising it
 * is the expensive operation in this kernel, and a search or a playout wants
 * the ~44 moves and then one duck decision.
 */
export function getDuckXiangqiLegalPieceMoves(
  state: DuckXiangqiGameState,
): { from: DuckXiangqiSquare; to: DuckXiangqiSquare }[] {
  if (state.status.type !== 'playing') return [];
  const mover = state.status.turn;
  const out: { from: DuckXiangqiSquare; to: DuckXiangqiSquare }[] = [];
  for (const from of allDuckXiangqiSquares()) {
    const piece = state.board[from];
    if (!piece || piece.color !== mover) continue;
    for (const to of duckXiangqiMovesFrom(state.board, state.duck, from)) {
      out.push({ from, to });
    }
  }
  return out;
}

/**
 * Does the side to move have any legal turn? Short-circuits on the first one.
 *
 * This is the stalemate test (D9), and it must never be written as
 * `getDuckXiangqiLegalTurns(state).length === 0`: that builds thousands of turn
 * objects to answer a question the first legal move settles.
 */
export function hasDuckXiangqiLegalTurn(state: DuckXiangqiGameState): boolean {
  if (state.status.type !== 'playing') return false;
  const mover = state.status.turn;
  for (const from of allDuckXiangqiSquares()) {
    const piece = state.board[from];
    if (!piece || piece.color !== mover) continue;
    for (const to of duckXiangqiMovesFrom(state.board, state.duck, from)) {
      if (capturesGeneral(state.board, to, mover)) return true;
      if (duckXiangqiDuckDestinations(state.board, state.duck, from, to).length > 0) {
        return true;
      }
    }
  }
  return false;
}

/** Validates one turn directly, without materialising the whole turn list. */
export function isDuckXiangqiLegalTurn(
  state: DuckXiangqiGameState,
  turn: DuckXiangqiTurn,
): boolean {
  if (state.status.type !== 'playing') return false;
  const mover = state.status.turn;
  const piece = state.board[turn.from];
  if (!piece || piece.color !== mover) return false;
  if (!duckXiangqiMovesFrom(state.board, state.duck, turn.from).includes(turn.to)) {
    return false;
  }
  if (capturesGeneral(state.board, turn.to, mover)) {
    // The game ends on the capture, so the duck must NOT be given a destination.
    return turn.duckTo === null;
  }
  if (turn.duckTo === null) return false;
  return duckXiangqiDuckDestinations(state.board, state.duck, turn.from, turn.to).includes(
    turn.duckTo,
  );
}

// ── State ──────────────────────────────────────────────────────────────────

export function createInitialDuckXiangqiBoard(): DuckXiangqiBoard {
  const board: DuckXiangqiBoard = {};
  const back: DuckXiangqiPieceRole[] = [
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
    board[duckXiangqiSquareOf(file, 0)] = { color: 'red', role: back[file] };
    board[duckXiangqiSquareOf(file, 9)] = { color: 'black', role: back[file] };
  }
  for (const file of [1, 7]) {
    board[duckXiangqiSquareOf(file, 2)] = { color: 'red', role: 'cannon' };
    board[duckXiangqiSquareOf(file, 7)] = { color: 'black', role: 'cannon' };
  }
  for (const file of [0, 2, 4, 6, 8]) {
    board[duckXiangqiSquareOf(file, 3)] = { color: 'red', role: 'soldier' };
    board[duckXiangqiSquareOf(file, 6)] = { color: 'black', role: 'soldier' };
  }
  return board;
}

export function createInitialDuckXiangqiState(gameId: string): DuckXiangqiGameState {
  const state: DuckXiangqiGameState = {
    id: gameId,
    board: createInitialDuckXiangqiBoard(),
    // The duck starts OFF THE BOARD and enters on Red's first turn. There is no
    // starting point to choose, and the original is explicit about it.
    duck: undefined,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  state.positionCounts[duckXiangqiPositionRepetitionKey(state)] = 1;
  return state;
}

/**
 * The repetition key. D8: the duck's point is part of the position.
 *
 * Duck Chess never defined draw rules - the inventor wrote none, and the
 * implementations that have them inherited them from a chess base class. This
 * is our choice, and the argument is that a position with the duck somewhere
 * else is genuinely a different position: every piece's move set depends on it.
 */
export function duckXiangqiPositionRepetitionKey(state: DuckXiangqiGameState): string {
  const parts: string[] = [];
  for (const square of allDuckXiangqiSquares()) {
    const piece = state.board[square];
    if (piece) parts.push(`${square}:${piece.color[0]}${piece.role[0]}`);
  }
  const turn = state.status.type === 'playing' ? state.status.turn : '-';
  return `${parts.join(',')}|duck:${state.duck ?? '-'}|${turn}`;
}

export const DUCK_XIANGQI_REPETITION_LIMIT = 3;

/**
 * D8, measured rather than chosen: 60 moves without a capture is a draw.
 *
 * Repetition alone does not work here, and this was measured before it was
 * fixed: across 3,300 random games and 32 engine games, three-fold repetition
 * fired EXACTLY ZERO times. The duck's point is part of the position key (it
 * has to be - it changes every piece's move set), the duck moves every single
 * turn, and it has ~58 destinations, so two positions almost never match on
 * pieces AND side to move AND duck. The rule was correct and inert.
 *
 * A capture is the one irreversible event in this game, which makes it the
 * natural progress measure - the same shape as Benedict's clock on conversions,
 * and here it is not even an invention: 60 moves without a capture is xiangqi's
 * own limit. Duck Chess never defined draw rules at all, so this half of the
 * ruleset is ours either way.
 */
export const DUCK_XIANGQI_PROGRESS_LIMIT = 120;

export function applyDuckXiangqiTurn(
  state: DuckXiangqiGameState,
  turn: DuckXiangqiTurn,
): DuckXiangqiGameState {
  if (state.status.type !== 'playing') {
    throw new Error('game is not in progress');
  }
  if (!isDuckXiangqiLegalTurn(state, turn)) {
    throw new Error(`illegal turn: ${turn.from}${turn.to}@${turn.duckTo ?? '-'}`);
  }
  const mover = state.status.turn;
  const won = capturesGeneral(state.board, turn.to, mover);
  const captured = state.board[turn.to] !== undefined;
  const board = boardAfterMove(state.board, turn.from, turn.to);

  if (won) {
    return {
      ...state,
      board,
      // The duck does not move on a winning turn; it stays where it was.
      duck: state.duck,
      status: { type: 'finished', winner: mover, reason: 'general-captured' },
      moveNumber: state.moveNumber + 1,
      lastTurn: turn,
      progressPlies: 0,
    };
  }

  const next: DuckXiangqiGameState = {
    ...state,
    board,
    duck: turn.duckTo ?? undefined,
    status: { type: 'playing', turn: oppositeDuckXiangqiColor(mover) },
    moveNumber: state.moveNumber + 1,
    lastTurn: turn,
    // A capture is irreversible, so it resets the clock AND makes every earlier
    // position unreachable - keeping their counts would let a repetition fire
    // across a capture, which is not a repetition.
    progressPlies: captured ? 0 : state.progressPlies + 1,
    positionCounts: captured ? {} : { ...state.positionCounts },
  };

  const key = duckXiangqiPositionRepetitionKey(next);
  const count = (next.positionCounts[key] ?? 0) + 1;
  next.positionCounts[key] = count;
  if (count >= DUCK_XIANGQI_REPETITION_LIMIT) {
    next.status = { type: 'finished', winner: null, reason: 'repetition' };
    return next;
  }

  if (next.progressPlies >= DUCK_XIANGQI_PROGRESS_LIMIT) {
    next.status = { type: 'finished', winner: null, reason: 'progress' };
    return next;
  }

  // D9: a side with no legal turn LOSES. Xiangqi's rule, and the deliberate
  // divergence from Duck Chess, which inverts stalemate into a win. Checked
  // here rather than lazily so a finished game never reports itself playing.
  if (!hasDuckXiangqiLegalTurn(next)) {
    next.status = {
      type: 'finished',
      winner: mover,
      reason: 'stalemate',
    };
  }
  return next;
}

/**
 * Perfect information, so both seats get the same truth and `perspective` only
 * decides which way the board is drawn.
 */
export function getDuckXiangqiPlayerView(
  state: DuckXiangqiGameState,
  perspective: DuckXiangqiColor,
): DuckXiangqiPlayerView {
  const turn = state.lastTurn;
  return {
    id: state.id,
    perspective,
    board: state.board,
    duck: state.duck,
    // Always populated for the side to move, regardless of which seat is asking.
    //
    // An earlier version gated this on `turn === perspective`, reasoning that a
    // waiting client has no use for a move list. That was a nicety that created
    // a bug class: the client uses this list to validate its own selection, so
    // an empty list makes every selection reconcile itself away instantly and
    // the board silently refuses to select anything. Perfect information means
    // there is nothing to hide here anyway.
    legalPieceMoves: state.status.type === 'playing' ? getDuckXiangqiLegalPieceMoves(state) : [],
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: turn ? { from: turn.from, to: turn.to } : undefined,
    lastDuck: turn?.duckTo ?? undefined,
  };
}
