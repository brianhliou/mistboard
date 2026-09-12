import type { Board, Color, PieceRole, Square } from '@mistboard/game';
import type { Api } from 'chessground/api';
import type * as cg from 'chessground/types';
import { PIECE_SVGS } from '../pieces.js';
import { boardFen, fogHiddenClass, mountBoard } from './board.js';

export type LiveBoardArrow = {
  orig: Square;
  dest: Square;
  brush?: 'green' | 'red' | 'blue' | 'yellow';
};

// A crazyhouse-style reserve shown beneath the board: the pieces a player
// holds in hand, each with a count. Rendered as cburnett glyphs to match the
// board's default piece set and the live game-room reserve strip.
export type LiveBoardPocket = {
  color: Color;
  counts: Partial<Record<PieceRole, number>>;
};

export type LiveBoardSpec = {
  board: Board;
  fogSquares?: Square[];
  orientation?: Color;
  label?: string;
  pocket?: LiveBoardPocket;
  arrows?: LiveBoardArrow[];
  highlightSquares?: Square[];
  // Squares to mark as a legal move to an empty square: a small filled green
  // dot, the same move vocabulary the xiangqi rules diagrams use.
  moveDotSquares?: Square[];
  // Squares to mark as legal captures: rendered as a green ring around the
  // piece (chessground's circle annotation), the same capture vocabulary the
  // xiangqi rules diagrams use.
  captureSquares?: Square[];
};

export type LiveBoardsLayout = 'single' | 'pair' | 'triptych' | 'grid';

export type LiveBoardsOptions = {
  layout: LiveBoardsLayout;
  boards: LiveBoardSpec[];
};

export type LiveBoardsController = {
  destroy: () => void;
};

function visibleBoard(board: Board, fogSquares: Square[]): Board {
  if (fogSquares.length === 0) return board;
  const fog = new Set(fogSquares);
  const out: Board = {};
  for (const [sq, piece] of Object.entries(board)) {
    if (piece && !fog.has(sq as Square)) out[sq as Square] = piece;
  }
  return out;
}

function squareClasses(
  fogSquares: Square[],
  highlightSquares: Square[],
  moveDotSquares: Square[],
  orientation: Color,
): cg.SquareClasses {
  const classes = new Map<cg.Key, string>();
  const add = (sq: Square, cls: string) => {
    const prior = classes.get(sq as cg.Key);
    classes.set(sq as cg.Key, prior ? `${prior} ${cls}` : cls);
  };
  for (const sq of fogSquares) classes.set(sq as cg.Key, fogHiddenClass(sq, orientation));
  for (const sq of highlightSquares) add(sq, 'deduction-highlight');
  for (const sq of moveDotSquares) add(sq, 'move-dot');
  return classes;
}

const POCKET_ORDER: PieceRole[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

function renderPocket(pocket: LiveBoardPocket): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'live-boards-pocket';

  const label = document.createElement('span');
  label.className = 'live-boards-pocket-label';
  label.textContent = 'HAND';
  strip.append(label);

  const held = POCKET_ORDER.filter((role) => (pocket.counts[role] ?? 0) > 0);
  if (held.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'live-boards-pocket-empty';
    empty.textContent = 'empty';
    strip.append(empty);
    return strip;
  }
  for (const role of held) {
    const count = pocket.counts[role] ?? 0;
    const item = document.createElement('span');
    item.className = 'live-boards-pocket-piece';
    // The cburnett source has width/height but no viewBox, so it will not scale
    // into the pocket box; re-wrap with a viewBox the way the board renderer does.
    item.innerHTML = (PIECE_SVGS[`${pocket.color}:${role}`] ?? '').replace(
      /^<svg[^>]*>/,
      '<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">',
    );
    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'live-boards-pocket-count';
      badge.textContent = String(count);
      item.append(badge);
    }
    strip.append(item);
  }
  return strip;
}

export function mountLiveBoards(host: HTMLElement, opts: LiveBoardsOptions): LiveBoardsController {
  host.classList.add('live-boards');
  host.dataset.layout = opts.layout;

  const apis: Api[] = [];
  for (const spec of opts.boards) {
    const cell = document.createElement('div');
    cell.className = 'live-boards-cell';

    const labelEl = document.createElement('div');
    labelEl.className = 'live-boards-label';
    if (spec.label) labelEl.textContent = spec.label;
    else labelEl.classList.add('live-boards-label-empty');

    const boardWrap = document.createElement('div');
    boardWrap.className = 'live-boards-board-wrap';
    const boardEl = document.createElement('div');
    boardEl.className = 'live-boards-board cg-wrap';
    boardWrap.append(boardEl);

    cell.append(labelEl, boardWrap);
    if (spec.pocket) cell.append(renderPocket(spec.pocket));
    host.append(cell);

    const fog = spec.fogSquares ?? [];
    const shapes = [
      ...(spec.arrows ?? []).map((a) => ({
        orig: a.orig as cg.Key,
        dest: a.dest as cg.Key,
        brush: a.brush ?? 'green',
      })),
      // A shape with an orig but no dest renders as a circle on that square.
      ...(spec.captureSquares ?? []).map((sq) => ({
        orig: sq as cg.Key,
        brush: 'green',
      })),
    ];
    const api = mountBoard(boardEl, {
      animation: { enabled: false },
      coordinates: false,
      coordinatesOnSquares: false,
      fen: boardFen(visibleBoard(spec.board, fog)),
      orientation: spec.orientation ?? 'white',
      highlight: {
        custom: squareClasses(
          fog,
          spec.highlightSquares ?? [],
          spec.moveDotSquares ?? [],
          spec.orientation ?? 'white',
        ),
      },
      movable: { free: false, color: undefined, dests: new Map() },
      draggable: { enabled: false },
      selectable: { enabled: false },
      premovable: { enabled: false },
      drawable: { enabled: false, shapes },
      viewOnly: true,
    });
    apis.push(api);
  }

  return {
    destroy(): void {
      for (const api of apis) api.destroy();
      host.replaceChildren();
      host.classList.remove('live-boards');
      delete host.dataset.layout;
    },
  };
}
