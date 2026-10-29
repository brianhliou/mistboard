import { describe, expect, it } from 'vitest';
import { RETIRED_VARIANTS_THUMBNAIL } from '../retired-variants-diagrams.js';
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

    // Both keep the wood board box.
    for (const svg of [intersection, cell]) {
      expect(svg).toContain('class="xq-diagram-bg"');
    }
  });

  // The square grid is drawn the way the live square grid draws it
  // (xiangqi-board-surface.ts): alternating squares, a blue river band and a
  // tinted block per palace. The intersection board's palace cross and river
  // caption are its own cues, and on squares they read as a different board
  // (Brian, 2026-10-29).
  it('draws the square grid like the live board', () => {
    const intersection = renderStart('intersection');
    const cell = renderStart('cell');

    expect((cell.match(/xq-diagram-cell--light/g) ?? []).length).toBe(45);
    expect((cell.match(/xq-diagram-cell--dark/g) ?? []).length).toBe(45);
    expect((cell.match(/class="xq-diagram-cell-river"/g) ?? []).length).toBe(1);
    expect((cell.match(/class="xq-diagram-cell-palace"/g) ?? []).length).toBe(2);
    expect(cell).not.toContain('>楚</text>');
    expect(cell).not.toMatch(/<line [^>]*class="xq-diagram-line"/);

    // Planted contrast: the intersection board keeps its caption and cross.
    expect(intersection).toContain('>楚</text>');
    expect(intersection).toMatch(/<line [^>]*class="xq-diagram-line"/);
    expect(intersection).not.toContain('xq-diagram-cell--');
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

  it('ends the square grid at its outline, with no rounded wood round it', () => {
    const cell = renderStart('cell');
    expect(cell).not.toMatch(/class="xq-diagram-bg"[^>]*rx=|rx="[^"]*"[^>]*class="xq-diagram-bg"/);
    expect(renderStart('intersection')).toMatch(/rx="[^"]*" class="xq-diagram-bg"/);
  });

  it('crops a square-grid card at the outline and runs the river to its edge', () => {
    const viewBox = (svg: string) => (svg.match(/viewBox="([^"]+)"/)?.[1] ?? '').split(' ').map(Number);
    const card = (layout: 'intersection' | 'cell') =>
      withXiangqiBoardLayout(layout, () => RETIRED_VARIANTS_THUMBNAIL());
    const cell = card('cell');
    // Nine 30-wide cells plus the outline's outer half on each side.
    expect(viewBox(cell)[2]).toBeCloseTo(9 * 30 + 1);
    expect((cell.match(/class="xq-diagram-cell-river"/g) ?? []).length).toBe(2);
    // The intersection card keeps its wood margin past the a and i files.
    expect(viewBox(card('intersection'))[2]).toBeGreaterThan(9 * 30 + 1);
    expect(card('intersection').match(/class="xq-diagram-cell-river"/g)).toBeNull();
  });

  it('marks a blast on squares as the cell under the tile, not a ring over it', () => {
    const cell = withXiangqiBoardLayout('cell', () => RETIRED_VARIANTS_THUMBNAIL());
    const intersection = withXiangqiBoardLayout('intersection', () => RETIRED_VARIANTS_THUMBNAIL());
    expect(cell).not.toContain('xq-marker--blast"');
    expect(cell).toContain('xq-marker--blast-cell');
    // Under the pieces: every blast square is drawn before the first piece.
    expect(cell.indexOf('xq-diagram-piece-slot')).toBeGreaterThan(0);
    expect(cell.lastIndexOf('xq-marker--blast-cell')).toBeLessThan(cell.indexOf('xq-diagram-piece-slot'));
    expect(intersection).toContain('<circle class="xq-marker--blast"');
    expect(intersection).not.toContain('xq-marker--blast-cell');
  });
});
