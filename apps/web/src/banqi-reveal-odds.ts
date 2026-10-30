// Banqi reveal odds (#542) and the face-down tally a finished room keeps (#544),
// both pure functions of ONE masked view, so neither can know more than the
// viewer (CLAUDE.md "In-game aids bar": bookkeeping, never an evaluation).
//
// Banqi is the simple case next to jieqi (jieqi-reveal-odds.ts). All 32 tiles
// start face-down in one shuffled pool, a face-down tile carries no ink to
// anyone, and a face-down tile can never be captured or moved. So the pool of
// unseen identities, start minus revealed minus captured (banqiHiddenPool), is
// exact and the same for both seats and spectators, and every face-down tile
// draws from all of it, both inks together:
//   P(a face-down tile is red chariot) = unseen red chariots / unseen total.
// The denominator is the WHOLE pool (red and black), which is why each ink's
// percentages sum to that ink's share, not to 100%.
//
// Three Kingdoms banqi (#628) deals the same 32 pieces onto a bigger board and
// keeps every rule this relies on (a face-down tile is never moved or taken),
// so the same functions serve it; they are generic over the square type.

import {
  type BanqiCapturedView,
  type BanqiColor,
  type BanqiPieceRole,
  type BanqiPlayerBoard,
  type BanqiSquare,
  type BanqiVisibleBoardEntry,
  banqiHiddenPool,
  type HiddenPool,
} from '@mistboard/game';

/** A masked board on any banqi-family grid (banqi's 8x4, Three Kingdoms' 9x5). */
export type BanqiFamilyBoard<S extends string = BanqiSquare> = Partial<
  Record<S, BanqiVisibleBoardEntry>
>;

export type BanqiOddsView<S extends string = BanqiSquare> = {
  board: BanqiFamilyBoard<S>;
  captured: readonly BanqiCapturedView[];
};

export type BanqiRevealOdds = {
  /** Unseen identities, both inks: the face-down tiles on the board. */
  total: number;
  pool: HiddenPool<BanqiColor, BanqiPieceRole>;
};

export function banqiRevealOdds<S extends string>(view: BanqiOddsView<S>): BanqiRevealOdds {
  // The pool reads only the entries, never the squares they stand on, so a
  // board on another grid is the same input as far as it is concerned.
  const pool = banqiHiddenPool({ board: view.board as BanqiPlayerBoard, captured: view.captured });
  return { total: pool.red.total + pool.black.total, pool };
}

/** The chance one face-down tile is this piece, 0 when nothing is face-down. */
export function banqiRevealChance(
  odds: BanqiRevealOdds,
  color: BanqiColor,
  role: BanqiPieceRole,
): number {
  if (odds.total === 0) return 0;
  const count = odds.pool[color].entries.find((e) => e.role === role)?.count ?? 0;
  return count / odds.total;
}

/**
 * The view as it stood when play ended, face-down tiles masked again: a
 * finished room serves the truth view (every tile face up), which empties the
 * face-down tally. A tile is flipped in place (a self-move) and a face-down
 * tile never moves or is taken, and every square starts occupied, so the
 * squares the move log never flipped are exactly the face-down ones at the
 * end. Returns null when the log does not cover the whole game (the caller
 * then shows nothing rather than a wrong tally).
 */
export function banqiFaceDownAtEnd<S extends string, V extends BanqiOddsView<S> & { ply: number }>(
  view: V,
  moves: readonly { from: S; to: S }[],
): V | null {
  if (moves.length !== view.ply) return null;
  const flipped = new Set<S>();
  for (const move of moves) if (move.from === move.to) flipped.add(move.from);
  const board: BanqiFamilyBoard<S> = {};
  for (const [square, entry] of Object.entries(view.board) as [S, BanqiVisibleBoardEntry][]) {
    if (!entry) continue;
    board[square] = flipped.has(square) ? entry : { faceDown: true };
  }
  return { ...view, board };
}
