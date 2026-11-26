// Can the KataGo jungle seat keep up with every clock it is offered?
//
// The allocator (liveBotMoveTime) hands every move a wall-time budget: a share
// of the bank plus most of the increment, and the move sizes its two stages to
// what is left once it reaches the shared process (jungle-katago-engine.ts). A
// move can still never cost less than the seat's floor: on the loaded process
// its overhead plus two minimum stages (~0.85 s on prod). When a process was
// started per move that floor was ~2.25 s against a 1 s increment, and the seat
// lost a won 1+1 game on time (jgl_29484585, 2026-11-12). The check below fails
// any offered pace whose increment does not pay for the floor over a long game.

import { KATAGO_JUNGLE_MIN_MOVE_MS } from './jungle-katago-engine.js';

export type BotMoveModeFloor = { id: string; floorMs: number };

/** The seat's cheapest move: KataGo on the loaded process. There is no cheaper
 *  engine to fall back on (Decided 2026-11-25). */
export const KATAGO_JUNGLE_MODE_FLOORS: readonly BotMoveModeFloor[] = [
  { id: 'katago-warm', floorMs: KATAGO_JUNGLE_MIN_MOVE_MS },
];

/** A game is this many bot moves long at most, for the coverage check below. */
export const BOT_MOVES_COVERED = 200;

/**
 * Time controls the seat could lose on time merely by moving: its cheapest
 * mode's floor exceeds the increment, and the starting clock does not cover the
 * shortfall for `movesCovered` moves. Empty means every offered pace is safe.
 */
export function clockCoverageViolations(
  modes: readonly BotMoveModeFloor[],
  timeControls: readonly { id: string; initialMs: number; incrementMs: number }[],
  movesCovered = BOT_MOVES_COVERED,
): Array<{ id: string; cheapestFloorMs: number; incrementMs: number; shortfallMs: number }> {
  const cheapest = Math.min(...modes.map((mode) => mode.floorMs));
  return timeControls.flatMap((tc) => {
    const deficit = cheapest - tc.incrementMs;
    if (deficit <= 0 || tc.initialMs >= deficit * movesCovered) return [];
    return [
      {
        id: tc.id,
        cheapestFloorMs: cheapest,
        incrementMs: tc.incrementMs,
        shortfallMs: deficit * movesCovered - tc.initialMs,
      },
    ];
  });
}
