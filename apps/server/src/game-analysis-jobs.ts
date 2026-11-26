// In-memory job queue for whole-game analysis/decisions compute (#208).
//
// POST /api/<variant>/games/:id/(analysis|decisions) no longer computes inside
// the HTTP request (a sweep is 30s-minutes — the CDN/Railway edge killed the
// held request first). It enqueues here and returns 202 + {jobId}; the client
// polls. Store design: an in-memory job map + the EXISTING game_analysis table
// as the durable result store. That is deliberate — this is a single web
// instance, jobs are recomputable from the event log, and the resolver already
// persists every finished computation to game_analysis, so a process restart
// loses only the job HANDLE (the client re-POSTs and either hits the cache or
// re-enqueues, resuming from the incremental progress checkpoint). A jobs table
// would add a migration + reaper for strictly less recoverable state.
//
// Execution is a FIFO chain with concurrency 1 PER LANE (see chains): sweeps are CPU-bound and
// the per-variant analysis pools hold one persistent engine each — running two
// sweeps at once would just make both slower and steal CPU from live games.
// Completed jobs (done/failed) are retained ~10 minutes for polling, then GC'd.

import { randomUUID } from 'node:crypto';
import { type AnalysisJobProgress, withAnalysisJobProgress } from './analysis-job-progress.js';
import { captureServerEvent } from './analytics-server.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';
import { inFlightWork, logger } from './obs.js';

export type AnalysisJobKind = 'analysis' | 'decisions';
export type AnalysisJobStatus = 'pending' | 'done' | 'failed';

export type AnalysisJob = {
  id: string;
  /** Route id ('xiangqi', 'jungle-flip', …). */
  variant: string;
  roomId: string;
  kind: AnalysisJobKind;
  /** Account that enqueued it (POST is account-gated), for the in-flight cap. */
  accountId: string;
  status: AnalysisJobStatus;
  /** snake_case error code when failed. */
  error: string | null;
  /** The 200-envelope the sync path used to return; held in memory so the poll
   *  endpoint can serve it even when persistence is disabled (memory-only dev). */
  result: unknown;
  startedAt: number | null;
  progress: AnalysisJobProgress;
  createdAt: number;
  finishedAt: number | null;
};

// How many jobs one account may have pending at once. Two lets a user queue a
// sweep and a decomposition; a third request gets 429 instead of monopolizing
// the single compute lane.
export const ANALYSIS_ACCOUNT_PENDING_CAP = 2;
// Global pending bound: past this the instance is saturated for tens of minutes
// anyway, so shed with an explicit error instead of an unbounded queue.
export const ANALYSIS_QUEUE_PENDING_CAP = 32;
// Completed jobs stay pollable this long.
const FINISHED_JOB_TTL_MS = 10 * 60 * 1000;

const jobs = new Map<string, AnalysisJob>();
// FIFO execution chains, one per lane (concurrency 1 each).
/**
 * One serial chain PER LANE, not one globally.
 *
 * Every variant but fog computes in THIS process (jieqi spawns PikaJieQi, xiangqi
 * Pikafish, banqi/jungle their Rust binaries), so serialising them protects the
 * web service. Fog is the exception: it POSTs to the engine-worker and this
 * process only holds a socket. A single global chain therefore made a two-minute
 * fog job block a jieqi job that would have finished in seconds — two pieces of
 * work with no shared resource, queued behind each other for no reason.
 */
type JobLane = 'local' | 'remote';
const REMOTE_LANE_VARIANTS = new Set(['dark-chess']);
const chains: Record<JobLane, Promise<void>> = {
  local: Promise.resolve(),
  remote: Promise.resolve(),
};

function laneFor(variant: string): JobLane {
  return REMOTE_LANE_VARIANTS.has(variant) ? 'remote' : 'local';
}

function pendingJobs(): AnalysisJob[] {
  return [...jobs.values()].filter((job) => job.status === 'pending');
}

// ── Per-job timing (#1244) ────────────────────────────────────────────────────
//
// One record per job: how long it waited behind its lane and how long it ran,
// so the priority / scaling decision in #1244 is made on data. A refused
// enqueue (queue full, account cap) is recorded as 'dropped' with no times.

