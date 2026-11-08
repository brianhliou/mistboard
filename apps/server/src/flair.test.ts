import assert from 'node:assert/strict';
import test from 'node:test';
import { isFlairKey, parseFlair } from './flair.js';

test('Gomoku flair is valid alongside existing Fog Chess and Atomic Xiangqi wearers', () => {
  for (const key of ['variant-gomoku', 'variant-dark-chess', 'variant-atomic-xiangqi']) {
    assert.equal(isFlairKey(key), true);
    assert.equal(parseFlair(key), key);
  }
});
