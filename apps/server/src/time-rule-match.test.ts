import assert from 'node:assert/strict';
import test from 'node:test';

import { pairElo, pentanomialLlr, sprtBoundsLlr } from './time-rule-match.js';

const BOUNDS = { elo0: 0, elo1: 15, alpha: 0.05, beta: 0.05 };

/** Pair scores with a given mean, spread like a real match (draw-heavy pairs). */
function pairs(n: number, winPairs: number, lossPairs: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i < winPairs) out.push(0.75);
    else if (i < winPairs + lossPairs) out.push(0.25);
    else out.push(0.5);
  }
  return out;
}

test('SPRT bounds are ±2.94 at alpha = beta = 0.05', () => {
  const { lower, upper } = sprtBoundsLlr(BOUNDS);
  assert.ok(Math.abs(upper - 2.944) < 0.001);
  assert.ok(Math.abs(lower + 2.944) < 0.001);
});

test('a clearly better arm crosses the upper bound; an equal one does not', () => {
  const { lower, upper } = sprtBoundsLlr(BOUNDS);
  // ~+35 elo over 1000 pairs: accept H1.
  assert.ok(pentanomialLlr(pairs(1000, 300, 200), BOUNDS.elo0, BOUNDS.elo1) > upper);
  // Dead even over 1000 pairs: H0 side, never H1.
  const even = pentanomialLlr(pairs(1000, 250, 250), BOUNDS.elo0, BOUNDS.elo1);
  assert.ok(even < 0 && even > lower * 3);
});

test('planted failure: a worse arm drives the LLR to the lower bound, not up', () => {
  const { lower } = sprtBoundsLlr(BOUNDS);
  assert.ok(pentanomialLlr(pairs(1000, 200, 300), BOUNDS.elo0, BOUNDS.elo1) < lower);
});

test('no spread yet means no evidence', () => {
  assert.equal(pentanomialLlr([0.5, 0.5, 0.5], 0, 15), 0);
  assert.equal(pentanomialLlr([1], 0, 15), 0);
});

test('pair elo is zero at an even score and signed by the winner', () => {
  assert.ok(Math.abs(pairElo(pairs(100, 20, 20)).elo) < 1e-9);
  assert.ok(pairElo(pairs(100, 30, 10)).elo > 0);
  assert.ok(pairElo(pairs(100, 10, 30)).elo < 0);
});
