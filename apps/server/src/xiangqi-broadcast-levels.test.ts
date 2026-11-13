import assert from 'node:assert/strict';
import test from 'node:test';
import { xiangqiBroadcastTourLevel } from './xiangqi-broadcast-levels.js';

test('a sibling inherits its parent grade when it has no entry (#1074)', () => {
  assert.equal(xiangqiBroadcastTourLevel('2026-world-xiangqi-open-women'), 'B');
  assert.equal(xiangqiBroadcastTourLevel('2026-shanghai-cup-women'), 'A');
  assert.equal(xiangqiBroadcastTourLevel('2026-world-xiangqi-open-women-team'), 'B');
  assert.equal(xiangqiBroadcastTourLevel('unknown-women'), null);
  assert.equal(xiangqiBroadcastTourLevel('2026-world-xiangqi-open-unrecognised'), null);
});

test('an explicitly graded sibling keeps its own entry', () => {
  assert.equal(xiangqiBroadcastTourLevel('2026-asian-individual-women'), 'A');
  assert.equal(xiangqiBroadcastTourLevel('2026-asian-individual-men'), 'A');
});
