import assert from 'node:assert/strict';
import test from 'node:test';
import { broadcastSitemapEntries } from './sitemap-broadcasts.js';

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
