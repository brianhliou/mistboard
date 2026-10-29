import { describe, expect, it } from 'vitest';
import {
  withXiangqiBoardLayout,
  XQ_BOARD_W,
  XQ_START,
  xqBoardSvg,
} from './diagrams.js';

// Regression for the /rules/xiangqi "Square grid" board style: the article
// diagram renderer must honor the stored xiangqi board layout, not draw the
// intersection board unconditionally. See xiangqi-board-geometry.ts (the shared
// geometry core both this renderer and the live board consume).

function renderStart(layout: 'intersection' | 'cell'): string {
  return withXiangqiBoardLayout(layout, () =>
    xqBoardSvg({ state: XQ_START, x: 0, y: 0, label: 'START', perspective: 'red' }),
  );
}

describe('article xiangqi diagram layout', () => {
  it('draws the square grid (cells) only in cell layout', () => {
    const intersection = renderStart('intersection');
    const cell = renderStart('cell');

    // The square grid draws one 30x30 cell per point (9x10 = 90 squares); the
    // intersection board draws crossing lines and has none.
    const cellSquares = (cell.match(/width="30" height="30"/g) ?? []).length;
    expect(cellSquares).toBe(90);
    expect(intersection).not.toContain('width="30" height="30"');

    // Both keep the river label and the wood board box.
    for (const svg of [intersection, cell]) {
      expect(svg).toContain('>楚</text>');
      expect(svg).toContain('class="xq-diagram-bg"');
    }
  });

  it('keeps the cell board within the intersection board box', () => {
    // The smaller cell + centering pad keeps the square grid inside the SAME
    // footprint as the intersection board, so every diagram's outer size and
    // multi-board x-offsets are unchanged. The cell board's drawn extent must not
    // reach past the intersection board's (piece discs overhang the edge equally
    // in both, so an absolute [0, W] bound is not the right check).
    const xsOf = (svg: string) =>
      [...svg.matchAll(/[xX]1?="(-?\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    const intersectionXs = xsOf(renderStart('intersection'));
    const cellXs = xsOf(renderStart('cell'));
    expect(cellXs.length).toBeGreaterThan(0);
    expect(Math.min(...cellXs)).toBeGreaterThanOrEqual(Math.min(...intersectionXs));
    expect(Math.max(...cellXs)).toBeLessThanOrEqual(Math.max(...intersectionXs));
    expect(Math.max(...cellXs)).toBeLessThanOrEqual(XQ_BOARD_W);
  });

  it('shifts a piece off the board edge in cell layout', () => {
    // In the intersection board the corner piece sits on the margin line; in the
    // cell board it sits inside a cell, so its glyph origin moves inward.
    const intersection = renderStart('intersection');
    const cell = renderStart('cell');
    expect(intersection).not.toEqual(cell);
  });
});
