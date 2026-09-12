/**
 * FULL kernel verification of the SERVED puzzle corpus — the seed assets in
 * packages/game/seed/ (#183), which the server syncs into the `puzzles` table
 * and serves. Deliberately OFF the unit hot path: validateJunglePuzzle
 * re-searches every forced win, so this grows linearly with the corpus (~20s+
 * already) and was the long pole of the whole @mistboard/game unit suite.
 *
 * The `.slowtest.ts` suffix keeps it out of `test:unit` (`src/**\/*.test.ts`)
 * and the compiled `test` glob (`dist/**\/*.test.js`). It runs via the
 * dedicated `test:puzzles:corpus` script, wired as its own CI job.
 *
 * The fast unit file (puzzles-seed.test.ts) pins the corpus counts + content
 * hashes and fixture-subset integrity, so any seed edit fails fast there and
 * points here for the full gate.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type FortressXiangqiPuzzle,
  type JunglePuzzle,
  replayFortressXiangqiSourceGameToPly,
  replayJungleSourceGameToPly,
  validateFortressXiangqiPuzzle,
  validateJunglePuzzle,
  validateStandardXiangqiPuzzle,
  type XiangqiPuzzle,
} from './index.js';
import { loadSeedPuzzleRegistry, loadSeedSourceGames } from './puzzle-seed.js';

test('every seeded Jungle puzzle validates as a forced win (full corpus)', () => {
  const puzzles = loadSeedPuzzleRegistry('jungle') as readonly JunglePuzzle[];
  assert.ok(puzzles.length > 0, 'corpus is non-empty');
  for (const puzzle of puzzles) {
    const result = validateJunglePuzzle(puzzle);
    assert.ok(result.ok, `${puzzle.id} invalid: ${result.ok ? '' : result.issue.message}`);
  }
});

test('every seeded Fortress Xiangqi puzzle validates (full corpus)', () => {
  // Fortress ships NO puzzles as of 2026-09-03 (see the banner in
  // puzzles-fortress-xiangqi-fixtures.ts), so there is no non-empty assertion
  // here: an empty corpus is the intended state, and this loop is the guard for
  // whatever a future re-mine puts back.
  const puzzles = loadSeedPuzzleRegistry('fortress-xiangqi') as readonly FortressXiangqiPuzzle[];
  for (const puzzle of puzzles) {
    const result = validateFortressXiangqiPuzzle(puzzle);
    assert.ok(result.ok, `${puzzle.id} invalid: ${result.ok ? '' : result.issue.message}`);
  }
});

test('every seeded standard-xiangqi puzzle validates (full corpus)', () => {
  const puzzles = loadSeedPuzzleRegistry('xiangqi') as readonly XiangqiPuzzle[];
  assert.ok(puzzles.length > 0, 'corpus is non-empty');
  for (const puzzle of puzzles) {
    const result = validateStandardXiangqiPuzzle(puzzle);
    assert.ok(result.ok, `${puzzle.id} invalid: ${result.ok ? '' : result.issue.message}`);
  }
});

test('every seeded Jungle sourceGame replays to its puzzle position', () => {
  const puzzles = loadSeedPuzzleRegistry('jungle') as readonly JunglePuzzle[];
  const games = new Map(loadSeedSourceGames().jungle.map((game) => [game.id, game]));
  for (const puzzle of puzzles) {
    if (!puzzle.sourceGame) continue;
    const game = games.get(puzzle.sourceGame.gameId);
    assert.ok(game, `${puzzle.id} references missing source game ${puzzle.sourceGame.gameId}`);
    const replayed = replayJungleSourceGameToPly(game, puzzle.sourceGame.ply);
    assert.ok(replayed, `${puzzle.id} source game does not reach ply ${puzzle.sourceGame.ply}`);
    assert.deepEqual(replayed.board, puzzle.initial.board, `${puzzle.id} board mismatch`);
    assert.deepEqual(replayed.status, puzzle.initial.status, `${puzzle.id} turn mismatch`);
  }
});

test('every seeded Fortress sourceGame replays to its puzzle position', () => {
  const puzzles = loadSeedPuzzleRegistry('fortress-xiangqi') as readonly FortressXiangqiPuzzle[];
  const games = new Map(loadSeedSourceGames().fortressXiangqi.map((game) => [game.id, game]));
  for (const puzzle of puzzles) {
    if (!puzzle.sourceGame) continue;
    const game = games.get(puzzle.sourceGame.gameId);
    assert.ok(game, `${puzzle.id} references missing source game ${puzzle.sourceGame.gameId}`);
    const replayed = replayFortressXiangqiSourceGameToPly(game, puzzle.sourceGame.ply);
    assert.ok(replayed, `${puzzle.id} source game does not reach ply ${puzzle.sourceGame.ply}`);
    assert.deepEqual(replayed.board, puzzle.initial.board, `${puzzle.id} board mismatch`);
    assert.deepEqual(replayed.hands, puzzle.initial.hands, `${puzzle.id} hands mismatch`);
    assert.deepEqual(replayed.status, puzzle.initial.status, `${puzzle.id} turn mismatch`);
  }
});
