import {
  createInitialJieqiState,
  createInitialJungleFlipState,
  createInitialJungleState,
  STANDARD_JIEQI_DEAL,
  STANDARD_JUNGLE_FLIP_DEAL,
} from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { mountFortressXiangqiReview } from './fortress-xiangqi-review.js';
import { mountJieqiReview } from './jieqi-review.js';
import { mountJungleFlipReview } from './jungle-flip-review.js';
import { mountJungleReview } from './jungle-review.js';
import type { TreeReviewHandle } from './tree-review.js';
import { mountXiangqiReview } from './xiangqi-review.js';

const handles: TreeReviewHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
});

function host(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

const config = {
  ariaLabel: 'Review',
  title: 'Review',
  summary: '',
  analysis: null,
  seatLabels: true,
  players: { red: 'First player', black: 'Second player' },
  moveClocks: [
    { first: 60_000, second: 60_000 },
    { first: 58_000, second: 60_000 },
  ],
};

function key(name: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
}

function flip(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('[data-move-nav-menu]')?.click();
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((el) =>
    el.textContent?.includes('Flip board'),
  );
  expect(button).toBeDefined();
  button?.click();
}

describe('review player rows (#301)', () => {
  for (const variant of ['jieqi', 'jungle', 'jungle-flip', 'fortress'] as const) {
    it(`${variant}: clocks follow the recorded ply and the player on board flip`, () => {
      const root = host();
      if (variant === 'jieqi') {
        handles.push(
          mountJieqiReview(root, 't', STANDARD_JIEQI_DEAL, {
            ...config,
            moves: [{ from: 'a4', to: 'a5' }],
          }),
        );
      } else if (variant === 'jungle') {
        handles.push(
          mountJungleReview(root, {
            ...config,
            moves: [{ from: 'a3', to: 'a4' }],
          }),
        );
      } else if (variant === 'jungle-flip') {
        handles.push(
          mountJungleFlipReview(root, 't', STANDARD_JUNGLE_FLIP_DEAL, {
            ...config,
            moves: [{ from: 'a1', to: 'a1' }],
            seatColors: { red: 'red', black: 'black' },
          }),
        );
      } else {
        handles.push(
          mountFortressXiangqiReview(root, {
            ...config,
            moves: [{ from: 'e1', to: 'e4' }],
          }),
        );
      }
      const row = (position: string) => root.querySelector(`.review-seat--${position}`);
      expect(row('bottom')?.querySelector('.review-seat__clock')?.textContent).toBe('0:58');
      expect(row('top')?.querySelector('.review-seat__clock')?.textContent).toBe('1:00');
      key('Home');
      expect(row('bottom')?.querySelector('.review-seat__clock')?.textContent).toBe('1:00');
      key('End');
      flip(root);
      expect(row('top')?.textContent).toContain('First player');
      expect(row('top')?.querySelector('.review-seat__clock')?.textContent).toBe('0:58');
      expect(row('bottom')?.querySelector('.review-seat__clock')?.textContent).toBe('1:00');
    });
  }

  it('puts captured animals beside their capturer and clears them on rewind', () => {
    const root = host();
    handles.push(
      mountJungleReview(root, {
        ...config,
        root: {
          truth: {
            ...createInitialJungleState('t'),
            board: {
              a1: { color: 'red', role: 'lion' },
              a2: { color: 'black', role: 'cat' },
              g9: { color: 'black', role: 'lion' },
            },
          },
          fen: '',
        },
        moves: [{ from: 'a1', to: 'a2' }],
      }),
    );
    expect(root.querySelector('.review-seat--bottom [aria-label="black cat"]')).not.toBeNull();
    expect(root.querySelector('.review-shell__right .review-capture-piece')).toBeNull();
    flip(root);
    expect(root.querySelector('.review-seat--top [aria-label="black cat"]')).not.toBeNull();
    key('Home');
    expect(root.querySelector('.review-capture-piece')).toBeNull();
    expect(root.querySelectorAll('.review-seat__material')).toHaveLength(2);
  });

  it('renders a captured xiangqi horse as the board’s own piece art', () => {
    const root = host();
    handles.push(
      mountXiangqiReview(root, {
        ...config,
        moves: [{ from: 'b3', to: 'b10' }],
        openingExplorer: false,
      }),
    );
    const tile = root.querySelector('.review-seat--bottom .review-capture-piece');
    expect(tile?.getAttribute('aria-label')).toBe('black horse');
    expect(tile?.querySelector('svg')).not.toBeNull();
    key('Home');
    expect(root.querySelector('.review-capture-piece')).toBeNull();
  });

  it('keeps an unseen jieqi capture masked in the entire material row', () => {
    const root = host();
    handles.push(
      mountJieqiReview(root, 't', null, {
        ...config,
        root: {
          truth: {
            ...createInitialJieqiState('t', STANDARD_JIEQI_DEAL),
            captures: [{ owner: 'red', role: 'chariot', revealedAtCapture: false }],
          },
          fen: '',
        },
        moves: [],
      }),
    );
    const material = root.querySelector('.review-seat--top .review-seat__material');
    expect(material).not.toBeNull();
    expect(material?.querySelector('.review-capture-piece')).not.toBeNull();
    expect(material?.outerHTML).toContain('hidden piece');
    expect(material?.outerHTML).not.toMatch(/chariot|俥|車|车/);
    expect(root.querySelector('.review-seat__clock')?.textContent).toBe('1:00');
  });

  it('hides recorded clocks on an alternate line and restores them on the played line', () => {
    const root = host();
    handles.push(
      mountXiangqiReview(root, {
        ...config,
        moves: [],
        initialTree: {
          version: 1,
          root: {
            children: [
              { uci: 'h3e3', children: [] },
              { uci: 'b3e3', children: [] },
            ],
          },
        },
        openingExplorer: false,
      }),
    );
    expect(root.querySelectorAll('.review-seat__clock')).toHaveLength(2);
    key('Home');
    key('ArrowRight');
    key('ArrowDown');
    key('ArrowRight');
    expect(root.querySelectorAll('.review-seat__clock')).toHaveLength(0);
    key('End');
    expect(root.querySelectorAll('.review-seat__clock')).toHaveLength(2);
  });

  it('keeps clocks with the first mover when Flip Jungle binds that seat to blue', () => {
    const root = host();
    handles.push(
      mountJungleFlipReview(root, 't', STANDARD_JUNGLE_FLIP_DEAL, {
        ...config,
        moves: [{ from: 'a1', to: 'a1' }],
        seatColors: { red: 'black', black: 'red' },
        seatInkBindsOnFlip: true,
      }),
    );
    expect(root.querySelector('.review-seat--bottom')?.classList).toContain('review-seat--black');
    expect(root.querySelector('.review-seat--bottom .review-seat__clock')?.textContent).toBe(
      '0:58',
    );
    flip(root);
    expect(root.querySelector('.review-seat--top .review-seat__clock')?.textContent).toBe('0:58');
  });

  it('gives captured red animals to the blue first mover, rather than to the red seat id', () => {
    const root = host();
    handles.push(
      mountJungleFlipReview(root, 't', null, {
        ...config,
        moves: [],
        root: {
          truth: {
            ...createInitialJungleFlipState('t', STANDARD_JUNGLE_FLIP_DEAL),
            firstColor: 'black',
            captures: [{ owner: 'red', role: 'cat' }],
          },
          fen: '',
        },
        seatColors: { red: 'black', black: 'red' },
        seatInkBindsOnFlip: true,
      }),
    );
    expect(root.querySelector('.review-seat--bottom [aria-label="red cat"]')).not.toBeNull();
    expect(root.querySelector('.review-seat--top .review-capture-piece')).toBeNull();
    flip(root);
    expect(root.querySelector('.review-seat--top [aria-label="red cat"]')).not.toBeNull();
  });

  it('does not invent a clock for an untimed review', () => {
    const root = host();
    handles.push(mountJungleReview(root, { ...config, moveClocks: undefined, moves: [] }));
    expect(root.querySelector('.review-seat__clock')).toBeNull();
  });
});
