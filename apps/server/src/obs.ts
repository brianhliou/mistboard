// Observability: a single logger + a periodic metrics tick. Kept deliberately
// minimal: stdout-only, no SaaS dependency. In dev (TTY) we pretty-print; in
// prod we emit JSON lines that Railway's log capture indexes natively.
//
// Add structured fields to logs by passing an object as the first arg:
//   logger.info({ kind: 'engine_move', game_id, mode, ms }, 'engine move ok');
//
// The metrics tick emits a `kind: 'metrics'` line every N seconds with the
// gauges that matter for capacity decisions: room count, ws client count,
// event-loop lag percentiles, heap/rss.

import { monitorEventLoopDelay } from 'node:perf_hooks';
import pino, { type Logger } from 'pino';
import { DailyRttAccumulator, normalizeLatencyRegion } from './daily-rtt.js';
import { type EngineAlertEmailPayload, sendEngineAlertNotification } from './engine-alert-email.js';
import { isTimeoutish, type KnownEngineFailure } from './engine-known-failures.js';

const isProd = process.env.NODE_ENV === 'production' || !process.stdout.isTTY;
const level = process.env.LOG_LEVEL ?? 'info';

export const logger: Logger = pino(
  isProd
    ? { level }
    : {
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      },
);

export interface ObsSources {
  roomCount: () => number;
  wsClientCount: () => number;
}

// Engine-move counters. Incremented from the room-manager engine-move path.
// The metrics tick emits both "since last tick" deltas (for rate alerts) and
// running totals (for sanity checks on dashboards).
//
// Why this exists: a silent regression in 2026-05 caused 100% of live Tier1
// PvE moves to fall back to builtin-random-legal. Games kept completing, so
// nothing surfaced — except a fallback rate that should be ~0 but was 1.0.
// Watch the `engine_fallback_rate` and page when it's not near zero for any
// engine that's supposed to play.
// A known engine failure is data, not a page, until it stops being rare: this many
// in an hour on one service warns once. The Fog Xiangqi belief timeout ran a few
// a week when it was made known (2026-10-17).
const KNOWN_FAILURE_SPIKE_THRESHOLD = 3;
const KNOWN_FAILURE_SPIKE_WINDOW_MS = 60 * 60 * 1000;

export class EngineCounters {
  totalMoves = 0;
  totalFallbacks = 0;
  totalMoveFailures = 0;
  totalReservationFailures = 0;
  totalReservationBusy = 0;
  totalReservationReleaseFailures = 0;
  totalTurnsStarted = 0;
  totalTurnsCompleted = 0;
  totalTurnsFailed = 0;
  totalTurnTimeouts = 0;
  totalTurnDeadlineGuards = 0;
  totalPythonPoolErrors = 0;
  totalPythonPoolTimeouts = 0;
  totalPythonPoolRetries = 0;
  totalKnownFailures = 0;
  private lastEmittedMoves = 0;
  private lastEmittedFallbacks = 0;
  private lastEmittedMoveFailures = 0;
  private lastEmittedReservationFailures = 0;
  private lastEmittedReservationBusy = 0;
  private lastEmittedReservationReleaseFailures = 0;
  private lastEmittedTurnsStarted = 0;
  private lastEmittedTurnsCompleted = 0;
  private lastEmittedTurnsFailed = 0;
  private lastEmittedTurnTimeouts = 0;
  private lastEmittedTurnDeadlineGuards = 0;
  private lastEmittedPythonPoolErrors = 0;
  private lastEmittedPythonPoolTimeouts = 0;
  private lastEmittedPythonPoolRetries = 0;
  private lastEmittedKnownFailures = 0;
  private knownFailuresTick = new Map<KnownEngineFailure, number>();
  private knownFailureTimes: number[] = [];
  private knownFailureSpikeOpen = false;
  private turnElapsedSamples: number[] = [];
  private turnQueueWaitSamples: number[] = [];

  recordMove(fallback: boolean): void {
    this.totalMoves += 1;
    if (fallback) this.totalFallbacks += 1;
  }

  recordMoveFailure(): void {
    this.totalMoveFailures += 1;
  }

  recordReservationFailure(input: { busy: boolean }): void {
    this.totalReservationFailures += 1;
    if (input.busy) this.totalReservationBusy += 1;
  }

  recordReservationReleaseFailure(): void {
    this.totalReservationReleaseFailures += 1;
  }

  recordTurnStarted(): void {
    this.totalTurnsStarted += 1;
  }

