// Interactive Jungle (Dou Shou Qi) board for the review/analysis surface: a
// factory-wrapped click-to-select + drag-to-move board, mirroring
// createXiangqiInteractiveBoard (xiangqi-board.ts). It stands on the SAME shared
// primitives the live Jungle board uses — installBoardDrag (DOM `[data-square]`
// hit-testing) + installSelectionClickAway — and delegates rendering to
// renderJungleBoardSvg with its interactive/selected/targets/draggingFrom options.
//
// Engine and user arrows share the SVG overlay layer; the review's move glyph
// and best-move ring go in the marker layer.

import type { JungleColor, JungleMove, JunglePlayerView, JungleSquare } from '@mistboard/game';
import {
  JUNGLE_BOARD_VIEW,
  type JungleBoardArrow,
  type JungleBoardMarker,
  jungleArrowSvg,
  jungleMarkerSvgFor,
  junglePieceGhostSvg,
  renderJungleBoardSvg,
} from './jungle-render.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

export interface JungleInteractiveBoardOptions {
  /** Persistent board host; drag + click are delegated here once so they survive
   *  innerHTML re-renders. */
  board: HTMLElement;
  /** View used for click/drag legality at event time (the current tree node's
   *  truth view on the review board). */
  getInteractionView: () => JunglePlayerView | null;
  /** Board orientation. */
  getPerspective: () => JungleColor;
  /** Whose pieces are interactive: the side to move (review plays both sides).
   *  Null = nobody. */
  seatFor: (view: JunglePlayerView) => JungleColor | null;
  /** Outer gate (always true on the review board). */
  enabled: () => boolean;
  /** A legal move was chosen (click or drop); the caller appends it to the tree. */
  onMove: (move: JungleMove, view: JunglePlayerView) => void;
}

export interface JungleInteractiveBoard {
  render(view: JunglePlayerView | null, perspective: JungleColor): void;
  clearSelection(): void;
  setArrows(arrows: readonly JungleBoardArrow[]): void;
  setMarkers(markers: readonly JungleBoardMarker[]): void;
}

export function createJungleInteractiveBoard(
  opts: JungleInteractiveBoardOptions,
): JungleInteractiveBoard {
  let selectedSquare: JungleSquare | null = null;
  let draggingFrom: JungleSquare | null = null;
  let arrows: readonly JungleBoardArrow[] = [];
  let markers: readonly JungleBoardMarker[] = [];

  function render(view: JunglePlayerView | null, perspective: JungleColor): void {
    if (!view) {
      opts.board.replaceChildren();
      return;
    }
    const targets = selectedSquare
      ? view.legalMoves.filter((m) => m.from === selectedSquare).map((m) => m.to)
      : [];
    opts.board.innerHTML = renderJungleBoardSvg(view.board, {
      perspective,
      lastMove: view.lastMove ?? null,
      selected: selectedSquare,
      targets,
      draggingFrom,
      interactive: true,
      arrows,
      markers,
    });
  }

  function setArrows(next: readonly JungleBoardArrow[]): void {
    arrows = next;
    const layer = opts.board.querySelector('.xq-live-arrows');
    if (layer) {
      layer.innerHTML = arrows
        .map((arrow) => jungleArrowSvg(arrow, opts.getPerspective()))
        .join('');
    }
  }

  // The review's move glyph and best-move ring: patched in place like the
  // arrows, and kept across renders.
  function setMarkers(next: readonly JungleBoardMarker[]): void {
    markers = next;
    const layer = opts.board.querySelector('.jungle-board-markers');
    if (layer) {
      layer.innerHTML = markers
        .map((marker) => jungleMarkerSvgFor(marker, opts.getPerspective()))
        .join('');
    }
  }

  // Re-render from the live interaction view after a click/drag mutation.
  function rerender(): void {
    render(opts.getInteractionView(), opts.getPerspective());
  }

  function clearSelection(): void {
    selectedSquare = null;
    draggingFrom = null;
  }

  function handleClick(square: JungleSquare): void {
    if (opts.enabled()) {
      const view = opts.getInteractionView();
      if (view) {
        const seat = opts.seatFor(view);
        if (selectedSquare) {
          const move = view.legalMoves.find((m) => m.from === selectedSquare && m.to === square);
          if (move) {
            selectedSquare = null;
            opts.onMove(move, view);
            rerender();
            return;
          }
          // Clicking the already-selected square again deselects it.
          if (square === selectedSquare) {
            selectedSquare = null;
            rerender();
            return;
          }
        }
        // (Re)select an own piece; anything else clears the selection.
        const piece = view.board[square];
        selectedSquare = seat && piece && piece.color === seat ? square : null;
        draggingFrom = null;
      }
    }
    rerender();
  }

  function canDrag(square: JungleSquare): boolean {
    if (!opts.enabled()) return false;
    const view = opts.getInteractionView();
    if (!view) return false;
    const seat = opts.seatFor(view);
    if (!seat) return false;
    if (view.status.type !== 'playing' || view.status.turn !== seat) return false;
    const piece = view.board[square];
    return !!piece && piece.color === seat;
  }

  function handleDrop(from: JungleSquare, to: JungleSquare | null): void {
    draggingFrom = null;
    const view = opts.getInteractionView();
    const move =
      to && view ? view.legalMoves.find((m) => m.from === from && m.to === to) : undefined;
    selectedSquare = null;
    if (move && view) opts.onMove(move, view);
    rerender();
  }

  installBoardDrag({
    board: opts.board,
    // Match the ghost to the currently rendered cell size (responsive board).
    ghostSizePx: () => opts.board.getBoundingClientRect().width / JUNGLE_BOARD_VIEW.files,
    onSquareClick: (square) => handleClick(square as JungleSquare),
    canDragFrom: (square) => canDrag(square as JungleSquare),
    ghostHtml: (square) => {
      const piece = opts.getInteractionView()?.board[square as JungleSquare];
      return piece ? junglePieceGhostSvg(piece) : null;
    },
    onDragStart: (from) => {
      selectedSquare = from as JungleSquare;
      draggingFrom = from as JungleSquare;
      rerender();
    },
    onDrop: (from, to) => handleDrop(from as JungleSquare, to as JungleSquare | null),
  });

  installSelectionClickAway({
    roots: () => [opts.board],
    hasSelection: () => selectedSquare !== null,
    clearSelection: () => {
      clearSelection();
      rerender();
    },
  });

  return { render, clearSelection, setArrows, setMarkers };
}
