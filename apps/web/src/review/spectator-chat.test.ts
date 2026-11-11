import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setResolvedSignedIn } from '../signed-in-state.js';
import { announceLiveRoomSeat, buildLiveRoomChat, buildSpectatorChat } from './spectator-chat.js';

describe('live room chat', () => {
  beforeEach(() => setResolvedSignedIn(true));
  afterEach(() => {
    document.body.replaceChildren();
    setResolvedSignedIn(undefined);
    vi.unstubAllGlobals();
  });

  it('talks in the seat-gated player room, not the spectator room', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        return jsonResponse({
          lines: [],
          canPost: true,
          canReport: true,
          viewerHandle: 'misty',
        });
      }
      const body = JSON.parse(String(init.body)) as { text: string };
      return jsonResponse(
        {
          line: {
            id: 'chln_quick_1',
            handle: 'misty',
            text: body.text,
            createdAt: '2026-07-14T12:00:00.000Z',
          },
        },
        201,
      );
    });
    vi.stubGlobal('fetch', fetchSpy);

    announceLiveRoomSeat('room with spaces', true);
    const panel = buildLiveRoomChat('room with spaces');
    document.body.append(panel);
    await flushPromises();

    expect(panel.getAttribute('aria-label')).toBe('Game chat');
    expect(panel.textContent).toContain('Chat room');
    expect(panel.querySelector('[role="separator"][aria-label="Resize chat"]')).not.toBeNull();
    expect(
      buildSpectatorChat('room with spaces').querySelector(
        '[role="separator"][aria-label="Resize chat"]',
      ),
    ).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith('/api/chat/player/room%20with%20spaces');
    expect(
      Array.from(panel.querySelectorAll<HTMLButtonElement>('.review-spectator-chat__quick-button'))
        .map((button) => button.textContent)
        .join(','),
    ).toBe('GG,WP,TY,GTG,BYE');

    panel.querySelector<HTMLButtonElement>('.review-spectator-chat__quick-button')?.click();
    await flushPromises();

    // The player line posts to the player room. If this ever posts to
    // /api/chat/game/ the two players' conversation leaks into the spectator
    // room the review page serves — the exact bug this split exists to fix.
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/chat/player/room%20with%20spaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'GG' }),
    });
    expect(panel.textContent).toContain('misty');
    expect(panel.textContent).toContain('GG');
  });

  it('demotes a viewer the seat gate refuses to the spectator room', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/chat/player/')) {
        return jsonResponse({ error: 'not_a_player' }, 403);
      }
      return jsonResponse({
        lines: [
          {
            id: 'chln_spec_1',
            handle: 'watcher',
            text: 'nice game',
            createdAt: '2026-07-14T12:00:00.000Z',
          },
        ],
        canPost: true,
        canReport: true,
        viewerHandle: 'watcher',
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    // Seated by the hello but refused anyway (a signed-out seat, a revoked one).
    announceLiveRoomSeat('bq_1', true);
    const panel = buildLiveRoomChat('bq_1');
    document.body.append(panel);
    await flushPromises();

    expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/chat/player/bq_1',
      '/api/chat/game/bq_1',
    ]);
    expect(panel.textContent).toContain('Spectator room');
    expect(panel.textContent).toContain('nice game');
    // Quick chat is a player affordance; a demoted spectator does not get it.
    expect(panel.querySelector('.review-spectator-chat__quick-button')).toBeNull();
  });

  it('waits for the hello before probing the player room, so a new seat is not refused', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ lines: [], canPost: true, canReport: true, viewerHandle: 'misty' }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const panel = buildLiveRoomChat('xmj_new');
    document.body.append(panel);
    await flushPromises();
    // Before the hello, the seat may not be in the database yet: a probe now
    // is the 403 a brand-new room's own player used to get.
    expect(fetchSpy).not.toHaveBeenCalled();

    announceLiveRoomSeat('some_other_room', true);
    await flushPromises();
    expect(fetchSpy).not.toHaveBeenCalled();

    announceLiveRoomSeat('xmj_new', true);
    await flushPromises();
    expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/chat/player/xmj_new',
    ]);
    expect(panel.textContent).toContain('Chat room');
  });

  it('sends a viewer the hello names a spectator straight to the spectator room', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ lines: [], canPost: true, canReport: true, viewerHandle: 'watcher' }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const panel = buildLiveRoomChat('xmj_watch');
    document.body.append(panel);
    announceLiveRoomSeat('xmj_watch', false);
    await flushPromises();

    expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/chat/game/xmj_watch',
    ]);
    expect(panel.textContent).toContain('Spectator room');
  });

  it('probes the player room anyway when no hello arrives', async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.fn(async (_input: RequestInfo | URL) =>
        jsonResponse({ lines: [], canPost: true, canReport: true, viewerHandle: 'misty' }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      document.body.append(buildLiveRoomChat('xmj_silent'));
      await vi.advanceTimersByTimeAsync(4_999);
      expect(fetchSpy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toEqual([
        '/api/chat/player/xmj_silent',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('player chat polling authentication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('MODE', 'development');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    setResolvedSignedIn(false);
  });

  afterEach(async () => {
    document.body.replaceChildren();
    await Promise.resolve();
    setResolvedSignedIn(undefined);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mount(
    roomId: string,
    fetchSpy = vi.fn(async (_url: string) =>
      jsonResponse({
        lines: [],
        canPost: true,
        canReport: true,
        viewerHandle: 'player',
      }),
    ),
  ) {
    vi.stubGlobal('fetch', fetchSpy);
    announceLiveRoomSeat(roomId, true);
    const panel = buildLiveRoomChat(roomId);
    document.body.append(panel);
    return { panel, fetchSpy };
  }

  const playerRequests = (fetchSpy: ReturnType<typeof vi.fn>) =>
    fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('/api/chat/player/'));

  it('never requests player chat while signed out, even with a seat', async () => {
    const { fetchSpy } = mount('guest_seat');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(playerRequests(fetchSpy)).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledWith('/api/chat/game/guest_seat');
  });

  it('waits for confirmed auth even when the saved sign-in hint is stale', async () => {
    setResolvedSignedIn(undefined);
    vi.stubGlobal('localStorage', { getItem: () => '1' });
    const { fetchSpy } = mount('unresolved_guest');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(playerRequests(fetchSpy)).toHaveLength(0);
    setResolvedSignedIn(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playerRequests(fetchSpy)).toHaveLength(0);
  });

  it('starts on sign-in, stops on sign-out, and restarts after signing in again', async () => {
    const { fetchSpy } = mount('auth_changes');
    await vi.advanceTimersByTimeAsync(0);
    setResolvedSignedIn(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(playerRequests(fetchSpy).length).toBeGreaterThan(1);
    setResolvedSignedIn(false);
    const count = playerRequests(fetchSpy).length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(playerRequests(fetchSpy)).toHaveLength(count);
    setResolvedSignedIn(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(playerRequests(fetchSpy)).toHaveLength(count + 1);
  });

  it.each(['initial load', 'timer poll', 'promotion'] as const)(
    'stops polling after a 401 during %s until a new sign-in',
    async (phase) => {
      setResolvedSignedIn(true);
      let requests = 0;
      const fetchSpy = vi.fn(async (url: string) => {
        if (!url.startsWith('/api/chat/player/'))
          return jsonResponse({ lines: [], canPost: false });
        requests += 1;
        if (phase === 'initial load' || requests > 1) return jsonResponse({}, 401);
        if (phase === 'promotion') return jsonResponse({}, 403);
        return jsonResponse({ lines: [], canPost: true });
      });
      mount(`expired_${phase}`, fetchSpy);
      await vi.advanceTimersByTimeAsync(20_000);
      const expected = phase === 'initial load' ? 1 : 2;
      expect(playerRequests(fetchSpy)).toHaveLength(expected);
      const total = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchSpy).toHaveBeenCalledTimes(total);
      setResolvedSignedIn(true);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(playerRequests(fetchSpy)).toHaveLength(expected);
      setResolvedSignedIn(false);
      setResolvedSignedIn(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(playerRequests(fetchSpy)).toHaveLength(expected + 1);
    },
  );

  it('does not request player chat if signed out while waiting for the seat', async () => {
    setResolvedSignedIn(true);
    const fetchSpy = vi.fn(async () => jsonResponse({ lines: [], canPost: false }));
    vi.stubGlobal('fetch', fetchSpy);
    document.body.append(buildLiveRoomChat('signout_before_hello'));
    setResolvedSignedIn(false);
    announceLiveRoomSeat('signout_before_hello', true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playerRequests(fetchSpy)).toHaveLength(0);
  });

  it('ignores player responses that arrive after sign-out', async () => {
    setResolvedSignedIn(true);
    let resolvePlayer!: (response: Response) => void;
    const fetchSpy = vi.fn((url: string) =>
      url.startsWith('/api/chat/player/')
        ? new Promise<Response>((resolve) => {
            resolvePlayer = resolve;
          })
        : Promise.resolve(jsonResponse({ lines: [], canPost: false })),
    );
    const { panel } = mount('pending_signout', fetchSpy);
    await vi.advanceTimersByTimeAsync(0);
    setResolvedSignedIn(false);
    resolvePlayer(
      jsonResponse({
        lines: [{ id: 'private', handle: 'player', text: 'private message', createdAt: '' }],
        canPost: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(panel.textContent).not.toContain('private message');
    expect(panel.querySelector('form')).toBeNull();
    expect(playerRequests(fetchSpy)).toHaveLength(1);
  });
});
