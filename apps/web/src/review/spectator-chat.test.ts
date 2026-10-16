import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLiveRoomChat, buildSpectatorChat } from './spectator-chat.js';

describe('live room chat', () => {
  afterEach(() => {
    document.body.replaceChildren();
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

    const panel = buildLiveRoomChat('room with spaces');
    document.body.append(panel);
    await flushPromises();

    expect(panel.getAttribute('aria-label')).toBe('Game chat');
    expect(panel.textContent).toContain('Chat room');
    // No resize handle in the live room: its rail flex-fills the chat to the
    // board line, so the drag did nothing (Brian, 2026-10-02). The review
    // page's spectator room keeps it, where a drag does resize the panel.
    expect(panel.querySelector('[role="separator"][aria-label="Resize chat"]')).toBeNull();
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
