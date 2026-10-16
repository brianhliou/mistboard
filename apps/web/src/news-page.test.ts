import { describe, expect, it } from 'vitest';
import { announcementSlug, announcements } from './announcements.js';
import {
  buildNewsPage,
  NEWS_MONTHS_ON_INDEX,
  newsArchiveHrefForHash,
  newsMonthFromPath,
  newsMonthIds,
} from './news-page.js';

const monthsNewestFirst = () =>
  [...new Set(announcements().map((entry) => entry.date.slice(0, 7)))].sort().reverse();

describe('/feed month archive', () => {
  it('shows only the latest months on /feed and links every month in the row', () => {
    const months = monthsNewestFirst();
    expect(months.length).toBeGreaterThan(NEWS_MONTHS_ON_INDEX);
    expect(newsMonthIds()).toEqual(months);

    const page = buildNewsPage('en');
    const shown = [...page.querySelectorAll('.news-page-month')].map((month) => month.id);
    expect(shown).toEqual(months.slice(0, NEWS_MONTHS_ON_INDEX));

    const row = [...page.querySelectorAll<HTMLAnchorElement>('.news-page-months-link')];
    expect(row.map((link) => link.getAttribute('href'))).toEqual(
      months.map((id, index) => (index < NEWS_MONTHS_ON_INDEX ? `#${id}` : `/feed/${id}`)),
    );
    expect(row[0]?.textContent).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    expect(page.querySelector('[aria-current]')).toBeNull();

    // Every shown entry sits under its own month.
    for (const month of page.querySelectorAll('.news-page-month')) {
      for (const time of month.querySelectorAll('time')) {
        expect(time.dateTime.startsWith(month.id)).toBe(true);
      }
    }
  });

  it('gives an older month a page of its own with every entry from that month', () => {
    const oldest = monthsNewestFirst().at(-1)!;
    const page = buildNewsPage('en', oldest);
    expect([...page.querySelectorAll('.news-page-month')].map((m) => m.id)).toEqual([oldest]);
    expect(page.querySelectorAll('.news-page-entry')).toHaveLength(
      announcements().filter((entry) => entry.date.startsWith(oldest)).length,
    );
    expect(page.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe(`#${oldest}`);
  });

  it('shows the latest months for a month with no entries', () => {
    const page = buildNewsPage('en', '1999-01');
    expect(page.querySelectorAll('.news-page-month')).toHaveLength(NEWS_MONTHS_ON_INDEX);
  });

  it('sends an old /feed#entry link to its month page and leaves recent ones alone', () => {
    const months = monthsNewestFirst();
    const old = announcements().find((entry) => entry.date.startsWith(months.at(-1)!))!;
    const recent = announcements().find((entry) => entry.date.startsWith(months[0]!))!;
    expect(newsArchiveHrefForHash(announcementSlug(old))).toBe(
      `/feed/${months.at(-1)}#${announcementSlug(old)}`,
    );
    expect(newsArchiveHrefForHash(announcementSlug(recent))).toBeNull();
    expect(newsArchiveHrefForHash('no-such-entry')).toBeNull();
  });

  it('reads the month from the path', () => {
    expect(newsMonthFromPath('/feed/2026-09')).toBe('2026-09');
    expect(newsMonthFromPath('/feed')).toBeNull();
    expect(newsMonthFromPath('/feed/2026-9')).toBeNull();
  });
});
