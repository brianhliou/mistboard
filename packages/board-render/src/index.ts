export type { ArticleOgPosition } from './article-positions.js';
export {
  ARTICLE_OG_POSITIONS,
  CONE_QUEEN_BOARD,
  DISCOVERY_BOARD,
  DRAFT960_OFFER_A,
  SERVER_FOG_TRIPTYCH,
} from './article-positions.js';
export { BOARD_CORNER_RATIO, boardCornerRadius } from './board-metrics.js';
export type { PieceOnBoard } from './board-svg.js';
export { fogPatternDefs, renderBoardSvg } from './board-svg.js';
export type { BoardSpec, CompositionOptions } from './composition.js';
export { renderBoardComposition } from './composition.js';
export { XIANGQI_GLYPH_PATHS } from './generated/xiangqi-glyph-paths.js';
export type {
  GridArrowRef,
  GridBoardDescriptor,
  GridBoardLayers,
  GridCellRef,
  GridGeometry,
  GridPalette,
  GridStrip,
  GridTargetRef,
} from './grid-board.js';
export { createGridGeometry, GRID_INTERACTION_COLORS, renderGridBoardSvg } from './grid-board.js';
export type { CompositionLayout } from './layouts.js';
export { boardsInLayout, layoutPlacements } from './layouts.js';
export { PIECE_SVGS } from './pieces.js';
export {
  boardToPieces,
  fogSquaresFromVisible,
  piecesToBoard,
  startingPositionFromBackRank,
} from './positions.js';
export type { BoardPalette, FogStyle } from './tokens.js';
export {
  BROWN_PALETTE,
  DARK_SQUARE,
  FOG_FILL,
  FOG_OPACITY,
  LIGHT_SQUARE,
} from './tokens.js';
export type {
  ChampionRecord,
  ChampionTimelineOptions,
  ChampionTimelinePalette,
} from './xiangqi-champion-timeline.js';
export {
  CHAMPIONS,
  CHART_LAYOUT,
  championsWithNonDefaultScript,
  championTableRows,
  EDITION_GAPS,
  EDITIONS,
  editionGapSentence,
  FIRST_YEAR,
  LAST_YEAR,
  xiangqiChampionTimelineSvg,
} from './xiangqi-champion-timeline.js';
export type {
  XiangqiOgBoardOptions,
  XiangqiOgPiece,
  XiangqiOgRole,
} from './xiangqi-og-board.js';
export { renderXiangqiOgBoardSvg } from './xiangqi-og-board.js';
export {
  sanctionedWorldChampions,
  WORLD_CHAMPIONS,
  WORLD_EDITION_GAPS,
  WORLD_EDITIONS,
  worldChampionTableRows,
  worldTitleCount,
  xiangqiWorldTitleTimelineSvg,
} from './xiangqi-world-title.js';
