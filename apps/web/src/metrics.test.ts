import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountMetrics } from './metrics.js';

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
  studiesCreated: 0,
  studyChaptersCreated: 0,
  practiceSolves: 0,
  chatLines: 7,
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
  publicHumanGames: 540,
  activePlayers28d: 12,
  previousActivePlayers28d: 9,
  activePatrons: 3,
  humanGamesByResult: { 'red-win': 350, 'black-win': 300, draw: 32 },
  // Includes a retired id (dark-draft960) that the live-shelf filter drops.
  humanGamesByVariant: { xiangqi: 402, 'dark-xiangqi': 180, 'dark-draft960': 60 },
  weekly: [week('2026-07-06'), week('2026-07-13'), week('2026-07-20', { players: 8 })],
  engines: {
    eveGames: 900,
    eveGamesLast7d: 90,
    importedGames: 12,
    manualGames: 1,
    internalGames: 512,
    internalGamesLast7d: 5,
    preLaunchGames: 197,
    countedFrom: '2026-06-01',
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
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.body.className = '';
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
    expect(sectionTitles).toEqual([
      'Games per week',
      'Games over time',
      'Games by variant',
      'Games by mode',
    ]);
    // Games per week is the weekly primitive with one series and a table.
    const weekly = root.querySelector('.metrics-weekly-section');
    expect(weekly?.querySelector('.weekly-chart-legend')).toBeNull();
    const firstRow = weekly?.querySelector('.weekly-chart-table tr:nth-child(2)');
    expect([...(firstRow?.querySelectorAll('td') ?? [])].map((n) => n.textContent)).toEqual([
      '2026-07-20',
      '4',
    ]);

    // Variant labels use the public-facing names (dark-xiangqi -> Fog Xiangqi).
    expect(root.textContent).toContain('Fog Xiangqi');
    expect(root.textContent).not.toContain('dark-xiangqi');
    // Bot-vs-bot (EvE) is hidden from the public page, even though the API
    // returns a non-zero eve count.
    expect(root.textContent).toContain('Player vs player');
    expect(root.textContent).not.toContain('Bot vs bot');
    expect(root.querySelector('svg.stats-chart-svg')).not.toBeNull();

    const chipLabels = [...root.querySelectorAll('.stats-chart-chip')].map((n) => n.textContent);
    expect(chipLabels).toEqual(['All games', 'Xiangqi', 'Fog Xiangqi']);

    const variantSection = [...root.querySelectorAll('.metrics-section')].find((s) =>
      s.querySelector('.metrics-section-heading')?.textContent?.includes('Games by variant'),
    );
    const variantLabels = [
      ...(variantSection?.querySelectorAll('.metrics-breakdown-label') ?? []),
    ].map((n) => n.textContent);
    expect(variantLabels).toEqual(['Xiangqi', 'Fog Xiangqi']);

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

    expect(root.querySelector('.site-section-heading')?.textContent).toBe('Metrics');
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
    expect(accountsCard?.querySelector('.metrics-card-note')?.textContent).toBe('+11 this month');
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
      'Players per week',
      'Active players, rolling 28 days',
      'Games per week',
      'Accounts per week',
      'Puzzles per week',
      'Study and practice per week',
      'Community per week',
      'Games over time',
      'Games by variant',
      'Games by mode',
      'Games by result',
      'Not counted above',
    ]);
    expect(root.textContent).toContain('Red win');

    // Weekly charts: one legend entry per series, the table carries the same
    // numbers newest first, and the current week is drawn as a partial segment.
    const playersSection = root.querySelector('.metrics-weekly-section');
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
    const engines = root.querySelector('.metrics-engines-section');
    expect(engines?.textContent).toContain('Bot vs bot');
    expect(engines?.textContent).toContain('900');
    expect(engines?.textContent).toContain('Imported');
    expect(engines?.textContent).toContain('Internal');
    expect(engines?.textContent).toContain('512');
    expect(engines?.textContent).toContain('Pre-launch');
    expect(engines?.textContent).toContain('197');
    const engineVariants = [...(engines?.querySelectorAll('.metrics-breakdown-label') ?? [])].map(
      (n) => n.textContent,
    );
    expect(engineVariants).toEqual(['Fog Chess', 'Xiangqi']);

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

  it('falls back to a notice when statistics are unavailable', async () => {
    stubFetch({
      '/api/stats/public': () => json({}, 503),
      '/api/live-stats': () => json({}, 503),
      '/api/stats/admin': () => json({}, 503),
    });
    const root = mountRoot();
    await mountMetrics(root, { admin: true });

    expect(root.textContent).toContain('Could not load statistics');
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
