import {
  applyGomokuRoomMove,
  GOMOKU_BOARD_SIZE,
  GOMOKU_OPENINGS,
  getGomokuPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import openingPool from '../../../packages/game/src/gomoku-openings.json' with { type: 'json' };
import { articleIsIndexable, canonicalArticleBase } from '../../server/src/article-meta.js';
import { isArticleTranslationPublished } from './article-i18n.js';
import { articleProse } from './article-prose.js';
import { blogPosts } from './articles/blog-listing.js';
import { createGomokuArticle, GOMOKU_OPENINGS_STUDY_URL } from './articles/content/gomoku.js';
import {
  buildArticlePage,
  buildArticlesIndex,
  buildHomeArticleCards,
  buildRulesArticleRailEntries,
  buildRulesIndex,
} from './articles.js';
import { articles, findArticle } from './articles-data.js';
import {
  GOMOKU_OPENING,
  GOMOKU_PLACEMENT,
  GOMOKU_RULES_EXAMPLES,
  GOMOKU_WINNING_BOARD,
} from './gomoku-rules-diagrams.js';
import {
  articleIsNoindex,
  rulesHrefForGameSpec,
  variantPlaytestSurfaceEnabled,
  variantPublicSurfaceEnabled,
} from './variant-public-surfaces.js';

afterEach(() => vi.unstubAllEnvs());

describe('hidden Gomoku rules page', () => {
  it('ends with computer and friend CTAs', () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
    const page = buildArticlePage('gomoku');
    const row = [...page.querySelectorAll('.article-cta-row')].at(-1)!;
    const buttons = [...row.querySelectorAll('a.article-cta')];
    expect(buttons.map((button) => [button.textContent, button.getAttribute('href')])).toEqual([
      ['Play vs computer', '/?play=computer&gameSpecId=gomoku'],
      ['Challenge a friend', '/?play=friend&gameSpecId=gomoku'],
    ]);
    expect(buttons[0].classList.contains('article-cta-primary')).toBe(true);
    expect(buttons[1].classList.contains('article-cta-secondary')).toBe(true);
    const article = findArticle('gomoku')!;
    expect(article.sections.at(-1)?.blocks?.at(-1)?.kind).toBe('cta');
  });

  it('uses three single boards with the same crop and responsive width', () => {
    const page = buildArticlePage('gomoku');
    const boards = [...page.querySelectorAll<SVGElement>('figure > svg.gomoku-svg')];
    expect(boards).toHaveLength(3);
    expect(page.querySelector('.article-figure-row')).toBeNull();
    expect(new Set(boards.map((board) => board.getAttribute('viewBox')))).toEqual(
      new Set(['0 0 512 512']),
    );
    expect(
      new Set(boards.map((board) => board.getAttribute('style')?.match(/width:([^;]+)/)?.[1])),
    ).toEqual(new Set(['min(100%, 384px)']));
    expect(new Set(boards.map((board) => board.getAttribute('width')))).toEqual(new Set(['384']));
    const boardSection = findArticle('gomoku')!.sections.find(
      (section) => section.heading === 'Stones stay on the intersections where you place them',
    );
    expect(boardSection?.blocks?.some((block) => block.kind === 'raw-svg')).toBe(true);
    for (const stone of boards.at(-1)!.querySelectorAll('.gomoku-stone')) {
      expect(stone.getAttribute('data-piece-square')).not.toMatch(/^[a-o]1$/);
    }
  });

  it('keeps the hidden rewrite directly readable in English during review', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    expect(findArticle('gomoku')).toMatchObject({ kind: 'rules', status: 'published' });
    expect(canonicalArticleBase('gomoku')).toBe('rules');
    for (const locale of [undefined, 'zh-Hans', 'zh-Hant'] as const) {
      const page = buildArticlePage('gomoku', locale);
      expect(page.dataset.articleSlug).toBe('gomoku');
      expect(page.querySelector('h1')?.textContent).toBe('Gomoku Rules');
      expect(page.querySelectorAll('svg[role="img"]')).toHaveLength(3);
      expect(page.querySelector('a[href*="gameSpecId=gomoku"]')).toBeNull();
    }
  });

  it('stays out of public listings, rails and the sitemap even in dev', () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    const article = findArticle('gomoku');
    expect(article).toBeDefined();
    if (!article) return;
    expect(articleIsNoindex(article)).toBe(true);
    expect(articleIsIndexable('gomoku')).toBe(false);
    expect(rulesHrefForGameSpec('gomoku')).toBeNull();
    expect(variantPlaytestSurfaceEnabled('gomoku')).toBe(false);
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

  it.each([undefined, 'zh-Hans', 'zh-Hant'] as const)(
    'lists Gomoku with its own marker in the opted-in rules rail and tiles (%s)',
    (locale) => {
      vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
      vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'false');
      expect(variantPlaytestSurfaceEnabled('gomoku')).toBe(true);
      expect(variantPlaytestSurfaceEnabled('three-kingdoms-banqi')).toBe(false);
      expect(variantPublicSurfaceEnabled('gomoku')).toBe(false);
      expect(articleIsIndexable('gomoku')).toBe(false);
      expect(rulesHrefForGameSpec('gomoku')).toBeNull();
      const prefix = locale ? `/${locale.toLowerCase()}` : '';
      const href = '/rules/gomoku';
      const landing = buildRulesIndex(locale);
      const tile = landing.querySelector(`.rules-landing-tile[href="${href}"]`);
      expect(tile).not.toBeNull();
      expect(tile?.querySelector('.rules-landing-tile-label')?.textContent).toBe('Gomoku');
      for (const surface of [
        landing,
        buildArticlePage('xiangqi', locale),
        buildArticlePage('gomoku', locale),
      ]) {
        const link = surface.querySelector(`.article-variant-sidebar a[href="${href}"]`);
        expect(link).not.toBeNull();
        expect(link?.querySelector('[data-variant-marker-id="gomoku"]')).not.toBeNull();
        expect(link?.querySelector('.variant-marker-placeholder')).toBeNull();
      }
      expect(tile?.querySelector('[data-variant-marker-id="gomoku"]')).not.toBeNull();
      expect(tile?.querySelector('svg, img, .articles-thumb-board')).toBeNull();
      const railHrefs = [...landing.querySelectorAll('.article-variant-sidebar a')].map((a) =>
        a.getAttribute('href'),
      );
      const tileHrefs = [...landing.querySelectorAll('.rules-landing-tile')].map((a) =>
        a.getAttribute('href'),
      );
      expect(tileHrefs).toEqual(railHrefs);
      expect(railHrefs[railHrefs.indexOf(`${prefix}/rules/xiangqi-mahjong-32`) + 1]).toBe(href);
    },
  );

  it('places the hidden Gomoku rules after Xiangqi Mahjong, ahead of unlisted games', () => {
    const rules = articles.filter((article) => article.kind === 'rules' && !article.sourceLang);
    const slugs = buildRulesArticleRailEntries(rules).map((article) => article.slug);
    expect(slugs[slugs.indexOf('xiangqi-mahjong-32') + 1]).toBe('gomoku');
  });

  it('holds localized publication until the English rewrite is approved', () => {
    expect(isArticleTranslationPublished('gomoku')).toBe(false);
  });
});
describe('Gomoku rules diagrams match the kernel and screened pool', () => {
  it('keeps opening figures and Chess960 out of the reader text', () => {
    const article = findArticle('gomoku')!;
    const prose = articleProse(article)
      .map(({ text }) => text)
      .join('\n');
    expect(prose).not.toMatch(/Chess960/i);
    const percentage = (value: number) => `${Number((value * 100).toFixed(2))}%`;
    const forbiddenFigures = new Set([
      String(openingPool.openings.length),
      ...[
        openingPool.screening.nodes,
        openingPool.screening.prefilterNodes,
        ...openingPool.openings.map((opening) => opening.screening.nodes),
      ].flatMap((nodes) => [String(nodes), nodes.toLocaleString('en-US')]),
      ...[
        openingPool.screening.minWinrate,
        openingPool.screening.maxWinrate,
        ...openingPool.openings.map((opening) => opening.screening.winrate),
      ].flatMap((winrate) => [String(winrate), percentage(winrate)]),
    ]);
    for (const figure of forbiddenFigures) {
      const escaped = figure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(prose).not.toMatch(new RegExp(`(?<![0-9.])${escaped}(?![0-9.])`));
    }
    expect(prose).toContain(`${GOMOKU_BOARD_SIZE}×${GOMOKU_BOARD_SIZE}`);
    const openingSection = article.sections.find(
      (section) => section.heading === 'Mistboard deals a screened opening',
    )!;
    const openingText = articleProse({ ...article, sections: [openingSection] })
      .filter(({ path }) => path.startsWith('sections'))
      .map(({ text }) => text)
      .join('\n');
    expect(openingText.replace('Swap2', '')).not.toMatch(/\d/);
    expect(openingText).not.toMatch(/\b(?:one|two|three|four|five) (?:black|white) stones?\b/i);
    for (const opening of openingPool.openings) expect(prose).not.toContain(opening.id);
  });

  it('teaches placement, winning, draws and clocks before the dealt opening', () => {
    const article = findArticle('gomoku')!;
    const headings = article.sections.map((section) => section.heading);
    expect(headings.slice(0, 4)).toEqual([
      'Stones stay on the intersections where you place them',
      'Five in a row wins',
      'Players can agree to a draw',
      'Your clock runs during your turn',
    ]);
    expect(headings[4]).toBe('Mistboard deals a screened opening');
    const intro = article.intro
      ?.map((block) => (block.kind === 'paragraph' ? block.text : ''))
      .join(' ');
    expect(intro).toMatch(/two players, Black and White/i);
    expect(intro).toContain('15×15');
    expect(intro).toContain('take turns placing one stone');
    expect(intro).toContain('Stones never move');
    expect(intro).toContain('completes five in a row wins');
    const page = buildArticlePage('gomoku');
    const historyLink = page.querySelector<HTMLAnchorElement>(
      'a[href="#black-wins-a-perfect-game-from-the-empty-board"]',
    );
    expect(historyLink).not.toBeNull();
    expect(page.querySelector(historyLink!.hash)?.textContent).toBe(
      'Black wins a perfect game from the empty board',
    );
    const wordCount = articleProse(article)
      .filter(({ path }) => path !== 'summary')
      .map(({ text }) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'))
      .join(' ')
      .match(/\S+/g)!.length;
    expect(wordCount).toBeGreaterThanOrEqual(550);
    expect(wordCount).toBeLessThanOrEqual(650);
  });

  it('keeps the screening FAQ and draw-offer instructions without obsolete setup questions', () => {
    const article = findArticle('gomoku')!;
    const faqs = article.sections.flatMap((section) =>
      (section.blocks ?? []).flatMap((block) => (block.kind === 'faq' ? block.items : [])),
    );
    expect(faqs.length).toBeGreaterThanOrEqual(1);
    expect(faqs.length).toBeLessThanOrEqual(3);
    expect(faqs.map((item) => item.question)).toContain('Does screening guarantee a draw?');
    expect(faqs.map((item) => item.question)).not.toContain('Can I start from an empty board?');
    expect(faqs.map((item) => item.question)).not.toContain(
      'Why is White moving first in my game?',
    );
    expect(
      articleProse(article)
        .map(({ text }) => text)
        .join(' '),
    ).toContain('press ½ (Offer draw) and confirm; your opponent can accept or decline');
  });

  it.each([null, '/study/gomoku-openings'])(
    'renders the openings study sentence only with a URL (%s)',
    (url) => {
      expect(GOMOKU_OPENINGS_STUDY_URL).toBeNull();
      const article = findArticle('gomoku')!;
      const originalSections = article.sections;
      try {
        article.sections = createGomokuArticle(url).sections;
        const page = buildArticlePage('gomoku');
        const links = [...page.querySelectorAll('a')].filter(
          (link) => link.textContent === 'every opening',
        );
        expect(links).toHaveLength(url ? 1 : 0);
        if (url) {
          expect(links[0].getAttribute('href')).toBe(url);
          expect(links[0].closest('p')?.textContent).toBe('You can study every opening.');
        } else {
          expect(page.textContent).not.toContain('You can study every opening');
          expect(page.querySelector('a[href*="/study/"]')).toBeNull();
        }
      } finally {
        article.sections = originalSections;
      }
    },
  );

  it('renders the dealt opening from the screened pool', () => {
    expect(GOMOKU_OPENINGS).toEqual(openingPool.openings);
    const root = document.createElement('div');
    root.innerHTML = GOMOKU_OPENING();
    expect(
      [...root.querySelectorAll('.gomoku-stone')]
        .map((stone) => ({
          square: stone.getAttribute('data-piece-square'),
          color: stone.classList.contains('gomoku-stone--black') ? 'black' : 'white',
        }))
        .sort((a, b) => a.square!.localeCompare(b.square!)),
    ).toEqual([...GOMOKU_OPENINGS[0].stones].sort((a, b) => a.square.localeCompare(b.square)));
  });

  it.each(GOMOKU_RULES_EXAMPLES.map((example, index) => ({ ...example, index })))(
    'example $index wins by the captioned placement $to',
    ({ before, to }) => {
      expect(before.status).toEqual({ type: 'playing', turn: 'black' });
      const view = getGomokuPlayerView(before, 'black');
      expect(view.legalMoves).toContainEqual({ to });
      expect(view.winningLine).toEqual([]);
      const after = applyGomokuRoomMove(before, { to });
      expect(after.status).toEqual({ type: 'finished', winner: 'black', reason: 'five' });
      expect(getGomokuPlayerView(after, 'black').winningLine).toHaveLength(5);
    },
  );

  it('renders accessible static boards with their own paint and no hit targets', () => {
    for (const render of [GOMOKU_OPENING, GOMOKU_PLACEMENT, GOMOKU_WINNING_BOARD]) {
      const root = document.createElement('div');
      root.innerHTML = render();
      expect(root.querySelector('svg[role="img"] title')?.textContent).toBe('Gomoku board');
      expect(root.querySelector('[role="button"], [tabindex], .gomoku-hit')).toBeNull();
      expect(root.querySelector('.gomoku-wood')?.getAttribute('fill')).toBe('#dcb975');
      expect(root.querySelector('.gomoku-stone--black')?.getAttribute('fill')).toBe('#222');
      for (const whiteStone of root.querySelectorAll('.gomoku-stone--white')) {
        expect(whiteStone.getAttribute('fill')).toBe('#faf7ee');
      }
    }
  });
});
