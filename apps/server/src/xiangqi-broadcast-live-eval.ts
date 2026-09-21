// Server-side engine layer for LIVE xiangqi broadcast boards: one Pikafish
// MultiPV 3 search per new position, pushed to every viewer through the board
// SSE stream so the whole room reads the same number. A finished board is a
// review page with its own browser engine; this never runs for one.
//
// Isolation: its own warm session (`pikafish-broadcast-live`, one parked
// process) so a relay never queues behind a live PvE move on the PvE warm
// sessions, and never holds the 1-slot analysis pool a whole-game sweep needs.
// One search at a time per process, newest position per board wins: a
// request for ply N that is still waiting when ply N+1 arrives is dropped,
// because nobody is looking at ply N any more.
//
// Output is Red-POV in OUR squares (`h3e3`, the dialect the analysis deeplink
// and the browser Fairy-Stockfish speak), converted from Pikafish's 0-indexed
// ranks; a PV is cut at the first token that will not convert, the way the
// postgame sweep does. Cached in memory by (board, ply), LRU-bounded, nothing
// persisted.

import {
  pikafishUciToXiangqiSquares,
  type XiangqiMove,
  xiangqiMoveToPikafishUci,
} from '@mistboard/game';
import * as persistence from './persistence.js';
import {
  type UciMultiPvEval,
  type UciMultiPvLine,
  UciWarmSessionCache,
} from './uci-engine-harness.js';
import {
  pikafishXiangqiNetPath,
  pikafishXiangqiPath,
  redPovScore,
  redPovSign,
} from './xiangqi-pikafish-engine.js';

export type BroadcastLiveEvalLine = {
  /** Root move in our square notation (`h3e3`). */
  move: string;
  /** Red-POV centipawns; null when `mate` is set. */
  cp: number | null;
  /** Red-POV signed moves to mate; null otherwise. */
  mate: number | null;
  /** Principal variation, `move` first, our squares, cut at the first
   *  unconvertible token. */
  pv: string[];
};

export type BroadcastLiveEval = {
  /** The ply this position is at (= moves played). */
  ply: number;
  /** Node budget the search ran with; part of the stream version key. */
  nodes: number;
  depth: number;
  /** Rank-1 score, Red POV. */
  cp: number | null;
  mate: number | null;
  /** Ranked lines, best first; at most MultiPV entries. */
  lines: BroadcastLiveEvalLine[];
};

export const BROADCAST_LIVE_EVAL_MULTI_PV = 3;
export const BROADCAST_LIVE_EVAL_DEFAULT_NODES = 300_000;
const BROADCAST_LIVE_EVAL_PV_MAX_PLIES = 16;
const BROADCAST_LIVE_EVAL_TIMEOUT_MS = 20_000;
const BROADCAST_LIVE_EVAL_CACHE_SIZE = 256;

export function broadcastLiveEvalNodes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MISTBOARD_BROADCAST_LIVE_EVAL_NODES;
  if (!raw) return BROADCAST_LIVE_EVAL_DEFAULT_NODES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : BROADCAST_LIVE_EVAL_DEFAULT_NODES;
}

export type BroadcastLiveSearch = (movesUci: string[], nodes: number) => Promise<UciMultiPvEval>;

export type BroadcastLiveEvaluatorDeps = {
  search: BroadcastLiveSearch;
  nodes?: number;
  cacheSize?: number;
  log?: (entry: Record<string, unknown>) => void;
};

export type BroadcastLiveEvaluator = {
  /**
   * Evaluate a live board at the position after `moves`. Resolves with the
   * eval (cached or fresh), or null when a newer position for the same board
   * superseded this request before it ran. Rejects only when the search
   * itself failed.
   */
  evaluate(boardId: string, moves: readonly XiangqiMove[]): Promise<BroadcastLiveEval | null>;
  /** The cached eval for (board, ply), or null. Never triggers a search. */
  cached(boardId: string, plyCount: number): BroadcastLiveEval | null;
  /** Requests waiting or running, for diagnostics. */
  pending(): number;
};

type Waiter = {
  resolve(value: BroadcastLiveEval | null): void;
  reject(err: unknown): void;
};

type Job = {
  boardId: string;
  plyCount: number;
  moves: readonly XiangqiMove[];
  waiters: Waiter[];
};

function cacheKey(boardId: string, plyCount: number): string {
  return `${boardId}:${plyCount}`;
}

function convertLine(line: UciMultiPvLine, sign: 1 | -1): BroadcastLiveEvalLine | null {
  const root = pikafishUciToXiangqiSquares(line.move);
  if (!root) return null;
  const pv: string[] = [];
  for (const token of line.pv.slice(0, BROADCAST_LIVE_EVAL_PV_MAX_PLIES)) {
    const squares = pikafishUciToXiangqiSquares(token);
    if (!squares) break;
    pv.push(`${squares.from}${squares.to}`);
  }
  const score = redPovScore(line.cp, line.mate, sign);
  return { move: `${root.from}${root.to}`, cp: score.cp, mate: score.mate, pv };
}

/** Pure conversion of a MultiPV table to the stream shape; exported for tests. */
export function broadcastLiveEvalFromSearch(
  evaluation: UciMultiPvEval,
  plyCount: number,
  nodes: number,
): BroadcastLiveEval {
  const sign = redPovSign(plyCount);
  const lines = [...evaluation.lines]
    .sort((a, b) => a.index - b.index)
    .slice(0, BROADCAST_LIVE_EVAL_MULTI_PV)
    .map((line) => convertLine(line, sign))
    .filter((line): line is BroadcastLiveEvalLine => line !== null);
  const head = redPovScore(evaluation.cp, evaluation.mate, sign);
  return { ply: plyCount, nodes, depth: evaluation.depth, cp: head.cp, mate: head.mate, lines };
}

