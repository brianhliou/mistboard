import { describe, expect, it } from 'vitest';
import {
  LUCK_DIE_OFFSET_RATIO,
  LUCK_DIE_RATIO,
  type LuckMarkBounds,
  luckDieIconSvg,
  svgBoardLuckMark,
} from './board-luck-mark.js';
import { GLYPH_OFFSET_RATIO, GLYPH_RADIUS_RATIO } from './svg-board-marker.js';

// The jieqi board's geometry (live-jieqi-render.ts): CELL 72, MARGIN 42, piece 65.
const CELL = 72;
const MARGIN = 42;
const PIECE = 65;
const SIZES = { piece: PIECE, cell: CELL };
const CENTER = { x: 300, y: 300 };
// The die's white edge (board-luck-mark.css) is part of its footprint.
const STROKE = 2;

function numbers(svg: string, attr: string): number[] {
  return [...svg.matchAll(new RegExp(`\\b${attr}="([-\\d.]+)"`, 'g'))].map((m) => Number(m[1]));
}

function cube(svg: string): { x: number; y: number; side: number } {
  const rect = svg.match(/<rect class="luck-mark__cube"[^>]*>/)?.[0] ?? '';
  const [x = Number.NaN] = numbers(rect, 'x');
  const [y = Number.NaN] = numbers(rect, 'y');
  const [side = Number.NaN] = numbers(rect, 'width');
  return { x, y, side };
}

const draw = (luck: number, center = CENTER, bounds?: LuckMarkBounds): string =>
  svgBoardLuckMark({ luck }, center, SIZES, 'd3', bounds);

