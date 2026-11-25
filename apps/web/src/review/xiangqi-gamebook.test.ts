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
  parseStandardXiangqiFen,
  standardXiangqiEngineFen,
  type XiangqiMove,
} from '@mistboard/game';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pieceAnimationDurationMs } from '../board-anim.js';
import { LOCALE_STORAGE_KEY, setStoredLocale } from '../i18n/locale.js';
import { playSound } from '../live-sound.js';
import * as board from '../xiangqi-board.js';
import { createGameTree } from './game-tree.js';
import { serializeTree } from './tree-serialize.js';
import { mountXiangqiGamebook } from './xiangqi-gamebook.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

// The tones are not observable under a test DOM, so the calls are what is pinned.
vi.mock('../live-sound.js', () => ({ initLiveSound: vi.fn(), playSound: vi.fn() }));
const sounds = (): string[] => vi.mocked(playSound).mock.calls.map(([kind]) => kind);

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(playSound).mockClear();
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
afterEach(() => {
  window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
const play = (host: HTMLElement, move: XiangqiMove, settle = true): void => {
  for (const square of [move.from, move.to]) {
    const hit = host.querySelector<SVGElement>(`g.xq-live-clicks > [data-square="${square}"]`);
    if (!hit) throw new Error(`no click target for ${square}`);
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
  if (settle) vi.runAllTimers();
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
  },
] as const;

for (const copy of LOCALES) {
  test(`${copy.locale}: hint, wrong move, correct move, completion`, () => {
    setStoredLocale(copy.locale);
    const { host, m1, m3, wrongFirst } = mount();
    expect(host.querySelector('.gamebook__prompt-side')?.textContent).toBe(copy.red);
    expect(host.querySelector('.gamebook__prompt-task')?.textContent).toBe(copy.task);
    expect(host.querySelector('.gamebook__board')?.getAttribute('aria-label')).toBe(copy.board);
    const [hint] = host.querySelectorAll<HTMLButtonElement>('.gamebook__controls button');
    expect(hint?.textContent).toBe(copy.hint);
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
    expect(host.querySelectorAll('.gamebook__controls button').length).toBe(1);
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
      seats: { red: 'Original Red', black: 'Original Black' },
    };
    mountXiangqiGamebook(host, { ...opts, orientation: 'black' });
    expect(host.querySelector('.gamebook__prompt-side')?.textContent).toBe(copy.black);
    mountXiangqiGamebook(host, { ...opts, orientation: 'red' });
    for (const text of [
      'Authored title',
      'Authored summary',
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

const nextButton = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('.gamebook__next');

test('a solved line with a chapter after it leads to Next puzzle, and says Solved', () => {
  const { tree, m1, m3 } = fixture();
  const host = document.createElement('div');
  const onNext = vi.fn();
  mountXiangqiGamebook(host, {
    tree,
    orientation: 'red',
    progress: { index: 1, total: 10 },
    onNext,
  });
  expect(host.querySelector('.gamebook__progress')?.textContent).toBe('#1of 10');
  // Offered only once the line is solved.
  expect(nextButton(host)?.hidden).toBe(true);
  play(host, m1);
  expect(nextButton(host)?.hidden).toBe(true);
  play(host, m3);
  expect(state(host)).toBe('end');
  const next = nextButton(host);
  expect(next?.hidden).toBe(false);
  expect(next?.textContent).toBe('Next puzzle');
  // Next is the only control once solved; there is no Restart.
  const shown = [...host.querySelectorAll<HTMLButtonElement>('.gamebook__controls button')].filter(
    (b) => !b.hidden,
  );
  expect(shown.map((b) => b.textContent)).toEqual(['Next puzzle']);
  // The header stops asking for a move, and no "Lesson complete" dead end.
  const side = host.querySelector<HTMLElement>('.gamebook__prompt-side');
  expect(side?.textContent).toBe('Solved. 🎉');
  expect(side?.classList.contains('gamebook__prompt-side--solved')).toBe(true);
  expect(host.querySelector<HTMLElement>('.gamebook__prompt-task')?.hidden).toBe(true);
  expect(feedback(host)).toBe('');
  next?.click();
  expect(onNext).toHaveBeenCalledTimes(1);
});

test('solved, a tap on the board tucks the text and a tap on the text opens it', () => {
  const { tree, m1, m3 } = fixture();
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree, orientation: 'red', onNext: () => {} });
  const coach = host.querySelector<HTMLElement>('.gamebook__coach')!;
  const frame = host.querySelector<HTMLElement>('.gamebook__board-frame')!;
  // Before the line is solved a tap on the board is only a move.
  frame.click();
  expect(coach.dataset.tucked).toBeUndefined();
  play(host, m1);
  play(host, m3);
  // The tap that solved it opens the text; it does not tuck it.
  expect(state(host)).toBe('end');
  expect(coach.dataset.tucked).toBeUndefined();
  frame.click();
  expect(coach.dataset.tucked).toBe('true');
  // Next puzzle is a button on the strip and leaves it tucked.
  nextButton(host)?.click();
  expect(coach.dataset.tucked).toBe('true');
  host.querySelector<HTMLElement>('.gamebook__bubble')!.click();
  expect(coach.dataset.tucked).toBeUndefined();
});

test('the last chapter offers no Next and keeps the closing line', () => {
  const { tree, m1, m3 } = fixture();
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree, orientation: 'red', progress: { index: 10, total: 10 } });
  play(host, m1);
  play(host, m3);
  expect(state(host)).toBe('end');
  expect(nextButton(host)).toBeNull();
  expect(feedback(host)).toBe('Lesson complete! 🎉');
  expect(host.querySelector('.gamebook__prompt-side')?.textContent).toBe('Solved. 🎉');
});

test('the generic task line gives way to the author comment', () => {
  const plain = mount().host;
  expect(plain.querySelector<HTMLElement>('.gamebook__prompt-task')?.hidden).toBe(false);
  const { tree } = fixture();
  tree.root.annotations = { comments: [{ text: 'Checkmate in one move.' }] };
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree, orientation: 'red' });
  expect(host.querySelector('.gamebook__comment')?.textContent).toBe('Checkmate in one move.');
  expect(host.querySelector<HTMLElement>('.gamebook__prompt-task')?.hidden).toBe(true);
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
    const [hint] = host.querySelectorAll<HTMLButtonElement>('.gamebook__controls button');
    expect(hint?.textContent).toBe(copy.hint);
    expect(hint?.hidden).toBe(false);

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
      seats: { red: 'Red player', black: 'Black player' },
    });
    expect(host.querySelector('.gamebook__title')?.textContent).toBe('Author title');
    expect(host.querySelector('.gamebook__summary')?.textContent).toBe('Author summary');
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

