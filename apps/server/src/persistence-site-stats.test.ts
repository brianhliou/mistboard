import { createUser, getPublicSiteStats, getSiteStats } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('site stats', () => {
  test('getPublicSiteStats returns public-safe completed game aggregates', async () => {
    // Every date sits after STATS_COUNTED_FROM (2026-06-01); one game before
    // it proves the launch date filter.
    const now = new Date('2026-07-29T12:00:00.000Z');
    const weekOne = new Date('2026-06-08T12:00:00.000Z');
    const weekTwo = new Date('2026-07-14T12:00:00.000Z');
    const recent = new Date('2026-07-29T11:00:00.000Z');
    const preLaunch = new Date('2026-05-20T12:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('stats-pvp-old', 'dark-chess', 'white-wins', 'king-captured', 30, $1, $1,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('stats-pve-old', 'dark-chess', 'black-wins', 'timeout', 22, $1, $1,
            'human', 'engine', NULL, NULL, 'pve', 'completed', 'link'),
           ('stats-eve-recent', 'dark-chess', 'draw', 'truncated', 40, $2, $2,
            'engine:white', 'engine:black', 'White Engine', 'Black Engine', 'eve', 'completed', 'unlisted'),
           ('stats-pvp-recent', 'dark-chess', 'black-wins', 'resignation', 18, $3, $3,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'private'),
           ('stats-xiangqi-recent', 'xiangqi', 'red-wins', 'resignation', 44, $3, $3,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('stats-imported', 'dark-chess', 'white-wins', 'resignation', 50, $3, $3,
            'white', 'black', NULL, NULL, 'imported', 'completed', 'public'),
           ('stats-running', 'dark-chess', NULL, NULL, 0, $3, NULL,
            'white', 'black', NULL, NULL, 'pvp', 'running', 'public'),
           ('stats-aborted', 'dark-chess', NULL, 'abandoned', 0, $3, $3,
            'white', 'black', NULL, NULL, 'pve', 'aborted', 'public'),
           ('stats-internal', 'xiangqi', 'red-wins', 'resignation', 44, $3, $3,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('stats-pre-launch', 'dark-chess', 'white-wins', 'resignation', 12, $4, $4,
            'white', 'black', NULL, NULL, 'pve', 'completed', 'public')`,
        [weekOne, weekTwo, recent, preLaunch],
      );
      // An operator account excluded from statistics: its completed public
      // game must leave every public figure, including the variant split and
      // the daily series, while staying in the games table.
      await client.query(
        `INSERT INTO users (id, email, handle, display_name, stats_excluded_at)
         VALUES ('stats-operator', 'op@example.com', 'op', 'Op', now())`,
      );
      await client.query(
        `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name)
         VALUES ('stats-internal', 'white', 'user', 'stats-operator', 'Op')`,
      );
    } finally {
      await client.end();
    }

    const stats = await getPublicSiteStats({ now });

    assert.equal(stats.generatedAt, now.toISOString());
    // The excluded operator is not a registered account here.
    assert.equal(stats.accounts, 0);
    assert.equal(stats.weeklyCompletedGames.length, 26);
    assert.equal(stats.weeklyCompletedGames.at(-1)?.weekStart, '2026-07-27');
    // weekOne (04-06, a Monday) and the two `recent` games (05-29, the
    // current week); the weekTwo game is EvE and the internal one is excluded,
    // so neither week shows.
    assert.deepEqual(
      stats.weeklyCompletedGames.filter((w) => w.completedGames > 0),
      [
        { weekStart: '2026-06-08', completedGames: 2 },
        { weekStart: '2026-07-27', completedGames: 2 },
      ],
    );
    assert.equal(stats.totalCompletedGames, 4);
    assert.equal(stats.last30dCompletedGames, 2);
    assert.equal(stats.publicGames, 2);
    assert.deepEqual(stats.modeTotals, { pvp: 3, pve: 1, eve: 1 });
    // Variant split covers the same completed pvp/pve scope as the totals.
    assert.deepEqual(stats.variantTotals, [
      { variant: 'dark-chess', count: 3 },
      { variant: 'xiangqi', count: 1 },
    ]);
    assert.equal(stats.dailyCompletedGames.length, 52);
    assert.deepEqual(stats.dailyCompletedGames[0], {
      date: '2026-06-08',
      completedGames: 2,
      cumulativeGames: 2,
    });
    assert.deepEqual(stats.dailyCompletedGames[36], {
      date: '2026-07-14',
      completedGames: 0,
      cumulativeGames: 2,
    });
    assert.deepEqual(stats.dailyCompletedGames.at(-1), {
      date: '2026-07-29',
      completedGames: 2,
      cumulativeGames: 4,
    });

    // Per-variant series ride the same 54-day axis, most-played first, each with
    // its own cumulative running total.
    assert.deepEqual(
      stats.variantDaily.map((v) => ({ variant: v.variant, total: v.total, days: v.days.length })),
      [
        { variant: 'dark-chess', total: 3, days: 52 },
        { variant: 'xiangqi', total: 1, days: 52 },
      ],
    );
    const darkChess = stats.variantDaily.find((v) => v.variant === 'dark-chess');
    assert.deepEqual(darkChess?.days[0], {
      date: '2026-06-08',
      completedGames: 2,
      cumulativeGames: 2,
    });
    assert.deepEqual(darkChess?.days.at(-1), {
      date: '2026-07-29',
      completedGames: 1,
      cumulativeGames: 3,
    });
    const xiangqi = stats.variantDaily.find((v) => v.variant === 'xiangqi');
    assert.deepEqual(xiangqi?.days[0], {
      date: '2026-06-08',
      completedGames: 0,
      cumulativeGames: 0,
    });
    assert.deepEqual(xiangqi?.days.at(-1), {
      date: '2026-07-29',
      completedGames: 1,
      cumulativeGames: 1,
    });
  });

  test('getSiteStats counts accounts and their recent growth', async () => {
    const day = 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    // One account today (in both windows), one 10 days ago (30d only), one 40
    // days ago (neither) — offsets clear of the 7d/30d boundaries.
    await createUser({
      id: 'stats-user-fresh',
      email: 'fresh@example.com',
      emailVerifiedAt: null,
      handle: 'fresh',
      displayName: 'Fresh',
      now: new Date(nowMs),
    });
    await createUser({
      id: 'stats-user-recent',
      email: 'recent@example.com',
      emailVerifiedAt: null,
      handle: 'recent',
      displayName: 'Recent',
      now: new Date(nowMs - 10 * day),
    });
    await createUser({
      id: 'stats-user-old',
      email: 'old@example.com',
      emailVerifiedAt: null,
      handle: 'old',
      displayName: 'Old',
      now: new Date(nowMs - 40 * day),
    });

    const stats = await getSiteStats();
    assert.equal(stats.accounts, 3);
    assert.equal(stats.accountsLast7d, 1);
    assert.equal(stats.accountsLast30d, 2);
  });
});
