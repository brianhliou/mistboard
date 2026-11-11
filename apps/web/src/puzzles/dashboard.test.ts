import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isClientRoute } from '../../../server/src/server-policy.js';
import { setStoredLocale } from '../i18n/locale.js';
import { mountPuzzleDashboard } from './dashboard.js';

const currentUser = vi.hoisted(() => vi.fn());
vi.mock('../account-nav.js', () => ({ loadCachedCurrentUser: currentUser }));
vi.mock('../site-shell.js', () => ({ buildNav: () => document.createElement('nav') }));

const results = { days: 30, nb: 6, wins: 4, fixed: 2, puzzleRatingAvg: 1600 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let root: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;
const metric = (kind: string) => root.querySelector<HTMLElement>(`[data-metric="${kind}"]`);
const number = (kind: string) => metric(kind)?.querySelector('strong')?.textContent;
const selectDays = (value: string) => {
  const select = root.querySelector('select')!;
  select.value = value;
  select.dispatchEvent(new Event('change'));
};

beforeEach(() => {
  window.history.replaceState(null, '', '/puzzles/dashboard');
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  setStoredLocale('en');
  currentUser.mockReset().mockResolvedValue({ id: 'owner' });
  fetchMock = vi.fn().mockImplementation(async () => json(results));
  vi.stubGlobal('fetch', fetchMock);
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe('puzzle dashboard page', () => {
  it('fetches the default 30-day window and renders the heading and active shared menu', async () => {
    await mountPuzzleDashboard(root);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/puzzles/dashboard?days=30', {
      credentials: 'same-origin',
    });
    expect(window.location.search).toBe('?days=30');
    expect(root.querySelector('h1')?.textContent).toBe('Puzzle Dashboard');
    expect(root.querySelector('header p')?.textContent).toBe('Train, analyse, improve');
    expect(root.querySelector('.puzzle-menu [aria-current="page"]')?.getAttribute('href')).toBe(
      '/puzzles/dashboard',
    );
    expect(
      [...root.querySelectorAll('option')].map((option) => [option.value, option.textContent]),
    ).toEqual([
      ['1', '1 day'],
      ['2', '2 days'],
      ['3', '3 days'],
      ['7', '7 days'],
      ['10', '10 days'],
      ['14', '14 days'],
      ['21', '21 days'],
      ['30', '30 days'],
      ['60', '60 days'],
      ['90', '90 days'],
    ]);
    expect(number('played')).toBe('6');
    expect(number('performance')).toBe('1433');
    expect(number('solved')).toBe('67%');
    expect(metric('solved')?.style.backgroundImage).toBe(
      'linear-gradient(to right, var(--dashboard-solved) 67%, var(--dashboard-failed) 67%)',
    );
    expect(number('replay')).toBe('▶ 2');
    expect(metric('replay')?.getAttribute('href')).toBe('/puzzles/replay?days=30');
  });

  it('reads days from the URL and refetches on selection, preserving other URL parameters', async () => {
    window.history.replaceState(null, '', '/puzzles/dashboard?days=7&lang=en#summary');
    await mountPuzzleDashboard(root);
    expect(root.querySelector('select')?.value).toBe('7');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/puzzles/dashboard?days=7', {
      credentials: 'same-origin',
    });
    fetchMock.mockResolvedValueOnce(json({ ...results, nb: 10, wins: 6 }));
    selectDays('1');
    await vi.waitFor(() => expect(number('played')).toBe('10'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/puzzles/dashboard?days=1', {
      credentials: 'same-origin',
    });
    expect(window.location.search).toBe('?days=1&lang=en');
    expect(window.location.hash).toBe('#summary');
    expect(metric('replay')?.getAttribute('href')).toBe('/puzzles/replay?days=1');
  });

  it.each(['0', '4', '01', 'NaN'])('defaults unsupported days=%s to 30', async (days) => {
    window.history.replaceState(null, '', `/puzzles/dashboard?days=${days}`);
    await mountPuzzleDashboard(root);
    expect(root.querySelector('select')?.value).toBe('30');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/puzzles/dashboard?days=30', {
      credentials: 'same-origin',
    });
  });

  it.each([
    [{ nb: 5, wins: 3, fixed: 1 }, '1500?'],
    [{ nb: 6, wins: 3, fixed: 2 }, '1267?'],
    [{ nb: 6, wins: 5, fixed: 0 }, '1933?'],
    [{ nb: 6, wins: 4, fixed: 2 }, '1433'],
    [{ nb: 6, wins: 6, fixed: 2 }, '1767'],
  ])('uses the shared performance threshold for %j', async (counts, expected) => {
    fetchMock.mockResolvedValueOnce(json({ ...results, ...counts }));
    await mountPuzzleDashboard(root);
    expect(number('performance')).toBe(expected);
  });

  it('renders unknown performance without inventing a number', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...results, puzzleRatingAvg: null }));
    await mountPuzzleDashboard(root);
    expect(number('performance')).toBe('?');
  });

  it('omits the replay tile when every puzzle is solved', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...results, wins: 6 }));
    await mountPuzzleDashboard(root);
    expect(metric('replay')).toBeNull();
    expect(root.querySelectorAll('[data-metric]')).toHaveLength(3);
    expect(number('solved')).toBe('100%');
  });

  it('replaces all tiles with a centred trainer link for an empty window', async () => {
    fetchMock.mockResolvedValueOnce(json({ nb: 0, wins: 0, fixed: 0, puzzleRatingAvg: null }));
    await mountPuzzleDashboard(root);
    expect(root.querySelectorAll('[data-metric]')).toHaveLength(0);
    const link = root.querySelector('.puzzle-dashboard__message a');
    expect(link?.getAttribute('href')).toBe('/puzzles');
    expect(link?.textContent).toBe('Nothing to show, go play some puzzles first!');
  });

  it('shows the sign-in prompt without fetching dashboard data when signed out', async () => {
    currentUser.mockResolvedValueOnce(null);
    await mountPuzzleDashboard(root);
    expect(fetchMock).not.toHaveBeenCalled();
    const link = root.querySelector<HTMLAnchorElement>('.puzzle-dashboard__message a');
    expect(link?.textContent).toBe('Sign in to see your puzzle dashboard');
    expect(new URL(link!.href).searchParams.get('referrer')).toBe('/puzzles/dashboard');
    expect(root.querySelector('select')?.disabled).toBe(true);
  });

  it('handles an expired session without showing empty stats', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'not_signed_in' }, 401));
    await mountPuzzleDashboard(root);
    expect(root.querySelector('main')?.textContent).toContain(
      'Sign in to see your puzzle dashboard',
    );
    expect(root.querySelectorAll('[data-metric]')).toHaveLength(0);
    expect(root.querySelector('select')?.disabled).toBe(true);
  });

  it('ignores earlier responses when the selected window changes again', async () => {
    await mountPuzzleDashboard(root);
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    selectDays('7');
    selectDays('90');
    await vi.waitFor(() =>
      expect(metric('replay')?.getAttribute('href')).toBe('/puzzles/replay?days=90'),
    );
    finish(json({ ...results, nb: 50 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(number('played')).toBe('6');
    expect(window.location.search).toBe('?days=90');
  });

  it('allows retry after a failed fetch without displaying zero stats', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'unavailable' }, 503));
    await mountPuzzleDashboard(root);
    expect(root.querySelectorAll('[data-metric]')).toHaveLength(0);
    expect(root.querySelector('.puzzle-dashboard__message')?.textContent).toContain(
      'Could not load statistics',
    );
    root.querySelector<HTMLButtonElement>('main button')!.click();
    await vi.waitFor(() => expect(number('played')).toBe('6'));
  });

  it('dispatches dashboard before puzzle ids and the server serves its SPA shell', () => {
    const source = readFileSync('src/main.ts', 'utf8');
    expect(source).toContain("path === '/puzzles/dashboard'");
    expect(source).toContain("import('./puzzles/dashboard.js')");
    expect(source.indexOf('} else if (wantsPuzzleDashboard)')).toBeLessThan(
      source.indexOf('} else if (wantsPuzzles)'),
    );
    expect(isClientRoute('/puzzles/dashboard')).toBe(true);
    expect(isClientRoute('/puzzles/dashboard/')).toBe(true);
  });
});
