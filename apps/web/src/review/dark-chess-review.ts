// Fog Chess review surface: the dark-chess presentation bundle over the generic
// tree-review controller. The chess-family sibling of dark-xiangqi-review.ts —
// project() returns the triptych (truth + each POV), rendered as one interactive
// truth board plus two read-only POV boards.
//
// Fog has no client engine (the fog engine is a separate worker piece), so
// `engine: null`. In analysis the game is fully revealed, so the tree replays and
// branches on the TRUE move history like an open variant.

import type { Color, GameState, Move, PlayerView } from '@mistboard/game';
import type { ChessBoardMarker } from '../dark-chess-render.js';
import { createDarkChessInteractiveBoard } from '../dark-chess-tree-board.js';
import { formatDarkChessMove } from './dark-chess-decisions.js';
import { darkChessTreeAdapter } from './dark-chess-tree-adapter.js';
import type { NodeShape } from './game-tree.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

// Board notation for chess UCI; lives with the decisions module (CSS-free, shared with the
// game embed). Re-exported here for existing importers.
export { formatDarkChessMove };

/** Config for a Fog Chess review mount. */
export type DarkChessReviewConfig = TreeReviewConfig<Move, GameState>;

/** Handle returned by mountDarkChessReview: snapshot the current tree to persist it. */
export type DarkChessReviewHandle = TreeReviewHandle;

// Fog has no client engine and the SVG renderer has no arrow/marker overlay, so
// Arrow/Marker are unused (setArrows/setMarkers are no-ops); the shapeTo* hooks are
// never painted but the type requires them, so they pass the shape through opaquely.
const darkChessPresentation: TreePresentation<
  Move,
  GameState,
  PlayerView,
  Color,
  unknown,
  unknown
> = {
  adapter: darkChessTreeAdapter,
  engine: null,
  // The fog eval track is Stockfish on the revealed truth. It earns the chart and
  // the per-move eval — what the move actually cost — but it must not say "X was
  // best": under fog that is a move the player could not have found, and it
  // contradicted the belief-relative alternatives rendered directly beneath it
  // (Stockfish said b2-b4, Misty said f1-e1, and the card showed both).
  quoteEvalBestMove: false,
  // Server analysis emits plain chess UCI ("e2e4", "a7a8q"); the default
  // formatter is the xiangqi/FSF dialect, so supply chess's own for the
  // "… was best" advice line.
  formatBestMove: formatDarkChessMove,
  boardHostClassName: 'dxq-postgame__board dark-chess-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Fog Chess board',
  boardAspect: 1,
  boardCols: 8,
  perspective: (flipped) => (flipped ? 'black' : 'white'),
  // Review plays BOTH sides on the truth board: the interactive seat is the side
  // to move. Secondary POV boards are read-only (the controller disables input).
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  createBoard: (opts) => createDarkChessInteractiveBoard(opts),
  // No glide animation for fog (the board re-renders on navigation).
  animateMove: () => {},
  shapeToArrow: (s: NodeShape) => s,
  shapeToMarker: (s: NodeShape) => s,
  // The judgment badge on the square the move landed on, as every other review board
  // draws it. Fog keeps its policy on the best MOVE (never quoted, never drawn); the
  // verdict on the move played is not hindsight, so it shows.
  moveGlyphMarker: (move: Move, glyph): ChessBoardMarker => ({
    square: move.to,
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
};

export function mountDarkChessReview(
  root: HTMLElement,
  config: DarkChessReviewConfig,
): DarkChessReviewHandle {
  return mountTreeReview(root, darkChessPresentation, config);
}
