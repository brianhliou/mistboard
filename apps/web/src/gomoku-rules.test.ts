import {
  applyGomokuRoomMove,
  GOMOKU_OPENING_SCREEN,
  GOMOKU_OPENINGS,
  getGomokuPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { articleIsIndexable, canonicalArticleBase } from '../../server/src/article-meta.js';
import { hasTranslation, translateArticle } from './article-i18n.js';
import { articleProse } from './article-prose.js';
import { blogPosts } from './articles/blog-listing.js';
import {
  buildArticlePage,
  buildArticlesIndex,
  buildHomeArticleCards,
  buildRulesIndex,
} from './articles.js';
import { articles, findArticle } from './articles-data.js';
import {
  GOMOKU_OPENING_BLACK,
  GOMOKU_OPENING_WHITE,
  GOMOKU_RULES_EXAMPLES,
  GOMOKU_WINNING_BOARDS,
} from './gomoku-rules-diagrams.js';
import { articleIsNoindex, rulesHrefForGameSpec } from './variant-public-surfaces.js';

afterEach(() => vi.unstubAllEnvs());

describe('hidden Gomoku rules page', () => {
  it('registers a directly readable rules page in all three languages', () => {
    vi.stubEnv('DEV', false);
    expect(findArticle('gomoku')).toMatchObject({ kind: 'rules', status: 'published' });
    expect(canonicalArticleBase('gomoku')).toBe('rules');
    for (const locale of [undefined, 'zh-Hans', 'zh-Hant'] as const) {
      const page = buildArticlePage('gomoku', locale);
      expect(page.dataset.articleSlug).toBe('gomoku');
      expect(page.querySelector('h1')?.textContent).toBe(
        locale === undefined ? 'Gomoku Rules' : locale === 'zh-Hans' ? '五子棋规则' : '五子棋規則',
      );
      expect(page.querySelectorAll('svg[role="img"]')).toHaveLength(8);
      expect(page.querySelector('a[href*="gameSpecId=gomoku"]')).toBeNull();
    }
  });

  it('stays out of public listings, rails and the sitemap even in dev', () => {
    const article = findArticle('gomoku');
    expect(article).toBeDefined();
    if (!article) return;
    expect(articleIsNoindex(article)).toBe(true);
    expect(articleIsIndexable('gomoku')).toBe(false);
    expect(rulesHrefForGameSpec('gomoku')).toBeNull();
    for (const dev of [false, true]) {
      vi.stubEnv('DEV', dev);
      for (const locale of [undefined, 'zh-Hans', 'zh-Hant'] as const) {
        const surfaces = [
          buildRulesIndex(locale),
          buildArticlesIndex(locale),
          buildArticlesIndex(locale, 'community'),
          buildArticlePage('xiangqi', locale),
          buildArticlePage('gomoku', locale),
          buildHomeArticleCards(100, locale, { maxAgeDays: Number.POSITIVE_INFINITY }),
          buildHomeArticleCards(100, locale, {
            maxAgeDays: Number.POSITIVE_INFINITY,
            row: 'deep-dives',
          }),
        ];
        for (const surface of surfaces) {
          expect(surface?.querySelector('a[href$="/rules/gomoku"]') ?? null).toBeNull();
        }
      }
    }
    expect(blogPosts(articles, Date.now()).map((a) => a.slug)).not.toContain('gomoku');
  });

  it('translates every prose string and caption into both Chinese scripts', () => {
    const article = findArticle('gomoku');
    expect(article).toBeDefined();
    if (!article) return;
    for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
      for (const { text, path } of articleProse(article)) {
        expect(hasTranslation(locale, text), `${locale}: ${path}: ${text}`).toBe(true);
      }
      const translated = translateArticle(article, locale);
      expect(translated.title).toContain('五子棋');
    }
  });
});
describe('Gomoku rules diagrams match the kernel and screened pool', () => {
  it('pins the documented 50 openings and the two illustrated sides to move', () => {
    expect(GOMOKU_OPENINGS).toHaveLength(50);
    expect(GOMOKU_OPENING_SCREEN).toMatchObject({
      nodes: 1_000_000,
      minWinrate: 0.45,
      maxWinrate: 0.55,
    });
    for (const opening of GOMOKU_OPENINGS) {
      expect(opening.screening.forcedWin).toBe(false);
      expect(opening.screening.winrate).toBeGreaterThanOrEqual(0.45);
      expect(opening.screening.winrate).toBeLessThanOrEqual(0.55);
    }
    expect(GOMOKU_OPENINGS[0]).toMatchObject({ id: 'gmk-001', turn: 'white' });
    expect(GOMOKU_OPENINGS[0].stones).toEqual([
      { square: 'h8', color: 'black' },
      { square: 'i9', color: 'white' },
      { square: 'f6', color: 'black' },
    ]);
    expect(GOMOKU_OPENINGS[1]).toMatchObject({ id: 'gmk-002', turn: 'black' });
    expect(GOMOKU_OPENINGS[1].stones).toEqual([
      ...GOMOKU_OPENINGS[0].stones,
      { square: 'i10', color: 'white' },
    ]);
  });

  it.each(GOMOKU_RULES_EXAMPLES.map((example, index) => ({ ...example, index })))(
    'example $index wins by the captioned placement $to',
    ({ before, to, index }) => {
      expect(before.status).toEqual({ type: 'playing', turn: 'black' });
      const view = getGomokuPlayerView(before, 'black');
      expect(view.legalMoves).toContainEqual({ to });
      expect(view.winningLine).toEqual([]);
      const after = applyGomokuRoomMove(before, { to });
      expect(after.status).toEqual({ type: 'finished', winner: 'black', reason: 'five' });
      expect(getGomokuPlayerView(after, 'black').winningLine).toHaveLength(index === 4 ? 6 : 5);
    },
  );

  it('renders accessible static boards with their own paint and no hit targets', () => {
    for (const render of [GOMOKU_OPENING_WHITE, GOMOKU_OPENING_BLACK, ...GOMOKU_WINNING_BOARDS]) {
      const root = document.createElement('div');
      root.innerHTML = render();
      expect(root.querySelector('svg[role="img"] title')?.textContent).toBe('Gomoku board');
      expect(root.querySelector('[role="button"], [tabindex], .gomoku-hit')).toBeNull();
      expect(root.querySelector('.gomoku-wood')?.getAttribute('fill')).toBe('#dcb975');
      expect(root.querySelector('.gomoku-stone--black')?.getAttribute('fill')).toBe('#222');
      expect(root.querySelector('.gomoku-stone--white')?.getAttribute('fill')).toBe('#faf7ee');
    }
  });
});
