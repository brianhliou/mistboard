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
import { VacuousAnalysisError } from './game-analysis-sweep.js';
import { logger } from './obs.js';

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
  run(): Promise<unknown>;
}): EnqueueAnalysisJobResult {
  const pending = pendingJobs();
  if (pending.length >= ANALYSIS_QUEUE_PENDING_CAP) {
    return { ok: false, error: 'analysis_queue_full' };
  }
  if (
    pending.filter((job) => job.accountId === args.accountId).length >= ANALYSIS_ACCOUNT_PENDING_CAP
  ) {
    return { ok: false, error: 'too_many_pending_analyses' };
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
    createdAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);

  const lane = laneFor(args.variant);
  chains[lane] = chains[lane].then(async () => {
    try {
      job.result = await args.run();
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
      job.finishedAt = Date.now();
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
  return { status: 'pending' };
}

/** Test hook: drop all jobs and wait out the execution chain. */
export async function resetAnalysisJobsForTests(): Promise<void> {
  await Promise.all(Object.values(chains).map((lane) => lane.catch(() => {})));
  jobs.clear();
}
