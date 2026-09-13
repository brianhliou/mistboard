import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCT_GAME_SPEC_IDS, PRODUCT_SERVER_FLAGS } from './product-profile.mjs';

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

test('product flags cover every launched spec plus the correspondence surface', () => {
  assert.ok(PRODUCT_SERVER_FLAGS.includes('MISTBOARD_CORRESPONDENCE_ENABLED'));
  assert.ok(PRODUCT_SERVER_FLAGS.includes('MISTBOARD_DARK_XIANGQI_ENABLED'));
  assert.equal(new Set(PRODUCT_SERVER_FLAGS).size, PRODUCT_SERVER_FLAGS.length);
});
