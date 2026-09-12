// Persistent Python worker pool for live engine moves.
//
// Each PoolWorker holds one long-lived Python interpreter open with the
// private mistboard-engine's scripts/live_move_worker.py (resolved via
// engine-paths.ts; see MISTBOARD_ENGINE_DIR). The expensive part of engine
// play (importing torch, loading Tier-1 weights, building the evaluator)
// happens once per worker at boot, not once per move. Subsequent requests
// pay only the per-turn protocol round-trip (EngineTurnRequest → response).
//
// Activation: env var MISTBOARD_PYTHON_POOL_SIZE = N (per engine_id), or a
// caller-provided default size. Live PvE uses this only inside the
// engine-worker HTTP service; bakeoff runners still spawn Python directly.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Move } from '@mistboard/game';
import { defaultStockfishPath, engineDir, enginePython, engineScript } from './engine-paths.js';
import { loadEngine } from './engines/registry.js';
import { engineCounters, logger } from './obs.js';

export interface PythonPoolOptions {
  engineId: string;
  size: number;
  pythonBin: string;
  scriptPath: string;
  cwd: string;
  workerSeed: number;
  stockfishPath?: string;
  /**
   * Game variant for the worker (`--game`). Absent / 'dark-chess' ⇒ omitted, so
   * the chess worker spawn is byte-identical; a non-chess variant (e.g.
   * 'dark-xiangqi') routes the worker to its variant engine.
   */
  gameSpecId?: string;
  /** Seconds to wait for a worker's `ready` line. */
  readyTimeoutMs: number;
  /**
   * Session affinity: pin a game's moves to the worker that served its prior
   * move (warm belief → delta-feed instead of an O(plies) cold-replay). Default
   * off (legacy first-ready dispatch). Best-effort: falls back to any ready
   * worker, so it never blocks correctness.
   */
  affinity?: boolean;
}

export interface PythonPoolResponse {
  decisionSource?: string;
  move: Move;
  engine: { id: string };
  roomId: string;
  // Opaque per-move telemetry the worker emits (belief size, iters, move
  // ranking). Forwarded into the EngineTurnResponse diagnostics for observability.
  diagnostics?: Record<string, unknown>;
}

interface PendingRequest {
  dispatchedAt: number | null;
  enqueuedAt: number;
  requestId: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  resolve: (response: PythonPoolResponse) => void;
  reject: (err: Error) => void;
  timeoutHandle: NodeJS.Timeout | null;
  /** Dispatch attempts so far (R1-recover: retry a transient failure once). */
  attempts: number;
}

// R1-recover: a move that fails on one worker (crash / OOM / timeout / one-off
// worker error) is re-enqueued and retried on a healthy worker, which cold-starts
// the belief from the transcript — a correct continuation, not a forfeit. Bounded
// to keep a deterministic failure from looping and to respect the move clock.
const MAX_MOVE_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.MISTBOARD_POOL_MOVE_ATTEMPTS ?? '2', 10) || 2,
);

class PoolWorker {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private current: PendingRequest | null = null;
  private buf = '';
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  /** True once the worker has been started AND was ready at least once. */
  private hasBeenReady = false;
  /** True after dispose() — suppresses restart on the resulting close event. */
  private disposed = false;
  /** Set once handleDeath() has fired so we don't restart twice for one death. */
  private deathHandled = false;

  constructor(
    public readonly index: number,
    private readonly opts: PythonPoolOptions,
    private readonly onIdle: () => void,
    private readonly onPermanentDeath: (worker: PoolWorker, err: Error) => void,
    // R1-recover: hand a failed request back to the pool to retry-or-reject,
    // instead of rejecting the caller directly.
    private readonly onRequestFailure: (req: PendingRequest, err: Error) => void,
  ) {}

  isReady(): boolean {
    return this.ready && this.current === null && this.process !== null && !this.process.killed;
  }

