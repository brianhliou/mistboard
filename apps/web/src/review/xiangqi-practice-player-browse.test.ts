// Looking back through a practice attempt: every played move is a button that
// shows the board as it stood then, the board stays closed while looking back,
// and a move glides onto the board rather than snapping (2026-11-11 review).

import {
  endgameEntryState,
  getStandardXiangqiLegalMoves,
  XIANGQI_ENDGAME_CORPUS,
  type XiangqiGameState,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { expect, test, vi } from 'vitest';
import type { PracticeEval } from './practice-play.js';

const animate = vi.hoisted(() => vi.fn());
vi.mock('../xiangqi-board.js', async (importActual) => {
  const actual = await importActual<typeof import('../xiangqi-board.js')>();
  return { ...actual, animateXiangqiBoardMove: animate };
});

const { mountXiangqiPractice } = await import('./xiangqi-practice-player.js');

const row = XIANGQI_ENDGAME_CORPUS.find((r) => r.id === 'soldier-vs-bare-general')!;

async function steady(truth: XiangqiGameState): Promise<PracticeEval> {
  if (truth.status.type !== 'playing') return { cp: null, mate: null, bestUci: null };
  const best = getStandardXiangqiLegalMoves(truth)[0];
  return {
    cp: truth.status.turn === 'red' ? 700 : -700,
    mate: null,
    bestUci: best ? xiangqiMoveToFsfUci(best) : null,
  };
}

async function playedOnce() {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountXiangqiPractice(host, {
    initialTruth: endgameEntryState(row),
    goal: { kind: 'mate' },
    orientation: row.turn,
    evaluate: steady,
    replyDelayMs: 0,
    title: 'Basic endgames',
  });
  await handle.ready();
  await handle.play(getStandardXiangqiLegalMoves(endgameEntryState(row))[0]!);
  return { host, handle };
}

const board = (host: HTMLElement): string =>
  host.querySelector('.gamebook__board')?.innerHTML ?? '';
const moveButtons = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>('.practice__move-button'),
];
const steps = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>('.practice__step'),
];

test('a played move is a button that shows the board as it stood then', async () => {
  const { host } = await playedOnce();
  const live = board(host);
  const buttons = moveButtons(host);
  expect(buttons.length, 'the learner move and the reply are both listed').toBe(2);

  buttons[0]!.click();
  expect(board(host)).not.toBe(live);
  expect(host.querySelector('.practice--browsing')).not.toBeNull();
  expect(host.querySelector('.practice__move.is-current')?.textContent).toBe(
    buttons[0]!.textContent,
  );

  // The newest move takes the reader back to the live board.
  moveButtons(host)[1]!.click();
  expect(board(host)).toBe(live);
  expect(host.querySelector('.practice--browsing')).toBeNull();
});

test('back and forward step one move, and stop at either end', async () => {
  const { host } = await playedOnce();
  const [prev, next] = steps(host);
  expect(next!.disabled, 'nothing ahead of the live position').toBe(true);
  prev!.click();
  prev!.click();
  expect(prev!.disabled, 'the start position has nothing behind it').toBe(true);
  expect(host.querySelector('.practice__move.is-current')).toBeNull();
  next!.click();
  next!.click();
  expect(host.querySelector('.practice--browsing')).toBeNull();
  expect(next!.disabled).toBe(true);
});

test('the arrow keys step through the line too', async () => {
  const { host } = await playedOnce();
  const live = board(host);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  expect(board(host)).not.toBe(live);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(board(host)).toBe(live);
});

test('the board is closed while looking back', async () => {
  const { host, handle } = await playedOnce();
  steps(host)[0]!.click();
  const before = handle.view().movesPlayed;
  // A click on the board while browsing must not play from the old position.
  const hit = host.querySelector<SVGElement>('.xq-live-hit');
  hit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(handle.view().movesPlayed).toBe(before);
  expect(host.querySelector('.xq-live-hit.is-selected, .xq-live-selected')).toBeNull();
});

test("the engine's reply glides, and so does a step back or forward", async () => {
  animate.mockClear();
  const { host } = await playedOnce();
  expect(animate, "the defender's reply is animated").toHaveBeenCalledTimes(1);
  steps(host)[0]!.click();
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls[1]![3]).toEqual({ reverse: true });
  steps(host)[1]!.click();
  expect(animate).toHaveBeenCalledTimes(3);
  expect(animate.mock.calls[2]![3]).toBeUndefined();
});