export type AnalysisJobOutcome = 'ok' | 'failed' | 'dropped';

export type AnalysisJobTiming = {
  /** Route id ('xiangqi', 'jungle-flip', …), the same value as AnalysisJob.variant. */
  variant: string;
  kind: AnalysisJobKind;
  lane: JobLane;
  /** Moves in the game, when the caller passed a position total; null otherwise. */
  plies: number | null;
  /** Jobs already waiting or running in this job's lane when it was enqueued. */
  queueLengthAtEnqueue: number;
  /** Enqueue to start; null when dropped. */
  waitMs: number | null;
  /** Start to finish or failure; null when dropped. */
  runMs: number | null;
  outcome: AnalysisJobOutcome;
  /** Error code on failed or dropped. */
  error: string | null;
};

type AnalysisJobTelemetry = {
  now(): number;
  record(accountId: string, timing: AnalysisJobTiming): void;
};

function recordToPostHog(accountId: string, timing: AnalysisJobTiming): void {
  // A line in the deploy logs too, so the queue can be read when analytics is
  // off or blocked. No account id in the line.
  console.log(`[analysis-job] ${JSON.stringify(timing)}`);
  void captureServerEvent({
    event: 'analysis_job_finished',
    distinctId: accountId,
    properties: { ...timing },
  });
}

const defaultTelemetry: AnalysisJobTelemetry = { now: Date.now, record: recordToPostHog };
let telemetry: AnalysisJobTelemetry = defaultTelemetry;

/** Test seam: swap the clock and/or the recorder. Returns a restore function. */
export function setAnalysisJobTelemetryForTests(next: Partial<AnalysisJobTelemetry>): () => void {
  const previous = telemetry;
  telemetry = { ...previous, ...next };
  return () => {
    telemetry = previous;
  };
}

function laneQueueLength(lane: JobLane): number {
  return pendingJobs().filter((job) => laneFor(job.variant) === lane).length;
}

function pliesFromTotal(total: number | undefined): number | null {
  // Callers pass total = plies + 1 (positions, start included).
  return total !== undefined && Number.isSafeInteger(total) && total > 0 ? total - 1 : null;
}

/** The pending job for a (variant, room, kind), if any — POSTs coalesce onto it. */
export function findPendingAnalysisJob(
  variant: string,
  roomId: string,
  kind: AnalysisJobKind,
): AnalysisJob | null {
  for (const job of jobs.values()) {
    if (
      job.status === 'pending' &&
      job.variant === variant &&
      job.roomId === roomId &&
      job.kind === kind
    ) {
      return job;
    }
  }
  return null;
}

/** Latest retained handle, including a failure or memory-only completed result. */
export function findLatestAnalysisJob(
  variant: string,
  roomId: string,
  kind: AnalysisJobKind,
): AnalysisJob | null {
  let latest: AnalysisJob | null = null;
  for (const job of jobs.values())
    if (job.variant === variant && job.roomId === roomId && job.kind === kind) latest = job;
  return latest;
}

/** Jobs waiting or running, across lanes. The broadcast analysis sweep only
 *  enqueues when this is zero, so a reader's request never waits behind it. */
export function pendingAnalysisJobCount(): number {
  return pendingJobs().length;
}

export function getAnalysisJob(id: string): AnalysisJob | null {
  return jobs.get(id) ?? null;
}

export type EnqueueAnalysisJobResult =
  | { ok: true; job: AnalysisJob }
  | { ok: false; error: 'too_many_pending_analyses' | 'analysis_queue_full' };

/**
 * Enqueue a compute job. `run` produces the same envelope the synchronous 200
 * path returned; it runs on its lane's FIFO chain. Callers must have handled
 * coalescing (findPendingAnalysisJob) and the cached fast path first.
 */