/** Mid-game root with Black to move; Red is the learner. */
function opponentFixture() {
  const initial = createInitialXiangqiState('moment');
  const root = applyStandardXiangqiMove(initial, getStandardXiangqiLegalMoves(initial)[0]!);
  root.moveNumber = 20;
  const moves: XiangqiMove[] = [];
  let position = root;
  for (let i = 0; i < 4; i++) {
    const move = getStandardXiangqiLegalMoves(position)[0]!;
    moves.push(move);
    position = applyStandardXiangqiMove(position, move);
  }
  const tree = createGameTree(xiangqiTreeAdapter, moves, root);
  const blob = serializeTree(tree, xiangqiTreeAdapter, { rootFen: standardXiangqiEngineFen(root) });
  return { blob, tree, moves };
}

test('first paint shows the pre-move position before sliding the opponent move', () => {
  const { blob, tree, moves } = opponentFixture();
  const animate = vi.spyOn(board, 'animateXiangqiBoardMove');
  const paint = vi.spyOn(board, 'createXiangqiInteractiveBoard');
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree: blob, orientation: 'red' });
  const interactive: ReturnType<typeof board.createXiangqiInteractiveBoard> =
    paint.mock.results[0]!.value;
  const render = vi.spyOn(interactive, 'render');
  const first = moves[0]!;
  expect(host.querySelector(`[data-piece-square="${first.from}"]`)).not.toBeNull();
  expect(host.querySelector(`[data-piece-square="${first.to}"]`)).toBeNull();
  expect(host.querySelector('.gamebook__board')?.getAttribute('aria-busy')).toBe('true');
  vi.advanceTimersByTime(499);
  expect(animate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(render.mock.calls.at(-1)?.[0]?.lastMove).toMatchObject(first);
  expect(
    host.querySelector('[data-board-lastmove-over]')?.innerHTML ||
      host.querySelector('.xq-live-lastmove')?.innerHTML,
  ).toBeTruthy();
  expect(animate).toHaveBeenCalledWith(expect.any(HTMLElement), first, 'red');
  // A click during the slide cannot submit the learner's answer.
  play(host, moves[1]!, false);
  expect(host.querySelectorAll('.gamebook__moves .review-move-list__san')).toHaveLength(1);
  expect(host.querySelector('.gamebook__board')?.getAttribute('aria-busy')).toBe('true');
  expect(state(host)).toBe('play');
  vi.advanceTimersByTime(pieceAnimationDurationMs());
  expect(host.querySelector('.gamebook__board')?.getAttribute('aria-busy')).toBe('false');
  play(host, moves[1]!);
  expect(animate).toHaveBeenLastCalledWith(expect.any(HTMLElement), moves[2], 'red');
  play(host, moves[3]!);
  expect(state(host)).toBe('end');
  expect(tree.root.truth.moveNumber).toBe(20);
});

