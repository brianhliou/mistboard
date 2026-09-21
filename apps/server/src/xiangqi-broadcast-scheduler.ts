// In-server scheduled polling for xiangqi broadcast tours. A single tick loop
// scans enabled tours from persistence (so ops changes apply without a
// restart) and polls each one on its own interval, reusing the shared poller
// (source policy, timeout, sync logs) and its failure backoff.

import * as persistence from './persistence.js';
import { requestBroadcastLiveEvalForBoard } from './xiangqi-broadcast-live-eval.js';
import {
  nextXiangqiBroadcastPollDelayMs,
  pollXiangqiBroadcastSourceOnce,
  type XiangqiBroadcastPollResult,
  xiangqiBroadcastPollSchedule,
} from './xiangqi-broadcast-poller.js';

export const XIANGQI_BROADCAST_SCHEDULE_MIN_INTERVAL_MS = 5_000;
export const XIANGQI_BROADCAST_SCHEDULE_MAX_INTERVAL_MS = 300_000;
export const XIANGQI_BROADCAST_SCHEDULE_DEFAULT_INTERVAL_MS = 30_000;
const SCHEDULER_TICK_MS = 5_000;

export function clampXiangqiBroadcastScheduleIntervalMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return XIANGQI_BROADCAST_SCHEDULE_DEFAULT_INTERVAL_MS;
  }
  return Math.min(
    Math.max(value, XIANGQI_BROADCAST_SCHEDULE_MIN_INTERVAL_MS),
    XIANGQI_BROADCAST_SCHEDULE_MAX_INTERVAL_MS,
  );
}

export type XiangqiBroadcastSchedulerDeps = {
  listScheduledTours(): Promise<persistence.XiangqiBroadcastTourSchedule[]>;
  poll(input: {
    sourceUrl: string;
    tourSlug: string;
    timeoutMs: number;
  }): Promise<XiangqiBroadcastPollResult>;
  recordSyncLog(
    input: Parameters<typeof persistence.recordXiangqiBroadcastSyncLog>[0],
  ): Promise<void>;
  now(): number;
  /** Ask the live engine layer for a board that just gained moves. Fire and
   *  forget: the scheduler never waits on a search. Optional so the polling
   *  tests need no engine. */
  evaluateLiveBoard?(boardId: string): Promise<void>;
};

const liveDeps: XiangqiBroadcastSchedulerDeps = {
  listScheduledTours: () => persistence.listXiangqiBroadcastScheduledTours(),
  poll: (input) => pollXiangqiBroadcastSourceOnce(input),
  recordSyncLog: (input) => persistence.recordXiangqiBroadcastSyncLog(input),
  now: () => Date.now(),
  evaluateLiveBoard: (boardId) => requestBroadcastLiveEvalForBoard(boardId),
};

// Update statuses that change a board's head position. `unchanged` is the
// idle poll; the live-eval trigger re-reads the board and skips one that the
// same update finished.
const LIVE_EVAL_TRIGGER_STATUSES = new Set(['created', 'extended', 'updated', 'corrected']);

export type XiangqiBroadcastScheduler = {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
};

function pollResultChangedSomething(
  result: Extract<XiangqiBroadcastPollResult, { ok: true }>,
): boolean {
  return (
    result.boardsFailed > 0 ||
    result.sourcesFailed > 0 ||
    result.updates.some((update) => update.ok && update.status !== 'unchanged')
  );
}

export function createXiangqiBroadcastScheduler(
  deps: XiangqiBroadcastSchedulerDeps = liveDeps,
): XiangqiBroadcastScheduler {
  const nextPollAt = new Map<string, number>();
  const currentDelayMs = new Map<string, number>();
  let ticking = false;
  let interval: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const tours = await deps.listScheduledTours();
      const enabledSlugs = new Set(tours.map((tour) => tour.slug));
      for (const slug of nextPollAt.keys()) {
        if (!enabledSlugs.has(slug)) {
          nextPollAt.delete(slug);
          currentDelayMs.delete(slug);
        }
      }

      for (const tour of tours) {
        if (!tour.sourceUrl) continue;
        const now = deps.now();
        if (now < (nextPollAt.get(tour.slug) ?? 0)) continue;

        const intervalMs = clampXiangqiBroadcastScheduleIntervalMs(tour.pollIntervalMs);
        const result = await deps.poll({
          sourceUrl: tour.sourceUrl,
          tourSlug: tour.slug,
          timeoutMs: 10_000,
        });
        if (result.ok && deps.evaluateLiveBoard) {
          for (const update of result.updates) {
            if (!update.ok || !LIVE_EVAL_TRIGGER_STATUSES.has(update.status)) continue;
            deps.evaluateLiveBoard(update.boardId).catch((error: unknown) => {
              console.error(
                JSON.stringify({
                  level: 'error',
                  kind: 'xiangqi_broadcast_live_eval_trigger_failed',
                  boardId: update.boardId,
                  error: error instanceof Error ? error.message : String(error),
                  at: deps.now(),
                }),
              );
            });
          }
        }
        // The poller records its own failure sync logs; the scheduler only
        // records successful polls that changed something, so a healthy idle
        // source does not grow the log table on every interval.
        if (result.ok && pollResultChangedSomething(result)) {
          await deps.recordSyncLog({
            tourSlug: result.tourSlug,
            severity: result.boardsFailed > 0 || result.sourcesFailed > 0 ? 'warning' : 'info',
            kind: 'poll_ok',
            message: 'scheduled source poll applied updates',
            payload: {
              sourceUrl: result.sourceUrl,
              roundsImported: result.roundsImported,
              boardsSeen: result.boardsSeen,
              boardsFailed: result.boardsFailed,
              sourcesSeen: result.sourcesSeen,
              sourcesFailed: result.sourcesFailed,
            },
          });
        }

        const delayMs = nextXiangqiBroadcastPollDelayMs({
          result,
          previousDelayMs: currentDelayMs.get(tour.slug) ?? intervalMs,
          schedule: xiangqiBroadcastPollSchedule({
            intervalMs,
            maxIntervalMs: XIANGQI_BROADCAST_SCHEDULE_MAX_INTERVAL_MS,
          }),
        });
        currentDelayMs.set(tour.slug, delayMs);
        nextPollAt.set(tour.slug, deps.now() + delayMs);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'xiangqi_broadcast_scheduler_tick_failed',
          error: error instanceof Error ? error.message : String(error),
          at: deps.now(),
        }),
      );
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    start() {
      if (interval) return;
      interval = setInterval(() => {
        void tick();
      }, SCHEDULER_TICK_MS);
      interval.unref?.();
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
  };
}

export function startXiangqiBroadcastScheduler(
  deps: XiangqiBroadcastSchedulerDeps = liveDeps,
): XiangqiBroadcastScheduler {
  const scheduler = createXiangqiBroadcastScheduler(deps);
  scheduler.start();
  return scheduler;
}
