import assert from 'node:assert/strict';
import test from 'node:test';

import {
  correspondenceTimeControl,
  DAY_MS,
  DAYS_PER_MOVE_OPTIONS,
  defaultEngineTimeControl,
  engineTimeControlPin,
  findTimeControl,
  isAllowedEngineTimeControl,
  isOfficialCorrespondenceTimeControl,
  isOfficialTimeControl,
  isRatedTimeControl,
  RATED_TIME_CONTROLS,
  TIME_CONTROLS,
  timeClassFromTimeControl,
  VARIANT_DEFAULT_GAME_SPEC_IDS,
  variantDefaultTimeControl,
} from './time-controls.js';

test('TIME_CONTROLS lists the official Mistboard time controls', () => {
  assert.equal(TIME_CONTROLS.length, 4);
  assert.deepEqual(
    TIME_CONTROLS.map((tc) => tc.id),
    ['1m1', '3m2', '5m5', '10m5'],
  );
});

test('every rated pace sits in a time class user_ratings can store', () => {
  // bucketForGame writes spec.timeClass straight into user_ratings.time_class,
  // whose CHECK admits bullet/blitz/rapid only (migration 026). The type keeps
  // this honest at compile time; assert it too, so the reason is discoverable
  // from the test name when someone adds a slow rated pace.
  for (const tc of TIME_CONTROLS.filter((spec) => spec.rated)) {
    assert.ok(
      ['bullet', 'blitz', 'rapid'].includes(tc.timeClass),
      `${tc.id} is rated at an unstorable time class ${tc.timeClass}`,
    );
  }
});

test('10+5 shares the rapid bucket with 5+5, so it adds no rating pool', () => {
  assert.equal(timeClassFromTimeControl(300_000, 5_000), 'rapid');
  assert.equal(timeClassFromTimeControl(600_000, 5_000), 'rapid');
  // Casual-only on arrival: nothing it does can reach a rating bucket at all.
  assert.equal(findTimeControl(600_000, 5_000)?.rated, false);
});

test('TIME_CONTROLS entries have consistent label/initialMs derivation', () => {
  for (const tc of TIME_CONTROLS) {
    const minutes = tc.initialMs / 60_000;
    const seconds = tc.incrementMs / 1_000;
    assert.equal(tc.label, `${minutes} + ${seconds}`, `label drift for ${tc.id}`);
  }
});

test('findTimeControl returns the spec for exact-match inputs', () => {
  const spec = findTimeControl(180_000, 2_000);
  assert.ok(spec);
  assert.equal(spec.id, '3m2');
  assert.equal(spec.timeClass, 'blitz');
});

test('findTimeControl returns null for unknown time controls', () => {
  assert.equal(findTimeControl(120_000, 1_000), null);
  assert.equal(findTimeControl(60_000, 0), null);
  assert.equal(findTimeControl(300_000, 3_000), null);
  assert.equal(findTimeControl(null, null), null);
  assert.equal(findTimeControl(undefined, undefined), null);
});

test('timeClassFromTimeControl classifies each official TC correctly', () => {
  assert.equal(timeClassFromTimeControl(60_000, 1_000), 'bullet');
  assert.equal(timeClassFromTimeControl(180_000, 2_000), 'blitz');
  assert.equal(timeClassFromTimeControl(300_000, 5_000), 'rapid');
});

test('timeClassFromTimeControl classifies UNOFFICIAL paces by formula', () => {
  // lichess's rule (initial + 40 x increment), bands from lila Speed.scala.
  // This deliberately no longer returns null for an off-table pace: labels are
  // a display concern, and a loadtest or hand-crafted room still deserves one.
  assert.equal(timeClassFromTimeControl(120_000, 1_000), 'bullet'); // 160s
  assert.equal(timeClassFromTimeControl(60_000, 0), 'bullet'); // 60s
  assert.equal(timeClassFromTimeControl(300_000, 3_000), 'blitz'); // 420s
  assert.equal(timeClassFromTimeControl(600_000, 0), 'rapid'); // 600s
  assert.equal(timeClassFromTimeControl(1_800_000, 0), 'classical'); // 1800s
});

