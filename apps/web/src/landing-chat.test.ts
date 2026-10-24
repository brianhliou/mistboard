import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendChatText,
  buildLandingChat,
  CHAT_VISIBLE_LINES,
  CHAT_WINDOW_MS,
  type ChatLine,
  chatTokenElement,
  createLandingChatFeed,
  type LobbyChatNotice,
  readStoredChatMuted,
  visibleChatWindow,
} from './landing-chat.js';

const T0 = Date.UTC(2026, 6, 10, 12, 0, 0);

function line(id: string, ageMs: number, now = T0): ChatLine {
  return {
    id,
    handle: `user_${id}`,
    text: `message ${id}`,
    createdAt: new Date(now - ageMs).toISOString(),
  };
}

describe('visibleChatWindow', () => {
  it('keeps a seven-day activity window', () => {
    expect(CHAT_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('keeps lines inside the window and drops lines at or beyond it', () => {
    const lines = [
      line('expired', CHAT_WINDOW_MS + 1),
      line('boundary', CHAT_WINDOW_MS),
      line('fresh', CHAT_WINDOW_MS - 1),
      line('now', 0),
    ];
    expect(visibleChatWindow(lines, T0).map((l) => l.id)).toEqual(['fresh', 'now']);
  });

  it('caps the window at the newest CHAT_VISIBLE_LINES', () => {
    const lines = Array.from({ length: CHAT_VISIBLE_LINES + 10 }, (_, i) =>
      line(`m${String(i).padStart(2, '0')}`, (CHAT_VISIBLE_LINES + 10 - i) * 1000),
    );
    const visible = visibleChatWindow(lines, T0);
    expect(visible).toHaveLength(CHAT_VISIBLE_LINES);
    expect(visible[0]?.id).toBe('m10');
    expect(visible[visible.length - 1]?.id).toBe(`m${CHAT_VISIBLE_LINES + 9}`);
  });

  it('drops lines with unparseable timestamps and returns [] for empty input', () => {
    expect(visibleChatWindow([], T0)).toEqual([]);
    const bad: ChatLine = { id: 'bad', handle: 'x', text: 'y', createdAt: 'not-a-date' };
    expect(visibleChatWindow([bad, line('ok', 1000)], T0).map((l) => l.id)).toEqual(['ok']);
  });
});

describe('createLandingChatFeed', () => {
  const state = { canReport: false, isAdmin: false, viewerHandle: null };

  function feedWithClock(startAt = T0, onEmpty?: () => void) {
    let now = startAt;
    const feed = createLandingChatFeed({
      state,
      locale: 'en',
      mode: 'live',
      now: () => now,
      onEmpty,
    });
    return { feed, advance: (ms: number) => (now += ms) };
  }

  function renderedIds(feed: { element: HTMLElement }): string[] {
    return [...feed.element.querySelectorAll('.landing-chat-line .landing-chat-text')].map(
      (el) => el.textContent?.replace('message ', '') ?? '',
    );
  }

  it('renders only lines inside the window on ingest', () => {
    const { feed } = feedWithClock();
    feed.ingest([line('old', CHAT_WINDOW_MS + 5000), line('a', 60_000), line('b', 1000)]);
    expect(renderedIds(feed)).toEqual(['a', 'b']);
    expect(feed.visibleIds()).toEqual(['a', 'b']);
  });

  it('renders a time-only timestamp for same-day lines, weekday for older ones', () => {
    const { feed } = feedWithClock();
    const today = line('today', 60_000);
    const yesterday = line('yesterday', 26 * 60 * 60 * 1000);
    feed.ingest([yesterday, today]);

    const stamps = [...feed.element.querySelectorAll<HTMLTimeElement>('.landing-chat-timestamp')];
    expect(stamps.map((el) => el.dateTime)).toEqual([yesterday.createdAt, today.createdAt]);
    expect(stamps[0]?.textContent).toMatch(/Thu.*(AM|PM)/);
    expect(stamps[1]?.textContent).toMatch(/(AM|PM)/);
    expect(stamps[1]?.textContent).not.toContain('Fri');
    expect(stamps[1]?.title).toContain('2026');
  });

  it('does not resurrect expired lines when a new message is ingested', () => {
    const { feed } = feedWithClock();
    // The whole served history is old: the visible window is empty.
    feed.ingest([line('old1', CHAT_WINDOW_MS + 60_000), line('old2', CHAT_WINDOW_MS + 5000)]);
    expect(renderedIds(feed)).toEqual([]);
    // Typing a new message re-renders from the same windowed store: only the
    // fresh line shows, even if a re-fetch delivers the old lines again.
    feed.ingest([line('old1', CHAT_WINDOW_MS + 60_000), line('fresh', 0)]);
    expect(renderedIds(feed)).toEqual(['fresh']);
  });

  it('ages lines out on expireTick as the clock advances', () => {
    const { feed, advance } = feedWithClock();
    feed.ingest([line('a', 2 * 60 * 60 * 1000), line('b', 60_000)]);
    expect(renderedIds(feed)).toEqual(['a', 'b']);

    advance(CHAT_WINDOW_MS - 60 * 60 * 1000); // 'a' is now past the window
    feed.expireTick();
    expect(renderedIds(feed)).toEqual(['b']);
  });

  it('invokes onEmpty when the last line ages out', () => {
    const onEmpty = vi.fn();
    const { feed, advance } = feedWithClock(T0, onEmpty);
    feed.ingest([line('a', 1000)]);
    expect(onEmpty).not.toHaveBeenCalled();

    advance(CHAT_WINDOW_MS + 1000);
    feed.expireTick();
    expect(renderedIds(feed)).toEqual([]);
    expect(onEmpty).toHaveBeenCalledTimes(1);

    // A quiet tick over an already-empty feed does not re-fire.
    feed.expireTick();
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it('enforces the visible cap, dropping the oldest line first', () => {
    const { feed } = feedWithClock();
    feed.ingest(
      Array.from({ length: CHAT_VISIBLE_LINES }, (_, i) =>
        line(`m${String(i).padStart(2, '0')}`, (CHAT_VISIBLE_LINES - i) * 1000),
      ),
    );
    expect(renderedIds(feed)).toHaveLength(CHAT_VISIBLE_LINES);
    expect(renderedIds(feed)[0]).toBe('m00');

    feed.ingest([line('newest', 0)]);
    const ids = renderedIds(feed);
    expect(ids).toHaveLength(CHAT_VISIBLE_LINES);
    expect(ids[0]).toBe('m01');
    expect(ids[ids.length - 1]).toBe('newest');
  });

  it('removes a line from the store so re-renders cannot bring it back', () => {
    const { feed } = feedWithClock();
    feed.ingest([line('a', 2000), line('b', 1000)]);
    feed.remove('a');
    expect(renderedIds(feed)).toEqual(['b']);
    feed.expireTick();
    expect(renderedIds(feed)).toEqual(['b']);
  });
});

describe('chat text linkify', () => {
  it('renders a mistboard URL as a same-tab path-relative anchor', () => {
    const el = chatTokenElement('https://mistboard.com/jieqi/game/jq_abc?x=1#m4');
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/jieqi/game/jq_abc?x=1#m4');
    expect(el.getAttribute('target')).toBeNull();
    expect(el.textContent).toBe('https://mistboard.com/jieqi/game/jq_abc?x=1#m4');
  });

  it('renders an external URL as a new-tab anchor with the ugc rel set', () => {
    const el = chatTokenElement('https://lichess.org/abc');
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('https://lichess.org/abc');
    expect(el.getAttribute('target')).toBe('_blank');
    expect(el.getAttribute('rel')).toBe('ugc nofollow noopener noreferrer');
  });

  it('assumes https for a bare-domain token', () => {
    const external = chatTokenElement('example.com/path');
    expect(external.getAttribute('href')).toBe('https://example.com/path');
    const internal = chatTokenElement('mistboard.com/watch');
    expect(internal.getAttribute('href')).toBe('/watch');
  });

  it('renders an @mention as a profile link', () => {
    const el = chatTokenElement('@sdrf_tajik');
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/@/sdrf_tajik');
    expect(el.textContent).toBe('@sdrf_tajik');
  });

  it('keeps surrounding plain text as text nodes around anchor tokens', () => {
    const container = document.createElement('span');
    appendChatText(container, 'see https://mistboard.com/watch now');
    expect(container.textContent).toBe('see https://mistboard.com/watch now');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/watch');
  });
});

describe('composer paste normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('collapses pasted newlines to single spaces', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          lines: [line('a', 1000, Date.now())],
          canPost: true,
          canReport: false,
          viewerHandle: 'you',
          isAdmin: false,
        }),
      })),
    );
    const mount = buildLandingChat();
    document.body.append(mount);
    const input = await vi.waitFor(() => {
      const found = mount.querySelector<HTMLInputElement>('.landing-chat-input');
      expect(found).toBeTruthy();
      return found as HTMLInputElement;
    });

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'Not easy\nhttps://mistboard.com/watch' },
    });
    input.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(input.value).toBe('Not easy https://mistboard.com/watch');
  });
});

