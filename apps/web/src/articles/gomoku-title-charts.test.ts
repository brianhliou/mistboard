import { describe, expect, it } from 'vitest';
import decisive from './content/gomoku-title-decisive.json' with { type: 'json' };
import { gameLengthChartSvg, resultLinesChartSvg } from './gomoku-title-charts.js';

const rects = (svg: string) => [...svg.matchAll(/<rect [^>]*><title>([^<]*)<\/title>/g)].map((m) => m[1]);

describe('Gomoku title match charts', () => {
  it('draws one bar per ten-move bin, empty bins included, then the draws', () => {
    const L = decisive.lengths;
    const titles = rects(gameLengthChartSvg(L));
    const first = L.bins[0]!.from;
    const last = L.bins.at(-1)!.from;
    expect(titles).toHaveLength((last - first) / L.binMoves + 1 + 1);
    expect(titles.at(-1)).toBe(`Draws: ${L.draws} games, ${L.drawMoves} moves each`);
    // 140-149 has no game in the record: its bar is there, at zero.
    expect(titles).toContain('140 to 149 moves: 0 games');
    for (const b of L.bins) {
      expect(titles).toContain(`${b.from} to ${b.from + L.binMoves - 1} moves: ${b.games} games`);
    }
  });

  it('reads its bars from the record it is given, not a copy', () => {
    const planted = { ...decisive.lengths, bins: [{ from: 20, games: 7 }], draws: 3, decisiveMedian: 25 };
    const svg = gameLengthChartSvg(planted);
    expect(rects(svg)).toEqual(['20 to 29 moves: 7 games', 'Draws: 3 games, 220 moves each']);
    expect(svg).toContain('median 25 moves');
  });

  it('draws a line per result with every trajectory point in its tooltip', () => {
    const T = decisive.trajectory;
    const svg = resultLinesChartSvg(T);
    expect(svg.match(/<path /g)).toHaveLength(3);
    for (const [name, line] of [
      ['Rapfi won', T.wins],
      ['drawn', T.draws],
      ['Rapfi lost', T.losses],
    ] as const) {
      for (const p of line) {
        expect(svg).toContain(
          `${name}, ${p.stones} to ${p.stones + T.binStones - 1} stones: ${Math.round(p.chance * 100)}% over ${p.games} games`,
        );
      }
    }
  });

  it('counts games, not readings, in the trajectory hover text', () => {
    const T = decisive.trajectory;
    for (const line of [T.wins, T.draws, T.losses]) {
      for (const p of line) {
        expect(p.games).toBeLessThanOrEqual(p.readings);
        expect(p.readings).toBeLessThanOrEqual(2 * p.games);
      }
    }
    expect([T.wins[0].games, T.draws[0].games, T.losses[0].games]).toEqual([113, 61, 25]);
  });
});
