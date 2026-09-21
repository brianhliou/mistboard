import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CENTRAL_CANNON_SCREEN_HORSES,
  CENTRAL_CANNON_SCREEN_HORSES_MIRRORED,
  ELEPHANT_OPENING,
} from './fixtures.js';
import { matchesOpening, parsePlacement } from './opening-match.js';

const SHAPE = {
  name: 'Central Cannon vs Screen Horses',
  byPly: 8,
  red: ['C@e3'],
  black: ['H@c8', 'H@g8'],
};

test('placements parse piece letter and square', () => {
  assert.deepEqual(parsePlacement('red', 'C@e3'), { color: 'red', role: 'cannon', square: 'e3' });
  assert.deepEqual(parsePlacement('black', 'H@c8'), {
    color: 'black',
    role: 'horse',
    square: 'c8',
  });
  assert.throws(() => parsePlacement('red', 'X@e3'));
});

test('the mainline matches the shape', () => {
  assert.equal(matchesOpening(CENTRAL_CANNON_SCREEN_HORSES, SHAPE), true);
});

test('the mirrored line matches the same shape', () => {
  assert.equal(matchesOpening(CENTRAL_CANNON_SCREEN_HORSES_MIRRORED, SHAPE), true);
});

test('an elephant opening does not match', () => {
  assert.equal(matchesOpening(ELEPHANT_OPENING, SHAPE), false);
});

test('a game shorter than byPly does not match', () => {
  assert.equal(matchesOpening(CENTRAL_CANNON_SCREEN_HORSES.slice(0, 5), SHAPE), false);
});

test('the shape is tested as one unit, never half mirrored', () => {
  // Red central cannon with black horses on b8/h8 would need c8 AND g8; asking
  // for c8 alone with a mirrored g-file horse must not pass.
  const halfShape = { name: 'x', byPly: 8, red: ['C@e3'], black: ['H@c8', 'H@b8'] };
  assert.equal(matchesOpening(CENTRAL_CANNON_SCREEN_HORSES, halfShape), false);
});
