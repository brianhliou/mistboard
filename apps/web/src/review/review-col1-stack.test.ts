// The phone stack (col1) of the review scaffold: board, arrows, a short move
// strip, then the underboard (mobile audit 2026-10, board-nav-split). The
// scaffold tags each piece with data-col1-area and review-shell.css orders the
// rows; these tests pin both halves so neither drifts from the other.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COL1_AREAS,
  COL1_STACK_CLASS,
  createReviewScaffold,
  type ReviewScaffoldConfig,
} from './review-layout.js';

// Whitespace collapsed: Biome wraps long selectors over several lines.
const css = readFileSync('src/review/review-shell.css', 'utf8').replace(/\s+/g, ' ');
const FULL = '.review-shell:not(.review-shell--embedded) .review-shell__cluster--col1-stack';
const EMBEDDED = '.review-shell--embedded .review-shell__cluster--col1-stack';

function el(className: string): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function mount(overrides: Partial<ReviewScaffoldConfig> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const parts = {
    board: el('test-board'),
    moves: el('test-moves'),
    navigation: el('review-controls'),
    underboard: el('test-underboard'),
    analysisSummary: el('test-summary'),
  };
  createReviewScaffold(root, {
    reviewSurface: 'game',
    ariaLabel: 'Game review',
    title: 'Test game',
    summary: '',
    boards: [{ key: 'truth', tier: 'primary', el: parts.board }],
    boardAspect: 10 / 9,
    moves: parts.moves,
    navigation: parts.navigation,
    underboard: parts.underboard,
    analysisSummary: parts.analysisSummary,
    ...overrides,
  });
  return { root, parts };
}

/** The `order` review-shell.css gives a col1 area inside the phone media query. */
function orderOf(area: string): number {
  const media = css.slice(css.indexOf(`@media (max-width: 799px) { ${FULL}`));
  const selector =
    area === 'side'
      ? `${FULL} .review-shell__left > .review-rail-group {`
      : area === 'aside'
        ? `${FULL} .review-shell__left > .review-rail-group--deferred {`
        : `${FULL} [data-col1-area="${area}"] {`;
  const at = media.indexOf(selector);
  expect(at, `no col1 rule for ${area}`).toBeGreaterThan(-1);
  const match = /order:\s*(-?\d+)/.exec(media.slice(at, at + 200));
  expect(match, `no order for ${area}`).not.toBeNull();
  return Number(match?.[1]);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('review scaffold col1 stack', () => {
  it('opts the cluster in and tags board, arrows, moves and underboard', () => {
    const { root, parts } = mount();
    expect(root.querySelector('.review-shell__cluster')?.classList.contains(COL1_STACK_CLASS)).toBe(
      true,
    );
    expect(root.querySelector('.review-stage')?.getAttribute('data-col1-area')).toBe('board');
    expect(parts.navigation.dataset.col1Area).toBe('nav');
    expect(parts.underboard.dataset.col1Area).toBe('under');
    expect(parts.analysisSummary.dataset.col1Area).toBe('summary');
    const moves = root.querySelector('[data-col1-area="moves"]');
    expect(moves?.contains(parts.moves)).toBe(true);
  });

  it('leaves a study fused nav inside the moves box, untagged', () => {
    const { parts } = mount({ reviewSurface: 'study' });
    expect(parts.navigation.dataset.col1Area).toBeUndefined();
    expect(parts.navigation.closest('[data-col1-area="moves"]')).not.toBeNull();
  });

  it('orders the rows board, arrows, moves, then the rest', () => {
    const orders = COL1_AREAS.map(orderOf);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('keeps the move strip short and dissolves the center and right columns', () => {
    for (const scope of [FULL, EMBEDDED]) {
      expect(css).toContain(
        `${scope} .review-rail-main .review-move-list__rows { max-height: 140px; }`,
      );
      const at = css.indexOf(`${scope} :is(`);
      expect(at, scope).toBeGreaterThan(-1);
      const rule = css.slice(at, css.indexOf('}', at));
      expect(rule).toContain('.review-shell__center');
      expect(rule).toContain('.review-shell__right');
      expect(rule).toContain('display: contents');
    }
  });
});
