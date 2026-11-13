import assert from 'node:assert/strict';
import test from 'node:test';
import { seedBroadcastDiscoveryFixture } from './broadcast-discovery-test-support.js';
import { definePersistenceTests } from './persistence-test-support.js';
import { broadcastSitemapEntries, listBroadcastRoundDates } from './sitemap-broadcasts.js';

definePersistenceTests('broadcast sitemap discovery', () => {
  test('unlisted live and completed boards never produce sitemap entries', async () => {
    const { tours } = await seedBroadcastDiscoveryFixture();
    const dates = await listBroadcastRoundDates();
    assert.deepEqual(
      dates.map((date) => date.tourSlug),
      [tours[0]!.slug],
    );
    const entries = broadcastSitemapEntries(dates);
    assert.ok(entries.some((entry) => entry.path.endsWith(tours[0]!.slug)));
    assert.ok(!JSON.stringify(entries).includes(tours[1]!.slug));
  });
});

test('the broadcasts sitemap lists each event and round, dated from its latest game', () => {
  const entries = broadcastSitemapEntries([
    {
      tourSlug: '2026-xiangqi-league',
      roundId: '2026-xiangqi-league-r01',
      lastGameAt: new Date('2026-04-02T12:00:00Z'),
    },
    {
      tourSlug: '2026-xiangqi-league',
      roundId: '2026-xiangqi-league-r02',
      lastGameAt: new Date('2026-04-09T23:30:00Z'),
    },
    {
      tourSlug: '2026-shanghai-cup',
      roundId: '2026-shanghai-cup-r01',
      lastGameAt: new Date('2026-09-21T08:00:00Z'),
    },
  ]);
  assert.deepEqual(entries, [
    { path: '/broadcast/xiangqi', lastmod: '2026-09-21' },
    { path: '/broadcast/xiangqi/2026-shanghai-cup', lastmod: '2026-09-21' },
    {
      path: '/broadcast/xiangqi/2026-shanghai-cup/round/2026-shanghai-cup-r01',
      lastmod: '2026-09-21',
    },
    { path: '/broadcast/xiangqi/2026-xiangqi-league', lastmod: '2026-04-09' },
    {
      path: '/broadcast/xiangqi/2026-xiangqi-league/round/2026-xiangqi-league-r01',
      lastmod: '2026-04-02',
    },
    {
      path: '/broadcast/xiangqi/2026-xiangqi-league/round/2026-xiangqi-league-r02',
      lastmod: '2026-04-09',
    },
  ]);
});

test('an archive with no started games lists only the index, undated', () => {
  assert.deepEqual(broadcastSitemapEntries([]), [
    { path: '/broadcast/xiangqi', lastmod: undefined },
  ]);
});
