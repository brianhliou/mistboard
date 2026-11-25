// #606: the "Play again by correspondence" button.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({
  trackCorrespondenceAgainShown: vi.fn(),
  trackCorrespondenceSeekPosted: vi.fn(),
}));
vi.mock('./analytics.js', () => analytics);

import type { CorrespondenceAgainOffer } from './challenge-model.js';
import {
  correspondenceAgainButton,
  resetCorrespondenceAgainShown,
} from './correspondence-again.js';
import { takeCorrespondenceStartSource } from './game-start-source.js';

const offer: CorrespondenceAgainOffer = {
  gameSpecId: 'xiangqi',
  opponentHandle: 'bob',
  preferredColor: 'second',
  daysPerMove: 3,
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

beforeEach(() => {
  // A fresh store per test: whether the runtime's storage survives between
  // tests varies by version.
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
  resetCorrespondenceAgainShown();
  analytics.trackCorrespondenceAgainShown.mockClear();
  analytics.trackCorrespondenceSeekPosted.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('correspondenceAgainButton', () => {
  it('reports the offer once per game however often the row re-renders', () => {
    correspondenceAgainButton(offer, { surface: 'postgame', roomId: 'r1' });
    correspondenceAgainButton(offer, { surface: 'postgame', roomId: 'r1' });
    correspondenceAgainButton(offer, { surface: 'review', roomId: 'r1' });
    expect(analytics.trackCorrespondenceAgainShown.mock.calls).toEqual([
      [{ gameSpecId: 'xiangqi', surface: 'postgame' }],
      [{ gameSpecId: 'xiangqi', surface: 'review' }],
    ]);
  });

  it('posts the directed casual seek, labels the start and opens the challenge page', async () => {
    const fetchMock = respond(201, { challengeUrl: '/challenge/abc' });
    vi.stubGlobal('fetch', fetchMock);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const button = correspondenceAgainButton(offer, { surface: 'postgame', roomId: 'r1' });
    expect(button.textContent).toBe('Play again by correspondence');

    button.click();
    expect(button.disabled).toBe(true);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/correspondence/seeks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      targetHandle: 'bob',
      gameSpecId: 'xiangqi',
      daysPerMove: 3,
      preferredColor: 'second',
    });
    expect(assign).toHaveBeenCalledWith('/challenge/abc');
    expect(analytics.trackCorrespondenceSeekPosted).toHaveBeenCalledWith({
      gameSpecId: 'xiangqi',
      daysPerMove: 3,
      kind: 'direct',
      surface: 'postgame',
    });
    expect(takeCorrespondenceStartSource('xiangqi')).toBe('postgame-correspondence');
  });

  it.each([
    [409, { error: 'seek_limit_reached' }, /too many open games/i],
    [403, { error: 'challenge_blocked' }, /bob/],
    [401, { error: 'unauthorized' }, /sign in/i],
    [500, { error: 'boom' }, /could not send/i],
  ])('re-enables with the reason on a %i', async (status, body, text) => {
    vi.stubGlobal('fetch', respond(status, body));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const button = correspondenceAgainButton(offer, { surface: 'review', roomId: 'r2' });
    button.click();
    await settle();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toMatch(text);
    expect(assign).not.toHaveBeenCalled();
    expect(analytics.trackCorrespondenceSeekPosted).not.toHaveBeenCalled();
    expect(takeCorrespondenceStartSource('xiangqi')).toBe('none');
  });
});
