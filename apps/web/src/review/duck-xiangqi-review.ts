// Duck Xiangqi review surface: the duck presentation bundle over the generic
// tree-review controller (mountTreeReview). Serves the postgame review, the
// standalone /analysis board, and study chapters, exactly like the fortress and
// jieqi bundles.
//
// TWO THINGS ARE THIS VARIANT'S OWN, AND BOTH LIVE HERE.
//
// 1. THE TWO-PHASE GESTURE, ENTIRELY INSIDE THE BOARD FACTORY.
//
//    A turn is a piece move and THEN a duck placement, so entering a variation
//    takes two clicks where every other board here takes one. The controller
//    knows nothing about that and does not need to: its `onMove` sink takes a
//    whole Move, and a Move here IS the completed {from, to, duckTo}. So the
//    half-made turn is closure state in the factory below, and the shell is
//    called exactly once, when the pair is complete. No shell change was needed,
//    and none was made.
//
//    The rules are not reimplemented either: the click decision is the pure
//    `duckXiangqiClickResult` the live room uses (duck-xiangqi-board.ts) and the
//    phase-two targets come from the kernel's own `duckXiangqiDuckDestinations`.
//    The live board and the review board therefore agree on select-vs-move by
//    construction rather than by two people remembering the same rule.
//
//    The one state a two-phase turn can be stranded in is a half-made turn
//    outliving the position it was made from - navigating the tree, flipping the
//    board, or loading another node while the duck is pending. `render` (which
//    the controller calls on every navigation) drops the phase for exactly that
//    reason; it is the review's counterpart to `reconcileInteractionState` in
//    live-duck-xiangqi.ts.
//
// 2. NO CLIENT ENGINE, SO `engine: null`. There is no Duck Xiangqi engine of any
//    kind. The eval gauge, the engine panel and the Share tab's FEN row are
//    omitted by the controller, and the branching board, move tree, annotations,
//    control bar and replay all work - the same posture dark-xiangqi-review.ts
//    and dark-chess-review.ts already take.

