// Interactive Flip Jungle (jungle-flip) board for the review/analysis surface: a
// factory-wrapped tap-to-flip / select-and-move board, mirroring
// createBanqiInteractiveBoard (banqi-board.ts) — jungle-flip is the same symmetric
// hidden-deal interaction on a 4×4 of animals. It stands on the SAME shared
// primitives (installBoardDrag + installSelectionClickAway) and delegates rendering
// to renderJungleFlipBoardSvg with its interactive/selected/targets/draggingFrom
// options.
//
// A face-down tile is FLIPPED by a direct one-click self-move (present in
// view.legalMoves as { from: X, to: X }); a revealed own piece selects then moves
// (click a target or drag). Only revealed pieces are draggable — a flip is
// click-only. Engine moves render as arrows; flip recommendations render as
// rings around their face-down destination.

import type {
  JungleFlipMove,
  JungleFlipPlayerView,
  JungleFlipSeat,
  JungleFlipSquare,
} from '@mistboard/game';
import { jungleFlipLastMoverInk } from '@mistboard/game';
import {
  JUNGLE_FLIP_BOARD_VIEW,
  type JungleFlipBoardArrow,
  type JungleFlipBoardMarker,
  jungleFlipArrowSvg,
  jungleFlipMarkerSvg,
  jungleFlipPieceGhostSvg,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';
import type { WithFaceDownFaces } from './review/face-down-faces.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

export interface JungleFlipInteractiveBoardOptions {
  board: HTMLElement;
  getInteractionView: () => JungleFlipPlayerView | null;
  getPerspective: () => JungleFlipSeat;
  seatFor: (view: JungleFlipPlayerView) => JungleFlipSeat | null;
  enabled: () => boolean;
  onMove: (move: JungleFlipMove, view: JungleFlipPlayerView) => void;
}

export interface JungleFlipInteractiveBoard {
  render(view: JungleFlipPlayerView | null, perspective: JungleFlipSeat): void;
  clearSelection(): void;
  setArrows(arrows: readonly JungleFlipBoardArrow[]): void;
  setMarkers(markers: readonly JungleFlipBoardMarker[]): void;
}

export function createJungleFlipInteractiveBoard(
  opts: JungleFlipInteractiveBoardOptions,
): JungleFlipInteractiveBoard {
  let selectedSquare: JungleFlipSquare | null = null;
  let draggingFrom: JungleFlipSquare | null = null;
  let arrows: readonly JungleFlipBoardArrow[] = [];
  let markers: readonly JungleFlipBoardMarker[] = [];

  function render(view: JungleFlipPlayerView | null, _perspective: JungleFlipSeat): void {
    if (!view) {
      opts.board.replaceChildren();
      return;
    }
    // Board-move destinations of the selected piece (flips are clicked directly, so
    // a face-down tile needs no target dot).
    const targets = selectedSquare
      ? view.legalMoves
          .filter((move) => move.from === selectedSquare && move.to !== move.from)
          .map((move) => move.to)
      : [];
    opts.board.innerHTML = renderJungleFlipBoardSvg(view.board, {
      lastMove: view.lastMove ?? null,
      lastMoveInk: jungleFlipLastMoverInk(view),
      selected: selectedSquare,
      targets,
      draggingFrom,
      interactive: true,
      arrows,
      markers,
      faceDownFaces: (view as WithFaceDownFaces<JungleFlipPlayerView>).faceDownFaces,
    });
  }

  function setArrows(next: readonly JungleFlipBoardArrow[]): void {
    arrows = next;
    const layer = opts.board.querySelector('.xq-live-arrows');
    if (layer) layer.innerHTML = arrows.map(jungleFlipArrowSvg).join('');
  }

  function setMarkers(next: readonly JungleFlipBoardMarker[]): void {
    markers = next;
    const layer = opts.board.querySelector('.xq-live-markers');
    if (layer) layer.innerHTML = markers.map(jungleFlipMarkerSvg).join('');
  }

  function rerender(): void {
    render(opts.getInteractionView(), opts.getPerspective());
  }

  function clearSelection(): void {
    selectedSquare = null;
    draggingFrom = null;
  }

  // Symmetric-flip click policy (mirrors banqiClickResult): a face-down tile flips
  // directly (one click, flip-priority even when a piece is selected); a revealed
  // own piece selects, then a legal destination moves. Selectability rides on
  // legalMoves (only the mover's moves), so no ink math is needed.
  function handleClick(square: JungleFlipSquare): void {
    if (opts.enabled()) {
      const view = opts.getInteractionView();
      const seat = view ? opts.seatFor(view) : null;
      if (view && seat && view.status.type === 'playing' && view.status.turn === seat) {
        draggingFrom = null;
        const flip = view.legalMoves.find((move) => move.from === square && move.to === square);
        if (flip) {
          selectedSquare = null;
          opts.onMove(flip, view);
          rerender();
          return;
        }
        if (selectedSquare) {
          if (selectedSquare === square) {
            selectedSquare = null;
            rerender();
            return;
          }
          const move = view.legalMoves.find((m) => m.from === selectedSquare && m.to === square);
          if (move) {
            selectedSquare = null;
            opts.onMove(move, view);
            rerender();
            return;
          }
        }
        selectedSquare = canSelect(view, square) ? square : null;
        rerender();
        return;
      }
    }
    selectedSquare = null;
    rerender();
  }

  // A revealed piece with at least one legal board move is selectable/draggable
  // (legalMoves carries only the side-to-move's moves).
  function canSelect(view: JungleFlipPlayerView, square: JungleFlipSquare): boolean {
    const entry = view.board[square];
    if (!entry || entry.faceDown) return false;
    return view.legalMoves.some((move) => move.from === square && move.to !== square);
  }

  function canDrag(square: JungleFlipSquare): boolean {
    if (!opts.enabled()) return false;
    const view = opts.getInteractionView();
    if (view?.status.type !== 'playing') return false;
    return canSelect(view, square);
  }

  function handleDrop(from: JungleFlipSquare, to: JungleFlipSquare | null): void {
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
    ghostSizePx: () => opts.board.getBoundingClientRect().width / JUNGLE_FLIP_BOARD_VIEW.files,
    onSquareClick: (square) => handleClick(square as JungleFlipSquare),
    canDragFrom: (square) => canDrag(square as JungleFlipSquare),
    ghostHtml: (square) => {
      const entry = opts.getInteractionView()?.board[square as JungleFlipSquare];
      return entry && !entry.faceDown ? jungleFlipPieceGhostSvg(entry) : null;
    },
    onDragStart: (from) => {
      selectedSquare = from as JungleFlipSquare;
      draggingFrom = from as JungleFlipSquare;
      rerender();
    },
    onDrop: (from, to) => handleDrop(from as JungleFlipSquare, to as JungleFlipSquare | null),
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
