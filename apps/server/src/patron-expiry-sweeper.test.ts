import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPatronExpirySweeper } from './patron-expiry-sweeper.js';

test('the sweep runs the expiry at the injected clock and survives a failure', async () => {
  const calls: number[] = [];
  let fail = true;
  const sweeper = startPatronExpirySweeper({
    intervalMs: 60 * 60 * 1000,
    isPersistenceInitialized: () => true,
    now: () => 1_800_000_000_000,
    expire: async (at) => {
      calls.push(at.getTime());
      if (fail) {
        fail = false;
        throw new Error('db down');
      }
      return 2;
    },
  });
  try {
    await sweeper.tick(); // throws inside, logged, swallowed
    await sweeper.tick();
    assert.deepEqual(calls, [1_800_000_000_000, 1_800_000_000_000]);
  } finally {
    sweeper.stop();
  }
});

test('the sweep is a no-op without persistence', async () => {
  let ran = 0;
  const sweeper = startPatronExpirySweeper({
    isPersistenceInitialized: () => false,
    expire: async () => {
      ran += 1;
      return 0;
    },
  });
  try {
    await sweeper.tick();
    assert.equal(ran, 0);
  } finally {
    sweeper.stop();
  }
});