  async start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      this.readyResolve = resolveReady;
      this.readyReject = rejectReady;
    });

    const args = [
      this.opts.scriptPath,
      '--engine-id',
      this.opts.engineId,
      '--seed',
      String((this.opts.workerSeed + this.index) >>> 0),
    ];
    if (this.opts.stockfishPath) args.push('--stockfish', this.opts.stockfishPath);
    // Variant routing: only emit --game for a non-chess variant so the chess
    // worker spawn stays byte-identical (the worker defaults to dark-chess).
    if (this.opts.gameSpecId && this.opts.gameSpecId !== 'dark-chess') {
      args.push('--game', this.opts.gameSpecId);
    }

    const child = spawn(this.opts.pythonBin, args, {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // The v2 (EngineV2) leaf eval resolves Stockfish via FOW_STOCKFISH / PATH,
      // NOT the worker's --stockfish arg (which it ignores). apt installs the
      // binary at /usr/games/stockfish, which isn't on the container PATH, so v2
      // forfeited move 1 in prod (room 81e7b246). Export the resolved path as
      // FOW_STOCKFISH so the leaf eval finds it without a manual env or PATH.
      env: {
        ...process.env,
        ...(this.opts.stockfishPath ? { FOW_STOCKFISH: this.opts.stockfishPath } : {}),
        // R1-prevent: make the worker prove it can serve a move (Stockfish +
        // rust + search) before it signals `ready`. A worker that can't fails
        // at spawn (ready_error) instead of forfeiting its first live move.
        // Scoped to the live pool — bakeoff runners spawn Python directly and
        // don't set this, so they skip the warmup.
        FOW_WORKER_SELFTEST: '1',
      },
    });
    this.process = child;

    child.stdout.on('data', (chunk: Buffer) => this.handleChunk(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => this.handleStderr(chunk.toString('utf8')));
    child.on('error', (err) => {
      engineCounters.recordPythonPoolError();
      logger.error(
        { kind: 'python_pool_error', worker_idx: this.index, error: err.message },
        'worker error',
      );
      this.fail(err);
    });
    child.on('close', (code) => {
      this.ready = false;
      const err = new Error(`worker ${this.index} exited code=${code ?? 'null'}`);
      this.fail(err);
    });
    this.deathHandled = false;

    const readyDeadline = setTimeout(() => {
      this.fail(new Error(`worker ${this.index} ready timeout ${this.opts.readyTimeoutMs}ms`));
    }, this.opts.readyTimeoutMs);
    try {
      await this.readyPromise;
    } finally {
      clearTimeout(readyDeadline);
    }
  }

  private handleChunk(chunk: string): void {
    this.buf += chunk;
    while (true) {
      const newlineIdx = this.buf.indexOf('\n');
      if (newlineIdx < 0) break;
      const line = this.buf.slice(0, newlineIdx).trim();
      this.buf = this.buf.slice(newlineIdx + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: {
      kind?: string;
      requestId?: string;
      ok?: boolean;
      response?: PythonPoolResponse;
      error?: string;
      engineId?: string;
    };
    try {
      msg = JSON.parse(line);
    } catch {
      logger.warn(
        { kind: 'python_pool_parse_error', worker_idx: this.index, line: line.slice(0, 200) },
        'unparseable line',
      );
      return;
    }

    if (msg.kind === 'ready') {
      this.ready = true;
      this.hasBeenReady = true;
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }
    if (msg.kind === 'ready_error') {
      this.fail(new Error(`worker ${this.index} init failed: ${msg.error ?? 'unknown'}`));
      return;
    }

    if (!this.current) {
      logger.warn(
        { kind: 'python_pool_orphan_response', worker_idx: this.index, request_id: msg.requestId },
        'orphan response',
      );
      return;
    }
    if (msg.requestId !== this.current.requestId) {
      logger.warn(
        {
          kind: 'python_pool_mismatched_response',
          worker_idx: this.index,
          expected: this.current.requestId,
          got: msg.requestId,
        },
        'mismatched response',
      );
      return;
    }

    if (msg.ok && msg.response) {
      const dispatchedAt = this.current.dispatchedAt;
      logger.info(
        {
          kind: 'python_pool_request_completed',
          worker_idx: this.index,
          elapsed_ms: dispatchedAt ? Date.now() - dispatchedAt : null,
          queue_wait_ms: dispatchedAt ? dispatchedAt - this.current.enqueuedAt : null,
          timeout_ms: this.current.timeoutMs,
          decision_source: msg.response.decisionSource ?? null,
          ...payloadDiagnostics(this.current.payload),
        },
        'python pool request completed',
      );
      this.current.resolve(msg.response);
      this.completeRequest();
    } else {
      const errMsg = msg.error ?? 'worker returned !ok';
      // The pool counts this as a retry (recovered) or, if attempts are
      // exhausted, as a terminal pool error — see handleRequestFailure.
      // Full diagnostics, matching the completed/failed branches: an explicit
      // worker refusal (e.g. the engine's fail-closed BeliefUpdateOverBudget)
      // is the log line a forfeit post-mortem starts from.
      const errDispatchedAt = this.current.dispatchedAt;
      logger.error(
        {
          kind: 'python_pool_worker_error',
          worker_idx: this.index,
          engine_id: this.opts.engineId,
          request_id: msg.requestId,
          error: errMsg,
          elapsed_ms: errDispatchedAt ? Date.now() - errDispatchedAt : null,
          queue_wait_ms: errDispatchedAt ? errDispatchedAt - this.current.enqueuedAt : null,
          timeout_ms: this.current.timeoutMs,
          ...payloadDiagnostics(this.current.payload),
        },
        'worker returned !ok',
      );
      // Worker is alive (it reported the error) — free it, then let the pool
      // retry the move elsewhere (cold-start) or reject if out of attempts.
      const req = this.current;
      this.completeRequest();
      this.onRequestFailure(req, new Error(errMsg));
    }
  }

  private completeRequest(): void {
    if (this.current?.timeoutHandle) clearTimeout(this.current.timeoutHandle);
    this.current = null;
    this.onIdle();
  }

  private fail(err: Error): void {
    if (this.readyReject) {
      this.readyReject(err);
      this.readyResolve = null;
      this.readyReject = null;
    }
    if (this.current) {
      const req = this.current;
      this.current = null;
      if (req.timeoutHandle) clearTimeout(req.timeoutHandle);
      req.timeoutHandle = null;
      // Counted by handleRequestFailure: a recovered failure → retry (warning),
      // an exhausted one → terminal pool error (critical).
      logger.error(
        {
          kind: 'python_pool_request_failed',
          worker_idx: this.index,
          elapsed_ms: req.dispatchedAt ? Date.now() - req.dispatchedAt : null,
          queue_wait_ms: req.dispatchedAt ? req.dispatchedAt - req.enqueuedAt : null,
          timeout_ms: req.timeoutMs,
          error: err.message,
          ...payloadDiagnostics(req.payload),
        },
        'python pool request failed',
      );
      // This worker is being torn down + restarted; the pool retries the move on
      // a healthy worker (cold-start) or rejects if out of attempts.
      this.onRequestFailure(req, err);
    }
    this.ready = false;
    if (this.process && !this.process.killed) {
      try {
        this.process.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    // The 'close' event will fire (or already fired). Fire the permanent-
    // death callback exactly once per worker lifetime so the pool can
    // replace this slot. Suppressed during dispose() — the pool is tearing
    // down on purpose.
    if (this.disposed || this.deathHandled) return;
    if (!this.hasBeenReady) return; // initial-start failure surfaces via readyReject above
    this.deathHandled = true;
    this.onPermanentDeath(this, err);
  }

  markDisposed(): void {
    this.disposed = true;
  }

  dispatch(req: PendingRequest): void {
    this.current = req;
    req.dispatchedAt = Date.now();
    logger.info(
      {
        kind: 'python_pool_request_dispatched',
        worker_idx: this.index,
        queue_wait_ms: req.dispatchedAt - req.enqueuedAt,
        timeout_ms: req.timeoutMs,
        ...payloadDiagnostics(req.payload),
      },
      'python pool request dispatched',
    );
    req.timeoutHandle = setTimeout(() => {
      if (this.current !== req) return;
      this.fail(new Error(`pool request timeout ${req.timeoutMs}ms`));
    }, req.timeoutMs);
    const line = `${JSON.stringify({ ...req.payload, requestId: req.requestId })}\n`;
    this.process!.stdin.write(line, (err) => {
      if (err) this.fail(err);
    });
  }

  dispose(): void {
    this.markDisposed();
    if (!this.process) return;
    try {
      this.process.stdin.end();
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (this.process && !this.process.killed) this.process.kill('SIGKILL');
    }, 1_000).unref();
  }

  private handleStderr(chunk: string): void {
    for (const rawLine of chunk.split(/\r?\n/)) {
      const text = rawLine.trim();
      if (!text) continue;
      const parsed = parseWorkerDebugLine(text);
      if (parsed) {
        logger.info(
          {
            worker_idx: this.index,
            engine_id: this.opts.engineId,
            ...parsed,
          },
          'python live engine debug',
        );
        continue;
      }
      logger.warn(
        { kind: 'python_pool_stderr', worker_idx: this.index, engine_id: this.opts.engineId, text },
        'worker stderr',
      );
    }
  }
}

export class PythonPool {
  private workers: PoolWorker[] = [];
  private queue: PendingRequest[] = [];
  /** Restart attempts per slot, used for crash-loop backoff. */
  private restartCount = new Map<number, number>();
  /** Last-restart timestamp per slot. */
  private lastRestartAt = new Map<number, number>();
  private disposed = false;
  /** Soft session-affinity pins: gameId → worker slot. Bounded LRU. */
  private readonly roomWorker = new Map<string, number>();
  private readonly affinity: boolean;

  constructor(private readonly opts: PythonPoolOptions) {
    this.affinity = opts.affinity ?? false;
  }

  async start(): Promise<void> {
    const workers = Array.from({ length: this.opts.size }, (_, i) => this.makeWorker(i));
    this.workers = workers;
    const results = await Promise.allSettled(workers.map((w) => w.start()));
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length === workers.length) {
      throw new Error(
        `all ${workers.length} python pool workers failed to start: ${(failures[0] as PromiseRejectedResult).reason}`,
      );
    }
    logger.info(
      {
        kind: 'python_pool_ready',
        engine_id: this.opts.engineId,
        size: this.opts.size,
        failed: failures.length,
      },
      'python pool ready',
    );
  }

  private makeWorker(index: number): PoolWorker {
    return new PoolWorker(
      index,
      this.opts,
      () => this.tryDispatch(),
      (worker, err) => this.handleWorkerDeath(worker, err),
      (req, err) => this.handleRequestFailure(req, err),
    );
  }

  // R1-recover: retry a failed move on a healthy worker (bounded), else reject.
  // Re-enqueueing routes through tryDispatch → the next ready worker; since the
  // failed worker is dead/restarting (or busy), the retry lands elsewhere and
  // cold-starts the belief from the transcript (correct continuation). The
  // dispatch timeout + the caller's outer watchdog bound the total time.
  private handleRequestFailure(req: PendingRequest, err: Error): void {
    req.attempts += 1;
    if (!this.disposed && req.attempts < MAX_MOVE_ATTEMPTS) {
      engineCounters.recordPythonPoolRetry();
      logger.warn(
        {
          kind: 'python_pool_move_retry',
          engine_id: this.opts.engineId,
          request_id: req.requestId,
          attempt: req.attempts,
          max_attempts: MAX_MOVE_ATTEMPTS,
          error: err.message,
          ...payloadDiagnostics(req.payload),
        },
        'retrying move on a healthy worker',
      );
      req.dispatchedAt = null;
      req.timeoutHandle = null;
      this.queue.push(req);
      this.tryDispatch();
      return;
    }
    // Terminal: recovery exhausted (or pool disposed). NOW it's a hard pool
    // error (critical alert), distinct from a recovered blip (retry → warning).
    engineCounters.recordPythonPoolError({ timeout: isTimeoutish(err.message) });
    req.reject(err);
  }

  private handleWorkerDeath(dead: PoolWorker, err: Error): void {
    if (this.disposed) return;
    const slot = dead.index;
    // Drop affinity pins to this slot — its replacement starts cold, so those
    // games re-pin (and cold-replay) on their next move.
    for (const [game, idx] of this.roomWorker) {
      if (idx === slot) this.roomWorker.delete(game);
    }
    const now = Date.now();
    const lastAt = this.lastRestartAt.get(slot) ?? 0;
    const sinceLast = now - lastAt;
    // Crash-loop guard: if this slot died within 30s of its previous restart,
    // back off exponentially. After 5 quick restarts give up on the slot —
    // the pool keeps running with fewer workers and an alert-worthy log.
    const burst = sinceLast < 30_000 ? (this.restartCount.get(slot) ?? 0) + 1 : 1;
    this.restartCount.set(slot, burst);
    this.lastRestartAt.set(slot, now);

    if (burst > 5) {
      engineCounters.recordPythonPoolError();
      logger.error(
        {
          kind: 'python_pool_slot_gave_up',
          engine_id: this.opts.engineId,
          worker_idx: slot,
          error: err.message,
        },
        'python pool slot gave up after repeated crashes',
      );
      // Replace the dead slot reference with a stub-disposed worker so
      // isReady() returns false; tryDispatch will skip it.
      const stub = this.makeWorker(slot);
      stub.markDisposed();
      this.workers[slot] = stub;
      return;
    }

    const delay = burst === 1 ? 0 : Math.min(5_000, 250 * 2 ** (burst - 1));
    logger.warn(
      {
        kind: 'python_pool_worker_restart',
        engine_id: this.opts.engineId,
        worker_idx: slot,
        burst,
        delay_ms: delay,
        error: err.message,
      },
      'restarting dead pool worker',
    );

    const restart = async () => {
      if (this.disposed) return;
      const replacement = this.makeWorker(slot);
      this.workers[slot] = replacement;
      try {
        await replacement.start();
        logger.info(
          { kind: 'python_pool_worker_replaced', engine_id: this.opts.engineId, worker_idx: slot },
          'pool worker replaced',
        );
        this.tryDispatch();
      } catch (startErr) {
        engineCounters.recordPythonPoolError();
        logger.error(
          {
            kind: 'python_pool_restart_failed',
            engine_id: this.opts.engineId,
            worker_idx: slot,
            error: (startErr as Error).message,
          },
          'pool worker restart failed',
        );
        // The new worker's own fail() will fire handleWorkerDeath again,
        // honoring the burst counter.
      }
    };

    if (delay === 0) {
      void restart();
    } else {
      setTimeout(() => void restart(), delay).unref();
    }
  }

  chooseMove(payload: Record<string, unknown>, timeoutMs: number): Promise<PythonPoolResponse> {
    return new Promise<PythonPoolResponse>((resolvePromise, rejectPromise) => {
      const req: PendingRequest = {
        dispatchedAt: null,
        enqueuedAt: Date.now(),
        requestId: randomUUID(),
        payload,
        timeoutMs,
        resolve: resolvePromise,
        reject: rejectPromise,
        timeoutHandle: null,
        attempts: 0,
      };
      this.queue.push(req);
      this.tryDispatch();
    });
  }

  private tryDispatch(): void {
    if (!this.affinity) {
      while (this.queue.length > 0) {
        const worker = this.workers.find((w) => w.isReady());
        if (!worker) break;
        const req = this.queue.shift()!;
        worker.dispatch(req);
      }
      return;
    }
    // Session affinity: route a game's move to the worker that served its prior
    // move (warm belief → delta-feed) when that worker is ready; otherwise any
    // ready worker, re-pinning there (a correct cold-replay, just an O(plies)
    // rebuild). Best-effort — never blocks correctness or starves the queue.
    const remaining: PendingRequest[] = [];
    for (const req of this.queue) {
      const gameId = gameIdOf(req.payload);
      const pinned = gameId !== null ? this.roomWorker.get(gameId) : undefined;
      let idx = pinned !== undefined && this.workers[pinned]?.isReady() ? pinned : -1;
      if (idx < 0) idx = this.workers.findIndex((w) => w.isReady());
      if (idx < 0) {
        remaining.push(req);
        continue;
      }
      if (gameId !== null) this.pin(gameId, idx);
      this.workers[idx]!.dispatch(req);
    }
    this.queue = remaining;
  }

  /** Soft room→worker pin with bounded insertion-order (LRU) eviction. */
  private pin(gameId: string, workerIndex: number): void {
    this.roomWorker.delete(gameId);
    this.roomWorker.set(gameId, workerIndex);
    const cap = Math.max(64, this.opts.size * 16);
    while (this.roomWorker.size > cap) {
      const oldest = this.roomWorker.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.roomWorker.delete(oldest);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const req of this.queue) req.reject(new Error('pool disposed'));
    this.queue = [];
    for (const w of this.workers) w.dispose();
  }
}

function parseWorkerDebugLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith('{') || !line.includes('python_live_engine_debug')) return null;
  try {
    const parsed = JSON.parse(line);
    if (!isRecord(parsed) || parsed.kind !== 'python_live_engine_debug') return null;
    return parsed;
  } catch {
    return null;
  }
}

