import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MATCH_ADJUDICATION as ADJ,
  adjudicate,
  pairElo,
  pentanomialLlr,
  redScore,
  sprtBoundsLlr,
} from './time-rule-match.js';

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

test('redScore flips a black mover and reads mate as +-100000', () => {
  assert.equal(redScore(['info depth 9 score cp 120 nodes 5'], 'red'), 120);
  assert.equal(redScore(['info depth 9 score cp 120 nodes 5'], 'black'), -120);
  assert.equal(redScore(['info score cp 5', 'info depth 3 score mate -4'], 'red'), -100_000);
  assert.equal(redScore(['info string no score'], 'red'), null);
});

test('adjudication: a win needs six plies at 600+ for the same colour', () => {
  assert.equal(adjudicate([700, 650, 900, 610, 800, 600], 40, ADJ), 'red');
  assert.equal(adjudicate([-700, -650, -900, -610, -800, -600], 40, ADJ), 'black');
  // planted misses: five plies only, one ply below the bar, one null, a sign flip
  assert.equal(adjudicate([700, 650, 900, 610, 800], 40, ADJ), null);
  assert.equal(adjudicate([700, 650, 599, 610, 800, 600], 40, ADJ), null);
  assert.equal(adjudicate([700, 650, null, 610, 800, 600], 40, ADJ), null);
  assert.equal(adjudicate([700, 650, -900, 610, 800, 600], 40, ADJ), null);
});

test('adjudication: a draw needs ply 120 and twenty quiet plies', () => {
  const quiet = Array.from({ length: 20 }, (_, i) => (i % 2 ? -10 : 8));
  assert.equal(adjudicate(quiet, 120, ADJ), 'draw');
  // planted misses: too early, one ply over the band, one ply short
  assert.equal(adjudicate(quiet, 119, ADJ), null);
  assert.equal(adjudicate([...quiet.slice(0, 19), 11], 150, ADJ), null);
  assert.equal(adjudicate(quiet.slice(1), 150, ADJ), null);
});
