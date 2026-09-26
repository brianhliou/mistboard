// The gamebook (interactive-lesson) PLAYER. gamebook-play.test.ts proves the
// state machine; this proves the surface a learner sees -- that a correct move
// advances with the coach's encouragement, that a wrong one shows the author's
// "why not" and offers a retry, and that reaching the tip says so.
//
// It also pins that mounting the player is safe with the sound wiring attached.
// A jsdom run has no AudioContext, so `playSound` is a no-op here and the tones
// themselves are not observable -- but the calls still run, and a bad reference
// on one of those paths would throw where it is caught by nothing.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiLegalMoves,
  type XiangqiMove,
} from '@mistboard/game';
import { expect, test } from 'vitest';
import { createGameTree } from './game-tree.js';
import { serializeTree } from './tree-serialize.js';
import { mountXiangqiGamebook } from './xiangqi-gamebook.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

/** A three-ply lesson (red, black's reply, red) plus a legal wrong first move. */
function fixture() {
  const s0 = createInitialXiangqiState('fixture');
  const first = getStandardXiangqiLegalMoves(s0);
  const m1 = first[0]!;
  const wrongFirst = first[1]!;
  const s1 = applyStandardXiangqiMove(s0, m1);
  const m2 = getStandardXiangqiLegalMoves(s1)[0]!;
  const s2 = applyStandardXiangqiMove(s1, m2);
  const m3 = getStandardXiangqiLegalMoves(s2)[0]!;
  const tree = createGameTree(xiangqiTreeAdapter, [m1, m2, m3]);
  return { tree: serializeTree(tree, xiangqiTreeAdapter), m1, m3, wrongFirst };
}

function mount() {
  const { tree, m1, m3, wrongFirst } = fixture();
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree, orientation: 'red', title: 'Lesson' });
  return { host, m1, m3, wrongFirst };
}

/**
 * Drive a move the way a learner does: click-to-move, which the board serves off
 * a plain `click` on the hit layer (pointer events are the DRAG path). Going
 * through the real listener is the point -- calling the session directly would
 * not prove the board is wired to it.
 */
const play = (host: HTMLElement, move: XiangqiMove): void => {
  for (const square of [move.from, move.to]) {
    const hit = host.querySelector<SVGElement>(`g.xq-live-clicks > [data-square="${square}"]`);
    if (!hit) throw new Error(`no click target for ${square}`);
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
};

const feedback = (host: HTMLElement): string =>
  host.querySelector<HTMLElement>('.gamebook__feedback')?.textContent ?? '';

const state = (host: HTMLElement): string | undefined =>
  host.querySelector<HTMLElement>('.gamebook__coach')?.dataset.state;

test('the lesson opens waiting on the learner', () => {
  const { host } = mount();
  // The prompt says whose move it is; the feedback line waits for an attempt.
  expect(host.querySelector('.gamebook__prompt-side')?.textContent).toBe('Red to play');
  expect(feedback(host)).toBe('');
  expect(state(host)).toBe('play');
});

test('a correct move advances past the opponent reply and encourages', () => {
  const { host, m1 } = mount();
  play(host, m1);
  expect(feedback(host)).toBe('Correct! Keep going.');
  expect(state(host)).toBe('play');
});

test('a legal wrong move is refused with a retry, not a dead end', () => {
  const { host, wrongFirst } = mount();
  play(host, wrongFirst);
  expect(state(host)).toBe('bad');
  expect(feedback(host)).toBe('Not the move — try again.');
  const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
  expect(retry?.hidden, 'a wrong move must offer the take-back').toBe(false);
});

test('reaching the tip completes the lesson', () => {
  const { host, m1, m3 } = mount();
  play(host, m1);
  play(host, m3);
  expect(state(host)).toBe('end');
  expect(feedback(host)).toBe('Lesson complete! 🎉');
});