import {
  type DuckXiangqiColor,
  type DuckXiangqiGameState,
  type DuckXiangqiPlayerView,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  duckXiangqiDuckDestinations,
  duckXiangqiFen,
} from '@mistboard/game';
// ORDER IS LOAD-BEARING. live-xiangqi.css draws the board ground, the grid, the
// palace diagonals and the river; duck-xiangqi.css only adds the duck token and
// the phase-two target dots. Without the first the markup is correct and the
// board is invisible, which has already cost a session once.
import '../live-xiangqi.css';
import '../duck-xiangqi.css';
import {
  type DuckXiangqiBoardPhase,
  duckXiangqiBoardSvg,
  duckXiangqiClickResult,
} from '../duck-xiangqi-board.js';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import { installBoardDrag, installBoardDraw } from '../variant-tenant/board-drag.js';
import { installSelectionClickAway } from '../variant-tenant/selection-click-away.js';
import type { XiangqiBoardLayout } from '../xiangqi-appearance-storage.js';
import {
  LIVE_BOARD_GEO,
  type XiangqiBoardArrow,
  type XiangqiBoardMarker,
  xiangqiArrowSvg,
  xiangqiMarkerSvg,
} from '../xiangqi-board.js';
import { xiangqiBoardAspect } from '../xiangqi-board-aspect.js';
import { duckXiangqiTreeAdapter } from './duck-xiangqi-tree-adapter.js';
import type { NodeShape } from './game-tree.js';
import {
  mountTreeReview,
  type TreeBoardFactoryOptions,
  type TreeBoardHandle,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

/**
 * The duck board draws no coordinate labels, so it renders at ONE layout, and
 * the overlay patches below have to use the same one the SVG was built with or
 * an arrow lands on the wrong point. Naming it once is what makes that true by
 * construction; duckXiangqiBoardSvg defaults to the same value.
 */
const DUCK_BOARD_LAYOUT: XiangqiBoardLayout = 'intersection';

/**
 * Board geometry with the coordinate gutter ZEROED, unconditionally.
 *
 * The hosts clip with overflow:hidden, so a board box reserved at the wrong
 * ratio eats the outer rank instead of letterboxing. Every other xiangqi-family
 * surface passes its geometry straight to xiangqiBoardAspect, which re-adds or
 * drops the gutter according to the reader's coordinates preference - correct
 * for a board that DRAWS coordinates when the preference is on. This one never
 * does (duck-xiangqi-board.ts hardcodes coordGutter: 0), so its ratio must not
 * move with that preference.
 */
const DUCK_BOARD_GEO = { ...LIVE_BOARD_GEO, coordGutter: 0 };

/** Config for a Duck Xiangqi review mount. */
export type DuckXiangqiReviewConfig = TreeReviewConfig<DuckXiangqiTurn, DuckXiangqiGameState>;

/** Handle returned by mountDuckXiangqiReview: snapshot the tree to persist it. */
export type DuckXiangqiReviewHandle = TreeReviewHandle;

type DuckBoardHandle = TreeBoardHandle<
  DuckXiangqiPlayerView,
  DuckXiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
>;

/**
 * The interactive Duck Xiangqi board for the review/analysis surface.
 *
 * Not in apps/web/src/ beside the other board factories because it is not a
 * general board: it exists only to hold the review's half of the two-phase turn,
 * and every rule it applies comes from the kernel or from
 * `duckXiangqiClickResult`.
 */
function createDuckXiangqiInteractiveBoard(
  opts: TreeBoardFactoryOptions<DuckXiangqiTurn, DuckXiangqiPlayerView, DuckXiangqiColor>,
): DuckBoardHandle {
  // The half-made turn. `piece` is the ordinary state; `duck` means a piece move
  // has been chosen and is shown optimistically, with nothing handed to the tree.
  let phase: DuckXiangqiBoardPhase = { kind: 'piece', selected: null };
  let arrows: readonly XiangqiBoardArrow[] = [];
  let markers: readonly XiangqiBoardMarker[] = [];
  // The view/perspective the controller last handed us. Held rather than pulled
  // through getInteractionView() on every repaint so a phase-two repaint paints
  // the SAME position the piece move was chosen from.
  let view: DuckXiangqiPlayerView | null = null;
  let perspective: DuckXiangqiColor = 'red';

  /** Legal destinations for whichever half of the turn is being collected. */
  function targets(): readonly DuckXiangqiSquare[] {
    if (!view) return [];
    if (phase.kind === 'duck') {
      return duckXiangqiDuckDestinations(view.board, view.duck, phase.move.from, phase.move.to);
    }
    const from = phase.selected;
    if (!from) return [];
    return view.legalPieceMoves.filter((move) => move.from === from).map((move) => move.to);
  }

  function paint(): void {
    if (!view) {
      opts.board.replaceChildren();
      return;
    }
    opts.board.innerHTML = duckXiangqiBoardSvg(view, perspective, {
      interactive: opts.enabled(),
      phase,
      targets: targets(),
      layout: DUCK_BOARD_LAYOUT,
      arrows,
      markers,
    });
  }

  function render(next: DuckXiangqiPlayerView | null, nextPerspective: DuckXiangqiColor): void {
    // A navigation (or a flip, or a fresh node) invalidates a half-made turn:
    // the pending piece move was chosen from a position that is no longer on
    // screen, and completing it would branch the tree from the wrong node.
    phase = { kind: 'piece', selected: null };
    view = next;
    perspective = nextPerspective;
    paint();
  }

  // Arrows and markers are patched in place rather than rebuilt through the full
  // SVG: engine-free though this surface is, paintOverlays fires on every render
  // and again on every annotation edit, and a full rebuild mid-gesture would
  // throw away the optimistic phase-two board.
  function setArrows(next: readonly XiangqiBoardArrow[]): void {
    arrows = next;
    const layer = opts.board.querySelector('.xq-live-arrows');
    if (layer) {
      layer.innerHTML = arrows
        .map((arrow) => xiangqiArrowSvg(arrow, perspective, DUCK_BOARD_LAYOUT))
        .join('');
    }
  }

  function setMarkers(next: readonly XiangqiBoardMarker[]): void {
    markers = next;
    // Two bands, the same split duckXiangqiBoardSvg does: point decorations sit
    // UNDER the arrows, judgment glyphs OVER them, so an arrowhead never covers
    // the verdict it is competing with for attention.
    for (const [selector, glyphBand] of [
      ['.xq-live-markers', false],
      ['.xq-live-glyphs', true],
    ] as const) {
      const layer = opts.board.querySelector(selector);
      if (!layer) continue;
      layer.innerHTML = markers
        .filter((marker) => (marker.kind === 'glyph') === glyphBand)
        .map((marker) => xiangqiMarkerSvg(marker, perspective, DUCK_BOARD_LAYOUT))
        .join('');
    }
  }

  function handleClick(square: DuckXiangqiSquare): void {
    const current = view;
    if (!current || !opts.enabled()) return;
    const seat = opts.seatFor(current);
    const result = duckXiangqiClickResult({
      view: current,
      seat,
      phase,
      targets: targets(),
      square,
      // A turn that takes the enemy general ends the game before the duck would
      // move, so it completes in ONE click and the kernel wants duckTo: null.
      capturesGeneral: (_from, to) => {
        const target = current.board[to];
        return !!target && target.role === 'general' && target.color !== seat;
      },
    });

    switch (result.kind) {
      case 'select':
        phase = { kind: 'piece', selected: result.square };
        break;
      case 'clear':
        phase = { kind: 'piece', selected: null };
        break;
      case 'await-duck':
        // Phase one. Deliberately silent: the turn is half-made and the tree has
        // not been told anything.
        phase = { kind: 'duck', move: result.move };
        break;
      case 'turn': {
        phase = { kind: 'piece', selected: null };
        // On success the controller re-renders through `render` above, which
        // repaints; on a rejected move it does not, so paint unconditionally
        // afterwards rather than leaving the optimistic board on screen.
        opts.onMove(result.turn, current);
        break;
      }
      case 'noop':
        return;
    }
    paint();
  }

  installBoardDrag({
    board: opts.board,
    ghostSizePx: 0,
    onSquareClick: (square) => handleClick(square as DuckXiangqiSquare),
    // Click-only, the same call the live room makes: a drag would have to ARM
    // phase two rather than complete a move, which is a different gesture from
    // every other board here. Getting that wrong is worse than not having it,
    // and adding it later is purely additive.
    canDragFrom: () => false,
    ghostHtml: () => null,
    onDragStart: () => {},
    onDrop: () => {},
  });

  const onDrawShape = opts.onDrawShape;
  if (onDrawShape) {
    installBoardDraw({
      board: opts.board,
      onDraw: (orig, dest, drawOpts) => onDrawShape(orig, dest, drawOpts),
    });
  }

  installSelectionClickAway({
    roots: () => [opts.board],
    hasSelection: () => phase.kind === 'duck' || phase.selected !== null,
    clearSelection: () => {
      // Clicking away in phase two abandons the whole turn. Free: nothing has
      // reached the tree, so there is no half-move to unwind.
      phase = { kind: 'piece', selected: null };
      paint();
    },
  });

  return { render, setArrows, setMarkers };
}

const duckXiangqiPresentation: TreePresentation<
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  DuckXiangqiPlayerView,
  DuckXiangqiColor,
  XiangqiBoardArrow,
  XiangqiBoardMarker
> = {
  adapter: duckXiangqiTreeAdapter,
  engine: null,
  // No engine, but the position still has a FEN: the kernel's own codec, whose
  // seventh field carries the duck ('-' while it is off the board). Without this
  // the analysis board's FEN box stays empty and positions can only be pasted
  // in, never copied out.
  fen: (truth) => duckXiangqiFen(truth),
  boardHostClassName: 'dxq-postgame__board duck-xiangqi-live-board',
  boardWrapClassName: 'dxq-postgame__board-wrap review-board-host',
  defaultBoardAriaLabel: 'Duck Xiangqi board',
  boardAspect: () => xiangqiBoardAspect(DUCK_BOARD_GEO),
  // Pieces are rendered inline as SVG (renderXiangqiPiece reads the stored set),
  // so a piece-set change needs a full re-render. No labels event: this board
  // draws no coordinates, and its move labels are coordinate-only, so a notation
  // display-mode change cannot alter anything on screen.
  appearanceEvent: xiangqiAppearanceChangedEvent,
  boardCols: 9,
  perspective: (flipped) => (flipped ? 'black' : 'red'),
  // Review plays BOTH sides: the interactive seat is the side to move.
  seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
  createBoard: (opts) => createDuckXiangqiInteractiveBoard(opts),
  // No glide animation: the board re-renders on navigation, and a turn moves TWO
  // things (a piece and the duck), so a single-piece glide would state half of
  // what happened and imply the other half did not.
  animateMove: () => {},
  shapeToArrow: (s: NodeShape): XiangqiBoardArrow => ({
    from: s.orig as XiangqiBoardArrow['from'],
    to: (s.dest ?? s.orig) as XiangqiBoardArrow['to'],
    className: `xq-arrow--draw xq-shape--${s.brush}`,
  }),
  shapeToMarker: (s: NodeShape): XiangqiBoardMarker => ({
    square: s.orig as XiangqiBoardMarker['square'],
    kind: 'circle',
    className: `xq-shape--${s.brush}`,
  }),
  // Judgment badge on the point the PIECE landed on, not the duck's: the verdict
  // grades the move, and the move list says the same thing on the same ply.
  moveGlyphMarker: (turn: DuckXiangqiTurn, glyph): XiangqiBoardMarker => ({
    square: turn.to as XiangqiBoardMarker['square'],
    kind: 'glyph',
    text: glyph.text,
    className: `xq-marker--${glyph.tone}`,
  }),
};

export function mountDuckXiangqiReview(
  root: HTMLElement,
  config: DuckXiangqiReviewConfig,
): DuckXiangqiReviewHandle {
  return mountTreeReview(root, duckXiangqiPresentation, config);
}
