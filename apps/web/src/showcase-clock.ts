// Reconstruct the per-ply remaining-clock series for a finished tenant game from
// its postgame `timeline` (each move carries a wall-clock `at` ms) plus the game's
// Fischer time control. The generic tenant postgames carry no dense `clocks`
// array, but they DO carry move timestamps, so the
// showcase can show the real clocks the players actually had — not just a static
// time-control label.
//
// Reconstruction mirrors the server's clock (nextTenantClockForMove in
// apps/server/src/variant-tenant/runtime.ts, nextClockForMove in
// packages/game/src/clocks.ts):
//   - The clock starts frozen. Each side's FIRST move (plies 1 and 2) costs
//     nothing and earns the increment; the second mover's first move arms it.
//   - After that a mover is charged the gap since the previous move and earns
//     the increment.
//   - The game-ending move is charged but earns no increment.

export type ShowcaseTimelineMove = {
  at: number;
  color: string;
  ply: number;
};

// End-of-game seat marks: once a showcase game reaches its final ply the clocks
// flip to the result (1 winner / 0 loser / ½ draw) for the between-game hold, so
// a viewer catching the end sees who won. `first` = the first-mover (red/white)
// seat slot.
export function showcaseResultMarks(result: string): { first: string; second: string } {
  if (result === 'red-wins' || result === 'white-wins') return { first: '1', second: '0' };
  if (result === 'black-wins') return { first: '0', second: '1' };
  return { first: '½', second: '½' };
}

export type ShowcaseClockPair = { first: number; second: number };

// Plies played while the clock is still frozen (each side's first move). Two-seat
// tenants arm on the second mover's first move, so plies 1 and 2 are free.
export const SHOWCASE_PREARM_PLIES = 2;

// series[0] = both sides at the initial time; series[p] = remaining after ply p.
// `firstColor` is the side that moves first (its remaining maps to `.first`).
// `lastMoveEndsGame`: the final move in `moves` is the one that ended the game
// (mate, capture, no legal moves), so it earns no increment. False when the game
// ended some other way after it (resignation, timeout) or is still going.
export function reconstructShowcaseClocks(args: {
  moves: readonly ShowcaseTimelineMove[];
  initialMs: number;
  incrementMs: number;
  firstColor: string;
  lastMoveEndsGame?: boolean;
}): Array<ShowcaseClockPair> {
  const { moves, initialMs, incrementMs, firstColor } = args;
  const ordered = [...moves].sort((a, b) => a.ply - b.ply);
  const clock = { first: initialMs, second: initialMs };
  const series: Array<ShowcaseClockPair> = [{ ...clock }];
  let prevAt: number | null = null;
  ordered.forEach((move, index) => {
    const side = move.color === firstColor ? 'first' : 'second';
    const prearm = index < SHOWCASE_PREARM_PLIES;
    const ending = args.lastMoveEndsGame === true && index === ordered.length - 1;
    // Guard against missing/backwards timestamps: never charge negative time.
    const spent = prearm || prevAt === null ? 0 : Math.max(0, move.at - prevAt);
    const credit = prearm || !ending ? incrementMs : 0;
    clock[side] = Math.max(0, clock[side] - spent) + credit;
    series.push({ ...clock });
    prevAt = move.at;
  });
  return series;
}

// The pair to SHOW while the side to move thinks, `elapsedMs` into the think that
// follows ply `ply`. The mover counts down at one real second per second from the
// recorded value, and stops at the recorded think (`windowMs`): that is the value
// the move is charged, so it only ever moves down until the next ply lands and
// credits the increment. A pre-arm think (the clock was not running) and the idle
// side hold still.
export function projectShowcaseClock(args: {
  series: readonly ShowcaseClockPair[];
  ply: number;
  elapsedMs: number;
  windowMs: number;
  mover: 'first' | 'second';
}): ShowcaseClockPair {
  const at = args.series[Math.min(args.ply, args.series.length - 1)] ?? { first: 0, second: 0 };
  if (args.ply < SHOWCASE_PREARM_PLIES) return { ...at };
  const spent = Math.max(0, Math.min(args.elapsedMs, args.windowMs));
  return { ...at, [args.mover]: Math.max(0, at[args.mover] - spent) };
}