test('timeClassFromTimeControl is null only when there is no clock', () => {
  assert.equal(timeClassFromTimeControl(null, null), null);
  assert.equal(timeClassFromTimeControl(undefined, undefined), null);
});

test('band edges land on lichess boundaries', () => {
  // Ranges are inclusive-low in lila (blitz = 180..479), so the estimate that
  // lands exactly on a boundary belongs to the SLOWER class.
  assert.equal(timeClassFromTimeControl(179_000, 0), 'bullet');
  assert.equal(timeClassFromTimeControl(180_000, 0), 'blitz');
  assert.equal(timeClassFromTimeControl(479_000, 0), 'blitz');
  assert.equal(timeClassFromTimeControl(480_000, 0), 'rapid');
  assert.equal(timeClassFromTimeControl(1_499_000, 0), 'rapid');
  assert.equal(timeClassFromTimeControl(1_500_000, 0), 'classical');
});

test('classifying a pace never makes it official or rated', () => {
  // The whole safety argument for widening the classifier: rating buckets and
  // the server allowlists resolve through findTimeControl, not through this.
  assert.equal(timeClassFromTimeControl(600_000, 0), 'rapid');
  assert.equal(findTimeControl(600_000, 0), null);
  assert.equal(isOfficialTimeControl({ initialMs: 600_000, incrementMs: 0 }), false);
  assert.equal(isRatedTimeControl({ initialMs: 600_000, incrementMs: 0 }), false);
});

test('isOfficialTimeControl gates loadtest/PVE allowlists', () => {
  assert.equal(isOfficialTimeControl({ initialMs: 180_000, incrementMs: 2_000 }), true);
  assert.equal(isOfficialTimeControl({ initialMs: 600_000, incrementMs: 0 }), false);
});

test('correspondenceTimeControl mirrors the allowance into initialMs', () => {
  for (const days of DAYS_PER_MOVE_OPTIONS) {
    const tc = correspondenceTimeControl(days);
    assert.equal(tc.initialMs, days * DAY_MS);
    assert.equal(tc.incrementMs, 0);
    assert.equal(tc.daysPerMove, days);
  }
});

test('isOfficialCorrespondenceTimeControl accepts only the official shapes', () => {
  assert.equal(isOfficialCorrespondenceTimeControl(correspondenceTimeControl(3)), true);
  // Unknown day count.
  assert.equal(
    isOfficialCorrespondenceTimeControl({ initialMs: 2 * DAY_MS, incrementMs: 0, daysPerMove: 2 }),
    false,
  );
  // Allowance must mirror initialMs.
  assert.equal(
    isOfficialCorrespondenceTimeControl({ initialMs: DAY_MS, incrementMs: 0, daysPerMove: 3 }),
    false,
  );
  // Increment is meaningless under days-per-move.
  assert.equal(
    isOfficialCorrespondenceTimeControl({
      initialMs: 3 * DAY_MS,
      incrementMs: 1_000,
      daysPerMove: 3,
    }),
    false,
  );
  // A live time control is not a correspondence one.
  assert.equal(
    isOfficialCorrespondenceTimeControl({ initialMs: 180_000, incrementMs: 2_000 }),
    false,
  );
});

test('every official live pace is rated-eligible', () => {
  assert.deepEqual(
    RATED_TIME_CONTROLS.map((tc) => tc.id),
    ['1m1', '3m2', '5m5'],
  );
  for (const tc of TIME_CONTROLS) {
    assert.equal(
      isRatedTimeControl({ initialMs: tc.initialMs, incrementMs: tc.incrementMs }),
      tc.rated,
      `rated flag drift for ${tc.id}`,
    );
  }
});

