import { describe, expect, it } from 'vitest';
import { articles } from './articles-data.js';

// At most one new article goes live per calendar day (set 2026-10-10). When two
// are ready, the second takes the next free `publishedAt`; a future date goes
// live on its own at 09:00 Pacific (articles/publish-time.ts), so spreading
// them out costs no extra ship. News entries are not limited. Dates before the
// rule are history and are left alone.
const ONE_A_DAY_FROM = '2026-10-10';

describe('article schedule', () => {
  it('puts at most one published article on each day', () => {
    const byDay = new Map<string, string[]>();
    for (const article of articles) {
      if (article.kind !== 'article' || article.status !== 'published') continue;
      const day = article.publishedAt;
      if (!day || day < ONE_A_DAY_FROM) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), article.slug]);
    }
    const crowded = [...byDay].filter(([, slugs]) => slugs.length > 1);
    expect(crowded, 'move all but one to the next free publishedAt').toEqual([]);
  });
});
