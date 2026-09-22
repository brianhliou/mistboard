import { describe, expect, it } from 'vitest';
import { xAxisTicks } from './stats-charts.js';

function days(from: string, count: number) {
  const start = new Date(`${from}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { date, completedGames: 0, cumulativeGames: 0 };
  });
}

describe('stats chart x-axis ticks', () => {
  // /stats stacks the weekly chart over the cumulative daily one. The weekly
  // chart ticks every fourth Monday back from the current week; the daily
  // chart used five evenly spaced days, so the two axes read "Aug 24" over
  // "Aug 25" and never lined up.
  it('ticks the same Mondays the weekly chart would, back from the last one', () => {
    // 2026-06-01 (a Monday) through 2026-09-22: 17 Mondays.
    const series = days('2026-06-01', 114);
    expect(xAxisTicks(series).map((tick) => tick.date)).toEqual([
      '2026-06-01',
      '2026-06-29',
      '2026-07-27',
      '2026-08-24',
      '2026-09-21',
    ]);
  });

  it('ticks every second Monday on a shorter series, every one when very short', () => {
    // Eight Mondays (06-01 .. 07-20), anchored on the last: every second one.
    expect(xAxisTicks(days('2026-06-01', 56)).map((t) => t.date)).toEqual([
      '2026-06-08',
      '2026-06-22',
      '2026-07-06',
      '2026-07-20',
    ]);
    expect(xAxisTicks(days('2026-06-01', 15)).map((t) => t.date)).toEqual([
      '2026-06-01',
      '2026-06-08',
      '2026-06-15',
    ]);
  });

  it('places each tick at the day index, so the last Monday is not the right edge', () => {
    const series = days('2026-06-01', 114);
    const last = xAxisTicks(series).at(-1);
    expect(last?.position).toBeCloseTo(112 / 113);
  });

  it('falls back to the two ends when the series holds no Monday', () => {
    expect(xAxisTicks(days('2026-06-02', 5)).map((t) => t.date)).toEqual([
      '2026-06-02',
      '2026-06-06',
    ]);
  });
});