  recordTurnCompleted(input: {
    decisionSource?: string | null;
    elapsedMs: number;
    queueWaitMs: number;
  }): void {
    this.totalTurnsCompleted += 1;
    if (input.decisionSource === 'deadline-guard') this.totalTurnDeadlineGuards += 1;
    this.recordTurnTiming(input);
  }

  recordTurnFailed(input: {
    elapsedMs?: number | null;
    error?: string | null;
    queueWaitMs?: number | null;
  }): void {
    this.totalTurnsFailed += 1;
    if (isTimeoutish(input.error)) this.totalTurnTimeouts += 1;
    this.recordTurnTiming(input);
  }

  recordPythonPoolError(input: { timeout?: boolean } = {}): void {
    this.totalPythonPoolErrors += 1;
    if (input.timeout) this.totalPythonPoolTimeouts += 1;
  }

  // R1-recover: a move failure that we re-dispatched to a healthy worker rather
  // than surfacing as a failed turn. Retry rate ≈ recovery health.
  recordPythonPoolRetry(): void {
    this.totalPythonPoolRetries += 1;
  }

  // A failure matching a known signature (engine-known-failures.ts). Counted
  // INSTEAD of the counters that page, so it stays visible as data in the
  // metrics line without emailing. A spike still warns (see snapshot).
  recordKnownFailure(signature: KnownEngineFailure, nowMs = Date.now()): void {
    this.totalKnownFailures += 1;
    this.knownFailuresTick.set(signature, (this.knownFailuresTick.get(signature) ?? 0) + 1);
    this.knownFailureTimes.push(nowMs);
  }

  // Known failures in the last hour, and whether that count just reached the
  // spike threshold this tick. Edge-triggered: one warning per spike, re-armed
  // once the hour count drops back below the threshold.
  private knownFailureSpike(nowMs: number): { lastHour: number; spike: boolean } {
    const cutoff = nowMs - KNOWN_FAILURE_SPIKE_WINDOW_MS;
    this.knownFailureTimes = this.knownFailureTimes.filter((at) => at > cutoff);
    const lastHour = this.knownFailureTimes.length;
    const over = lastHour >= KNOWN_FAILURE_SPIKE_THRESHOLD;
    const spike = over && !this.knownFailureSpikeOpen;
    this.knownFailureSpikeOpen = over;
    return { lastHour, spike };
  }

