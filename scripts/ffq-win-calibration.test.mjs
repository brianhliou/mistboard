import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const data = JSON.parse(
  readFileSync(new URL('../docs/ffq-win-calibration-2026-11-13.json', import.meta.url), 'utf8'),
);

test('FFQ committed self-play sample reproduces the fitted optimum and improves on the previous scale', () => {
  assert.equal(data.engine, 'MistyFFQ 0.1.0');
  assert.equal(data.nodes, 25000);
  assert.equal(data.games.length, 300);
  assert.equal(new Set(data.games.map((g) => g.seed)).size, 300);
  let derivative = 0,
    fittedLoss = 0,
    previousLoss = 0,
    count = 0;
  for (const game of data.games) {
    assert.ok([0, 0.5, 1].includes(game.result));
    assert.ok(game.scores.length > 0);
    for (const cp of game.scores) {
      assert.ok(Number.isInteger(cp) && Math.abs(cp) <= 1000);
      const p = 1 / (1 + Math.exp(-data.fit.k * cp));
      const old = 1 / (1 + Math.exp(-0.00368208 * cp));
      derivative += (cp * (p - game.result)) / game.scores.length;
      const loss = (q) => -game.result * Math.log(q) - (1 - game.result) * Math.log(1 - q);
      fittedLoss += loss(p) / game.scores.length;
      previousLoss += loss(old) / game.scores.length;
      count++;
    }
  }
  assert.equal(count, 2004);
  assert.equal(data.fit.positions, count);
  assert.ok(Math.abs(derivative) < 1e-8, 'stationary point of convex logistic cross-entropy');
  assert.ok(fittedLoss < previousLoss);
});
