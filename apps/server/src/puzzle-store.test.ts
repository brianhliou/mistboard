// Persistence-off behavior of the puzzle store (#183): without a DB the store
// serves the committed seed corpus directly, byte-identical and in serving
// order, so dev:memory and unit-test runtimes expose the same puzzle surface
// as prod. The DB-backed path (seed sync + round trip) is covered by the
// Postgres-gated tests in persistence-puzzles.test.ts.

import assert from 'node:assert/strict';
import test from 'node:test';
import { xiangqiPuzzleTrainingTags } from '@mistboard/game';
import { loadAllSeedPuzzles, seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import { positionPuzzleFixture } from './fixtures/xiangqi-position-packet.js';
import { close, getPool, init, isInitialized } from './persistence-db.js';
import { getPuzzleStore, playerPuzzleCount, resetPuzzleStoreForTests } from './puzzle-store.js';

test('all serving snapshots withhold a planted source history on a position-only record', async (t) => {
  resetPuzzleStoreForTests();
  init('postgres://unused@127.0.0.1:9/never');
  t.after(async () => {
    await close();
    resetPuzzleStoreForTests();
  });
  const good = positionPuzzleFixture();
  const planted = {
    ...good,
    id: 'planted-position',
    sourceGame: { gameId: 'PRIVATE_GAME_REF', ply: 50 },
    initial: { ...good.initial, id: 'planted-position', moveLog: ['PRIVATE_GAME_HISTORY'] },
  };
  t.mock.method(getPool(), 'query', async (sql: string) =>
    sql.includes('SELECT seed_hash')
      ? { rows: [{ seed_hash: seedPuzzleContentHash() }] }
      : {
          rows: [
            { data: good, position_only: true },
            { data: planted, position_only: true },
            { data: { ...planted, id: 'stripped-credit', credit: undefined }, position_only: true },
          ],
        },
  );
  t.mock.method(console, 'warn', () => {});
  const snapshot = await getPuzzleStore();
  assert.equal(snapshot.byId.has(good.id), true);
  assert.equal(snapshot.byId.has(planted.id), false);
  assert.ok(!JSON.stringify(snapshot.puzzles).includes('PRIVATE_GAME'));
});

test('persistence-off store serves the seed corpus byte-identically, in order', async () => {
  assert.equal(isInitialized(), false, 'this test expects a persistence-off runtime');
  resetPuzzleStoreForTests();
  const store = await getPuzzleStore();

  assert.equal(store.source, 'seed');
  const seed = loadAllSeedPuzzles();
  assert.ok(seed.length > 0);
  assert.equal(store.puzzles.length, seed.length);
  // Byte-level pin: the snapshot serializes exactly like the seed, which is
  // exactly how the pre-#183 in-memory arrays serialized.
  assert.equal(JSON.stringify(store.puzzles), JSON.stringify(seed));
});

test('persistence-off store resolves ids through the byId map', async () => {
  resetPuzzleStoreForTests();
  const store = await getPuzzleStore();
  const first = store.puzzles[0]!;
  assert.equal(store.byId.get(first.id), first);
  assert.equal(store.byId.get('not-a-real-puzzle'), undefined);
  assert.equal(store.byId.size, store.puzzles.length, 'ids are unique');
});

test('persistence-off store snapshot is cached across calls', async () => {
  resetPuzzleStoreForTests();
  const first = await getPuzzleStore();
  const second = await getPuzzleStore();
  assert.equal(first, second);
});

test('player provenance survives JSON storage and reload alongside derived training tags', async (t) => {
  resetPuzzleStoreForTests();
  init('postgres://unused@127.0.0.1:9/never');
  t.after(async () => {
    await close();
    resetPuzzleStoreForTests();
  });
  const seed = loadAllSeedPuzzles().find((puzzle) => puzzle.variant === 'xiangqi')!;
  assert.equal(seed.variant, 'xiangqi');
  const puzzle = {
    ...seed,
    tags: ['player:fixture-player', 'player:fixture-opponent', 'player:fixture-player'],
    themes: ['matein4'],
  };
  const stored = JSON.stringify(puzzle);
  let reads = 0;
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('SELECT seed_hash')) return { rows: [{ seed_hash: seedPuzzleContentHash() }] };
    assert.match(sql, /SELECT data, position_only FROM puzzles WHERE hidden_reason IS NULL/);
    reads += 1;
    return { rows: [{ data: JSON.parse(stored) }] };
  });
  for (let reload = 0; reload < 2; reload += 1) {
    const store = await getPuzzleStore();
    assert.deepEqual(store.byId.get(puzzle.id), JSON.parse(stored));
    assert.deepEqual(store.tagsById.get(puzzle.id), [
      ...(store.motifsById.get(puzzle.id) ?? []),
      ...xiangqiPuzzleTrainingTags(seed),
      'player:fixture-player',
      'player:fixture-opponent',
    ]);
    resetPuzzleStoreForTests();
  }
  assert.equal(reads, 2);
});

test('player puzzle count matches exact tags in the discoverable snapshot only', async () => {
  resetPuzzleStoreForTests();
  const seed = await getPuzzleStore();
  const puzzle = seed.puzzles.find((puzzle) => puzzle.variant === 'xiangqi')!;
  const parked = seed.puzzles.find((puzzle) => puzzle.variant === 'jungle')!;
  const store = {
    ...seed,
    puzzles: [puzzle, parked],
    tagsById: new Map([
      [puzzle.id, ['player:fixture-player'] as const],
      [parked.id, ['player:fixture-parked'] as const],
    ]),
  };
  assert.equal(await playerPuzzleCount('fixture-player', store), 1);
  assert.equal(await playerPuzzleCount('fixture', store), 0);
  assert.equal(await playerPuzzleCount('fixture-parked', store), 0);
});
