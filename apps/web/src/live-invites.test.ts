import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceAccountPreferences } from './account-preferences.js';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { setStoredLocale } from './i18n/locale.js';
import { createLiveInviteController, type LiveInviteView } from './live-invites.js';

const base = '/api/live-invites';
const now = Date.parse('2026-11-14T12:00:00Z');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const invite = (overrides: Partial<LiveInviteView> = {}): LiveInviteView => ({
  id: 'offer-1',
  sender: { handle: 'alice', displayName: '<Alice>' },
  target: { handle: 'bob', displayName: 'Bob' },
  gameSpecId: 'xiangqi',
  timeControl: { initialMs: 180_000, incrementMs: 2_000 },
  preferredColor: 'first',
  rated: true,
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
  status: 'pending',
  isMine: false,
  canAccept: true,
  canDecline: true,
  canCancel: false,
  ...overrides,
});
const accepted = (overrides: Partial<LiveInviteView> = {}) =>
  invite({
    status: 'accepted',
    canAccept: false,
    canDecline: false,
    canCancel: false,
    room: { roomId: 'xq_reserved', url: '/room/xq_reserved', seat: 'black' },
    ...overrides,
  });
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const button = (text: string, host: ParentNode = document) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent === text,
  )!;

describe('site-wide real-time invitations', () => {
  let controller: ReturnType<typeof createLiveInviteController>;
  let incoming: LiveInviteView[];
  let outgoing: LiveInviteView[];
  let fetcher: ReturnType<typeof vi.fn>;
  let navigate: (url: string) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: memoryStorage() });
    replaceAccountPreferences({});
    window.history.replaceState(null, '', '/blog');
    document.body.innerHTML = '<div id="app"></div>';
    incoming = [invite()];
    outgoing = [];
    fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${base}/heartbeat`) return json({ leaseMs: 15_000, pollAfterMs: 5_000 });
      if (url === base) return json({ incoming, outgoing, pollAfterMs: 5_000 });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    navigate = vi.fn();
    controller = createLiveInviteController({ navigate });
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stays idle signed out, then heartbeats and renders all terms safely on any page', async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).not.toHaveBeenCalled();
    controller.setUser('bob');
    await flush();
    const tray = document.querySelector<HTMLElement>('.live-invites')!;
    expect(tray.textContent).toContain('<Alice> (@alice) invited you to play now');
    expect(tray.textContent).toMatch(/Xiangqi.*3:00\+2.*Black.*Rated/);
    expect(tray.querySelector('alice')).toBeNull();
    expect(tray.textContent).toContain('Expires in 50s');
    expect(button('Accept')).toBeDefined();
    expect(button('Decline')).toBeDefined();
    expect(fetcher.mock.calls[0]).toMatchObject([
      `${base}/heartbeat`,
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      },
    ]);
    const firstButton = button('Accept');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(button('Accept')).toBe(firstButton);
    expect(fetcher.mock.calls.filter(([url]) => url === `${base}/heartbeat`)).toHaveLength(2);
  });

  it('survives route content replacement and disables actions exactly at local expiry', async () => {
    controller.setUser('bob');
    await flush();
    document.querySelector('#app')!.replaceChildren(document.createElement('main'));
    window.history.pushState(null, '', '/account/settings');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(button('Accept').disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(button('Accept').disabled).toBe(true);
    expect(document.querySelector('.live-invites')?.textContent).toContain('Invitation expired');
  });

  it('accepts once and takes the recipient to the reserved room without replaying on reload', async () => {
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/accept')) return json({ invite: accepted() });
      if (url.endsWith('/heartbeat')) return json({ leaseMs: 15_000, pollAfterMs: 5_000 });
      return json({ incoming, outgoing });
    });
    controller.setUser('bob');
    await flush();
    button('Accept').click();
    button('Accept').click();
    await flush();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/accept'))).toHaveLength(1);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/room/xq_reserved');
    incoming = [accepted()];
    await vi.advanceTimersByTimeAsync(5_000);
    controller.dispose();
    controller = createLiveInviteController({ navigate });
    controller.setUser('bob');
    await flush();
    expect(navigate).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLAnchorElement>('.live-invite a')?.pathname).toBe(
      '/room/xq_reserved',
    );
  });

  it.each(['declined', 'expired', 'unavailable', 'accepted'] as const)(
    'inspects a missing outgoing offer and renders %s, navigating the sender on acceptance',
    async (status) => {
      const sent = invite({ isMine: true, canAccept: false, canDecline: false, canCancel: true });
      incoming = [];
      outgoing = [sent];
      controller.setUser('alice');
      await flush();
      const host = document.createElement('div');
      document.body.append(host);
      const unmount = controller.mountWaiting(host, sent);
      expect(host.textContent).toContain('you play Red');
      outgoing = [];
      fetcher.mockImplementation(async (url: string) => {
        if (url.endsWith('/heartbeat')) return json({ leaseMs: 15_000 });
        if (url === base) return json({ incoming, outgoing });
        return json({
          invite:
            status === 'accepted'
              ? accepted({ ...sent, status, room: accepted().room })
              : { ...sent, status },
        });
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(host.textContent).toContain(
        status === 'unavailable' ? 'Player unavailable' : `Invitation ${status}`,
      );
      expect(navigate).toHaveBeenCalledTimes(status === 'accepted' ? 1 : 0);
      if (status === 'accepted') expect(navigate).toHaveBeenCalledWith('/room/xq_reserved');
      unmount();
      expect(host.childElementCount).toBe(0);
    },
  );

  it.each([
    { mine: true, label: 'Cancel', method: 'DELETE', suffix: '', status: 'cancelled' },
    { mine: false, label: 'Decline', method: 'POST', suffix: '/decline', status: 'declined' },
  ])(
    'sends $label and displays the terminal outcome',
    async ({ mine, label, method, suffix, status }) => {
      incoming = mine ? [] : [invite()];
      outgoing = mine ? [invite({ isMine: true, canCancel: true })] : [];
      controller.setUser(mine ? 'alice' : 'bob');
      await flush();
      fetcher.mockImplementation(async () =>
        json({ invite: invite({ isMine: mine, status: status as LiveInviteView['status'] }) }),
      );
      button(label).click();
      await flush();
      expect(fetcher).toHaveBeenLastCalledWith(
        `${base}/offer-1${suffix}`,
        expect.objectContaining({ method }),
      );
      expect(document.querySelector('.live-invites')?.textContent).toContain(
        `Invitation ${status}`,
      );
      button('Dismiss').click();
      expect(document.querySelector<HTMLElement>('.live-invites')?.hidden).toBe(true);
    },
  );

  it('does not let a delayed list overwrite a completed action', async () => {
    controller.setUser('bob');
    await flush();
    let resolveList!: (value: Response) => void;
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/heartbeat')) return json({ leaseMs: 15_000 });
      if (url === base)
        return new Promise<Response>((resolve) => {
          resolveList = resolve;
        });
      return json({ invite: accepted() });
    });
    await vi.advanceTimersByTimeAsync(5_000);
    button('Accept').click();
    await flush();
    resolveList(json({ incoming: [invite()], outgoing: [] }));
    await flush();
    expect(document.querySelector('.live-invites')?.textContent).toContain('Invitation accepted');
    expect(button('Accept')).toBeUndefined();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('resolves competing-tab acceptance from a 409 and leaves a 503 retryable', async () => {
    controller.setUser('bob');
    await flush();
    let result = invite();
    fetcher.mockImplementation(async (url: string) =>
      url.endsWith('/accept')
        ? json({ error: 'room_create_failed' }, 503)
        : json({ invite: result }),
    );
    button('Accept').click();
    await flush();
    expect(button('Accept').disabled).toBe(false);
    expect(document.querySelector('.live-invites')?.textContent).toContain('Try again');
    result = accepted();
    fetcher.mockImplementation(async (url: string) =>
      url.endsWith('/accept')
        ? json({ error: 'invite_unavailable' }, 409)
        : json({ invite: result }),
    );
    button('Accept').click();
    await flush();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/room/xq_reserved');
  });

  it('aborts sign-out requests, ignores their late results and clears every timer and waiting host', async () => {
    controller.setUser('bob');
    await flush();
    const host = document.createElement('div');
    controller.mountWaiting(host, invite({ isMine: true }));
    let resolveAction!: (response: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveAction = resolve;
        }),
    );
    // Watch an incoming offer again so Accept is available.
    controller.watch(invite());
    button('Accept').click();
    const signal = fetcher.mock.lastCall![1].signal as AbortSignal;
    controller.setUser(null);
    expect(signal.aborted).toBe(true);
    expect(host.childElementCount).toBe(0);
    resolveAction(json({ invite: accepted() }));
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    const count = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops on 401 and rejects previous-account polling results', async () => {
    let resolveList!: (response: Response) => void;
    fetcher.mockImplementation(async (url: string) =>
      url.endsWith('/heartbeat')
        ? json({ leaseMs: 15_000 })
        : new Promise<Response>((resolve) => {
            resolveList = resolve;
          }),
    );
    controller.setUser('bob');
    await flush();
    const stale = resolveList;
    controller.setUser('carol');
    await flush();
    stale(json({ incoming: [accepted()], outgoing: [] }));
    resolveList(json({ error: 'not_signed_in' }, 401));
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('.live-invites')?.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses on pagehide without revoking other tabs, and resumes after back/forward restore', async () => {
    controller.setUser('bob');
    await flush();
    window.dispatchEvent(new Event('pagehide'));
    expect(vi.getTimerCount()).toBe(0);
    expect(fetcher.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(false);
    const count = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetcher).toHaveBeenCalledTimes(count);
    window.dispatchEvent(new Event('pageshow'));
    await flush();
    expect(fetcher.mock.calls.length).toBe(count + 2);
  });

  it('revalidates cross-tab identity changes and reconciles opt-out independently of bell muting', async () => {
    replaceAccountPreferences({ challengesBell: false });
    controller.setUser('bob');
    await flush();
    expect(button('Accept')).toBeDefined();
    replaceAccountPreferences({ liveInvites: false });
    expect(button('Accept')).toBeUndefined();
    replaceAccountPreferences({ liveInvites: true });
    expect(button('Accept')).toBeDefined();
    fetcher.mockImplementation(async () => json({ user: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'mb_cached_user', newValue: null }));
    await flush();
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/auth/me',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(document.querySelector<HTMLElement>('.live-invites')?.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a transient polling failure visible and recovers on the next heartbeat', async () => {
    controller.setUser('bob');
    await flush();
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(document.querySelector('.live-invites')?.textContent).toContain('Reconnecting');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(document.querySelector('.live-invite-connection')).toBeNull();
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the accepted card once it has taken the player into the room', async () => {
    controller.dispose();
    navigate = vi.fn((url: string) => window.history.pushState(null, '', url));
    controller = createLiveInviteController({ navigate });
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/accept')) return json({ invite: accepted() });
      if (url.endsWith('/heartbeat')) return json({ leaseMs: 15_000, pollAfterMs: 5_000 });
      return json({ incoming, outgoing });
    });
    controller.setUser('bob');
    await flush();
    button('Accept').click();
    await flush();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/room/xq_reserved');
    expect(document.querySelector('.live-invite')).toBeNull();
    incoming = [accepted()];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(document.querySelector('.live-invite')).toBeNull();
    expect(document.querySelector<HTMLElement>('.live-invites')?.hidden).toBe(true);
  });

  it('names a player once when the display name is the handle', async () => {
    incoming = [invite({ sender: { handle: 'player-k3fc4', displayName: 'player-k3fc4' } })];
    controller.setUser('bob');
    await flush();
    const heading = document.querySelector('.live-invite h2')?.textContent ?? '';
    expect(heading).toContain('@player-k3fc4');
    expect(heading.split('player-k3fc4')).toHaveLength(2);
  });

  it('restores a sender offer after navigation and inspects its retained terminal outcome', async () => {
    incoming = [];
    outgoing = [invite({ isMine: true, canCancel: true, canAccept: false, canDecline: false })];
    controller.setUser('alice');
    await flush();
    controller.dispose();
    outgoing = [];
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/heartbeat')) return json({ leaseMs: 15_000 });
      if (url === base) return json({ incoming, outgoing });
      return json({ invite: invite({ isMine: true, status: 'declined' }) });
    });
    controller = createLiveInviteController({ navigate });
    controller.setUser('alice');
    await flush();
    expect(fetcher).toHaveBeenCalledWith(`${base}/offer-1`, expect.anything());
    expect(document.querySelector('.live-invites')?.textContent).toContain('Invitation declined');
  });

  it('keeps known offers through bfcache suspension and inspects expiry on return', async () => {
    controller.setUser('bob');
    await flush();
    window.dispatchEvent(new Event('pagehide'));
    incoming = [];
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/heartbeat')) return json({ leaseMs: 15_000 });
      if (url === base) return json({ incoming, outgoing });
      return json({ invite: invite({ status: 'expired' }) });
    });
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event('pageshow'));
    await flush();
    expect(document.querySelector('.live-invites')?.textContent).toContain('Invitation expired');
  });

  it('does not navigate to a non-room URL and tolerates denied browser storage', async () => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('denied');
      },
    });
    incoming = [
      accepted({
        room: { roomId: 'xq_reserved', url: 'https://elsewhere.example', seat: 'black' },
      }),
    ];
    controller.setUser('bob');
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    expect(document.querySelector('.live-invite a')).toBeNull();
    incoming = [accepted()];
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/room/xq_reserved');
  });

  it.each(['zh-Hans', 'zh-Hant'] as const)(
    'localizes invitation terms and countdown in %s',
    async (locale) => {
      await ensureLocaleCatalog(locale);
      setStoredLocale(locale);
      controller.setUser('bob');
      await flush();
      const text = document.querySelector('.live-invites')!.textContent;
      expect(text).toContain(locale === 'zh-Hans' ? '邀请你立即对局' : '邀請你立即對局');
      expect(text).toContain(locale === 'zh-Hans' ? '60 秒后过期' : '60 秒後過期');
      expect(text).not.toContain('challenge.live');
      expect(text).not.toContain('Rated');
    },
  );
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
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
