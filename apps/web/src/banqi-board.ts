// Interactive Banqi board for the review/analysis surface: a
// factory-wrapped click-to-flip / click-or-drag-to-move board, mirroring
// createJungleInteractiveBoard (jungle-board.ts). It stands on the SAME shared
// primitives the live boards use — installBoardDrag (DOM `[data-square]`
// hit-testing) + installSelectionClickAway — and delegates the click decision to
// the pure banqiClickResult (live-banqi-interaction.ts) so the review board and
// the live board agree on flip-vs-select-vs-move exactly.
//
// Banqi is symmetric-info with a hidden deal: a face-down tile is FLIPPED by a
// direct one-click self-move (never selected); a revealed own piece selects then
// moves (click a target, or drag). Only revealed pieces are draggable — a flip is
// click-only. Engine moves render as arrows; flip recommendations render as
// rings around their face-down destination.

import type { BanqiMove, BanqiPlayerView, BanqiSeat, BanqiSquare } from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { banqiClickResult } from './live-banqi-interaction.js';
import {
  type BanqiBoardArrow,
  type BanqiBoardMarker,
  banqiArrowSvg,
  banqiMarkerSvg,
  banqiPieceGhostSvg,
  renderBanqiBoardSvg,
} from './live-banqi-render.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

// 8 files across (a..h); the board is 8×4. Used only to size the drag ghost to the
// currently rendered cell width.
const BANQI_FILES = 8;

export interface BanqiInteractiveBoardOptions {
  board: HTMLElement;
  getInteractionView: () => BanqiPlayerView | null;
  getPerspective: () => BanqiSeat;
  /** Whose pieces are interactive: the side to move (review plays both sides).
   *  Null = nobody (game over). */
  seatFor: (view: BanqiPlayerView) => BanqiSeat | null;
  enabled: () => boolean;
  onMove: (move: BanqiMove, view: BanqiPlayerView) => void;
}

export interface BanqiInteractiveBoard {
  render(view: BanqiPlayerView | null, perspective: BanqiSeat): void;
  clearSelection(): void;
  setArrows(arrows: readonly BanqiBoardArrow[]): void;
  setMarkers(markers: readonly BanqiBoardMarker[]): void;
}

export function createBanqiInteractiveBoard(
  opts: BanqiInteractiveBoardOptions,
): BanqiInteractiveBoard {
  let selectedSquare: BanqiSquare | null = null;
  let draggingFrom: BanqiSquare | null = null;
  let arrows: readonly BanqiBoardArrow[] = [];
  let markers: readonly BanqiBoardMarker[] = [];

  function render(view: BanqiPlayerView | null, perspective: BanqiSeat): void {
    if (!view) {
      opts.board.replaceChildren();
      return;
    }
    opts.board.innerHTML = renderBanqiBoardSvg(view, perspective, {
      interactive: true,
      selectedSquare,
      legalMoves: view.legalMoves,
      draggingFrom,
      arrows,
      markers,
      coordinates: boardCoordinatesEnabled(),
    });
  }

  function setArrows(next: readonly BanqiBoardArrow[]): void {
    arrows = next;
    const layer = opts.board.querySelector('.xq-live-arrows');
    if (layer) layer.innerHTML = arrows.map(banqiArrowSvg).join('');
  }

  function setMarkers(next: readonly BanqiBoardMarker[]): void {
    markers = next;
    const layer = opts.board.querySelector('.xq-live-markers');
    if (layer) layer.innerHTML = markers.map(banqiMarkerSvg).join('');
  }

  function rerender(): void {
    render(opts.getInteractionView(), opts.getPerspective());
  }

  function clearSelection(): void {
    selectedSquare = null;
    draggingFrom = null;
  }

  function handleClick(square: BanqiSquare): void {
    if (opts.enabled()) {
      const view = opts.getInteractionView();
      if (view) {
        const seat = opts.seatFor(view);
        const result = banqiClickResult(view, seat, selectedSquare, square);
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

  // Only revealed pieces of the side to move with a legal board move are draggable
  // (legalMoves already carries only the mover's moves; a face-down tile flips via
  // click, so it is never a drag source).
  function canDrag(square: BanqiSquare): boolean {
    if (!opts.enabled()) return false;
    const view = opts.getInteractionView();
    if (view?.status.type !== 'playing') return false;
    const entry = view.board[square];
    if (!entry || entry.faceDown) return false;
    return view.legalMoves.some((move) => move.from === square && move.to !== square);
  }

  function handleDrop(from: BanqiSquare, to: BanqiSquare | null): void {
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
    ghostSizePx: () => opts.board.getBoundingClientRect().width / BANQI_FILES,
    onSquareClick: (square) => handleClick(square as BanqiSquare),
    canDragFrom: (square) => canDrag(square as BanqiSquare),
    ghostHtml: (square) => {
      const entry = opts.getInteractionView()?.board[square as BanqiSquare];
      return entry && !entry.faceDown ? banqiPieceGhostSvg(entry) : null;
    },
    onDragStart: (from) => {
      selectedSquare = from as BanqiSquare;
      draggingFrom = from as BanqiSquare;
      rerender();
    },
    onDrop: (from, to) => handleDrop(from as BanqiSquare, to as BanqiSquare | null),
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
