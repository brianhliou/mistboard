import assert from 'node:assert/strict';
import test from 'node:test';
import { loadServerRuntimeConfig, normalizeRoomRegion } from './server-config.js';

test('server runtime config parses numeric env defaults', () => {
  const config = loadServerRuntimeConfig({
    MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE: 'true',
    MISTBOARD_ABORT_POLICY_SWEEP_MS: '1234',
    MISTBOARD_DRAIN_WINDOW_DEFAULT_MS: '2000',
    MISTBOARD_DRAIN_WINDOW_MAX_MS: '3000',
    MISTBOARD_GUEST_PRESTART_ABORT_MS: '0',
    MISTBOARD_LIVE_ENGINE_TIMEOUT_MS: '4000',
    MISTBOARD_ORPHAN_THRESHOLD_MS: '5000',
    MISTBOARD_PVE_ENGINE_DELAY_MS: '600',
    MISTBOARD_RESUME_GRACE_MS: '7000',
    MISTBOARD_SEAT_VACATE_GRACE_MS: '8000',
    MISTBOARD_STALE_PAUSE_HOURS: '2',
    MISTBOARD_STALE_PAUSED_SWEEP_MS: '9000',
    MISTBOARD_WS_MAX_PAYLOAD_BYTES: '10000',
    MISTBOARD_WS_MESSAGE_LIMIT: '11',
    MISTBOARD_WS_MESSAGE_WINDOW_MS: '12000',
    PORT: '4321',
  });

  assert.equal(config.databaseRequired, false);
  assert.equal(config.abortPolicySweepMs, 1234);
  assert.equal(config.drainWindowDefaultMs, 2000);
  assert.equal(config.drainWindowMaxMs, 3000);
  assert.equal(config.guestPrestartAbortMs, 0);
  assert.equal(config.liveEngineTimeoutMs, 4000);
  assert.equal(config.orphanThresholdMs, 5000);
  assert.equal(config.port, 4321);
  assert.equal(config.pveEngineMoveDelayMs, 600);
  assert.equal(config.seatVacateGraceMs, 8000);
  assert.equal(config.stalePauseMs, 2 * 60 * 60 * 1000);
  assert.equal(config.wsMessageLimit, 11);
});

test('server runtime config normalizes room region inputs', () => {
  assert.equal(normalizeRoomRegion(' US-WEST-2 '), 'us-west-2');
  assert.equal(normalizeRoomRegion('bad region!'), 'global');
  assert.equal(normalizeRoomRegion(undefined), 'global');
});

test('server runtime config accepts a bind host without changing the public origin', () => {
  const config = loadServerRuntimeConfig({ MISTBOARD_BIND_HOST: ' 127.0.0.1 ' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.publicHost, 'https://mistboard.com');
  assert.equal(loadServerRuntimeConfig({}).host, undefined);
  assert.equal(loadServerRuntimeConfig({ MISTBOARD_BIND_HOST: ' ' }).host, undefined);
  // A platform-set generic HOST (e.g. 0.0.0.0) must never pick the prod bind address.
  assert.equal(loadServerRuntimeConfig({ HOST: '0.0.0.0' }).host, undefined);
});
