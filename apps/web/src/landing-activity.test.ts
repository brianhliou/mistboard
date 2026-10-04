import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLandingActivity } from './landing-activity.js';

describe('landing activity', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    setVisibility('visible');
  });

  it('condenses durable totals into one line with the month count in parentheses', async () => {
    stubFetch({
      '/api/live-stats': {
        playing: 3,
        online: 5,
        totalCompletedGames: 575,
        last30dCompletedGames: 261,
      },
    });

    const activity = buildLandingActivity();
    document.body.append(activity);

    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-value')?.textContent).toBe('575');
    });

    const links = [...activity.querySelectorAll<HTMLAnchorElement>('.landing-activity-link')];
    expect(links.map((link) => link.textContent)).toEqual(['575games played (261 this month)']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/stats']);
    // "this month" is a rolling 30-day window server-side; the tooltip says so.
    expect(activity.querySelector('.landing-activity-label')?.getAttribute('title')).toBe(
      'Completed games in the last 30 days',
    );
    // Players-online is dropped; only games-in-play remains on the live line,
    // and it links to the current-games page (the set it counts).
    expect(activity.querySelector('.landing-activity-live')?.textContent).toBe('3 games in play');
    expect(
      activity
        .querySelector<HTMLAnchorElement>('.landing-activity-live a.landing-activity-inline-stat')
        ?.getAttribute('href'),
    ).toBe('/games');
  });

  it('singularises one game in play', async () => {
    stubFetch({
      '/api/live-stats': {
        playing: 1,
        online: 2,
        totalCompletedGames: 575,
        last30dCompletedGames: 261,
      },
    });

    const activity = buildLandingActivity();
    document.body.append(activity);

    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-live')?.textContent).toBe('1 game in play');
    });
  });

  it('omits the live line entirely at zero games in play', async () => {
    stubFetch({
      '/api/live-stats': {
        playing: 0,
        online: 1,
        totalCompletedGames: 575,
        last30dCompletedGames: 261,
      },
    });

    const activity = buildLandingActivity();
    document.body.append(activity);

    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-value')?.textContent).toBe('575');
    });

    // A zero reads as "nobody is here"; absence is neutral. The durable
    // totals still render and the block stays.
    expect(activity.querySelector('.landing-activity-live')).toBeNull();
    expect(activity.isConnected).toBe(true);
  });

  it('never shows a live-line placeholder before hydrate', () => {
    const activity = buildLandingActivity({ hydrate: false });
    expect(activity.querySelector('.landing-activity-live')).toBeNull();
    expect(activity.querySelector('.landing-activity-value')?.textContent).toBe('–');
  });

  it('keeps a nonzero live line when durable totals are unavailable', async () => {
    stubFetch({
      '/api/live-stats': {
        playing: 2,
        online: 4,
        totalCompletedGames: null,
        last30dCompletedGames: null,
      },
    });

    const activity = buildLandingActivity();
    document.body.append(activity);

    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-live')?.textContent).toBe('2 games in play');
    });

    expect(activity.querySelector('.landing-activity-primary')).toBeNull();
    expect(activity.querySelector('.landing-activity-value')).toBeNull();
  });

  it('removes the block when totals are unavailable and nothing is in play', async () => {
    stubFetch({
      '/api/live-stats': {
        playing: 0,
        online: 0,
        totalCompletedGames: null,
        last30dCompletedGames: null,
      },
    });

    const activity = buildLandingActivity();
    document.body.append(activity);

    await vi.waitFor(() => {
      expect(activity.isConnected).toBe(false);
    });
  });

  it('re-polls and updates the numbers in place while the tab is visible', async () => {
    const counters = {
      playing: 1,
      online: 2,
      totalCompletedGames: 575,
      last30dCompletedGames: 261,
    };
    stubFetch({ '/api/live-stats': counters });

    const activity = buildLandingActivity({ pollMs: 10 });
    document.body.append(activity);
    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-live')?.textContent).toBe('1 game in play');
    });
    const headline = activity.querySelector('.landing-activity-value');

    counters.playing = 2;
    counters.totalCompletedGames = 576;
    counters.last30dCompletedGames = 262;
    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-live')?.textContent).toBe('2 games in play');
    });
    expect(activity.querySelector('.landing-activity-link')?.textContent).toBe(
      '576games played (262 this month)',
    );
    // Updated in place, not rebuilt.
    expect(activity.querySelector('.landing-activity-value')).toBe(headline);

    counters.playing = 0;
    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-live')).toBeNull();
    });
  });

  it('keeps the last values when a poll fails', async () => {
    let fail = false;
    const counters = {
      playing: 3,
      online: 3,
      totalCompletedGames: 575,
      last30dCompletedGames: 261,
    };
    const fetchMock = vi.fn(async () =>
      fail ? jsonResponse({}, { status: 503 }) : jsonResponse(counters),
    );
    vi.stubGlobal('fetch', fetchMock);

    const activity = buildLandingActivity({ pollMs: 10 });
    document.body.append(activity);
    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-value')?.textContent).toBe('575');
    });
    fail = true;
    const calls = fetchMock.mock.calls.length;
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(calls + 1));
    expect(activity.querySelector('.landing-activity-value')?.textContent).toBe('575');
    expect(activity.querySelector('.landing-activity-live')?.textContent).toBe('3 games in play');
  });

  it('stops polling while hidden and refreshes as soon as the tab is shown', async () => {
    const counters = {
      playing: 1,
      online: 1,
      totalCompletedGames: 575,
      last30dCompletedGames: 261,
    };
    const fetchMock = vi.fn(async () => jsonResponse(counters));
    vi.stubGlobal('fetch', fetchMock);

    const activity = buildLandingActivity({ pollMs: 10 });
    document.body.append(activity);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    counters.totalCompletedGames = 600;
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      expect(activity.querySelector('.landing-activity-value')?.textContent).toBe('600');
    });
  });

  it('stops polling once the block leaves the page', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ playing: 0, online: 0, totalCompletedGames: 575, last30dCompletedGames: 261 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const activity = buildLandingActivity({ pollMs: 10 });
    document.body.append(activity);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    activity.remove();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// A route value of `{ status: N }` answers with that status and an empty body;
// anything else is served as JSON. Responses are built per call because a body
// can only be read once.
function stubFetch(routes: Record<string, Record<string, unknown>>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const route = routes[String(input)];
      if (!route) return jsonResponse({}, { status: 404 });
      if (typeof route.status === 'number') return jsonResponse({}, { status: route.status });
      return jsonResponse(route);
    }),
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}
