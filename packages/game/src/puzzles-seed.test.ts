// Conformance pins for the puzzle seed assets (packages/game/seed/), the
// committed source of truth for the SERVED puzzle corpus since #183.
//
// Fast, corpus-wide integrity checks live here (the unit hot path); the full
// kernel re-verification of every solution line lives in
// puzzles-corpus.slowtest.ts (`npm run test:puzzles:corpus`).
//
// The count + content-hash pins are deliberate friction: any seed change
// (re-mine, corpus edit) breaks them on purpose. Re-verify the whole corpus
// with `npm run test:puzzles:corpus`, then update the pins here.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  FORTRESS_XIANGQI_PUZZLES,
  FORTRESS_XIANGQI_SOURCE_GAMES,
  FORTRESS_XIANGQI_SPEC_ID,
  JUNGLE_PUZZLES,
  JUNGLE_SOURCE_GAMES,
  JUNGLE_SPEC_ID,
  MINI_XIANGQI_PUZZLES,
  MINI_XIANGQI_SPEC_ID,
  XIANGQI_PUZZLES,
  XIANGQI_SPEC_ID,
} from './index.js';
import {
  loadAllSeedPuzzles,
  loadSeedPuzzleRegistry,
  loadSeedSourceGames,
  SEED_PUZZLE_REGISTRIES,
  type SeedPuzzleRegistry,
} from './puzzle-seed.js';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Count + content hash per registry. The jungle hash is the SAME value the
// pre-#183 unit suite pinned on the in-package JUNGLE_PUZZLES array: the seed
// cut is byte-identical to what the server used to serve from TS modules.
const REGISTRY_PINS: Record<SeedPuzzleRegistry, { count: number; hash: string }> = {
  'mini-xiangqi': {
    count: 6,
    hash: 'a1f646edbc01910429f3fec91835f6f2187db918f519f2b796fbd74d1d37c843',
  },
  'fortress-xiangqi': {
    count: 0,
    hash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  },
  jungle: {
    count: 110,
    hash: '4fb627a5ea16fd17f3fc6a3fe8481c646de04e41114d1ff3427de1dd2cadbe92',
  },
  xiangqi: {
    count: 38,
    hash: '8a5840c04cca0391355b88d4ce3878241738b2b12bd4b9faecd091ebf75acbbf',
  },
};

const REGISTRY_VARIANTS: Record<SeedPuzzleRegistry, ReadonlySet<string>> = {
  'mini-xiangqi': new Set([MINI_XIANGQI_SPEC_ID]),
  'fortress-xiangqi': new Set([FORTRESS_XIANGQI_SPEC_ID]),
  jungle: new Set([JUNGLE_SPEC_ID]),
  xiangqi: new Set([XIANGQI_SPEC_ID]),
};

test('seed integrity: count + content hash pin the served corpus per registry', () => {
  for (const registry of SEED_PUZZLE_REGISTRIES) {
    const puzzles = loadSeedPuzzleRegistry(registry);
    assert.equal(puzzles.length, REGISTRY_PINS[registry].count, `${registry} count`);
    assert.equal(sha256(puzzles), REGISTRY_PINS[registry].hash, `${registry} content hash`);
  }
});

