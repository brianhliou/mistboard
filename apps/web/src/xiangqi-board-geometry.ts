// Shared xiangqi board geometry — the single source of truth for where points,
// grid lines, and the board viewBox sit under each layout. Both the live board
// renderer (xiangqi-board.ts, CELL=60) and the article/rules-page diagram
// renderer (articles/diagrams.ts, a smaller scale) consume these so the
// 'intersection' vs 'cell' (Square grid) layouts stay in lockstep across every
// surface. Pure math: no DOM, no SVG, no storage reads.

import type { XiangqiColor } from '@mistboard/game';
import { XIANGQI_PIECE_REACH } from './board-metrics.js';
import type { XiangqiBoardLayout } from './xiangqi-appearance-storage.js';

/** Board dimensions in board units + the pixel scale, so one transform serves
 *  every scale (live board, article diagram) by swapping the config. `margin` is
 *  the gap from the viewBox origin to the first intersection; `riverGap` is the
 *  extra vertical space the 'cell' layout opens between the two halves. */
export interface XiangqiBoardGeometry {
  fileCount: number;
  rankCount: number;
  cell: number;
  margin: number;
  riverGap: number;
  /** Space reserved OUTSIDE the board for coordinate labels, in board units.
   *  Reserved permanently rather than added when labels are switched on, so
   *  toggling the preference never resizes the board or reflows the page around
   *  it. Omit (or 0) for a board that shows no coordinates. */
  coordGutter?: number;
}

/** The 0-indexed row (from the top) that a 1-indexed rank occupies under a given
 *  perspective. Red sits at the bottom, so its back rank (1) is the last row. */
export function xiangqiDisplayRow(
  rank: number,
  perspective: XiangqiColor,
  rankCount: number,
): number {
  return perspective === 'red' ? rankCount - rank : rank - 1;
}

/** The 0-indexed column a 0-indexed file occupies under a given perspective.
 *  Black sees the board rotated, so its own right-hand file sits on the left. */
export function xiangqiDisplayFile(
  file: number,
  perspective: XiangqiColor,
  fileCount: number,
): number {
  return perspective === 'red' ? file : fileCount - 1 - file;
}

/** Pixel center of a (file, rank) point. In 'cell' layout the bottom half is
 *  pushed down by `riverGap` to open the river band; `originX/Y` shifts the whole
 *  board (used when several boards are composited into one SVG). */
export function xiangqiBoardPoint(
  file: number,
  rank: number,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
  geo: XiangqiBoardGeometry,
  originX = 0,
  originY = 0,
): { x: number; y: number } {
  const row = xiangqiDisplayRow(rank, perspective, geo.rankCount);
  // Flipping the board is a 180 degree ROTATION, so the file mirrors along with
  // the rank. This board mirrored only the rank until 2026-08-27, which put
  // black's own right-hand file on the reader's right instead of their left --
  // the opposite of a real board, and the opposite of what every other renderer
  // here does (jieqi, fortress, and grid-board all mirror the file).
  const col = xiangqiDisplayFile(file, perspective, geo.fileCount);
  const riverShift = layout === 'cell' && row >= geo.rankCount / 2 ? geo.riverGap : 0;
  return {
    x: originX + geo.margin + col * geo.cell,
    y: originY + geo.margin + row * geo.cell + riverShift,
  };
}

/** How far the board's edge is pulled in past the edge squares. A piece's outline
 *  spans XIANGQI_PIECE_REACH of the cell, centred, so it stops half the leftover
 *  short of its square; at the board's edge that read as board showing past the
 *  last piece (Brian, 2026-10-29: "flush with the cells, but not flush with the
 *  edge"). The trim is exactly that half, so the edge lands on the outline. A
 *  trim of the whole leftover was tried the same night: headless Chrome showed a
 *  hairline at the exact cut, but Brian's GPU Chrome clipped the deeper one
 *  ("it's actually getting cut off"), and the exact cut is flush there. */
export function xiangqiCellEdgeTrim(cell: number): number {
  // Rounded to a hundredth so the viewBox prints 6.6, not 6.6000000000000005.
  return Math.round(((cell * (1 - XIANGQI_PIECE_REACH)) / 2) * 100) / 100;
}

/** The board's own viewBox rectangle. 'intersection' spans the outer lines;
 *  'cell' spans full squares (half a cell beyond the outer intersections) plus
 *  the river gap. Mirrors the live renderer's viewBox math exactly.
 *
 *  A 'cell' board without a coordinate gutter is trimmed by the piece's edge gap,
 *  so an edge piece meets the board's edge. With a gutter the squares end at a
 *  framed rim instead (xiangqiSurfaceGrid), so they keep their full size. */
export function xiangqiBoardViewBox(
  layout: XiangqiBoardLayout,
  geo: XiangqiBoardGeometry,
): { minX: number; minY: number; width: number; height: number } {
  const g = geo.coordGutter ?? 0;
  if (layout === 'cell') {
    const trim = g > 0 ? 0 : xiangqiCellEdgeTrim(geo.cell);
    return {
      minX: geo.margin - geo.cell / 2 - g + trim,
      minY: geo.margin - geo.cell / 2 - g + trim,
      width: geo.fileCount * geo.cell + g * 2 - trim * 2,
      height: geo.rankCount * geo.cell + geo.riverGap + g * 2 - trim * 2,
    };
  }
  return {
    // `|| 0` because -0 is not 0 to Object.is, and a gutterless board must
    // report the same origin it always did rather than a negative zero.
    minX: -g || 0,
    minY: -g || 0,
    width: geo.margin * 2 + (geo.fileCount - 1) * geo.cell + g * 2,
    height: geo.margin * 2 + (geo.rankCount - 1) * geo.cell + g * 2,
  };
}
