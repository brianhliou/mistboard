// Whole-game engine analysis for broadcast games, the same analysis a finished
// site game gets and stored the same way: one Pikafish pass per game, saved in
// game_analysis under `broadcast:<boardId>`, served to every reader. Before this
// the broadcast review ran the sweep in each reader's browser and kept nothing,
// so nobody saw an eval until they asked for one and waited.
//
// Two ways in. The endpoint is the site-game one (createGameAnalysisRoutes):
// GET returns what is stored, POST asks for it and is account-gated. The sweep
// analyses finished boards in the background, one at a time, only while the
// analysis queue is empty, and at most SWEEP_GAMES_PER_HOUR an hour: Pikafish
// runs in the web container beside live games, so the archive trickles in
// rather than landing at once (~400 games is about three days; a new round's
// forty-odd games, most of a day).
//
// The key is the study curator's (it already analyses the boards it seeds), so
// a board it has done is never done twice.

import type { XiangqiMove } from '@mistboard/game';
import { enqueueAnalysisJob, pendingAnalysisJobCount } from './game-analysis-jobs.js';
import * as persistence from './persistence.js';
import { createGameAnalysisRoutes } from './routes/game-analysis-route.js';
import { resolveXiangqiAnalysis } from './routes/xiangqi-games.js';
import { XIANGQI_ANALYSIS_ENGINE_ID, XIANGQI_ANALYSIS_REQUEST_DEPTH } from './xiangqi-analysis.js';
import { XIANGQI_BROADCAST_TOUR_LEVELS } from './xiangqi-broadcast-levels.js';

/** A broadcast board's analysis lives under this room key (game_analysis has no FK). */
export function broadcastAnalysisRoomId(boardId: string): string {
  return `broadcast:${boardId}`;
}

export function broadcastAnalysisTimeline(moves: readonly XiangqiMove[]) {
  return { timeline: moves.map((move) => ({ type: 'move-played', move })) };
}

// The route factory's own ply cap; a longer record is not analysed by either path.
const MAX_ANALYSED_PLIES = 300;

/** `/api/xiangqi-broadcasts/games/<boardId>/analysis[/jobs/:jobId]`. */
export const handleXiangqiBroadcastAnalysisRoutes = createGameAnalysisRoutes({
  routeId: 'xiangqi-broadcasts',
  logPrefix: 'xiangqi_broadcast',
  variantLabel: 'Xiangqi broadcast',
  enabled: () => true,
  requiresPersistence: true,
  loadInputs: async (boardId) => {
    const board = await persistence.getXiangqiBroadcastBoard(boardId);
    // A live board's moves are still arriving; its analysis would be stale on
    // the next poll. The live engine layer covers it until the result is in.
    if (board?.status !== 'complete') return null;
    return broadcastAnalysisTimeline(board.moves);
  },
  countPlies: (payload) => payload.timeline.length,
  resolveAnalysis: (boardId, payload, computeIfMissing) =>
    resolveXiangqiAnalysis(
      broadcastAnalysisRoomId(boardId),
      payload,
      undefined,
      undefined,
      computeIfMissing,
    ),
});

export const SWEEP_TICK_MS = 5 * 60_000;
// Six games an hour is about half of one core at a few seconds a ply;
// MISTBOARD_BROADCAST_ANALYSIS_PER_HOUR tunes it without a code change.
export const SWEEP_GAMES_PER_HOUR = (() => {
  const configured = Number(process.env.MISTBOARD_BROADCAST_ANALYSIS_PER_HOUR);
  return Number.isInteger(configured) && configured > 0 ? configured : 6;
})();
const SWEEP_ACCOUNT_ID = 'system:broadcast-analysis-sweep';
// How many games the sweep analyses side by side. One (the default) goes
// through the shared analysis queue, serial with readers' requests. More runs
// the engine directly, one analysis-pool slot each, so the pool needs one slot
// beyond this for a reader's request (MISTBOARD_PIKAFISH_ANALYSIS_MAX_PROCESSES
// = this + 1). The web service has 24 vCPUs and averaged 0.2 in use over the
// week of 2026-09-18; four games at once is about four cores (2026-09-25).
export const SWEEP_CONCURRENCY = (() => {
  const configured = Number(process.env.MISTBOARD_BROADCAST_ANALYSIS_CONCURRENCY);
  return Number.isInteger(configured) && configured > 0 ? configured : 1;
})();

export type BroadcastAnalysisSweepDeps = {
  pendingJobs(): number;
  nextBoard(skip: readonly string[]): Promise<{ id: string; moves: XiangqiMove[] } | null>;
  /** Enqueue the analysis; resolves when the job finishes, rejects on failure. */
  analyse(board: { id: string; moves: XiangqiMove[] }): Promise<void> | null;
  now(): number;
};

