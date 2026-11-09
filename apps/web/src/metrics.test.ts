import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { type DeployHistoryEntry, deployRowCells, mountMetrics } from './metrics.js';

const publicStats = {
  generatedAt: '2026-07-21T00:00:00.000Z',
  totalCompletedGames: 682,
  last30dCompletedGames: 191,
  publicGames: 540,
  accounts: 19,
  weeklyCompletedGames: [
    { weekStart: '2026-07-06', completedGames: 20 },
    { weekStart: '2026-07-13', completedGames: 31 },
    { weekStart: '2026-07-20', completedGames: 4 },
  ],
  weeklyByVariant: [
    {
      variant: 'xiangqi',
      total: 402,
      weeks: [
        { weekStart: '2026-07-06', completedGames: 12 },
        { weekStart: '2026-07-13', completedGames: 20 },
        { weekStart: '2026-07-20', completedGames: 3 },
      ],
    },
    {
      variant: 'dark-xiangqi',
      total: 180,
      weeks: [
        { weekStart: '2026-07-06', completedGames: 8 },
        { weekStart: '2026-07-13', completedGames: 11 },
        { weekStart: '2026-07-20', completedGames: 1 },
      ],
    },
    {
      variant: 'mini-xiangqi',
      total: 25,
      weeks: [
        { weekStart: '2026-07-06', completedGames: 0 },
        { weekStart: '2026-07-13', completedGames: 0 },
        { weekStart: '2026-07-20', completedGames: 0 },
      ],
    },
  ],
  modeTotals: { pvp: 300, pve: 382, eve: 12 },
  variantTotals: [
    { variant: 'xiangqi', count: 402 },
    { variant: 'dark-xiangqi', count: 180 },
    // A retired id that must be filtered off the public breakdown + chart.
    { variant: 'mini-xiangqi', count: 25 },
  ],
  dailyCompletedGames: [
    { date: '2026-07-19', completedGames: 3, cumulativeGames: 679 },
    { date: '2026-07-20', completedGames: 3, cumulativeGames: 682 },
  ],
  variantDaily: [
    {
      variant: 'xiangqi',
      total: 402,
      days: [
        { date: '2026-07-19', completedGames: 2, cumulativeGames: 400 },
        { date: '2026-07-20', completedGames: 2, cumulativeGames: 402 },
      ],
    },
    {
      variant: 'dark-xiangqi',
      total: 180,
      days: [
        { date: '2026-07-19', completedGames: 1, cumulativeGames: 179 },
        { date: '2026-07-20', completedGames: 1, cumulativeGames: 180 },
      ],
    },
    {
      variant: 'mini-xiangqi',
      total: 25,
      days: [
        { date: '2026-07-19', completedGames: 0, cumulativeGames: 25 },
        { date: '2026-07-20', completedGames: 0, cumulativeGames: 25 },
      ],
    },
  ],
};

const week = (weekStart: string, overrides: Record<string, number> = {}) => ({
  weekStart,
  humanGames: 10,
  pvpGames: 4,
  pveGames: 6,
  players: 5,
  signedInPlayers: 2,
  newPlayers: 1,
  returningPlayers: 4,
  activePlayers28d: 12,
  guestGames: 3,
  newAccounts: 1,
  puzzleSessions: 3,
  puzzleSolves: 2,
  puzzleAttempts: 1,
  puzzlePlayers: 2,
  returningPuzzlePlayers: 1,
  studiesCreated: 0,
  studyChaptersCreated: 0,
  practiceSolves: 0,
  chatLines: 7,
  gameChatLines: 2,
  dmMessages: 1,
  correspondenceSeeks: 0,
  newPatrons: 0,
  eveGames: 30,
  internalGames: 4,
  ...overrides,
});

