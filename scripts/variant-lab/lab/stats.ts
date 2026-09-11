// The handful of numbers every measurement reports, computed one way.

import type { GameRecord, LabColor } from './types.js';

export type Interval = { p: number; halfWidth: number; n: number };

/** Wald 95% interval on a proportion; enough to say whether 50% is inside. */
export function waldInterval(successes: number, trials: number): Interval {
  if (trials === 0) return { p: 0, halfWidth: 0, n: 0 };
  const p = successes / trials;
  return { p, halfWidth: 1.96 * Math.sqrt((p * (1 - p)) / trials), n: trials };
}

/** Elo difference implied by a score; ±Infinity at the extremes. */
export function eloFromScore(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const elo = -400 * Math.log10(1 / p - 1);
  return elo === 0 ? 0 : elo;
}

export type LengthSummary = { min: number; median: number; max: number; mean: number };

export function summarizeLengths(lengths: readonly number[]): LengthSummary {
  if (lengths.length === 0) return { min: 0, median: 0, max: 0, mean: 0 };
  const sorted = [...lengths].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    min: sorted[0]!,
    median: sorted[Math.floor(sorted.length / 2)]!,
    max: sorted[sorted.length - 1]!,
    mean: Math.round(mean * 10) / 10,
  };
}

export function histogram(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export type Tally = {
  games: number;
  red: number;
  black: number;
  undecided: number;
  /** Red's share of DECIDED games, the first-mover figure. */
  redScore: Interval;
  lengths: LengthSummary;
  endReasons: Record<string, number>;
};

export function tally(games: readonly GameRecord[]): Tally {
  const red = games.filter((g) => g.winner === 'red').length;
  const black = games.filter((g) => g.winner === 'black').length;
  return {
    games: games.length,
    red,
    black,
    undecided: games.length - red - black,
    redScore: waldInterval(red, red + black),
    lengths: summarizeLengths(games.map((g) => g.plies)),
    endReasons: histogram(games.map((g) => g.reason)),
  };
}

export function otherColor(color: LabColor): LabColor {
  return color === 'red' ? 'black' : 'red';
}

export function pct(interval: Interval): string {
  return `${(100 * interval.p).toFixed(1)}% ± ${(100 * interval.halfWidth).toFixed(1)} (n=${interval.n})`;
}
