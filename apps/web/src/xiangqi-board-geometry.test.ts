import { describe, expect, it } from 'vitest';
import {
  type XiangqiBoardGeometry,
  xiangqiBoardPoint,
  xiangqiBoardViewBox,
  xiangqiDisplayRow,
} from './xiangqi-board-geometry.js';

// The live board's config (mirrors xiangqi-board.ts).
const GEO: XiangqiBoardGeometry = {
  fileCount: 9,
  rankCount: 10,
  cell: 60,
  margin: 36,
  riverGap: 12,
};

describe('xiangqiDisplayRow', () => {
  it('puts red at the bottom and black at the top', () => {
    expect(xiangqiDisplayRow(1, 'red', 10)).toBe(9); // red back rank = last row
    expect(xiangqiDisplayRow(10, 'red', 10)).toBe(0);
    expect(xiangqiDisplayRow(1, 'black', 10)).toBe(0); // flips for black
    expect(xiangqiDisplayRow(10, 'black', 10)).toBe(9);
  });
});

describe('xiangqiBoardPoint', () => {
  it('places points on the grid in intersection layout', () => {
    // file 0, red back rank → left edge, bottom row.
    expect(xiangqiBoardPoint(0, 1, 'red', 'intersection', GEO)).toEqual({ x: 36, y: 36 + 9 * 60 });
    // top row is flush at the margin.
    expect(xiangqiBoardPoint(8, 10, 'red', 'intersection', GEO)).toEqual({ x: 36 + 8 * 60, y: 36 });
  });

  it('opens the river gap only for the bottom half in cell layout', () => {
    // Top half (rows 0..4) is unshifted; bottom half (rows 5..9) shifts by riverGap.
    const topHalf = xiangqiBoardPoint(0, 10, 'red', 'cell', GEO); // display row 0
    const bottomHalf = xiangqiBoardPoint(0, 1, 'red', 'cell', GEO); // display row 9
    expect(topHalf.y).toBe(36);
    expect(bottomHalf.y).toBe(36 + 9 * 60 + 12);
    // A row just above the river (display row 4) is not shifted; just below (5) is.
    expect(xiangqiBoardPoint(0, 6, 'red', 'cell', GEO).y).toBe(36 + 4 * 60);
    expect(xiangqiBoardPoint(0, 5, 'red', 'cell', GEO).y).toBe(36 + 5 * 60 + 12);
  });

  it('rotates for black: a1 sits top-right, i10 bottom-left', () => {
    // A 180 degree rotation, not a top-to-bottom mirror: black's view puts red's
    // a1 at the reader's top RIGHT. Every board flips through this function.
    expect(xiangqiBoardPoint(0, 1, 'black', 'intersection', GEO)).toEqual({
      x: GEO.margin + 8 * GEO.cell,
      y: GEO.margin,
    });
    expect(xiangqiBoardPoint(8, 10, 'black', 'intersection', GEO)).toEqual({
      x: GEO.margin,
      y: GEO.margin + 9 * GEO.cell,
    });
  });

  it('applies the origin offset', () => {
    const base = xiangqiBoardPoint(3, 4, 'red', 'intersection', GEO);
    const shifted = xiangqiBoardPoint(3, 4, 'red', 'intersection', GEO, 100, 200);
    expect(shifted).toEqual({ x: base.x + 100, y: base.y + 200 });
  });
});

describe('xiangqiBoardViewBox', () => {
  it('spans the outer lines in intersection layout', () => {
    expect(xiangqiBoardViewBox('intersection', GEO)).toEqual({
      minX: 0,
      minY: 0,
      width: 36 * 2 + 8 * 60,
      height: 36 * 2 + 9 * 60,
    });
  });

  it('spans full squares plus the river gap in cell layout', () => {
    expect(xiangqiBoardViewBox('cell', GEO)).toEqual({
      minX: 36 - 30,
      minY: 36 - 30,
      width: 9 * 60,
      height: 10 * 60 + 12,
    });
  });
});
