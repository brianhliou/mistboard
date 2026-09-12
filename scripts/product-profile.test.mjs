import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAB_SERVER_FLAGS,
  PRODUCT_GAME_SPEC_IDS,
  PRODUCT_SERVER_FLAGS,
  serverFlagsForProfile,
} from './product-profile.mjs';

test('product profile contains exactly the intended live game specs', () => {
  assert.deepEqual(PRODUCT_GAME_SPEC_IDS, [
    'xiangqi',
    'fortress-xiangqi',
    'duck-xiangqi',
    'banqi',
    'jungle',
    'jungle-flip',
    'jieqi',
    'dark-xiangqi',
    'dark-chess',
  ]);
});

test('product flags are a subset of the lab profile', () => {
  assert.deepEqual(serverFlagsForProfile('product'), PRODUCT_SERVER_FLAGS);
  assert.deepEqual(serverFlagsForProfile('lab'), LAB_SERVER_FLAGS);
  assert.ok(PRODUCT_SERVER_FLAGS.every((flag) => LAB_SERVER_FLAGS.includes(flag)));
  // Luzhanqi was the last lab-only surface (deleted 2026-09-12, #396), so the
  // two profiles are equal until something new parks behind a lab flag.
  assert.ok(LAB_SERVER_FLAGS.length >= PRODUCT_SERVER_FLAGS.length);
  assert.throws(() => serverFlagsForProfile('unknown'), /unknown development profile/);
});