describe('the luck die', () => {
  it('is a numberless die, glyph-sized, a corner badge on the piece’s lower-left', () => {
    const svg = draw(-35);
    expect(svg).not.toContain('<text');
    const { x, y, side } = cube(svg);
    const centre = { x: x + side / 2, y: y + side / 2 };
    const offset = CELL * LUCK_DIE_OFFSET_RATIO;
    expect(centre.x).toBeCloseTo(CENTER.x - offset);
    expect(centre.y).toBeCloseTo(CENTER.y + offset);
    expect(side).toBeCloseTo(CELL * LUCK_DIE_RATIO);
    // Same size class as the glyph disc: within 10% of its diameter.
    expect(side / (CELL * GLYPH_RADIUS_RATIO * 2)).toBeGreaterThan(0.9);
    expect(side / (CELL * GLYPH_RADIUS_RATIO * 2)).toBeLessThanOrEqual(1.5);
  });

  it('sits further out than the glyph’s mirror: centre past the rim, still touching the disc', () => {
    expect(LUCK_DIE_OFFSET_RATIO).toBeGreaterThan(GLYPH_OFFSET_RATIO);
    const { x, y, side } = cube(draw(8));
    const centreDist = Math.hypot(x + side / 2 - CENTER.x, y + side / 2 - CENTER.y);
    expect(centreDist).toBeGreaterThan(PIECE / 2);
    // The die's inner corner (top-right) is on the disc, so it reads as pinned to the piece.
    const inner = Math.hypot(x + side - CENTER.x, y - CENTER.y);
    expect(inner).toBeLessThan(PIECE / 2);
  });

  it('stays clear of the glyph and of the neighbouring points’ pieces', () => {
    const { x, y, side } = cube(draw(8));
    const right = x + side + STROKE / 2;
    const top = y - STROKE / 2;
    const left = x - STROKE / 2;
    const bottom = y + side + STROKE / 2;
    // The glyph disc sits up and right; the die never crosses the point's centre lines.
    expect(right).toBeLessThan(CENTER.x);
    expect(top).toBeGreaterThan(CENTER.y);
    const glyph = {
      x: CENTER.x + CELL * GLYPH_OFFSET_RATIO,
      y: CENTER.y - CELL * GLYPH_OFFSET_RATIO,
    };
    expect(Math.hypot(right - glyph.x, top - glyph.y)).toBeGreaterThan(CELL * GLYPH_RADIUS_RATIO);
    // A piece one point left, one point down: the die's nearest corner stays off its disc.
    const leftPiece = { x: CENTER.x - CELL, y: CENTER.y };
    expect(Math.hypot(left - leftPiece.x, top - leftPiece.y)).toBeGreaterThan(PIECE / 2);
    const belowPiece = { x: CENTER.x, y: CENTER.y + CELL };
    expect(Math.hypot(right - belowPiece.x, bottom - belowPiece.y)).toBeGreaterThan(PIECE / 2);
  });

  it('stays inside the intersection board’s rounded corner, nudged by under 1.5 units', () => {
    // Point a0 from red's side: MARGIN in from the left edge, MARGIN up from the bottom.
    const boardHeight = MARGIN * 2 + 9 * CELL;
    const corner = { x: MARGIN, y: boardHeight - MARGIN };
    const bounds = { minX: 0, minY: 0, maxX: MARGIN * 2 + 8 * CELL, maxY: boardHeight };
    const free = cube(draw(8, corner));
    const clamped = cube(draw(8, corner, bounds));
    expect(Math.abs(clamped.x - free.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(clamped.y - free.y)).toBeLessThanOrEqual(1.5);
    // Two units clear of each edge, so its rounded corner sits inside the board's (rx 12.5).
    expect(clamped.x - STROKE / 2).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(clamped.y + clamped.side + STROKE / 2).toBeLessThanOrEqual(boardHeight - 2 + 1e-9);
  });

  it('is pulled back onto the square-grid board at an edge, either orientation', () => {
    // The square grid ends half a cell past the outer points (live board: 36 of 72).
    const bounds = { minX: MARGIN - CELL / 2, minY: MARGIN - CELL / 2, maxX: 0, maxY: 0 };
    bounds.maxX = bounds.minX + 9 * CELL;
    bounds.maxY = bounds.minY + 10 * CELL;
    const inside = (c: { x: number; y: number; side: number }): void => {
      expect(c.x - STROKE / 2).toBeGreaterThanOrEqual(bounds.minX);
      expect(c.y - STROKE / 2).toBeGreaterThanOrEqual(bounds.minY);
      expect(c.x + c.side + STROKE / 2).toBeLessThanOrEqual(bounds.maxX);
      expect(c.y + c.side + STROKE / 2).toBeLessThanOrEqual(bounds.maxY);
    };
    // Bottom-left point (red's a0, or black's i9 on a flipped board) and a left-edge point.
    const bottomLeft = { x: MARGIN, y: bounds.maxY - CELL / 2 };
    const leftEdge = { x: MARGIN, y: MARGIN + 3 * CELL };
    const unclamped = cube(draw(8, bottomLeft));
    expect(unclamped.x - STROKE / 2).toBeLessThan(bounds.minX);
    for (const point of [bottomLeft, leftEdge]) inside(cube(draw(8, point, bounds)));
    // The top-right corner point never needs the clamp: the die hangs down-left.
    const topRight = { x: bounds.maxX - CELL / 2, y: MARGIN };
    expect(cube(draw(8, topRight, bounds))).toEqual(cube(draw(8, topRight)));
  });

  it('rolls one pip per size bucket and colours by direction, grey when tiny', () => {
    const pips = (svg: string): number => svg.match(/class="luck-mark__pip"/g)?.length ?? 0;
    expect([1, 3, 7, -14, 25, -35].map((luck) => pips(draw(luck)))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(draw(1)).toContain('luck-mark--even');
    expect(draw(-1)).toContain('luck-mark--even');
    expect(draw(3)).toContain('luck-mark--lucky');
    expect(draw(-7)).toContain('luck-mark--unlucky');
  });

  it('carries the piece-sized hit disc the hover card measures', () => {
    const svg = draw(4);
    expect(svg).toContain('data-luck-square="d3"');
    const hit = svg.match(/<circle class="luck-mark__hit"[^>]*>/)?.[0] ?? '';
    expect(numbers(hit, 'cx')).toEqual([CENTER.x]);
    expect(numbers(hit, 'r')).toEqual([PIECE / 2]);
  });

  it('draws the same face as a standalone icon for the card', () => {
    const icon = luckDieIconSvg(-35);
    expect(icon).toContain('luck-mark--unlucky');
    expect(icon.match(/class="luck-mark__pip"/g)).toHaveLength(6);
  });
});
