import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { EngineAlertEmailPayload } from './engine-alert-email.js';
import { alertThrottleKey } from './engine-alert-email.js';
import {
  AuthCounters,
  EngineCounters,
  engineAlertFields,
  httpRoutePattern,
  InFlightWork,
  inFlightWork,
  infraAlertFields,
  knownFailureSpikeAlert,
  logger,
  observeBackgroundJob,
  observeHttpHandler,
  startObservability,
  trackHttpRequest,
  wsCounters,
} from './obs.js';
import { createHttpRequestHandler } from './server-http.js';

test('daily RTT retains raw samples across metrics ticks and weights regions by sample count', () => {
  const at = Date.parse('2026-10-23T12:00:00Z');
  for (let i = 0; i < 19; i += 1) wsCounters.recordLatencySample('asia', 20, at);
  const firstTick = wsCounters.snapshot();
  assert.equal(firstTick.latencySamples, 19);
  assert.equal(firstTick.latencyP95, 20);
  wsCounters.recordLatencySample('us-west', 1_000, at);
  const secondTick = wsCounters.snapshot();
  assert.equal(secondTick.latencySamples, 1);
  assert.equal(secondTick.latencyP95, 1_000);

  const daily = wsCounters.snapshotDailyLatency(at, [20, 500]);
  assert.equal(daily.day, '2026-10-23');
  assert.deepEqual(daily.global, {
    samples: 20,
    p50: 20,
    p95: 20,
    p99: 1_000,
    max: 1_000,
    aboveThreshold: [
      { thresholdMs: 20, samples: 1, share: 0.05 },
      { thresholdMs: 500, samples: 1, share: 0.05 },
    ],
  });
  assert.equal(daily.byRegion.asia?.samples, 19);
  assert.equal(daily.byRegion['us-west']?.p95, 1_000);
  assert.deepEqual(wsCounters.snapshotDailyLatency(at, [20, 500]), daily);
  assert.equal(wsCounters.snapshot().latencySamples, 0);
});

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

