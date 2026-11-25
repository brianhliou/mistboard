// How the KataGo jungle seat spends its clock.
//
// The allocator (liveBotMoveTime) hands every move a wall-time budget: a share
// of the bank plus most of the increment. KataGo cannot move faster than its
// process start plus two minimum stages (KATAGO_JUNGLE_MIN_MOVE_MS, ~2.25 s on
// prod), so at 1+1 a budget below that used to be spent anyway, ~2.2 s a move
// against a 1 s increment, and the bot lost a won game on time (jgl_29484585,
// 2026-11-12). Each move now picks the strongest mode whose measured floor fits
// its budget: KataGo when it does, otherwise MistyJungle searching for exactly
// the budget (the Rust binary, or the in-process search where that is off).
// Over-spending lowers the clock, which lowers the next budget, which picks the
// cheaper mode, so the loop settles instead of running the clock out.

import { KATAGO_JUNGLE_MIN_MOVE_MS } from './jungle-katago-engine.js';

/** Which engine made the move, as the decision artifact records it. */
export type KatagoJungleMoveMode = 'katago' | 'misty' | 'misty-ts';

/** The light mode's shortest search. The allocator's own floor is the same 50 ms. */
export const MISTY_LIGHT_MIN_MOVETIME_MS = 50;
// Process start and reply on top of the search: MistyJungle's `go movetime T`
// returned in T+3 to T+11 ms on this Mac (12 runs each at 50-400 ms, 2026-11-25),
// doubled for prod and rounded up.
const MISTY_LIGHT_OVERHEAD_MS = 30;
/** The cheapest move the seat can make: the light search's floor plus its start. */
export const MISTY_LIGHT_MIN_MOVE_MS = MISTY_LIGHT_MIN_MOVETIME_MS + MISTY_LIGHT_OVERHEAD_MS;

/** The mode a move with `budgetMs` of wall time plays in. */
export function katagoJungleMoveMode(
  budgetMs: number,
  light: Exclude<KatagoJungleMoveMode, 'katago'>,
): KatagoJungleMoveMode {
  return budgetMs >= KATAGO_JUNGLE_MIN_MOVE_MS ? 'katago' : light;
}

/** The light search's movetime: the budget less its start, never under the floor. */
export function mistyLightMovetimeMs(budgetMs: number): number {
  return Math.max(MISTY_LIGHT_MIN_MOVETIME_MS, Math.round(budgetMs - MISTY_LIGHT_OVERHEAD_MS));
}

/** In-process light search depth: depth 4 took up to 194 ms here, depth 2 up to 18. */
export function mistyTsLightDepth(budgetMs: number): number {
  return budgetMs >= 500 ? 4 : 2;
}

export type BotMoveModeFloor = { id: string; floorMs: number };

/** The seat's modes, strongest first, with the wall time each needs at least. */
export const KATAGO_JUNGLE_MODE_FLOORS: readonly BotMoveModeFloor[] = [
  { id: 'katago', floorMs: KATAGO_JUNGLE_MIN_MOVE_MS },
  { id: 'misty', floorMs: MISTY_LIGHT_MIN_MOVE_MS },
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
