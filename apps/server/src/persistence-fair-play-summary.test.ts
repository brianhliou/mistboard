import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeFairPlayAccount } from './fair-play-summary.js';
import { getPool } from './persistence-db.js';
import {
  type FairPlaySummaryDb,
  loadFairPlaySummaryInputs,
} from './persistence-fair-play-summary.js';
import { definePersistenceTests } from './persistence-test-support.js';

const at = new Date('2026-11-16T00:00:00.000Z');
const row = {
  room_id: 'xq_fp',
  variant: 'xiangqi',
  ended_at: at,
  initial_ms: 180_000,
  increment_ms: 2_000,
  player_color: 'black',
  engine_id: 'pikafish-xiangqi-analysis@6',
  depth: 12,
  plies: [{ ply: 0, cp: 0, mate: null, best: 'h2e2' }],
};

function database(results: object[][]) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db: FairPlaySummaryDb = {
    async query<T extends object>(sql: string, values: unknown[]) {
      calls.push({ sql, values });
      assert.ok(results.length, `unexpected query: ${sql}`);
      return { rows: results.shift()! as T[] };
    },
  };
  return { db, calls };
}

test('loader distinguishes unknown account and an existing account with no games', async () => {
  assert.equal(await loadFairPlaySummaryInputs('missing', database([[]]).db), null);
  assert.deepEqual(
    await loadFairPlaySummaryInputs('empty', database([[{ id: 'empty' }], []]).db),
    [],
  );
});

test('loader retains missing analysis, reads fog blobs, joins current bucket ratings and marks missing logs unavailable', async () => {
  const { db, calls } = database([
    [{ id: 'account' }],
    [
      row,
      { ...row, room_id: 'missing', engine_id: null, depth: null, plies: null },
      {
        ...row,
        room_id: 'fog',
        variant: 'dark-chess',
        initial_ms: 86_400_000,
        increment_ms: 0,
        player_color: 'white',
        engine_id: 'misty-analysis@fixture',
        plies: { plies: row.plies, seats: { secret: 'not-for-wire' } },
      },
    ],
    [
      { variant: 'xiangqi', time_class: 'blitz', elo_rating: 1675 },
      { variant: 'fog', time_class: 'correspondence', elo_rating: 1820 },
    ],
    [],
  ]);
  const inputs = await loadFairPlaySummaryInputs('account', db);
  assert.ok(inputs);
  assert.equal(inputs[0]!.rating, 1675);
  assert.equal(inputs[1]!.analysis, null);
  assert.deepEqual(inputs[2]!.analysis, row.plies);
  assert.equal(inputs[2]!.timeClass, 'correspondence');
  assert.equal(inputs[2]!.rating, 1820);
  const summary = summarizeFairPlayAccount('account', inputs);
  assert.deepEqual(summary.missingAnalysisGames, ['missing']);
  assert.deepEqual(summary.unavailableGames, ['xq_fp', 'fog']);
  assert.doesNotMatch(JSON.stringify(summary), /secret|not-for-wire/);
  assert.deepEqual(calls[1]!.values, ['account', 40]);
});

// Real query regression: catches filtering/window/join errors that a query
// double cannot. Runs with the package's ordinary Postgres test configuration.
definePersistenceTests('fair-play summary', () => {
  test('latest 40 analyzed rated games retain gaps, dedupe caches and exclude running/casual/other accounts', async () => {
    const db = getPool();
    await db.query(
      `INSERT INTO users (id, email, handle, display_name) VALUES ('fp_account', 'fp@example.test', 'fp_account', 'FP')`,
    );
    await db.query(
      `INSERT INTO user_ratings (user_id, variant, time_class, elo_rating, rating_deviation, volatility, games_played)
       VALUES ('fp_account', 'xiangqi', 'blitz', 1730, 80, 0.06, 80)`,
    );
    for (let i = 0; i < 46; i++) {
      const id = `fp_${String(i).padStart(2, '0')}`;
      await db.query(
        `INSERT INTO games (room_id, variant, result, termination, ply_count, started_at, ended_at, mode, status, rated, initial_ms, increment_ms)
         VALUES ($1, 'xiangqi', $5, $6, 20, $2, $7, 'pvp', $3, $4, 180000, 2000)`,
        // A running game has no result, termination or end time (games_status_shape_check).
        [
          id,
          new Date(at.getTime() + i * 1000),
          i === 45 ? 'running' : 'completed',
          i !== 44,
          i === 45 ? null : 'red-wins',
          i === 45 ? null : 'resignation',
          i === 45 ? null : new Date(at.getTime() + i * 1000),
        ],
      );
      await db.query(
        `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name, visibility)
         VALUES ($1, 'red', 'user', $2, 'FP', 'public')`,
        [id, i === 43 ? 'someone_else' : 'fp_account'],
      );
      // Missing final analysis at 40; decision and progress caches must not
      // count as analysis. Every other game has two final engine versions.
      for (const engine of i === 40
        ? ['pikafish-xiangqi-analysis@6!progress', 'xiangqi-decisions@1']
        : ['pikafish-xiangqi-analysis@5', 'pikafish-xiangqi-analysis@6']) {
        await db.query(
          `INSERT INTO game_analysis (room_id, engine_id, depth, plies, created_at) VALUES ($1, $2, 12, $3::jsonb, $4)
           ON CONFLICT (room_id, engine_id, depth) DO UPDATE SET plies = EXCLUDED.plies, created_at = EXCLUDED.created_at`,
          [
            id,
            engine,
            JSON.stringify(row.plies),
            new Date(at.getTime() + (engine.includes('@6') ? 1000 : 0)),
          ],
        );
      }
    }
    const inputs = await loadFairPlaySummaryInputs('fp_account');
    assert.ok(inputs);
    assert.equal(inputs.filter((game) => game.analysis !== null).length, 40);
    assert.equal(inputs.length, 41);
    assert.equal(inputs[0]!.roomId, 'fp_42');
    assert.equal(inputs.at(-1)!.roomId, 'fp_02');
    assert.deepEqual(
      inputs.filter((game) => game.analysis === null).map((game) => game.roomId),
      ['fp_40'],
    );
    assert.ok(inputs.every((game) => game.rating === 1730));
    assert.ok(
      inputs
        .filter((game) => game.analysis)
        .every((game) => game.engineId === 'pikafish-xiangqi-analysis@6'),
    );
  });
});