  private recordTurnTiming(input: {
    elapsedMs?: number | null;
    queueWaitMs?: number | null;
  }): void {
    if (typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs)) {
      this.turnElapsedSamples.push(input.elapsedMs);
    }
    if (typeof input.queueWaitMs === 'number' && Number.isFinite(input.queueWaitMs)) {
      this.turnQueueWaitSamples.push(input.queueWaitMs);
    }
  }

  snapshot(nowMs = Date.now()): {
    deadlineGuards: number;
    deadlineGuardsDelta: number;
    knownFailures: number;
    knownFailuresDelta: number;
    knownFailuresBySignatureTick: Record<string, number>;
    knownFailuresLastHour: number;
    knownFailureSpike: boolean;
    moves: number;
    fallbacks: number;
    moveFailures: number;
    movesDelta: number;
    fallbacksDelta: number;
    moveFailuresDelta: number;
    pythonPoolErrors: number;
    pythonPoolErrorsDelta: number;
    pythonPoolTimeouts: number;
    pythonPoolTimeoutsDelta: number;
    pythonPoolRetries: number;
    pythonPoolRetriesDelta: number;
    rate: number;
    reservationFailures: number;
    reservationFailuresDelta: number;
    reservationBusy: number;
    reservationBusyDelta: number;
    reservationReleaseFailures: number;
    reservationReleaseFailuresDelta: number;
    turnElapsedMax: number | null;
    turnElapsedP50: number | null;
    turnElapsedP95: number | null;
    turnLatencySamples: number;
    turnQueueWaitMax: number | null;
    turnQueueWaitP50: number | null;
    turnQueueWaitP95: number | null;
    turnTimeouts: number;
    turnTimeoutsDelta: number;
    turnsCompleted: number;
    turnsCompletedDelta: number;
    turnsFailed: number;
    turnsFailedDelta: number;
    turnsStarted: number;
    turnsStartedDelta: number;
  } {
    const movesDelta = this.totalMoves - this.lastEmittedMoves;
    const fallbacksDelta = this.totalFallbacks - this.lastEmittedFallbacks;
    const moveFailuresDelta = this.totalMoveFailures - this.lastEmittedMoveFailures;
    const reservationFailuresDelta =
      this.totalReservationFailures - this.lastEmittedReservationFailures;
    const reservationBusyDelta = this.totalReservationBusy - this.lastEmittedReservationBusy;
    const reservationReleaseFailuresDelta =
      this.totalReservationReleaseFailures - this.lastEmittedReservationReleaseFailures;
    const turnsStartedDelta = this.totalTurnsStarted - this.lastEmittedTurnsStarted;
    const turnsCompletedDelta = this.totalTurnsCompleted - this.lastEmittedTurnsCompleted;
    const turnsFailedDelta = this.totalTurnsFailed - this.lastEmittedTurnsFailed;
    const turnTimeoutsDelta = this.totalTurnTimeouts - this.lastEmittedTurnTimeouts;
    const deadlineGuardsDelta = this.totalTurnDeadlineGuards - this.lastEmittedTurnDeadlineGuards;
    const pythonPoolErrorsDelta = this.totalPythonPoolErrors - this.lastEmittedPythonPoolErrors;
    const pythonPoolTimeoutsDelta =
      this.totalPythonPoolTimeouts - this.lastEmittedPythonPoolTimeouts;
    const pythonPoolRetriesDelta = this.totalPythonPoolRetries - this.lastEmittedPythonPoolRetries;
    this.lastEmittedMoves = this.totalMoves;
    this.lastEmittedFallbacks = this.totalFallbacks;
    this.lastEmittedMoveFailures = this.totalMoveFailures;
    this.lastEmittedReservationFailures = this.totalReservationFailures;
    this.lastEmittedReservationBusy = this.totalReservationBusy;
    this.lastEmittedReservationReleaseFailures = this.totalReservationReleaseFailures;
    this.lastEmittedTurnsStarted = this.totalTurnsStarted;
    this.lastEmittedTurnsCompleted = this.totalTurnsCompleted;
    this.lastEmittedTurnsFailed = this.totalTurnsFailed;
    this.lastEmittedTurnTimeouts = this.totalTurnTimeouts;
    this.lastEmittedTurnDeadlineGuards = this.totalTurnDeadlineGuards;
    this.lastEmittedPythonPoolErrors = this.totalPythonPoolErrors;
    this.lastEmittedPythonPoolTimeouts = this.totalPythonPoolTimeouts;
    this.lastEmittedPythonPoolRetries = this.totalPythonPoolRetries;
    const knownFailuresDelta = this.totalKnownFailures - this.lastEmittedKnownFailures;
    this.lastEmittedKnownFailures = this.totalKnownFailures;
    const knownFailuresBySignatureTick = Object.fromEntries(this.knownFailuresTick);
    this.knownFailuresTick.clear();
    const { lastHour: knownFailuresLastHour, spike: knownFailureSpike } =
      this.knownFailureSpike(nowMs);
    const rate = movesDelta > 0 ? fallbacksDelta / movesDelta : 0;
    const elapsedStats =
      this.turnElapsedSamples.length > 0 ? latencyStats(this.turnElapsedSamples) : null;
    const queueStats =
      this.turnQueueWaitSamples.length > 0 ? latencyStats(this.turnQueueWaitSamples) : null;
    this.turnElapsedSamples = [];
    this.turnQueueWaitSamples = [];
    return {
      deadlineGuards: this.totalTurnDeadlineGuards,
      deadlineGuardsDelta,
      knownFailures: this.totalKnownFailures,
      knownFailuresDelta,
      knownFailuresBySignatureTick,
      knownFailuresLastHour,
      knownFailureSpike,
      moves: this.totalMoves,
      fallbacks: this.totalFallbacks,
      moveFailures: this.totalMoveFailures,
      movesDelta,
      fallbacksDelta,
      moveFailuresDelta,
      pythonPoolErrors: this.totalPythonPoolErrors,
      pythonPoolErrorsDelta,
      pythonPoolTimeouts: this.totalPythonPoolTimeouts,
      pythonPoolTimeoutsDelta,
      pythonPoolRetries: this.totalPythonPoolRetries,
      pythonPoolRetriesDelta,
      rate,
      reservationFailures: this.totalReservationFailures,
      reservationFailuresDelta,
      reservationBusy: this.totalReservationBusy,
      reservationBusyDelta,
      reservationReleaseFailures: this.totalReservationReleaseFailures,
      reservationReleaseFailuresDelta,
      turnElapsedMax: elapsedStats?.max ?? null,
      turnElapsedP50: elapsedStats?.p50 ?? null,
      turnElapsedP95: elapsedStats?.p95 ?? null,
      turnLatencySamples: elapsedStats?.samples ?? 0,
      turnQueueWaitMax: queueStats?.max ?? null,
      turnQueueWaitP50: queueStats?.p50 ?? null,
      turnQueueWaitP95: queueStats?.p95 ?? null,
      turnTimeouts: this.totalTurnTimeouts,
      turnTimeoutsDelta,
      turnsCompleted: this.totalTurnsCompleted,
      turnsCompletedDelta,
      turnsFailed: this.totalTurnsFailed,
      turnsFailedDelta,
      turnsStarted: this.totalTurnsStarted,
      turnsStartedDelta,
    };
  }
}