describe('buildLandingChat (live, stubbed fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function jsonResponse(payload: unknown): Response {
    return { ok: true, status: 200, json: async () => payload } as Response;
  }

  it('shows the quiet invitation, not old lines, when the window is empty on load', async () => {
    const oldLines = [line('old1', CHAT_WINDOW_MS + 60_000, Date.now())];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          lines: oldLines,
          canPost: true,
          canReport: false,
          viewerHandle: 'you',
          isAdmin: false,
        }),
      ),
    );

    const mount = buildLandingChat();
    document.body.append(mount);
    await vi.waitFor(() => {
      expect(mount.querySelector('.landing-chat-quiet')).toBeTruthy();
    });
    expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(0);
  });

  it('posting from the quiet state shows only the new line, never the expired history', async () => {
    const oldLines = [
      line('old1', CHAT_WINDOW_MS + 60_000, Date.now()),
      line('old2', CHAT_WINDOW_MS + 5000, Date.now()),
    ];
    const posted: ChatLine = {
      id: 'posted',
      handle: 'you',
      text: 'hello there',
      createdAt: new Date().toISOString(),
    };
    let sent = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: { method?: string }) => {
        if (init?.method === 'POST') {
          sent = true;
          return jsonResponse({ line: posted });
        }
        return jsonResponse({
          lines: sent ? [...oldLines, posted] : oldLines,
          canPost: true,
          canReport: false,
          viewerHandle: 'you',
          isAdmin: false,
        });
      }),
    );

    const mount = buildLandingChat();
    document.body.append(mount);
    await vi.waitFor(() => {
      expect(mount.querySelector('.landing-chat-quiet')).toBeTruthy();
    });

    const input = mount.querySelector<HTMLInputElement>('.landing-chat-input');
    const form = mount.querySelector<HTMLFormElement>('.landing-chat-composer');
    expect(input && form).toBeTruthy();
    if (!input || !form) return;
    input.value = 'hello there';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(1);
    });
    const texts = [...mount.querySelectorAll('.landing-chat-text')].map((el) => el.textContent);
    expect(texts).toEqual(['hello there']);
  });

  it('opens scrolled to the newest line once the page lays it out', async () => {
    // jsdom has no layout: attached elements get a size and a writable
    // scrollTop, and "layout" is firing the stubbed ResizeObservers.
    const scrollTops = new WeakMap<Element, number>();
    const spies = [
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.isConnected ? 480 : 0;
      }),
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.isConnected ? 120 : 0;
      }),
      vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) {
        return scrollTops.get(this) ?? 0;
      }),
      vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (
        this: Element,
        value: number,
      ) {
        scrollTops.set(this, value);
      }),
    ];
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: () => void) {}
        observe(): void {
          observers.push(() => this.callback());
        }
        disconnect(): void {}
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          lines: [line('a', 60_000, Date.now()), line('b', 1000, Date.now())],
          canPost: false,
          canReport: false,
          viewerHandle: null,
          isAdmin: false,
        }),
      ),
    );

    try {
      // The homepage attaches its tree after the chat has hydrated.
      const mount = buildLandingChat();
      await vi.waitFor(() => {
        expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(2);
      });
      const feed = mount.querySelector<HTMLElement>('.landing-chat-feed');
      expect(feed?.scrollTop).toBe(0);

      document.body.append(mount);
      for (const fire of observers) fire();
      expect(feed?.scrollTop).toBe(480);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('landing chat mute persistence (live)', () => {
  const CHAT_MUTED_KEY = 'mistboard.chatMuted';

  // The jsdom test env ships no window.localStorage (production code try/catches
  // around it); install an in-memory stub so the persistence path is exercised.
  let originalLocalStorage: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocalStorage) {
      Object.defineProperty(window, 'localStorage', originalLocalStorage);
    } else {
      Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'localStorage');
    }
    document.body.replaceChildren();
  });

  function stubRoomFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          lines: [line('a', 60_000, Date.now()), line('b', 1000, Date.now())],
          canPost: true,
          canReport: false,
          viewerHandle: 'you',
          isAdmin: false,
        }),
      })),
    );
  }

  it('reads the stored mute flag', () => {
    expect(readStoredChatMuted()).toBe(false);
    window.localStorage.setItem(CHAT_MUTED_KEY, 'true');
    expect(readStoredChatMuted()).toBe(true);
    window.localStorage.setItem(CHAT_MUTED_KEY, 'false');
    expect(readStoredChatMuted()).toBe(false);
  });

  it('renders the muted box (no feed) on load when mute was persisted', async () => {
    window.localStorage.setItem(CHAT_MUTED_KEY, 'true');
    stubRoomFetch();

    const mount = buildLandingChat();
    document.body.append(mount);
    // The box paints (chat exists) but in the muted state: the toggle is present,
    // the feed is not.
    await vi.waitFor(() => {
      expect(mount.querySelector('.landing-chat.is-chat-muted')).toBeTruthy();
    });
    expect(mount.querySelector('.landing-chat-toggle')).toBeTruthy();
    expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(0);
  });

  it('toggling mute writes the flag, and unmuting restores the feed and clears it', async () => {
    stubRoomFetch();

    const mount = buildLandingChat();
    document.body.append(mount);
    await vi.waitFor(() => {
      expect(mount.querySelectorAll('.landing-chat-line').length).toBeGreaterThan(0);
    });

    const toggle = mount.querySelector<HTMLButtonElement>('.landing-chat-toggle');
    expect(toggle).toBeTruthy();
    if (!toggle) return;

    toggle.click();
    expect(window.localStorage.getItem(CHAT_MUTED_KEY)).toBe('true');
    expect(mount.querySelector('.landing-chat.is-chat-muted')).toBeTruthy();
    expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(0);

    toggle.click();
    expect(window.localStorage.getItem(CHAT_MUTED_KEY)).toBe('false');
    await vi.waitFor(() => {
      expect(mount.querySelectorAll('.landing-chat-line').length).toBeGreaterThan(0);
    });
  });
});

