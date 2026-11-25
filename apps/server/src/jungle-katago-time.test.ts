import assert from 'node:assert/strict';
import test from 'node:test';
import { TIME_CONTROLS } from '@mistboard/game';
import {
  KATAGO_JUNGLE_MIN_MOVE_MS,
  KATAGO_JUNGLE_STARTUP_MS,
  katagoMovetimeCapForBudget,
  katagoPredictedWallMs,
} from './jungle-katago-engine.js';
import {
  clockCoverageViolations,
  KATAGO_JUNGLE_MODE_FLOORS,
  katagoJungleMoveMode,
  MISTY_LIGHT_MIN_MOVE_MS,
  mistyLightMovetimeMs,
} from './jungle-katago-time.js';

test('every offered time control is covered by the seat cheapest mode', () => {
  assert.deepEqual(clockCoverageViolations(KATAGO_JUNGLE_MODE_FLOORS, TIME_CONTROLS), []);
  // Prod may run up to 2x slower than the measured floors; still covered.
  const doubled = KATAGO_JUNGLE_MODE_FLOORS.map((mode) => ({ ...mode, floorMs: mode.floorMs * 2 }));
  assert.deepEqual(clockCoverageViolations(doubled, TIME_CONTROLS), []);
});

test('the guard catches an engine whose cheapest move outruns the increment', () => {
  // Planted failure: a seat whose only mode is KataGo (the 2026-11-12 seat).
  const katagoOnly = [{ id: 'katago', floorMs: KATAGO_JUNGLE_MIN_MOVE_MS }];
  const violations = clockCoverageViolations(katagoOnly, TIME_CONTROLS);
  // 3+2 is 250 ms short a move at the floor, which its 180 s bank covers.
  assert.deepEqual(
    violations.map((v) => v.id),
    ['1m1'],
  );
  // 1+1: 1,250 ms short a move, 200 moves, against a 60 s bank.
  assert.equal(violations[0]!.shortfallMs, 1_250 * 200 - 60_000);
  // A fake engine 500 ms over a 1 s increment, at a pace that is otherwise fine.
  const fake = [{ id: 'fake', floorMs: 1_500 }];
  assert.equal(
    clockCoverageViolations(fake, [{ id: '1m1', initialMs: 60_000, incrementMs: 1_000 }]).length,
    1,
  );
  // A long enough bank covers the same shortfall.
  assert.deepEqual(
    clockCoverageViolations(fake, [{ id: 'long', initialMs: 100_000, incrementMs: 1_000 }]),
    [],
  );
});

test('KataGo plays only when the budget covers its floor', () => {
  assert.equal(KATAGO_JUNGLE_MIN_MOVE_MS, 2_250);
  assert.equal(katagoJungleMoveMode(KATAGO_JUNGLE_MIN_MOVE_MS, 'misty'), 'katago');
  assert.equal(katagoJungleMoveMode(KATAGO_JUNGLE_MIN_MOVE_MS - 1, 'misty'), 'misty');
  assert.equal(katagoJungleMoveMode(800, 'misty-ts'), 'misty-ts');
  assert.ok(MISTY_LIGHT_MIN_MOVE_MS < 1_000);
  assert.equal(mistyLightMovetimeMs(10), 50);
  assert.equal(mistyLightMovetimeMs(830), 800);
});

test('a KataGo move below the ceiling is predicted to fit its budget', () => {
  assert.equal(katagoMovetimeCapForBudget(6_000, 6_000), 6_000);
  assert.equal(katagoMovetimeCapForBudget(9_000, 6_000), 6_000);
  for (const budget of [2_250, 2_600, 3_400, 4_800, 5_999]) {
    const cap = katagoMovetimeCapForBudget(budget, 6_000);
    assert.ok(cap <= budget, `cap ${cap} within ${budget}`);
    assert.ok(
      katagoPredictedWallMs(cap) <= budget + 1,
      `${katagoPredictedWallMs(cap)} ms predicted against ${budget}`,
    );
  }
  assert.ok(KATAGO_JUNGLE_STARTUP_MS > 1_000);
});