export const engineCounters = new EngineCounters();

export type AuthStartOutcome = 'delivery_failed' | 'rate_limited' | 'rejected' | 'sent';
export type AuthConfirmOutcome = 'rate_limited' | 'rejected' | 'success';

// Aggregate auth outcomes only. These counters deliberately never receive an
// email address, IP address, challenge id, or account id.
export class AuthCounters {
  totalStartRequests = 0;
  totalCodesSent = 0;
  totalStartRateLimited = 0;
  totalDeliveryFailures = 0;
  totalConfirmRequests = 0;
  totalConfirmSuccesses = 0;
  totalConfirmRateLimited = 0;
  private lastEmittedStartRequests = 0;
  private lastEmittedCodesSent = 0;
  private lastEmittedStartRateLimited = 0;
  private lastEmittedDeliveryFailures = 0;
  private lastEmittedConfirmRequests = 0;
  private lastEmittedConfirmSuccesses = 0;
  private lastEmittedConfirmRateLimited = 0;

  recordStart(outcome: AuthStartOutcome): void {
    this.totalStartRequests += 1;
    if (outcome === 'sent') this.totalCodesSent += 1;
    if (outcome === 'rate_limited') this.totalStartRateLimited += 1;
    if (outcome === 'delivery_failed') this.totalDeliveryFailures += 1;
  }

  recordConfirm(outcome: AuthConfirmOutcome): void {
    this.totalConfirmRequests += 1;
    if (outcome === 'success') this.totalConfirmSuccesses += 1;
    if (outcome === 'rate_limited') this.totalConfirmRateLimited += 1;
  }

  snapshot(): {
    codesSent: number;
    codesSentDelta: number;
    confirmRateLimited: number;
    confirmRateLimitedDelta: number;
    confirmRequests: number;
    confirmRequestsDelta: number;
    confirmSuccesses: number;
    confirmSuccessesDelta: number;
    deliveryFailures: number;
    deliveryFailuresDelta: number;
    startRateLimited: number;
    startRateLimitedDelta: number;
    startRequests: number;
    startRequestsDelta: number;
  } {
    const result = {
      codesSent: this.totalCodesSent,
      codesSentDelta: this.totalCodesSent - this.lastEmittedCodesSent,
      confirmRateLimited: this.totalConfirmRateLimited,
      confirmRateLimitedDelta: this.totalConfirmRateLimited - this.lastEmittedConfirmRateLimited,
      confirmRequests: this.totalConfirmRequests,
      confirmRequestsDelta: this.totalConfirmRequests - this.lastEmittedConfirmRequests,
      confirmSuccesses: this.totalConfirmSuccesses,
      confirmSuccessesDelta: this.totalConfirmSuccesses - this.lastEmittedConfirmSuccesses,
      deliveryFailures: this.totalDeliveryFailures,
      deliveryFailuresDelta: this.totalDeliveryFailures - this.lastEmittedDeliveryFailures,
      startRateLimited: this.totalStartRateLimited,
      startRateLimitedDelta: this.totalStartRateLimited - this.lastEmittedStartRateLimited,
      startRequests: this.totalStartRequests,
      startRequestsDelta: this.totalStartRequests - this.lastEmittedStartRequests,
    };
    this.lastEmittedCodesSent = this.totalCodesSent;
    this.lastEmittedConfirmRateLimited = this.totalConfirmRateLimited;
    this.lastEmittedConfirmRequests = this.totalConfirmRequests;
    this.lastEmittedConfirmSuccesses = this.totalConfirmSuccesses;
    this.lastEmittedDeliveryFailures = this.totalDeliveryFailures;
    this.lastEmittedStartRateLimited = this.totalStartRateLimited;
    this.lastEmittedStartRequests = this.totalStartRequests;
    return result;
  }
}

export const authCounters = new AuthCounters();

type EngineCounterSnapshot = ReturnType<EngineCounters['snapshot']>;

