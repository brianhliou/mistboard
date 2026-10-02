import { afterEach, describe, expect, it, vi } from 'vitest';
import { articleGoesLiveAt } from './articles/publish-time.js';
import {
  buildHomeArticleCards,
  HOME_ARTICLE_LEAD_ON_TIE,
  HOME_ARTICLE_ROW_SIZE,
} from './articles.js';
import { articles } from './articles-data.js';

// Publishing an article puts it on the homepage row. The row used to render a
// hand-kept slug list, and articles kept shipping without joining it: the
// world-championship post was missing for a day, and the jieqi-bot-wins post
// went out excused by an opt-out entry its own session wrote. Now the row reads
// every listed editorial article, and this test replays each one's publish
// moment against the production row to prove it shows there: the general row
// for an untagged article, the deep-dives row for one tagged homeRow.

// What the row can ever show: published editorial articles in the interface's
// own language that are not opted out of the index (articles.ts
// isArticleListedInThisEnv).
const listable = articles.filter(
  (article) =>
    article.status === 'published' &&
    article.kind !== 'rules' &&
    !article.sourceLang &&
    article.showInIndex !== false,
);

const HOUR_MS = 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('the homepage article row', () => {
  it.each(
    listable
      .filter((article) => article.publishedAt)
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
