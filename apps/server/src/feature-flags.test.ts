import assert from 'node:assert/strict';
import test from 'node:test';
import { darkXiangqiEnabled, ratedEnabled } from './feature-flags.js';
import { jieqiLuckAllowed } from './jieqi-luck.js';

test('Jieqi luck defaults on for every viewer and can be switched off', (t) => {
  const key = 'MISTBOARD_JIEQI_LUCK_ENABLED';
  const previous = process.env[key];
  t.after(() => restoreEnv(key, previous));
  for (const value of [undefined, 'true', 'false']) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    for (const viewer of [null, { id: 'member' }]) {
      assert.equal(jieqiLuckAllowed(viewer), value !== 'false');
    }
  }
});

const ratedKey = 'MISTBOARD_RATED_ENABLED';
const darkXiangqiKey = 'MISTBOARD_DARK_XIANGQI_ENABLED';

test('feature flags default off', () => {
  const beforeRated = process.env[ratedKey];
  const beforeDarkXiangqi = process.env[darkXiangqiKey];
  delete process.env[ratedKey];
  delete process.env[darkXiangqiKey];
  try {
    assert.equal(ratedEnabled(), false);
    assert.equal(darkXiangqiEnabled(), false);
  } finally {
    restoreEnv(ratedKey, beforeRated);
    restoreEnv(darkXiangqiKey, beforeDarkXiangqi);
  }
});

test('feature flags require the exact true string', () => {
  const beforeRated = process.env[ratedKey];
  const beforeDarkXiangqi = process.env[darkXiangqiKey];
  try {
    process.env[ratedKey] = 'true';
    process.env[darkXiangqiKey] = 'true';
    assert.equal(ratedEnabled(), true);
    assert.equal(darkXiangqiEnabled(), true);

    process.env[ratedKey] = '1';
    process.env[darkXiangqiKey] = 'yes';
    assert.equal(ratedEnabled(), false);
    assert.equal(darkXiangqiEnabled(), false);
  } finally {
    restoreEnv(ratedKey, beforeRated);
    restoreEnv(darkXiangqiKey, beforeDarkXiangqi);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
