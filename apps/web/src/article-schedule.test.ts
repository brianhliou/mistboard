import { describe, expect, it } from 'vitest';
import { articles } from './articles-data.js';

// At most one new article goes live per calendar day (set 2026-10-10), and from
// 2026-10-17 only on a Tuesday or a Friday (Brian, 2026-10-11: two reviews a
// week, not seven; the four already dated 10-12 to 10-16 keep their days). When an article is ready, date it into the next free slot;
// a future date goes live on its own at 09:00 Pacific (articles/publish-time.ts),
// so spreading them out costs no extra ship. News entries are not limited.
// Dates before each rule are history and are left alone.
const ONE_A_DAY_FROM = '2026-10-10';
const TUESDAY_FRIDAY_FROM = '2026-10-17';

function publishedDays(from: string): [slug: string, day: string][] {
  return articles
    .filter((a) => a.kind === 'article' && a.status === 'published')
    .map((a): [string, string] => [a.slug, a.publishedAt ?? ''])
    .filter(([, day]) => day >= from);
}

function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

describe('article schedule', () => {
  it('puts at most one published article on each day', () => {
    const byDay = new Map<string, string[]>();
    for (const [slug, day] of publishedDays(ONE_A_DAY_FROM)) {
      byDay.set(day, [...(byDay.get(day) ?? []), slug]);
    }
    const crowded = [...byDay].filter(([, slugs]) => slugs.length > 1);
    expect(crowded, 'move all but one to the next free Tuesday or Friday').toEqual([]);
  });

  it('publishes only on a Tuesday or a Friday', () => {
    const offDay = publishedDays(TUESDAY_FRIDAY_FROM).filter(
      ([, day]) => weekday(day) !== 2 && weekday(day) !== 5,
    );
    expect(offDay, 'date it the next free Tuesday or Friday').toEqual([]);
  });

  it('reads weekdays from the calendar date, not the local clock', () => {
    expect(weekday('2026-10-13')).toBe(2);
    expect(weekday('2026-10-16')).toBe(5);
    expect(weekday('2026-10-11')).toBe(0);
  });
});
