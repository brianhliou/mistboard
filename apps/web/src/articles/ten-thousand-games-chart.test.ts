import { describe, expect, it } from 'vitest';
import record from './content/ten-thousand-games-record.json' with { type: 'json' };
import { weeklyGamesChartSvg } from './ten-thousand-games-chart.js';

// The month labels under the axis, with their x positions.
function monthLabels(svg: string): Array<{ month: string; x: number }> {
  return [...svg.matchAll(/<text x="([\d.]+)" y="182"[^>]*>([A-Z][a-z]{2})<\/text>/g)].map((m) => ({
    month: m[2]!,
    x: Number(m[1]),
  }));
}

// `count` Monday weeks from `first`, as many as the published chart has.
const weeksFrom = (first: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    weekStart: new Date(Date.parse(`${first}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10),
    games: 5,
  }));

describe('weeklyGamesChartSvg month labels', () => {
  it('drops a month label that has no room before the next one', () => {
    // One week of May, then June on: May's label would sit one bar from June's.
    const svg = weeklyGamesChartSvg(weeksFrom('2026-05-25', 23));
    expect(monthLabels(svg).map((l) => l.month)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
  });

  it('keeps every label in the published record at least a label width apart', () => {
    const labels = monthLabels(weeklyGamesChartSvg(record.weeks.slice(0, -1)));
    expect(labels.length).toBeGreaterThan(3);
    for (let i = 1; i < labels.length; i += 1) {
      expect(labels[i]!.x - labels[i - 1]!.x).toBeGreaterThanOrEqual(30);
    }
  });
});