// The homepage chat shows people only (2026-10-17). A server from before that
// change still sends derived `events` (bot wins, new studies); the box must
// render none of them and must not let them hold the room open.
describe('human lines only', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  const legacyEvents = (now: number) => [
    {
      id: 'act_game_win1',
      kind: 'bot-win',
      createdAt: new Date(now - 30_000).toISOString(),
      href: '/xiangqi/game/win1',
      handle: 'fox',
      opponent: 'Pikafish',
      gameSpecId: 'xiangqi',
    },
    {
      id: 'act_study_s1',
      kind: 'study',
      createdAt: new Date(now - 5000).toISOString(),
      href: '/study/s1',
      handle: 'fox',
      title: 'Opening traps',
    },
  ];

  function stubLobby(lines: ChatLine[]): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          lines,
          events: legacyEvents(Date.now()),
          canPost: false,
          canReport: true,
          viewerHandle: null,
          isAdmin: false,
        }),
      })),
    );
  }

  it('renders only the human lines when the payload also carries events', async () => {
    stubLobby([line('a', 60_000, Date.now()), line('b', 1000, Date.now())]);
    const mount = buildLandingChat();
    document.body.append(mount);
    await vi.waitFor(() => {
      expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(2);
    });
    const rows = [...mount.querySelectorAll<HTMLElement>('.landing-chat-line')];
    expect(rows.map((row) => row.querySelector('.landing-chat-handle')?.textContent)).toEqual([
      'user_a',
      'user_b',
    ]);
    expect(mount.querySelector('.landing-chat-event')).toBeNull();
    expect(mount.querySelector('a[href="/xiangqi/game/win1"], a[href="/study/s1"]')).toBeNull();
    expect(mount.textContent).not.toContain('Pikafish');
    expect(mount.textContent).not.toContain('Opening traps');
  });

  it('stays quiet when only events fall inside the window', async () => {
    stubLobby([line('old', CHAT_WINDOW_MS + 60_000, Date.now())]);
    const mount = buildLandingChat();
    document.body.append(mount);
    await vi.waitFor(() => {
      expect(mount.querySelector('.landing-chat-quiet')).toBeTruthy();
    });
    expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(0);
  });
});

