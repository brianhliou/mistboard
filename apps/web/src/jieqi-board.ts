// Interactive Jieqi board for the review/analysis surface: a
// factory-wrapped select-and-move board, mirroring createBanqiInteractiveBoard
// (banqi-board.ts) but with jieqi's rules — there is NO flip move; a dark piece is
// selected and moved like any piece (it reveals on the move). It stands on the SAME
// shared primitives (installBoardDrag + installSelectionClickAway) and delegates the
// click decision to the pure jieqiClickResult (live-jieqi-interaction.ts) so the
// review board and the live board agree on select-vs-move exactly.
//
// Jieqi is identity-hidden, not position-hidden: a player selects their OWN pieces
// (dark or revealed) — dark pieces keep their color in the view, so ownership is
// known even before the role is. Only own-color pieces with a legal move are
// selectable/draggable. Engine and user arrows share the SVG overlay layer;
// point markers remain the next review-capability slice.

import type { JieqiColor, JieqiMove, JieqiPlayerView, JieqiSquare } from '@mistboard/game';
import { jieqiClickResult } from './live-jieqi-interaction.js';
import {
  JIEQI_PIECE_PX,
  type JieqiBoardArrow,
  type JieqiBoardMarker,
  jieqiArrowSvg,
  jieqiMarkerSvg,
  jieqiPieceGhostSvg,
  renderJieqiBoardSvg,
} from './live-jieqi-render.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

export interface JieqiInteractiveBoardOptions {
  board: HTMLElement;
  getInteractionView: () => JieqiPlayerView | null;
  getPerspective: () => JieqiColor;
  /** Whose pieces are interactive: the side to move (review plays both sides).
   *  Null = nobody (game over). */
  seatFor: (view: JieqiPlayerView) => JieqiColor | null;
  enabled: () => boolean;
  onMove: (move: JieqiMove, view: JieqiPlayerView) => void;
}

export interface JieqiInteractiveBoard {
  render(view: JieqiPlayerView | null, perspective: JieqiColor): void;
  clearSelection(): void;
  setArrows(arrows: readonly JieqiBoardArrow[]): void;
  setMarkers(markers: readonly JieqiBoardMarker[]): void;
}

export function createJieqiInteractiveBoard(
  opts: JieqiInteractiveBoardOptions,
): JieqiInteractiveBoard {
  let selectedSquare: JieqiSquare | null = null;
  let draggingFrom: JieqiSquare | null = null;
  let arrows: readonly JieqiBoardArrow[] = [];
  let markers: readonly JieqiBoardMarker[] = [];

  function render(view: JieqiPlayerView | null, perspective: JieqiColor): void {
    if (!view) {
      opts.board.replaceChildren();
      return;
    }
    // Only the SELECTED piece's moves get target dots — the jieqi renderer dots
    // every move in `legalMoves` (it does not filter by selectedSquare itself), so
    // passing the full set would light up every legal destination every turn.
    const legalMoves = selectedSquare
      ? view.legalMoves.filter((move) => move.from === selectedSquare)
      : [];
    opts.board.innerHTML = renderJieqiBoardSvg(view, perspective, {
      interactive: true,
      selectedSquare,
      legalMoves,
      draggingFrom,
      arrows,
      markers,
    });
  }

  function setArrows(next: readonly JieqiBoardArrow[]): void {
    arrows = next;
    const layer = opts.board.querySelector('.xq-live-arrows');
    if (layer) {
      layer.innerHTML = arrows.map((arrow) => jieqiArrowSvg(arrow, opts.getPerspective())).join('');
    }
  }

  // The review's move glyph (?!, ?, ??) and best-move ring: patched in place
  // like the arrows, and kept across renders.
  function setMarkers(next: readonly JieqiBoardMarker[]): void {
    markers = next;
    const layer = opts.board.querySelector('.jieqi-board-markers');
    if (layer) {
      layer.innerHTML = markers
        .map((marker) => jieqiMarkerSvg(marker, opts.getPerspective()))
        .join('');
    }
  }

  function rerender(): void {
    render(opts.getInteractionView(), opts.getPerspective());
  }

  function clearSelection(): void {
    selectedSquare = null;
    draggingFrom = null;
  }

  function handleClick(square: JieqiSquare): void {
    if (opts.enabled()) {
      const view = opts.getInteractionView();
      if (view) {
        const result = jieqiClickResult(view, opts.seatFor(view), selectedSquare, square);
        draggingFrom = null;
        switch (result.kind) {
          case 'move':
            selectedSquare = null;
            opts.onMove(result.move, view);
            rerender();
            return;
          case 'select':
            selectedSquare = result.square;
            break;
          case 'clear':
          case 'noop':
            selectedSquare = null;
            break;
        }
      }
    }
    rerender();
  }

  // Own-color piece (dark or revealed) with a legal move (legalMoves carries only
  // the side-to-move's moves, so a from-match already implies ownership + turn).
  function canDrag(square: JieqiSquare): boolean {
    if (!opts.enabled()) return false;
    const view = opts.getInteractionView();
    if (view?.status.type !== 'playing') return false;
    const seat = opts.seatFor(view);
    const entry = view.board[square];
    if (!seat || !entry || entry.color !== seat) return false;
    return view.legalMoves.some((move) => move.from === square);
  }

  function handleDrop(from: JieqiSquare, to: JieqiSquare | null): void {
    draggingFrom = null;
    const view = opts.getInteractionView();
    const move =
      to && view
        ? view.legalMoves.find((candidate) => candidate.from === from && candidate.to === to)
        : undefined;
    selectedSquare = null;
    if (move && view) opts.onMove(move, view);
    rerender();
  }

  installBoardDrag({
    board: opts.board,
    ghostSizePx: JIEQI_PIECE_PX,
    onSquareClick: (square) => handleClick(square as JieqiSquare),
    canDragFrom: (square) => canDrag(square as JieqiSquare),
    ghostHtml: (square) => {
      const entry = opts.getInteractionView()?.board[square as JieqiSquare];
      return entry ? jieqiPieceGhostSvg(entry, undefined, square as JieqiSquare) : null;
    },
    onDragStart: (from) => {
      selectedSquare = from as JieqiSquare;
      draggingFrom = from as JieqiSquare;
      rerender();
    },
    onDrop: (from, to) => handleDrop(from as JieqiSquare, to as JieqiSquare | null),
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
