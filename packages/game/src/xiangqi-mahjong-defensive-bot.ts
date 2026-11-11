/** Offline challenger only; the production bot remains unchanged until promotion. */

import type { XmjTile } from './xiangqi-mahjong.js';
import { xmjBotAction, xmjDistance, xmjUnseen } from './xiangqi-mahjong-bot-baseline.js';
import { xmjDealInProbability } from './xiangqi-mahjong-danger.js';
import type { XmjAction, XmjPlayerView, XmjSeat } from './xiangqi-mahjong-room.js';

/** Provisional tuning parameter in baseline-out units, independent of offence. */
export const XMJ_DANGER_WEIGHT = 4;

export function xmjDefensiveAction(
  view: XmjPlayerView,
  seat: XmjSeat,
  dangerWeight = XMJ_DANGER_WEIGHT,
): XmjAction | null {
  if (!Number.isFinite(dangerWeight) || dangerWeight < 0) {
    throw new RangeError('Danger weight must be finite and nonnegative');
  }
  const baseline = xmjBotAction(view, seat);
  if (dangerWeight === 0 || baseline?.action !== 'discard') return baseline;
  const opponent = seat === 'east' ? 'west' : 'east';
  const unseen = xmjUnseen(view, seat);
  let pick: XmjTile = baseline.tile;
  let bestShort = Number.POSITIVE_INFINITY;
  let bestOuts = Number.NEGATIVE_INFINITY;
  for (const tile of view.legal.discard) {
    const rest = [...(view.hands[seat] ?? [])];
    rest.splice(rest.indexOf(tile), 1);
    const offence = xmjDistance(rest, view.melds[seat], unseen);
    const danger = xmjDealInProbability(
      tile,
      unseen,
      view.handCounts[opponent],
      view.melds[opponent],
    );
    const adjustedOuts = offence.outs - dangerWeight * danger;
    // Preserve distance as the primary objective, then apply a small risk cost
    // to the existing outs count. Claims and all immediate wins stay frozen.
    if (offence.short < bestShort || (offence.short === bestShort && adjustedOuts > bestOuts)) {
      pick = tile;
      bestShort = offence.short;
      bestOuts = adjustedOuts;
    }
  }
  return { action: 'discard', tile: pick };
}
