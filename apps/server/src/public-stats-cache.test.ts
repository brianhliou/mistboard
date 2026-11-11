import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { PublicSiteStats } from './persistence.js';
import {
  clearPublicStatsCache,
  getCachedPublicStats,
  PUBLIC_STATS_CACHE_MS,
} from './public-stats-cache.js';

const stats = (total: number) => ({ totalCompletedGames: total }) as unknown as PublicSiteStats;

beforeEach(() => clearPublicStatsCache());

test('reads the database once per cache window, however many callers', async () => {
  let loads = 0;
  const load = async () => {
    loads += 1;
    return stats(1395);
  };
  const results = await Promise.all([
    getCachedPublicStats(0, load),
    getCachedPublicStats(0, load),
    getCachedPublicStats(1_000, load),
  ]);
  assert.equal(loads, 1);
  for (const value of results) assert.deepEqual(value, stats(1395));
  assert.deepEqual(await getCachedPublicStats(PUBLIC_STATS_CACHE_MS - 1, load), stats(1395));
  assert.equal(loads, 1);
});

test('an expired read answers at once with the old value and refreshes behind it', async () => {
  await getCachedPublicStats(0, async () => stats(1395));
  let release: (value: PublicSiteStats) => void = () => {};
  let loads = 0;
  const slow = () => {
    loads += 1;
    return new Promise<PublicSiteStats>((resolve) => {
      release = resolve;
    });
  };
  // The slow query has not finished, yet both callers get the cached value.
  assert.deepEqual(await getCachedPublicStats(PUBLIC_STATS_CACHE_MS, slow), stats(1395));
  assert.deepEqual(await getCachedPublicStats(PUBLIC_STATS_CACHE_MS + 1, slow), stats(1395));
  assert.equal(loads, 1);
  release(stats(1400));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await getCachedPublicStats(PUBLIC_STATS_CACHE_MS + 2, slow), stats(1400));
  assert.equal(loads, 1);
});

test('a failed refresh keeps serving the last good value', async () => {
  await getCachedPublicStats(0, async () => stats(1395));
  const failing = async (): Promise<PublicSiteStats> => {
    throw new Error('db down');
  };
  assert.deepEqual(await getCachedPublicStats(PUBLIC_STATS_CACHE_MS, failing), stats(1395));
  await new Promise((resolve) => setImmediate(resolve));
  // The failure did not refresh the timestamp: the next call reads again.
  let loads = 0;
  await getCachedPublicStats(PUBLIC_STATS_CACHE_MS + 1, async () => {
    loads += 1;
    return stats(1400);
  });
  assert.equal(loads, 1);
});

test('a failed first read returns null', async () => {
  assert.equal(
    await getCachedPublicStats(0, async () => {
      throw new Error('db down');
    }),
    null,
  );
});

test('stale reads stop answering immediately at the 15-minute age boundary', async () => {
  await getCachedPublicStats(0, async () => stats(1395));
  let release: (value: PublicSiteStats) => void = () => {};
  let loads = 0;
  const slow = () => {
    loads += 1;
    return new Promise<PublicSiteStats>((resolve) => {
      release = resolve;
    });
  };
  const maxAge = 15 * 60_000;
  assert.deepEqual(await getCachedPublicStats(maxAge - 1, slow), stats(1395));
  let answered = false;
  const atBoundary = getCachedPublicStats(maxAge, slow).then((value) => {
    answered = true;
    return value;
  });
  const afterBoundary = getCachedPublicStats(maxAge + 1, slow);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, false);
  assert.equal(loads, 1);
  release(stats(1400));
  assert.deepEqual(await atBoundary, stats(1400));
  assert.deepEqual(await afterBoundary, stats(1400));
});

test('an hours-old value waits for one shared read and falls back on failure without renewing age', async () => {
  await getCachedPublicStats(0, async () => stats(1395));
  const now = 3 * 60 * 60_000;
  let reject: (error: Error) => void = () => {};
  let loads = 0;
  const failing = () => {
    loads += 1;
    return new Promise<PublicSiteStats>((_resolve, rejectRead) => {
      reject = rejectRead;
    });
  };
  let answered = false;
  const first = getCachedPublicStats(now, failing).then((value) => {
    answered = true;
    return value;
  });
  const second = getCachedPublicStats(now, failing);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, false);
  assert.equal(loads, 1);
  reject(new Error('db down'));
  assert.deepEqual(await first, stats(1395));
  assert.deepEqual(await second, stats(1395));
  assert.deepEqual(await getCachedPublicStats(now + 1, async () => stats(1400)), stats(1400));
});
