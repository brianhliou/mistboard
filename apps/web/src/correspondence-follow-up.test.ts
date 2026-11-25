import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChallengeCard, type ChallengeView } from './challenge-accept.js';
import { buildInboxCard, renderIncomingChallenges } from './correspondence.js';
import type { CorrespondenceGame } from './correspondence-model.js';
import { mountCurrentGames } from './current-games.js';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { setStoredLocale } from './i18n/locale.js';
import * as home from './landing-correspondence-moves.js';
import { setResolvedSignedIn } from './signed-in-state.js';

vi.mock('./analytics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./analytics.js')>()),
  track: vi.fn(),
  trackCorrespondenceSeekPosted: vi.fn(),
  trackCorrespondenceSeekAccepted: vi.fn(),
}));
const renderStart = vi.hoisted(() => vi.fn(async () => null));
vi.mock('./start-position-board.js', () => ({ renderStartPositionSvg: renderStart }));

const sent: ChallengeView = {
  id: 'sent-1',
  gameSpecId: 'xiangqi',
  daysPerMove: 3,
  preferredColor: 'random',
  visibility: 'private',
  challengerName: 'Alice',
  isMine: true,
  canAccept: false,
  canDecline: false,
  expired: false,
  targetName: 'Bob',
  targetHandle: 'bob',
  targetEmailed: false,
};
const challenge = {
  id: 'incoming-1',
  gameSpecId: 'dark-xiangqi',
  daysPerMove: 3,
  preferredColor: 'first',
  challengerName: 'Alice',
  challengerHandle: 'alice',
  createdAt: '2026-11-13T00:00:00Z',
  // A malformed extra position must never be used as the invite's board.
  position: 'PRIVATE-POSITION',
  seatBoard: { board: { a1: 'SECRET-PIECE' } },
};
const now = Date.parse('2026-11-13T12:00:00Z');
const dueAt = new Date(now + 2 * 86_400_000 + 4 * 3_600_000).toISOString();
const game: CorrespondenceGame = {
  roomId: 'corr-1',
  url: '/room/corr-1',
  gameSpecId: 'xiangqi',
  mySeat: 'red',
  isYourMove: true,
  opponentName: 'Bob',
  dueAt,
};
const button = (card: HTMLElement, label: string) =>
  [...card.querySelectorAll('button')].find((b) => b.textContent === label);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

afterEach(() => {
  document.body.replaceChildren();
  setResolvedSignedIn(undefined);
  setStoredLocale('en');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  renderStart.mockClear();
  for (const [name, descriptor] of [
    ['share', shareDescriptor],
    ['clipboard', clipboardDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(navigator, name, descriptor);
    else Reflect.deleteProperty(navigator, name);
  }
});

describe('sent correspondence challenge (#1113)', () => {
  it.each(['en', 'zh-Hans', 'zh-Hant'] as const)(
    'names the recipient and offers Withdraw in %s',
    async (locale) => {
      await ensureLocaleCatalog(locale);
      setStoredLocale(locale);
      const card = buildChallengeCard(sent);
      expect(card.querySelector('h1')?.textContent).toContain('@bob');
      expect(card.querySelector('.challenge-subhead')?.textContent).toContain('3');
      expect(card.querySelector('[data-withdraw-challenge]')).not.toBeNull();
      expect(card.textContent).not.toContain('—');
    },
  );

  it('shows the sender their own side and the game type in the sent terms', () => {
    const card = buildChallengeCard({ ...sent, preferredColor: 'first' });
    expect(card.querySelector('.challenge-subhead')?.textContent).toContain('you play Red');
    expect(card.querySelector('.challenge-subhead')?.textContent).toContain('Casual');
  });

  it('withdraws the actual invitation, and keeps it actionable after a failed request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({}));
    vi.stubGlobal('fetch', fetchMock);
    const card = buildChallengeCard(sent);
    document.body.append(card);
    const withdraw = button(card, 'Withdraw');
    expect(withdraw).toBeDefined();
    withdraw?.click();
    await vi.waitFor(() => expect(withdraw?.disabled).toBe(false));
    expect(card.isConnected).toBe(true);
    expect(card.querySelector('.challenge-status')?.textContent).toMatch(/could not/i);
    withdraw?.click();
    await vi.waitFor(() => expect(card.isConnected).toBe(false));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/correspondence/seeks/sent-1', {
      method: 'DELETE',
    });
    expect(document.body.textContent).toContain('Withdrawn');
  });
});

