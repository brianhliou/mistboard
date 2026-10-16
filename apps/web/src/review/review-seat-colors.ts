import { t } from '../i18n/catalog.js';

/**
 * The two analysis SLOTS are always named 'red'/'black' -- they are move-order
 * positions, not colours -- and this maps a slot to the ink it actually renders as.
 *
 * The distinction is load-bearing, and collapsing it has now caused the same bug
 * twice. Flip variants (Banqi, Flip Jungle) bind their ink on the opening reveal,
 * so a raw seat is the wrong colour in half of all games. Chess never flips, but
 * its FIRST seat plays White, so every surface that took the slot name literally
 * painted a chess player's disc, bar or chart area RED.
 */
export type ReviewSeat = 'red' | 'black';

/** The ink a slot renders as. Wider than ReviewSeat on purpose: chess has no red. */
export type ReviewInk = 'red' | 'black' | 'white';

export type ReviewSeatColors = Readonly<Record<ReviewSeat, ReviewInk>>;

/** Resolve the ink used to display an analysis seat. A variant whose seats already
 *  ARE their colours omits the mapping and passes straight through. */
export function reviewColorForSeat(
  seat: ReviewSeat,
  colors: ReviewSeatColors | undefined,
): ReviewInk {
  return colors?.[seat] ?? seat;
}

/** The chess family: the first-mover seat plays White, the second Black. */
export const CHESS_SEAT_COLORS: ReviewSeatColors = { red: 'white', black: 'black' };

/** The word for an ink ("Red", "Black", "White"), as the accuracy summary and the
 *  move-times totals both label a side. */
export function reviewInkLabel(ink: ReviewInk): string {
  if (ink === 'white') return t('summary.white');
  return ink === 'red' ? t('summary.red') : t('summary.black');
}
