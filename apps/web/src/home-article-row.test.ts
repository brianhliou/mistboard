import { describe, expect, it } from 'vitest';
import { HOME_ARTICLE_ROW_SIZE, HOME_ARTICLE_SLUGS } from './articles.js';
import { articles } from './articles-data.js';

// The homepage row is CURATED, not date-driven: it renders the slugs listed in
// HOME_ARTICLE_SLUGS and nothing else. That is deliberate, and it has one bad
// failure mode. Publishing an article does not put it on the homepage, and
// nothing says so: the world-championship article shipped in three locales,
// entered the sitemap, the feed and the News box, and was absent from the row
// for a day because nobody edited a second list.
//
// So absence has to be a recorded decision rather than an oversight. Each of
// the newest articles that would fill the row (HOME_ARTICLE_ROW_SIZE cards)
// either joins it or gets a line here saying why it did not. Checking only the
// single newest missed an article published a day before another one.
const KEPT_OFF: Array<{ slug: string; why: string }> = [
  {
    slug: 'ab-jchess',
    why: 'announces the new top jieqi bot; the News box carries it and the row stays the fixed eight',
  },
  {
    slug: 'jieqi-bot-wins',
    why: 'announces the jieqi ladder through the bot record; the News box carries it and the row stays the fixed eight',
  },
  {
    slug: 'one-thousand-games',
    why: 'a site milestone, not something to read to play better; the News box carries it',
  },
];

const editorial = articles.filter(
  (article) => article.status === 'published' && article.kind !== 'rules',
);

// What the row could ever show: pages written in a language the interface does
// not speak, and pages opted out of the index, never list (articles.ts
// isArticleListedInThisEnv), so they are not candidates for it either.
const listable = editorial.filter(
  (article) => !article.sourceLang && article.showInIndex !== false,
);

describe('the homepage article row', () => {
  it('lists only published editorial articles', () => {
    const stale = HOME_ARTICLE_SLUGS.filter(
      (slug) => !editorial.some((article) => article.slug === slug),
    );
    expect(stale, `slugs that are no longer published editorial articles`).toEqual([]);
  });

  it('carries the newest published articles, or records why not', () => {
    const newest = [...listable]
      .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
      .filter((article) => !KEPT_OFF.some((entry) => entry.slug === article.slug))
      .slice(0, HOME_ARTICLE_ROW_SIZE);
    expect(newest.length, 'no published editorial article at all').toBeGreaterThan(0);
    const missing = newest.filter(
      (article) => !(HOME_ARTICLE_SLUGS as readonly string[]).includes(article.slug),
    );
    expect(
      missing.map((article) => article.slug),
      missing
        .map(
          (article) =>
            `"${article.slug}" (${article.publishedAt}) is one of the ${HOME_ARTICLE_ROW_SIZE} newest articles but is not on the homepage: add it to HOME_ARTICLE_SLUGS in apps/web/src/articles.ts, or to KEPT_OFF in home-article-row.test.ts with a reason.`,
        )
        .join('\n'),
    ).toEqual([]);
  });

  it('keeps every excuse pointing at a real article', () => {
    // An entry left behind after its article was renamed or unpublished would
    // silently excuse nothing, and look like it was still doing work.
    for (const entry of KEPT_OFF) {
      expect(
        articles.some((article) => article.slug === entry.slug),
        `KEPT_OFF names "${entry.slug}", which is not an article`,
      ).toBe(true);
      expect(
        entry.why.trim().length,
        `KEPT_OFF entry "${entry.slug}" has no reason`,
      ).toBeGreaterThan(10);
    }
  });
});
