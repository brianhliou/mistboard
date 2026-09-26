// In-server scheduled polling for xiangqi broadcast tours. A single tick loop
// scans pollable tours from persistence (so ops changes apply without a
// restart) and polls each one on its own interval, reusing the shared poller
// (source policy, timeout, sync logs) and its failure backoff.
//
// Which tours poll is the tour's poll mode against its dates
// (xiangqi-broadcast-poll-window.ts): `auto` polls from 12 h before the event
// to 7 days after its last day, `on` always, `off` never. Past the end date a
// polling tour slows to one poll per half hour, since only late record
// uploads are still to come (dpxq's operator, 2026-09-06: 不固定). The window
// is derived, not written to the tour, so when the dpxq index sweep moves an
// end date later (a league's next stage) polling resumes with no operator step.

import * as persistence from './persistence.js';
import { getPool } from './persistence-db.js';
import {
  fetchDpxqTourIndex,
  planDpxqIndexSync,
  rememberDpxqTourIndex,
} from './xiangqi-broadcast-dpxq-index.js';
import { defaultXiangqiBroadcastFetch } from './xiangqi-broadcast-fetch.js';
import { requestBroadcastLiveEvalForBoard } from './xiangqi-broadcast-live-eval.js';
import { xiangqiBroadcastPollState } from './xiangqi-broadcast-poll-window.js';
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
export const XIANGQI_BROADCAST_AFTER_EVENT_INTERVAL_MS = 30 * 60_000;

// How often the scheduler reads dpxq's tour index to keep end dates in step.
// dpxq edits a league's row when the next stage is announced, days ahead.
export const XIANGQI_BROADCAST_INDEX_SWEEP_MS = 6 * 60 * 60_000;

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
  /** Read dpxq's tour index and move relayed tours' end dates out to match
   *  it. Optional so the polling tests need no index. */
  sweepIndex?(): Promise<void>;
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
  sweepIndex: () => sweepDpxqTourIndex(),
  evaluateLiveBoard: (boardId) => requestBroadcastLiveEvalForBoard(boardId),
};

/** One index sweep: every end-date move is applied and logged on its tour.
 *  A failed read is logged without a tour; the next sweep retries. */
export async function sweepDpxqTourIndex(
  deps: {
    fetchImpl?: Parameters<typeof fetchDpxqTourIndex>[0]['fetchImpl'];
    now?: () => number;
  } = {},
): Promise<void> {
  const index = await fetchDpxqTourIndex({
    fetchImpl: deps.fetchImpl ?? defaultXiangqiBroadcastFetch,
    timeoutMs: 15_000,
  });
  if (!index.ok) {
    await persistence.recordXiangqiBroadcastSyncLog({
      severity: 'warning',
      kind: 'dpxq_index_unreadable',
      message: index.message,
    });
    return;
  }
  rememberDpxqTourIndex(index.rows);
  const tours = await persistence.listXiangqiBroadcastTourSourcesOn(getPool());
  const plan = planDpxqIndexSync({ rows: index.rows, tours, now: (deps.now ?? Date.now)() });
  for (const move of plan.endDateMoves) {
    if (!(await persistence.extendXiangqiBroadcastTourEndsAt(move.slug, move.to))) continue;
    await persistence.recordXiangqiBroadcastSyncLog({
      tourSlug: move.slug,
      severity: 'info',
      kind: 'event_end_moved',
      message: `dpxq now lists the event ending ${move.to.slice(0, 10)}`,
      payload: { dpxqTour: move.tourId, from: move.from, to: move.to },
    });
  }
}

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
  // First sweep one tick after start, so a deploy mid-stage catches up at once.
  let nextSweepAt = 0;
  let ticking = false;
  let interval: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      if (deps.sweepIndex && deps.now() >= nextSweepAt) {
        nextSweepAt = deps.now() + XIANGQI_BROADCAST_INDEX_SWEEP_MS;
        await deps.sweepIndex().catch((error: unknown) => {
          console.error(
            JSON.stringify({
              level: 'error',
              kind: 'xiangqi_broadcast_index_sweep_failed',
              error: error instanceof Error ? error.message : String(error),
              at: deps.now(),
            }),
          );
        });
      }
      const tours = await deps.listScheduledTours();
      const listedSlugs = new Set(tours.map((tour) => tour.slug));
      for (const slug of nextPollAt.keys()) {
        if (!listedSlugs.has(slug)) {
          nextPollAt.delete(slug);
          currentDelayMs.delete(slug);
        }
      }

      for (const tour of tours) {
        if (!tour.sourceUrl) continue;
        const now = deps.now();
        const state = xiangqiBroadcastPollState({ ...tour, now });
        if (!state.polling) {
          // A tour this process was polling whose auto window just closed
          // says so once. Tours already outside their window at boot stay
          // silent, so a deploy does not log every past event again.
          if (state.reason === 'auto-closed' && nextPollAt.has(tour.slug)) {
            await deps.recordSyncLog({
              tourSlug: tour.slug,
              severity: 'info',
              kind: 'poll_stopped_after_event',
              message: 'scheduled polling stopped 7 days after the event ended',
              payload: {
                endsAt: tour.endsAt ?? null,
                closesAt: state.closesAt,
                sourceUrl: tour.sourceUrl,
              },
            });
          }
          nextPollAt.delete(tour.slug);
          currentDelayMs.delete(tour.slug);
          continue;
        }
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
        const waitMs = state.afterEvent
          ? Math.max(delayMs, XIANGQI_BROADCAST_AFTER_EVENT_INTERVAL_MS)
          : delayMs;
        nextPollAt.set(tour.slug, deps.now() + waitMs);
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
