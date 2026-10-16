// The chess-shell room's flip (toolbar button + `f`): one in-memory flag that
// every orientation source in the shell reads, the board (live-render.ts), the
// clock rows (live-clocks.ts) and the capture strips (live-captures.ts), so the
// three cannot disagree. The tenant rooms keep theirs in the core client
// (variant-tenant/live-client.ts). Per room visit, like the review pages' flip.
import type { Color } from '@mistboard/game';
import { oppositeColor } from './web-utils.js';

let flipped = false;

export function isBoardFlipped(): boolean {
  return flipped;
}

export function toggleBoardFlip(): void {
  flipped = !flipped;
}

export function resetBoardFlip(): void {
  flipped = false;
}

/** The colour drawn at the bottom, given the unflipped one. */
export function flippedBottom(color: Color): Color {
  return flipped ? oppositeColor(color) : color;
}
