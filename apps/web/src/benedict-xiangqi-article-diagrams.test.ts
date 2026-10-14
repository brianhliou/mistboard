import { describe, expect, it } from 'vitest';
import { XQ_PIECE_SIZE, XQ_VIEWBOX_PAD } from './articles/diagrams.js';
import { BENEDICT_PIE_FRAMES } from './benedict-xiangqi-article-diagrams.js';

describe('BENEDICT_PIE_FRAMES', () => {
  // #547: the crop's top edge ran 2px inside the rank-7 soldiers and cut their
  // tops. Each piece must sit wholly inside the frame or wholly outside it.
  it('crops between ranks, never through a piece', () => {
    expect(BENEDICT_PIE_FRAMES).toHaveLength(4);
    for (const frame of BENEDICT_PIE_FRAMES) {
      const svg = frame();
      const top = Number(svg.match(/viewBox="0 ([\d.]+) /)?.[1]);
      const centres = [...svg.matchAll(/data-piece-cy="([\d.]+)"/g)].map(
        (m) => Number(m[1]) + XQ_VIEWBOX_PAD,
      );
      expect(centres.length).toBe(32);
      for (const cy of centres) {
        const inside = cy - XQ_PIECE_SIZE / 2 >= top;
        const outside = cy + XQ_PIECE_SIZE / 2 <= top;
        expect(inside || outside, `piece at y=${cy} against crop ${top}`).toBe(true);
      }
      // Black's soldier rank (rank 7) is in shot.
      expect(centres.filter((cy) => cy - XQ_PIECE_SIZE / 2 >= top).length).toBeGreaterThanOrEqual(
        21,
      );
    }
  });
});
