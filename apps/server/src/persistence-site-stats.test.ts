import {
  DAY_MS,
  DAYS_PER_MOVE_OPTIONS,
  isPublicGameSpec,
  officialCorrespondenceDays,
  TIME_CONTROLS,
  XIANGQI_MAHJONG_SPEC_ID,
} from '@mistboard/game';
import {
  createUser,
  getPublicSiteStats,
  getRecentCountedGamesByVariant,
  getSiteGameTotals,
  getSiteStats,
} from './persistence.js';
import { correspondenceGame } from './persistence-counted-games.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('site stats', () => {
  test('weekly play categories partition counted games on the Pacific week axis', async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(`INSERT INTO users (id, email, handle, display_name, stats_excluded_at)
        VALUES ('play-operator', 'play-op@example.com', 'play-operator', 'Operator', now())`);
      // Sunday evening Pacific still belongs to the preceding week. The last
      // row is later than now, so neither weekly aggregate may include it.
      const cases = [
        ['bot', 'pve', false, 300000, 5000, '2026-11-09T04:00:00Z'],
        ['casual', 'pvp', false, 300000, 5000, '2026-11-09T04:00:00Z'],
        ['rated', 'pvp', true, 300000, 5000, '2026-11-09T04:00:00Z'],
        ['casual-corr', 'pvp', false, DAY_MS, 0, '2026-11-09T04:00:00Z'],
        ['rated-corr', 'pvp', true, DAY_MS * 7, 0, '2026-11-09T04:00:00Z'],
        ['excluded', 'pvp', true, DAY_MS, 0, '2026-11-09T04:00:00Z'],
        ['current', 'pvp', false, null, null, '2026-11-09T09:00:00Z'],
        ['future', 'pvp', true, DAY_MS, 0, '2026-11-09T11:00:00Z'],
      ];
      for (const [id, mode, rated, initial, increment, ended] of cases) {
        await client.query(
          `INSERT INTO games
          (room_id, variant, mode, rated, initial_ms, increment_ms, result, termination,
           ply_count, started_at, ended_at, white_client, black_client, status, visibility)
          VALUES ($1, 'xiangqi', $2, $3, $4, $5, 'red-wins', 'resignation', 12,
                  $6, $6, 'red', 'black', 'completed', 'public')`,
          [`play-${id}`, mode, rated, initial, increment, ended],
        );
      }
      await client.query(`INSERT INTO game_participants
        (game_id, color, subject_type, subject_id, display_name)
        VALUES ('play-excluded', 'red', 'user', 'play-operator', 'Operator')`);
      // Execute the SQL predicate itself for every official option and live
      // preset, plus unofficial and missing paces. It must match rating buckets.
      const paces = [
        ...DAYS_PER_MOVE_OPTIONS.map((days) => ({ initialMs: days * DAY_MS, incrementMs: 0 })),
        ...TIME_CONTROLS,
        { initialMs: DAY_MS * 4, incrementMs: 0 },
        { initialMs: DAY_MS, incrementMs: 1 },
        { initialMs: 1000, incrementMs: 0 },
        { initialMs: null, incrementMs: null },
        { initialMs: DAY_MS, incrementMs: null },
      ];
      for (const pace of paces) {
        const { rows } = await client.query<{ correspondence: boolean }>(
          `SELECT ${correspondenceGame('g')} AS correspondence
           FROM (SELECT $1::int AS initial_ms, $2::int AS increment_ms) g`,
          [pace.initialMs, pace.incrementMs],
        );
        assert.equal(
          rows[0]?.correspondence,
          officialCorrespondenceDays(pace.initialMs, pace.incrementMs) !== null,
        );
      }
    } finally {
      await client.end();
    }
    const stats = await getPublicSiteStats({ now: new Date('2026-11-09T10:00:00Z') });
    assert.deepEqual(stats.weeklyCompletedGames, [
      { weekStart: '2026-11-02', completedGames: 5 },
      { weekStart: '2026-11-09', completedGames: 1 },
    ]);
    for (const [index, week] of stats.weeklyCompletedGames.entries()) {
      assert.equal(
        stats.weeklyByVariant.reduce(
          (sum, variant) => sum + (variant.weeks[index]?.completedGames ?? 0),
          0,
        ),
        week.completedGames,
      );
    }
    assert.deepEqual(stats.weeklyByPlay, [
      {
        weekStart: '2026-11-02',
        vsBot: 1,
        casualLive: 1,
        ratedLive: 1,
        casualCorrespondence: 1,
        ratedCorrespondence: 1,
      },
      {
        weekStart: '2026-11-09',
        vsBot: 0,
        casualLive: 1,
        ratedLive: 0,
        casualCorrespondence: 0,
        ratedCorrespondence: 0,
      },
    ]);
    assert.deepEqual(
      stats.weeklyByPlay.map(
        ({
          weekStart,
          vsBot,
          casualLive,
          ratedLive,
          casualCorrespondence,
          ratedCorrespondence,
        }) => ({
          weekStart,
          completedGames:
            vsBot + casualLive + ratedLive + casualCorrespondence + ratedCorrespondence,
        }),
      ),
      stats.weeklyCompletedGames,
    );
  });

  test('getPublicSiteStats returns public-safe completed game aggregates', async () => {
    // Every date sits after STATS_COUNTED_FROM (2026-06-01); one game before
    // it proves the launch date filter. Two completed games under
    // MIN_COUNTED_PLIES (a bot's opening move then a forfeit; a resignation
    // before anyone moved) prove the ply floor: neither is play.
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
            'white', 'black', NULL, NULL, 'pve', 'completed', 'public'),
           ('stats-short-forfeit', 'duck-xiangqi', 'red-wins', 'abandonment', 1, $3, $3,
            'engine', 'human', NULL, NULL, 'pve', 'completed', 'public'),
           ('stats-short-resign', 'xiangqi', 'red-wins', 'resignation', 0, $3, $3,
            'engine', 'human', NULL, NULL, 'pve', 'completed', 'public')`,
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
    // The homepage's two-count read agrees with /stats on the same data.
    assert.deepEqual(await getSiteGameTotals({ now }), {
      totalCompletedGames: stats.totalCompletedGames,
      last30dCompletedGames: stats.last30dCompletedGames,
    });

    assert.equal(stats.generatedAt, now.toISOString());
    // The excluded operator is not a registered account here.
    assert.equal(stats.accounts, 0);
    // Eight weeks: from the first counted game's week (06-08) to the current
    // one, the same origin as the daily series below, not a fixed 26 back.
    assert.equal(stats.weeklyCompletedGames.length, 8);
    assert.equal(stats.weeklyCompletedGames[0]?.weekStart, '2026-06-08');
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
    // Quiet weeks stay on both axes, with five zeroes in the play split.
    assert.deepEqual(
      stats.weeklyByPlay.map(({ weekStart, ...counts }) => ({
        weekStart,
        completedGames: Object.values(counts).reduce((sum, count) => sum + count, 0),
      })),
      stats.weeklyCompletedGames,
    );
    // The per-variant weekly series share the axis and sum to the total row.
    assert.deepEqual(
      stats.weeklyByVariant.map((v) => [v.variant, v.total, v.weeks.length]),
      [
        ['dark-chess', 3, 8],
        ['xiangqi', 1, 8],
      ],
    );
    assert.deepEqual(
      stats.weeklyByVariant[0]?.weeks.filter((w) => w.completedGames > 0),
      [
        { weekStart: '2026-06-08', completedGames: 2 },
        { weekStart: '2026-07-27', completedGames: 1 },
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

  test('public stats leave out every game in a retired variant', async () => {
    // fortress-xiangqi is retired (runtimeStatus 'retired' in GAME_SPECS): its
    // games stay in the table and in the admin totals but leave every public
    // number, eve row included, while the live xiangqi game counts.
    const now = new Date('2026-10-11T12:00:00.000Z');
    const ended = new Date('2026-10-10T12:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('retired-fortress-pvp', 'fortress-xiangqi', 'red-wins', 'resignation', 30, $1, $1,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('retired-atomic-pve', 'atomic-xiangqi', 'red-wins', 'resignation', 30, $1, $1,
            'human', 'engine', NULL, NULL, 'pve', 'completed', 'public'),
           ('retired-fortress-eve', 'fortress-xiangqi', 'draw', 'truncated', 40, $1, $1,
            'engine:red', 'engine:black', NULL, NULL, 'eve', 'completed', 'public'),
           ('live-xiangqi-pvp', 'xiangqi', 'red-wins', 'resignation', 30, $1, $1,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public')`,
        [ended],
      );
    } finally {
      await client.end();
    }

    const stats = await getPublicSiteStats({ now });
    assert.equal(stats.totalCompletedGames, 1);
    assert.equal(stats.last30dCompletedGames, 1);
    assert.equal(stats.publicGames, 1);
    assert.deepEqual(stats.modeTotals, { pvp: 1, pve: 0, eve: 0 });
    assert.deepEqual(stats.variantTotals, [{ variant: 'xiangqi', count: 1 }]);
    assert.deepEqual(
      stats.weeklyCompletedGames.filter((w) => w.completedGames > 0),
      [{ weekStart: '2026-10-05', completedGames: 1 }],
    );
    assert.deepEqual(
      stats.weeklyByVariant.map((v) => [v.variant, v.total]),
      [['xiangqi', 1]],
    );
    assert.equal(stats.dailyCompletedGames.at(-1)?.cumulativeGames, 1);
    assert.equal(
      stats.dailyCompletedGames.reduce((sum, d) => sum + d.completedGames, 0),
      1,
    );
    assert.deepEqual(
      stats.variantDaily.map((v) => [v.variant, v.total]),
      [['xiangqi', 1]],
    );
    assert.deepEqual(await getSiteGameTotals({ now }), {
      totalCompletedGames: 1,
      last30dCompletedGames: 1,
    });
    assert.deepEqual(await getRecentCountedGamesByVariant(28, { now }), [
      { variant: 'xiangqi', count: 1 },
    ]);

    // The admin totals are a separate path and still see every game.
    const admin = await getSiteStats();
    assert.equal(admin.gamesByVariant['fortress-xiangqi'], 2);
    assert.equal(admin.gamesByVariant['atomic-xiangqi'], 1);
  });

  test('public stats cut days and weeks at Pacific midnight, not UTC', async () => {
    // Sunday 2026-11-08 20:00 PST is Monday 04:00 UTC. Under UTC buckets that
    // game opened the next week (the /stats "so far this week" read 8 games at
    // Sunday 18:53 Pacific); in Pacific time it closes the week of 11-02. The
    // second game, Monday 01:00 PST, is the first of the week of 11-09.
    const sundayEvening = new Date('2026-11-09T04:00:00.000Z');
    const mondayEarly = new Date('2026-11-09T09:00:00.000Z');
    const now = new Date('2026-11-09T10:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('tz-sunday-evening', 'xiangqi', 'red-wins', 'resignation', 30, $1, $1,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('tz-monday-early', 'xiangqi', 'red-wins', 'resignation', 30, $2, $2,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public')`,
        [sundayEvening, mondayEarly],
      );
    } finally {
      await client.end();
    }

    const stats = await getPublicSiteStats({ now });
    assert.deepEqual(stats.weeklyCompletedGames, [
      { weekStart: '2026-11-02', completedGames: 1 },
      { weekStart: '2026-11-09', completedGames: 1 },
    ]);
    assert.deepEqual(stats.weeklyByVariant[0]?.weeks, stats.weeklyCompletedGames);
    const daily = stats.dailyCompletedGames.filter((d) => d.completedGames > 0);
    assert.deepEqual(
      daily.map((d) => [d.date, d.completedGames]),
      [
        ['2026-11-08', 1],
        ['2026-11-09', 1],
      ],
    );
    assert.deepEqual(
      stats.variantDaily[0]?.days.filter((d) => d.completedGames > 0).map((d) => d.date),
      ['2026-11-08', '2026-11-09'],
    );
    // Both series start on the same Pacific Monday.
    assert.equal(stats.dailyCompletedGames[0]?.date, '2026-11-02');
    assert.equal(stats.dailyCompletedGames.at(-1)?.date, '2026-11-09');
  });

  test('public stats count a playtest variant exactly when its launch switch is on', async () => {
    // Xiangqi Mahjong is a hidden playtest until its publicSurface flips
    // (packages/game game-specs.ts). While hidden its games stay out of every
    // public number, as a retired variant's do; once launched they count,
    // history included. The admin totals see them either way.
    const launched = isPublicGameSpec(XIANGQI_MAHJONG_SPEC_ID);
    const now = new Date('2026-10-16T12:00:00.000Z');
    const ended = new Date('2026-10-15T12:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('playtest-xmj-pvp', 'xiangqi-mahjong', 'red-wins', 'resignation', 30, $1, $1,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('playtest-xiangqi-pvp', 'xiangqi', 'red-wins', 'resignation', 30, $1, $1,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public')`,
        [ended],
      );
    } finally {
      await client.end();
    }

    const expected = launched ? 2 : 1;
    const stats = await getPublicSiteStats({ now });
    assert.equal(stats.totalCompletedGames, expected);
    assert.equal(stats.publicGames, expected);
    assert.equal(
      stats.variantTotals.some((row) => row.variant === XIANGQI_MAHJONG_SPEC_ID),
      launched,
    );
    assert.equal(
      stats.weeklyByVariant.some((row) => row.variant === XIANGQI_MAHJONG_SPEC_ID),
      launched,
    );
    assert.equal((await getSiteGameTotals({ now })).totalCompletedGames, expected);
    assert.equal(
      (await getRecentCountedGamesByVariant(28, { now })).some(
        (row) => row.variant === XIANGQI_MAHJONG_SPEC_ID,
      ),
      launched,
    );
    const admin = await getSiteStats();
    assert.equal(admin.gamesByVariant[XIANGQI_MAHJONG_SPEC_ID], 1);
  });

  test('getRecentCountedGamesByVariant counts counted games ended inside the window', async () => {
    const now = new Date('2026-09-30T12:00:00.000Z');
    const inside = new Date('2026-09-20T12:00:00.000Z');
    const outside = new Date('2026-08-20T12:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('order-jieqi-1', 'jieqi', 'red-wins', 'resignation', 30, $1, $1,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('order-jieqi-2', 'jieqi', 'red-wins', 'resignation', 30, $1, $1,
            'human', 'engine', NULL, NULL, 'pve', 'completed', 'public'),
           ('order-banqi-1', 'banqi', 'red-wins', 'resignation', 30, $1, $1,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('order-banqi-old', 'banqi', 'red-wins', 'resignation', 30, $2, $2,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('order-banqi-old-2', 'banqi', 'red-wins', 'resignation', 30, $2, $2,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('order-xiangqi-eve', 'xiangqi', 'draw', 'truncated', 40, $1, $1,
            'engine:red', 'engine:black', NULL, NULL, 'eve', 'completed', 'public')`,
        [inside, outside],
      );
    } finally {
      await client.end();
    }
    const rows = await getRecentCountedGamesByVariant(28, { now });
    assert.deepEqual(rows, [
      { variant: 'jieqi', count: 2 },
      { variant: 'banqi', count: 1 },
    ]);
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
