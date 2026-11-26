import assert from 'node:assert/strict';
import test from 'node:test';
import { TIME_CONTROLS } from '@mistboard/game';
import {
  KATAGO_JUNGLE_COLD_MIN_MOVE_MS,
  KATAGO_JUNGLE_MIN_MOVE_MS,
  KATAGO_JUNGLE_STARTUP_MS,
  KATAGO_JUNGLE_WARM_OVERHEAD_MS,
  katagoStageSeconds,
  katagoStageSecondsForMove,
} from './jungle-katago-engine.js';
import { clockCoverageViolations, KATAGO_JUNGLE_MODE_FLOORS } from './jungle-katago-time.js';

test('every offered time control is covered by the seat on its loaded process', () => {
  assert.deepEqual(clockCoverageViolations(KATAGO_JUNGLE_MODE_FLOORS, TIME_CONTROLS), []);
  // The stages are wall-time bounds the engine keeps itself; what prod can stretch
  // is the overhead around them. Doubled, every pace is still covered.
  const doubled = KATAGO_JUNGLE_MODE_FLOORS.map((mode) => ({
    ...mode,
    floorMs: mode.floorMs + KATAGO_JUNGLE_WARM_OVERHEAD_MS,
  }));
  assert.deepEqual(clockCoverageViolations(doubled, TIME_CONTROLS), []);
  // No mode cheaper than KataGo itself: the seat has no fallback engine.
  assert.deepEqual(
    KATAGO_JUNGLE_MODE_FLOORS.map((mode) => mode.id),
    ['katago-warm'],
  );
});

test('the guard catches an engine whose cheapest move outruns the increment', () => {
  // Planted failure: the 2026-11-12 seat, which started a process for every move.
  const coldEveryMove = [{ id: 'katago-cold', floorMs: KATAGO_JUNGLE_COLD_MIN_MOVE_MS }];
  const violations = clockCoverageViolations(coldEveryMove, TIME_CONTROLS);
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

test('the floors are the measured ones', () => {
  assert.equal(KATAGO_JUNGLE_MIN_MOVE_MS, 850);
  assert.ok(KATAGO_JUNGLE_MIN_MOVE_MS < 1_000, 'under the 1+1 increment');
  assert.equal(KATAGO_JUNGLE_COLD_MIN_MOVE_MS, 2_250);
  assert.ok(KATAGO_JUNGLE_STARTUP_MS > 1_000);
});

test('a move sizes its stages to the budget left when it reaches the process', () => {
  // With time to spare it is the ceiling split it always was.
  assert.equal(katagoStageSecondsForMove(6_000, 0), katagoStageSeconds(6_000));
  assert.equal(katagoStageSecondsForMove(6_000, 0), 2.5);
  assert.equal(katagoStageSecondsForMove(4_000, 0), katagoStageSeconds(4_000));
  // Never under the minimum stage, however late it arrives.
  assert.equal(katagoStageSecondsForMove(800, 5_000), 0.3);
  for (const budget of [850, 1_000, 1_500, 2_600, 4_800, 6_000]) {
    for (const waited of [0, 200, KATAGO_JUNGLE_STARTUP_MS]) {
      const stageMs = Math.round(katagoStageSecondsForMove(budget, waited) * 1000);
      const wallMs = waited + 2 * stageMs + KATAGO_JUNGLE_WARM_OVERHEAD_MS;
      if (budget - waited >= KATAGO_JUNGLE_MIN_MOVE_MS) {
        assert.ok(wallMs <= budget + 1, `${wallMs} ms against ${budget} after ${waited}`);
      } else {
        assert.equal(stageMs, 300, `${budget} after ${waited} plays the minimum`);
      }
    }
  }
});
