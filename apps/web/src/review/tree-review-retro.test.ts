// "Learn from your mistakes" on the mounted xiangqi review: the Learn button
// opens the box on the position before the first mistake with the refutation
// hidden, stepping into the played move fails, the solution is viewable, and
// closing puts the advice back. The engine-graded path is covered in retro.test.ts.
import type { XiangqiMove } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pinXiangqiNotation } from '../xiangqi-notation.js';
import type { GameAnalysis } from './game-analysis.js';
import { mountXiangqiReview, type XiangqiReviewConfig } from './xiangqi-review.js';

// Red opens with the rook (a1-a2); the engine wanted the cannon (b3-e3) and
// grades a1-a2 a mistake.
const PLAYED: XiangqiMove[] = [{ from: 'a1', to: 'a2' }];

const ANALYSIS: GameAnalysis = {
  engineId: 'test',
  depth: 12,
  evals: [
    { ply: 0, cp: 20, mate: null, best: 'b3e3', pv: ['b3e3', 'h8e8'] },
    { ply: 1, cp: -120, mate: null, best: 'h8e8', pv: ['h8e8'] },
  ],
  moves: [{ ply: 1, mover: 'red', judgment: 'mistake', accuracy: 60 }],
  chancePlies: [],
  unstablePlies: [],
  bestPlayedPlies: [],
  red: { accuracy: 60, inaccuracies: 0, mistakes: 1, blunders: 0, acpl: 140 },
  black: { accuracy: 100, inaccuracies: 0, mistakes: 0, blunders: 0, acpl: 0 },
};

function mount(config: Partial<XiangqiReviewConfig> = {}): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mountXiangqiReview(root, {
    reviewSurface: 'analysis',
    ariaLabel: 'Review',
    title: 'Review',
    summary: '',
    moves: PLAYED,
    players: { red: 'Alice', black: 'Bob' },
    analysis: {
      requestLabel: 'Analyse',
      fetchCached: async () => ANALYSIS,
      run: async () => ANALYSIS,
    },
    ...config,
  });
  return root;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const comments = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.move-tree__comment')].map((el) => el.textContent ?? '');
const variations = (root: HTMLElement): number =>
  root.querySelectorAll('.move-tree__variation').length;
const currentMove = (root: HTMLElement): string =>
  root.querySelector('.review-move-list__move--current')?.textContent ?? '';
const box = (root: HTMLElement): HTMLElement | null => root.querySelector('.retro-box');
const feedback = (root: HTMLElement): string =>
  root.querySelector('.retro-box__feedback')?.className.replace(/.*--/, '') ?? '';

// These tests locate cells by from-to text; pin coordinate labels so the
// reader's notation default (algebraic) does not become the subject.
beforeEach(() => pinXiangqiNotation('coordinate'));
afterEach(() => pinXiangqiNotation(null));