const liveDeps: BroadcastAnalysisSweepDeps = {
  pendingJobs: () => pendingAnalysisJobCount(),
  nextBoard: (skip) =>
    persistence.nextUnanalysedXiangqiBroadcastBoard({
      engineId: XIANGQI_ANALYSIS_ENGINE_ID,
      depth: XIANGQI_ANALYSIS_REQUEST_DEPTH,
      maxPlies: MAX_ANALYSED_PLIES,
      skip,
      // The top events first (the grade map), so a page a reader is sent to
      // fills before the opens and exhibitions do.
      preferTourSlugs: Object.entries(XIANGQI_BROADCAST_TOUR_LEVELS)
        .filter(([, level]) => level === 'A')
        .map(([slug]) => slug),
    }),
  analyse: (board) => {
    // Side by side, the engine runs directly: the shared queue is serial.
    if (SWEEP_CONCURRENCY > 1) {
      return resolveXiangqiAnalysis(
        broadcastAnalysisRoomId(board.id),
        broadcastAnalysisTimeline(board.moves),
      ).then(() => undefined);
    }
    let resolveDone: () => void = () => {};
    let rejectDone: (error: unknown) => void = () => {};
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const enqueued = enqueueAnalysisJob({
      variant: 'xiangqi-broadcasts',
      roomId: board.id,
      kind: 'analysis',
      accountId: SWEEP_ACCOUNT_ID,
      run: async () => {
        try {
          const result = await resolveXiangqiAnalysis(
            broadcastAnalysisRoomId(board.id),
            broadcastAnalysisTimeline(board.moves),
          );
          resolveDone();
          return result;
        } catch (error) {
          rejectDone(error);
          throw error;
        }
      },
    });
    return enqueued.ok ? done : null;
  },
  now: () => Date.now(),
};

export type BroadcastAnalysisSweep = { tick(): Promise<number>; start(): void; stop(): void };

export function createBroadcastAnalysisSweep(
  deps: BroadcastAnalysisSweepDeps = liveDeps,
  options: { concurrency?: number; perHour?: number } = {},
): BroadcastAnalysisSweep {
  const concurrency = options.concurrency ?? SWEEP_CONCURRENCY;
  const perHour = options.perHour ?? SWEEP_GAMES_PER_HOUR;
  const startedAt: number[] = [];
  // Boards whose analysis failed in this process: skipped until a restart, so
  // one record the engine cannot score never stalls the rest.
  const failed = new Set<string>();
  // Boards being analysed now, so a second slot never takes the same one.
  const running = new Set<string>();
  let filling = false;
  let interval: NodeJS.Timeout | null = null;

  /** Fill the free slots (one, by default) and wait for those games; resolves
   *  to how many it started. */
  async function tick(): Promise<number> {
    if (filling) return 0;
    filling = true;
    const jobs: Promise<void>[] = [];
    try {
      while (running.size < concurrency) {
        const now = deps.now();
        while (startedAt.length > 0 && now - (startedAt[0] ?? 0) > 60 * 60_000) {
          startedAt.shift();
        }
        if (startedAt.length >= perHour) break;
        // A reader's request goes first: the queue is one process, first in first out.
        if (deps.pendingJobs() > 0) break;
        const board = await deps.nextBoard([...failed, ...running]);
        if (!board) break;
        const job = deps.analyse(board);
        if (!job) break;
        startedAt.push(now);
        running.add(board.id);
        jobs.push(
          job
            .catch((error: unknown) => {
              failed.add(board.id);
              console.error(
                JSON.stringify({
                  level: 'error',
                  kind: 'xiangqi_broadcast_analysis_sweep_failed',
                  boardId: board.id,
                  error: error instanceof Error ? error.message : String(error),
                }),
              );
            })
            .finally(() => running.delete(board.id)),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'xiangqi_broadcast_analysis_sweep_tick_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      filling = false;
    }
    await Promise.all(jobs);
    return jobs.length;
  }

  // Keep going while there is work, so a slot is not left idle until the next
  // five-minute tick; the tick is the fallback that notices new records.
  let draining = false;
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (interval && (await tick()) > 0) {
        // loop until nothing starts
      }
    } finally {
      draining = false;
    }
  }

  return {
    tick,
    start() {
      if (interval) return;
      interval = setInterval(() => {
        void drain();
      }, SWEEP_TICK_MS);
      interval.unref?.();
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
  };
}

/** Started at boot when persistence is on; MISTBOARD_BROADCAST_ANALYSIS_SWEEP=off
 *  turns it off without a deploy of code. */
export function startBroadcastAnalysisSweep(): BroadcastAnalysisSweep | null {
  if (process.env.MISTBOARD_BROADCAST_ANALYSIS_SWEEP === 'off') return null;
  const sweep = createBroadcastAnalysisSweep();
  sweep.start();
  return sweep;
}
