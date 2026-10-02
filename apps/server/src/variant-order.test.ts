import assert from 'node:assert/strict';
import test from 'node:test';
import { CANONICAL_VARIANT_ORDER, isRetiredGameSpec } from '@mistboard/game';
import { rankVariants } from './variant-order.js';

test('rankVariants puts the most-played first and keeps the canonical order for ties', () => {
  const order = rankVariants([
    { variant: 'banqi', count: 9 },
    { variant: 'dark-chess', count: 4 },
    { variant: 'jungle', count: 4 },
  ]);
  assert.deepEqual(order.slice(0, 3), ['banqi', 'dark-chess', 'jungle']);
  // Every unplayed shelf spec follows, in canonical order.
  const rest = CANONICAL_VARIANT_ORDER.filter(
    (id) => !['banqi', 'dark-chess', 'jungle'].includes(id),
  );
  assert.deepEqual(order.slice(3), rest);
});

test('rankVariants with no games is the canonical shelf', () => {
  assert.deepEqual(rankVariants([]), [...CANONICAL_VARIANT_ORDER]);
});

test('rankVariants drops unknown and deleted ids, keeps a played off-shelf spec', () => {
  const order = rankVariants([
    { variant: 'not-a-variant', count: 50 },
    { variant: 'kriegspiel', count: 40 },
    { variant: 'chess', count: 2 },
  ]);
  assert.ok(!order.includes('not-a-variant'));
  assert.ok(!order.includes('kriegspiel'));
  assert.equal(order[0], 'chess');
  // An unplayed off-shelf spec is not listed.
  assert.ok(!order.includes('mahjong'));
  assert.ok(order.every((id) => !isRetiredGameSpec(id)));
});
