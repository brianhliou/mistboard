import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthCounters, EngineCounters, engineAlertFields, infraAlertFields } from './obs.js';

test('auth counters expose aggregate deltas without identity fields', () => {
  const counters = new AuthCounters();
  counters.recordStart('sent');
  counters.recordStart('rate_limited');
  counters.recordStart('delivery_failed');
  counters.recordConfirm('success');
  counters.recordConfirm('rejected');
  counters.recordConfirm('rate_limited');

  assert.deepEqual(counters.snapshot(), {
    codesSent: 1,
    codesSentDelta: 1,
    confirmRateLimited: 1,
    confirmRateLimitedDelta: 1,
    confirmRequests: 3,
    confirmRequestsDelta: 3,
    confirmSuccesses: 1,
    confirmSuccessesDelta: 1,
    deliveryFailures: 1,
    deliveryFailuresDelta: 1,
    startRateLimited: 1,
    startRateLimitedDelta: 1,
    startRequests: 3,
    startRequestsDelta: 3,
  });
  const second = counters.snapshot();
  assert.equal(second.startRequestsDelta, 0);
  assert.equal(second.confirmRequestsDelta, 0);
});

test('engine counters emit deltas and drain latency samples', () => {
  const counters = new EngineCounters();

  counters.recordMove(false);
  counters.recordMove(true);
  counters.recordMoveFailure();
  counters.recordReservationFailure({ busy: false });
  counters.recordReservationFailure({ busy: true });
  counters.recordReservationReleaseFailure();
  counters.recordTurnStarted();
  counters.recordTurnCompleted({
    decisionSource: 'deadline-guard',
    elapsedMs: 20,
    queueWaitMs: 5,
  });
  counters.recordTurnStarted();
  counters.recordTurnFailed({
    elapsedMs: 3_001,
    error: 'pool request timeout 3000ms',
    queueWaitMs: 40,
  });
  counters.recordPythonPoolError();
  counters.recordPythonPoolError({ timeout: true });

  const first = counters.snapshot();
  assert.equal(first.moves, 2);
  assert.equal(first.movesDelta, 2);
  assert.equal(first.fallbacks, 1);
  assert.equal(first.fallbacksDelta, 1);
  assert.equal(first.rate, 0.5);
  assert.equal(first.moveFailures, 1);
  assert.equal(first.moveFailuresDelta, 1);
  assert.equal(first.reservationFailures, 2);
  assert.equal(first.reservationFailuresDelta, 2);
  assert.equal(first.reservationBusy, 1);
  assert.equal(first.reservationBusyDelta, 1);
  assert.equal(first.reservationReleaseFailures, 1);
  assert.equal(first.reservationReleaseFailuresDelta, 1);
  assert.equal(first.turnsStarted, 2);
  assert.equal(first.turnsStartedDelta, 2);
  assert.equal(first.turnsCompleted, 1);
  assert.equal(first.turnsCompletedDelta, 1);
  assert.equal(first.turnsFailed, 1);
  assert.equal(first.turnsFailedDelta, 1);
  assert.equal(first.turnTimeouts, 1);
  assert.equal(first.turnTimeoutsDelta, 1);
  assert.equal(first.deadlineGuards, 1);
  assert.equal(first.deadlineGuardsDelta, 1);
  assert.equal(first.turnLatencySamples, 2);
  assert.equal(first.turnElapsedP50, 20);
  assert.equal(first.turnElapsedP95, 3_001);
  assert.equal(first.turnElapsedMax, 3_001);
  assert.equal(first.turnQueueWaitP50, 5);
  assert.equal(first.turnQueueWaitP95, 40);
  assert.equal(first.turnQueueWaitMax, 40);
  assert.equal(first.pythonPoolErrors, 2);
  assert.equal(first.pythonPoolErrorsDelta, 2);
  assert.equal(first.pythonPoolTimeouts, 1);
  assert.equal(first.pythonPoolTimeoutsDelta, 1);

  const second = counters.snapshot();
  assert.equal(second.moves, 2);
  assert.equal(second.movesDelta, 0);
  assert.equal(second.fallbacksDelta, 0);
  assert.equal(second.turnsFailed, 1);
  assert.equal(second.turnsFailedDelta, 0);
  assert.equal(second.turnLatencySamples, 0);
  assert.equal(second.turnElapsedP95, null);
  assert.equal(second.turnQueueWaitP95, null);
});

