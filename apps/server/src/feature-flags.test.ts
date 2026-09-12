import assert from 'node:assert/strict';
import test from 'node:test';
import { darkXiangqiEnabled, kriegspielEnabled, ratedEnabled } from './feature-flags.js';

const ratedKey = 'MISTBOARD_RATED_ENABLED';
const darkXiangqiKey = 'MISTBOARD_DARK_XIANGQI_ENABLED';
const kriegspielKey = 'MISTBOARD_KRIEGSPIEL_ENABLED';

test('feature flags default off', () => {
  const beforeRated = process.env[ratedKey];
  const beforeDarkXiangqi = process.env[darkXiangqiKey];
  const beforeKriegspiel = process.env[kriegspielKey];
  delete process.env[ratedKey];
  delete process.env[darkXiangqiKey];
  delete process.env[kriegspielKey];
  try {
    assert.equal(ratedEnabled(), false);
    assert.equal(darkXiangqiEnabled(), false);
    assert.equal(kriegspielEnabled(), false);
  } finally {
    restoreEnv(ratedKey, beforeRated);
    restoreEnv(darkXiangqiKey, beforeDarkXiangqi);
    restoreEnv(kriegspielKey, beforeKriegspiel);
  }
});

test('feature flags require the exact true string', () => {
  const beforeRated = process.env[ratedKey];
  const beforeDarkXiangqi = process.env[darkXiangqiKey];
  const beforeKriegspiel = process.env[kriegspielKey];
  try {
    process.env[ratedKey] = 'true';
    process.env[darkXiangqiKey] = 'true';
    process.env[kriegspielKey] = 'true';
    assert.equal(ratedEnabled(), true);
    assert.equal(darkXiangqiEnabled(), true);
    assert.equal(kriegspielEnabled(), true);

    process.env[ratedKey] = '1';
    process.env[darkXiangqiKey] = 'yes';
    process.env[kriegspielKey] = 'on';
    assert.equal(ratedEnabled(), false);
    assert.equal(darkXiangqiEnabled(), false);
    assert.equal(kriegspielEnabled(), false);
  } finally {
    restoreEnv(ratedKey, beforeRated);
    restoreEnv(darkXiangqiKey, beforeDarkXiangqi);
    restoreEnv(kriegspielKey, beforeKriegspiel);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