test.each([
  { notation: 'wxf', label: 'P1+1' },
  { notation: 'algebraic', label: 'Pa6' },
  { notation: 'chinese', label: '卒1进1' },
])('history shows only played moves in $notation with real game numbers', ({ notation, label }) => {
  if (notation === 'chinese') setStoredLocale('zh-Hans');
  window.localStorage.setItem('mistboard.xiangqiNotation', notation);
  const { blob, tree, moves } = opponentFixture();
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree: blob, orientation: 'red' });
  vi.runAllTimers();
  const labels = () =>
    [...host.querySelectorAll('.gamebook__moves .review-move-list__san')].map(
      (el) => el.textContent,
    );
  const first = tree.root.children[0]!;
  expect(first.label).toBe(label);
  expect(labels()).toEqual([first.label]);
  expect(host.querySelector('.gamebook__moves .review-move-list__number')?.textContent).toBe('20');
  expect(host.querySelector('.gamebook__moves .review-move-list__move--gap')).not.toBeNull();
  play(host, moves[1]!);
  expect(labels()).toEqual([
    first.label,
    first.children[0]!.label,
    first.children[0]!.children[0]!.label,
  ]);
  expect(
    [...host.querySelectorAll('.gamebook__moves .review-move-list__number')].map(
      (el) => el.textContent,
    ),
  ).toEqual(['20', '21']);
  expect(host.querySelector('.gamebook__coach')?.firstElementChild?.className).toBe(
    'gamebook__prompt',
  );
});

test('a chapter change cancels the pending auto-move paint and sound', () => {
  const animate = vi.spyOn(board, 'animateXiangqiBoardMove');
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree: opponentFixture().blob, orientation: 'red' });
  mountXiangqiGamebook(host, { tree: fixture().tree, orientation: 'red' });
  vi.runAllTimers();
  expect(animate).not.toHaveBeenCalled();
  expect(host.querySelector('.gamebook__board')?.getAttribute('aria-busy')).toBe('false');
});

