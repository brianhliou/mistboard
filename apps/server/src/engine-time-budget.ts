/**
 * Shared clock-aware per-move time allocator for the UCI-subprocess engine fleet.
 *
 * Consolidates the time-budget logic that was copy-pasted as a naive
 * `min(tierCap, remaining - safety)` clamp across the server engine loops
 * (banqi, drop-mini, fortress, jieqi, jungle, jungle-flip,
 * mini-xiangqi). Those clamps were NOT clock-aware — no increment, no
 * moves-to-go — so the bot always tried to burn the fixed tier cap regardless of
 * how much clock it had. This mirrors the moves-to-go + increment model the
 * FoW/dark family already uses (`server-dark-xiangqi-engine.ts` `budgetFor`,
 * `fow-engine-budget.ts` `computeEngineBudget`), so all three families share
 * one time-management model.
 *
 * For the node-budgeted FSF/Rust engines, the returned `computeBudgetMs` is a
 * `movetime` CEILING, not the strength knob: the tier's NODE budget is the
 * CPU-independent strength anchor and binds first when the clock is healthy;
 * this time budget only takes over under time pressure (solvency). Measured
 * rationale (FSF does ~900k nps local / ~333k prod on the 7x8 board, so an 800k
 * node budget needs ~2.4s on prod) lives in the fortress build-track doc.
 */

export type MoveBudgetInput = {
  /** Engine seat's remaining clock in ms, or null for an untimed game. */
  remainingMs: number | null;
  /** Per-move increment in ms (0 if none). */
  incrementMs: number;
  /** Upper bound on think time — the tier's latency ceiling. */
  ceilingMs: number;
  /** Assumed moves remaining, for bank division. Default 30. */
  movesToGoEstimate?: number;
  /** Clock reserve never spent (solvency buffer). Default 1000. */
  reserveMs?: number;
  /** Minimum think time while any clock remains. Default 50. */
  floorMs?: number;
  /** Fraction of the increment spent each move. Default 0.8. */
  incrementFraction?: number;
  /** Added to the budget for the outer watchdog timeout. Default 1000. */
  processOverheadMs?: number;
  /** Absolute watchdog cap. Default 60000. */
  maxWatchdogMs?: number;
  /** Extra grace over remaining for the watchdog. Default 2000. */
  clockGraceMs?: number;
};

export type MoveBudget = {
  /** ms to hand the engine as `movetime`. */
  computeBudgetMs: number;
  /** Outer watchdog timeout for the move (SIGKILL guard). */
  watchdogTimeoutMs: number;
};

/**
 * Allocate a per-move think budget from the remaining clock.
 *
 * Untimed → the full ceiling. Timed → `bank / movesToGo + fraction·increment`,
 * clamped to `[floor, ceiling]` and never exceeding the usable clock
 * (`remaining - reserve`). So it uses more time when the clock is healthy and
 * shrinks gracefully under pressure, increment-aware in both regimes.
 */
export function budgetForMove(input: MoveBudgetInput): MoveBudget {
  const {
    remainingMs,
    incrementMs,
    ceilingMs,
    movesToGoEstimate = 30,
    reserveMs = 1_000,
    floorMs = 50,
    incrementFraction = 0.8,
    processOverheadMs = 1_000,
    maxWatchdogMs = 60_000,
    clockGraceMs = 2_000,
  } = input;

  if (remainingMs === null) {
    return {
      computeBudgetMs: ceilingMs,
      watchdogTimeoutMs: Math.min(maxWatchdogMs, ceilingMs + processOverheadMs),
    };
  }

  const usable = Math.max(0, remainingMs - reserveMs);
  if (usable <= 0) {
    // Reserve is spent — a flag is imminent regardless; think the bare minimum.
    return {
      computeBudgetMs: floorMs,
      watchdogTimeoutMs: Math.max(1, Math.ceil(remainingMs + clockGraceMs)),
    };
  }

  const bankShare = usable / Math.max(1, movesToGoEstimate);
  const raw = bankShare + Math.max(0, incrementMs) * incrementFraction;
  const clamped = Math.min(ceilingMs, Math.max(floorMs, raw));
  // Never spend more than the usable clock (below `floor` only if that is all
  // that is left).
  const computeBudgetMs = Math.round(Math.min(clamped, usable));

  const watchdogTimeoutMs = Math.min(
    maxWatchdogMs,
    Math.ceil(computeBudgetMs + processOverheadMs),
    Math.ceil(remainingMs + clockGraceMs),
  );
  return { computeBudgetMs, watchdogTimeoutMs };
}
