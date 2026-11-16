import {
  loadBotRatingPins,
  readBotRatingStamp,
  stampBotRatingSourceRef,
} from './bot-rating-provenance.js';
import { botVsBotJobConfig } from './bot-vs-bot-scheduler.js';
import { createExperimentJob } from './engine-experiments.js';
import { loadEngine, upsertBuiltinEngineVersions } from './engine-registry.js';
import { getPool } from './persistence-db.js';
import { generateMistboardReadout } from './persistence-mistboard-readout.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

const engineId = 'pikafish-xiangqi-level-8';
const anchor = 'random-legal-xiangqi';
const pins = loadBotRatingPins([engineId, anchor]);
const now = new Date('2026-11-13T18:00:00Z');
const runtime = {
  revision: 'test',
  activeGames: 0,
  databaseRequired: true,
  persistence: 'enabled' as const,
  persistenceErrors: { count1m: 0, lastAt: null },
};

async function seedCalibration(rating: number, stale: boolean, n = 256): Promise<void> {
  const db = getPool();
  await upsertBuiltinEngineVersions(db, [engineId, anchor]);
  await db.query(
    `INSERT INTO bot_profiles
    (id, display_name, owner_type, active_engine_id, default_game_spec_id, supported_game_spec_ids, visibility)
    VALUES ('pikafish', 'Pikafish', 'system', $1, 'xiangqi', ARRAY['xiangqi'], 'public')`,
    [engineId],
  );
  await db.query(
    `INSERT INTO bot_rating_snapshots
    (bot_id, game_spec_id, time_class, rating, games, source, source_ref, published, published_at)
    VALUES ('pikafish', 'xiangqi', 'blitz', $1, 100, 'eve-anchor', $2, true, $3)`,
    [
      rating,
      stale ? null : stampBotRatingSourceRef('baseline', pins),
      new Date('2026-11-01T00:00:00Z'),
    ],
  );
  const job = await createExperimentJob(db, {
    purpose: 'calibration',
    targetGames: n,
    config: botVsBotJobConfig({
      variant: 'xiangqi',
      lane: 'calibration',
      anchorEngineId: anchor,
      pairing: { redEngineId: engineId, blackEngineId: anchor },
    }),
  });
  await db.query(
    `INSERT INTO games
    (room_id, variant, mode, status, result, termination, ply_count, started_at, ended_at)
    SELECT 'calibration-' || i, 'xiangqi', 'eve', 'completed',
      CASE WHEN i % 2 = 0 THEN 'red-wins' ELSE 'black-wins' END,
      'checkmate', 40, $2::timestamptz - interval '1 hour', $2 FROM generate_series(1, $1::int) i`,
    [n, now],
  );
  const white = loadEngine(engineId),
    black = loadEngine(anchor);
  await db.query(
    `INSERT INTO eve_games
    (game_id, job_id, game_index, white_engine_id, black_engine_id,
      white_config_hash, black_config_hash, white_play_signature, black_play_signature,
      time_control, seed)
    SELECT 'calibration-' || i, $2, i, $3, $4, $5, $6, $7, $8, '{"kind":"none"}'::jsonb, i
    FROM generate_series(1, $1::int) i`,
    [
      n,
      job.id,
      engineId,
      anchor,
      white.configHash,
      black.configHash,
      white.playSignature,
      black.playSignature,
    ],
  );
  await db.query(
    `INSERT INTO game_debug_artifacts (game_id, artifact_type, storage, payload)
    SELECT 'calibration-' || i, 'engine-rating-stamp', 'jsonb', $2::jsonb
    FROM generate_series(1, $1::int) i`,
    [
      n,
      {
        white: { recipe: pins.recipe, netSha256: pins.nets[engineId] },
        black: { recipe: pins.recipe, netSha256: null },
      },
    ],
  );
}

definePersistenceTests('daily calibration bot rating refresh', () => {
  test('daily publication, stale clearing and readout retry commit exactly one replacement', async () => {
    // Stale and within 200 of the fit: publishes. A bigger move holds (next test).
    await seedCalibration(1650, true);
    const input = { trigger: 'daily' as const, now, runtime };
    await generateMistboardReadout({ ...input, trigger: 'manual' });
    await generateMistboardReadout({ ...input, dryRun: true });
    assert.equal((await getPool().query('SELECT id FROM bot_rating_snapshots')).rows.length, 1);
    const first = await generateMistboardReadout(input);
    const retry = await generateMistboardReadout(input);
    assert.equal(retry.reused, true);
    assert.equal(retry.report.snapshotId, first.report.snapshotId);
    assert.deepEqual(first.report.engines?.staleRatings, []);
    const { rows } = await getPool().query(`SELECT * FROM bot_rating_snapshots ORDER BY id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].source, 'eve-anchor');
    assert.equal(rows[1].rating, 1500);
    assert.equal(rows[1].games, 256);
    assert.equal(rows[1].published, true);
    assert.match(rows[1].source_ref, /lane=calibration/);
    assert.deepEqual(readBotRatingStamp(rows[1].source_ref, engineId), {
      recipe: pins.recipe,
      netSha256: pins.nets[engineId],
    });
  });

  test('same-build large move leaves the snapshot in place and raises just the first daily action', async () => {
    await seedCalibration(1800, false);
    const first = await generateMistboardReadout({ trigger: 'daily', now, runtime });
    assert.ok(
      first.report.actions.some((action) => action.code === 'bot-ratings-calibration-held'),
    );
    const next = await generateMistboardReadout({
      trigger: 'daily',
      now: new Date(now.getTime() + 86400000),
      runtime,
    });
    assert.ok(
      !next.report.actions.some((action) => action.code === 'bot-ratings-calibration-held'),
    );
    const { rows } = await getPool().query('SELECT rating FROM bot_rating_snapshots');
    assert.deepEqual(rows, [{ rating: 1800 }]);
  });
});
