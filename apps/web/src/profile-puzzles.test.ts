import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppI18nDomains } from './i18n/catalog.js';
import { mountProfile } from './profile.js';

type Attempt = {
  puzzleId: string;
  variant: string;
  solved: boolean;
  rated: boolean;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  createdAt: string;
};

function attempt(index: number, overrides: Partial<Attempt> = {}): Attempt {
  return {
    puzzleId: `xq-${index}`,
    variant: 'xiangqi',
    solved: true,
    rated: true,
    ratingBefore: 1500 + index * 10,
    ratingAfter: 1510 + index * 10,
    ratingDelta: 10,
    createdAt: new Date(Date.UTC(2026, 9, index + 1, 12)).toISOString(),
    ...overrides,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();

function game(roomId: string, endedAt: string) {
  return {
    roomId,
    variant: 'xiangqi',
    mode: 'pvp' as const,
    rated: false,
    result: 'red-wins',
    termination: 'resignation',
    plyCount: 20,
    whiteName: null,
    blackName: null,
    corpusId: null,
    endedAt,
    participants: [],
    playerColor: 'red',
  };
}

function mockProfile(
  history: (url: URL) => Response | Promise<Response>,
  isViewer = true,
  games: ReturnType<typeof game>[] = [],
  gamesTotal = games.length,
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/puzzles/history') return history(url);
    if (url.pathname.endsWith('/profile')) {
      return json({
        profile: {
          isViewer,
          user: {
            handle: 'solver',
            displayName: 'Solver',
            profileVisibility: 'public',
            accountRole: 'player',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          ratings: [],
          puzzleRatings: [
            { variant: 'xiangqi', rating: 1520, provisional: false, solved: 1, attempts: 2 },
          ],
          games,
          gamesTotal,
        },
      });
    }
    return json({ points: [], players: [], games: [] });
  });
}

beforeAll(async () => {
  await loadAppI18nDomains();
});

beforeEach(() => {
  window.history.replaceState(null, '', '/@/solver');
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  await mountProfile(root, 'solver');
  return root;
}

const activityRows = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLElement>('.profile-activity-panel .profile-activity-summary-row'),
];
const rowTitle = (row: HTMLElement | undefined) =>
  row?.querySelector('.profile-activity-summary-title')?.textContent;
const rowPills = (row: HTMLElement | undefined) =>
  [...(row?.querySelectorAll('.profile-record-pill') ?? [])].map((pill) => [
    pill.textContent,
    pill.classList.contains('profile-record-pill-win')
      ? 'win'
      : pill.classList.contains('profile-record-pill-loss')
        ? 'loss'
        : 'other',
  ]);

describe('private puzzle progress on the profile (#704)', () => {
  it('loads existing history across API pages and plots ratings at their actual dates', async () => {
    const requests: URL[] = [];
    mockProfile((url) => {
      requests.push(url);
      return json(
        url.searchParams.get('offset') === '0'
          ? { attempts: [attempt(0), attempt(1)], nextOffset: 2 }
          : {
              attempts: [attempt(9, { solved: false, ratingAfter: 1550, ratingDelta: -40 })],
              nextOffset: null,
            },
      );
    });
    const root = await mount();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-puzzle-chart-dot')).toHaveLength(3),
    );
    // One walk of the history serves both the chart and the Activity rows.
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '2']);
    expect(requests.every((url) => url.searchParams.get('variant') === 'xiangqi')).toBe(true);
    expect(requests.every((url) => !url.searchParams.has('userId'))).toBe(true);
    const dots = [...root.querySelectorAll('.profile-puzzle-chart-dot')];
    expect(dots.map((dot) => dot.getAttribute('data-rating'))).toEqual(['1510', '1520', '1550']);
    const xs = dots.map((dot) => Number(dot.getAttribute('cx')));
    expect((xs[1]! - xs[0]!) / (xs[2]! - xs[0]!)).toBeCloseTo(1 / 9);
    expect(root.querySelector('.profile-puzzle-chart svg')?.getAttribute('role')).toBe('img');
  });

  it('does not list individual attempts on the profile', async () => {
    mockProfile(() =>
      json({ attempts: Array.from({ length: 24 }, (_, i) => attempt(i)), nextOffset: null }),
    );
    const root = await mount();
    await vi.waitFor(() => expect(activityRows(root).length).toBeGreaterThan(0));
    const progress = root.querySelector('.profile-puzzle-progress');
    expect(progress?.querySelector('.profile-puzzle-chart svg')).not.toBeNull();
    expect(progress?.querySelector('ol, ul, h3')).toBeNull();
    expect(root.querySelector('.profile-puzzle-history-row')).toBeNull();
    expect(root.querySelector('.profile-puzzle-history-more')).toBeNull();
    expect(root.querySelector('a[href^="/puzzles/xq-"]')).toBeNull();
  });

  it('keeps legacy and unrated results without inventing ratings or bridging missing snapshots', async () => {
    mockProfile(() =>
      json({
        attempts: [
          attempt(0),
          attempt(1, { ratingBefore: null, ratingAfter: null, ratingDelta: null }),
          attempt(2, { ratingBefore: 1510 }),
          attempt(3, { rated: false, ratingBefore: 1530, ratingAfter: 1530, ratingDelta: 0 }),
        ],
        nextOffset: null,
      }),
    );
    const root = await mount();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-puzzle-chart-dot')).toHaveLength(2),
    );
    expect(root.querySelectorAll('.profile-puzzle-chart-line')).toHaveLength(2);
    expect(root.querySelector('.profile-puzzle-progress')?.textContent).toContain('Older results');
  });

  it('aggregates attempts into one Activity row per day, newest first, with zero games', async () => {
    mockProfile(() =>
      json({
        attempts: [
          attempt(0, { createdAt: at(1, 10) }),
          attempt(1, { createdAt: at(1, 14), solved: false }),
          attempt(2, { createdAt: at(4, 12) }),
        ],
        nextOffset: null,
      }),
    );
    const root = await mount();
    await vi.waitFor(() => expect(activityRows(root)).toHaveLength(2));
    const rows = activityRows(root);
    expect(rowTitle(rows[0])).toBe('Solved 1 Xiangqi puzzle');
    expect(rowPills(rows[0])).toEqual([['1 solved', 'win']]);
    expect(rowTitle(rows[1])).toBe('Solved 2 Xiangqi puzzles');
    expect(rowPills(rows[1])).toEqual([
      ['1 solved', 'win'],
      ['1 failed', 'loss'],
    ]);
    expect(rows[0]?.querySelector('.profile-activity-summary-day')?.textContent).not.toBe(
      rows[1]?.querySelector('.profile-activity-summary-day')?.textContent,
    );
    // The zero-games empty state gives way to the puzzle rows.
    expect(root.querySelector('.profile-activity-panel .landing-games-empty')).toBeNull();
  });

  it('interleaves puzzle days with game days by date', async () => {
    mockProfile(
      () =>
        json({
          attempts: [attempt(0, { createdAt: at(1) }), attempt(1, { createdAt: at(5) })],
          nextOffset: null,
        }),
      true,
      [game('g-new', at(7)), game('g-mid', at(3))],
    );
    const root = await mount();
    await vi.waitFor(() => expect(activityRows(root)).toHaveLength(4));
    expect(activityRows(root).map(rowTitle)).toEqual([
      'Played 1 Xiangqi game',
      'Solved 1 Xiangqi puzzle',
      'Played 1 Xiangqi game',
      'Solved 1 Xiangqi puzzle',
    ]);
  });

  it('drops puzzle days older than the first page of games', async () => {
    mockProfile(
      () =>
        json({
          attempts: [attempt(0, { createdAt: at(1) }), attempt(1, { createdAt: at(5) })],
          nextOffset: null,
        }),
      true,
      [game('g-mid', at(3))],
      40,
    );
    const root = await mount();
    await vi.waitFor(() => expect(activityRows(root)).toHaveLength(2));
    expect(activityRows(root).map(rowTitle)).toEqual([
      'Solved 1 Xiangqi puzzle',
      'Played 1 Xiangqi game',
    ]);
  });

  it('never requests the owner history while viewing somebody else', async () => {
    const history = vi.fn(() => json({ attempts: [attempt(0)], nextOffset: null }));
    mockProfile(history, false, [game('g-1', at(2))]);
    const root = await mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(history).not.toHaveBeenCalled();
    expect(root.querySelector('.profile-puzzle-progress')).toBeNull();
    expect(activityRows(root).map(rowTitle)).toEqual(['Played 1 Xiangqi game']);
    expect(root.querySelector('.profile-activity-panel')?.textContent).not.toContain('puzzle');
  });

  it('shows an empty state and a puzzle link when there are no saved attempts', async () => {
    mockProfile(() => json({ attempts: [], nextOffset: null }));
    const root = await mount();
    await vi.waitFor(() =>
      expect(root.querySelector('.profile-puzzle-progress')?.textContent).toContain(
        'No puzzle results yet.',
      ),
    );
    expect(root.querySelector('.profile-puzzle-progress a')?.getAttribute('href')).toBe('/puzzles');
    expect(root.querySelector('.profile-puzzle-chart svg')).toBeNull();
    expect(root.querySelector('.profile-activity-panel .landing-games-empty')).not.toBeNull();
  });

  it('makes failed history requests retryable and fills the Activity rows on retry', async () => {
    let calls = 0;
    mockProfile(() =>
      ++calls === 1 ? json({}, 503) : json({ attempts: [attempt(0)], nextOffset: null }),
    );
    const root = await mount();
    await vi.waitFor(() =>
      expect(root.querySelector('.profile-puzzle-progress')?.textContent).toContain(
        'Could not load puzzle history.',
      ),
    );
    expect(activityRows(root)).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('.profile-puzzle-history-retry')?.click();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-puzzle-chart-dot')).toHaveLength(1),
    );
    expect(activityRows(root).map(rowTitle)).toEqual(['Solved 1 Xiangqi puzzle']);
    expect(calls).toBe(2);
  });

  it('keeps an all-legacy history visible with an explicit chart empty state', async () => {
    mockProfile(() =>
      json({
        attempts: [attempt(0, { ratingBefore: null, ratingAfter: null, ratingDelta: null })],
        nextOffset: null,
      }),
    );
    const root = await mount();
    await vi.waitFor(() =>
      expect(root.querySelector('.profile-puzzle-progress')?.textContent).toContain(
        'No saved rating points yet.',
      ),
    );
    expect(root.querySelectorAll('.profile-puzzle-chart-dot')).toHaveLength(0);
    expect(activityRows(root)).toHaveLength(1);
  });

  it.each([
    ['zh-hans', '解题进度', '解了 2 道象棋题', '已解 1 题', '走错 1 题'],
    ['zh-hant', '解題進度', '解了 2 道象棋題', '已解 1 題', '走錯 1 題'],
  ])(
    'localizes the chart heading and daily rows for %s',
    async (prefix, heading, title, solved, failed) => {
      window.history.replaceState(null, '', `/${prefix}/@/solver`);
      mockProfile(() =>
        json({ attempts: [attempt(0), attempt(0, { solved: false })], nextOffset: null }),
      );
      const root = await mount();
      await vi.waitFor(() => expect(activityRows(root)).toHaveLength(1));
      expect(root.querySelector('.profile-puzzle-progress h2')?.textContent).toBe(heading);
      expect(rowTitle(activityRows(root)[0])).toBe(title);
      expect(rowPills(activityRows(root)[0])).toEqual([
        [solved, 'win'],
        [failed, 'loss'],
      ]);
    },
  );
});
