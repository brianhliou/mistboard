import { afterEach, describe, expect, it, vi } from 'vitest';
import { postThroughRestart, RESTART_WAIT_LIMIT_MS } from './room-create-retry.js';

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