const adminMetrics = {
  generatedAt: '2026-07-21T00:00:00.000Z',
  weekCount: 3,
  accounts: 42,
  accountsLast7d: 4,
  accountsLast30d: 11,
  humanGames: 682,
  humanGamesLast7d: 30,
  gamePace: { thisWeekSoFar: 30, lastWeekSamePoint: 20, lastWeekTotal: 70 },
  publicHumanGames: 540,
  activePlayers28d: 12,
  previousActivePlayers28d: 9,
  activePatrons: 3,
  humanGamesByResult: { 'red-win': 350, 'black-win': 300, draw: 32 },
  // Includes a deleted id (dark-draft960) that the live-shelf filter drops.
  humanGamesByVariant: { xiangqi: 402, 'dark-xiangqi': 180, 'dark-draft960': 60 },
  weekly: [week('2026-07-06'), week('2026-07-13'), week('2026-07-20', { players: 8 })],
  loginEmailDelivery: {
    last7d: {
      requested: 21,
      sent: 20,
      delivered: 19,
      bounced: 3,
      suppressed: 2,
      complained: 1,
      completed: 12,
    },
    last30d: {
      requested: 90,
      sent: 87,
      delivered: 85,
      bounced: 5,
      suppressed: 4,
      complained: 2,
      completed: 70,
    },
  },
  retentionCohorts: [
    {
      weekStart: '2026-06-15',
      segment: 'all',
      players: 8,
      returns: [
        { week: 1, returned: 2, percentage: 25 },
        { week: 2, returned: 0, percentage: 0 },
        { week: 3, returned: 1, percentage: 12.5 },
        { week: 4, returned: 1, percentage: 12.5 },
      ],
    },
    {
      weekStart: '2026-07-13',
      segment: 'all',
      players: 3,
      returns: [1, 2, 3, 4].map((week) => ({ week, returned: null, percentage: null })),
    },
  ],
  engines: {
    eveGames: 900,
    eveGamesLast7d: 90,
    importedGames: 12,
    manualGames: 1,
    internalGames: 512,
    internalGamesLast7d: 5,
    preLaunchGames: 197,
    shortGames: 25,
    countedFrom: '2026-06-01',
    minCountedPlies: 2,
    eveByVariant: { 'dark-chess': 600, xiangqi: 300 },
  },
};

function stubFetch(overrides: Record<string, () => Response> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (overrides[url]) return overrides[url]();
      if (url === '/api/stats/public') return json(publicStats);
      if (url === '/api/live-stats') return json({ playing: 2, online: 5 });
      if (url === '/api/stats/admin') return json(adminMetrics);
      return json({}, 404);
    }),
  );
}