test('seed integrity: source-games count + content hash', () => {
  const games = loadSeedSourceGames();
  assert.equal(games.jungle.length, 26);
  assert.equal(
    sha256(games.jungle),
    'bf96a5e9d57b790b36211e90580e46fed07d90e826aba6b944503453888fb044',
  );
  assert.equal(games.fortressXiangqi.length, 0);
  assert.equal(
    sha256(games.fortressXiangqi),
    '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  );
});

test('seed puzzles carry the serving shape, registry-consistent variants, unique ids', () => {
  const seen = new Set<string>();
  for (const registry of SEED_PUZZLE_REGISTRIES) {
    for (const puzzle of loadSeedPuzzleRegistry(registry)) {
      assert.equal(typeof puzzle.id, 'string');
      assert.ok(puzzle.id.length > 0, `${registry}: empty id`);
      assert.equal(seen.has(puzzle.id), false, `duplicate puzzle id ${puzzle.id}`);
      seen.add(puzzle.id);
      assert.ok(
        REGISTRY_VARIANTS[registry].has(puzzle.variant),
        `${puzzle.id}: variant ${puzzle.variant} not allowed in ${registry}`,
      );
      assert.equal(typeof puzzle.title, 'string');
      assert.ok(Array.isArray(puzzle.solution) && puzzle.solution.length > 0, puzzle.id);
      assert.ok(Array.isArray(puzzle.themes), puzzle.id);
      assert.equal(typeof puzzle.goal, 'object');
      assert.ok(puzzle.initial !== undefined && puzzle.initial !== null, puzzle.id);
    }
  }
});

test('loadAllSeedPuzzles preserves the registry concatenation (serving) order', () => {
  const all = loadAllSeedPuzzles();
  const concatenated = SEED_PUZZLE_REGISTRIES.flatMap((registry) => [
    ...loadSeedPuzzleRegistry(registry),
  ]);
  assert.equal(all.length, concatenated.length);
  assert.deepEqual(
    all.map((puzzle) => puzzle.id),
    concatenated.map((puzzle) => puzzle.id),
  );
});

// The in-package *_PUZZLES arrays are TEST fixtures. Each fixture must be a
// VERBATIM copy of a seed record: a fixture that drifts from the seed would
// make kernel/unit tests pass against content the server no longer serves.
test('every fixture puzzle is a verbatim subset of the seed', () => {
  const seedById = new Map(loadAllSeedPuzzles().map((puzzle) => [puzzle.id, puzzle]));
  const fixtures = [
    ...MINI_XIANGQI_PUZZLES,
    ...FORTRESS_XIANGQI_PUZZLES,
    ...JUNGLE_PUZZLES,
    ...XIANGQI_PUZZLES,
  ];
  assert.ok(fixtures.length > 0);
  for (const fixture of fixtures) {
    const seeded = seedById.get(fixture.id);
    assert.ok(seeded, `fixture ${fixture.id} is not in the seed`);
    assert.deepEqual(seeded, fixture, `fixture ${fixture.id} drifted from the seed record`);
  }
});

test('every fixture source game is a verbatim subset of the seed source games', () => {
  const games = loadSeedSourceGames();
  const seedById = new Map(
    [...games.jungle, ...games.fortressXiangqi].map((game) => [game.id, game]),
  );
  for (const fixture of [...JUNGLE_SOURCE_GAMES, ...FORTRESS_XIANGQI_SOURCE_GAMES]) {
    const seeded = seedById.get(fixture.id);
    assert.ok(seeded, `fixture source game ${fixture.id} is not in the seed`);
    assert.deepEqual(seeded, fixture, `fixture source game ${fixture.id} drifted from the seed`);
  }
});

// Referential integrity: every seeded Jungle/Fortress puzzle that points at a
// self-play source game finds it in the seed. (Standard-xiangqi sourceGame ids
// reference historical_xiangqi_games rows, not seed games; full replay
// verification of the linkage lives in the corpus slowtest.)
test('seed puzzle sourceGame references resolve within the seed source games', () => {
  const games = loadSeedSourceGames();
  const jungleIds = new Set(games.jungle.map((game) => game.id));
  const fortressIds = new Set(games.fortressXiangqi.map((game) => game.id));
  for (const puzzle of loadSeedPuzzleRegistry('jungle')) {
    if (!('sourceGame' in puzzle) || !puzzle.sourceGame) continue;
    assert.ok(
      jungleIds.has(puzzle.sourceGame.gameId),
      `${puzzle.id} references missing jungle source game ${puzzle.sourceGame.gameId}`,
    );
  }
  for (const puzzle of loadSeedPuzzleRegistry('fortress-xiangqi')) {
    if (!('sourceGame' in puzzle) || !puzzle.sourceGame) continue;
    assert.ok(
      fortressIds.has(puzzle.sourceGame.gameId),
      `${puzzle.id} references missing fortress source game ${puzzle.sourceGame.gameId}`,
    );
  }
});
