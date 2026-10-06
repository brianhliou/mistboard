// Board geometry mirror for overlay/animation math. The values MUST stay in
// sync with apps/web/src/xiangqi-board.ts (CELL/MARGIN, intersection layout, no
// coordinate gutter); the point maths itself is the shared xiangqiBoardPoint, so
// flipping is the same 180 degree rotation the product board draws. A unit test
// guards the piece-center parity against the rendered SVG from both sides so
// drift fails loudly instead of misplacing overlays.

import type { XiangqiColor, XiangqiSquare } from '@mistboard/game';
import { tokenPieceSize } from '../board-metrics.js';
import {
  type XiangqiBoardGeometry,
  xiangqiBoardPoint,
  xiangqiDisplayFile,
} from '../xiangqi-board-geometry.js';

export const BOARD_FILES = 'abcdefghi';
export const FILE_COUNT = 9;
export const RANK_COUNT = 10;
export const CELL = 60;
export const MARGIN = 36;
export const BOARD_WIDTH = MARGIN * 2 + (FILE_COUNT - 1) * CELL;
export const BOARD_HEIGHT = MARGIN * 2 + (RANK_COUNT - 1) * CELL;
export const RIVER_TOP = MARGIN + 4 * CELL;
export const RIVER_BOTTOM = MARGIN + 5 * CELL;
export const PIECE_SIZE = tokenPieceSize(CELL);

export type Point = { x: number; y: number };

/** The product board's intersection geometry with no coordinate gutter, the
 *  configuration the video frame renders it in. */
export const VIDEO_BOARD_GEO: XiangqiBoardGeometry = {
  fileCount: FILE_COUNT,
  rankCount: RANK_COUNT,
  cell: CELL,
  margin: MARGIN,
  riverGap: 0,
};

export function squareCenter(square: XiangqiSquare, perspective: XiangqiColor): Point {
  const file = Math.max(0, BOARD_FILES.indexOf(square[0] ?? ''));
  const rank = Number(square.slice(1));
  return xiangqiBoardPoint(file, rank, perspective, 'intersection', VIDEO_BOARD_GEO);
}

/** X of a whole file's line as drawn: black sees the board rotated, so file a
 *  sits on the right. */
export function fileLineX(file: number, perspective: XiangqiColor): number {
  return MARGIN + xiangqiDisplayFile(file, perspective, FILE_COUNT) * CELL;
}

/** Smoothstep ease for piece glides; matches the feel of the product's CSS
 *  ease without importing browser animation code. */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