describe('metrics page', () => {
  it('renders login delivery counts for both windows only with admin data', async () => {
    window.history.replaceState(null, '', '/metrics?tab=operations');
    stubFetch();
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    const section = root.querySelector('.metrics-login-email');
    expect(section?.querySelector('h2')?.textContent).toBe('Login email delivery');
    expect([...section!.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      'Status',
      'Last 7 days',
      'Last 30 days',
    ]);
    expect(
      [...section!.querySelectorAll('tbody tr')].map((row) =>
        [...row.querySelectorAll('th, td')].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['Requested', '21', '90'],
      ['Sent', '20', '87'],
      ['Delivered', '19', '85'],
      ['Bounced', '3', '5'],
      ['Suppressed', '2', '4'],
      ['Complained', '1', '2'],
      ['Completed code sign-ins', '12', '70'],
    ]);
    expect(section?.textContent).toContain('Each activity is counted at its own timestamp');
    expect(section?.textContent).toContain('provider message');
    await mountMetrics(root, { admin: false });
    expect(root.querySelector('.metrics-login-email')).toBeNull();
    stubFetch({ '/api/stats/admin': () => json({}, 401) });
    await mountMetrics(root, { admin: true });
    expect(root.querySelector('.metrics-login-email')).toBeNull();
  });

  it('renders empty login delivery windows as zeroes', async () => {
    const zero = {
      requested: 0,
      sent: 0,
      delivered: 0,
      bounced: 0,
      suppressed: 0,
      complained: 0,
      completed: 0,
    };
    stubFetch({
      '/api/stats/admin': () =>
        json({ ...adminMetrics, loginEmailDelivery: { last7d: zero, last30d: zero } }),
    });
    window.history.replaceState(null, '', '/metrics?tab=operations');
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    const values = [...root.querySelectorAll('.metrics-login-email tbody td')].map(
      (cell) => cell.textContent,
    );
    expect(values).toEqual(Array(14).fill('0'));
  });

  it.each([
    [
      'zh-Hans',
      '/zh-hans/metrics?tab=operations',
      '登录邮件投递',
      ['状态', '最近7天', '最近30天'],
      ['已请求', '已发送', '已送达', '已退信', '已抑制', '已投诉', '已完成验证码登录'],
    ],
    [
      'zh-Hant',
      '/zh-hant/metrics?tab=operations',
      '登入郵件投遞',
      ['狀態', '最近7天', '最近30天'],
      ['已請求', '已傳送', '已送達', '已退信', '已抑制', '已投訴', '已完成驗證碼登入'],
    ],
  ] as const)(
    'translates the login delivery block in %s',
    async (locale, path, heading, columns, labels) => {
      await ensureLocaleCatalog(locale);
      window.history.replaceState(null, '', path);
      stubFetch();
      const root = mountRoot();
      await mountMetrics(root, { admin: true });
      const section = root.querySelector('.metrics-login-email');
      expect(section?.querySelector('h2')?.textContent).toBe(heading);
      expect([...section!.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(
        columns,
      );
      expect([...section!.querySelectorAll('tbody th')].map((cell) => cell.textContent)).toEqual(
        labels,
      );
      expect(section?.textContent).not.toContain('Each activity');
      expect(section?.textContent).not.toContain('—');
    },
  );

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/metrics');
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.body.className = '';
    window.history.replaceState(null, '', '/metrics');
  });

  it.each([
    ['en', '/stats', 'Updated just now', 'Updated 1 min ago', 'Updated 4 min ago'],
    ['zh-Hans', '/zh-hans/stats', '刚刚更新', '1 分钟前更新', '4 分钟前更新'],
    ['zh-Hant', '/zh-hant/stats', '剛剛更新', '1 分鐘前更新', '4 分鐘前更新'],
  ] as const)(
    'keeps the payload age current in %s while /stats stays open',
    async (locale, path, justNow, minuteAgo, minutesAgo) => {
      await ensureLocaleCatalog(locale);
      window.history.replaceState(null, '', path);
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse(publicStats.generatedAt) + 59_999);
      stubFetch();
      const root = mountRoot();
      await mountMetrics(root, { admin: false });
      const label = root.querySelector<HTMLTimeElement>('.stats-updated')!;
      expect(label.textContent).toBe(justNow);
      expect(label.dateTime).toBe(publicStats.generatedAt);
      expect(label.previousElementSibling?.className).toBe('metrics-cards');
      await vi.advanceTimersByTimeAsync(1);
      expect(label.textContent).toBe(minuteAgo);
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(label.textContent).toBe(minutesAgo);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      root.remove();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    [30, 20, '+50.0%'],
    [10, 20, '-50.0%'],
    [20, 20, '+0.0%'],
    [0, 0, '0%'],
    [10, 0, 'no games at this point last week'],
  ])(
    'renders admin-only Pacific pace for %i games versus %i',
    async (thisWeekSoFar, lastWeekSamePoint, change) => {
      window.history.replaceState(null, '', '/metrics');
      stubFetch({
        '/api/stats/admin': () =>
          json({
            ...adminMetrics,
            gamePace: { thisWeekSoFar, lastWeekSamePoint, lastWeekTotal: 70 },
          }),
      });
      const root = mountRoot();
      await mountMetrics(root, { admin: true });
      expect(root.querySelector('.metrics-game-pace')?.textContent).toBe(
        `This week so far: ${thisWeekSoFar}, last week at the same point: ${lastWeekSamePoint} (${change}), last week total: 70. Pacific weeks.`,
      );
      await mountMetrics(root, { admin: false });
      expect(root.querySelector('.metrics-game-pace')).toBeNull();
      stubFetch({ '/api/stats/admin': () => json({}, 403) });
      await mountMetrics(root, { admin: true });
      expect(root.querySelector('.metrics-game-pace')).toBeNull();
    },
  );

  it('explains return visits with fixed next-week and fourth-week columns', async () => {
    window.history.replaceState(null, '', '/metrics?tab=retention');
    stubFetch();
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    const section = root.querySelector('.metrics-retention')!;
    expect(section.textContent).toContain('Retention means coming back to play');
    expect(section.textContent).toContain('2 came back the next week (25.0%)');
    expect([...section.querySelectorAll('thead th')].map((node) => node.textContent)).toEqual([
      'First played',
      'New players',
      'Next week',
      '4 weeks later',
    ]);
    const rows = [...section.querySelectorAll('tbody tr')];
    expect(rows[0].textContent).toContain('Not ready');
    expect(rows[1].textContent).toContain('25.0%2 of 8');
    expect(rows[1].textContent).toContain('12.5%1 of 8');
    expect(section.textContent).toContain('Monday to Sunday UTC');
    expect(section.textContent).toContain('any variant');
    expect(root.querySelector('.admin-reporting-nav [aria-current="page"]')?.textContent).toBe(
      'Returning players',
    );
    await mountMetrics(root, { admin: false });
    expect(root.querySelector('.metrics-retention')).toBeNull();
    expect(root.querySelector('.admin-reporting-nav')).toBeNull();
  });

  it('requires admin access instead of silently displaying public statistics', async () => {
    for (const status of [401, 403, 500]) {
      stubFetch({ '/api/stats/admin': () => json({}, status) });
      const root = mountRoot();
      await mountMetrics(root, { admin: true });
      expect(root.textContent).toContain(
        status === 500 ? 'Metrics unavailable' : 'Admin access required',
      );
      expect(root.querySelector('.metrics-cards')).toBeNull();
      expect(root.querySelector('.admin-reporting-nav')).toBeNull();
    }
  });

  it('defaults to the last complete UTC week and keeps rolling counts labelled', async () => {
    stubFetch({
      '/api/stats/admin': () =>
        json({
          ...adminMetrics,
          weekly: [
            week('2026-07-06', { humanGames: 10, players: 5, returningPlayers: 2, newAccounts: 0 }),
            week('2026-07-13', { humanGames: 25, players: 7, returningPlayers: 4, newAccounts: 3 }),
            week('2026-07-20', { humanGames: 2 }),
          ],
        }),
    });
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    expect(root.querySelector<HTMLSelectElement>('[aria-label="Review week"]')?.value).toBe(
      '2026-07-13',
    );
    const summary = root.querySelector('.metrics-week-summary');
    expect(summary?.textContent).toContain('+15 (+150%) vs 10');
    expect(summary?.textContent).toContain('+2 (+100%) vs 2');
    expect(summary?.textContent).toContain('+3 (new) vs 0');
    expect(root.textContent).toContain('+30 in the last 7 days');
    expect(root.textContent).not.toContain('+30 this week');
  });

  it('selects historical weeks and refuses to compare a partial week or a missing baseline', async () => {
    window.history.replaceState(null, '', '/metrics?week=2026-07-20');
    stubFetch();
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    const picker = root.querySelector<HTMLSelectElement>('[aria-label="Review week"]')!;
    expect(root.querySelector('.metrics-week-summary')?.textContent).toContain('Week in progress');
    expect(root.querySelector('.metrics-week-summary')?.textContent).toContain(
      'Comparison unavailable',
    );
    picker.value = '2026-07-06';
    picker.dispatchEvent(new Event('change'));
    expect(window.location.search).toBe('?week=2026-07-06');
    expect(root.querySelector('.metrics-week-summary')?.textContent).toContain(
      'previous week unavailable',
    );
    expect(root.querySelector('.metrics-week-summary')?.textContent).toContain(
      'Comparison unavailable',
    );
  });

  it('explains a historical link outside the available metrics window', async () => {
    window.history.replaceState(null, '', '/metrics?week=2025-01-06');
    stubFetch();
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    expect(root.querySelector('.metrics-week-review')?.textContent).toContain(
      'outside the available history',
    );
    expect(root.querySelector<HTMLSelectElement>('[aria-label="Review week"]')?.value).toBe(
      '2026-07-13',
    );
  });

  it('bounds retention to 12 rows and two return periods, with separate first-variant groups', async () => {
    window.history.replaceState(null, '', '/metrics?tab=retention');
    const cohorts = Array.from({ length: 20 }, (_, index) => ({
      weekStart: new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10),
      segment: 'all',
      players: 10,
      returns: Array.from({ length: 25 }, (_, offset) => ({
        week: offset + 1,
        returned: 2,
        percentage: 20,
      })),
    }));
    stubFetch({
      '/api/stats/admin': () =>
        json({
          ...adminMetrics,
          retentionCohorts: [
            ...cohorts,
            {
              ...cohorts[0],
              segment: 'jieqi',
              players: 8,
              returns: [{ week: 1, returned: 1, percentage: 12.5 }],
            },
          ],
        }),
    });
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    expect(root.querySelectorAll('.metrics-return-table tbody tr')).toHaveLength(12);
    expect(root.querySelectorAll('.metrics-return-table thead th')).toHaveLength(4);
    const picker = root.querySelector<HTMLSelectElement>('[aria-label="First game variant"]')!;
    picker.value = 'jieqi';
    picker.dispatchEvent(new Event('change'));
    expect(root.querySelectorAll('.metrics-return-table tbody tr')).toHaveLength(1);
    expect(root.querySelector('.metrics-return-table')?.textContent).toContain('12.5%1 of 8');
    expect(root.querySelector('.metrics-return-table')?.textContent).toContain('Unavailable');
  });

  it('explains an empty retention window', async () => {
    window.history.replaceState(null, '', '/metrics?tab=retention');
    stubFetch({ '/api/stats/admin': () => json({ ...adminMetrics, retentionCohorts: [] }) });
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    expect(root.querySelector('.metrics-retention')?.textContent).toContain(
      'No first-game players in this window.',
    );
  });

  it('public /stats is a translated rail page: games per week, totals, variants, modes', async () => {
    stubFetch();
    const root = mountRoot();
    await mountMetrics(root, { admin: false });

    expect(root.querySelector('.site-section-heading')?.textContent).toBe('Statistics');
    // One of the /about family: the static rail with this page active.
    expect(root.querySelector('.static-page-rail-link.active')?.textContent).toBe('Statistics');
    const cardLabels = [...root.querySelectorAll('.metrics-card-label')].map((n) => n.textContent);
    expect(cardLabels).toEqual(['Games played', 'Registered players', 'In play now']);
    const gamesCard = [...root.querySelectorAll('.metrics-card')].find(
      (c) => c.querySelector('.metrics-card-label')?.textContent === 'Games played',
    );
    expect(gamesCard?.querySelector('.metrics-card-value')?.textContent).toBe('682');
    expect(gamesCard?.querySelector('.metrics-card-note')?.textContent).toBe(
      '+191 in the last 30 days',
    );
    // Nothing admin-only leaks: no accounts growth, no online count, no results.
    expect(cardLabels).not.toContain('Online now');
    expect(cardLabels).not.toContain('Patrons');

    const sectionTitles = [...root.querySelectorAll('.metrics-section-heading')].map(
      (n) => n.textContent,
    );
    // One chart: the cumulative "Games over time" was the same read, always rising.
    expect(sectionTitles).toEqual(['Games per week', 'Games by variant', 'Games by mode']);
    // Games per week is the weekly primitive with one series and no table
    // (the admin /metrics charts keep theirs), plotting full weeks only: the
    // in-progress week (07-20) is the line of text under the chart, not a
    // dashed dive at the end of the line.
    const weekly = root.querySelector('.metrics-weekly-section');
    expect(weekly?.querySelector('.weekly-chart-legend')).toBeNull();
    expect(weekly?.querySelector('.weekly-chart-line-partial')).toBeNull();
    expect(weekly?.querySelector('.weekly-chart-table')).toBeNull();
    const allGamesLine = weekly?.querySelector('.weekly-chart-line')?.getAttribute('points');
    expect(allGamesLine).toBeTruthy();
    expect(weekly?.querySelector('.stats-weekly-so-far')?.textContent).toBe('4 so far this week');
    expect(root.querySelector('svg.stats-chart-svg')).toBeNull();

    // Variant labels use the public-facing names (dark-xiangqi -> Fog Xiangqi).
    expect(root.textContent).toContain('Fog Xiangqi');
    expect(root.textContent).not.toContain('dark-xiangqi');
    // Bot-vs-bot (EvE) is hidden from the public page, even though the API
    // returns a non-zero eve count.
    expect(root.textContent).toContain('Player vs player');
    expect(root.textContent).not.toContain('Bot vs bot');

    // One line, all games: no variant chips (the breakdown below carries the split).
    expect(weekly?.querySelector('.stats-chart-filter')).toBeNull();
    expect(root.querySelector('.stats-chart-chip')).toBeNull();

    const variantSection = [...root.querySelectorAll('.metrics-section')].find((s) =>
      s.querySelector('.metrics-section-heading')?.textContent?.includes('Games by variant'),
    );
    const variantLabels = [
      ...(variantSection?.querySelectorAll('.metrics-breakdown-label') ?? []),
    ].map((n) => n.textContent);
    expect(variantLabels).toEqual(['Xiangqi', 'Fog Xiangqi']);
    // The server leaves retired variants' games out of every public number,
    // so the breakdown carries no "retired games count toward the total" note.
    expect(variantSection?.querySelector('p')).toBeNull();
    expect(variantSection?.textContent).not.toContain('retired');

    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/stats/admin', expect.anything());
  });

  it('public /stats renders in Traditional Chinese', async () => {
    window.history.replaceState(null, '', '/zh-hant/stats');
    stubFetch();
    const root = mountRoot();
    await mountMetrics(root, { admin: false });
    expect(root.querySelector('.site-section-heading')?.textContent).toBe('統計');
    const cardLabels = [...root.querySelectorAll('.metrics-card-label')].map((n) => n.textContent);
    expect(cardLabels).toEqual(['已完成對局', '註冊玩家', '正在進行']);
    expect(root.textContent).toContain('每週對局數');
    expect(root.textContent).toContain('玩家對玩家');
    window.history.replaceState(null, '', '/stats');
  });

  it('admin /metrics adds player cards, weekly charts, the result split, and an engines block', async () => {
    stubFetch();
    const root = mountRoot();
    await mountMetrics(root, { admin: true });

    expect(root.querySelector('.site-section-heading')?.textContent).toBe('Games and players');
    const cardLabels = [...root.querySelectorAll('.metrics-card-label')].map((n) => n.textContent);
    expect(cardLabels).toContain('Active players');
    expect(cardLabels).toContain('Accounts');
    expect(cardLabels).toContain('Patrons');
    expect(cardLabels).toContain('Online now');

    const activeCard = [...root.querySelectorAll('.metrics-card')].find((c) =>
      c.querySelector('.metrics-card-label')?.textContent?.includes('Active players'),
    );
    expect(activeCard?.querySelector('.metrics-card-value')?.textContent).toBe('12');
    expect(activeCard?.querySelector('.metrics-card-note')?.textContent).toBe(
      'played in the last 28 days, +3 vs the 28 before',
    );
    const accountsCard = [...root.querySelectorAll('.metrics-card')].find((c) =>
      c.querySelector('.metrics-card-label')?.textContent?.includes('Accounts'),
    );
    expect(accountsCard?.querySelector('.metrics-card-value')?.textContent).toBe('42');
    expect(accountsCard?.querySelector('.metrics-card-note')?.textContent).toBe(
      '+11 in the last 30 days',
    );
    // The headline games card is the human total from the admin endpoint, not
    // the all-modes count.
    const gamesCard = [...root.querySelectorAll('.metrics-card')].find((c) =>
      c.querySelector('.metrics-card-label')?.textContent?.includes('Games played'),
    );
    expect(gamesCard?.querySelector('.metrics-card-value')?.textContent).toBe('682');

    const sectionTitles = [...root.querySelectorAll('.metrics-section-heading')].map(
      (n) => n.textContent,
    );
    expect(sectionTitles).toEqual([
      'Games per week',
      'Players per week',
      'Active players, rolling 28 days',
      'Lifetime totals and live status',
      'Games by variant',
      'Games by mode',
      'Games by result',
    ]);
    expect(root.querySelector('.metrics-details')).toBeNull();
    expect(root.textContent).toContain('Red win');

    // Weekly charts: one legend entry per series, the table carries the same
    // numbers newest first, and the current week is drawn as a partial segment.
    const playersSection = [...root.querySelectorAll('.metrics-weekly-section')].find(
      (section) => section.querySelector('h2')?.textContent === 'Players per week',
    );
    const legend = [...(playersSection?.querySelectorAll('.weekly-chart-legend li') ?? [])].map(
      (n) => n.textContent,
    );
    expect(legend).toEqual(['Players', 'Signed in', 'New', 'Returning']);
    const firstRow = playersSection?.querySelector('.weekly-chart-table tr:nth-child(2)');
    expect([...(firstRow?.querySelectorAll('td') ?? [])].map((n) => n.textContent)).toEqual([
      '2026-07-20',
      '8',
      '2',
      '1',
      '4',
    ]);
    expect(playersSection?.querySelector('.weekly-chart-line-partial')).not.toBeNull();

    // "Games by mode" is human only on admin too: bot-vs-bot lives in the
    // Engines block and nowhere else on the page.
    const modeSection = [...root.querySelectorAll('.metrics-section')].find((s) =>
      s.querySelector('.metrics-section-heading')?.textContent?.includes('Games by mode'),
    );
    expect(modeSection?.textContent).not.toContain('Bot vs bot');
    // The "Games by variant" breakdown honors the live shelf on admin too, so a
    // retired id in humanGamesByVariant is dropped.
    const variantSection = [...root.querySelectorAll('.metrics-section')].find((s) =>
      s.querySelector('.metrics-section-heading')?.textContent?.includes('Games by variant'),
    );
    const variantLabels = [
      ...(variantSection?.querySelectorAll('.metrics-breakdown-label') ?? []),
    ].map((n) => n.textContent);
    expect(variantLabels).toEqual(['Xiangqi', 'Fog Xiangqi']);
    expect(variantLabels).not.toContain('Dark Draft960');
  });

  it('puts activity and operations in explicit admin destinations instead of folds', async () => {
    window.history.replaceState(null, '', '/metrics?tab=activity');
    stubFetch();
    const root = mountRoot();
    await mountMetrics(root, { admin: true });
    expect(root.querySelector('.metrics-week-review')).toBeNull();
    expect(root.querySelector('.metrics-engines-section')).toBeNull();
    // Puzzles: people beside the puzzles-started line, which says what it counts.
    const legendOf = (title: string) =>
      [
        ...([...root.querySelectorAll('.metrics-weekly-section')]
          .find((s) => s.querySelector('.metrics-section-heading')?.textContent === title)
          ?.querySelectorAll('.weekly-chart-legend li') ?? []),
      ].map((n) => n.textContent);
    expect(legendOf('Puzzle players per week')).toEqual(['Puzzle players', 'Returning']);
    expect(legendOf('Puzzles per week')).toEqual([
      'Puzzles started',
      'Solves',
      'Signed-in attempts',
    ]);

    window.history.replaceState(null, '', '/metrics?tab=operations');
    await mountMetrics(root, { admin: true });
    expect(root.querySelector('.metrics-week-review')).toBeNull();
    const engines = root.querySelector('.metrics-engines-section');
    expect(engines?.textContent).toContain('Bot vs bot');
    expect(engines?.textContent).toContain('900');
    expect(engines?.textContent).toContain('Imported');
    expect(engines?.textContent).toContain('Internal');
    expect(engines?.textContent).toContain('512');
    expect(engines?.textContent).toContain('Pre-launch');
    expect(engines?.textContent).toContain('197');
    expect(engines?.textContent).toContain('Short');
    expect(engines?.textContent).toContain('25');
    expect(engines?.textContent).toContain('fewer than 2 plies');
    const engineVariants = [...(engines?.querySelectorAll('.metrics-breakdown-label') ?? [])].map(
      (n) => n.textContent,
    );
    expect(engineVariants).toEqual(['Fog Chess', 'Xiangqi']);

    expect(root.querySelector('.admin-reporting-nav [aria-current="page"]')?.textContent).toBe(
      'System',
    );
  });

  it('falls back to a notice when statistics are unavailable', async () => {
    stubFetch({
      '/api/stats/public': () => json({}, 503),
      '/api/live-stats': () => json({}, 503),
      '/api/stats/admin': () => json({}, 503),
    });
    const root = mountRoot();
    await mountMetrics(root, { admin: true });

    expect(root.textContent).toContain('Could not load admin metrics');
    expect(root.querySelector('.metrics-card')).toBeNull();
  });
});

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('deploy history rows', () => {
  const base: DeployHistoryEntry = {
    at: '2026-09-25T20:00:00Z',
    kind: 'restart',
    buildRevision: 'abc',
    drain: null,
    withoutDrain: false,
    activeGamesAtShutdown: 0,
    pausedOnShutdown: 0,
    resumedPlayersBack: 0,
    resumedAfterGrace: 0,
  };

  it('reads a drained restart from its summary', () => {
    const cells = deployRowCells({
      ...base,
      drain: {
        durationMs: 14 * 60_000,
        committed: true,
        commitWaitMs: 9 * 60_000,
        activeGamesAtStart: 1,
        peakActiveGames: 2,
        refusedCreates: 3,
      },
      pausedOnShutdown: 2,
      resumedPlayersBack: 1,
      resumedAfterGrace: 1,
    });
    expect(cells.slice(1)).toEqual(['Restart', '14m', '1 (peak 2)', '3', '0', '1 / 1 of 2']);
  });

  it('says when a restart went down with no drain', () => {
    const cells = deployRowCells({ ...base, withoutDrain: true, activeGamesAtShutdown: 1 });
    expect(cells.slice(1, 3)).toEqual(['Restart', 'none (undrained)']);
    expect(cells[5]).toBe('1');
  });

  it('calls an undrained restart with nothing live the intended path, not a failure', () => {
    const cells = deployRowCells({ ...base, withoutDrain: true, activeGamesAtShutdown: 0 });
    expect(cells.slice(1, 3)).toEqual(['Restart', 'not needed (0 live)']);
  });
});
