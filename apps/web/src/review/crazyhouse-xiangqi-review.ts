// Crazyhouse Xiangqi review surface: the crazyhouse presentation bundle over the
// generic tree-review controller (mountTreeReview), the surface Fortress and
// Atomic Xiangqi have. Perfect information on the standard 9x10 board, so the
// tree rebuilds every position, drops included, from the move list.
//
// What this variant adds to the standard xiangqi board:
//   - BOTH POCKETS at every ply, in the rail above and below the moves (the
//     `material` hook), drawn as the same lichess pocket the live room shows.
//     In a drop variant the hand is part of the position: a board without it
//     does not say what can land next.
//   - a DROP as the last move is ringed on the point it landed on (a drop has
//     no origin, so the from/to pair has nothing to draw).
//
// NO CLIENT ENGINE (`engine: null`): there is no browser Fairy-Stockfish build
// for crazyhouse xiangqi, so the eval gauge and the engine panel are omitted,
// the way the Duck and fog reviews omit them. Board moves can be explored from
// any node; drops replay in the mainline but are not playable from the rail,
// the same scope the Fortress review has.

import {
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  type CrazyhouseXiangqiSquare,
  crazyhouseXiangqiFen,
  getCrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiDropMove,
} from '@mistboard/game';
// ORDER MATTERS: live-xiangqi.css draws the board; the pocket rules ride on it.
import '../live-xiangqi.css';
import '../drop-reserve.css';
import {
  crazyhouseXiangqiBoardView,
  crazyhouseXiangqiLastDrop,
  fillCrazyhouseXiangqiReserve,
} from '../crazyhouse-xiangqi-view.js';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import {
  animateXiangqiBoardMove,
  createXiangqiInteractiveBoard,
  LIVE_BOARD_GEO,
  type XiangqiBoardArrow,
  type XiangqiBoardMarker,
} from '../xiangqi-board.js';
import { xiangqiBoardAspect } from '../xiangqi-board-aspect.js';
import { xiangqiNotationChangedEvent } from '../xiangqi-notation.js';
import { crazyhouseXiangqiTreeAdapter } from './crazyhouse-xiangqi-tree-adapter.js';
import type { NodeShape } from './game-tree.js';
import {
  mountTreeReview,
  type TreeBoardFactoryOptions,
  type TreeBoardHandle,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

export type CrazyhouseXiangqiReviewConfig = TreeReviewConfig<
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState
>;
export type CrazyhouseXiangqiReviewHandle = TreeReviewHandle;

type CrazyhouseBoardHandle = TreeBoardHandle<
  CrazyhouseXiangqiPlayerView,
  CrazyhouseXiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
>;

/**
 * The standard interactive board, fed the board half of the crazyhouse view.
 * crazyhouseXiangqiBoardView drops the drop moves from legalMoves (the board's
 * click layer only knows from/to) and moves a drop lastMove to the landing
 * ring, which the board reads back through `lastDropSquare`.
 */
function createCrazyhouseXiangqiReviewBoard(
  opts: TreeBoardFactoryOptions<
    CrazyhouseXiangqiMove,
    CrazyhouseXiangqiPlayerView,
    CrazyhouseXiangqiColor
  >,
): CrazyhouseBoardHandle {
  let lastDrop: CrazyhouseXiangqiSquare | null = null;
  const boardView = (view: CrazyhouseXiangqiPlayerView | null) =>
    view ? crazyhouseXiangqiBoardView(view) : null;
  const inner = createXiangqiInteractiveBoard({
    board: opts.board,
    getInteractionView: () => boardView(opts.getInteractionView()),
    getPerspective: () => opts.getPerspective(),
    seatFor: () => {
      const view = opts.getInteractionView();
      return view ? opts.seatFor(view) : null;
    },
    enabled: () => opts.enabled(),
    onMove: (move) => {
      const view = opts.getInteractionView();
      if (view) opts.onMove(move, view);
    },
    lastDropSquare: () => lastDrop,
    ...(opts.onDrawShape
      ? {
          onDrawShape: (
            orig: CrazyhouseXiangqiSquare,
            dest: CrazyhouseXiangqiSquare | null,
            drawOpts,
          ) => opts.onDrawShape?.(orig, dest, drawOpts),
        }
      : {}),
  });
  return {
    render: (view, perspective) => {
      lastDrop = view ? crazyhouseXiangqiLastDrop(view) : null;
      inner.render(boardView(view), perspective);
    },
    setArrows: (arrows) => inner.setArrows(arrows),
    setMarkers: (markers) => inner.setMarkers(markers),
  };
}

const crazyhouseXiangqiPresentation: TreePresentation<
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  CrazyhouseXiangqiPlayerView,
  CrazyhouseXiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
> = {
  adapter: crazyhouseXiangqiTreeAdapter,
  engine: null,
  // The Share card's FEN box: Fairy-Stockfish's crazyhousexiangqi spelling,
  // pocket in brackets, so the position can be pasted into an engine.
  fen: (truth) => crazyhouseXiangqiFen(truth),
  boardHostClassName: 'dxq-postgame__board xiangqi-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Crazyhouse Xiangqi board',
  boardAspect: () => xiangqiBoardAspect(LIVE_BOARD_GEO),
  appearanceEvent: xiangqiAppearanceChangedEvent,
  labelsEvent: xiangqiNotationChangedEvent,
  boardCols: 9,
  perspective: (flipped) => (flipped ? 'black' : 'red'),
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  createBoard: (opts) => createCrazyhouseXiangqiReviewBoard(opts),
  // Only board moves glide; a drop has no origin square, so it simply lands.
  animateMove: (boardEl, move, perspective, opts) => {
    if (!isCrazyhouseXiangqiDropMove(move)) {
      animateXiangqiBoardMove(boardEl, move, perspective, opts);
    }
  },
  shapeToArrow: (s: NodeShape): XiangqiBoardArrow => ({
    from: s.orig as CrazyhouseXiangqiSquare,
    to: (s.dest ?? s.orig) as CrazyhouseXiangqiSquare,
    className: `xq-arrow--draw xq-shape--${s.brush}`,
  }),
  shapeToMarker: (s: NodeShape): XiangqiBoardMarker => ({
    square: s.orig as CrazyhouseXiangqiSquare,
    kind: 'circle',
    className: `xq-shape--${s.brush}`,
  }),
  // A drop has no `from`, but it has a destination, so both union members
  // carry the badge to the point they landed on.
  moveGlyphMarker: (move: CrazyhouseXiangqiMove, glyph): XiangqiBoardMarker => ({
    square: move.to,
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
  // Both pockets at every ply. Perfect information, so one projection carries
  // both hands; the bottom pocket follows the board's bottom seat, as the live
  // room puts your own hand under the board.
  material: (hosts) => (truth, _rootTruth, flipped) => {
    const bottom: CrazyhouseXiangqiColor = flipped ? 'black' : 'red';
    const top: CrazyhouseXiangqiColor = bottom === 'red' ? 'black' : 'red';
    const view = getCrazyhouseXiangqiPlayerView(truth, bottom);
    fillCrazyhouseXiangqiReserve(hosts.top, view, top, { pocket: true });
    fillCrazyhouseXiangqiReserve(hosts.bottom, view, bottom, { pocket: true });
  },
};

export function mountCrazyhouseXiangqiReview(
  root: HTMLElement,
  config: CrazyhouseXiangqiReviewConfig,
): CrazyhouseXiangqiReviewHandle {
  return mountTreeReview(root, crazyhouseXiangqiPresentation, config);
}