describe('learn from your mistakes (mounted)', () => {
  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
  });

  it.each([null, undefined])('hides Learn on a game with retroSide %s', async (retroSide) => {
    const root = mount({ reviewSurface: 'game', retroSide });
    await settle();
    expect(root.querySelector('.analysis-summary')).not.toBeNull();
    expect(root.querySelector('.analysis-summary__learn')).toBeNull();
  });

  it('also fails closed when the surface defaults to game', async () => {
    const root = mount({ reviewSurface: undefined });
    await settle();
    expect(root.querySelector('.analysis-summary__learn')).toBeNull();
  });

  it('keeps studies without Learn even with a player side', async () => {
    const root = mount({ reviewSurface: 'study', retroSide: 'red' });
    await settle();
    expect(root.querySelector('.analysis-summary__learn')).toBeNull();
  });

  it.each([false, true])(
    'practises the game player’s Black side with initialFlipped %s',
    async (initialFlipped) => {
      const analysis: GameAnalysis = {
        ...ANALYSIS,
        evals: [...ANALYSIS.evals, { ply: 2, cp: 120, mate: null, best: 'b3e3', pv: ['b3e3'] }],
        moves: [...ANALYSIS.moves, { ply: 2, mover: 'black', judgment: 'mistake', accuracy: 60 }],
      };
      const root = mount({
        reviewSurface: 'game',
        retroSide: 'black',
        initialFlipped,
        moves: [...PLAYED, { from: 'a10', to: 'a9' }],
        analysis: {
          requestLabel: 'Analyse',
          fetchCached: async () => analysis,
          run: async () => analysis,
        },
      });
      await settle();
      const learn = () => root.querySelector<HTMLButtonElement>('.analysis-summary__learn')!;
      expect(learn()).not.toBeNull();
      learn().click();
      expect(box(root)?.textContent).toContain('Find a better move for Black');
      expect(box(root)?.textContent).toContain('a10-a9 was played');

      // A normal board flip neither changes an active session nor the next one.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
      expect(box(root)?.textContent).toContain('Find a better move for Black');
      box(root)!.querySelector<HTMLButtonElement>('.retro-box__close')!.click();
      learn().click();
      expect(box(root)?.textContent).toContain('Find a better move for Black');

      box(root)!.querySelectorAll<HTMLButtonElement>('.retro-box__choice')[1]!.click();
      expect(box(root)?.textContent).toContain("Done reviewing Black's mistakes");
      expect(box(root)?.textContent).not.toContain("Review Red's mistakes");
    },
  );

  it.each([false, true])(
    'keeps analysis retro on the bottom side with initialFlipped %s',
    async (initialFlipped) => {
      // An analysis line belongs to its reader, regardless of a supplied game side.
      const root = mount({ initialFlipped, retroSide: initialFlipped ? 'red' : 'black' });
      await settle();
      const learn = root.querySelector<HTMLButtonElement>('.analysis-summary__learn');
      expect(learn).not.toBeNull();
      learn!.click();
      expect(box(root)?.textContent).toContain(
        initialFlipped ? 'No mistakes found for Black' : 'Find a better move for Red',
      );
    },
  );

  it('opens on the position before the mistake, hides its refutation, and restores it on close', async () => {
    const root = mount();
    await settle();
    // Before: advice + refutation line visible, cursor at the end of the game.
    expect(comments(root).join(' ')).toContain('b3-e3 was best');
    expect(variations(root)).toBe(1);
    expect(currentMove(root)).toContain('a1');

    root.querySelector<HTMLButtonElement>('.analysis-summary__learn')!.click();
    const learn = box(root)!;
    expect(learn).not.toBeNull();
    expect(learn.querySelector('.retro-box__counter')?.textContent).toBe('1 / 1');
    expect(feedback(root)).toBe('find');
    expect(learn.textContent).toContain('1. a1-a2 was played');
    expect(learn.textContent).toContain('Find a better move for Red');
    // The cursor sits on the start position (nothing highlighted), and the
    // move list gives nothing away: no advice, no engine line.
    expect(currentMove(root)).toBe('');
    expect(comments(root)).toEqual([]);
    expect(variations(root)).toBe(0);
    // The Learn button reads pressed.
    expect(root.querySelector('.analysis-summary__learn')?.getAttribute('aria-pressed')).toBe(
      'true',
    );

    learn.querySelector<HTMLButtonElement>('.retro-box__close')!.click();
    expect(box(root)).toBeNull();
    expect(comments(root).join(' ')).toContain('b3-e3 was best');
    expect(variations(root)).toBe(1);
  });

  it('stepping into the played mistake fails and returns; the solution is viewable; then done', async () => {
    const root = mount();
    await settle();
    root.querySelector<HTMLButtonElement>('.analysis-summary__learn')!.click();

    // The forward control is blocked while solving …
    root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')?.click();
    expect(currentMove(root)).toBe('');
    // … but clicking the played move in the list is a try, and it is the mistake.
    root.querySelector<HTMLButtonElement>('.move-tree__move')!.click();
    expect(feedback(root)).toBe('fail');
    expect(box(root)!.textContent).toContain('You can do better');
    expect(currentMove(root)).toBe('');

    const choices = [...box(root)!.querySelectorAll<HTMLButtonElement>('.retro-box__choice')];
    choices.find((c) => c.textContent === 'View the solution')!.click();
    expect(feedback(root)).toBe('view');
    expect(box(root)!.textContent).toContain('Best was 1. b3-e3');
    expect(currentMove(root)).toContain('b3');
    // Solved: the refutation line and advice are back in the list.
    expect(variations(root)).toBe(1);
    expect(comments(root).join(' ')).toContain('b3-e3 was best');

    box(root)!.querySelector<HTMLButtonElement>('.retro-box__continue')!.click();
    expect(feedback(root)).toBe('end');
    expect(box(root)!.textContent).toContain("Done reviewing Red's mistakes");
    expect(box(root)!.textContent).toContain("Review Black's mistakes");
  });

  it('summary rows light the chart and jump to the judged ply', async () => {
    const root = mount();
    await settle();
    const row = root.querySelector<HTMLButtonElement>(
      '.analysis-summary__stat[data-judgment="mistake"]',
    )!;
    row.dispatchEvent(new Event('mouseenter'));
    expect(root.querySelectorAll('.advantage-chart__mark--mistake').length).toBe(1);
    row.dispatchEvent(new Event('mouseleave'));
    expect(root.querySelectorAll('.advantage-chart__mark').length).toBe(0);
    // Cursor is at the end (ply 1, the mistake itself); a click wraps to it again.
    row.click();
    expect(currentMove(root)).toContain('a1');
  });
});