export type EngineAlertFields = {
  severity: 'critical' | 'warning';
  engine_fallbacks_tick?: number;
  engine_move_failures_tick?: number;
  engine_reservation_busy_tick?: number;
  engine_reservation_errors_tick?: number;
  engine_reservation_release_failures_tick?: number;
  engine_turn_timeouts_tick?: number;
  engine_turns_failed_tick?: number;
  python_pool_errors_tick?: number;
  python_pool_timeouts_tick?: number;
  python_pool_retries_tick?: number;
};

// A known signature (engine-known-failures.ts) that is no longer rare may have a
// new cause behind it. Its own alert kind, so the email throttle never folds it
// into an unrelated engine warning: the spike is edge-triggered and would be lost.
export function knownFailureSpikeAlert(
  engine: EngineCounterSnapshot,
): EngineAlertEmailPayload | null {
  if (!engine.knownFailureSpike) return null;
  return {
    severity: 'warning',
    alert_kind: 'engine_known_failure_spike',
    engine_known_failures_last_hour: engine.knownFailuresLastHour,
    threshold_per_hour: KNOWN_FAILURE_SPIKE_THRESHOLD,
  };
}

export function engineAlertFields(engine: EngineCounterSnapshot): EngineAlertFields | null {
  const critical: EngineAlertFields = { severity: 'critical' };
  let hasCritical = false;
  const setCritical = (key: keyof Omit<EngineAlertFields, 'severity'>, value: number) => {
    if (value <= 0) return;
    critical[key] = value;
    hasCritical = true;
  };
  const reservationErrorsDelta = Math.max(
    0,
    engine.reservationFailuresDelta - engine.reservationBusyDelta,
  );
  setCritical('engine_fallbacks_tick', engine.fallbacksDelta);
  setCritical('engine_move_failures_tick', engine.moveFailuresDelta);
  setCritical('engine_turns_failed_tick', engine.turnsFailedDelta);
  setCritical('engine_turn_timeouts_tick', engine.turnTimeoutsDelta);
  setCritical('python_pool_errors_tick', engine.pythonPoolErrorsDelta);
  setCritical('python_pool_timeouts_tick', engine.pythonPoolTimeoutsDelta);
  setCritical('engine_reservation_errors_tick', reservationErrorsDelta);
  setCritical('engine_reservation_release_failures_tick', engine.reservationReleaseFailuresDelta);
  if (hasCritical) return critical;

  // Warning-level: no move actually failed this tick, but something is off.
  // - reservation_busy: capacity pressure (seat cap hit).
  // - pool_retries: a worker crashed/errored but R1-recover recovered the move
  //   on a healthy peer. The move succeeded, so it's not critical — but recovery
  //   MASKS worker instability, so surface it (else a crash-looping worker stays
  //   invisible behind successful retries).
  if (engine.reservationBusyDelta > 0 || engine.pythonPoolRetriesDelta > 0) {
    const warning: EngineAlertFields = { severity: 'warning' };
    if (engine.reservationBusyDelta > 0) {
      warning.engine_reservation_busy_tick = engine.reservationBusyDelta;
    }
    if (engine.pythonPoolRetriesDelta > 0) {
      warning.python_pool_retries_tick = engine.pythonPoolRetriesDelta;
    }
    return warning;
  }
  return null;
}

// Infra alert thresholds: process memory (RSS) and event-loop lag — the box-level
// health the engine-move counters don't cover. The variant PvE engines run in this
// process (jungle's in-process αβ) or as subprocesses it spawns, so a saturated event
// loop or runaway RSS is the overload symptom, and nothing else pages on it. Limits are
// env-tunable; 0 disables a check.
//
// RSS is TWO bands, because the web service idles ~0.3 GB on a 24 GB-per-replica box: a
// single OOM-near-ceiling threshold would let a leak run for hours before paging. So a
// WARNING fires at an anomaly level well above normal but far below the ceiling (catch the
// leak early, ~15 GB of runway to react), and a CRITICAL fires near the ceiling (actual
// OOM risk). NB: process.memoryUsage() is the NODE process only — engine subprocesses have
// their own RSS — so multi-GB here is genuinely anomalous, not engine fan-out.
export type InfraGauges = {
  rssMb: number;
  loopLagP99Ms: number;
  loopLagMaxMs: number;
};

export type InfraAlertLimits = {
  rssWarnMb: number; // RSS at/above this (but below rssMb) → warning (leak/anomaly). 0 disables.
  rssMb: number; // RSS at/above this → critical (OOM risk). 0 disables.
  loopLagP99Ms: number; // loop-lag p99 at/above this → warning (CPU saturation). 0 disables.
};