describe('incoming challenges on the homepage and correspondence page', () => {
  it('includes the incoming section in both phone and desktop homepages', async () => {
    const { buildLandingStage } = await import('./landing.js');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const phone of [true, false]) {
      const stage = buildLandingStage([], { phone, skipLiveWidgets: true });
      expect(stage.el.querySelector('.landing-corr-incoming')).not.toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads after sign-in, shows Accept/Decline, removes a declined row and clears on sign-out', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/correspondence/seeks/incoming')
        return response({ challenges: [challenge] });
      return response({}, init?.method === 'POST' ? 200 : 401);
    });
    vi.stubGlobal('fetch', fetchMock);
    const box = home.buildLandingIncomingChallenges();
    document.body.append(box);
    expect(fetchMock).not.toHaveBeenCalled();
    setResolvedSignedIn(true);
    await vi.waitFor(() => expect(box.hidden).toBe(false));
    expect(button(box, 'Accept')).toBeDefined();
    expect(button(box, 'Decline')).toBeDefined();
    expect(box.textContent).toContain('Alice');
    expect(box.textContent).not.toMatch(/PRIVATE-POSITION|SECRET-PIECE/);
    expect(box.querySelector('.current-game-board')).toBeNull();
    button(box, 'Decline')?.click();
    await vi.waitFor(() => expect(box.hidden).toBe(true));
    setResolvedSignedIn(false);
    expect(box.childElementCount).toBe(0);
  });

  it('does not restore a private invitation after signing out during its fetch', async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock);
    const box = home.buildLandingIncomingChallenges();
    document.body.append(box);
    setResolvedSignedIn(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    setResolvedSignedIn(false);
    resolve(response({ challenges: [challenge] }));
    await new Promise((done) => setTimeout(done, 0));
    expect(box.hidden).toBe(true);
    expect(box.childElementCount).toBe(0);
  });

  it('renders the same incoming invitation on /correspondence using only a start board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ challenges: [challenge] })),
    );
    const box = document.createElement('section');
    await renderIncomingChallenges(box);
    expect(button(box, 'Accept')).toBeDefined();
    expect(button(box, 'Decline')).toBeDefined();
    expect(box.outerHTML).not.toMatch(/PRIVATE-POSITION|SECRET-PIECE/);
    expect(renderStart.mock.calls.every((args) => args.length <= 2)).toBe(true);
  });

  it('accepts a compact invitation through the shared action', async () => {
    const fetchMock = vi.fn(async () => response({ url: '/room/accepted' }));
    vi.stubGlobal('fetch', fetchMock);
    const navigate = vi.fn();
    const { buildIncomingChallengeCard } = await import('./correspondence.js');
    const row = buildIncomingChallengeCard({ ...challenge, preferredColor: 'first' }, vi.fn(), {
      compact: true,
      navigate,
    });
    button(row, 'Accept')?.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/room/accepted'));
    expect(fetchMock).toHaveBeenCalledWith('/api/correspondence/seeks/incoming-1/accept', {
      method: 'POST',
    });
  });
});

describe('phone invite sharing', () => {
  // The invite link carries the share campaign tags and nothing else (#1223).
  const SENT_LINK = `${location.origin}/challenge/sent-1?utm_source=share&utm_medium=referral&utm_campaign=challenge`;
  it('shows only Copy when native sharing is unavailable', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const card = buildChallengeCard(sent);
    expect(button(card, 'Share')).toBeUndefined();
    button(card, 'Copy link')?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(SENT_LINK));
    expect(button(card, 'Copied')).toBeDefined();
  });
  it('uses native Share, falls back to Copy, and handles dismissal without copying', async () => {
    const share = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
      .mockRejectedValueOnce(new Error('unsupported'));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const card = buildChallengeCard(sent);
    const action = button(card, 'Share');
    expect(action).toBeDefined();
    action?.click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({ url: SENT_LINK });
    action?.click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(writeText).not.toHaveBeenCalled();
    action?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(SENT_LINK));
  });

  it('keeps the invite input large enough for phones', () => {
    const css = readFileSync('src/challenge.css', 'utf8');
    const rule = /\.challenge-share-link\s*\{([^}]+)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/font-size:\s*16px/);
    expect(rule).toMatch(/min-height:\s*40px/);
  });
});

it('distinguishes games against the same opponent with variant and move number', () => {
  const box = document.createElement('section');
  home.renderLandingCorrespondenceMoves(
    box,
    [
      { ...game, moveNumber: 4 },
      { ...game, roomId: 'corr-2', url: '/room/corr-2', moveNumber: 12 },
    ],
    now,
  );
  const rows = [...box.querySelectorAll('.landing-corr-moves-game')].map((row) => row.textContent);
  expect(rows[0]).toContain('Xiangqi');
  expect(rows[0]).toContain('Move 4');
  expect(rows[1]).toContain('Move 12');
  expect(rows[0]).not.toBe(rows[1]);
});

it('uses the /correspondence deadline clock on the game list and homepage', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const current = {
    roomId: game.roomId,
    gameSpecId: 'xiangqi',
    channelId: null,
    composition: 'pvp',
    observe: 'open',
    players: [
      { color: 'red', name: 'Alice' },
      { color: 'black', name: 'Bob' },
    ],
    ply: 4,
    rated: false,
    startedAt: null,
    lastActivityAt: null,
    timeControl: { initialMs: 0, incrementMs: 0, daysPerMove: 3 },
    timeClass: 'correspondence',
    clock: null,
    deadline: { seat: 'red', dueAt },
    url: game.url,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      response(
        url.startsWith('/api/games/current')
          ? { channel: 'all', channels: [], games: [current] }
          : {},
      ),
    ),
  );
  const root = document.createElement('main');
  document.body.append(root);
  await mountCurrentGames(root);
  const inbox = buildInboxCard(
    { signedIn: true, handles: [], tickers: [], isConnected: () => true },
    game,
    undefined,
    true,
  );
  const expected = inbox.querySelector('.is-deadline:not([hidden])')?.textContent;
  expect(expected).toBe('2d 4h left');
  expect(root.querySelector('.is-deadline:not([hidden])')?.textContent).toBe(expected);
  expect(home.yourMoveMeta(game, now)).toContain(expected);
});