export function createBroadcastLiveEvaluator(
  deps: BroadcastLiveEvaluatorDeps,
): BroadcastLiveEvaluator {
  const nodes = deps.nodes ?? broadcastLiveEvalNodes();
  const cacheSize = deps.cacheSize ?? BROADCAST_LIVE_EVAL_CACHE_SIZE;
  const log = deps.log ?? ((entry) => console.error(JSON.stringify(entry)));
  // Map iteration order is insertion order, so re-inserting on read makes the
  // first key the least recently used one.
  const cache = new Map<string, BroadcastLiveEval>();
  const queue: Job[] = [];
  let running: Job | null = null;
  let lastFailure: string | null = null;

  function remember(key: string, value: BroadcastLiveEval): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  function cached(boardId: string, plyCount: number): BroadcastLiveEval | null {
    const key = cacheKey(boardId, plyCount);
    const hit = cache.get(key);
    if (!hit) return null;
    remember(key, hit);
    return hit;
  }

  async function run(job: Job): Promise<void> {
    running = job;
    try {
      const evaluation = await deps.search(job.moves.map(xiangqiMoveToPikafishUci), nodes);
      const result = broadcastLiveEvalFromSearch(evaluation, job.plyCount, nodes);
      remember(cacheKey(job.boardId, job.plyCount), result);
      lastFailure = null;
      for (const waiter of job.waiters) waiter.resolve(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A missing binary fails every request the same way; say it once, not
      // once per poll.
      if (message !== lastFailure) {
        lastFailure = message;
        log({
          level: 'error',
          kind: 'xiangqi_broadcast_live_eval_failed',
          boardId: job.boardId,
          ply: job.plyCount,
          error: message,
        });
      }
      for (const waiter of job.waiters) waiter.reject(err);
    } finally {
      running = null;
      pump();
    }
  }

  function pump(): void {
    if (running) return;
    const next = queue.shift();
    if (next) void run(next);
  }

  function evaluate(
    boardId: string,
    moves: readonly XiangqiMove[],
  ): Promise<BroadcastLiveEval | null> {
    const plyCount = moves.length;
    const hit = cached(boardId, plyCount);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      // Same position already in flight or waiting: share its answer.
      if (running && running.boardId === boardId && running.plyCount === plyCount) {
        running.waiters.push(waiter);
        return;
      }
      const queuedIndex = queue.findIndex((job) => job.boardId === boardId);
      if (queuedIndex >= 0) {
        const queued = queue[queuedIndex]!;
        if (queued.plyCount === plyCount) {
          queued.waiters.push(waiter);
          return;
        }
        // Newer ply for the board: the waiting request is for a position
        // nobody is looking at any more.
        queue.splice(queuedIndex, 1);
        for (const stale of queued.waiters) stale.resolve(null);
      }
      queue.push({ boardId, plyCount, moves, waiters: [waiter] });
      pump();
    });
  }

  return {
    evaluate,
    cached,
    pending: () => queue.length + (running ? 1 : 0),
  };
}

// ── The process-wide evaluator on a dedicated warm Pikafish session ─────────

const warmSessions = new UciWarmSessionCache({
  name: 'pikafish-broadcast-live',
  maxIdlePerKey: 1,
});

function pikafishBroadcastSearch(movesUci: string[], nodes: number): Promise<UciMultiPvEval> {
  const bin = pikafishXiangqiPath();
  const net = pikafishXiangqiNetPath(bin);
  const positionCommand =
    movesUci.length > 0 ? `position startpos moves ${movesUci.join(' ')}` : 'position startpos';
  return warmSessions.withSession(
    {
      bin,
      name: 'pikafish-broadcast-live',
      initCommands: [
        'uci',
        `setoption name EvalFile value ${net}`,
        `setoption name MultiPV value ${BROADCAST_LIVE_EVAL_MULTI_PV}`,
        'ucinewgame',
        'isready',
      ],
    },
    (session) =>
      session.multiPvPosition({
        positionCommand,
        goCommand: `go nodes ${Math.max(1, Math.floor(nodes))}`,
        timeoutMs: BROADCAST_LIVE_EVAL_TIMEOUT_MS,
        timeoutMessage: 'pikafish-broadcast-live eval timed out',
      }),
  );
}

export const broadcastLiveEvaluator: BroadcastLiveEvaluator = createBroadcastLiveEvaluator({
  search: pikafishBroadcastSearch,
});

/** Cached eval for a board at a ply, for the API payload builders. */
export function cachedBroadcastLiveEval(
  boardId: string,
  plyCount: number,
): BroadcastLiveEval | null {
  return broadcastLiveEvaluator.cached(boardId, plyCount);
}

export function evaluateBroadcastBoard(
  boardId: string,
  moves: readonly XiangqiMove[],
): Promise<BroadcastLiveEval | null> {
  return broadcastLiveEvaluator.evaluate(boardId, moves);
}

/**
 * Fire-and-forget trigger for the scheduler and the stream open: re-reads the
 * board so only a board that is STILL live gets a search (a poll update can
 * carry the move that finished the game), then evaluates its head position.
 * Failures are logged by the evaluator; nothing here throws.
 */
export async function requestBroadcastLiveEvalForBoard(boardId: string): Promise<void> {
  try {
    const board = await persistence.getXiangqiBroadcastBoard(boardId);
    if (board?.status !== 'live') return;
    await broadcastLiveEvaluator.evaluate(board.id, board.moves);
  } catch {
    // Already logged by the evaluator (search failures) or a persistence
    // hiccup the next poll retries; a live relay never owes the caller a throw.
  }
}
