import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPostHogInstance } from './analytics.js';
import { takeGameStartSource } from './game-start-source.js';
import {
  buildLandingCorrespondenceCard,
  correspondenceCardState,
  correspondenceGuestHref,
} from './landing-correspondence.js';
import { setResolvedSignedIn } from './signed-in-state.js';

type Route = { status?: number; body: unknown };

function stubFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const route = routes[url];
      if (!route) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const capture = vi.fn();
const events = (name: string) =>
  (capture.mock.calls as Array<[string, Record<string, unknown>]>)
    .filter(([event]) => event === name)
    .map(([, props]) => props);

describe('landing correspondence card', () => {
  beforeEach(() => {
    capture.mockReset();
    setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    setResolvedSignedIn(undefined);
  });

  it('state: a move owed outranks a waiting seek and links to the first such game', () => {
    expect(
      correspondenceCardState(
        {
          games: [
            { url: '/room/a', isYourMove: true },
            { url: '/room/b', isYourMove: false },
            { url: '/room/c', isYourMove: true },
          ],
        },
        { seeks: [{ visibility: 'public', gameSpecId: 'jieqi', daysPerMove: 1 }] },
      ),
    ).toEqual({ kind: 'your-move', count: 2, href: '/room/a' });
  });

  it('state: an open casual 1-day jieqi board seek is waiting; anything else is the offer', () => {
    const waiting = { visibility: 'public', gameSpecId: 'jieqi', daysPerMove: 1, rated: false };
    expect(correspondenceCardState({ games: [] }, { seeks: [waiting] })).toEqual({
      kind: 'waiting',
    });
    for (const other of [
      { ...waiting, visibility: 'private' },
      { ...waiting, daysPerMove: 3 },
      { ...waiting, gameSpecId: 'xiangqi' },
      { ...waiting, rated: true },
    ]) {
      expect(correspondenceCardState({ games: [] }, { seeks: [other] })).toEqual({
        kind: 'start',
      });
    }
    expect(correspondenceCardState(null, null)).toEqual({ kind: 'start' });
  });

  it('guest: renders the offer as a sign-up link that returns with the intent, and fetches nothing', () => {
    setResolvedSignedIn(false);
    const calls = stubFetch({});
    const card = buildLandingCorrespondenceCard({ locale: 'en' });
    document.body.append(card);

    expect(card.dataset.state).toBe('start');
    expect(card.querySelector('.landing-corr-title')?.textContent).toBe('Jieqi by correspondence');
    expect(card.querySelector('.landing-corr-subline')?.textContent).toBe(
      "One move a day. We email you when it's your turn.",
    );
    const href = new URL(card.getAttribute('href') ?? '', 'https://mistboard.test');
    expect(href.pathname).toBe('/account');
    expect(href.searchParams.get('tab')).toBe('register');
    expect(href.searchParams.get('referrer')).toBe('/?corr=jieqi');
    expect(calls).toHaveLength(0);

    // A guest click follows the link (not prevented) and is counted.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    card.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(events('correspondence_button_clicked')).toEqual([
      {
        button_state: 'start',
        signed_in: false,
        locale: 'en',
        game_spec: 'jieqi',
        days_per_move: 1,
      },
    ]);
  });

  it('guest href keeps the zh homepage as the return path', () => {
    const href = new URL(correspondenceGuestHref('zh-Hans'), 'https://mistboard.test');
    expect(href.searchParams.get('referrer')).toMatch(/^\/zh-hans\/?\?corr=jieqi$/);
  });

  it('signed in: shows "Your move in N games" linking to the first game', async () => {
    setResolvedSignedIn(true);
    stubFetch({
      '/api/correspondence/games': {
        body: {
          games: [
            { url: '/room/jq_1', isYourMove: true },
            { url: '/room/jq_2', isYourMove: true },
          ],
        },
      },
      '/api/correspondence/seeks/mine': { body: { seeks: [] } },
    });
    const card = buildLandingCorrespondenceCard({ locale: 'en' });
    await vi.waitFor(() => expect(card.dataset.state).toBe('your-move'));
    expect(card.querySelector('.landing-corr-title')?.textContent).toBe('Your move in 2 games');
    expect(card.getAttribute('href')).toBe('/room/jq_1');
  });

  it('signed in: shows "Waiting for an opponent" linking to /correspondence', async () => {
    setResolvedSignedIn(true);
    stubFetch({
      '/api/correspondence/games': { body: { games: [] } },
      '/api/correspondence/seeks/mine': {
        body: { seeks: [{ visibility: 'public', gameSpecId: 'jieqi', daysPerMove: 1 }] },
      },
    });
    const card = buildLandingCorrespondenceCard({ locale: 'en' });
    await vi.waitFor(() => expect(card.dataset.state).toBe('waiting'));
    expect(card.querySelector('.landing-corr-title')?.textContent).toBe('Waiting for an opponent');
    expect(card.getAttribute('href')).toBe('/correspondence');
  });

  it('signed in: a click on the offer runs the quick pair and opens the paired game', async () => {
    setResolvedSignedIn(true);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, href: window.location.href });
    const calls = stubFetch({
      '/api/correspondence/games': { body: { games: [] } },
      '/api/correspondence/seeks/mine': { body: { seeks: [] } },
      '/api/correspondence/quick-pair': {
        status: 201,
        body: { kind: 'game', gameUrl: '/room/jq_9', roomId: 'jq_9' },
      },
    });
    const card = buildLandingCorrespondenceCard({ locale: 'en' });
    await vi.waitFor(() => expect(calls.length).toBe(2));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    card.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/room/jq_9'));
    const post = calls.find((call) => call.url === '/api/correspondence/quick-pair');
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ gameSpecId: 'jieqi', daysPerMove: 1 });
    expect(events('correspondence_quick_pair')[0]).toMatchObject({
      outcome: 'game',
      after_auth: false,
    });
    // The room's game_started will say where it came from.
    expect(takeGameStartSource()).toBe('home-correspondence');
  });

  it('signed in: a posted seek flips the card to waiting', async () => {
    setResolvedSignedIn(true);
    stubFetch({
      '/api/correspondence/games': { body: { games: [] } },
      '/api/correspondence/seeks/mine': { body: { seeks: [] } },
      '/api/correspondence/quick-pair': {
        status: 201,
        body: { kind: 'seek', seekId: 'seek_1', existing: false },
      },
    });
    const card = buildLandingCorrespondenceCard({ locale: 'en' });
    await vi.waitFor(() => expect(card.dataset.state).toBe('start'));
    card.click();
    await vi.waitFor(() => expect(card.dataset.state).toBe('waiting'));
    expect(events('correspondence_seek_posted')).toEqual([
      { gameSpecId: 'jieqi', daysPerMove: 1, kind: 'public', surface: 'home-button' },
    ]);
  });

  it('return from sign-up: the intent runs the quick pair once, with no click, and is stripped', async () => {
    window.history.replaceState(null, '', '/?corr=jieqi');
    setResolvedSignedIn(true);
    const calls = stubFetch({
      '/api/correspondence/quick-pair': {
        status: 201,
        body: { kind: 'seek', seekId: 'seek_1', existing: false },
      },
    });
    const card = buildLandingCorrespondenceCard({ locale: 'en' });
    await vi.waitFor(() => expect(card.dataset.state).toBe('waiting'));
    expect(calls.map((call) => call.url)).toEqual(['/api/correspondence/quick-pair']);
    expect(window.location.search).toBe('');
    expect(events('correspondence_quick_pair')[0]).toMatchObject({
      outcome: 'seek-posted',
      after_auth: true,
    });
  });

  it('prerender (no hydrate) renders the offer frame and never reads the intent', () => {
    window.history.replaceState(null, '', '/?corr=jieqi');
    const calls = stubFetch({});
    const card = buildLandingCorrespondenceCard({ hydrate: false, locale: 'en' });
    expect(card.dataset.state).toBe('start');
    expect(calls).toHaveLength(0);
    expect(window.location.search).toBe('?corr=jieqi');
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}
