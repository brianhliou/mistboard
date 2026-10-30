import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInfoScore } from './uci-engine-harness.js';

test('parseInfoScore reads depth + cp + pv from a scored info line', () => {
  const s = parseInfoScore('info depth 18 seldepth 24 multipv 1 score cp 47 nodes 1 pv h2e2');
  assert.deepEqual(s, {
    index: 1,
    depth: 18,
    cp: 47,
    mate: null,
    pv: ['h2e2'],
    nodes: 1,
    timeMs: null,
    bound: null,
  });
});

test('parseInfoScore reads a mate score and leaves cp null', () => {
  const s = parseInfoScore('info depth 30 score mate -3 nodes 9 pv a0a1');
  assert.deepEqual(s, {
    index: 1,
    depth: 30,
    cp: null,
    mate: -3,
    pv: ['a0a1'],
    nodes: 9,
    timeMs: null,
    bound: null,
  });
});

test('parseInfoScore captures the full multi-move pv', () => {
  const s = parseInfoScore('info depth 12 score cp -15 nodes 400 pv h2e2 h9g7 b2b6');
  assert.deepEqual(s, {
    index: 1,
    depth: 12,
    cp: -15,
    mate: null,
    pv: ['h2e2', 'h9g7', 'b2b6'],
    nodes: 400,
    timeMs: null,
    bound: null,
  });
});

test('parseInfoScore returns an empty pv for a scored line without one', () => {
  const s = parseInfoScore('info depth 4 score cp 12 nodes 100');
  assert.deepEqual(s, {
    index: 1,
    depth: 4,
    cp: 12,
    mate: null,
    pv: [],
    nodes: 100,
    timeMs: null,
    bound: null,
  });
});

test('parseInfoScore reads nodes + time for truncation telemetry', () => {
  const s = parseInfoScore('info depth 7 nodes 1500000 time 4820 score cp 33 pv b2b3');
  assert.deepEqual(s, {
    index: 1,
    depth: 7,
    cp: 33,
    mate: null,
    pv: ['b2b3'],
    nodes: 1_500_000,
    timeMs: 4820,
    bound: null,
  });
});

test('parseInfoScore ignores score-less and non-info lines', () => {
  assert.equal(parseInfoScore('info depth 1 nodes 20 nps 20000'), undefined);
  assert.equal(parseInfoScore('info string NNUE ready'), undefined);
  assert.equal(parseInfoScore('bestmove h2e2'), undefined);
  assert.equal(parseInfoScore('info string diagnostic score cp 999 pv h2e2'), undefined);
});

test('parseInfoScore retains an explicit MultiPV rank', () => {
  assert.equal(parseInfoScore('info depth 12 multipv 2 score cp -15 pv h2e2')?.index, 2);
});

test('parseInfoScore rejects invalid MultiPV ranks', () => {
  for (const index of ['0', '-1', '1.5', 'NaN', 'Infinity']) {
    assert.equal(parseInfoScore(`info depth 12 multipv ${index} score cp -15 pv h2e2`), undefined);
  }
});

// A search that runs out of budget mid-iteration emits a fail-high/fail-low line
// LAST, before `bestmove`: the score is only a bound and the pv is usually one
// move. Taking it as the result truncated 38% of the PVs in a 156-ply game and
// moved evals by up to 163cp, which is what hid the only blunder in it.
test('parseInfoScore flags a lowerbound line and still reports its fields', () => {
  const s = parseInfoScore(
    'info depth 21 seldepth 33 multipv 1 score cp -34 lowerbound nodes 1000174 time 849 pv g3f1',
  );
  assert.equal(s?.bound, 'lower');
  assert.equal(s?.cp, -34);
  assert.deepEqual(s?.pv, ['g3f1']);
});

test('parseInfoScore flags an upperbound line', () => {
  assert.equal(
    parseInfoScore('info depth 9 score cp 12 upperbound nodes 5 pv b0c2')?.bound,
    'upper',
  );
});

test('parseInfoScore leaves bound null on a normal completed iteration', () => {
  assert.equal(
    parseInfoScore('info depth 20 score cp -35 nodes 704074 pv g3f1 b4b5 e2g4')?.bound,
    null,
  );
});
