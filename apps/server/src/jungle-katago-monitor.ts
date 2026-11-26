// What each KataGo jungle move records about the shared process, and the
// thresholds the daily readout judges those records by.
//
// Every jungle game against the KataGo seat queues its moves on one loaded GTP
// process (jungle-katago-session.ts). A move that arrives while another game's
// search is running waits for it, and the wait comes out of the bot's clock. At
// 1+1 the cheapest move on the loaded process is 850 ms (KATAGO_JUNGLE_MIN_MOVE_MS)
// against a 1,000 ms increment, so a move has about 150 ms to spare; a busy queue
// eats that well before any move hits the 26 s queue timeout. The record below
// rides on the move's live-engine-decision artifact (`katago`), and the readout
// rule in mistboard-readout.ts reads it back.

import type { EngineMoveAttempt } from './engine-move-guard.js';
import type { KatagoMoveTiming } from './jungle-katago-engine.js';

/**
 * A move that waited longer than this behind other games' moves is a slow wait:
 * twice the ~150 ms a 1+1 move has to spare over its floor, so a run of them
 * draws down the bank instead of the increment.
 */
export const KATAGO_SLOW_QUEUE_WAIT_MS = 300;
/** Warn when more than this share of the week's moves waited slow. */
export const KATAGO_SLOW_QUEUE_WAIT_SHARE = 0.05;
/** ...or when 1 move in 20 waited longer than half a 1+1 increment. */
export const KATAGO_P95_QUEUE_WAIT_MS = 500;
/** Below this many recorded moves a week, the share is too noisy to judge. */
export const KATAGO_MIN_MOVES_FOR_RATE = 50;

/** The `katago` block on a KataGo jungle live-engine-decision artifact. */
export type KatagoDecisionRecord = {
  /** Behind other games' moves; null when no attempt got an answer. */
  queue_wait_ms: number | null;
  /** Process start this move paid (net load); 0 on the loaded process. */
  start_ms: number | null;
  /** The search itself, commands sent to last reply. */
  search_ms: number | null;
  process: 'warm' | 'cold' | null;
  /** The process start replaced one a failure had killed. */
  restart: boolean;
  /** More than one attempt was needed (or made, on a failed move). */
  retried: boolean;
  /** Attempts that gave up waiting for the shared process. */
  queue_timeouts: number;
  /** Attempts the process failed: a timeout, a crash, a garbled reply. */
  engine_failures: number;
};

/** The session's queue-timeout rejection (jungle-katago-session.ts). */
export function isKatagoQueueTimeout(error: string | null): boolean {
  return error !== null && /queue timed out/i.test(error);
}

/**
 * The record for one move from the answered attempt's timing (undefined when
 * none answered) and every attempt the engine-move guard made.
 */
export function katagoDecisionRecord(
  timing: KatagoMoveTiming | undefined,
  process: 'warm' | 'cold' | undefined,
  attempts: readonly EngineMoveAttempt[],
): KatagoDecisionRecord {
  const failed = attempts.filter((attempt) => attempt.error !== null);
  const queueTimeouts = failed.filter((attempt) => isKatagoQueueTimeout(attempt.error)).length;
  return {
    queue_wait_ms: timing?.queuedMs ?? null,
    start_ms: timing?.startMs ?? null,
    search_ms: timing?.searchMs ?? null,
    process: process ?? null,
    restart: timing?.restart ?? false,
    retried: attempts.length > 1,
    queue_timeouts: queueTimeouts,
    engine_failures: failed.length - queueTimeouts,
  };
}
