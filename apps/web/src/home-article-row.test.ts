import { afterEach, describe, expect, it, vi } from 'vitest';
import { articleGoesLiveAt } from './articles/publish-time.js';
import {
  buildArticlesIndex,
  buildHomeArticleCards,
  HOME_ARTICLE_LEAD_ON_TIE,
  HOME_ARTICLE_ROW_SIZE,
  mountArticleThumbnails,
  renderArticleThumbnail,
} from './articles.js';
import { articles } from './articles-data.js';
import type { Locale } from './i18n/locale.js';

// Publishing an article puts it on the homepage row. The row used to render a
// hand-kept slug list, and articles kept shipping without joining it: the
// world-championship post was missing for a day, and the jieqi-bot-wins post
// went out excused by an opt-out entry its own session wrote. Now the row reads
// every listed editorial article, and this test replays each one's publish
// moment against the production row to prove it shows there: the general row
// for an untagged article, the deep-dives row for one tagged homeRow. An
// engineering post shows in neither: the homepage is for players (2026-10-21).

// What the row can ever show: published editorial articles in the interface's
// own language that are not opted out of the index or marked noindex
// (articles.ts isArticleListedInThisEnv).
const listable = articles.filter(
  (article) =>
    article.status === 'published' &&
    article.kind !== 'rules' &&
    !article.sourceLang &&
    article.showInIndex !== false &&
    article.noindex !== true,
);

const HOUR_MS = 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const isEngineering = (article: (typeof articles)[number]): boolean =>
  article.kind === 'article' && article.topic === 'engineering';

function rowsAt(publishedAt: string) {
  const liveAt = articleGoesLiveAt(publishedAt);
  const now = new Date(liveAt + HOUR_MS);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  vi.stubEnv('DEV', false);
  return {
    liveAt,
    latest: buildHomeArticleCards(HOME_ARTICLE_ROW_SIZE, 'en', { now, row: 'latest' }),
    deepDives: buildHomeArticleCards(HOME_ARTICLE_ROW_SIZE, 'en', { now, row: 'deep-dives' }),
  };
}

