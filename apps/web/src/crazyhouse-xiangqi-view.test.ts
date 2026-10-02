import {
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_DROP_ROLES,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  CRAZYHOUSE_XIANGQI_POCKET_ORDER,
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

  it('draws a hand as a strip of held pieces when the pocket is off, interactive only when asked', () => {
    const view = getCrazyhouseXiangqiPlayerView(afterTrade(), 'red');
    const red = document.createElement('div');
    const black = document.createElement('div');
    fillCrazyhouseXiangqiReserve(red, view, 'red', { interactive: true });
    fillCrazyhouseXiangqiReserve(black, view, 'black');
    expect(red.querySelectorAll('button[data-drop="horse"]').length).toBe(1);
    expect(black.querySelectorAll('button').length).toBe(0);
    // The captured cannon beside the advisors and elephants Black started with.
    expect(black.querySelectorAll('.drop-mini-reserve-piece').length).toBe(3);
  });

  it('starts with advisors and elephants in hand, and drops them anywhere on the own half', () => {
    const view = getCrazyhouseXiangqiPlayerView(createInitialCrazyhouseXiangqiState('t'), 'red');
    expect(view.hands).toEqual({
      red: { advisor: 2, elephant: 2 },
      black: { advisor: 2, elephant: 2 },
    });
    for (const role of ['advisor', 'elephant'] as const) {
      const targets = crazyhouseXiangqiDropTargets(view, role);
      const rank = (square: string) => Number(square.slice(1));
      // Every empty point of ranks 1-5 (45 points, 12 occupied), none across the river.
      expect(targets.length).toBe(33);
      expect(targets.every((square) => rank(square) <= 5)).toBe(true);
      expect(targets).toContain('a5');
      expect(targets).not.toContain('a6');
    }
  });
});

describe('crazyhouse xiangqi pocket', () => {
  it('orders the pocket soldier, cannon, horse, chariot, elephant, advisor, covering every droppable role', () => {
    expect(CRAZYHOUSE_XIANGQI_POCKET_ORDER).toEqual([
      'soldier',
      'cannon',
      'horse',
      'chariot',
      'elephant',
      'advisor',
    ]);
    expect([...CRAZYHOUSE_XIANGQI_POCKET_ORDER].sort()).toEqual(
      [...CRAZYHOUSE_XIANGQI_DROP_ROLES].sort(),
    );
  });

  it('draws every role in a fixed slot, fades the ones held none of, and badges counts from two', () => {
    const host = document.createElement('div');
    fillCrazyhouseXiangqiReserve(
      host,
      { hands: { red: { horse: 1, soldier: 3 }, black: {} } },
      'red',
      { pocket: true, interactive: true, selectedRole: 'horse' },
    );
    expect(host.classList.contains('drop-pocket')).toBe(true);
    expect(host.style.getPropertyValue('--pocket-slots')).toBe('6');
    const slots = [...host.querySelectorAll<HTMLButtonElement>('.drop-mini-reserve-piece')];
    expect(slots.map((el) => el.dataset.role)).toEqual(CRAZYHOUSE_XIANGQI_POCKET_ORDER);
    const byRole = new Map(slots.map((el) => [el.dataset.role, el]));
    // Held: full colour, clickable; held none: faded and not a control.
    expect(byRole.get('soldier')?.classList.contains('is-empty')).toBe(false);
    expect(byRole.get('horse')?.disabled).toBe(false);
    expect(byRole.get('chariot')?.classList.contains('is-empty')).toBe(true);
    expect(byRole.get('chariot')?.disabled).toBe(true);
    // Count badge only from two up.
    expect(byRole.get('soldier')?.querySelector('.captures-count-badge')?.textContent).toBe('3');
    expect(byRole.get('horse')?.querySelector('.captures-count-badge')).toBeNull();
    // The lifted piece is marked.
    expect(byRole.get('horse')?.classList.contains('selected')).toBe(true);
    expect(byRole.get('horse')?.getAttribute('aria-grabbed')).toBe('true');
  });

  it('keeps an empty pocket on screen as six faded slots', () => {
    const host = document.createElement('div');
    fillCrazyhouseXiangqiReserve(host, { hands: { red: {}, black: {} } }, 'black', {
      pocket: true,
    });
    expect(host.querySelectorAll('.drop-mini-reserve-piece')).toHaveLength(6);
    expect(host.querySelectorAll('.drop-mini-reserve-piece.is-empty')).toHaveLength(6);
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });
});
