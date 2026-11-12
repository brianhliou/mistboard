import assert from 'node:assert/strict';
import test from 'node:test';
import { TIME_CONTROLS } from '@mistboard/game';
import { CALIBRATION_POSITIONS, pacingCalibrationFixtures } from './engine-pacing-fixtures.js';
import { PACING_LEGAL_MEDIANS, replyPace } from './engine-reply-pacing.js';
import { liveBotMoveTime } from './engine-time-budget.js';

test('200 distinct legal positions per variant reproduce the committed medians', () => {
  const fixtures = pacingCalibrationFixtures();
  assert.equal(fixtures.length, 10);
  assert.deepEqual(fixtures.map((f) => f.variant).sort(), Object.keys(PACING_LEGAL_MEDIANS).sort());
  for (const { variant, positions, median } of fixtures) {
    assert.equal(positions.length, CALIBRATION_POSITIONS);
    assert.equal(new Set(positions.map((p) => p.key)).size, CALIBRATION_POSITIONS, variant);
    assert.equal(median, PACING_LEGAL_MEDIANS[variant], variant);
    const targets = positions.map(
      (position) =>
        replyPace({
          ...position,
          variant,
          roomId: 'calibration',
          remainingMs: null,
          incrementMs: 0,
          computeMs: 80,
          cp: null,
          mate: null,
          enabled: true,
        }).targetMs,
    );
    assert.ok(new Set(targets).size > 50, variant);
  }
});

test('whole-game clock simulations spend full budgets plus holds without crossing the reserve', () => {
  const controls = [{ initialMs: 60_000, incrementMs: 0 }, ...TIME_CONTROLS];
  for (const { variant, positions } of pacingCalibrationFixtures()) {
    for (const tc of controls) {
      for (const rule of ['flat', 'phase', 'native'] as const) {
        for (const side of [0, 1]) {
          let remainingMs = tc.initialMs;
          for (let move = 0; move < positions.length; move++) {
            const input = {
              variant,
              rule,
              engineId: variant === 'jieqi' ? 'jqe-jieqi' : 'pikafish-xiangqi-level-8',
              roomId: `sim-${variant}-${side}`,
              ply: move * 2 + side,
              legalCount: positions[move]!.legalCount,
              ...tc,
              remainingMs,
              ceilingMs: 8_000,
              flatReserveMs: 1_000,
              floorMs: 50,
              engineVsEngine: false,
              pacingEnabled: true,
            };
            const computeMs = liveBotMoveTime(input).movetimeMs;
            // cp 0 is the longest wait the balance rule allows, so the reserve is checked at its worst.
            const pace = replyPace({ ...input, computeMs, cp: 0, mate: null, enabled: true });
            remainingMs -= computeMs + pace.waitMs;
            assert.ok(
              remainingMs >= Math.max(5_000, tc.initialMs * 0.1),
              `${variant} ${rule} ${tc.initialMs}+${tc.incrementMs} side=${side} move=${move}: ${remainingMs}`,
            );
            remainingMs += tc.incrementMs;
          }
        }
      }
    }
  }
});
