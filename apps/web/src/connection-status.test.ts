import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionStatus,
  pingUrlsForSocketBases,
  resolvePingUrls,
} from './connection-status.js';

describe('ping URL resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('times the socket host first in prod, with the page origin as fallback', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_MISTBOARD_WS_URL', 'wss://socket.mistboard.com');
    expect(resolvePingUrls()).toEqual(['https://socket.mistboard.com/api/ping', '/api/ping']);
  });

  it('stays same-origin in dev', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_MISTBOARD_WS_URL', 'ws://localhost:3001');
    expect(resolvePingUrls()).toEqual(['/api/ping']);
  });

  it('collapses a socket host that is the page origin to the relative path', () => {
    expect(
      pingUrlsForSocketBases(['wss://mistboard.com', 'wss://mistboard.com'], 'mistboard.com'),
    ).toEqual(['/api/ping']);
    expect(pingUrlsForSocketBases(['ws://127.0.0.1:3001'], 'mistboard.com')).toEqual([
      'http://127.0.0.1:3001/api/ping',
    ]);
  });
});

describe('connection status footer', () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_MISTBOARD_WS_URL', 'wss://socket.mistboard.com');
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubFetch(handler: (url: string) => Promise<Response>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return handler(url);
      }),
    );
  }

  const ok = () => Promise.resolve(new Response(JSON.stringify({ now: 0, lagMs: 3 })));

  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('pings the socket host without cookies and drops the connection-setup sample', async () => {
    stubFetch(ok);
    const status = createConnectionStatus();
    status.start();
    await settle();
    status.stop();
    expect(calls.map((c) => c.url)).toEqual([
      'https://socket.mistboard.com/api/ping',
      'https://socket.mistboard.com/api/ping',
    ]);
    expect(calls[0]?.init?.credentials).toBe('omit');
    expect(calls[0]?.init?.cache).toBe('no-store');
    expect(calls[0]?.init?.headers).toBeUndefined();
    expect(status.element.querySelectorAll('.account-nav-status-value')[1]?.textContent).toBe('3');
  });

  it('falls back to the page origin when the socket host fails', async () => {
    stubFetch((url) =>
      url.startsWith('https://socket.') ? Promise.reject(new TypeError('blocked')) : ok(),
    );
    const status = createConnectionStatus();
    status.start();
    await settle();
    status.stop();
    expect(calls.map((c) => c.url)).toEqual([
      'https://socket.mistboard.com/api/ping',
      '/api/ping',
      '/api/ping',
    ]);
    expect(status.element.querySelectorAll('.account-nav-status-value')[1]?.textContent).toBe('3');
  });

  it('starts on the page origin when the game socket in this tab already fell back', async () => {
    window.sessionStorage.setItem('mistboard.socket.host', 'fallback');
    stubFetch(ok);
    const status = createConnectionStatus();
    status.start();
    await settle();
    status.stop();
    expect(calls.map((c) => c.url)).toEqual(['/api/ping', '/api/ping']);
  });
});
