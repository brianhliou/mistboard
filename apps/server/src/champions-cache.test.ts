import assert from 'node:assert/strict';
import { test } from 'node:test';
import { close, getPool, init } from './persistence-db.js';
import * as leaderboards from './persistence-leaderboards.js';

test('champion reads coalesce, expire, and protect the shared result from callers', async (t) => {
  init('postgres://localhost/champion_cache_test');
  t.after(close);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let calls = 0;
  t.mock.method(getPool(), 'query', async () => {
    calls++;
    return {
      rows: [{ user_id: 'winner', handle: 'winner', variant: 'xiangqi', time_class: 'blitz' }],
    };
  });

  const expected = [{ userId: 'winner', handle: 'winner', variant: 'xiangqi', timeClass: 'blitz' }];
  const [first, second] = await Promise.all([
    leaderboards.getChampions(),
    leaderboards.getChampions(),
  ]);
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.equal(calls, 1, 'simultaneous readers share one database query');
  first[0]!.handle = 'changed-by-caller';
  first.length = 0;
  assert.deepEqual(await leaderboards.getChampions(), expected);
  assert.equal(calls, 1, 'the brief cache serves later reads');
  t.mock.timers.tick(30_001);
  assert.deepEqual(await leaderboards.getChampions(), expected);
  assert.equal(calls, 2, 'an expired read recomputes champions');
});

test('failed champion refreshes reject without extending stale crowns and can retry', async (t) => {
  init('postgres://localhost/champion_cache_test');
  t.after(close);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let fail = false;
  let calls = 0;
  t.mock.method(getPool(), 'query', async () => {
    calls++;
    if (fail) throw new Error('database unavailable');
    return { rows: [] };
  });
  assert.deepEqual(await leaderboards.getChampions(), []);
  fail = true;
  t.mock.timers.tick(30_001);
  await assert.rejects(leaderboards.getChampions(), /database unavailable/);
  fail = false;
  assert.deepEqual(await leaderboards.getChampions(), []);
  assert.equal(calls, 3);
});

test('single-ladder and summary reads reuse all champion ladders without exposing user ids', async (t) => {
  init('postgres://localhost/champion_cache_test');
  t.after(close);
  const rows = [
    {
      variant: 'xiangqi',
      rank: '1',
      handle: 'winner',
      display_name: 'Winner',
      title: null,
      elo_rating: 1800,
      rating_deviation: 60,
      games_played: 20,
    },
    {
      variant: 'xiangqi',
      rank: '2',
      handle: 'other',
      display_name: 'Other',
      title: null,
      elo_rating: 1700,
      rating_deviation: 60,
      games_played: 20,
    },
  ];
  let championQueries = 0;
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (!sql.includes('eligible_count')) return { rows };
    championQueries++;
    return {
      rows: [
        { user_id: 'winner-id', handle: 'winner', variant: 'xiangqi', time_class: 'blitz' },
        { user_id: 'winner-id', handle: 'winner', variant: 'jieqi', time_class: 'correspondence' },
      ],
    };
  });
  const board = await leaderboards.getLeaderboard({ variant: 'xiangqi', timeClass: 'blitz' });
  const summary = await leaderboards.getLeaderboardSummary({ timeClass: 'blitz' });
  assert.deepEqual(summary, [{ variant: 'xiangqi', leaderboard: board }]);
  assert.deepEqual(board[0]!.champions, [
    { variant: 'xiangqi', timeClass: 'blitz' },
    { variant: 'jieqi', timeClass: 'correspondence' },
  ]);
  assert.deepEqual(board[1]!.champions, []);
  assert.doesNotMatch(JSON.stringify(board), /winner-id|userId/);
  assert.equal(championQueries, 1);
});
