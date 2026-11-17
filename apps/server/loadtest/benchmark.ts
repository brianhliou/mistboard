import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { type Activity, type GameResult, type RunnerIO, runScenario } from './runner.js';
import type { Scenario } from './scenarios.js';
import { summarize } from './stats.js';

export interface BenchmarkOptions {
  serverUrl: string;
  scenario: Scenario;
  concurrencies: number[];
  repetitions: number;
  warmupMs: number;
  durationMs: number;
  /** Mean pause before each submission; 0 is a closed loop with no pause. */
  thinkMs?: number;
  seed: number;
  /** Operator declaration, not inferred from the client's environment. */
  persistence: 'memory' | 'disposable-postgres' | 'unknown';
  placement: 'same-host-separate-process' | 'unknown';
}

const MIN_SAMPLES = 100;

export function summarizeRun(
  games: GameResult[],
  activity: Activity[],
  warmupMs: number,
  durationMs: number,
  elapsedMs: number,
) {
  const end = warmupMs + durationMs;
  const attempts = games.flatMap((game) => game.moveAttempts);
  const measured = attempts.filter((a) => a.phase === 'measurement');
  const samples = measured
    .filter((a) => a.outcome === 'acknowledged' && a.receivedMs! <= end)
    .map((a) => a.latencyMs!);
  const failures = games.flatMap((game) => game.failures);
  const reasons: string[] = [];
  if (failures.length) reasons.push('game-failures');
  if (samples.length < MIN_SAMPLES) reasons.push('insufficient-samples');
  if (elapsedMs < end) reasons.push('incomplete-window');
  if (samples.some((n) => !Number.isFinite(n) || n < 0)) reasons.push('invalid-samples');
  let active = 0;
  for (const point of activity) if (point.atMs <= warmupMs) active = point.activeGames;
  const window = [
    { atMs: warmupMs, activeGames: active },
    ...activity.filter((p) => p.atMs > warmupMs && p.atMs < end),
    { atMs: end, activeGames: 0 },
  ];
  let activeGameMs = 0;
  for (let i = 0; i < window.length - 1; i++) {
    activeGameMs += window[i]!.activeGames * (window[i + 1]!.atMs - window[i]!.atMs);
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    minimumSamples: MIN_SAMPLES,
    sampleCount: samples.length,
    attemptedMoves: measured.length,
    outcomes: Object.fromEntries(
      ['acknowledged', 'rejected', 'timeout', 'disconnected', 'window-ended'].map((outcome) => [
        outcome,
        attempts.filter((a) => a.outcome === outcome).length,
      ]),
    ),
    failures,
    achievedMovesPerSecond: samples.length / (durationMs / 1000),
    activeGames: {
      definition: 'paired sockets with authoritative playing state; excludes setup and teardown',
      min: window.slice(0, -1).reduce((n, p) => Math.min(n, p.activeGames), Infinity),
      max: window.reduce((n, p) => Math.max(n, p.activeGames), 0),
      mean: activeGameMs / durationMs,
    },
    acknowledgmentMs: reasons.length ? null : summarize(samples),
  };
}

export function captureMetadata(options: BenchmarkOptions) {
  const cwd = new URL('../../../', import.meta.url);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  // Fingerprint runtime source even when benchmarking an uncommitted build.
  const hash = createHash('sha256');
  for (const path of [
    'runner.ts',
    'scenarios.ts',
    'stats.ts',
    'benchmark.ts',
    'cli.ts',
    '../integration/harness.ts',
  ]) {
    hash.update(path).update(readFileSync(new URL(path, import.meta.url)));
  }
  return {
    sourceRevision: git('rev-parse', 'HEAD'),
    sourceDirty: git('status', '--porcelain').length > 0,
    harnessSha256: hash.digest('hex'),
    node: process.version,
    hardware: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
    },
    persistence: options.persistence,
    placement: { client: 'local load-generator process', server: options.placement },
    target: options.serverUrl,
    nonProduction: true,
  };
}

/** Setup stagger: 10 ms per game, never more than half the warmup. */
export const RAMP_MS_PER_GAME = 10;
export function rampMs(concurrency: number, warmupMs: number): number {
  return Math.min(concurrency * RAMP_MS_PER_GAME, warmupMs / 2);
}

export async function runBenchmark(options: BenchmarkOptions, io?: RunnerIO) {
  const metadata = captureMetadata(options);
  const runs = [];
  const now = io?.now ?? (() => performance.now());
  for (const concurrency of options.concurrencies) {
    for (let repetition = 1; repetition <= options.repetitions; repetition++) {
      const startedAt = new Date().toISOString();
      const start = now();
      const activity: Activity[] = [];
      const games = await runScenario(
        {
          serverUrl: options.serverUrl,
          scenario: options.scenario,
          concurrency,
          warmupMs: options.warmupMs,
          durationMs: options.durationMs,
          thinkMs: options.thinkMs ?? 0,
          rampMs: rampMs(concurrency, options.warmupMs),
          seed: options.seed,
          onActivity: (point) => activity.push(point),
        },
        io,
      );
      const elapsedMs = now() - start;
      runs.push({
        concurrency,
        repetition,
        startedAt,
        elapsedMs,
        activity,
        games,
        summary: summarizeRun(games, activity, options.warmupMs, options.durationMs, elapsedMs),
      });
    }
  }
  const eligible =
    options.scenario.mode === 'pvp' &&
    options.persistence !== 'unknown' &&
    options.placement !== 'unknown' &&
    runs.length > 0 &&
    runs.every((run) => run.summary.eligible);
  // No pooled percentile: retain every repetition, including unsuccessful ones.
  // A failed attempt suppresses all reported latency claims in the bundle.
  if (!eligible) for (const run of runs) run.summary.acknowledgmentMs = null;
  return {
    schemaVersion: 1,
    metric: 'mover-submit-to-authoritative-event-receipt',
    percentileMethod: 'nearest-rank',
    metadata,
    protocol: {
      scenario: options.scenario,
      concurrencies: options.concurrencies,
      repetitions: options.repetitions,
      seed: options.seed,
      warmupMs: options.warmupMs,
      measurementMs: options.durationMs,
      thinkMs: options.thinkMs ?? 0,
      rampMsPerGame: RAMP_MS_PER_GAME,
      minimumSamplesPerRepetition: MIN_SAMPLES,
    },
    eligible,
    runs,
    ineligibleReasons: eligible
      ? []
      : [
          ...(options.scenario.mode !== 'pvp' ? ['pvp-required'] : []),
          ...(options.persistence === 'unknown' ? ['persistence-undeclared'] : []),
          ...(options.placement === 'unknown' ? ['placement-undeclared'] : []),
          ...(!runs.length || runs.some((run) => !run.summary.eligible)
            ? ['failed-or-insufficient-repetition']
            : []),
        ],
  };
}
