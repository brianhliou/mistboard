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
