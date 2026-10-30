// The gamebook (interactive-lesson) PLAYER. gamebook-play.test.ts proves the
// state machine; this proves the surface a learner sees -- that a correct move
// advances with the coach's encouragement, that a wrong one shows the author's
// "why not" and the next move is the retry, and that reaching the tip says so.
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
import { afterEach, beforeEach, expect, test } from 'vitest';
import { LOCALE_STORAGE_KEY, setStoredLocale } from '../i18n/locale.js';
import { createGameTree } from './game-tree.js';
import { serializeTree } from './tree-serialize.js';
import { mountXiangqiGamebook } from './xiangqi-gamebook.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  setStoredLocale('en');
});
afterEach(() => window.localStorage.removeItem(LOCALE_STORAGE_KEY));

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

const LOCALES = [
  {
    locale: 'en',
    red: 'Red to play',
    black: 'Black to play',
    task: 'Find the best move.',
    board: 'Xiangqi lesson board',
    hint: 'Hint',
    fallback: 'Look at the circled piece.',
    wrong: 'Not that one. Try another move.',
    correct: 'Correct! Keep going.',
    complete: 'Lesson complete! 🎉',
    restart: 'Restart lesson',
  },
  {
    locale: 'zh-Hans',
    red: '红方走棋',
    black: '黑方走棋',
    task: '找出最佳着法。',
    board: '象棋课程棋盘',
    hint: '提示',
    fallback: '看看圈出的棋子。',
    wrong: '不是这一着，试试其他着法。',
    correct: '正确！继续。',
    complete: '课程完成！🎉',
    restart: '重新开始课程',
  },
  {
    locale: 'zh-Hant',
    red: '紅方走棋',
    black: '黑方走棋',
    task: '找出最佳著法。',
    board: '象棋課程棋盤',
    hint: '提示',
    fallback: '看看圈出的棋子。',
    wrong: '不是這一著，試試其他著法。',
    correct: '正確！繼續。',
    complete: '課程完成！🎉',
    restart: '重新開始課程',
  },
] as const;

for (const copy of LOCALES) {
  test(`${copy.locale}: hint, wrong move, correct move, completion and restart`, () => {
    setStoredLocale(copy.locale);
    const { host, m1, m3, wrongFirst } = mount();
    expect(host.querySelector('.gamebook__prompt-side')?.textContent).toBe(copy.red);
    expect(host.querySelector('.gamebook__prompt-task')?.textContent).toBe(copy.task);
    expect(host.querySelector('.gamebook__board')?.getAttribute('aria-label')).toBe(copy.board);
    const [hint, restart] = host.querySelectorAll<HTMLButtonElement>('.gamebook__controls button');
    expect(hint?.textContent).toBe(copy.hint);
    expect(restart?.textContent).toBe(copy.restart);
    hint?.click();
    expect(host.querySelector('.gamebook__hint')?.textContent).toBe(copy.fallback);
    expect(host.querySelector('.xq-marker--gamebook-hint')).not.toBeNull();
    play(host, wrongFirst);
    expect(feedback(host)).toBe(copy.wrong);
    play(host, m1);
    expect(feedback(host)).toBe(copy.correct);
    expect(host.querySelector('.gamebook__hint')?.textContent).toBe('');
    play(host, m3);
    expect(feedback(host)).toBe(copy.complete);
    expect(hint?.hidden).toBe(true);
    expect(restart?.hidden).toBe(false);
    restart?.click();
    expect(state(host)).toBe('play');
    expect(feedback(host)).toBe('');
    expect(hint?.hidden).toBe(false);
    expect(restart?.hidden).toBe(true);
    play(host, m1);
    expect(feedback(host)).toBe(copy.correct);
  });

  test(`${copy.locale}: black prompt and authored lesson text and names survive`, () => {
    setStoredLocale(copy.locale);
    const { tree, wrongFirst } = fixture();
    tree.root.annotations = {
      comments: [{ text: 'Authored comment', by: 'Coach' }],
      gamebook: { hint: 'Authored hint', deviation: 'Authored deviation' },
    };
    const host = document.createElement('div');
    const opts = {
      tree,
      title: 'Authored title',
      summary: 'Authored summary',
      game: { detail: 'Recorded event' },
      seats: { red: 'Original Red', black: 'Original Black' },
    };
    mountXiangqiGamebook(host, { ...opts, orientation: 'black' });
    expect(host.querySelector('.gamebook__prompt-side')?.textContent).toBe(copy.black);
    mountXiangqiGamebook(host, { ...opts, orientation: 'red' });
    for (const text of [
      'Authored title',
      'Authored summary',
      'Recorded event',
      'Original Red',
      'Original Black',
      'Authored comment',
    ])
      expect(host.textContent).toContain(text);
    host.querySelector<HTMLButtonElement>('.gamebook__controls button')?.click();
    expect(host.querySelector('.gamebook__hint')?.textContent).toBe('Authored hint');
    play(host, wrongFirst);
    expect(feedback(host)).toBe('Authored deviation');
    expect(host.querySelector('.gamebook__comment')?.textContent).toBe('Authored comment');
  });
}

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

test('a legal wrong move is refused, and the next move is the retry', () => {
  const { host, wrongFirst, m1 } = mount();
  play(host, wrongFirst);
  expect(state(host)).toBe('bad');
  expect(feedback(host)).toBe('Not that one. Try another move.');
  // No take-back button: the board stays live after a wrong move.
  const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
  expect(retry).toBeUndefined();
  play(host, m1);
  expect(state(host)).not.toBe('bad');
});

