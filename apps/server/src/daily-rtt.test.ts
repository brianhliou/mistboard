import assert from 'node:assert/strict';
import test from 'node:test';
import { DailyRttAccumulator } from './daily-rtt.js';

const at = Date.parse('2026-10-23T12:00:00Z');
const dayMs = 86_400_000;

test('daily RTT reports nearest-rank percentiles from unsorted raw samples', () => {
  const daily = new DailyRttAccumulator();
  for (let n = 100; n >= 1; n -= 1) daily.record('asia', n, at);
  assert.deepEqual(daily.snapshot(at, [0, 50, 95, 100]).global, {
    samples: 100,
    p50: 50,
    p95: 95,
    p99: 99,
    max: 100,
    aboveThreshold: [
      { thresholdMs: 0, samples: 100, share: 1 },
      { thresholdMs: 50, samples: 50, share: 0.5 },
      { thresholdMs: 95, samples: 5, share: 0.05 },
      { thresholdMs: 100, samples: 0, share: 0 },
    ],
  });
});

test('daily RTT distinguishes no samples from zero latency and preserves fractional samples', () => {
  const daily = new DailyRttAccumulator();
  assert.deepEqual(daily.snapshot(at, [0]), {
    day: '2026-10-23',
    global: {
      samples: 0,
      p50: null,
      p95: null,
      p99: null,
      max: null,
      aboveThreshold: [{ thresholdMs: 0, samples: 0, share: null }],
    },
    byRegion: {},
  });
  daily.record('asia', 0, at);
  assert.equal(daily.snapshot(at).global.p99, 0);
  daily.record('asia', 0.5, at);
  assert.equal(daily.snapshot(at).global.p50, 0);
  assert.equal(daily.snapshot(at, [0]).global.aboveThreshold[0]?.share, 0.5);
});

test('daily RTT normalizes regions and uses each region population for threshold shares', () => {
  const daily = new DailyRttAccumulator();
  daily.record('asia', 100, at);
  daily.record('asia', 200, at);
  daily.record('us-west', 500, at);
  for (const region of ['', 'US EAST', '__proto__', 'a'.repeat(33)]) {
    daily.record(region, 50, at);
  }
  const snapshot = daily.snapshot(at, [100]);
  assert.deepEqual(Object.keys(snapshot.byRegion).sort(), ['asia', 'global', 'us-west']);
  assert.deepEqual(snapshot.byRegion.asia?.aboveThreshold, [
    { thresholdMs: 100, samples: 1, share: 0.5 },
  ]);
  assert.equal(snapshot.byRegion['us-west']?.aboveThreshold[0]?.share, 1);
  assert.equal(snapshot.byRegion.global?.samples, 4);
  assert.equal(snapshot.global.aboveThreshold[0]?.share, 2 / 7);
  // Mutating a returned summary cannot change the retained raw data.
  snapshot.byRegion.asia!.samples = 999;
  snapshot.byRegion.asia!.aboveThreshold[0]!.share = 1;
  assert.equal(daily.snapshot(at, [100]).byRegion.asia?.aboveThreshold[0]?.share, 0.5);
});

test('daily RTT rolls over at UTC midnight and retains only today and yesterday', () => {
  const daily = new DailyRttAccumulator();
  const midnight = Date.parse('2026-10-24T00:00:00Z');
  daily.record('asia', 10, midnight - 1);
  daily.record('asia', 20, midnight);
  daily.record('asia', 30, midnight - 2); // late sample in yesterday's bucket
  assert.equal(daily.snapshot(midnight - 1).global.samples, 2);
  assert.equal(daily.snapshot(midnight).global.samples, 1);
  assert.equal(daily.snapshot(midnight).global.p50, 20);

  // Even a read after a quiet day expires the old bucket. Older reads/records
  // cannot restore it or rewind retention and evict newer samples.
  daily.snapshot(midnight + dayMs);
  daily.record('asia', 99, midnight - 1);
  assert.equal(daily.snapshot(midnight - 1).global.samples, 0);
  assert.equal(daily.snapshot(midnight).global.samples, 1);
  assert.equal(daily.snapshot(midnight + 3 * dayMs).global.samples, 0);
  assert.equal(daily.snapshot(midnight).global.samples, 0);
});

test('daily RTT rejects invalid samples, timestamps and threshold policies', () => {
  const daily = new DailyRttAccumulator();
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    daily.record('asia', invalid, at);
  }
  assert.equal(daily.snapshot(at).global.samples, 0);
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 9e15]) {
    assert.throws(() => daily.record('asia', 20, invalid), RangeError);
    assert.throws(() => daily.snapshot(invalid), RangeError);
  }
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => daily.snapshot(at, [invalid]), RangeError);
  }
});
