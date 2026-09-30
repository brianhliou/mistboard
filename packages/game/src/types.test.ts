import assert from 'node:assert/strict';
import test from 'node:test';
import { gameEndReasons, isGameEndReason } from './types.js';

test('isGameEndReason accepts every value in gameEndReasons', () => {
  for (const reason of gameEndReasons) {
    assert.equal(isGameEndReason(reason), true, `expected ${reason} to be a valid GameEndReason`);
  }
});

test('isGameEndReason rejects unknown strings and non-strings', () => {
  assert.equal(isGameEndReason('engine-failure'), false);
  assert.equal(isGameEndReason('abandoned'), false);
  assert.equal(isGameEndReason(''), false);
  assert.equal(isGameEndReason('CHECKMATE'), false);
  assert.equal(isGameEndReason(null), false);
  assert.equal(isGameEndReason(undefined), false);
  assert.equal(isGameEndReason(42), false);
  assert.equal(isGameEndReason({}), false);
});

test('gameEndReasons covers exactly the known reasons', () => {
  assert.deepEqual([...gameEndReasons].sort(), [
    'abandonment',
    'checkmate',
    'draw',
    'king-captured',
    'no-legal-moves',
    'resignation',
    'timeout',
  ]);
});
