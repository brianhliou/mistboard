import { describe, expect, it } from 'vitest';
import { XIANGQI_PIECE_SETS } from '../xiangqi-piece-sets.js';
import { withXiangqiPieceSet, xqBoardSvg, xqVisionDemoState } from './diagrams.js';

// Horde Xiangqi's veterans drew as standard soldiers in every piece set but
// International (the only one with crossed-soldier art), so a reader on the
// Chinese-text sets could not tell the two armies apart. Every other set now
// marks them with a chevron badge.

const board = xqVisionDemoState('horde-veteran-mark', {
  a3: { color: 'red', role: 'soldier' },
  c3: { color: 'red', role: 'soldier' },
  e9: { color: 'black', role: 'general' },
  e6: { color: 'black', role: 'soldier' },
});

function marks(set: (typeof XIANGQI_PIECE_SETS)[number]['id'], veteranSoldiers: boolean): number {
  const svg = withXiangqiPieceSet(set, () =>
    xqBoardSvg({ state: board, x: 0, y: 0, label: '', veteranSoldiers }),
  );
  return svg.split('class="xq-veteran-mark"').length - 1;
}

describe('Horde veteran mark', () => {
  for (const { id } of XIANGQI_PIECE_SETS) {
    it(`${id}: marks each red veteran only when the board has veterans`, () => {
      expect(marks(id, true)).toBe(id === 'international' ? 0 : 2);
      expect(marks(id, false)).toBe(0);
    });
  }
});