test('reaching the tip completes the lesson', () => {
  const { host, m1, m3 } = mount();
  play(host, m1);
  play(host, m3);
  expect(state(host)).toBe('end');
  expect(feedback(host)).toBe('Lesson complete! 🎉');
});

test('the hint rings the piece the lesson moves', () => {
  const { host } = mount();
  const hint = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Hint');
  expect(hint?.hidden).toBe(false);
  hint?.click();
  expect(host.querySelector('.xq-marker--gamebook-hint')).not.toBeNull();
});

const LOCALE_COPY = [
  {
    locale: 'en',
    board: 'Xiangqi lesson board',
    red: 'Red to play',
    black: 'Black to play',
    task: 'Find the best move.',
    hint: 'Hint',
    restart: 'Restart lesson',
    hintPiece: 'Look at the circled piece.',
    wrong: 'Not that one. Try another move.',
    correct: 'Correct! Keep going.',
    complete: 'Lesson complete! 🎉',
  },
  {
    locale: 'zh-Hans',
    board: '象棋课程棋盘',
    red: '红方走棋',
    black: '黑方走棋',
    task: '找出最佳着法。',
    hint: '提示',
    restart: '重新开始课程',
    hintPiece: '看看圈出的棋子。',
    wrong: '不是这一着，试试其他着法。',
    correct: '正确！继续。',
    complete: '课程完成！🎉',
  },
  {
    locale: 'zh-Hant',
    board: '象棋課程棋盤',
    red: '紅方走棋',
    black: '黑方走棋',
    task: '找出最佳著法。',
    hint: '提示',
    restart: '重新開始課程',
    hintPiece: '看看圈出的棋子。',
    wrong: '不是這一著，試試其他著法。',
    correct: '正確！繼續。',
    complete: '課程完成！🎉',
  },
] as const;

test.each(LOCALE_COPY)(
  '$locale localizes the lesson through hints, retries and completion',
  (copy) => {
    setStoredLocale(copy.locale);
    const { host, m1, m3, wrongFirst } = mount();
    expect(host.querySelector('.gamebook__board')?.getAttribute('aria-label')).toBe(copy.board);
    expect(host.querySelector('.gamebook__prompt-side')?.textContent).toBe(copy.red);
    expect(host.querySelector('.gamebook__prompt-task')?.textContent).toBe(copy.task);
    const [hint, restart] = host.querySelectorAll<HTMLButtonElement>('.gamebook__controls button');
    expect(hint?.textContent).toBe(copy.hint);
    expect(restart?.textContent).toBe(copy.restart);
    expect(hint?.hidden).toBe(false);
    expect(restart?.hidden).toBe(true);

    hint!.click();
    expect(host.querySelector('.gamebook__hint')?.textContent).toBe(copy.hintPiece);
    expect(host.querySelector('.xq-marker--gamebook-hint')).not.toBeNull();
    play(host, wrongFirst);
    expect(state(host)).toBe('bad');
    expect(feedback(host)).toBe(copy.wrong);
    play(host, m1);
    expect(feedback(host)).toBe(copy.correct);
    expect(host.querySelector('.gamebook__hint')?.textContent).toBe('');
    play(host, m3);
    expect(state(host)).toBe('end');
    expect(feedback(host)).toBe(copy.complete);
    expect(hint?.hidden).toBe(true);
    expect(restart?.hidden).toBe(false);

    restart!.click();
    expect(state(host)).toBe('play');
    expect(feedback(host)).toBe('');
    expect(hint?.hidden).toBe(false);
    expect(restart?.hidden).toBe(true);
    play(host, m1);
    expect(feedback(host)).toBe(copy.correct);
  },
);

test.each(LOCALE_COPY)('$locale prompts the black-side learner in their language', (copy) => {
  setStoredLocale(copy.locale);
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree: fixture().tree, orientation: 'black' });
  expect(host.querySelector('.gamebook__prompt-side')?.textContent).toBe(copy.black);
  expect(state(host)).toBe('play');
});

test.each(LOCALE_COPY)(
  '$locale preserves authored lesson text over the default feedback',
  (copy) => {
    setStoredLocale(copy.locale);
    const { tree, wrongFirst } = fixture();
    tree.root.annotations = {
      comments: [{ text: 'Coach comment' }],
      gamebook: { hint: 'Author hint', deviation: 'Author explanation' },
    };
    const host = document.createElement('div');
    mountXiangqiGamebook(host, {
      tree,
      orientation: 'red',
      title: 'Author title',
      summary: 'Author summary',
      game: { detail: 'Author game detail' },
      seats: { red: 'Red player', black: 'Black player' },
    });
    expect(host.querySelector('.gamebook__title')?.textContent).toBe('Author title');
    expect(host.querySelector('.gamebook__summary')?.textContent).toBe('Author summary');
    expect(host.querySelector('.gamebook__game')?.textContent).toBe('Author game detail');
    expect([...host.querySelectorAll('.review-seat__name')].map((el) => el.textContent)).toEqual([
      'Black player',
      'Red player',
    ]);
    expect(host.querySelector('.gamebook__comment')?.textContent).toBe('Coach comment');
    host.querySelector<HTMLButtonElement>('.gamebook__controls button')!.click();
    expect(host.querySelector('.gamebook__hint')?.textContent).toBe('Author hint');
    play(host, wrongFirst);
    expect(feedback(host)).toBe('Author explanation');
    expect(host.querySelector('.gamebook__comment')?.textContent).toBe('Coach comment');
  },
);
