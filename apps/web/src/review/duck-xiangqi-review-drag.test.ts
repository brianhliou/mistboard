// Drag-to-move on the Duck Xiangqi boards. Both boards were click-only
// (`canDragFrom: () => false`), so pressing a piece and dragging it showed no
// ghost while every other xiangqi board lifted the piece under the pointer.
// Reported from a prod correspondence game, 2026-10-10. The review board and the
// live room install the same helper (installDuckXiangqiDrag), so this drives the
// review board's real wiring end to end: lift a piece, drop it to arm the duck
// half, then drag the duck like one more piece (Brian, 2026-10-10) or click it
// into place.

import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  type DuckXiangqiColor,
  type DuckXiangqiPlayerView,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  duckXiangqiDuckDestinations,
  getDuckXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { duckXiangqiDragSource } from '../duck-xiangqi-board.js';
import { createDuckXiangqiInteractiveBoard } from './duck-xiangqi-review.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** Black to move, with the duck on e6 after Red's b3-e3@e6. */
function blackToMove(): DuckXiangqiPlayerView {
  const state = applyDuckXiangqiTurn(createInitialDuckXiangqiState('t'), {
    from: 'b3',
    to: 'e3',
    duckTo: 'e6',
  });
  if (!state) throw new Error('b3-e3@e6 should be a legal opening turn');
  return getDuckXiangqiPlayerView(state, 'black');
}

function mount(view: DuckXiangqiPlayerView) {
  const board = document.createElement('div');
  document.body.append(board);
  const onMove = vi.fn<(move: DuckXiangqiTurn, view: DuckXiangqiPlayerView) => void>();
  const handle = createDuckXiangqiInteractiveBoard({
    board,
    getInteractionView: () => view,
    getPerspective: () => 'red',
    seatFor: (v) => (v.status.type === 'playing' ? (v.status.turn as DuckXiangqiColor) : null),
    enabled: () => true,
    onMove,
  });
  handle.render(view, 'red');
  return { board, onMove };
}

function hit(board: HTMLElement, square: DuckXiangqiSquare): Element {
  const el = board.querySelector(`[data-square="${square}"]`);
  if (!el) throw new Error(`no hit area for ${square}`);
  return el;
}

/** Press on `from` and move past the threshold; `dragEnd` releases over `to`. */
function dragStart(board: HTMLElement, from: DuckXiangqiSquare): void {
  hit(board, from).dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, button: 0, cancelable: true }),
  );
  document.dispatchEvent(
    new MouseEvent('pointermove', { bubbles: true, clientX: 60, clientY: 60 }),
  );
}

function dragEnd(board: HTMLElement, to: DuckXiangqiSquare): void {
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => hit(board, to));
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 90, clientY: 90 }));
  // A press and release on different points clicks their common ancestor, the
  // board itself, which names no square; a completed drag swallows it anyway.
  board.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** The snap disc the standard board shows under a dragged piece, on `square`. */
function snapDisc(board: HTMLElement, square: DuckXiangqiSquare): Element | null {
  return board.querySelector(
    `.xq-live-hit--target:has([data-square="${square}"]) .xq-live-target-hover`,
  );
}

/** Drop b8-e8 to arm the duck half; the duck still stands on e6. */
function armDuck(board: HTMLElement): void {
  dragStart(board, 'b8');
  dragEnd(board, 'e8');
}

