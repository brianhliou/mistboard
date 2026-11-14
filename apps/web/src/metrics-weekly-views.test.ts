import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { mountMetrics } from './metrics.js';

const weeks = ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];
const stats = {
  generatedAt: '2026-11-12T12:00:00Z',
  totalCompletedGames: 16000,
  last30dCompletedGames: 16000,
  publicGames: 16000,
  weeklyCompletedGames: [1000, 2000, 3000, 10000].map((completedGames, i) => ({
    weekStart: weeks[i],
    completedGames,
  })),
  weeklyByVariant: [
    ['jungle', 999999, [50, 200, 200, 9992]],
    ['jieqi', 1000, [100, 300, 600, 2]],
    ['xiangqi', 1200, [300, 400, 500, 2]],
    ['banqi', 350, [50, 100, 200, 2]],
    ['dark-chess', 3000, [500, 1000, 1500, 2]],
  ].map(([variant, total, values]) => ({
    variant,
    total,
    weeks: (values as number[]).map((completedGames, i) => ({
      weekStart: weeks[i],
      completedGames,
    })),
  })),
  weeklyByPlay: weeks.map((weekStart, i) => ({
    weekStart,
    vsBot: [983, 1970, 2957, 9992][i],
    casualLive: [12, 23, 34, 4][i],
    ratedLive: [1, 2, 3, 1][i],
    casualCorrespondence: [3, 4, 5, 2][i],
    ratedCorrespondence: 1,
  })),
  modeTotals: { pvp: 98, pve: 15902, eve: 0 },
  variantTotals: [],
  dailyCompletedGames: [],
};

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/stats');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(payload: unknown = stats): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(url === '/api/stats/public' ? payload : { playing: 0, online: 0 }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
  const root = document.createElement('div');
  document.body.append(root);
  await mountMetrics(root, { admin: false });
  return root;
}

function select(root: HTMLElement, label: string): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>('.stats-weekly-view button')].find(
    (item) => item.textContent === label,
  );
  expect(button, label).toBeDefined();
  button!.click();
  expect(button!.getAttribute('aria-pressed')).toBe('true');
}

function hoverValues(root: HTMLElement, index: number): number[] {
  const svg = root.querySelector<SVGSVGElement>('.weekly-chart-svg')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 720,
    bottom: 260,
    width: 720,
    height: 260,
    toJSON: () => ({}),
  });
  svg.dispatchEvent(new PointerEvent('pointermove', { clientX: 52 + index * 328, clientY: 100 }));
  return [...root.querySelectorAll('.weekly-chart-tooltip-row strong')].map((node) =>
    Number(node.textContent?.replaceAll(',', '')),
  );
}

const legend = (root: HTMLElement) =>
  [...root.querySelectorAll('.weekly-chart-legend li')].map((node) => node.textContent);

describe('public weekly chart views', () => {
  it('opens on the unchanged all-games line and switches back to it', async () => {
    const root = await mount();
    expect(
      [...root.querySelectorAll('.stats-weekly-view button')].map((n) => n.textContent),
    ).toEqual(['All games', 'Versus people']);
    expect(root.querySelector('.stats-weekly-view')?.nextElementSibling?.textContent).toBe(
      'Games per week',
    );
    expect(root.querySelectorAll('.weekly-chart-line')).toHaveLength(1);
    expect(root.querySelector('.weekly-chart-line-partial')).toBeNull();
    expect(root.querySelector('.weekly-chart-legend')).toBeNull();
    const points = root.querySelector('.weekly-chart-line')?.getAttribute('points');
    expect(hoverValues(root, 2)).toEqual([3000]);
    expect(root.querySelector('.stats-weekly-so-far')?.textContent).toBe('10,000 so far this week');
    select(root, 'Versus people');
    select(root, 'All games');
    expect(root.querySelector('.weekly-chart-line')?.getAttribute('points')).toBe(points);
    expect(root.querySelectorAll('.weekly-chart')).toHaveLength(1);
  });

  it('sums live and correspondence play and scales only the people series', async () => {
    const root = await mount();
    select(root, 'Versus people');
    expect(root.querySelectorAll('.weekly-chart-line')).toHaveLength(2);
    expect(legend(root)).toEqual(['Casual', 'Rated']);
    expect(hoverValues(root, 2)).toEqual([39, 4]);
    const ticks = [...root.querySelectorAll('.weekly-chart-y-axis text')].map((n) =>
      Number(n.textContent),
    );
    expect(Math.max(...ticks)).toBe(40);
    expect(root.querySelector('.stats-weekly-so-far')?.textContent).toBe(
      'So far this week: Casual: 6 · Rated: 2',
    );
    expect(root.querySelector('.weekly-chart-table')).toBeNull();
  });

  it('renders and switches without access to browser storage', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('disabled');
    });
    const root = await mount();
    select(root, 'Versus people');
    expect(legend(root)).toEqual(['Casual', 'Rated']);
  });

  it('handles a single current week and a missing play breakdown', async () => {
    const root = await mount({
      ...stats,
      weeklyCompletedGames: stats.weeklyCompletedGames.slice(-1),
      weeklyByPlay: undefined,
    });
    expect(root.querySelector('.stats-weekly-so-far')).toBeNull();
    expect(root.querySelectorAll('.weekly-chart-line')).toHaveLength(1);
    expect(root.querySelector('.weekly-chart-line')?.getAttribute('points')).toContain('14.0');
    select(root, 'Versus people');
    expect(root.querySelectorAll('.weekly-chart-line')).toHaveLength(2);
  });

  it.each([
    ['zh-Hans', '/zh-hans/stats', ['全部对局', '玩家对局'], ['休闲', '排位']],
    ['zh-Hant', '/zh-hant/stats', ['全部對局', '玩家對局'], ['休閒', '積分']],
  ] as const)(
    'translates the selector and people legend in %s',
    async (locale, path, labels, people) => {
      await ensureLocaleCatalog(locale);
      window.history.replaceState(null, '', path);
      const root = await mount();
      expect(
        [...root.querySelectorAll('.stats-weekly-view button')].map((n) => n.textContent),
      ).toEqual(labels);
      select(root, labels[1]);
      expect(legend(root)).toEqual(people);
    },
  );
});
