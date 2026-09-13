// Reconstruct the per-ply remaining-clock series for a finished tenant game from
// its postgame `timeline` (each move carries a wall-clock `at` ms) plus the game's
// Fischer time control. The generic tenant postgames carry no dense `clocks`
// array, but they DO carry move timestamps, so the
// showcase can show the real clocks the players actually had — not just a static
// time-control label.
//
// Reconstruction (Fischer): a mover's think time is the gap from the previous
// move (when it became their turn) to their own move; their remaining time after
// the move is prev - spent + increment. The first mover's think time is measured
// from the game start.

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

// Per-ply playback delays derived from the same move timestamps, so the showcase
// replays each move at (a clamped version of) the real time it took rather than a
// fixed pace. delays[p] = how long to show ply p-1 before revealing ply p (i.e.
// the think time for move p); the side to move drains its clock across it.
// Clamped to [minMs, maxMs] so a blitz move is still visible and a long think does
// not stall the loop. delays[0] is unused.
export function reconstructMoveDelays(args: {
  moves: readonly ShowcaseTimelineMove[];
  minMs: number;
  maxMs: number;
}): number[] {
  const ordered = [...args.moves].sort((a, b) => a.ply - b.ply);
  const delays: number[] = [0];
  let prevAt: number | null = null;
  for (const move of ordered) {
    // First move's think time is unknown (no game-start timestamp); show it briefly.
    const raw = prevAt === null ? args.minMs : Math.max(0, move.at - prevAt);
    delays.push(Math.min(args.maxMs, Math.max(args.minMs, raw)));
    prevAt = move.at;
  }
  return delays;
}

// series[0] = both sides at the initial time; series[p] = remaining after ply p.
// `firstColor` is the side that moves first (its remaining maps to `.first`).
export function reconstructShowcaseClocks(args: {
  moves: readonly ShowcaseTimelineMove[];
  startedAt: number | null;
  initialMs: number;
  incrementMs: number;
  firstColor: string;
}): Array<ShowcaseClockPair> {
  const { moves, startedAt, initialMs, incrementMs, firstColor } = args;
  const ordered = [...moves].sort((a, b) => a.ply - b.ply);
  const clock = { first: initialMs, second: initialMs };
  const series: Array<ShowcaseClockPair> = [{ ...clock }];
  let prevAt = startedAt;
  for (const move of ordered) {
    const side = move.color === firstColor ? 'first' : 'second';
    // Guard against missing/backwards timestamps: never charge negative time.
    const spent = prevAt === null ? 0 : Math.max(0, move.at - prevAt);
    clock[side] = Math.max(0, clock[side] - spent) + incrementMs;
    series.push({ ...clock });
    prevAt = move.at;
  }
  return series;
}
