import { describe, expect, it } from 'vitest';
import {
  CRAZYHOUSE_XIANGQI_DROP_REGION_BOARD,
  CRAZYHOUSE_XIANGQI_RIVER_PAIR,
  CRAZYHOUSE_XIANGQI_START_BOARD,
} from './crazyhouse-xiangqi-rules-diagrams.js';

// The figures are drawn from the kernel and throw when it no longer supports
// their captions, so rendering them is the test.
describe('crazyhouse xiangqi rules diagrams', () => {
  for (const [name, render] of [
    ['START_BOARD', CRAZYHOUSE_XIANGQI_START_BOARD],
    ['DROP_REGION_BOARD', CRAZYHOUSE_XIANGQI_DROP_REGION_BOARD],
    ['RIVER_PAIR', CRAZYHOUSE_XIANGQI_RIVER_PAIR],
  ] as const) {
    it(`${name} renders an SVG`, () => {
      const svg = render();
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
    });
  }

  it('marks a drop point on every empty point of Red’s half: 45 points less 12 pieces', () => {
    expect(CRAZYHOUSE_XIANGQI_DROP_REGION_BOARD().match(/r="6\.5"/g)?.length).toBe(33);
  });

  it('gives the advisor and the elephant two targets each and crosses the two the river stops', () => {
    const svg = CRAZYHOUSE_XIANGQI_RIVER_PAIR();
    expect(svg.match(/r="6\.5"/g)?.length).toBe(4);
    // A cross is two strokes.
    expect(svg.match(/stroke="#d4351c"/g)?.length).toBe(8);
  });
});
