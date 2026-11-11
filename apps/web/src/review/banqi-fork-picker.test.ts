import { createInitialThreeKingdomsBanqiState, STANDARD_BANQI_DEAL } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as localeModule from '../i18n/locale.js';
import { mountBanqiReview } from './banqi-review.js';
import {
  mountThreeKingdomsBanqiReview,
  threeKingdomsBanqiShareFen,
} from './three-kingdoms-banqi-review.js';
import type { TreeReviewHandle } from './tree-review.js';
import type { SerializedTree } from './tree-serialize.js';
import { mountXiangqiReview } from './xiangqi-review.js';

const FORK: SerializedTree = {
  version: 1,
  root: {
    children: [
      {
        uci: 'a1a1',
        children: [
          { uci: 'b1b1', children: [] },
          { uci: 'c1c1', children: [{ uci: 'd1d1', children: [] }] },
        ],
      },
    ],
  },
};

const handles: TreeReviewHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(variant: 'banqi' | 'three-kingdoms', initialTree = FORK, embedded = false) {
  const root = document.createElement('div');
  document.body.append(root);
  const config = {
    ariaLabel: 'Review',
    title: 'Review',
    summary: '',
    moves: [],
    analysis: null,
    initialTree,
    initialPosition: 'start' as const,
    embedded,
  };
  const truth = createInitialThreeKingdomsBanqiState('fork', 7);
  const handle =
    variant === 'banqi'
      ? mountBanqiReview(
          root,
          'fork',
          { deal: STANDARD_BANQI_DEAL, rules: {} },
          {
            ...config,
            tablebasePanel: false,
          },
        )
      : mountThreeKingdomsBanqiReview(root, {
          ...config,
          root: { truth, fen: threeKingdomsBanqiShareFen(truth) },
        });
  handles.push(handle);
  return { root, handle };
}

function nav(root: HTMLElement, action: 'prev' | 'next') {
  root.querySelector<HTMLButtonElement>(`.review-controls [data-replay="${action}"]`)!.click();
}
const picker = (root: HTMLElement) => root.querySelector<HTMLElement>('.review-fork-picker');
const options = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLButtonElement>('.review-fork-picker__move'),
];
const current = (root: HTMLElement) =>
  root
    .querySelector('.review-move-list__move--current .review-move-list__san')
    ?.textContent?.slice(0, 2);

describe.each(['banqi', 'three-kingdoms'] as const)('%s phone review forks', (variant) => {
  it('offers both continuations again after leaving a side line and revisiting the fork', () => {
    const { root, handle } = mount(variant);
    const saved = handle.serialize();
    expect(picker(root)?.hidden).toBe(true); // the root has one continuation
    nav(root, 'next');
    expect(picker(root)?.hidden).toBe(false);
    expect(options(root)).toHaveLength(2);
    expect(options(root)[0]?.textContent).toContain('b1(');
    expect(options(root)[0]?.textContent).toContain('Main line');
    expect(options(root)[1]?.textContent).toContain('c1(');
    // In the center stack, below the board, outside the strip and info tabs.
    expect(picker(root)?.previousElementSibling?.classList.contains('review-stage')).toBe(true);
    expect(root.querySelector('.review-rail-main')?.contains(picker(root)!)).toBe(false);
    options(root)[1]!.click();
    expect(current(root)).toBe('c1');
    expect(picker(root)?.hidden).toBe(true);
    nav(root, 'prev');
    nav(root, 'prev');
    nav(root, 'next');
    expect(picker(root)?.hidden).toBe(false);
    options(root)[1]!.click();
    expect(current(root)).toBe('c1');
    nav(root, 'next');
    expect(current(root)).toBe('d1');
    expect(picker(root)?.hidden).toBe(true);
    expect(handle.serialize()).toEqual(saved); // browsing never promotes a line
  });

  it('updates for a new board-created branch and can return to either line', () => {
    const { root } = mount(variant, {
      version: 1,
      root: { children: [{ uci: 'a1a1', children: [{ uci: 'b1b1', children: [] }] }] },
    });
    nav(root, 'next');
    const square = root.querySelector<SVGElement>('.review-board-host [data-square="c1"]')!;
    square.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(current(root)).toBe('c1');
    nav(root, 'prev');
    expect(options(root)).toHaveLength(2);
    options(root)[0]!.click();
    expect(current(root)).toBe('b1');
    nav(root, 'prev');
    options(root)[1]!.click();
    expect(current(root)).toBe('c1');
  });

  it('handles a fork at the root and hides after entering a leaf', () => {
    const { root } = mount(variant, {
      version: 1,
      root: {
        children: [
          { uci: 'a1a1', children: [] },
          { uci: 'b1b1', children: [] },
        ],
      },
    });
    expect(picker(root)?.hidden).toBe(false);
    options(root)[0]!.click();
    expect(current(root)).toBe('a1');
    expect(picker(root)?.hidden).toBe(true);
    expect(options(root)).toHaveLength(0);
  });

  it('keeps embedded reviews unchanged', () => {
    const { root } = mount(variant, FORK, true);
    expect(picker(root)).toBeNull();
  });
});

it.each([
  ['en', 'Choose a line', 'Main line'],
  ['zh-Hans', '选择分支', '主线'],
  ['zh-Hant', '選擇分支', '主線'],
] as const)('labels the picker in %s', (locale, title, mainLine) => {
  vi.spyOn(localeModule, 'currentLocale').mockReturnValue(locale);
  const { root } = mount('banqi');
  nav(root, 'next');
  expect(picker(root)?.getAttribute('aria-label')).toBe(title);
  expect(options(root)[0]?.textContent).toContain(mainLine);
});

it('does not add the short-board picker to other variants', () => {
  const root = document.createElement('div');
  document.body.append(root);
  handles.push(
    mountXiangqiReview(root, {
      ariaLabel: 'Review',
      title: 'Review',
      summary: '',
      moves: [],
      analysis: null,
    }),
  );
  expect(picker(root)).toBeNull();
});
