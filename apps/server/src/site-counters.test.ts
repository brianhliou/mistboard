import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { SiteGameTotals } from './persistence.js';
import {
  clearSiteTotalsCache,
  getCachedSiteTotals,
  SITE_TOTALS_CACHE_MS,
} from './site-counters.js';

const totals = (total: number): SiteGameTotals => ({
  totalCompletedGames: total,
  last30dCompletedGames: total - 100,
});

beforeEach(() => clearSiteTotalsCache());

test('reads the database once per cache window, however many callers', async () => {
  let loads = 0;
  const load = async () => {
    loads += 1;
    return totals(1395);
  };
  const results = await Promise.all([
    getCachedSiteTotals(0, load),
    getCachedSiteTotals(0, load),
    getCachedSiteTotals(1_000, load),
  ]);
  assert.equal(loads, 1);
  for (const value of results) assert.deepEqual(value, totals(1395));
  assert.deepEqual(await getCachedSiteTotals(SITE_TOTALS_CACHE_MS - 1, load), totals(1395));
  assert.equal(loads, 1);
});

test('re-reads once the window has passed', async () => {
  let next = 1395;
  const load = async () => totals(next);
  await getCachedSiteTotals(0, load);
  next = 1396;
  assert.deepEqual(await getCachedSiteTotals(SITE_TOTALS_CACHE_MS, load), totals(1396));
});

test('a failed read keeps serving the last good totals and is not cached', async () => {
  await getCachedSiteTotals(0, async () => totals(1395));
  const failing = async (): Promise<SiteGameTotals> => {
    throw new Error('db down');
  };
  assert.deepEqual(await getCachedSiteTotals(SITE_TOTALS_CACHE_MS, failing), totals(1395));
  // The failure did not refresh the cache timestamp: the next call reads again.
  assert.deepEqual(
    await getCachedSiteTotals(SITE_TOTALS_CACHE_MS + 1, async () => totals(1400)),
    totals(1400),
  );
});

test('a failed first read returns null', async () => {
  assert.equal(
    await getCachedSiteTotals(0, async () => {
      throw new Error('db down');
    }),
    null,
  );
});
