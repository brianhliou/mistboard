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

function mockProfile(history: (url: URL) => Response | Promise<Response>, isViewer = true) {
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
          games: [],
          gamesTotal: 0,
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
      expect(root.querySelectorAll('.profile-puzzle-history-row')).toHaveLength(3),
    );
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '2']);
    expect(requests.every((url) => url.searchParams.get('variant') === 'xiangqi')).toBe(true);
    expect(requests.every((url) => !url.searchParams.has('userId'))).toBe(true);
    const rows = root.querySelectorAll('.profile-puzzle-history-row');
    expect(rows[0]?.textContent).toContain('failed');
    expect(rows[0]?.textContent).toContain('-40');
    expect(rows[2]?.querySelector('a')?.getAttribute('href')).toBe('/puzzles/xq-0');
    const dots = [...root.querySelectorAll('.profile-puzzle-chart-dot')];
    expect(dots.map((dot) => dot.getAttribute('data-rating'))).toEqual(['1510', '1520', '1550']);
    const xs = dots.map((dot) => Number(dot.getAttribute('cx')));
    expect((xs[1]! - xs[0]!) / (xs[2]! - xs[0]!)).toBeCloseTo(1 / 9);
    expect(root.querySelector('.profile-puzzle-chart svg')?.getAttribute('role')).toBe('img');
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
      expect(root.querySelectorAll('.profile-puzzle-history-row')).toHaveLength(4),
    );
    expect(root.querySelectorAll('.profile-puzzle-chart-dot')).toHaveLength(2);
    expect(root.querySelectorAll('.profile-puzzle-chart-line')).toHaveLength(2);
    const rows = root.querySelectorAll('.profile-puzzle-history-row');
    expect(rows[0]?.textContent).toContain('Unrated');
    expect(rows[2]?.textContent).toContain('Rating unavailable');
    expect(root.querySelector('.profile-puzzle-progress')?.textContent).toContain('Older results');
  });

  it('shows the latest results first and reveals older results in compact batches', async () => {
    mockProfile(() =>
      json({ attempts: Array.from({ length: 24 }, (_, i) => attempt(i)), nextOffset: null }),
    );
    const root = await mount();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-puzzle-history-row')).toHaveLength(20),
    );
    const more = root.querySelector<HTMLButtonElement>('.profile-puzzle-history-more');
    expect(more?.textContent).toBe('Load more');
    expect(root.querySelector('.profile-puzzle-history-row a')?.getAttribute('href')).toBe(
      '/puzzles/xq-23',
    );
    more?.click();
    expect(root.querySelectorAll('.profile-puzzle-history-row')).toHaveLength(24);
    expect(root.querySelector('.profile-puzzle-history-more')).toBeNull();
  });

  it('never requests the owner history while viewing somebody else', async () => {
    const history = vi.fn(() => json({ attempts: [attempt(0)], nextOffset: null }));
    mockProfile(history, false);
    const root = await mount();
    expect(history).not.toHaveBeenCalled();
    expect(root.querySelector('.profile-puzzle-progress')).toBeNull();
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
  });

  it('makes failed history requests retryable without presenting an empty history', async () => {
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
    root.querySelector<HTMLButtonElement>('.profile-puzzle-history-retry')?.click();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.profile-puzzle-history-row')).toHaveLength(1),
    );
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
      expect(root.querySelectorAll('.profile-puzzle-history-row')).toHaveLength(1),
    );
    expect(root.querySelector('.profile-puzzle-progress')?.textContent).toContain(
      'No saved rating points yet.',
    );
    expect(root.querySelectorAll('.profile-puzzle-chart-dot')).toHaveLength(0);
  });

  it.each([
    ['zh-hans', '解题进度', '已解开'],
    ['zh-hant', '解題進度', '已解開'],
  ])(
    'localizes the timeline and preserves canonical puzzle links for %s',
    async (prefix, heading, result) => {
      window.history.replaceState(null, '', `/${prefix}/@/solver`);
      mockProfile(() => json({ attempts: [attempt(0)], nextOffset: null }));
      const root = await mount();
      await vi.waitFor(() =>
        expect(root.querySelectorAll('.profile-puzzle-history-row')).toHaveLength(1),
      );
      const block = root.querySelector('.profile-puzzle-progress');
      expect(block?.querySelector('h2')?.textContent).toBe(heading);
      expect(block?.querySelector('.profile-puzzle-history-row')?.textContent).toContain(result);
      expect(block?.querySelector('.profile-puzzle-history-row a')?.getAttribute('href')).toBe(
        '/puzzles/xq-0',
      );
    },
  );
});
