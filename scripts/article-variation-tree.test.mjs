import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pruneCandidates, replyAlternatives } from './article-variation-tree.mjs';

const candidate = (cp) => ({ cp, pv: [`score-${cp}`] });

test('prunes a planted fourth candidate and every move beyond 60cp', () => {
  const scores = [100, 80, 40, 39, -400].map(candidate);
  assert.deepEqual(pruneCandidates(scores), scores.slice(0, 3));
  // This fixture fails if filtering is removed even while the max-three cap remains.
  assert.deepEqual(pruneCandidates([candidate(100), candidate(39), candidate(-400)]), [
    candidate(100),
  ]);
  assert.equal(pruneCandidates([100, 99, 98, 97].map(candidate)).length, 3);
});

test('only the second reply within 40cp is an alternative', () => {
  assert.deepEqual(replyAlternatives([100, 60, 59].map(candidate)), [candidate(60)]);
  assert.deepEqual(replyAlternatives([100, 59].map(candidate)), []);
  assert.deepEqual(replyAlternatives([candidate(100)]), []);
  assert.deepEqual(pruneCandidates([]), []);
});

test('does not compare mate scores with centipawns', () => {
  assert.deepEqual(pruneCandidates([{ mate: 3 }, { cp: 1000 }]), [{ mate: 3 }]);
  assert.deepEqual(replyAlternatives([{ cp: 100 }, { mate: -2 }]), []);
});
