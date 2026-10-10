import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLiveStats,
  LIVE_STATS_MAX_AGE_MS,
  resetLiveStatsCacheForTests,
} from './live-stats-client.js';

describe('fetchLiveStats', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetLiveStatsCacheForTests();
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ playing: 2, playingBySpec: { xiangqi: 2 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLiveStatsCacheForTests();
  });

  it('serves the homepage widgets from one request per window', async () => {
    // The activity block, the play panel and the showcase each read live
    // stats on their own timer; within one window they share a request.
    let now = 1_000;
    const clock = () => now;
    const [a, b] = await Promise.all([
      fetchLiveStats({ now: clock }),
      fetchLiveStats({ now: clock }),
    ]);
    now += LIVE_STATS_MAX_AGE_MS - 1;
    const c = await fetchLiveStats({ now: clock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a?.playing).toBe(2);
    expect(b?.playingBySpec).toEqual({ xiangqi: 2 });
    expect(c?.playing).toBe(2);

    now += 1;
    await fetchLiveStats({ now: clock });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets a faster poller ask for a fresher read', async () => {
    let now = 1_000;
    const clock = () => now;
    await fetchLiveStats({ now: clock, maxAgeMs: 10 });
    now += 10;
    await fetchLiveStats({ now: clock, maxAgeMs: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // ...and the slower widgets reuse that fresh read.
    now += 1_000;
    await fetchLiveStats({ now: clock });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('nope', { status: 503 }));
    const clock = () => 5_000;
    expect(await fetchLiveStats({ now: clock })).toBeNull();
    expect((await fetchLiveStats({ now: clock }))?.playing).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