export function enqueueAnalysisJob(args: {
  variant: string;
  roomId: string;
  kind: AnalysisJobKind;
  accountId: string;
  total?: number;
  run(): Promise<unknown>;
}): EnqueueAnalysisJobResult {
  const lane = laneFor(args.variant);
  const queueLengthAtEnqueue = laneQueueLength(lane);
  const plies = pliesFromTotal(args.total);
  const timing = (
    outcome: AnalysisJobOutcome,
    error: string | null,
    waitMs: number | null,
    runMs: number | null,
  ): AnalysisJobTiming => ({
    variant: args.variant,
    kind: args.kind,
    lane,
    plies,
    queueLengthAtEnqueue,
    waitMs,
    runMs,
    outcome,
    error,
  });

  const pending = pendingJobs();
  const refusal: 'too_many_pending_analyses' | 'analysis_queue_full' | null =
    pending.length >= ANALYSIS_QUEUE_PENDING_CAP
      ? 'analysis_queue_full'
      : pending.filter((job) => job.accountId === args.accountId).length >=
          ANALYSIS_ACCOUNT_PENDING_CAP
        ? 'too_many_pending_analyses'
        : null;
  if (refusal) {
    telemetry.record(args.accountId, timing('dropped', refusal, null, null));
    return { ok: false, error: refusal };
  }

  const job: AnalysisJob = {
    id: randomUUID(),
    variant: args.variant,
    roomId: args.roomId,
    kind: args.kind,
    accountId: args.accountId,
    status: 'pending',
    error: null,
    result: null,
    startedAt: null,
    progress: { phase: 'analysis', completed: 0, total: args.total ?? 0 },
    createdAt: telemetry.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);

  chains[lane] = chains[lane].then(async () => {
    const endWork = inFlightWork.startJob(
      args.kind === 'analysis' ? 'game_analysis' : 'game_decisions',
    );
    try {
      job.startedAt = telemetry.now();
      job.result = await withAnalysisJobProgress((update) => {
        if (update.phase) job.progress.phase = update.phase;
        if (Number.isSafeInteger(update.total) && update.total! >= 0)
          job.progress.total = update.total!;
        if (Number.isSafeInteger(update.completed) && update.completed! >= 0)
          job.progress.completed = Math.min(update.completed!, job.progress.total);
      }, args.run);
      job.status = 'done';
    } catch (err) {
      job.status = 'failed';
      // A scoreless sweep is the fail-closed engine signal the sync path mapped
      // to 503; every other failure is opaque to the client by design.
      job.error =
        err instanceof VacuousAnalysisError ? 'analysis_engine_unavailable' : 'analysis_failed';
      logger.error(
        {
          kind: 'analysis_job_failed',
          job_id: job.id,
          variant: job.variant,
          room_id: job.roomId,
          job_kind: job.kind,
          error: err instanceof Error ? err.message : String(err),
        },
        'Whole-game analysis job failed',
      );
    } finally {
      endWork();
      job.finishedAt = telemetry.now();
      const startedAt = job.startedAt ?? job.finishedAt;
      try {
        telemetry.record(
          job.accountId,
          timing(
            job.status === 'done' ? 'ok' : 'failed',
            job.error,
            startedAt - job.createdAt,
            job.finishedAt - startedAt,
          ),
        );
      } catch {
        // Recording never fails a job.
      }
      // Retain for polling, then drop. .unref() so a pending GC timer never
      // keeps the process alive (repo hard rule on speculative timers).
      setTimeout(() => jobs.delete(job.id), FINISHED_JOB_TTL_MS).unref();
    }
  });

  return { ok: true, job };
}

/** Wire shape for the poll endpoint. `result` only on done; `error` only on failed. */
export function analysisJobStatusBody(job: AnalysisJob): Record<string, unknown> {
  if (job.status === 'done') return { status: 'done', result: job.result };
  if (job.status === 'failed') return { status: 'failed', error: job.error ?? 'analysis_failed' };
  return {
    status: 'pending',
    state: job.startedAt === null ? 'queued' : 'running',
    progress: { ...job.progress },
  };
}

/** Test hook: drop all jobs and wait out the execution chain. */
export async function resetAnalysisJobsForTests(): Promise<void> {
  await Promise.all(Object.values(chains).map((lane) => lane.catch(() => {})));
  jobs.clear();
}
