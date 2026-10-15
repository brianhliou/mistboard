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

import {
  type BanqiCapturedView,
  type BanqiColor,
  type BanqiMove,
  type BanqiPieceRole,
  type BanqiPlayerBoard,
  type BanqiSquare,
  banqiHiddenPool,
  type HiddenPool,
} from '@mistboard/game';

export type BanqiOddsView = {
  board: BanqiPlayerBoard;
  captured: readonly BanqiCapturedView[];
};

export type BanqiRevealOdds = {
  /** Unseen identities, both inks: the face-down tiles on the board. */
  total: number;
  pool: HiddenPool<BanqiColor, BanqiPieceRole>;
};

export function banqiRevealOdds(view: BanqiOddsView): BanqiRevealOdds {
  const pool = banqiHiddenPool(view);
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
export function banqiFaceDownAtEnd<V extends BanqiOddsView & { ply: number }>(
  view: V,
  moves: readonly BanqiMove[],
): V | null {
  if (moves.length !== view.ply) return null;
  const flipped = new Set<BanqiSquare>();
  for (const move of moves) if (move.from === move.to) flipped.add(move.from);
  const board: BanqiPlayerBoard = {};
  for (const [square, entry] of Object.entries(view.board) as [
    BanqiSquare,
    BanqiPlayerBoard[BanqiSquare],
  ][]) {
    if (!entry) continue;
    board[square] = flipped.has(square) ? entry : { faceDown: true };
  }
  return { ...view, board };
}
