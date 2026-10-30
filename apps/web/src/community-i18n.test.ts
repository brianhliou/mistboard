import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import * as localeModule from './i18n/locale.js';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe.each([
  {
    locale: 'en',
    search: 'Search or start new conversation',
    ranges: ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'],
  },
  {
    locale: 'zh-Hans',
    search: '搜索或发起新对话',
    ranges: ['1个月', '3个月', '6个月', '今年', '1年', '全部'],
  },
  {
    locale: 'zh-Hant',
    search: '搜尋或開始新對話',
    ranges: ['1個月', '3個月', '6個月', '今年', '1年', '全部'],
  },
] as const)('$locale community controls', (copy) => {
  async function setLocale(): Promise<void> {
    await ensureLocaleCatalog(copy.locale);
    vi.spyOn(localeModule, 'currentLocale').mockReturnValue(copy.locale);
  }

  it('localizes the inbox search placeholder and accessible name without changing search', async () => {
    await setLocale();
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/auth/me')
        return json({ user: { handle: 'reader', accountRole: 'player' } });
      if (url === '/api/players/online') return json({ players: [] });
      if (url === '/api/inbox')
        return json({
          threads: [
            {
              other: { handle: 'ana', displayName: 'Ana' },
              lastText: 'Community text',
              lastFromMe: false,
              lastAt: '2026-10-26T00:00:00Z',
              unread: false,
            },
          ],
        });
      return json({});
    });
    const { mountInbox } = await import('./inbox.js');
    const root = document.createElement('div');
    await mountInbox(root, null);
    const search = root.querySelector<HTMLInputElement>('.inbox-search-input')!;
    expect(search.placeholder).toBe(copy.search);
    expect(search.getAttribute('aria-label')).toBe(copy.search);
    expect(root.textContent).toContain('Community text');
    search.value = 'new_player';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('.inbox-thread')).toHaveLength(1);
    expect(root.querySelector<HTMLAnchorElement>('.inbox-thread-new')?.getAttribute('href')).toBe(
      '/inbox/new_player',
    );
  });

  it('translates chart range labels while retaining identifiers and filtering history', async () => {
    await setLocale();
    const recent = new Date().toISOString();
    const older = new Date();
    older.setFullYear(older.getFullYear() - 2);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/rating-history'))
        return json({
          history: {
            variant: 'fog',
            timeClass: 'blitz',
            points: [
              { endedAt: older.toISOString(), ratingBefore: 1500, ratingAfter: 1510 },
              { endedAt: recent, ratingBefore: 1510, ratingAfter: 1520 },
            ],
          },
        });
      if (url.includes('/profile?'))
        return json({
          profile: {
            isViewer: false,
            relation: null,
            user: {
              handle: 'reader',
              displayName: 'Reader',
              profileVisibility: 'public',
              accountRole: 'player',
              createdAt: '2026-01-01T00:00:00Z',
            },
            ratings: [
              {
                variant: 'fog',
                timeClass: 'blitz',
                eloRating: 1520,
                ratedGamesPlayed: 2,
                totalGamesPlayed: 2,
                provisional: false,
              },
            ],
            games: [],
            gamesTotal: 0,
          },
        });
      if (url.includes('/presence')) return json({ online: false });
      return json({});
    });
    const { mountProfile } = await import('./profile.js');
    const root = document.createElement('div');
    await mountProfile(root, 'reader');
    const section = root.querySelector<HTMLElement>('.profile-rating-spotlight')!;
    await vi.waitFor(() =>
      expect(section.querySelector('.profile-rating-chart-line')).not.toBeNull(),
    );
    const ranges = [...section.querySelectorAll<HTMLButtonElement>('.profile-chart-range')];
    expect(ranges.map((button) => button.textContent)).toEqual(copy.ranges);
    expect(ranges.map((button) => button.dataset.range)).toEqual([
      '1M',
      '3M',
      '6M',
      'YTD',
      '1Y',
      'ALL',
    ]);
    const allPath = section.querySelector('.profile-rating-chart-line')?.getAttribute('points');
    for (const button of ranges) {
      button.click();
      expect(section.dataset.chartRange).toBe(button.dataset.range);
      expect(ranges.filter((range) => range.getAttribute('aria-pressed') === 'true')).toEqual([
        button,
      ]);
      if (button.dataset.range === '1M')
        expect(
          section.querySelector('.profile-rating-chart-line')?.getAttribute('points'),
        ).not.toBe(allPath);
    }
    expect(section.querySelector('.profile-rating-chart-line')?.getAttribute('points')).toBe(
      allPath,
    );
  });
});
