import {
  gameAggregates,
  getGameFavoriteState,
  listFavoriteGames,
  listRecentEveGames,
  listRecentPublicGames,
  listShowcaseGames,
  listWatchUnlockedGames,
  queryGames,
  queryHeadToHeadGames,
  setGameFavorite,
  tallyHeadToHeadGames,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

const FIRST = { subjectType: 'engine-version', subjectId: 'eve-first-v1' } as const;
const SECOND = { subjectType: 'engine-version', subjectId: 'eve-second-v1' } as const;
const NOW = new Date('2026-11-10T14:00:00Z');
const FINISHED_IDS = ['eve-draw', 'eve-finished'];

async function seedEveGames(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`INSERT INTO engines (id, name, visibility, status)
      VALUES ('eve-first', 'First Engine', 'public', 'active'),
             ('eve-second', 'Second Engine', 'public', 'active')`);
    await client.query(`INSERT INTO engine_versions
      (id, name, config_hash, play_signature, engine_id)
      VALUES ('eve-first-v1', 'First Engine', 'first-hash', 'first-sig', 'eve-first'),
             ('eve-second-v1', 'Second Engine', 'second-hash', 'second-sig', 'eve-second')`);
    await client.query(`INSERT INTO eve_jobs
      (id, purpose, target_games, status, completed_games, config)
      VALUES ('public-eve-job', 'smoke', 3, 'completed', 3,
              '{"source":"bot-vs-bot-scheduler"}')`);

    // The newest row reproduces the ply-cap case: completed in storage, with
    // a final move but no ending event. Include a real draw as well as a win.
    for (const [index, roomId, result, termination] of [
      [0, 'eve-finished', 'red-wins', 'resignation'],
      [1, 'eve-draw', 'draw', 'draw'],
      [2, 'eve-truncated', 'draw', 'truncated'],
    ] as const) {
      const endedAt = new Date(NOW.getTime() - (3 - index) * 60_000);
      await client.query(
        `INSERT INTO games
          (room_id, variant, mode, status, visibility, result, termination,
           ply_count, started_at, ended_at)
         VALUES ($1, 'banqi', 'eve', 'completed', 'public', $2, $3, 300, $4, $4)`,
        [roomId, result, termination, endedAt],
      );
      await client.query(
        `INSERT INTO eve_games
          (game_id, job_id, game_index, white_engine_id, black_engine_id,
           white_config_hash, black_config_hash, white_play_signature, black_play_signature,
           time_control, opening_policy, seed)
         VALUES ($1, 'public-eve-job', $2, 'eve-first-v1', 'eve-second-v1',
                 'first-hash', 'second-hash', 'first-sig', 'second-sig',
                 '{"kind":"per-move","milliseconds":100}', '{}', $3)`,
        [roomId, index, index],
      );
      await client.query(
        `INSERT INTO game_participants
          (game_id, color, subject_type, subject_id, display_name, visibility)
         VALUES ($1, 'red', 'engine-version', 'eve-first-v1', 'First Engine', 'public'),
                ($1, 'black', 'engine-version', 'eve-second-v1', 'Second Engine', 'public')`,
        [roomId],
      );
      const type = termination === 'resignation' ? 'seat-resigned' : 'move-played';
      await client.query(
        `INSERT INTO events (room_id, seq, type, payload) VALUES ($1, 0, $2, $3)`,
        [roomId, type, { type, at: endedAt.getTime(), roomId }],
      );
    }
  } finally {
    await client.end();
  }
}

definePersistenceTests('public EVE listings', () => {
  for (const [name, list] of [
    ['listRecentEveGames', () => listRecentEveGames(2)],
    ['listRecentPublicGames', () => listRecentPublicGames(2)],
    [
      'listWatchUnlockedGames',
      () => listWatchUnlockedGames({ modes: ['eve'], variants: ['banqi'], now: NOW, limit: 2 }),
    ],
  ] as const) {
    test(`${name} excludes ply-capped EVE games before limiting, keeps wins and real draws`, async () => {
      await seedEveGames();
      assert.deepEqual(
        (await list()).map((game) => game.roomId),
        FINISHED_IDS,
      );
    });
  }

  test('public scheduled-engine search excludes truncated games from rows and total', async () => {
    await seedEveGames();
    const filters = { scheduledEngine: true, visibility: 'public', limit: 1 } as const;
    const first = await queryGames(filters);
    assert.equal(first.total, 2);
    assert.deepEqual(
      first.games.map((game) => game.roomId),
      [FINISHED_IDS[0]],
    );
    const second = await queryGames({ ...filters, offset: 1 });
    assert.equal(second.total, 2);
    assert.deepEqual(
      second.games.map((game) => game.roomId),
      [FINISHED_IDS[1]],
    );
    const aggregates = await gameAggregates(filters);
    assert.equal(aggregates.total, 2);
    assert.equal(aggregates.results.redWins, 1);
    assert.equal(aggregates.results.draws, 1);
    assert.deepEqual(aggregates.terminations, [
      { termination: 'draw', count: 1 },
      { termination: 'resignation', count: 1 },
    ]);
    // Admin diagnostics retain the capped run.
    assert.equal((await queryGames({ mode: 'eve' })).total, 3);
  });

  test('homepage showcase excludes all EVE games, including truncated runs', async () => {
    await seedEveGames();
    assert.deepEqual(await listShowcaseGames({ variants: ['banqi'] }), []);
  });

  test('engine crosstable excludes truncated games from links and result tallies', async () => {
    await seedEveGames();
    const games = await queryHeadToHeadGames(FIRST, SECOND, 'banqi', 2);
    assert.deepEqual(
      games.map((game) => game.roomId),
      FINISHED_IDS,
    );
    const tallies = await tallyHeadToHeadGames(FIRST, SECOND, 'banqi');
    assert.deepEqual(
      tallies.sort((a, b) => a.result.localeCompare(b.result)),
      [
        { aColor: 'red', result: 'draw', count: 1 },
        { aColor: 'red', result: 'red-wins', count: 1 },
      ],
    );
  });

  test('favorites refuse truncated EVE games and hide existing bookmarks from rows and total', async () => {
    await seedEveGames();
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(`INSERT INTO users (id, email, handle, display_name)
        VALUES ('eve-viewer', 'eve@example.com', 'eve-viewer', 'EVE Viewer')`);
      assert.deepEqual(await setGameFavorite('eve-truncated', 'eve-viewer', true), {
        accessible: false,
        favorited: false,
      });
      for (const id of FINISHED_IDS) {
        assert.deepEqual(await setGameFavorite(id, 'eve-viewer', true), {
          accessible: true,
          favorited: true,
        });
      }
      // A bookmark saved before the fix must not leave a broken game card.
      await client.query(`INSERT INTO game_favorites (game_id, user_id)
        VALUES ('eve-truncated', 'eve-viewer')`);
      assert.deepEqual(await getGameFavoriteState('eve-truncated', 'eve-viewer'), {
        accessible: false,
        favorited: true,
      });
      const page = await listFavoriteGames('eve-viewer');
      assert.equal(page.total, 2);
      assert.deepEqual(page.games.map((game) => game.roomId).sort(), [...FINISHED_IDS].sort());
    } finally {
      await client.end();
    }
  });
});
