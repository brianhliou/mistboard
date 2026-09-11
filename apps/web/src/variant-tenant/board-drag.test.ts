import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBoardDrag } from './board-drag.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('installBoardDrag native selection', () => {
  it('prevents native selection from a draggable piece press and preserves its click handler', () => {
    const board = document.createElement('div');
    const square = document.createElement('button');
    square.dataset.square = 'e1';
    board.append(square);
    document.body.append(board);
    const onSquareClick = vi.fn();

    installBoardDrag({
      board,
      ghostSizePx: 80,
      onSquareClick,
      canDragFrom: () => true,
      ghostHtml: () => null,
      onDragStart: vi.fn(),
      onDrop: vi.fn(),
    });

    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    square.dispatchEvent(pointerDown);
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    square.click();

    expect(pointerDown.defaultPrevented).toBe(true);
    expect(onSquareClick).toHaveBeenCalledWith('e1');
  });

  it('does not block native selection when the pressed square is not draggable', () => {
    const board = document.createElement('div');
    const square = document.createElement('span');
    square.dataset.square = 'e4';
    board.append(square);

    installBoardDrag({
      board,
      ghostSizePx: 80,
      onSquareClick: vi.fn(),
      canDragFrom: () => false,
      ghostHtml: () => null,
      onDragStart: vi.fn(),
      onDrop: vi.fn(),
    });

    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    square.dispatchEvent(pointerDown);

    expect(pointerDown.defaultPrevented).toBe(false);
  });
});

// Regression: a mobile drag that the browser claims for a page scroll ends in
// pointercancel, never pointerup. Cleanup used to live only in the pointerup
// handler, so every interrupted drag stranded a position: fixed ghost in <body>
// and left the origin square rendered empty. Reported from a phone 2026-09-09
// with four stuck pieces floating over the panels below the board.
describe('installBoardDrag interrupted drags', () => {
  function mountDraggableBoard() {
    const board = document.createElement('div');
    const from = document.createElement('div');
    from.dataset.square = 'e1';
    board.append(from);
    document.body.append(board);
    return { board, from };
  }

  function beginDrag(square: HTMLElement): void {
    square.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, cancelable: true }),
    );
    document.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 60, clientY: 60 }),
    );
  }

  it('removes the ghost and releases the lifted piece when the gesture is cancelled', () => {
    const { board, from } = mountDraggableBoard();
    const onDrop = vi.fn();

    installBoardDrag({
      board,
      ghostSizePx: 80,
      onSquareClick: vi.fn(),
      canDragFrom: () => true,
      ghostHtml: () => '<svg></svg>',
      onDragStart: vi.fn(),
      onDrop,
    });

    beginDrag(from);
    expect(document.querySelector('.board-drag-ghost')).not.toBeNull();

    document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));

    expect(document.querySelector('.board-drag-ghost')).toBeNull();
    expect(onDrop).toHaveBeenCalledWith('e1', null);
  });

  it('strands no ghost when a cancelled drag is followed by another drag', () => {
    const { board, from } = mountDraggableBoard();

    installBoardDrag({
      board,
      ghostSizePx: 80,
      onSquareClick: vi.fn(),
      canDragFrom: () => true,
      ghostHtml: () => '<svg></svg>',
      onDragStart: vi.fn(),
      onDrop: vi.fn(),
    });

    beginDrag(from);
    document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    beginDrag(from);
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));

    expect(document.querySelectorAll('.board-drag-ghost')).toHaveLength(0);
  });

  it('takes the touch gesture off the page scroller so the browser cannot claim it', () => {
    const { board } = mountDraggableBoard();

    installBoardDrag({
      board,
      ghostSizePx: 80,
      onSquareClick: vi.fn(),
      canDragFrom: () => true,
      ghostHtml: () => null,
      onDragStart: vi.fn(),
      onDrop: vi.fn(),
    });

    expect(board.style.touchAction).toBe('none');
  });
});
