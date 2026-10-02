import { describe, expect, it, vi } from 'vitest';

// Four months, newest first, one line each: enough that two stay on /changelog
// and two move to pages of their own.
vi.mock('./changelog-data.js', () => {
  const month = (id: string) => ({
    id,
    sections: [
      { heading: 'Playing', entries: [{ parts: [{ kind: 'text', text: `line ${id}` }] }] },
    ],
  });
  const months = ['2026-12', '2026-11', '2026-10', '2026-09'].map(month);
  return { changelogMonths: () => months };
});

const { buildChangelogPage, changelogArchiveMonthIds, changelogMonthFromPath } = await import(
  './changelog-page.js'
);

const monthIds = (page: HTMLElement) =>
  [...page.querySelectorAll('.changelog-month')].map((el) => el.id);
const indexLinks = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLAnchorElement>('.changelog-months-link')].map((a) =>
    a.getAttribute('href'),
  );

describe('/changelog month pages', () => {
  it('shows the latest two months in full and links older months to their own pages', () => {
    const page = buildChangelogPage('en');
    expect(monthIds(page)).toEqual(['2026-12', '2026-11']);
    expect(indexLinks(page)).toEqual([
      '#2026-12',
      '#2026-11',
      '/changelog/2026-10',
      '/changelog/2026-09',
    ]);
    expect(page.querySelector('[aria-current]')).toBeNull();
    expect(changelogArchiveMonthIds()).toEqual(['2026-10', '2026-09']);
  });

  it('shows one month on its own page, linking the latest back to /changelog', () => {
    const page = buildChangelogPage('en', '2026-10');
    expect(monthIds(page)).toEqual(['2026-10']);
    expect(page.textContent).toContain('line 2026-10');
    expect(indexLinks(page)).toEqual([
      '/changelog#2026-12',
      '/changelog#2026-11',
      '#2026-10',
      '/changelog/2026-09',
    ]);
    expect(page.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('#2026-10');
  });

  it('falls back to the latest months for a month the log does not have', () => {
    expect(monthIds(buildChangelogPage('en', '2025-01'))).toEqual(['2026-12', '2026-11']);
  });

  it('reads the month from the path', () => {
    expect(changelogMonthFromPath('/changelog/2026-09')).toBe('2026-09');
    expect(changelogMonthFromPath('/changelog/2026-09/')).toBe('2026-09');
    expect(changelogMonthFromPath('/changelog')).toBeNull();
    expect(changelogMonthFromPath('/changelog/latest')).toBeNull();
  });
});