/** Red to play and mate in one: the chariot from a1 to e1 checks down the open
 *  file, and the black chariots beside the general block its only side steps.
 *  The advisor on f3 shields the red general from the chariot on f10. */
function mateFixture() {
  const parsed = parseStandardXiangqiFen('3rkr3/9/9/9/9/9/9/5A3/9/R4K3 w - - 0 1');
  if (!parsed.ok) throw new Error('bad fixture FEN');
  const root = parsed.state;
  const legal = getStandardXiangqiLegalMoves(root);
  const mate = legal.find((m) => m.from === 'a1' && m.to === 'e1')!;
  const quiet = legal.find((m) => m.from === 'a1' && m.to === 'a2')!;
  const tree = createGameTree(xiangqiTreeAdapter, [mate], root);
  const blob = serializeTree(tree, xiangqiTreeAdapter, { rootFen: standardXiangqiEngineFen(root) });
  return { blob, mate, quiet, after: applyStandardXiangqiMove(root, mate) };
}

const slash = (host: HTMLElement) => host.querySelector<HTMLElement>('.finish-badge--mated');

test('the mating move slashes the mated general and sounds the solve, once', () => {
  const { blob, mate, after } = mateFixture();
  // The kernel decides it, not the notation: the fixture really is mate.
  expect(after.status).toMatchObject({ type: 'finished', reason: 'checkmate', winner: 'red' });
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree: blob, orientation: 'red', onNext: () => {} });
  expect(slash(host)).toBeNull();
  play(host, mate);
  expect(state(host)).toBe('end');
  expect(slash(host)?.dataset.finishSquare).toBe('e10');
  // The puzzle page's check on the move just played.
  expect(host.querySelector('.xq-marker--good')).not.toBeNull();
  // The solve sound replaces the move sound; no second end chime under it.
  expect(sounds()).toEqual(['puzzle-solved']);
  // The panel says so: the solved band and the Next button.
  expect(host.querySelector('.gamebook__prompt-side--solved')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('.gamebook__next')?.hidden).toBe(false);
});

test('a line that ends without mate draws no slash, and the solve sounds once', () => {
  const { host, m1, m3 } = mount();
  play(host, m1);
  // The learner's own move sound, then the reply's, as on the puzzle page.
  expect(sounds().length).toBeGreaterThanOrEqual(1);
  expect(sounds()).not.toContain('puzzle-solved');
  vi.mocked(playSound).mockClear();
  play(host, m3);
  expect(state(host)).toBe('end');
  expect(sounds()).toEqual(['puzzle-solved']);
  expect(host.querySelector('.finish-badge')).toBeNull();
});

test('a wrong try stays under a cross, then glides back before the retry', () => {
  const { blob, mate, quiet } = mateFixture();
  const animate = vi.spyOn(board, 'animateXiangqiBoardMove');
  const host = document.createElement('div');
  mountXiangqiGamebook(host, { tree: blob, orientation: 'red' });
  play(host, quiet, false);
  expect(sounds()).toEqual(['learn-failure']);
  expect(state(host)).toBe('bad');
  const cross = () => host.querySelector('.xq-marker--blunder');
  expect(cross()).not.toBeNull();
  expect(host.querySelector('[data-piece-square="a2"]')).not.toBeNull();
  expect(host.querySelector('.gamebook__board')?.getAttribute('aria-busy')).toBe('true');
  // Held: the board takes no move yet.
  play(host, mate, false);
  expect(state(host)).toBe('bad');
  vi.advanceTimersByTime(700);
  expect(cross()).toBeNull();
  expect(host.querySelector('[data-piece-square="a1"]')).not.toBeNull();
  expect(animate).toHaveBeenLastCalledWith(expect.any(HTMLElement), quiet, 'red', {
    reverse: true,
  });
  expect(slash(host)).toBeNull();
  play(host, mate);
  expect(state(host)).toBe('end');
  expect(slash(host)).not.toBeNull();
});
