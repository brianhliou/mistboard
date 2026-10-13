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

  // Half-board cards go through xqHalfBoardThumbnailSvg, which stamps any piece
  // that would sit under the date pill or the featured star (2026-10-10: corner
  // pieces on the longest-mate and solver-audit cards were half covered).
  it('no half-board card puts a piece under a corner overlay', () => {
    const clashes: string[] = [];
    let halfBoards = 0;
    for (const article of articles) {
      const thumb = article.thumbnail;
      if (thumb?.kind !== 'svg') continue;
      const svg = typeof thumb.svg === 'function' ? thumb.svg('en') : thumb.svg;
      if (!svg.includes('xq-half-thumb')) continue;
      halfBoards += 1;
      const clash = /data-tag-clash="([^"]*)"/.exec(svg);
      if (clash) clashes.push(`${article.slug}: ${clash[1]}`);
    }
    expect(halfBoards).toBeGreaterThanOrEqual(5);
    // A bottom-half crop puts its near bank against the top edge, so a piece
    // there sits under the pill whatever the margins. The Pikafish card's g6
    // loses an 8x11px corner at a 260px card and is clear from about 300px
    // (measured 2026-10-10). A new entry here is a new crop to rethink.
    expect(clashes).toEqual(['pikafish-reveal-bug: g6']);
  });

  // A card that crops a xiangqi board by hand (its own viewBox window onto
  // xqBoardSvg) skips the half-board rules above. The known ones are other
  // shapes on purpose: Atomic zooms on one explosion, and Horde's full rank of
  // soldiers on the near bank needs more headroom than the shared crop gives.
  it('crops half a xiangqi board only through the shared helper', () => {
    const handCropped: string[] = [];
    for (const article of articles) {
      const thumb = article.thumbnail;
      if (thumb?.kind !== 'svg') continue;
      const svg = typeof thumb.svg === 'function' ? thumb.svg('en') : thumb.svg;
      if (!svg.includes('xq-diagram-line') && !svg.includes('xq-live-line')) continue;
      if (svg.includes('xq-half-thumb')) continue;
      const [x, y] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0').split(/\s+/).map(Number);
      if (x !== 0 || y !== 0) handCropped.push(article.slug);
    }
    expect(handCropped.sort()).toEqual(['atomic-xiangqi', 'atomic-xiangqi-build', 'horde-xiangqi']);
  });
});