function gameIdOf(payload: Record<string, unknown>): string | null {
  const request = isRecord(payload.engineTurnRequest) ? payload.engineTurnRequest : null;
  return stringOrNull(request?.gameId);
}

function payloadDiagnostics(payload: Record<string, unknown>): Record<string, unknown> {
  const request = isRecord(payload.engineTurnRequest) ? payload.engineTurnRequest : null;
  const clock = request && isRecord(request.clock) ? request.clock : null;
  return {
    // Two distinct quantities: the compute the engine may spend vs. the wall
    // deadline the worker enforces. `worker_budget_ms` keeps its name for log
    // consumers but now reads the explicit compute field, because the legacy
    // `watchdogTimeoutMs` key carries the compute budget, not the deadline.
    worker_budget_ms: numberOrNull(payload.computeBudgetMs ?? payload.watchdogTimeoutMs),
    worker_deadline_ms: numberOrNull(payload.workerDeadlineMs),
    game_id: stringOrNull(request?.gameId),
    session_id: stringOrNull(request?.sessionId),
    engine_id: stringOrNull(request?.engineId),
    color: stringOrNull(request?.color),
    ply: numberOrNull(request?.ply),
    legal_count: Array.isArray(request?.legalMoves) ? request.legalMoves.length : null,
    clock_remaining_ms: numberOrNull(clock?.remaining_ms),
    increment_ms: numberOrNull(clock?.increment_ms),
    transcript_len: Array.isArray(request?.observationTranscript)
      ? request.observationTranscript.length
      : null,
    has_delta: request?.latestObservationDelta !== undefined,
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTimeoutish(error: string): boolean {
  return /\b(timeout|timed out|abort)\b/i.test(error);
}

// Lazy-initialized singleton per engine_id. First chooseMove blocks on pool
// boot; subsequent ones reuse warm workers.
const POOLS: Map<string, Promise<PythonPool>> = new Map();

/**
 * Returns a PythonPool for `engineId`, or null if pooling is disabled.
 * Pooling activates when MISTBOARD_PYTHON_POOL_SIZE is set to a positive
 * integer, or when the caller provides a positive defaultSize. The same
 * size is applied per engine_id (so two engines = 2N total workers).
 */
export async function getPythonPool(
  engineId: string,
  options: { defaultSize?: number } = {},
): Promise<PythonPool | null> {
  const sizeRaw = process.env.MISTBOARD_PYTHON_POOL_SIZE;
  const size = pythonPoolSize(sizeRaw, options.defaultSize);
  if (size === null) return null;

  const existing = POOLS.get(engineId);
  if (existing) return existing;

  const promise = (async () => {
    const opts: PythonPoolOptions = {
      engineId,
      size,
      pythonBin: enginePython(),
      scriptPath: process.env.PYTHON_ENGINE_LIVE_WORKER ?? engineScript('live_move_worker.py'),
      cwd: engineDir(),
      workerSeed: Date.now(),
      gameSpecId: loadEngine(engineId).gameSpecId,
      stockfishPath:
        process.env.PYTHON_ENGINE_STOCKFISH_PATH ??
        process.env.STOCKFISH_PATH ??
        defaultStockfishPath(),
      readyTimeoutMs:
        Number.parseInt(process.env.MISTBOARD_PYTHON_POOL_READY_TIMEOUT_MS ?? '30000', 10) ||
        30_000,
      affinity: process.env.MISTBOARD_POOL_AFFINITY === '1',
    };
    const pool = new PythonPool(opts);
    try {
      await pool.start();
    } catch (err) {
      POOLS.delete(engineId);
      throw err;
    }
    return pool;
  })();
  POOLS.set(engineId, promise);
  return promise;
}

function pythonPoolSize(
  sizeRaw: string | undefined,
  defaultSize: number | undefined,
): number | null {
  if (sizeRaw !== undefined) {
    const size = Number.parseInt(sizeRaw, 10);
    if (Number.isFinite(size) && size > 0) return size;
    if (defaultSize === undefined) return null;
  }
  if (defaultSize === undefined) return null;
  return Number.isFinite(defaultSize) && defaultSize > 0 ? Math.floor(defaultSize) : null;
}

export function disposeAllPythonPools(): void {
  for (const promise of POOLS.values()) {
    promise.then((p) => p.dispose()).catch(() => undefined);
  }
  POOLS.clear();
}

// defaultStockfishPath now lives in engine-paths (one definition, three callers).
