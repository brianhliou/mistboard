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
