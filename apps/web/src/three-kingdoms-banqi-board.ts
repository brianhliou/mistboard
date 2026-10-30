// Interactive Three Kingdoms banqi board (#628) for the study and review
// surface, mirroring createBanqiInteractiveBoard (banqi-board.ts) on the 9x5
// point board the live room draws (renderThreeKingdomsBanqiLiveBoardSvg).
//
// A face-down tile is FLIPPED by one click (the self-move); a face-up piece of
// the side to move selects, then moves by a click on a target or a drag. Which
// pieces may move is read from the view's legal moves alone, so the board never
// re-derives the rules (seat ink, the chase rule) the game package owns.

import type {
  BanqiColor,
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiPlayerView,
  ThreeKingdomsBanqiSquare,
} from '@mistboard/game';
import { flipSeatInk } from './flip-seat-ink.js';
import { banqiPieceGhostSvg } from './live-banqi-render.js';
import {
  renderThreeKingdomsBanqiLiveBoardSvg,
  TK_LIVE_BOARD_VIEW,
  type TkBoardArrow,
  type TkBoardMarker,
  tkArrowSvg,
  tkMarkerSvg,
} from './three-kingdoms-banqi-diagrams.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

type Square = ThreeKingdomsBanqiSquare;

export interface ThreeKingdomsBanqiInteractiveBoardOptions {
  board: HTMLElement;
  getInteractionView: () => ThreeKingdomsBanqiPlayerView | null;
  getPerspective: () => BanqiSeat;
  /** Whose pieces are interactive: the side to move (a study plays both
   *  sides). Null = nobody (game over). */
  seatFor: (view: ThreeKingdomsBanqiPlayerView) => BanqiSeat | null;
  enabled: () => boolean;
  onMove: (move: ThreeKingdomsBanqiMove, view: ThreeKingdomsBanqiPlayerView) => void;
}

export interface ThreeKingdomsBanqiInteractiveBoard {
  render(view: ThreeKingdomsBanqiPlayerView | null, perspective: BanqiSeat): void;
  clearSelection(): void;
  setArrows(arrows: readonly TkBoardArrow[]): void;
  setMarkers(markers: readonly TkBoardMarker[]): void;
}

/** The ink of the seat that made the view's last move (the first flip has
 *  already bound it by then), for the flip ring's colour. */
export function threeKingdomsBanqiLastMoverInk(
  view: ThreeKingdomsBanqiPlayerView,
): BanqiColor | null {
  if (!view.lastMove || view.ply < 1) return null;
  return flipSeatInk((view.ply - 1) % 2 === 0 ? 'red' : 'black', view.firstColor);
}

function boardMove(
  view: ThreeKingdomsBanqiPlayerView,
  from: Square,
  to: Square,
): ThreeKingdomsBanqiMove | undefined {
  return view.legalMoves.find((m) => m.from === from && m.to === to);
}

export function createThreeKingdomsBanqiInteractiveBoard(
  opts: ThreeKingdomsBanqiInteractiveBoardOptions,
): ThreeKingdomsBanqiInteractiveBoard {
  let selectedSquare: Square | null = null;
  let draggingFrom: Square | null = null;
  let arrows: readonly TkBoardArrow[] = [];
  let markers: readonly TkBoardMarker[] = [];

  function interactive(view: ThreeKingdomsBanqiPlayerView): boolean {
    return opts.enabled() && view.status.type === 'playing' && opts.seatFor(view) !== null;
  }

  function render(view: ThreeKingdomsBanqiPlayerView | null, _perspective: BanqiSeat): void {
    if (!view) {
      opts.board.replaceChildren();
      return;
    }
    const targets = selectedSquare
      ? view.legalMoves.filter((m) => m.from === selectedSquare && m.to !== m.from).map((m) => m.to)
      : [];
    opts.board.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(view.board, {
      selected: selectedSquare,
      targets,
      draggingFrom,
      lastMove: view.lastMove ?? null,
      lastMoveInk: threeKingdomsBanqiLastMoverInk(view),
      arrows,
      markers,
    });
  }

  function setArrows(next: readonly TkBoardArrow[]): void {
    arrows = next;
    const layer = opts.board.querySelector('.xq-live-arrows');
    if (layer) layer.innerHTML = arrows.map(tkArrowSvg).join('');
  }

  function setMarkers(next: readonly TkBoardMarker[]): void {
    markers = next;
    const layer = opts.board.querySelector('.xq-live-markers');
    if (layer) layer.innerHTML = markers.map(tkMarkerSvg).join('');
  }

  function rerender(): void {
    render(opts.getInteractionView(), opts.getPerspective());
  }

  function clearSelection(): void {
    selectedSquare = null;
    draggingFrom = null;
  }

  function play(move: ThreeKingdomsBanqiMove, view: ThreeKingdomsBanqiPlayerView): void {
    selectedSquare = null;
    draggingFrom = null;
    opts.onMove(move, view);
  }

  function handleClick(square: Square): void {
    const view = opts.getInteractionView();
    if (view && interactive(view)) {
      const entry = view.board[square];
      const flip = entry?.faceDown ? boardMove(view, square, square) : undefined;
      const target = selectedSquare ? boardMove(view, selectedSquare, square) : undefined;
      if (flip) {
        play(flip, view);
      } else if (target && target.to !== target.from) {
        play(target, view);
      } else if (
        entry &&
        !entry.faceDown &&
        view.legalMoves.some((m) => m.from === square && m.to !== square)
      ) {
        selectedSquare = square === selectedSquare ? null : square;
      } else {
        selectedSquare = null;
      }
    } else {
      selectedSquare = null;
    }
    rerender();
  }

  function canDrag(square: Square): boolean {
    const view = opts.getInteractionView();
    if (!view || !interactive(view)) return false;
    const entry = view.board[square];
    if (!entry || entry.faceDown) return false;
    return view.legalMoves.some((m) => m.from === square && m.to !== square);
  }

  function handleDrop(from: Square, to: Square | null): void {
    draggingFrom = null;
    const view = opts.getInteractionView();
    const move = to && view && to !== from ? boardMove(view, from, to) : undefined;
    selectedSquare = null;
    if (move && view) opts.onMove(move, view);
    rerender();
  }

  installBoardDrag({
    board: opts.board,
    ghostSizePx: () => {
      const width = opts.board.getBoundingClientRect().width;
      return width > 0
        ? (width * TK_LIVE_BOARD_VIEW.cell) / TK_LIVE_BOARD_VIEW.width
        : TK_LIVE_BOARD_VIEW.cell;
    },
    onSquareClick: (square) => handleClick(square as Square),
    canDragFrom: (square) => canDrag(square as Square),
    ghostHtml: (square) => {
      const entry = opts.getInteractionView()?.board[square as Square];
      return entry && !entry.faceDown ? banqiPieceGhostSvg(entry) : null;
    },
    onDragStart: (from) => {
      selectedSquare = from as Square;
      draggingFrom = from as Square;
      rerender();
    },
    onDrop: (from, to) => handleDrop(from as Square, to as Square | null),
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
