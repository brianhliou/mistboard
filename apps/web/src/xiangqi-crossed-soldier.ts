// One predicate for "draw this piece with the promoted-soldier art", shared by
// every surface that paints a xiangqi-family board square.
//
// It exists because the rule was open-coded at each renderer, and the copies
// drifted: the live board and the video frame had it, the article replay embed,
// the article diagrams and the whole fog surface did not, so the same soldier on
// the same square was a veteran in one place and a raw recruit in another. The
// river test itself belongs to the kernel (hasCrossedRiver), so this only adds
// the role check and gives the renderers a single name to import.
//
// Only the `international` and `international-flat` piece sets have crossed art;
// the rest ignore the flag, which is why passing it is always safe.

import { fortressXiangqiCrossedRiver, hasCrossedRiver, type XiangqiColor } from '@mistboard/game';

/**
 * `rank` is the 1-10 board rank (red's back rank is 1), matching coordOf().
 * Face-down pieces must NOT go through this: a jieqi back renders as a soldier
 * placeholder, and promoting it would assert a role the viewer has not seen.
 */
export function drawsCrossedSoldier(
  piece: { readonly color: XiangqiColor; readonly role: string },
  rank: number,
): boolean {
  return piece.role === 'soldier' && hasCrossedRiver(piece.color, rank);
}

/**
 * The same question for variants whose soldiers get the sideways step
 * unconditionally, so every soldier is a veteran and there is no rank to test:
 * Fortress Xiangqi (which
 * has a river but grants the step from move one anyway, see the 2026-07-03
 * VETERAN SOLDIERS note in variants-fortress-xiangqi.ts).
 *
 * Deliberately takes no rank: accepting one would invite a river test that does
 * not apply on these boards. Same face-down caveat as above, so callers on a
 * fog surface still gate this on `!shrouded`.
 */
export function drawsVeteranSoldier(piece: { readonly role: string }): boolean {
  return piece.role === 'soldier';
}

/**
 * The same question on the Fortress Xiangqi board, which is 7x8 with the river
 * between ranks 4 and 5 — NOT the 9x10 board hasCrossedRiver above assumes.
 *
 * They disagree on rank 5 for BOTH colours, and shipping drawsCrossedSoldier on
 * a fortress board is exactly that bug: on 2026-09-03 black soldiers drew
 * promoted a rank early (rank 5 is black's own bank there, but the 10-rank test
 * says black owns 6-10) and red soldiers drew unpromoted a rank late. Art only —
 * the kernel gates the sideways step on fortressXiangqiCrossedRiver — but the
 * board told the player the opposite of the rule.
 *
 * The river belongs to the board family, so each family gets its own export
 * rather than a rank argument callers can quietly pass the wrong scale to.
 */
export function drawsFortressCrossedSoldier(
  piece: { readonly color: XiangqiColor; readonly role: string },
  rank: number,
): boolean {
  return piece.role === 'soldier' && fortressXiangqiCrossedRiver(piece.color, rank);
}