// #651: the release drain's restart notice, the one system message the lobby
// keeps. The server derives it from live drain state; the widget shows it as a
// single row that a poll updates in place or takes away.
describe('drain notice', () => {
  const state = { canReport: true, isAdmin: true, viewerHandle: null };
  const pending = (restartAt: number): LobbyChatNotice => ({
    id: `drain-${restartAt}`,
    kind: 'server_restart',
    phase: 'pending',
    restartAt,
  });

  function feedWithClock() {
    let now = T0;
    const feed = createLandingChatFeed({ state, locale: 'en', mode: 'live', now: () => now });
    return { feed, advance: (ms: number) => (now += ms) };
  }

  function noticeRows(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('.landing-chat-notice')];
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('shows one notice row after the lines, with no handle link or moderation controls', () => {
    const { feed } = feedWithClock();
    feed.ingest([line('a', 1000)]);
    feed.setNotice(pending(T0 + 120_000));
    const rows = noticeRows(feed.element);
    expect(rows).toHaveLength(1);
    expect(feed.element.lastElementChild).toBe(rows[0]);
    expect(rows[0]?.textContent).toContain('Update pending');
    expect(rows[0]?.getAttribute('role')).toBe('status');
    expect(rows[0]?.querySelector('a, button')).toBeNull();
    expect(feed.visibleIds()).toEqual(['a']);
  });

  it('deduplicates: repeated polls of the same drain keep a single row', () => {
    const { feed } = feedWithClock();
    feed.ingest([line('a', 1000)]);
    const notice = pending(T0 + 120_000);
    feed.setNotice(notice);
    feed.setNotice({ ...notice });
    feed.ingest([line('a', 1000), line('b', 0)]);
    feed.setNotice({ ...notice });
    expect(noticeRows(feed.element)).toHaveLength(1);
  });

  it('updates the row in place when the drain commits to restarting', () => {
    const { feed } = feedWithClock();
    feed.ingest([line('a', 1000)]);
    const notice = pending(T0 + 120_000);
    feed.setNotice(notice);
    feed.setNotice({ ...notice, phase: 'restarting' });
    const rows = noticeRows(feed.element);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Server restarting now');
    expect(rows[0]?.textContent).not.toContain('Update pending');
  });

  it('a cancelled drain (no notice on the next poll) removes the row', () => {
    const { feed } = feedWithClock();
    feed.ingest([line('a', 1000)]);
    feed.setNotice(pending(T0 + 120_000));
    feed.setNotice(null);
    expect(noticeRows(feed.element)).toHaveLength(0);
    expect(feed.visibleIds()).toEqual(['a']);
  });

  it('drops the notice once its deadline passes, even with no poll', () => {
    const { feed, advance } = feedWithClock();
    feed.ingest([line('a', 1000)]);
    feed.setNotice(pending(T0 + 120_000));
    advance(120_001);
    feed.expireTick();
    expect(noticeRows(feed.element)).toHaveLength(0);
  });

  function stubLobby(lines: ChatLine[], notice?: LobbyChatNotice): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          lines,
          ...(notice ? { notice } : {}),
          canPost: false,
          canReport: false,
          viewerHandle: null,
          isAdmin: false,
        }),
      })),
    );
  }

  it('renders the notice from the lobby read in the live room', async () => {
    stubLobby([line('a', 1000, Date.now())], pending(Date.now() + 120_000));
    const mount = buildLandingChat();
    document.body.append(mount);
    await vi.waitFor(() => {
      expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(1);
    });
    expect(noticeRows(mount)).toHaveLength(1);
  });

  it('shows the notice above the quiet invitation when no line is in the window', async () => {
    stubLobby([], pending(Date.now() + 120_000));
    const mount = buildLandingChat();
    document.body.append(mount);
    await vi.waitFor(() => {
      expect(mount.querySelector('.landing-chat-quiet')).toBeTruthy();
    });
    expect(noticeRows(mount)).toHaveLength(1);
  });

  it('shows nothing extra when the lobby read carries no notice', async () => {
    stubLobby([line('a', 1000, Date.now())]);
    const mount = buildLandingChat();
    document.body.append(mount);
    await vi.waitFor(() => {
      expect(mount.querySelectorAll('.landing-chat-line')).toHaveLength(1);
    });
    expect(noticeRows(mount)).toHaveLength(0);
  });

  describe('quiet lobby polling', () => {
    let notice: LobbyChatNotice | undefined;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(T0);
      // Exercise the page-scoped poller, which is disabled in test mode.
      vi.stubEnv('MODE', 'development');
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      notice = undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            lines: [],
            notice,
            canPost: true,
            canReport: false,
            viewerHandle: 'you',
            isAdmin: false,
          }),
        })),
      );
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    async function mountQuietLobby(): Promise<HTMLElement> {
      const mount = buildLandingChat();
      document.body.append(mount);
      await vi.advanceTimersByTimeAsync(0);
      expect(mount.querySelector('.landing-chat-quiet')).toBeTruthy();
      return mount;
    }

    it('removes a cancelled notice on the next poll before its deadline', async () => {
      notice = pending(T0 + 120_000);
      const mount = await mountQuietLobby();
      expect(noticeRows(mount)).toHaveLength(1);

      notice = undefined;
      await vi.advanceTimersByTimeAsync(7000);

      expect(noticeRows(mount)).toHaveLength(0);
      expect(mount.querySelector('.landing-chat-quiet')).toBeTruthy();
    });

    it('picks up a new drain and its restarting phase without replacing a draft', async () => {
      const mount = await mountQuietLobby();
      expect(noticeRows(mount)).toHaveLength(0);
      const input = mount.querySelector<HTMLInputElement>('.landing-chat-input');
      expect(input).toBeTruthy();
      if (!input) return;
      input.value = 'unfinished message';

      notice = pending(T0 + 120_000);
      await vi.advanceTimersByTimeAsync(7000);
      expect(noticeRows(mount)).toHaveLength(1);
      expect(noticeRows(mount)[0]?.textContent).toContain('Update pending');

      notice = { ...notice, phase: 'restarting' };
      await vi.advanceTimersByTimeAsync(7000);
      expect(noticeRows(mount)).toHaveLength(1);
      expect(noticeRows(mount)[0]?.textContent).toContain('Server restarting now');
      expect(mount.querySelector('.landing-chat-input')).toBe(input);
      expect(input.value).toBe('unfinished message');

      // The new notice still expires locally while polls are suspended.
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      await vi.advanceTimersByTimeAsync(106_000);
      expect(noticeRows(mount)).toHaveLength(0);
    });
  });
});
