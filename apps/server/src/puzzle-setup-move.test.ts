import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  type XiangqiMove,
} from '@mistboard/game';
import { puzzleSetupMove, resetPuzzleSetupMoveCacheForTests } from './puzzle-setup-move.js';

const GAME: XiangqiMove[] = [
  { from: 'h3', to: 'h10' },
  { from: 'i10', to: 'h10' },
];

function puzzle(id: string, ply = 1) {
  let initial = createInitialXiangqiState(id);
  for (const move of GAME.slice(0, ply)) initial = applyStandardXiangqiMove(initial, move);
  return { id, initial, sourceGame: { gameId: 'hxq_src', ply } };
}

test('derives the capturing setup move from the source game and caches it', async () => {
  resetPuzzleSetupMoveCacheForTests();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return GAME;
  };
  const expected = { from: 'h3', to: 'h10', captured: { color: 'black', role: 'horse' } };
  assert.deepEqual(await puzzleSetupMove(puzzle('xq_a'), loader), expected);
  assert.deepEqual(await puzzleSetupMove(puzzle('xq_a'), loader), expected);
  assert.equal(loads, 1);
});

test('a missing source game or a mismatched replay yields no setup move', async () => {
  resetPuzzleSetupMoveCacheForTests();
  assert.equal(await puzzleSetupMove(puzzle('xq_b'), async () => null), null);
  assert.equal(await puzzleSetupMove(puzzle('xq_c'), async () => [{ from: 'b3', to: 'e3' }]), null);
  const { sourceGame: _drop, ...noSource } = puzzle('xq_d');
  assert.equal(await puzzleSetupMove(noSource, async () => GAME), null);
});

test('a loader error fails soft and is retried on the next request', async () => {
  resetPuzzleSetupMoveCacheForTests();
  assert.equal(
    await puzzleSetupMove(puzzle('xq_e'), async () => {
      throw new Error('pool down');
    }),
    null,
  );
  assert.ok(await puzzleSetupMove(puzzle('xq_e'), async () => GAME));
});