describe('the homepage article row', () => {
  it.each<Locale>(['en', 'zh-Hans', 'zh-Hant'])(
    'paints photos as CSS backgrounds in both %s homepage rows, including after mounting',
    (locale) => {
      vi.stubEnv('DEV', false);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-04T20:00:00Z'));
      let photoCount = 0;
      for (const row of ['latest', 'deep-dives'] as const) {
        const cards = buildHomeArticleCards(100, locale, {
          row,
          maxAgeDays: Number.POSITIVE_INFINITY,
        });
        expect(cards).not.toBeNull();
        for (const card of cards!.querySelectorAll<HTMLAnchorElement>('.landing-article-card')) {
          const article = articles.find((entry) => card.pathname.endsWith(`/blog/${entry.slug}`));
          const thumb = article?.thumbnail;
          if (thumb?.kind !== 'image') continue;
          photoCount += 1;
          const image = card.querySelector<HTMLElement>('.articles-index-card-thumb')!;
          expect(image.style.backgroundImage).toContain(thumb.src);
          expect(image.style.backgroundSize).toBe('cover');
          expect(image.style.backgroundPosition).toBe(thumb.position ?? '50% 50%');
          expect(image.getAttribute('role')).toBe(thumb.alt ? 'img' : null);
          expect(image.getAttribute('aria-label')).toBe(thumb.alt || null);
          expect(image.getAttribute('aria-hidden')).toBe(thumb.alt ? null : 'true');
        }
        // Inspect serialized markup too: this is what the prerender writes.
        const serialized = document.createElement('div');
        serialized.innerHTML = cards!.outerHTML;
        expect(serialized.querySelector('img[src*="/article-thumbs/"]')).toBeNull();
        mountArticleThumbnails(cards!);
        expect(cards!.querySelector('img[src*="/article-thumbs/"]')).toBeNull();
      }
      expect(photoCount).toBeGreaterThanOrEqual(5);
    },
  );

  it('keeps blog listing photos as lazy img elements with the original crop', () => {
    const index = buildArticlesIndex();
    const photos = index.querySelectorAll<HTMLImageElement>('img[src*="/article-thumbs/"]');
    expect(photos.length).toBeGreaterThanOrEqual(5);
    for (const image of photos) {
      const thumb = articles.find(
        (article) =>
          article.thumbnail?.kind === 'image' &&
          article.thumbnail.src === image.getAttribute('src'),
      )?.thumbnail;
      expect(thumb?.kind).toBe('image');
      if (thumb?.kind !== 'image') continue;
      expect(image.alt).toBe(thumb.alt ?? '');
      expect(image.loading).toBe('lazy');
      expect(image.style.objectFit).toBe('cover');
      expect(image.style.objectPosition).toBe(thumb.position ?? '');
      expect(image.parentElement!.style.backgroundImage).toBe('');
    }
  });

  it.each(['', undefined])('keeps a background photo with alt %s decorative', (alt) => {
    const thumb = renderArticleThumbnail(
      { kind: 'image', src: '/article-thumbs/test.jpg', alt, position: '25% 35%' },
      'en',
      { imageAsBackground: true },
    );
    expect(thumb.querySelector('img')).toBeNull();
    expect(thumb.style.backgroundPosition).toBe('25% 35%');
    expect(thumb.getAttribute('aria-hidden')).toBe('true');
    expect(thumb.hasAttribute('role')).toBe(false);
    expect(thumb.hasAttribute('aria-label')).toBe(false);
  });

  it.each(
    listable
      .filter((article) => article.publishedAt && isEngineering(article))
      .map((article) => [article.slug, article] as const),
  )('keeps the engineering post %s off both homepage rows', (slug, article) => {
    const { latest, deepDives } = rowsAt(String(article.publishedAt));
    const card = `.landing-article-card[href="/blog/${slug}"]`;
    expect(latest?.querySelector(card) ?? null).toBeNull();
    expect(deepDives?.querySelector(card) ?? null).toBeNull();
  });

  it.each(
    listable
      .filter((article) => article.publishedAt && !isEngineering(article))
      .map((article) => [article.slug, article] as const),
  )('shows %s on the homepage on the day it goes live', (slug, article) => {
    const liveAt = articleGoesLiveAt(String(article.publishedAt));
    expect(Number.isFinite(liveAt), `${slug} has an unreadable publishedAt`).toBe(true);
    const now = new Date(liveAt + HOUR_MS);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    vi.stubEnv('DEV', false);

    const homeRow = article.homeRow ?? 'latest';
    const row = buildHomeArticleCards(HOME_ARTICLE_ROW_SIZE, 'en', { now, row: homeRow });
    const otherRow = buildHomeArticleCards(HOME_ARTICLE_ROW_SIZE, 'en', {
      now,
      row: homeRow === 'latest' ? 'deep-dives' : 'latest',
    });
    const card = `.landing-article-card[href="/blog/${slug}"]`;

    expect(
      row?.querySelector(card),
      `"${slug}" is live but not in its homepage row (${homeRow})`,
    ).not.toBeNull();
    expect(
      otherRow?.querySelector(card) ?? null,
      `"${slug}" shows in both homepage rows`,
    ).toBeNull();
  });

  it('keeps every tie-break entry pointing at a listable article', () => {
    // An entry left behind after its article was renamed or unpublished would
    // silently order nothing, and look like it was still doing work.
    for (const slug of HOME_ARTICLE_LEAD_ON_TIE) {
      expect(
        listable.some((article) => article.slug === slug),
        `HOME_ARTICLE_LEAD_ON_TIE names "${slug}", which is not a listable article`,
      ).toBe(true);
    }
  });
});
