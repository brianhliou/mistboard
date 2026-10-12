import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRetiredGameSpec } from '@mistboard/game';
import { loadAllSeedPuzzles, seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import { createUser } from './persistence.js';
import { getPool } from './persistence-db.js';
import { getUserProfileByHandle } from './persistence-profiles.js';
import { listAttemptedPuzzleIds, recordPuzzleAttempt } from './persistence-puzzle-ratings.js';
import { getOrCreateDailyPuzzleSelection } from './persistence-puzzles.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { seedPuzzleRating } from './puzzle-rating.js';
import {
  getPuzzleStore,
  RETIRED_VARIANT_HIDDEN_REASON,
  resetPuzzleStoreForTests,
} from './puzzle-store.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/puzzles.js';

async function getRoute(path: string): Promise<{ status: number | null; body: string }> {
  const capture = { status: null as number | null, body: '' };
  const response = {
    writeHead(status: number) {
      capture.status = status;
      return response;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return response;
    },
  } as unknown as ServerResponse;
  const url = new URL(path, 'http://localhost');
  const request = {
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  await tryHandle({} as HttpApiContext, request, response, url.pathname, url);
  return capture;
}

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
  // Fortress Xiangqi was retired on 2026-10-11 and its puzzle registry deleted,
  // but prod still holds its rows: mined puzzles, attempts, a rating pool, maybe
  // a persisted daily. None of them may serve, and none may break a listing.
  test('leftover Fortress puzzle rows are not served and break no listing', async () => {
    const fortressId = 'fortress-xiangqi-mined-v2-001';
    resetPuzzleStoreForTests();
    await getPuzzleStore();
    await getPool().query(
      `INSERT INTO puzzles (id, variant, title, seq, goal_type, themes, solution_plies, data, source_kind, mined_at)
       VALUES ($1, 'fortress-xiangqi', 'Leftover Fortress mate',
               (SELECT max(seq) + 1 FROM puzzles), 'checkmate', '{checkmate}', 1,
               $2, 'mined', now())
       ON CONFLICT (id) DO NOTHING`,
      [fortressId, JSON.stringify({ id: fortressId, variant: 'fortress-xiangqi' })],
    );
    await createUser({
      id: 'fortress-solver',
      email: 'fortress-solver@example.com',
      emailVerifiedAt: new Date(),
      handle: 'fortresssolver',
      displayName: 'fortresssolver',
      now: new Date(),
    });
    await recordPuzzleAttempt({
      userId: 'fortress-solver',
      puzzleId: fortressId,
      variant: 'fortress-xiangqi',
      solved: true,
      rated: true,
      seedRating: seedPuzzleRating(1),
    });
    await getPool().query(
      `INSERT INTO puzzle_daily_selections (day, slot, variant, puzzle_id, source)
       VALUES ('2026-10-01'::date, 'homepage', 'fortress-xiangqi', $1, 'auto')
       ON CONFLICT (day, slot) DO UPDATE SET variant = EXCLUDED.variant, puzzle_id = EXCLUDED.puzzle_id`,
      [fortressId],
    );

    // The store withholds the row, so every route answers its id with 404.
    resetPuzzleStoreForTests();
    const store = await getPuzzleStore();
    assert.equal(store.byId.has(fortressId), false);
    assert.equal(
      store.puzzles.some((puzzle) => (puzzle.variant as string) === 'fortress-xiangqi'),
      false,
    );
    const detail = await getRoute(`/api/puzzles/${fortressId}`);
    assert.equal(detail.status, 404);
    assert.deepEqual(JSON.parse(detail.body), { error: 'not_found' });

    // The list still serves, and the attempted-id history still reads.
    const list = await getRoute('/api/puzzles');
    assert.equal(list.status, 200);
    assert.deepEqual(await listAttemptedPuzzleIds('fortress-solver'), [fortressId]);

    // The profile's puzzle-rating listing still returns with the stale pool in it
    // (the web profile hides the retired variant's chip).
    const profile = await getUserProfileByHandle('fortresssolver', null);
    assert.ok(profile);
    assert.deepEqual(
      profile.puzzleRatings.map((rating) => rating.variant),
      ['fortress-xiangqi'],
    );

    // A persisted Fortress daily is re-selected to a served puzzle, not thrown.
    const daily = await getOrCreateDailyPuzzleSelection('2026-10-01', 'homepage');
    assert.equal(daily.variant, 'xiangqi');
    assert.equal(daily.source, 'auto-recovered');
    assert.notEqual(daily.puzzleId, fortressId);

    await getPool().query('DELETE FROM puzzles WHERE id = $1', [fortressId]);
    resetPuzzleStoreForTests();
  });
});
