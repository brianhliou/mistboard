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

function selectPuzzleRating(root: HTMLElement): void {
  const row = root.querySelector<HTMLButtonElement>('button.profile-puzzle-row');
  expect(row).not.toBeNull();
  row!.click();
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

describe('private puzzle history in the profile spotlight (#704, #827)', () => {
  it('selects puzzle history in the one spotlight with ranges without filtering games (#827)', async () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const older = new Date(recent);
    older.setMonth(older.getMonth() - 4);
    const fetchSpy = mockProfile(() =>
      json({
        attempts: [
          attempt(0, { createdAt: older.toISOString() }),
          attempt(1, { createdAt: recent.toISOString() }),
        ],
        nextOffset: null,
      }),
    );
    const root = await mount();
    const row = root.querySelector<HTMLButtonElement>('button.profile-puzzle-row');
    expect(row).not.toBeNull();
    row!.click();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(2),
    );
    expect(root.querySelectorAll('.profile-rating-spotlight')).toHaveLength(1);
    expect(root.querySelector('.profile-puzzle-progress')).toBeNull();
    expect(root.querySelector('.profile-chart-variant')?.textContent).toContain('Xiangqi');
    expect(root.querySelector('.profile-chart-variant')?.textContent).toContain('Puzzles');
    expect(root.querySelector('.profile-chart-value')?.textContent).toBe('1520');
    expect(root.querySelector('.profile-chart-detail')?.textContent).toBe('2 attempts');
    expect(row?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.profile-rating-row[aria-pressed="true"]')).toBeNull();
    expect(root.querySelectorAll('.profile-chart-range')).toHaveLength(6);
    const gamesCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('/games?'));
    expect(gamesCalls()).toHaveLength(0);
    expect(window.location.search).toBe('');

    root.querySelector<HTMLButtonElement>('.profile-chart-range[data-range="1M"]')!.click();
    expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('.profile-chart-range[data-range="ALL"]')!.click();
    expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(2);
    const slider = root.querySelector<HTMLInputElement>('.profile-chart-slider-input')!;
    slider.value = '50';
    slider.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(1);
    expect(root.querySelectorAll('.profile-chart-slider-axis span')).toHaveLength(2);
    expect(root.querySelector('.profile-chart-range[aria-pressed="true"]')).toBeNull();

    root.querySelector<HTMLButtonElement>('.profile-rating-row[data-variant="xiangqi"]')!.click();
    await vi.waitFor(() => expect(gamesCalls()).toHaveLength(1));
    expect(row?.getAttribute('aria-pressed')).toBe('false');
    expect(
      root
        .querySelector('.profile-rating-row[data-variant="xiangqi"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(window.location.search).toContain('variant=xiangqi');
    expect(root.querySelector('.profile-chart-variant')?.textContent).toBe('Xiangqi');
  });

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
    selectPuzzleRating(root);
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(3),
    );
    // One walk of the history serves both the chart and the Activity rows.
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '2']);
    expect(requests.every((url) => url.searchParams.get('variant') === 'xiangqi')).toBe(true);
    expect(requests.every((url) => !url.searchParams.has('userId'))).toBe(true);
    const dots = [...root.querySelectorAll('.profile-rating-chart-dot')];
    expect(dots.map((dot) => dot.getAttribute('data-rating'))).toEqual(['1510', '1520', '1550']);
    const xs = dots.map((dot) => Number(dot.getAttribute('cx')));
    expect((xs[1]! - xs[0]!) / (xs[2]! - xs[0]!)).toBeCloseTo(1 / 9);
    expect(root.querySelector('.profile-rating-chart svg')?.getAttribute('role')).toBe('img');
    // The line runs dot to dot: no leading rating-before point, which drew a
    // vertical tick from the start rating at the first attempt's x.
    const at = (dot: Element) => `${dot.getAttribute('cx')},${dot.getAttribute('cy')}`;
    const lines = [...root.querySelectorAll('.profile-rating-chart-line')];
    expect(lines.map((line) => line.getAttribute('points'))).toEqual([
      `${at(dots[0]!)} ${at(dots[1]!)}`,
      at(dots[2]!),
    ]);
  });

  it('keeps an existing Games filter when selecting puzzle history', async () => {
    window.history.replaceState(null, '', '/@/solver?variant=xiangqi&result=win');
    const fetchSpy = mockProfile(() => json({ attempts: [attempt(0)], nextOffset: null }));
    const root = await mount();
    const gamesCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('/games?'));
    await vi.waitFor(() => expect(gamesCalls()).toHaveLength(1));
    selectPuzzleRating(root);
    await vi.waitFor(() =>
      expect(root.querySelector('.profile-rating-spotlight')?.getAttribute('aria-busy')).toBe(
        'false',
      ),
    );
    expect(gamesCalls()).toHaveLength(1);
    expect(window.location.search).toBe('?variant=xiangqi&result=win');
    expect(root.querySelector('.profile-games-filter')?.textContent).toContain('Xiangqi');
    expect(root.querySelector('.profile-games-filter')?.textContent).toContain('Wins');
  });

  it('plots one point per day at the day closing rating', async () => {
    mockProfile(() =>
      json({
        attempts: [
          attempt(0, { createdAt: at(1, 10) }),
          attempt(1, { createdAt: at(1, 11), solved: false, ratingAfter: 1490, ratingDelta: -30 }),
          attempt(2, { createdAt: at(1, 12), ratingBefore: 1490, ratingAfter: 1505 }),
          attempt(3, { createdAt: at(3, 12), ratingBefore: 1505, ratingAfter: 1540 }),
        ],
        nextOffset: null,
      }),
    );
    const root = await mount();
    selectPuzzleRating(root);
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(2),
    );
    const dots = [...root.querySelectorAll('.profile-rating-chart-dot')];
    expect(dots.map((dot) => dot.getAttribute('data-rating'))).toEqual(['1505', '1540']);
    expect(dots[0]?.querySelector('title')?.textContent).toContain('1500 → 1505');
    expect(root.querySelectorAll('.profile-rating-chart-line')).toHaveLength(1);
  });

  it('does not list individual attempts on the profile', async () => {
    mockProfile(() =>
      json({ attempts: Array.from({ length: 24 }, (_, i) => attempt(i)), nextOffset: null }),
    );
    const root = await mount();
    selectPuzzleRating(root);
    await vi.waitFor(() => expect(activityRows(root).length).toBeGreaterThan(0));
    const progress = root.querySelector('.profile-rating-spotlight');
    expect(root.querySelector('.profile-puzzle-progress')).toBeNull();
    expect(progress?.querySelector('.profile-rating-chart svg')).not.toBeNull();
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
    selectPuzzleRating(root);
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(2),
    );
    expect(root.querySelectorAll('.profile-rating-chart-line')).toHaveLength(2);
    expect(root.querySelector('.profile-rating-spotlight')?.textContent).toContain('Older results');
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
    expect(rowTitle(rows[0])).toBe('Played 1 Xiangqi puzzle');
    expect(rowPills(rows[0])).toEqual([['1 solved', 'win']]);
    expect(rowTitle(rows[1])).toBe('Played 2 Xiangqi puzzles');
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
      'Played 1 Xiangqi puzzle',
      'Played 1 Xiangqi game',
      'Played 1 Xiangqi puzzle',
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
      'Played 1 Xiangqi puzzle',
      'Played 1 Xiangqi game',
    ]);
  });

  it('never requests the owner history while viewing somebody else', async () => {
    const history = vi.fn(() => json({ attempts: [attempt(0)], nextOffset: null }));
    mockProfile(history, false, [game('g-1', at(2))]);
    const root = await mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(history).not.toHaveBeenCalled();
    expect(root.querySelector('button.profile-puzzle-row')).toBeNull();
    expect(root.querySelector('.profile-puzzle-row')?.tagName).toBe('DIV');
    expect(root.querySelector('.profile-puzzle-row')?.hasAttribute('aria-pressed')).toBe(false);
    expect(root.querySelector('.profile-puzzle-progress')).toBeNull();
    expect(activityRows(root).map(rowTitle)).toEqual(['Played 1 Xiangqi game']);
    expect(root.querySelector('.profile-activity-panel')?.textContent).not.toContain('puzzle');
  });

  it('uses the shared chart empty state when there are no saved attempts', async () => {
    mockProfile(() => json({ attempts: [], nextOffset: null }));
    const root = await mount();
    selectPuzzleRating(root);
    await vi.waitFor(() =>
      expect(root.querySelector('.profile-rating-spotlight')?.getAttribute('aria-busy')).toBe(
        'false',
      ),
    );
    expect(root.querySelector('.profile-rating-chart-empty')?.textContent).toBe(
      'No rating history yet.',
    );
    expect(root.querySelector('.profile-puzzle-progress')).toBeNull();
    expect(root.querySelector('.profile-activity-panel .landing-games-empty')).not.toBeNull();
  });

  it('makes failed history requests retryable and fills the Activity rows on retry', async () => {
    let calls = 0;
    let failing = true;
    mockProfile(() => {
      calls += 1;
      return failing ? json({}, 503) : json({ attempts: [attempt(0)], nextOffset: null });
    });
    const root = await mount();
    selectPuzzleRating(root);
    await vi.waitFor(() =>
      expect(root.querySelector('.profile-rating-spotlight')?.textContent).toContain(
        'Could not load puzzle history.',
      ),
    );
    expect(activityRows(root)).toHaveLength(0);
    const beforeRetry = calls;
    failing = false;
    root.querySelector<HTMLButtonElement>('.profile-puzzle-history-retry')?.click();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(1),
    );
    expect(activityRows(root).map(rowTitle)).toEqual(['Played 1 Xiangqi puzzle']);
    expect(calls).toBe(beforeRetry + 1);
  });

  it('keeps an all-legacy history visible with an explicit chart empty state', async () => {
    mockProfile(() =>
      json({
        attempts: [attempt(0, { ratingBefore: null, ratingAfter: null, ratingDelta: null })],
        nextOffset: null,
      }),
    );
    const root = await mount();
    selectPuzzleRating(root);
    await vi.waitFor(() =>
      expect(root.querySelector('.profile-rating-spotlight')?.getAttribute('aria-busy')).toBe(
        'false',
      ),
    );
    expect(root.querySelector('.profile-rating-chart-empty')?.textContent).toBe(
      'No rating history yet.',
    );
    expect(root.querySelectorAll('.profile-rating-chart-dot')).toHaveLength(0);
    expect(activityRows(root)).toHaveLength(1);
  });

  it.each([
    ['zh-hans', '题目', '尝试 2 次', '做了 2 道象棋题', '已解 1 题', '走错 1 题'],
    ['zh-hant', '題目', '嘗試 2 次', '做了 2 道象棋題', '已解 1 題', '走錯 1 題'],
  ])(
    'localizes the chart heading and daily rows for %s',
    async (prefix, heading, detail, title, solved, failed) => {
      window.history.replaceState(null, '', `/${prefix}/@/solver`);
      mockProfile(() =>
        json({ attempts: [attempt(0), attempt(0, { solved: false })], nextOffset: null }),
      );
      const root = await mount();
      selectPuzzleRating(root);
      await vi.waitFor(() => expect(activityRows(root)).toHaveLength(1));
      expect(root.querySelector('.profile-chart-variant')?.textContent).toContain(heading);
      expect(root.querySelector('.profile-chart-detail')?.textContent).toBe(detail);
      expect(root.querySelector('.profile-puzzle-progress')).toBeNull();
      expect(rowTitle(activityRows(root)[0])).toBe(title);
      expect(rowPills(activityRows(root)[0])).toEqual([
        [solved, 'win'],
        [failed, 'loss'],
      ]);
    },
  );
});
