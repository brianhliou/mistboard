// Jungle (Dou Shou Qi) review surface: the jungle presentation bundle over the
// generic tree-review controller (mountTreeReview). Jungle is perfect-information,
// so it drives the in-browser MistyJungle wasm client engine with the FULL-board FEN
// (positionMode 'fen', no redaction) — the eval gauge, MultiPV panel, and best-move
// advice all light up. This is the first non-xiangqi consumer of mountTreeReview.

import {
  engineUciToJungleMove,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
  type JunglePlayerView,
  jungleStateToEngineFen,
} from '@mistboard/game';
import { rectangularGridAspect } from '../board-metrics.js';
import { createJungleInteractiveBoard } from '../jungle-board.js';
import {
  animateJungleBoardMove,
  JUNGLE_BOARD_VIEW,
  type JungleBoardArrow,
  type JungleBoardMarker,
} from '../jungle-render.js';
import {
  bestMoveArrowWithParser,
  engineArrowsFromLinesWithParser,
} from './engine/engine-arrows.js';
import type { NodeShape } from './game-tree.js';
import { jungleTreeAdapter } from './jungle-tree-adapter.js';
import { formatJungleEngineMove } from './move-advice-text.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

/** Config for a jungle review mount. */
export type JungleReviewConfig = TreeReviewConfig<JungleMove, JungleGameState>;

/** Handle returned by mountJungleReview: snapshot the current tree to persist it. */
export type JungleReviewHandle = TreeReviewHandle;

// Jungle engine UCI is already board coords (files a..g, 1-indexed ranks 1..9) with no
// flips — so, unlike the flip variants, there is no rank offset: "d8d9" -> "d8-d9",
// matching the move list's `${from}-${to}` label. Shared with the game embed's marks
// (move-advice-text.ts), so both surfaces write the same move.

const junglePresentation: TreePresentation<
  JungleMove,
  JungleGameState,
  JunglePlayerView,
  JungleColor,
  JungleBoardArrow,
  unknown
> = {
  adapter: jungleTreeAdapter,
  // Client engine: the in-browser MistyJungle wasm (single-shot MultiPV), fed the full-board
  // FEN (positionMode 'fen'). Jungle is perfect-information — no redaction — so the client
  // engine sees exactly the board the player sees, the same FEN the server analysis path uses.
  engine: {
    panelVariant: 'jungle',
    positionMode: 'fen',
    fen: jungleStateToEngineFen,
    canEvaluatePosition: (truth) => truth.status.type === 'playing',
    formatPvMove: formatJungleEngineMove,
    moveFromEngineUci: engineUciToJungleMove,
    engineArrowsFromLines: (lines) => engineArrowsFromLinesWithParser(lines, engineUciToJungleMove),
    bestMoveArrow: (best) => bestMoveArrowWithParser(best, engineUciToJungleMove),
  },
  formatBestMove: formatJungleEngineMove,
  boardHostClassName: 'jungle-postgame-board jungle-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Jungle board',
  boardAspect: rectangularGridAspect(JUNGLE_BOARD_VIEW),
  boardCols: 7,
  // Jungle pieces pick up their look from the render call (not a CSS piece set),
  // and a full re-render happens on every navigation, so no appearance event.
  perspective: (flipped) => (flipped ? 'black' : 'red'),
  // Review plays BOTH sides: the interactive seat is the side to move.
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  createBoard: (opts) => createJungleInteractiveBoard(opts),
  animateMove: animateJungleBoardMove,
  shapeToArrow: (s: NodeShape): JungleBoardArrow => ({
    from: s.orig as JungleBoardArrow['from'],
    to: (s.dest ?? s.orig) as JungleBoardArrow['to'],
    className: `xq-arrow--draw xq-shape--${s.brush}`,
  }),
  shapeToMarker: (s: NodeShape) => s,
  // Judgment badge on the square the move landed on, so the board states the
  // same verdict the move list does (lila pins its glyphs the same way).
  moveGlyphMarker: (move: JungleMove, glyph): JungleBoardMarker => ({
    square: move.to,
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
};

export function mountJungleReview(
  root: HTMLElement,
  config: JungleReviewConfig,
): JungleReviewHandle {
  return mountTreeReview(root, junglePresentation, config);
}
