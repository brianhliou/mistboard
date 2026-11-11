import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  postThroughRestart,
  postWithBrowserIdentity,
  RESTART_WAIT_LIMIT_MS,
} from './room-create-retry.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(steps: Array<Response | Error>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    const step = steps.shift();
    if (!step) throw new Error('no more steps');
    if (step instanceof Error) throw step;
    return step;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const noSleep = async () => {};

describe('postThroughRestart', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the guest browser identity on a room POST, unchanged through a restart', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'mistboard.device' ? 'guest-browser-776' : null),
      setItem: vi.fn(),
    });
    const received: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        received.push(new Headers(init.headers).get('x-mistboard-device-id'));
        return received.length === 1
          ? json(503, { error: 'server_draining' })
          : json(201, { deviceId: received.at(-1) });
      }),
    );

    const response = await postThroughRestart(
      '/api/rooms',
      { method: 'POST', body: JSON.stringify({ mode: 'pvp' }) },
      { sleep: noSleep },
    );
    expect(await response.json()).toEqual({ deviceId: 'guest-browser-776' });
    expect(received).toEqual(['guest-browser-776', 'guest-browser-776']);
  });

  it('adds the same browser id to lobby POSTs and preserves caller headers and options', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'guest-browser-776',
      setItem: vi.fn(),
    });
    const fetchMock = stubFetch([json(202, { ticketId: 'waiting' })]);
    const init = {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'keep-me' }),
      body: JSON.stringify({ gameSpecId: 'jieqi' }),
      signal: new AbortController().signal,
      keepalive: true,
    };
    await postWithBrowserIdentity('/api/lobby', init);
    expect(fetchMock).toHaveBeenCalledWith('/api/lobby', {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'keep-me',
        'x-mistboard-device-id': 'guest-browser-776',
      },
    });
    expect(init.headers.has('x-mistboard-device-id')).toBe(false);
  });

  it('keeps room creation working when browser storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    });
    const fetchMock = stubFetch([json(201, { url: '/room/no-storage' })]);
    const init = { method: 'POST', headers: { 'content-type': 'application/json' } };
    await postThroughRestart('/api/rooms', init);
    expect(fetchMock).toHaveBeenCalledWith('/api/rooms', init);
  });

  it('waits out a drain and the restart gap, then returns the created room', async () => {
    const fetchMock = stubFetch([
      json(503, { error: 'server_draining' }),
      json(503, { error: 'server_draining' }),
      new TypeError('fetch failed'),
      json(502, {}),
      json(201, { url: '/room/abc' }),
    ]);
    const onRestarting = vi.fn();
    const res = await postThroughRestart(
      '/api/rooms',
      { method: 'POST' },
      { onRestarting, sleep: noSleep },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: '/room/abc' });
    expect(onRestarting).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('returns an ordinary failure untouched, body still readable', async () => {
    stubFetch([json(503, { error: 'engine_busy' })]);
    const res = await postThroughRestart('/api/rooms', { method: 'POST' }, { sleep: noSleep });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'engine_busy' });
  });

  it('does not swallow a network error when no restart is under way', async () => {
    stubFetch([new TypeError('fetch failed')]);
    await expect(
      postThroughRestart('/api/rooms', { method: 'POST' }, { sleep: noSleep }),
    ).rejects.toThrow('fetch failed');
  });

  it('gives up at the wait limit with the last refusal', async () => {
    stubFetch(Array.from({ length: 5 }, () => json(503, { error: 'server_draining' })));
    let t = 0;
    const res = await postThroughRestart(
      '/api/rooms',
      { method: 'POST' },
      {
        sleep: async () => {
          t += RESTART_WAIT_LIMIT_MS / 2;
        },
        now: () => t,
      },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'server_draining' });
  });

  it('stops waiting when the caller is gone', async () => {
    const fetchMock = stubFetch([
      json(503, { error: 'server_draining' }),
      json(201, { url: '/x' }),
    ]);
    const res = await postThroughRestart(
      '/api/rooms',
      { method: 'POST' },
      { sleep: noSleep, isActive: () => false },
    );
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
