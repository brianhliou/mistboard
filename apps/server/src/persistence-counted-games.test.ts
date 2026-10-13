import assert from 'node:assert/strict';
import test from 'node:test';
import { RETIRED_GAME_SPEC_IDS } from '@mistboard/game';
import {
  countedHumanGame,
  countedPublicGame,
  notRetiredVariant,
} from './persistence-counted-games.js';

test('notRetiredVariant excludes every retired spec id, derived from the registry', () => {
  assert.ok(RETIRED_GAME_SPEC_IDS.includes('fortress-xiangqi'));
  assert.ok(RETIRED_GAME_SPEC_IDS.includes('atomic-xiangqi'));
  const clause = notRetiredVariant('g');
  assert.match(clause, /^g\.variant NOT IN \(/);
  for (const id of RETIRED_GAME_SPEC_IDS) assert.ok(clause.includes(`'${id}'`), id);
  assert.ok(!clause.includes("'xiangqi'"));
});

test('notRetiredVariant is a no-op with nothing retired and refuses a non-id', () => {
  assert.equal(notRetiredVariant('g', []), 'TRUE');
  assert.equal(notRetiredVariant('x', ['a-b']), "x.variant NOT IN ('a-b')");
  assert.throws(() => notRetiredVariant('g', ["x'); DROP TABLE games; --"]));
});

test('countedPublicGame is the counted-game filter plus the retired-variant exclusion', () => {
  const clause = countedPublicGame('g');
  assert.ok(clause.startsWith(countedHumanGame('g')));
  assert.ok(clause.includes(notRetiredVariant('g')));
  // The admin and readout filter stays untouched.
  assert.ok(!countedHumanGame('g').includes('NOT IN'));
});