export function infraAlertLimits(): InfraAlertLimits {
  return {
    // Defaults calibrated to a 24 GB (24576 MiB) ceiling: warn at ~4 GB (≈11× the ~0.37 GB
    // peak, 17% of ceiling), critical at ~80% of the ceiling. Override per the real box size.
    rssWarnMb: envInt('MISTBOARD_ALERT_RSS_WARN_MB', 4096),
    rssMb: envInt('MISTBOARD_ALERT_RSS_MB', 19660),
    loopLagP99Ms: envInt('MISTBOARD_ALERT_LOOP_LAG_P99_MS', 400),
  };
}

export function infraAlertFields(
  gauges: InfraGauges,
  limits: InfraAlertLimits = infraAlertLimits(),
): EngineAlertEmailPayload | null {
  const fields: EngineAlertEmailPayload = { severity: 'warning', alert_kind: 'infra' };
  let breached = false;
  let critical = false;
  if (limits.rssMb > 0 && gauges.rssMb >= limits.rssMb) {
    fields.rss_mb = gauges.rssMb;
    fields.rss_limit_mb = limits.rssMb;
    breached = true;
    critical = true; // near the ceiling → OOM risk
  } else if (limits.rssWarnMb > 0 && gauges.rssMb >= limits.rssWarnMb) {
    fields.rss_mb = gauges.rssMb;
    fields.rss_warn_mb = limits.rssWarnMb;
    breached = true; // anomalously high → likely a leak; warning, lots of runway left
  }
  if (limits.loopLagP99Ms > 0 && gauges.loopLagP99Ms >= limits.loopLagP99Ms) {
    fields.loop_lag_p99_ms = Math.round(gauges.loopLagP99Ms);
    fields.loop_lag_max_ms = Math.round(gauges.loopLagMaxMs);
    fields.loop_lag_limit_ms = limits.loopLagP99Ms;
    breached = true;
  }
  if (!breached) return null;
  if (critical) fields.severity = 'critical';
  return fields;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// Wire-format counters for the snapshot→delta protocol. Watching:
// - `snapshot_requests`: rate of clients asking for a fresh snapshot.
//   Should be near-zero in steady state. A sustained nonzero rate
//   indicates a gap-detection loop on some client (seq skip → request →
//   reconcile → next event also skipped → repeat). Added 2026-05-22 as
//   the readback signal for the snapshot→delta migration (Phase 3).
// - `unknown_messages`: rate of WS frames with no matching handler.
// - `parse_failures`: rate of WS frames that failed JSON.parse or
//   shape validation.
class WsCounters {
  totalSnapshotRequests = 0;
  totalUnknownMessages = 0;
  totalParseFailures = 0;
  private latencyByRegion = new Map<string, number[]>();
  private dailyLatency = new DailyRttAccumulator();
  private lastEmittedSnapshotRequests = 0;
  private lastEmittedUnknownMessages = 0;
  private lastEmittedParseFailures = 0;

  recordSnapshotRequest(): void {
    this.totalSnapshotRequests += 1;
  }
  recordUnknownMessage(): void {
    this.totalUnknownMessages += 1;
  }
  recordParseFailure(): void {
    this.totalParseFailures += 1;
  }
  recordLatencySample(region: string, rttMs: number, atMs = Date.now()): void {
    const normalizedRegion = normalizeLatencyRegion(region);
    this.dailyLatency.record(normalizedRegion, rttMs, atMs);
    const samples = this.latencyByRegion.get(normalizedRegion) ?? [];
    samples.push(rttMs);
    this.latencyByRegion.set(normalizedRegion, samples);
  }

  snapshotDailyLatency(atMs = Date.now(), thresholdsMs: readonly number[] = []) {
    return this.dailyLatency.snapshot(atMs, thresholdsMs);
  }

  snapshot(): {
    snapshotRequests: number;
    unknownMessages: number;
    parseFailures: number;
    snapshotRequestsDelta: number;
    unknownMessagesDelta: number;
    parseFailuresDelta: number;
    latencySamples: number;
    latencyP50: number | null;
    latencyP95: number | null;
    latencyMax: number | null;
    latencyByRegion: Record<string, { samples: number; p50: number; p95: number; max: number }>;
  } {
    const snapshotRequestsDelta = this.totalSnapshotRequests - this.lastEmittedSnapshotRequests;
    const unknownMessagesDelta = this.totalUnknownMessages - this.lastEmittedUnknownMessages;
    const parseFailuresDelta = this.totalParseFailures - this.lastEmittedParseFailures;
    this.lastEmittedSnapshotRequests = this.totalSnapshotRequests;
    this.lastEmittedUnknownMessages = this.totalUnknownMessages;
    this.lastEmittedParseFailures = this.totalParseFailures;
    const allLatency: number[] = [];
    const latencyByRegion: Record<
      string,
      { samples: number; p50: number; p95: number; max: number }
    > = {};
    for (const [region, samples] of this.latencyByRegion) {
      allLatency.push(...samples);
      latencyByRegion[region] = latencyStats(samples);
    }
    this.latencyByRegion.clear();
    const globalLatency = allLatency.length > 0 ? latencyStats(allLatency) : null;
    return {
      snapshotRequests: this.totalSnapshotRequests,
      unknownMessages: this.totalUnknownMessages,
      parseFailures: this.totalParseFailures,
      snapshotRequestsDelta,
      unknownMessagesDelta,
      parseFailuresDelta,
      latencySamples: allLatency.length,
      latencyP50: globalLatency?.p50 ?? null,
      latencyP95: globalLatency?.p95 ?? null,
      latencyMax: globalLatency?.max ?? null,
      latencyByRegion,
    };
  }
}

export const wsCounters = new WsCounters();

// Fire-and-forget an alert email, logging the delivery outcome. Shared by the
// engine-counter alerts and the infra (memory / loop-lag) alerts.
function dispatchAlertEmail(alert: EngineAlertEmailPayload): void {
  void sendEngineAlertNotification(alert)
    .then((result) => {
      if (result.status === 'sent') {
        logger.info(
          { kind: 'engine_alert_email_sent', severity: alert.severity },
          'alert email sent',
        );
      }
      if (result.status === 'failed') {
        logger.error(
          {
            kind: 'engine_alert_email_failed',
            provider: 'resend',
            severity: alert.severity,
            status: result.statusCode,
            error: result.error,
          },
          'alert email failed',
        );
      }
    })
    .catch((err) => {
      logger.error(
        {
          kind: 'engine_alert_email_failed',
          provider: 'resend',
          severity: alert.severity,
          error: (err as Error).message,
        },
        'alert email failed',
      );
    });
}

export function startObservability(sources: ObsSources, intervalMs = 5_000): () => void {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let lastTickAt = Date.now();

  const timer = setInterval(() => {
    const now = Date.now();
    const tickMs = now - lastTickAt;
    lastTickAt = now;
    const mem = process.memoryUsage();
    const engine = engineCounters.snapshot();
    const auth = authCounters.snapshot();
    const ws = wsCounters.snapshot();
    const loopLagP50Ms = nsToMs(histogram.percentile(50));
    const loopLagP99Ms = nsToMs(histogram.percentile(99));
    const loopLagMaxMs = nsToMs(histogram.max);
    const rssMb = Math.round(mem.rss / (1024 * 1024));
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));

    const engineAlert = engineAlertFields(engine);
    if (engineAlert) {
      const logAlert = engineAlert.severity === 'critical' ? logger.error : logger.warn;
      logAlert.call(logger, { kind: 'engine_alert', ...engineAlert }, 'engine alert');
      dispatchAlertEmail(engineAlert);
    }
    const spikeAlert = knownFailureSpikeAlert(engine);
    if (spikeAlert) {
      logger.warn({ kind: 'engine_alert', ...spikeAlert }, 'engine alert');
      dispatchAlertEmail(spikeAlert);
    }

    // Infra alerts: box-level health (RSS / event-loop lag) the engine-move counters
    // don't cover. The variant PvE engines run on this process, so a saturated loop or
    // runaway RSS is the overload symptom — nothing else pages on it.
    const infraAlert = infraAlertFields({ rssMb, loopLagP99Ms, loopLagMaxMs });
    if (infraAlert) {
      const logAlert = infraAlert.severity === 'critical' ? logger.error : logger.warn;
      logAlert.call(logger, { kind: 'infra_alert', ...infraAlert }, 'infra alert');
      dispatchAlertEmail(infraAlert);
    }

    logger.info(
      {
        kind: 'metrics',
        rooms: sources.roomCount(),
        ws_clients: sources.wsClientCount(),
        loop_lag_p50_ms: loopLagP50Ms,
        loop_lag_p99_ms: loopLagP99Ms,
        loop_lag_max_ms: loopLagMaxMs,
        heap_used_mb: heapUsedMb,
        rss_mb: rssMb,
        tick_ms: tickMs,
        auth_start_requests_total: auth.startRequests,
        auth_start_requests_tick: auth.startRequestsDelta,
        auth_codes_sent_total: auth.codesSent,
        auth_codes_sent_tick: auth.codesSentDelta,
        auth_start_rate_limited_total: auth.startRateLimited,
        auth_start_rate_limited_tick: auth.startRateLimitedDelta,
        auth_delivery_failures_total: auth.deliveryFailures,
        auth_delivery_failures_tick: auth.deliveryFailuresDelta,
        auth_confirm_requests_total: auth.confirmRequests,
        auth_confirm_requests_tick: auth.confirmRequestsDelta,
        auth_confirm_successes_total: auth.confirmSuccesses,
        auth_confirm_successes_tick: auth.confirmSuccessesDelta,
        auth_confirm_rate_limited_total: auth.confirmRateLimited,
        auth_confirm_rate_limited_tick: auth.confirmRateLimitedDelta,
        engine_moves_total: engine.moves,
        engine_fallbacks_total: engine.fallbacks,
        engine_move_failures_total: engine.moveFailures,
        engine_moves_tick: engine.movesDelta,
        engine_fallbacks_tick: engine.fallbacksDelta,
        engine_move_failures_tick: engine.moveFailuresDelta,
        engine_fallback_rate: Number(engine.rate.toFixed(4)),
        engine_reservation_failures_total: engine.reservationFailures,
        engine_reservation_failures_tick: engine.reservationFailuresDelta,
        engine_reservation_busy_total: engine.reservationBusy,
        engine_reservation_busy_tick: engine.reservationBusyDelta,
        engine_reservation_release_failures_total: engine.reservationReleaseFailures,
        engine_reservation_release_failures_tick: engine.reservationReleaseFailuresDelta,
        engine_turns_started_total: engine.turnsStarted,
        engine_turns_started_tick: engine.turnsStartedDelta,
        engine_turns_completed_total: engine.turnsCompleted,
        engine_turns_completed_tick: engine.turnsCompletedDelta,
        engine_turns_failed_total: engine.turnsFailed,
        engine_turns_failed_tick: engine.turnsFailedDelta,
        engine_turn_timeouts_total: engine.turnTimeouts,
        engine_turn_timeouts_tick: engine.turnTimeoutsDelta,
        engine_turn_deadline_guards_total: engine.deadlineGuards,
        engine_turn_deadline_guards_tick: engine.deadlineGuardsDelta,
        engine_known_failures_total: engine.knownFailures,
        engine_known_failures_tick: engine.knownFailuresDelta,
        engine_known_failures_by_signature_tick: engine.knownFailuresBySignatureTick,
        engine_known_failures_last_hour: engine.knownFailuresLastHour,
        engine_turn_latency_samples_tick: engine.turnLatencySamples,
        engine_turn_elapsed_p50_ms: engine.turnElapsedP50,
        engine_turn_elapsed_p95_ms: engine.turnElapsedP95,
        engine_turn_elapsed_max_ms: engine.turnElapsedMax,
        engine_turn_queue_wait_p50_ms: engine.turnQueueWaitP50,
        engine_turn_queue_wait_p95_ms: engine.turnQueueWaitP95,
        engine_turn_queue_wait_max_ms: engine.turnQueueWaitMax,
        python_pool_errors_total: engine.pythonPoolErrors,
        python_pool_errors_tick: engine.pythonPoolErrorsDelta,
        python_pool_timeouts_total: engine.pythonPoolTimeouts,
        python_pool_timeouts_tick: engine.pythonPoolTimeoutsDelta,
        python_pool_retries_total: engine.pythonPoolRetries,
        python_pool_retries_tick: engine.pythonPoolRetriesDelta,
        ws_snapshot_requests_total: ws.snapshotRequests,
        ws_snapshot_requests_tick: ws.snapshotRequestsDelta,
        ws_unknown_messages_total: ws.unknownMessages,
        ws_unknown_messages_tick: ws.unknownMessagesDelta,
        ws_parse_failures_total: ws.parseFailures,
        ws_parse_failures_tick: ws.parseFailuresDelta,
        ws_latency_samples_tick: ws.latencySamples,
        ws_latency_p50_ms: ws.latencyP50,
        ws_latency_p95_ms: ws.latencyP95,
        ws_latency_max_ms: ws.latencyMax,
        ws_latency_by_region: ws.latencyByRegion,
      },
      'metrics',
    );
    histogram.reset();
  }, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}

function nsToMs(ns: number): number {
  return Math.round(ns / 1e4) / 100;
}

function latencyStats(samples: number[]): {
  samples: number;
  p50: number;
  p95: number;
  max: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index]!;
}
