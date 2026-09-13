import { isRetiredGameSpec } from '@mistboard/game';
import { loadAllSeedPuzzles, seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import { getPool } from './persistence-db.js';
import { getOrCreateDailyPuzzleSelection } from './persistence-puzzles.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import {
  getPuzzleStore,
  RETIRED_VARIANT_HIDDEN_REASON,
  resetPuzzleStoreForTests,
} from './puzzle-store.js';

definePersistenceTests('daily puzzles', () => {
  test('persists and reuses the homepage daily puzzle assignment', async () => {
    const first = await getOrCreateDailyPuzzleSelection('2026-07-01', 'homepage');
    const second = await getOrCreateDailyPuzzleSelection('2026-07-01', 'homepage');

    assert.equal(first.persisted, true);
    assert.equal(second.persisted, true);
    assert.equal(second.puzzleId, first.puzzleId);
    assert.equal(second.variant, first.variant);
    assert.equal(second.day, '2026-07-01');
    assert.equal(second.slot, 'homepage');

    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text FROM puzzle_daily_selections WHERE day = $1::date AND slot = $2`,
      ['2026-07-01', 'homepage'],
    );
    assert.equal(rows[0]?.count, '1');
  });

  // #183: the puzzles table is seeded on first store use and the DB round trip
  // (json column, seq ordering) reproduces the committed seed byte for byte —
  // the serving-contract pin for the persistence-ON path.
  test('puzzle store syncs the seed and round-trips it byte-identically', async () => {
    // Defensive: any prior run may have leaked a mined row into this seed-backed
    // table (the mined row below, or a promoted one from the publication test).
    // The harness clears these per-test now; this stays as the belt because the
    // assertion right after it is a COUNT against the committed seed, and a
    // single stray row turns it into a confusing off-by-one.
    await getPool().query(`DELETE FROM puzzles WHERE source_kind <> 'seed'`);
    resetPuzzleStoreForTests();
    const store = await getPuzzleStore();
    assert.equal(store.source, 'database');

    // Every seed row is in the table, and the store SERVES the ones that are
    // not withheld. The sync stamps a retired variant's puzzles (#396) with
    // hidden_reason itself, so they would never come back on a fresh database;
    // since the mini family left the seed there is nothing left to withhold,
    // and the served set IS the seed.
    const seed = loadAllSeedPuzzles();
    const served = seed.filter((puzzle) => !isRetiredGameSpec(puzzle.variant));
    assert.equal(served.length, seed.length, 'the seed carries no retired-variant puzzles');
    assert.equal(store.puzzles.length, served.length);
    assert.equal(JSON.stringify(store.puzzles), JSON.stringify(served));

    const { rows } = await getPool().query<{
      seed_hash: string;
      count: string;
      withheld: string;
    }>(
      `SELECT s.seed_hash,
              (SELECT count(*)::text FROM puzzles WHERE source_kind = 'seed') AS count,
              (SELECT count(*)::text FROM puzzles
                 WHERE source_kind = 'seed' AND hidden_reason = $1) AS withheld
         FROM puzzle_seed_sync s WHERE s.slot = 'puzzles'`,
      [RETIRED_VARIANT_HIDDEN_REASON],
    );
    assert.equal(rows[0]?.seed_hash, seedPuzzleContentHash());
    assert.equal(rows[0]?.count, String(seed.length));
    assert.equal(rows[0]?.withheld, String(seed.length - served.length));
  });

  // Seed reconciliation must never touch miner-owned rows, and re-syncs are
  // hash-gated no-ops.
  test('seed re-sync is idempotent and leaves mined rows alone', async () => {
    resetPuzzleStoreForTests();
    await getPuzzleStore();

    await getPool().query(
      `INSERT INTO puzzles (id, variant, title, seq, goal_type, themes, solution_plies, data, source_kind, mined_at)
       VALUES ('xq-mined-test-row-1', 'xiangqi', 'Test mined row',
               (SELECT max(seq) + 1 FROM puzzles), 'checkmate', '{checkmate}', 1,
               '{"id":"xq-mined-test-row-1","variant":"xiangqi"}', 'mined', now())
       ON CONFLICT (id) DO NOTHING`,
    );

    resetPuzzleStoreForTests();
    const store = await getPuzzleStore();
    // The mined row survives the (skipped) re-sync and is served after the
    // seed set, in seq order.
    const servedSeed = loadAllSeedPuzzles().filter((puzzle) => !isRetiredGameSpec(puzzle.variant));
    assert.equal(store.puzzles.length, servedSeed.length + 1);
    assert.equal(store.puzzles.at(-1)?.id, 'xq-mined-test-row-1');

    await getPool().query(`DELETE FROM puzzles WHERE id = 'xq-mined-test-row-1'`);
    resetPuzzleStoreForTests();
  });
});