describe('Duck Xiangqi drag-to-move', () => {
  it('lifts a piece into a ghost with snap discs on its moves, and a drop arms the duck half', () => {
    const view = blackToMove();
    expect(view.legalPieceMoves).toContainEqual(expect.objectContaining({ from: 'b8', to: 'e8' }));
    const { board, onMove } = mount(view);

    dragStart(board, 'b8');
    expect(document.querySelector('.board-drag-ghost svg')).not.toBeNull();
    // The origin keeps a faded copy, the standard board's drag-source look.
    expect(board.querySelector('.xq-piece--drag-source[data-piece-square="b8"]')).not.toBeNull();
    expect(snapDisc(board, 'e8')).not.toBeNull();
    expect(snapDisc(board, 'd6')).toBeNull();

    dragEnd(board, 'e8');
    expect(document.querySelector('.board-drag-ghost')).toBeNull();
    expect(board.querySelector('[data-piece-square="e8"]')).not.toBeNull();
    expect(board.querySelector('[data-piece-square="b8"]')).toBeNull();
    // Phase two at rest: no discs (plain hover previews the duck instead).
    expect(board.querySelector('.xq-live-target-hover')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('drags the duck like a piece: ghost, snap disc on the point, lands and sends the turn', () => {
    const view = blackToMove();
    const duckTo: DuckXiangqiSquare = 'e5';
    expect(view.board[duckTo]).toBeUndefined();
    expect(duckXiangqiDuckDestinations(view.board, view.duck, 'b8', 'e8')).toContain(duckTo);
    const { board, onMove } = mount(view);
    armDuck(board);

    dragStart(board, 'e6');
    expect(document.querySelector('.board-drag-ghost svg[aria-label="duck"]')).not.toBeNull();
    // The duck's starting point keeps a faded duck while it is in the air.
    expect(
      board.querySelector('.dkx-duck.xq-piece--drag-source[data-duck-square="e6"]'),
    ).not.toBeNull();
    expect(snapDisc(board, duckTo)).not.toBeNull();
    expect(snapDisc(board, 'a10')).toBeNull();

    dragEnd(board, duckTo);
    expect(document.querySelector('.board-drag-ghost')).toBeNull();
    expect(board.querySelector('.xq-piece--drag-source')).toBeNull();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]?.[0]).toEqual({ from: 'b8', to: 'e8', duckTo });
  });

  it('snaps the duck back from an illegal point and keeps the piece move', () => {
    const view = blackToMove();
    const { board, onMove } = mount(view);
    armDuck(board);
    expect(duckXiangqiDuckDestinations(view.board, view.duck, 'b8', 'e8')).not.toContain('a10');

    dragStart(board, 'e6');
    dragEnd(board, 'a10');

    expect(board.querySelector('.dkx-duck[data-duck-square="e6"]')).not.toBeNull();
    expect(board.querySelector('.xq-piece--drag-source')).toBeNull();
    expect(board.querySelector('[data-piece-square="e8"]')).not.toBeNull();
    expect(board.querySelector('.xq-live-target-hover')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('cancels a duck drag dropped back on its own point, fading nothing after', () => {
    const view = blackToMove();
    const { board, onMove } = mount(view);
    armDuck(board);

    dragStart(board, 'e6');
    expect(
      board.querySelector('.dkx-duck.xq-piece--drag-source[data-duck-square="e6"]'),
    ).not.toBeNull();
    dragEnd(board, 'e6');

    expect(board.querySelector('.dkx-duck[data-duck-square="e6"]')).not.toBeNull();
    expect(board.querySelector('.xq-piece--drag-source')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('still places the duck by click', () => {
    const view = blackToMove();
    const { board, onMove } = mount(view);
    armDuck(board);
    (hit(board, 'e5') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]?.[0]).toEqual({ from: 'b8', to: 'e8', duckTo: 'e5' });
  });

  it('puts a piece back when it is dropped on a point it cannot reach', () => {
    const view = blackToMove();
    const { board, onMove } = mount(view);

    dragStart(board, 'b8');
    expect(view.legalPieceMoves).not.toContainEqual(
      expect.objectContaining({ from: 'b8', to: 'd6' }),
    );
    dragEnd(board, 'd6');

    expect(board.querySelector('[data-piece-square="b8"]')).not.toBeNull();
    expect(board.querySelector('.xq-live-selection-cell')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('duckXiangqiDragSource', () => {
  const view = blackToMove();

  it('lifts only the mover’s own pieces in phase one, never the duck', () => {
    const phase = { kind: 'piece', selected: null } as const;
    expect(duckXiangqiDragSource({ view, seat: 'black', phase, square: 'b8' })).toBe('piece');
    expect(duckXiangqiDragSource({ view, seat: 'black', phase, square: 'e3' })).toBeNull();
    expect(duckXiangqiDragSource({ view, seat: 'black', phase, square: 'e6' })).toBeNull();
    expect(duckXiangqiDragSource({ view, seat: 'red', phase, square: 'e3' })).toBeNull();
  });

  it('lifts only the duck in phase two', () => {
    const phase = { kind: 'duck', move: { from: 'b8', to: 'e8' } } as const;
    expect(duckXiangqiDragSource({ view, seat: 'black', phase, square: 'e6' })).toBe('duck');
    expect(duckXiangqiDragSource({ view, seat: 'black', phase, square: 'a10' })).toBeNull();
  });
});
