import { afterEach, describe, expect, it } from 'vitest';
import { articleIsLive } from './articles/publish-time.js';
import { buildArticlesIndex, buildHomeArticleCards, buildRulesIndex } from './articles.js';
import { articles } from './articles-data.js';
import type { Locale } from './i18n/locale.js';

// Every card a reader can see must carry art. A published article with no
// `thumbnail` (and no variant marker) renders its card as a flat colour block on
// the homepage row and the blog index, and nothing else notices: the page itself
// renders fine, so a preview of the article passes. The solver audit shipped that
// way on 2026-10-06 (docs-private/INCIDENTS.md). This walks the same builders the
// site uses, in English and Chinese, and names every card that came out bare,
// including an svg thunk whose output is not an <svg> (renderArticleThumbnail
// then leaves the box empty without an error).

const LOCALES: Array<{ locale: Locale; lang?: 'zh-Hans' }> = [
  { locale: 'en' },
  { locale: 'zh-Hans', lang: 'zh-Hans' },
];

const PUBLISHED = new Set(
  articles
    .filter((article) => articleIsLive(article) && !article.sourceLang)
    .map((article) => article.slug),
);

function slugOf(href: string | null): string {
  return (href ?? '').split('?')[0]!.split('/').filter(Boolean).pop() ?? '';
}

// A thumbnail box has art when it holds an <svg>, an <img>, a chessground board
// host or a variant marker (a masked span), and is not marked empty.
function hasArt(box: Element | null): boolean {
  if (!box || box.classList.contains('is-empty')) return false;
  return (
    box.querySelector(
      'svg, img, .articles-thumb-board, .variant-marker[data-variant-marker-id]',
    ) !== null
  );
}

describe('article card thumbnails', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each(LOCALES)('every published card on the blog index has art ($locale)', ({ lang }) => {
    const bare: string[] = [];
    for (const view of ['mistboard', 'community'] as const) {
      const index = buildArticlesIndex(lang, view);
      for (const card of index.querySelectorAll('.articles-index-card')) {
        const slug = slugOf(card.getAttribute('href'));
        if (!PUBLISHED.has(slug)) continue;
        if (!hasArt(card.querySelector('.articles-index-card-media'))) bare.push(slug);
      }
    }
    expect(bare).toEqual([]);
  });

  it.each(LOCALES)('every published card on the homepage rows has art ($locale)', ({ locale }) => {
    const bare: string[] = [];
    let seen = 0;
    for (const row of ['latest', 'deep-dives'] as const) {
      const cards = buildHomeArticleCards(1000, locale, {
        row,
        maxAgeDays: Number.POSITIVE_INFINITY,
      });
      for (const card of cards?.querySelectorAll(
        '.landing-article-card[data-card-kind="article"]',
      ) ?? []) {
        const slug = slugOf(card.getAttribute('href'));
        if (!PUBLISHED.has(slug)) continue;
        seen += 1;
        if (!hasArt(card.querySelector('.landing-article-card-thumb'))) bare.push(slug);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(bare).toEqual([]);
  });

  it.each(LOCALES)('every rules landing tile has art ($locale)', ({ lang }) => {
    const bare: string[] = [];
    for (const tile of buildRulesIndex(lang).querySelectorAll('.rules-landing-tile')) {
      if (!hasArt(tile.querySelector('.articles-index-card-thumb'))) {
        bare.push(slugOf(tile.getAttribute('href')));
      }
    }
    expect(bare).toEqual([]);
  });
});
