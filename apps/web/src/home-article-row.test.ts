import { describe, expect, it } from 'vitest';
import { HOME_ARTICLE_SLUGS } from './articles.js';
import { articles } from './articles-data.js';

// The homepage row is CURATED, not date-driven: it renders the slugs listed in
// HOME_ARTICLE_SLUGS and nothing else. That is deliberate, and it has one bad
// failure mode. Publishing an article does not put it on the homepage, and
// nothing says so: the world-championship article shipped in three locales,
// entered the sitemap, the feed and the News box, and was absent from the row
// for a day because nobody edited a second list.
//
// So absence has to be a recorded decision rather than an oversight. An
// editorial article newer than the newest thing on the homepage either joins
// the row or gets a line here saying why it did not.
const KEPT_OFF: Array<{ slug: string; why: string }> = [];

const editorial = articles.filter(
  (article) => article.status === 'published' && article.kind !== 'rules',
);

describe('the homepage article row', () => {
  it('lists only published editorial articles', () => {
    const stale = HOME_ARTICLE_SLUGS.filter(
      (slug) => !editorial.some((article) => article.slug === slug),
    );
    expect(stale, `slugs that are no longer published editorial articles`).toEqual([]);
  });

  it('carries the newest published article, or records why not', () => {
    const newest = [...editorial].sort((a, b) =>
      String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')),
    )[0];
    expect(newest, 'no published editorial article at all').toBeTruthy();
    const listed = HOME_ARTICLE_SLUGS.includes(newest.slug as (typeof HOME_ARTICLE_SLUGS)[number]);
    const excused = KEPT_OFF.some((entry) => entry.slug === newest.slug);
    expect(
      listed || excused,
      `"${newest.slug}" (${newest.publishedAt}) is the newest published article but is not on the homepage. Add it to HOME_ARTICLE_SLUGS, or add it to KEPT_OFF in this test with a reason.`,
    ).toBe(true);
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