test('infra alert fields page on memory and loop-lag breaches', (t) => {
  t.mock.method(process, 'uptime', () => 120);
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

test('loop-lag alerts wait for process warm-up without suppressing memory alerts', () => {
  const limits = { rssWarnMb: 4096, rssMb: 19660, loopLagP99Ms: 400 };
  const spike = { rssMb: 370, loopLagP99Ms: 800, loopLagMaxMs: 1500 };
  assert.equal(infraAlertFields(spike, limits, 119_999), null);
  assert.equal(infraAlertFields(spike, limits, 120_000)?.loop_lag_max_ms, 1500);
  assert.deepEqual(infraAlertFields({ ...spike, rssMb: 20000 }, limits, 0), {
    severity: 'critical',
    alert_kind: 'infra',
    rss_mb: 20000,
    rss_limit_mb: 19660,
  });
});

test('HTTP work labels redact ids, queries, unknown paths and methods', (t) => {
  t.mock.method(Date, 'now', () => 2000);
  const tracker = new InFlightWork();
  tracker.startHttp('GET', '/study/private-study/private-chapter?token=private-token', 1000);
  tracker.startHttp('POST', '/api/xiangqi/games/private-game/analysis/jobs/private-job', 1000);
  tracker.startHttp('private-method', '/api/private-account/private-email@example.com', 1000);
  tracker.startHttp('GET', '/private-email@example.com', 1000);
  const serialized = tracker.across([{ start: 1000, end: 2000 }], 2000).work;
  assert.ok(!serialized.includes('private-'), serialized);
  assert.ok(serialized.includes('/study/:id/:chapterId'));
  assert.ok(serialized.includes('/api/xiangqi/games/:id/analysis/jobs/:jobId'));
  assert.ok(serialized.includes('/api/:unclassified'));
  assert.ok(serialized.includes('OTHER'));
  assert.equal(
    httpRoutePattern('/zh-hans/study/games/analysis?email=private'),
    '/zh-hans/study/:id/:chapterId',
  );
  assert.equal(httpRoutePattern('//private-host/path'), '/:unclassified');
  assert.equal(httpRoutePattern('/api/games/showcase?token=private'), '/api/games/showcase');
});

test('work spanning a stall survives completion, sorts longest first and expires at the tick', (t) => {
  const tracker = new InFlightWork();
  let now = 2000;
  t.mock.method(Date, 'now', () => now);
  const finishedEarly = tracker.startHttp('GET', '/api/live-stats', 900);
  finishedEarly();
  const endJob = tracker.startJob('study_curator', 1000);
  const endRequest = tracker.startHttp('GET', '/study/secret/chapter', 2000);
  now = 4000;
  endRequest();
  endRequest();
  const windows = [{ start: 3000, end: 4000 }];
  const work = JSON.parse(tracker.across(windows, 5000).work);
  assert.deepEqual(
    work.map((span: { name: string }) => span.name),
    ['study_curator', '/study/:id/:chapterId'],
  );
  assert.equal(work[1].finished_at_ms, 4000);
  assert.equal(work[1].elapsed_ms, 2000);
  tracker.endTick();
  assert.equal(JSON.parse(tracker.across(windows, 5000).work).length, 1);
  endJob();
  tracker.endTick();
  assert.equal(tracker.across(windows, 5000).work, '[]');
});

test('retained diagnostics and reported candidates are bounded with omissions visible', (t) => {
  const tracker = new InFlightWork();
  t.mock.method(Date, 'now', () => 5000);
  for (let i = 0; i < 1100; i += 1) tracker.startJob('study_curator', 1000)();
  const result = tracker.across([{ start: 2000, end: 4000 }], 5000);
  assert.equal(JSON.parse(result.work).length, 20);
  assert.equal(result.omitted, 1080);
  tracker.endTick();
  assert.deepEqual(tracker.across([{ start: 2000, end: 4000 }]), { work: '[]', omitted: 0 });
});

test('request completion and disconnect remove listeners and active work', (t) => {
  const windows = [{ start: 1000, end: 4000 }];
  let now = 2000;
  t.mock.method(Date, 'now', () => now);
  for (const event of ['finish', 'close']) {
    inFlightWork.endTick();
    const response = new EventEmitter();
    trackHttpRequest(
      { method: 'GET', url: '/study/private/chapter' } as IncomingMessage,
      response as ServerResponse,
    );
    assert.equal(JSON.parse(inFlightWork.across(windows, 3000).work).length, 1);
    now += 100;
    response.emit(event);
    assert.equal(response.listenerCount('finish'), 0);
    assert.equal(response.listenerCount('close'), 0);
    inFlightWork.endTick();
    assert.equal(inFlightWork.across(windows).work, '[]');
  }
});

test('named background jobs clean up on resolve, rejection and synchronous failure', async () => {
  for (const run of [
    async () => 42,
    async () => {
      throw new Error('async');
    },
    () => {
      throw new Error('sync');
    },
  ]) {
    await observeBackgroundJob('study_curator', run).catch(() => {});
    inFlightWork.endTick();
    assert.equal(inFlightWork.across([{ start: 0, end: Date.now() + 1 }]).work, '[]');
  }
});

test('a real loop block includes completed HTTP and job spans in the log and alert', async (t) => {
  t.mock.method(process, 'uptime', () => 121);
  const previousLimit = process.env.MISTBOARD_ALERT_LOOP_LAG_P99_MS;
  // The email alert keys on p99, whose 20 ms sampling floor sits under 15 ms
  // here, so the tick alerts and the test checks what the alert carries.
  process.env.MISTBOARD_ALERT_LOOP_LAG_P99_MS = '15';
  t.after(() => {
    if (previousLimit === undefined) delete process.env.MISTBOARD_ALERT_LOOP_LAG_P99_MS;
    else process.env.MISTBOARD_ALERT_LOOP_LAG_P99_MS = previousLimit;
  });
  const logs: Record<string, unknown>[] = [];
  t.mock.method(logger, 'warn', (fields: Record<string, unknown>) => {
    logs.push(fields);
  });
  t.mock.method(logger, 'info', () => {});
  const alerts: EngineAlertEmailPayload[] = [];
  const stop = startObservability({ roomCount: () => 0, wsClientCount: () => 0 }, 100, (alert) => {
    alerts.push(alert);
  });
  t.after(stop);
  await delay(30); // Let monitorEventLoopDelay and the work pulse start sampling.
  const response = Object.assign(new EventEmitter(), {
    setHeader() {},
    writeHead() {},
    end() {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      response.emit('finish');
    },
  });
  const handler = observeHttpHandler(
    createHttpRequestHandler({
      staticDir: '/tmp/burn-scratch/mistboard-burn-1183-name-what-was-running-when',
      drainController: {
        isDraining() {
          // Stop dispatch through its normal error boundary before any I/O.
          throw new URIError('fixture');
        },
      },
    } as unknown as Parameters<typeof createHttpRequestHandler>[0]),
  );
  await observeBackgroundJob('study_curator', async () => {
    handler(
      {
        method: 'POST',
        url: '/study/private-study/private-chapter?token=private-token',
        headers: {},
      } as IncomingMessage,
      response as unknown as ServerResponse,
    );
  }); // Both spans end before the metrics timer can run.
  const attributed = (entry: EngineAlertEmailPayload) =>
    entry.alert_kind === 'infra' && String(entry.in_flight_work ?? '').includes('study_curator');
  for (let i = 0; i < 20 && !alerts.some(attributed); i += 1) await delay(20);
  const alert = alerts.find(attributed);
  assert.ok(alert, 'the blocked loop must emit an infra alert');
  const work = JSON.parse(String(alert.in_flight_work));
  assert.ok(work.some((span: { name: string }) => span.name === '/study/:id/:chapterId'));
  assert.ok(work.some((span: { name: string }) => span.name === 'study_curator'));
  assert.ok(!JSON.stringify(alert).includes('private-'));
  assert.equal(typeof alert.heap_before_mb, 'number');
  assert.equal(typeof alert.heap_after_mb, 'number');
  assert.ok(
    logs.some(
      (entry) => entry.kind === 'loop_stall' && entry.in_flight_work === alert.in_flight_work,
    ),
  );
  assert.ok(
    logs.some(
      (entry) => entry.kind === 'infra_alert' && entry.in_flight_work === alert.in_flight_work,
    ),
  );
});

test('a real warm-up stall still logs metrics without a lag alert', async (t) => {
  t.mock.method(process, 'uptime', () => 119);
  const previousLimit = process.env.MISTBOARD_ALERT_LOOP_LAG_P99_MS;
  process.env.MISTBOARD_ALERT_LOOP_LAG_P99_MS = '40';
  t.after(() => {
    if (previousLimit === undefined) delete process.env.MISTBOARD_ALERT_LOOP_LAG_P99_MS;
    else process.env.MISTBOARD_ALERT_LOOP_LAG_P99_MS = previousLimit;
  });
  const metrics: Record<string, unknown>[] = [];
  t.mock.method(logger, 'info', (fields: Record<string, unknown>) => {
    metrics.push(fields);
  });
  t.mock.method(logger, 'warn', () => {});
  const alerts: EngineAlertEmailPayload[] = [];
  const stop = startObservability({ roomCount: () => 0, wsClientCount: () => 0 }, 100, (alert) => {
    alerts.push(alert);
  });
  t.after(stop);
  await delay(30);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  for (let i = 0; i < 20 && metrics.length === 0; i += 1) await delay(20);
  assert.ok(
    metrics.some((entry) => entry.kind === 'metrics' && Number(entry.loop_lag_max_ms) >= 40),
  );
  assert.ok(!alerts.some((alert) => alert.loop_lag_limit_ms !== undefined));
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

test('a spike of known engine failures warns once, then re-arms after the hour clears', () => {
  const counters = new EngineCounters();
  const t0 = Date.parse('2026-10-17T10:00:00.000Z');
  const minute = 60_000;
  const alertAt = (nowMs: number) => {
    const snapshot = counters.snapshot(nowMs);
    assert.equal(engineAlertFields(snapshot), null, 'never the general engine alert');
    return knownFailureSpikeAlert(snapshot);
  };
  counters.recordKnownFailure('fog-xiangqi-belief-timeout', t0);
  counters.recordKnownFailure('fog-xiangqi-belief-timeout', t0 + minute);
  assert.equal(alertAt(t0 + minute), null, 'two in an hour is data');

  counters.recordKnownFailure('fog-xiangqi-belief-timeout', t0 + 2 * minute);
  assert.deepEqual(alertAt(t0 + 2 * minute), {
    severity: 'warning',
    alert_kind: 'engine_known_failure_spike',
    engine_known_failures_last_hour: 3,
    threshold_per_hour: 3,
  });

  counters.recordKnownFailure('fog-xiangqi-belief-timeout', t0 + 3 * minute);
  assert.equal(alertAt(t0 + 3 * minute), null, 'one warning per spike, not one per failure');

  // All four age out, then a fresh burst of three warns again.
  const later = t0 + 70 * minute;
  assert.equal(alertAt(later), null);
  for (let i = 0; i < 3; i += 1)
    counters.recordKnownFailure('fog-xiangqi-belief-timeout', later + i);
  assert.equal(alertAt(later + 3)?.engine_known_failures_last_hour, 3);
});

test('the spike email has its own throttle bucket, apart from other engine warnings', () => {
  const spike = { severity: 'warning', alert_kind: 'engine_known_failure_spike' } as const;
  assert.notEqual(alertThrottleKey(spike), alertThrottleKey({ severity: 'warning' }));
});
