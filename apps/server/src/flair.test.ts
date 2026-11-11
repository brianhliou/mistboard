import assert from 'node:assert/strict';
import test from 'node:test';
import { FLAIR_KEYS, isFlairKey, parseFlair } from './flair.js';

test('Gomoku flair is valid alongside existing Fog Chess and Atomic Xiangqi wearers', () => {
  for (const key of ['variant-gomoku', 'variant-dark-chess', 'variant-atomic-xiangqi']) {
    assert.equal(isFlairKey(key), true);
    assert.equal(parseFlair(key), key);
  }
});

test('every piece from every set is a flair, and the Traditional keys keep their names', () => {
  const families = {
    variant: FLAIR_KEYS.filter((key) => key.startsWith('variant-')).length,
    xiangqi: FLAIR_KEYS.filter((key) => key.startsWith('piece-')).length,
    jungle: FLAIR_KEYS.filter((key) => key.startsWith('jungle-')).length,
    chess: FLAIR_KEYS.filter((key) => key.startsWith('chess-')).length,
  };
  // 9 xiangqi sets x 14, 8 animals x 2 sides, 6 chess roles x 2 sides.
  assert.deepEqual(families, { variant: 12, xiangqi: 126, jungle: 16, chess: 12 });
  assert.equal(new Set(FLAIR_KEYS).size, FLAIR_KEYS.length);
  // Stored on existing accounts before the other sets joined; renaming them
  // would orphan every wearer.
  for (const key of ['piece-red-general', 'piece-black-soldier', 'piece-red-cannon']) {
    assert.equal(parseFlair(key), key);
  }
  for (const key of [
    'piece-lacquer-red-chariot',
    'piece-animal-dobutsu-black-elephant',
    'piece-international-red-horse',
    'jungle-black-rat',
    'chess-white-knight',
  ]) {
    assert.equal(parseFlair(key), key);
  }
});

// The column's CHECK (122_user_flair.sql) is a shape guard. A key the
// allowlist accepts but the CHECK refuses would pass validation and then fail
// the UPDATE with a 500.
const FLAIR_COLUMN_SHAPE = /^[a-z0-9][a-z0-9-]{0,39}$/;

test('every flair key fits the column shape guard', () => {
  for (const key of FLAIR_KEYS) {
    assert.match(key, FLAIR_COLUMN_SHAPE, `${key} would fail the users.flair CHECK`);
  }
  // Planted: the guard is live, so a 41-character key fails it.
  assert.doesNotMatch(`piece-${'x'.repeat(35)}`, FLAIR_COLUMN_SHAPE);
});

test('unknown set, ink or role keys are rejected rather than cleared', () => {
  for (const key of [
    'piece-foo-red-general',
    'piece-traditional-red-general',
    'piece-lacquer-white-chariot',
    'jungle-red-king',
    'chess-red-king',
    'chess-white-chariot',
  ]) {
    assert.equal(isFlairKey(key), false, key);
    assert.equal(parseFlair(key), undefined, key);
  }
});
