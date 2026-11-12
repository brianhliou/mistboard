// #606: the "Play again by correspondence" button and the review page's offer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({
  trackCorrespondenceAgainShown: vi.fn(),
  trackCorrespondenceSeekPosted: vi.fn(),
}));
vi.mock('./analytics.js', () => analytics);

const account = vi.hoisted(() => ({
  loadCachedCurrentUser: vi.fn(async (): Promise<{ handle: string } | null> => null),
}));
vi.mock('./account-nav.js', () => account);

const signedIn = vi.hoisted(() => ({ isLikelySignedIn: vi.fn(() => true) }));
vi.mock('./signed-in-state.js', () => signedIn);

import type { CorrespondenceAgainOffer } from './challenge-model.js';
import {
  correspondenceAgainButton,
  resetCorrespondenceAgainShown,
  reviewCorrespondenceAgainSlot,
  reviewCorrespondenceOffer,
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
  account.loadCachedCurrentUser.mockReset();
  signedIn.isLikelySignedIn.mockReturnValue(true);
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

describe('review page offer', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const game = {
    mode: 'pvp',
    players: [
      { color: 'red', handle: 'alice' },
      { color: 'black', handle: 'bob' },
    ],
    initialMs: 300_000,
    incrementMs: 3_000,
  };

  it('offers the swapped side to either player, one day after a live game', () => {
    expect(reviewCorrespondenceOffer({ gameSpecId: 'xiangqi', game }, 'alice')).toEqual({
      gameSpecId: 'xiangqi',
      opponentHandle: 'bob',
      preferredColor: 'second',
      daysPerMove: 1,
    });
    expect(reviewCorrespondenceOffer({ gameSpecId: 'xiangqi', game }, 'bob')).toMatchObject({
      opponentHandle: 'alice',
      preferredColor: 'first',
    });
  });

  it("keeps a correspondence game's pace", () => {
    const corr = { ...game, initialMs: 3 * DAY, incrementMs: 0 };
    expect(reviewCorrespondenceOffer({ gameSpecId: 'jieqi', game: corr }, 'alice')).toMatchObject({
      daysPerMove: 3,
    });
  });

  it('offers nothing to a spectator, a bot game, a guest seat or an unsupported variant', () => {
    expect(reviewCorrespondenceOffer({ gameSpecId: 'xiangqi', game }, 'carol')).toBeNull();
    expect(reviewCorrespondenceOffer({ gameSpecId: 'xiangqi', game }, null)).toBeNull();
    const bot = {
      ...game,
      players: [game.players[0]!, { color: 'black', handle: 'misty', botId: 'misty-l3' }],
    };
    expect(reviewCorrespondenceOffer({ gameSpecId: 'xiangqi', game: bot }, 'alice')).toBeNull();
    const guest = { ...game, players: [game.players[0]!, { color: 'black' }] };
    expect(reviewCorrespondenceOffer({ gameSpecId: 'xiangqi', game: guest }, 'alice')).toBeNull();
    expect(reviewCorrespondenceOffer({ gameSpecId: 'xiangqi-mahjong', game }, 'alice')).toBeNull();
  });

  it('needs the first mover named for Gomoku', () => {
    const gomoku = {
      ...game,
      players: [
        { color: 'black', handle: 'alice' },
        { color: 'white', handle: 'bob' },
      ],
    };
    expect(reviewCorrespondenceOffer({ gameSpecId: 'gomoku', game: gomoku }, 'alice')).toBeNull();
    expect(
      reviewCorrespondenceOffer(
        { gameSpecId: 'gomoku', game: gomoku, firstMoverColor: 'black' },
        'alice',
      ),
    ).toMatchObject({ preferredColor: 'second' });
  });

  it('fills the slot only once the signed-in account is a player', async () => {
    account.loadCachedCurrentUser.mockResolvedValue({ handle: 'alice' });
    const slot = reviewCorrespondenceAgainSlot({ gameSpecId: 'xiangqi', game, roomId: 'r3' });
    expect(slot.hidden).toBe(true);
    await settle();
    expect(slot.hidden).toBe(false);
    expect(slot.querySelector('[data-correspondence-again]')?.textContent).toBe(
      'Play again by correspondence',
    );

    account.loadCachedCurrentUser.mockResolvedValue({ handle: 'carol' });
    const spectator = reviewCorrespondenceAgainSlot({ gameSpecId: 'xiangqi', game, roomId: 'r4' });
    await settle();
    expect(spectator.hidden).toBe(true);
    expect(spectator.childElementCount).toBe(0);
  });

  it('skips the account read for a signed-out reader', () => {
    signedIn.isLikelySignedIn.mockReturnValue(false);
    const slot = reviewCorrespondenceAgainSlot({ gameSpecId: 'xiangqi', game, roomId: 'r6' });
    expect(slot.hidden).toBe(true);
    expect(account.loadCachedCurrentUser).not.toHaveBeenCalled();
  });

  it('skips the account read for a game that could never qualify', () => {
    const bot = {
      ...game,
      players: [game.players[0]!, { color: 'black', handle: 'misty', botId: 'misty-l3' }],
    };
    reviewCorrespondenceAgainSlot({ gameSpecId: 'xiangqi', game: bot, roomId: 'r5' });
    expect(account.loadCachedCurrentUser).not.toHaveBeenCalled();
  });
});
