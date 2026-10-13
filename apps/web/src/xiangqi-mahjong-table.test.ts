import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  type XmjRoomState,
  type XmjSeat,
  xmjBotAction,
  xmjViewFor,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { xiangqiMahjongTableHtml, xmjViewOffersAction } from './xiangqi-mahjong-table.js';

function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

function botStep(state: XmjRoomState): XmjRoomState {
  for (const seat of ['east', 'west'] as const) {
    const action = xmjBotAction(xmjViewFor(state, seat), seat);
    if (action) return applyXmjMove(state, { ...action, by: seat, at: 0 });
  }
  throw new Error('nobody can act');
}

function doc(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('xiangqi mahjong table', () => {
  const state = createXmjRoomState(createXmjSetup(seeded(7)), 'xmj_test');
  const mover = state.status.type === 'playing' ? state.status.turn : ('east' as XmjSeat);
  const idle: XmjSeat = mover === 'east' ? 'west' : 'east';

  it('shows the viewer their tiles and only backs for the opponent', () => {
    const view = xmjViewFor(state, mover);
    const host = doc(xiangqiMahjongTableHtml(view, true));
    const own = view.hands[mover] ?? [];
    expect(host.querySelectorAll('.xmj-seat--self .xmj-rack .xmj-tile').length).toBe(own.length);
    expect(host.querySelectorAll('.xmj-tile--back').length).toBe(view.handCounts[idle]);
    // The dealer's opening hand has a discard to make: every tile is a button.
    expect(host.querySelectorAll('[data-xmj-tile]').length).toBe(own.length);
  });

  it('offers no discard buttons when the room says this seat may not act', () => {
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(state, mover), false));
    expect(host.querySelectorAll('[data-xmj-tile]').length).toBe(0);
  });

  it('a spectator sees two concealed hands and no actions', () => {
    const view = xmjViewFor(state, 'spectator');
    const host = doc(xiangqiMahjongTableHtml(view, true));
    expect(host.querySelectorAll('.xmj-tile--back').length).toBe(
      view.handCounts.east + view.handCounts.west,
    );
    expect(host.querySelectorAll('button').length).toBe(0);
  });

  it('seatMayAct follows the server legal actions, not the turn', () => {
    expect(xmjViewOffersAction(xmjViewFor(state, mover), mover)).toBe(true);
    expect(xmjViewOffersAction(xmjViewFor(state, idle), idle)).toBe(false);
    // After a discard, the idle seat answers the claim window.
    const action = xmjBotAction(xmjViewFor(state, mover), mover);
    if (action?.action !== 'discard') throw new Error('expected a discard');
    const after = applyXmjMove(state, { ...action, by: mover, at: 0 });
    expect(xmjViewOffersAction(xmjViewFor(after, idle), idle)).toBe(true);
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(after, idle), true));
    expect(host.querySelector('[data-xmj-pass]')).not.toBeNull();
  });

  it('renders every state of a bot match, ending in the results table', () => {
    let current = state;
    let steps = 0;
    while (current.status.type === 'playing' && steps < 5000) {
      for (const seat of ['east', 'west', 'spectator'] as const) {
        expect(() => xiangqiMahjongTableHtml(xmjViewFor(current, seat), true)).not.toThrow();
      }
      current = botStep(current);
      steps += 1;
    }
    expect(current.status.type).toBe('finished');
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(current, 'east'), true));
    expect(host.querySelectorAll('.xmj-results tbody tr').length).toBeGreaterThan(0);
    expect(host.textContent).toMatch(/wins the match|Match drawn/);
  });
});
