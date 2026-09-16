// Atomic Xiangqi review surface: the atomic presentation bundle over the generic
// tree-review controller (mountTreeReview). Serves study chapters and the
// postgame-shaped review. The board is the standard xiangqi interactive board,
// because an AtomicXiangqiPlayerView is a StandardXiangqiPlayerView with two
// more fields; the one thing this variant adds is the AFTERMATH, the amber
// rings on the points the last explosion cleared, which the live room and the
// postgame draw the same way (atomic-xiangqi-board.ts). The factory below wraps
// the standard board so those rings are part of every render and survive the
// controller's own marker updates (annotation circles, judgment glyphs).
//
// No client engine (`engine: null`): the patched Fairy-Stockfish runs on the
// server for PvE and is not built for the browser. The eval gauge and engine
// panel are omitted; the branching board, move tree, annotations and replay
// all work, the posture dark-xiangqi-review.ts and duck-xiangqi-review.ts take.

import {
  type AtomicXiangqiColor,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  type AtomicXiangqiPlayerView,
  type AtomicXiangqiSquare,
  atomicXiangqiFen,
} from '@mistboard/game';
// ORDER MATTERS: live-xiangqi.css draws the board; atomic-xiangqi.css only adds
// the aftermath ring.
import '../live-xiangqi.css';
import '../atomic-xiangqi.css';
import {
  animateAtomicXiangqiCapture,
  atomicXiangqiBlastKey,
  atomicXiangqiBlastMarkers,
  atomicXiangqiCaptureAnimates,
  markAtomicXiangqiBlastHost,
} from '../atomic-xiangqi-board.js';
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
import { atomicXiangqiTreeAdapter } from './atomic-xiangqi-tree-adapter.js';
import type { NodeShape } from './game-tree.js';
import {
  mountTreeReview,
  type TreeBoardFactoryOptions,
  type TreeBoardHandle,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

export type AtomicXiangqiReviewConfig = TreeReviewConfig<AtomicXiangqiMove, AtomicXiangqiGameState>;
export type AtomicXiangqiReviewHandle = TreeReviewHandle;

type AtomicBoardHandle = TreeBoardHandle<
  AtomicXiangqiPlayerView,
  AtomicXiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
>;

/**
 * The standard board with the aftermath merged into its markers. The
 * controller owns annotation and judgment markers and replaces them through
 * setMarkers; the rings are re-derived from the view on every render and
 * prepended, so neither side can clear the other's.
 */
function createAtomicXiangqiInteractiveBoard(
  opts: TreeBoardFactoryOptions<AtomicXiangqiMove, AtomicXiangqiPlayerView, AtomicXiangqiColor>,
): AtomicBoardHandle {
  let ownMarkers: readonly XiangqiBoardMarker[] = [];
  let aftermath: readonly XiangqiBoardMarker[] = [];
  // The node whose explosion has played; navigating onto a node detonates it once.
  let detonatedKey: string | null = null;
  let cancelCapture: (() => void) | null = null;
  const inner = createXiangqiInteractiveBoard({
    board: opts.board,
    getInteractionView: () => opts.getInteractionView(),
    getPerspective: () => opts.getPerspective(),
    seatFor: (view) => opts.seatFor(view as AtomicXiangqiPlayerView),
    enabled: () => opts.enabled(),
    onMove: (move, view) => opts.onMove(move, view as AtomicXiangqiPlayerView),
    ...(opts.onDrawShape
      ? {
          onDrawShape: (orig: AtomicXiangqiSquare, dest: AtomicXiangqiSquare | null, drawOpts) =>
            opts.onDrawShape?.(orig, dest, drawOpts),
        }
      : {}),
  });
  return {
    render: (view, perspective) => {
      const key = view ? atomicXiangqiBlastKey(view) : null;
      const fresh = key !== null && key !== detonatedKey;
      detonatedKey = key;
      if (fresh) {
        cancelCapture?.();
        cancelCapture = null;
      }
      markAtomicXiangqiBlastHost(opts.board, view);
      aftermath = view ? atomicXiangqiBlastMarkers(view, { fresh }) : [];
      // The discs carry the fresh class only on this render; the copy the
      // inner board keeps for later repaints is the static one.
      inner.setMarkers([...aftermath, ...ownMarkers]);
      inner.render(view, perspective);
      if (fresh && view) {
        aftermath = atomicXiangqiBlastMarkers(view);
        if (atomicXiangqiCaptureAnimates(view)) {
          cancelCapture = animateAtomicXiangqiCapture(opts.board, view, perspective);
        }
      }
    },
    setArrows: (arrows) => inner.setArrows(arrows),
    setMarkers: (markers) => {
      ownMarkers = markers;
      inner.setMarkers([...aftermath, ...ownMarkers]);
    },
  };
}

const atomicXiangqiPresentation: TreePresentation<
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  AtomicXiangqiPlayerView,
  AtomicXiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
> = {
  adapter: atomicXiangqiTreeAdapter,
  engine: null,
  // No engine, but the position still has a FEN (the standard spelling), so
  // the analysis board's FEN box can copy a position out.
  fen: (truth) => atomicXiangqiFen(truth),
  boardHostClassName: 'dxq-postgame__board xiangqi-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Atomic Xiangqi board',
  boardAspect: () => xiangqiBoardAspect(LIVE_BOARD_GEO),
  appearanceEvent: xiangqiAppearanceChangedEvent,
  labelsEvent: xiangqiNotationChangedEvent,
  boardCols: 9,
  perspective: (flipped) => (flipped ? 'black' : 'red'),
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  createBoard: (opts) => createAtomicXiangqiInteractiveBoard(opts),
  animateMove: animateXiangqiBoardMove,
  shapeToArrow: (s: NodeShape): XiangqiBoardArrow => ({
    from: s.orig as AtomicXiangqiSquare,
    to: (s.dest ?? s.orig) as AtomicXiangqiSquare,
    className: `xq-arrow--draw xq-shape--${s.brush}`,
  }),
  shapeToMarker: (s: NodeShape): XiangqiBoardMarker => ({
    square: s.orig as AtomicXiangqiSquare,
    kind: 'circle',
    className: `xq-shape--${s.brush}`,
  }),
  moveGlyphMarker: (move: AtomicXiangqiMove, glyph): XiangqiBoardMarker => ({
    square: move.to,
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
};

export function mountAtomicXiangqiReview(
  root: HTMLElement,
  config: AtomicXiangqiReviewConfig,
): AtomicXiangqiReviewHandle {
  return mountTreeReview(root, atomicXiangqiPresentation, config);
}
