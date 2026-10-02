import {
  applyCrazyhouseXiangqiMove,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  crazyhouseXiangqiBoardView,
  crazyhouseXiangqiDropTargets,
  crazyhouseXiangqiLastDrop,
  crazyhouseXiangqiMoveLabel,
  fillCrazyhouseXiangqiReserve,
} from './crazyhouse-xiangqi-view.js';
import { xiangqiBoardSvg } from './xiangqi-board.js';

// Cxh10 Rxh10, then Red holds a horse and Black a cannon, Red to move.
function afterTrade() {
  let state = createInitialCrazyhouseXiangqiState('view-test');
  const line: CrazyhouseXiangqiMove[] = [
    { from: 'h3', to: 'h10' },
    { from: 'i10', to: 'h10' },
  ];
  for (const move of line) state = applyCrazyhouseXiangqiMove(state, move);
  return state;
}

describe('crazyhouse xiangqi board view', () => {
  it('hands the shared board only board moves, and marks every drop target as a destination', () => {
    const view = getCrazyhouseXiangqiPlayerView(afterTrade(), 'red');
    const board = crazyhouseXiangqiBoardView(view);
    expect(board.legalMoves.every((move) => 'from' in move)).toBe(true);
    expect(board.legalMoves.length).toBeLessThan(view.legalMoves.length);

    const targets = crazyhouseXiangqiDropTargets(view, 'horse');
    expect(targets).toContain('e5');
    expect(targets.every((square) => view.board[square] === undefined)).toBe(true);
    expect(crazyhouseXiangqiDropTargets(view, null)).toEqual([]);

    const svg = xiangqiBoardSvg(board, 'red', {
      interactive: true,
      selectedSquare: null,
      draggingFrom: null,
      dropTargets: targets,
    });
    const host = document.createElement('div');
    host.innerHTML = svg;
    expect(host.querySelectorAll('.xq-live-hit--target').length).toBe(targets.length);
    expect(host.querySelector('[data-square="e5"].xq-live-hit--target')).not.toBeNull();
  });

  it('rings only the landing point after a drop, and labels drops with the engine letters', () => {
    const state = applyCrazyhouseXiangqiMove(afterTrade(), { drop: 'horse', to: 'e5' });
    const view = getCrazyhouseXiangqiPlayerView(state, 'red');
    expect(crazyhouseXiangqiLastDrop(view)).toBe('e5');
    const board = crazyhouseXiangqiBoardView(view);
    expect(board.lastMove).toBeUndefined();

    const host = document.createElement('div');
    host.innerHTML = xiangqiBoardSvg(board, 'red', {
      interactive: false,
      selectedSquare: null,
      draggingFrom: null,
      lastDropSquare: crazyhouseXiangqiLastDrop(view),
    });
    expect(host.querySelectorAll('.xq-live-lastmove-ring').length).toBe(1);
    expect(host.querySelector('.xq-live-lastmove-from')).toBeNull();

    expect(crazyhouseXiangqiMoveLabel({ drop: 'elephant', to: 'c1' })).toBe('B@c1');
    expect(crazyhouseXiangqiMoveLabel({ from: 'h3', to: 'h10' })).toBe('h3-h10');
  });

  it('draws a hand as a strip of held pieces, interactive only when asked', () => {
    const view = getCrazyhouseXiangqiPlayerView(afterTrade(), 'red');
    const red = document.createElement('div');
    const black = document.createElement('div');
    fillCrazyhouseXiangqiReserve(red, view, 'red', { interactive: true });
    fillCrazyhouseXiangqiReserve(black, view, 'black');
    expect(red.querySelectorAll('button[data-drop="horse"]').length).toBe(1);
    expect(black.querySelectorAll('button').length).toBe(0);
    expect(black.querySelectorAll('.drop-mini-reserve-piece').length).toBe(1);
  });
});
