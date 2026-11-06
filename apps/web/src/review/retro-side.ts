import type { ReviewMetaPlayer } from './game-review-meta.js';
import type { RetroSide } from './retro.js';

/** Resolve a played account seat using only explicit public identity. Missing or
 * redacted handles fail closed; display names and browser seat tokens do not
 * prove that the current account played. Retro uses analysis slots, so callers
 * whose seats are not red/black must supply their slot-to-seat mapping. */
export function retroSideForViewer(
  players: readonly Pick<ReviewMetaPlayer, 'color' | 'kind' | 'handle' | 'botId'>[] | undefined,
  viewer: { handle: string } | null,
  firstSeat = 'red',
  secondSeat = 'black',
): RetroSide | null {
  if (!viewer?.handle) return null;
  const matches = players?.filter(
    (player) =>
      player.kind === 'account' &&
      !player.botId &&
      player.handle === viewer.handle &&
      (player.color === firstSeat || player.color === secondSeat),
  );
  if (matches?.length !== 1) return null;
  return matches[0]!.color === firstSeat ? 'red' : 'black';
}
