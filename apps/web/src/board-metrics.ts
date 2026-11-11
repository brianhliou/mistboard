// Canonical piece-to-cell proportion for token boards: discs and tiles that
// sit on a grid, whether anchored to intersections (xiangqi family) or cell
// centers (banqi, jungle). Unified 2026-07-02 from a per-renderer spread of
// 75-90%; the placement convention only moves the anchor point, never the
// proportion. Out of scope: chess-family sprite boards (inset is baked into
// the sprite assets and chessground CSS) and koma-style tiles (traditional near-fill
// at 90%).
// 2026-07-04: bumped 0.83 -> 0.90. The discs read too small with too much dead
// space between them on the xiangqi + jungle boards; 0.90 tightens the gaps
// while keeping a hair of breathing room around each token.
export const TOKEN_PIECE_RATIO = 0.9;

export function tokenPieceSize(cell: number): number {
  return Math.round(cell * TOKEN_PIECE_RATIO);
}

// 2026-10-14 (the new piece look, Brian): a xiangqi-family piece's OUTER EDGE
// spans 98% of the point gap or cell. Every xiangqi piece is drawn in a 100-unit
// box whose outline ends at 94.8 (r 46 plus half a 2.8 ring), so the box is
// cell x 0.98 / 0.948, about 1.034 cells. tokenPieceSize stays the layout size
// the board's marks are tuned on (last-move halo, check glow, selection rings,
// hit areas); only the piece drawing grows.
export const XIANGQI_PIECE_REACH = 0.98;
/**
 * On the Square grid a flat piece spans 85% of its square instead, centred, so
 * the grid shows between neighbours and round the edge (Brian, 2026-10-29: "85
 * 90 that looks a bit better", matching Flip Jungle's "2d 85 and 3d 90"; the 3D
 * piece's 90 is XIANGQI_PIECE_3D_CELL_REACH, and its face then lands near 85).
 */
export const XIANGQI_PIECE_CELL_REACH = 0.85;
/** The margin the piece renderer adds round its 100-unit art on the Square grid,
 *  so the art scales to XIANGQI_PIECE_CELL_REACH / XIANGQI_PIECE_REACH of the box
 *  it is given (a hundredth, so the viewBox prints clean). */
export const XIANGQI_PIECE_CELL_INSET =
  Math.round(((100 * XIANGQI_PIECE_REACH) / XIANGQI_PIECE_CELL_REACH - 100) * 50) / 100;

/** The box a Square-grid piece's art fills inside its given box `box`: what a
 *  mark that traces the drawn outline (the last-move ring) sizes on. */
export function xiangqiPieceCellBox(box: number): number {
  return Math.round(((box * 100) / (100 + 2 * XIANGQI_PIECE_CELL_INSET)) * 100) / 100;
}

/** How much of its 100-unit box a xiangqi piece's outline spans. */
export const XIANGQI_PIECE_OUTLINE_SHARE = 0.948;

/**
 * A piece box rounded to a quarter unit. Quarters (and the eighths that halving
 * them gives) are exact in binary, so a piece placed at centre minus half its box
 * prints as a clean coordinate instead of 4.984999999999999. The rounding moves
 * the outer edge by at most 0.2% of a cell at board sizes.
 */
export function roundPieceBox(size: number): number {
  return Math.round(size * 4) / 4;
}

/** The box a xiangqi-family piece is drawn in on a board of this cell or gap. */
export function xiangqiPieceDrawSize(cell: number): number {
  return roundPieceBox((cell * XIANGQI_PIECE_REACH) / XIANGQI_PIECE_OUTLINE_SHARE);
}

// Board corner rounding is defined once in @mistboard/board-render (board-svg and
// grid-board need it, and a package cannot import from an app). Re-exported here so the
// existing import sites keep working and there is still one number.
export { BOARD_CORNER_RATIO, boardCornerRadius } from '@mistboard/board-render';

export type RectangularGridMetrics = {
  cell: number;
  files: number;
  ranks: number;
};

/** Width / height for a plain rectangular grid with no inter-rank strips. */
export function rectangularGridAspect(metrics: RectangularGridMetrics): number {
  return (metrics.files * metrics.cell) / (metrics.ranks * metrics.cell);
}
