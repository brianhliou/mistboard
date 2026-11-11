/**
 * Named openings for the explorer header. The pins that matter: an established
 * name resolves for the real position a game reaches, a name is mirror-invariant
 * (a line and its mirror are one opening), and a pending name never leaks out
 * before it is confirmed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  standardXiangqiPositionKey,
  type XiangqiMove,
} from '@mistboard/game';
import { canonicalPosition, mirrorMove } from './xiangqi-opening-mirror.js';
import * as openingNames from './xiangqi-opening-names.js';

const { allOpeningNames, openingNameForCanonicalKey } = openingNames;

function canonicalKeyAfter(...pairs: Array<[string, string]>): string {
  let state = createInitialXiangqiState('t');
  for (const [from, to] of pairs) {
    state = applyStandardXiangqiMove(state, { from, to } as XiangqiMove);
  }
  return canonicalPosition(standardXiangqiPositionKey(state)).key;
}

function nameAfter(...pairs: Array<[string, string]>): { en: string; zh: string } | null {
  return openingNameForCanonicalKey(canonicalKeyAfter(...pairs));
}

test('names the Central Cannon from the position a game actually reaches', () => {
  assert.deepEqual(nameAfter(['b3', 'e3']), { en: 'Central Cannon', zh: '中炮' });
});

test('the central cannon from either side is one opening', () => {
  // 炮二平五 and 炮八平五 are mirror images. Both must resolve to the same name,
  // which is the whole reason the table is keyed by the canonical position.
  const right = nameAfter(['b3', 'e3']);
  const left = nameAfter(['h3', 'e3']);
  assert.deepEqual(right, left);
  assert.deepEqual(left, { en: 'Central Cannon', zh: '中炮' });
});

test('names the other established first-move openings', () => {
  assert.deepEqual(nameAfter(['c1', 'e3']), { en: 'Elephant Opening', zh: '飞相局' });
  assert.deepEqual(nameAfter(['b1', 'c3']), { en: 'Horse Opening', zh: '起马局' });
  assert.deepEqual(nameAfter(['c4', 'c5']), { en: 'Pawn Opening', zh: '仙人指路' });
});

test('a pending name is data but never served', () => {
  const pending = allOpeningNames().filter((name) => name.status === 'pending');
  assert.ok(pending.length > 0, 'this test is meaningless if nothing is pending');
  for (const name of pending) {
    assert.equal(
      openingNameForCanonicalKey(name.key),
      null,
      `${name.en} is pending and must not resolve until confirmed`,
    );
  }
});

test('an unnamed position resolves to null', () => {
  assert.equal(nameAfter(['b1', 'c3'], ['b10', 'c8'], ['h1', 'g3'], ['h10', 'g8']), null);
});

test('every stored key is already mirror-canonical', () => {
  // A key that is not its own canonical form could never be hit by the route,
  // which always looks up the canonical key — a silent dead entry.
  for (const name of allOpeningNames()) {
    assert.equal(
      canonicalPosition(name.key).key,
      name.key,
      `${name.en} is keyed by a non-canonical position and would never resolve`,
    );
  }
});

test('established openings and their mirrors resolve to stable slugs', () => {
  const cases: Array<{ move: XiangqiMove; slug: string }> = [
    { move: { from: 'b3', to: 'e3' }, slug: 'central-cannon' },
    { move: { from: 'c1', to: 'e3' }, slug: 'elephant-opening' },
    { move: { from: 'b1', to: 'c3' }, slug: 'horse-opening' },
    { move: { from: 'c4', to: 'c5' }, slug: 'pawn-opening' },
  ];
  for (const { move, slug } of cases) {
    for (const played of [move, mirrorMove(move)]) {
      const key = canonicalKeyAfter([played.from, played.to]);
      assert.equal(openingNames.openingSlugForCanonicalKey(key), slug);
    }
  }
});

test('pending openings never resolve to a slug', () => {
  const pending = allOpeningNames().filter((name) => name.status === 'pending');
  assert.ok(pending.length > 0);
  for (const name of pending) {
    assert.equal(openingNames.openingSlugForCanonicalKey(name.key), null, name.en);
  }
});

test('unnamed positions and unknown keys have no opening slug', () => {
  const keys = [
    canonicalKeyAfter(),
    canonicalKeyAfter(['b1', 'c3'], ['b10', 'c8'], ['h1', 'g3'], ['h10', 'g8']),
    '',
    'unknown',
    '__proto__',
    'constructor',
  ];
  for (const key of keys) {
    assert.equal(openingNames.openingSlugForCanonicalKey(key), null, key);
  }
  // The side to move participates in the identity; a similar placement is not a match.
  const cannon = canonicalKeyAfter(['b3', 'e3']);
  assert.equal(openingNames.openingSlugForCanonicalKey(cannon.replace(/ b$/, ' r')), null);
});

test('opening slugs are explicit unique URL segments in the naming registry', () => {
  const slugs = allOpeningNames().map((name) => name.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) {
    assert.match(slug, /^[a-z]+(?:-[a-z]+)*$/);
  }
});