test('engine alert fields separate critical failures from capacity pressure', () => {
  const criticalCounters = new EngineCounters();
  criticalCounters.recordMove(false);
  criticalCounters.recordMove(true);
  criticalCounters.recordMoveFailure();
  criticalCounters.recordReservationFailure({ busy: false });
  criticalCounters.recordReservationFailure({ busy: true });
  criticalCounters.recordReservationReleaseFailure();
  criticalCounters.recordTurnFailed({
    error: 'runner timed out',
  });
  criticalCounters.recordPythonPoolError({ timeout: true });

  assert.deepEqual(engineAlertFields(criticalCounters.snapshot()), {
    severity: 'critical',
    engine_fallbacks_tick: 1,
    engine_move_failures_tick: 1,
    engine_turns_failed_tick: 1,
    engine_turn_timeouts_tick: 1,
    python_pool_errors_tick: 1,
    python_pool_timeouts_tick: 1,
    engine_reservation_errors_tick: 1,
    engine_reservation_release_failures_tick: 1,
  });
  assert.equal(engineAlertFields(criticalCounters.snapshot()), null);

  const busyCounters = new EngineCounters();
  busyCounters.recordReservationFailure({ busy: true });

  assert.deepEqual(engineAlertFields(busyCounters.snapshot()), {
    severity: 'warning',
    engine_reservation_busy_tick: 1,
  });
  assert.equal(engineAlertFields(busyCounters.snapshot()), null);

  // R1-recover: a recovered worker blip (retry, no terminal failure) is a
  // warning — surfaced so successful recovery doesn't mask worker instability.
  const retryCounters = new EngineCounters();
  retryCounters.recordPythonPoolRetry();
  retryCounters.recordPythonPoolRetry();
  assert.deepEqual(engineAlertFields(retryCounters.snapshot()), {
    severity: 'warning',
    python_pool_retries_tick: 2,
  });
  assert.equal(engineAlertFields(retryCounters.snapshot()), null);
});

test('infra alert fields page on memory and loop-lag breaches', () => {
  // Calibrated to the 24 GB-per-replica box: warn at ~4 GB, critical at ~80% of ceiling.
  const limits = { rssWarnMb: 4096, rssMb: 19660, loopLagP99Ms: 400 };

  // Healthy box (near current prod peak) → no alert.
  assert.equal(infraAlertFields({ rssMb: 370, loopLagP99Ms: 12, loopLagMaxMs: 40 }, limits), null);

  // RSS anomalously high (leak) but far from the ceiling → warning, with the runway left.
  assert.deepEqual(infraAlertFields({ rssMb: 6000, loopLagP99Ms: 12, loopLagMaxMs: 40 }, limits), {
    severity: 'warning',
    alert_kind: 'infra',
    rss_mb: 6000,
    rss_warn_mb: 4096,
  });

  // RSS near the ceiling → critical (OOM risk). Only the ceiling field, not the warn band.
  assert.deepEqual(infraAlertFields({ rssMb: 20000, loopLagP99Ms: 12, loopLagMaxMs: 40 }, limits), {
    severity: 'critical',
    alert_kind: 'infra',
    rss_mb: 20000,
    rss_limit_mb: 19660,
  });

  // Event-loop saturation only → warning.
  assert.deepEqual(
    infraAlertFields({ rssMb: 370, loopLagP99Ms: 800, loopLagMaxMs: 1500 }, limits),
    {
      severity: 'warning',
      alert_kind: 'infra',
      loop_lag_p99_ms: 800,
      loop_lag_max_ms: 1500,
      loop_lag_limit_ms: 400,
    },
  );

  // RSS at the ceiling + loop saturation → critical wins, both field sets present.
  assert.deepEqual(
    infraAlertFields({ rssMb: 20000, loopLagP99Ms: 800, loopLagMaxMs: 1500 }, limits),
    {
      severity: 'critical',
      alert_kind: 'infra',
      rss_mb: 20000,
      rss_limit_mb: 19660,
      loop_lag_p99_ms: 800,
      loop_lag_max_ms: 1500,
      loop_lag_limit_ms: 400,
    },
  );

  // A 0 limit disables that check.
  assert.equal(
    infraAlertFields(
      { rssMb: 50000, loopLagP99Ms: 5000, loopLagMaxMs: 9000 },
      { rssWarnMb: 0, rssMb: 0, loopLagP99Ms: 0 },
    ),
    null,
  );
});

test('known engine failures are counted per signature and never raise an engine alert', () => {
  const counters = new EngineCounters();
  counters.recordKnownFailure('fog-xiangqi-belief-timeout');
  counters.recordKnownFailure('fog-xiangqi-belief-timeout');
  const snapshot = counters.snapshot();
  assert.equal(snapshot.knownFailures, 2);
  assert.equal(snapshot.knownFailuresDelta, 2);
  assert.deepEqual(snapshot.knownFailuresBySignatureTick, { 'fog-xiangqi-belief-timeout': 2 });
  assert.equal(engineAlertFields(snapshot), null);

  const next = counters.snapshot();
  assert.equal(next.knownFailures, 2, 'the total keeps counting');
  assert.equal(next.knownFailuresDelta, 0);
  assert.deepEqual(next.knownFailuresBySignatureTick, {});
});