test('rated eligibility rejects unofficial and correspondence paces', () => {
  assert.equal(isRatedTimeControl({ initialMs: 240_000, incrementMs: 0 }), false);
  // Correspondence can never be rated: engine assistance is unenforceable at
  // days-per-move, and the perfect-information correspondence allowance rests
  // on it staying casual.
  assert.equal(isRatedTimeControl(correspondenceTimeControl(1)), false);
  // Including a forged claim whose ms values collide with a live spec.
  assert.equal(
    isRatedTimeControl({ initialMs: 180_000, incrementMs: 2_000, daysPerMove: 1 }),
    false,
  );
});

test('the live allowlist rejects correspondence time controls', () => {
  assert.equal(isOfficialTimeControl(correspondenceTimeControl(1)), false);
  // Even a malformed claim whose ms values collide with a live spec.
  assert.equal(
    isOfficialTimeControl({ initialMs: 180_000, incrementMs: 2_000, daysPerMove: 1 }),
    false,
  );
});

// Fog Chess Misty cannot honor a 1s or 2s increment: its per-move cost has a
// floor the increment does not cover, so it drains its bank and loses on time
// in long games (#283). Both the picker and the create route derive from this.
test('the engine pin scopes fog bot games to 5+5', () => {
  const pin = engineTimeControlPin('dark-chess');
  assert.equal(pin?.id, '5m5');
  // Fog xiangqi runs its own belief stack, pinned on the shared-mechanism
  // argument rather than its own measured flag.
  assert.equal(engineTimeControlPin('dark-xiangqi')?.id, '5m5');

  assert.equal(
    isAllowedEngineTimeControl('dark-chess', { initialMs: 300_000, incrementMs: 5_000 }),
    true,
  );
  assert.equal(
    isAllowedEngineTimeControl('dark-chess', { initialMs: 180_000, incrementMs: 2_000 }),
    false,
  );
  assert.equal(
    isAllowedEngineTimeControl('dark-xiangqi', { initialMs: 180_000, incrementMs: 2_000 }),
    false,
  );
});

test('unpinned specs accept every pace their own allowlist offers', () => {
  // Engines with a bounded per-move cost are absent from the pin map; the
  // variant's own time-control allowlist stays the only constraint on them.
  assert.equal(engineTimeControlPin('xiangqi'), null);
  assert.equal(engineTimeControlPin('banqi'), null);
  for (const tc of TIME_CONTROLS) {
    assert.equal(
      isAllowedEngineTimeControl('xiangqi', {
        initialMs: tc.initialMs,
        incrementMs: tc.incrementMs,
      }),
      true,
    );
  }
});

test('variantDefaultTimeControl: deliberate variants opt out of the house pace', () => {
  assert.equal(variantDefaultTimeControl('jieqi').id, '10m5');
  assert.equal(variantDefaultTimeControl('xiangqi').id, '10m5');
  // Everything else keeps 3+2, including a spec with no entry at all.
  assert.equal(variantDefaultTimeControl('banqi').id, '3m2');
  assert.equal(variantDefaultTimeControl('fortress-xiangqi').id, '3m2');
  assert.equal(variantDefaultTimeControl('not-a-real-spec').id, '3m2');
});

test('defaultEngineTimeControl: pin outranks the variant default', () => {
  // The precedence the web chip (landing-bot-policy offerPace) and the server
  // create route (routes/rooms.ts) BOTH have to apply, or one advertises a pace
  // the other does not start. A pin is a hard constraint (#283); a variant
  // default is only a preference.
  assert.equal(defaultEngineTimeControl('dark-chess').id, '5m5');
  assert.equal(defaultEngineTimeControl('dark-xiangqi').id, '5m5');
  assert.equal(defaultEngineTimeControl('jieqi').id, '10m5');
  assert.equal(defaultEngineTimeControl('banqi').id, '3m2');
});

test('every variant default is a real, offerable pace', () => {
  for (const gameSpecId of VARIANT_DEFAULT_GAME_SPEC_IDS) {
    const spec = variantDefaultTimeControl(gameSpecId);
    assert.ok(
      TIME_CONTROLS.some((tc) => tc.id === spec.id),
      `${gameSpecId} defaults to unknown pace ${spec.id}`,
    );
  }
});
