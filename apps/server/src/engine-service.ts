import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { EngineTurnRequest, EngineTurnResponse, Move, Square } from '@mistboard/game';
import { runDarkChessAnalysisJob } from './dark-chess-analysis-job.js';
import { engineCounters, logger } from './obs.js';
import { getPythonPool } from './python-pool.js';

const HEALTH_PATH = '/health';
const CAPACITY_PATH = '/internal/engine/capacity';
const RESERVATIONS_PATH = '/internal/engine/reservations';
const ENGINE_TURN_PATH = '/internal/engine/turn';
const ENGINE_OBSERVE_PATH = '/internal/engine/observe';
const ENGINE_ANALYZE_PATH = '/internal/engine/analyze';
const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_ENGINE_SERVICE_POOL_SIZE = 4;
const DEFAULT_ENGINE_SERVICE_TIMEOUT_MS = 15_000;
const MAX_ENGINE_SERVICE_TIMEOUT_MS = 60_000;
const DEFAULT_ENGINE_RESERVATION_TTL_MS = 30 * 60 * 1000;

export type EngineTurnHandler = (
  request: EngineTurnRequest,
  watchdogTimeoutMs: number,
  computeBudgetMs: number,
) => Promise<EngineTurnResponse>;

export type EngineHttpService = {
  close: () => Promise<void>;
  port: number;
};

export type EngineHttpServiceOptions = {
  handler?: EngineTurnHandler;
  host?: string;
  liveEngineSeats?: number;
  poolSize?: number;
  port: number;
  reservationTtlMs?: number;
  token?: string | null;
};

export async function startEngineHttpService(
  options: EngineHttpServiceOptions,
): Promise<EngineHttpService> {
  const poolSize = Math.max(1, Math.floor(options.poolSize ?? engineServicePoolSize()));
  const limiter = new AsyncLimiter(poolSize);
  const reservations = new EngineReservationStore({
    maxSeats: Math.max(1, Math.floor(options.liveEngineSeats ?? liveEngineSeats(poolSize))),
    ttlMs: Math.max(1, Math.floor(options.reservationTtlMs ?? engineReservationTtlMs())),
  });
  const handler =
    options.handler ??
    ((request: EngineTurnRequest, watchdogTimeoutMs: number, computeBudgetMs: number) =>
      choosePythonEngineTurn(request, watchdogTimeoutMs, computeBudgetMs, poolSize));
  const token = (options.token ?? process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN ?? '').trim() || null;
  const lifecycle = { draining: false };

  const server = createServer((req, res) => {
    void handleRequest(req, res, { handler, limiter, lifecycle, reservations, token }).catch(
      (err) => {
        const status = err instanceof HttpError ? err.status : 500;
        logger.error(
          {
            kind: 'engine_http_error',
            status,
            error: err instanceof Error ? err.message : String(err),
          },
          'engine HTTP request failed',
        );
        writeJson(res, status, { error: status === 500 ? 'internal_error' : err.message });
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    const onListen = () => {
      server.off('error', reject);
      resolve();
    };
    if (options.host) server.listen(options.port, options.host, onListen);
    else server.listen(options.port, onListen);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;
  logger.info(
    {
      kind: 'engine_http_started',
      host: options.host ?? null,
      port,
      pool_size: poolSize,
      live_engine_seats: reservations.maxSeats,
      auth_configured: Boolean(token),
    },
    'engine HTTP service started',
  );

  return {
    port,
    close: () => {
      // Stop intake, let in-flight turns finish. A request that arrives on a
      // kept-alive socket after this gets a retryable 503 and a closed socket,
      // so the web side reconnects to the replacement worker (#477).
      if (!lifecycle.draining) {
        lifecycle.draining = true;
        logger.info(
          {
            kind: 'engine_http_draining',
            port,
            active_moves: limiter.activeCount(),
            queued_moves: limiter.queueDepth(),
          },
          'engine HTTP service draining',
        );
      }
      return closeServer(server);
    },
  };
}

/**
 * The stdin payload for a python worker turn.
 *
 * The two budgets are two DIFFERENT quantities and get two fields: how long we
 * will WAIT (`workerDeadlineMs`, the transport bound) and how long the engine may
 * THINK (`computeBudgetMs`). They used to share one key, `watchdogTimeoutMs`, set
 * to the compute budget — so the worker built its wall deadline from the compute
 * budget. Its usable pick window is that value minus ~1450ms of guards, vetoed
 * below a 3000ms floor, so any compute budget under ~4450ms sent EVERY move to an
 * unsearched deadline-guard move. At 3+2 that is any clock under ~29.8s (prod game
 * 8d08b93a ended at 32.6s, i.e. 233ms from the cliff).
 *
 * The legacy key is still sent, holding its historical meaning (the compute
 * budget), so a worker that has not been redeployed behaves exactly as before.
 * engine-worker does not auto-deploy, so the two sides must ship independently in
 * either order.
 */
export function engineTurnPoolPayload(
  request: EngineTurnRequest,
  watchdogTimeoutMs: number,
  computeBudgetMs: number,
): Record<string, unknown> {
  return {
    engineTurnRequest: request,
    workerDeadlineMs: watchdogTimeoutMs,
    computeBudgetMs,
    watchdogTimeoutMs: computeBudgetMs,
  };
}

async function choosePythonEngineTurn(
  request: EngineTurnRequest,
  watchdogTimeoutMs: number,
  computeBudgetMs: number,
  poolSize: number,
): Promise<EngineTurnResponse> {
  const pool = await getPythonPool(request.engineId, { defaultSize: poolSize });
  if (!pool) throw new Error('python pool is disabled');
  const response = await pool.chooseMove(
    engineTurnPoolPayload(request, watchdogTimeoutMs, computeBudgetMs),
    watchdogTimeoutMs,
  );
  const diagnostics: Record<string, unknown> = {
    source: 'python-pool',
    computeBudgetMs,
    watchdogTimeoutMs,
    ...(response.decisionSource ? { decisionSource: response.decisionSource } : {}),
    // Per-move engine telemetry (belief size, iters, move ranking) for the
    // live-engine-decision artifact (observability).
    ...(response.diagnostics ?? {}),
  };
  return {
    protocolVersion: '1',
    gameId: request.gameId,
    sessionId: request.sessionId,
    move: response.move,
    diagnostics,
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: {
    handler: EngineTurnHandler;
    limiter: AsyncLimiter;
    lifecycle: { draining: boolean };
    reservations: EngineReservationStore;
    token: string | null;
  },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://engine-worker.internal');
  if (req.method === 'GET' && url.pathname === HEALTH_PATH) {
    if (context.lifecycle.draining) {
      writeJson(res, 503, { ok: false, service: 'engine-worker', draining: true }, { close: true });
      return;
    }
    writeJson(res, 200, { ok: true, service: 'engine-worker' });
    return;
  }
  if (context.lifecycle.draining) {
    writeJson(res, 503, { error: 'engine_draining' }, { close: true });
    return;
  }

  if (!context.token) {
    writeJson(res, 503, { error: 'engine token not configured' });
    return;
  }
  if (!isAuthorized(req, context.token)) {
    writeJson(res, 401, { error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET' && url.pathname === CAPACITY_PATH) {
    writeJson(res, 200, capacityPayload(context.reservations, context.limiter));
    return;
  }

  if (req.method === 'POST' && url.pathname === RESERVATIONS_PATH) {
    const body = await readJson(req);
    const engineId = typeof body.engineId === 'string' ? body.engineId : '';
    const color = body.color === 'white' || body.color === 'black' ? body.color : null;
    if (!engineId || !color) throw new HttpError(400, 'invalid reservation request');
    const reservation = context.reservations.reserve(engineId, color);
    if (!reservation) {
      writeJson(res, 429, {
        error: 'engine_capacity_full',
        capacity: capacityPayload(context.reservations, context.limiter),
      });
      return;
    }
    writeJson(res, 201, reservationResponse(reservation, context.reservations));
    return;
  }

  const releaseMatch = url.pathname.match(/^\/internal\/engine\/reservations\/([^/]+)\/release$/);
  if (req.method === 'POST' && releaseMatch) {
    context.reservations.release(decodeURIComponent(releaseMatch[1]!));
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === ENGINE_OBSERVE_PATH) {
    const body = await readJson(req);
    const gameId = typeof body.gameId === 'string' ? body.gameId : '';
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    // No-op ingest for now: the Python engine does not yet consume a pushed
    // observation (pondering on the opponent's clock is a mistboard-engine
    // follow-up). We ack so the arbiter's best-effort push succeeds; the same
    // own-move observation still reaches the engine in its next turn request.
    writeJson(res, 200, { protocolVersion: '1', gameId, sessionId, received: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === ENGINE_ANALYZE_PATH) {
    // Post-game fog analysis: spawn the engine repo's analyze_job.py with the
    // finished game's publication payload. Serialized to one job at a time
    // inside runDarkChessAnalysisJob so live-move compute is never starved by
    // more than one analysis process. Long-running by design — the web side
    // calls with a generous timeout and its own job queue in front.
    // Refuse while a live game holds a seat. An analysis peaks around 10 GiB for
    // ~2 minutes (measured: 53-ply human game at production parity) on the SAME
    // box that serves live bot moves, and this host runs THP `always` with
    // compaction failing most of the time — the conditions that made jieqi's
    // spawn-per-move stall for seconds. Live latency wins; analysis is offline,
    // async and cached, so it can wait. 503 is the retryable answer, and the
    // caller's job queue surfaces it rather than burning the request.
    context.reservations.pruneExpired();
    const activeSeats = context.reservations.activeCount();
    if (activeSeats > 0) {
      logger.info(
        { kind: 'engine_analysis_deferred', active_seats: activeSeats },
        'analysis refused while live engine seats are held',
      );
      writeJson(res, 503, { error: 'engine_busy', activeSeats });
      return;
    }
    const body = await readJson(req);
    const publication = body.publication;
    if (!publication || typeof publication !== 'object') {
      throw new HttpError(400, 'invalid analysis request');
    }
    const options = (body.options ?? {}) as Record<string, unknown>;
    const doc = await runDarkChessAnalysisJob(publication, {
      sfDepth: typeof options.sfDepth === 'number' ? options.sfDepth : undefined,
      iterations: typeof options.iterations === 'number' ? options.iterations : undefined,
      iSample: typeof options.iSample === 'number' ? options.iSample : undefined,
      timeBudgetSeconds:
        typeof options.timeBudgetSeconds === 'number' ? options.timeBudgetSeconds : undefined,
      seat:
        options.seat === 'white' || options.seat === 'black' || options.seat === 'both'
          ? options.seat
          : undefined,
      search: typeof options.search === 'boolean' ? options.search : undefined,
    });
    writeJson(res, 200, doc as Record<string, unknown>);
    return;
  }

  if (req.method !== 'POST' || url.pathname !== ENGINE_TURN_PATH) {
    writeJson(res, 404, { error: 'not_found' });
    return;
  }

  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }

  const request = parseEngineTurnRequest(parsed);
  const reservationId = reservationIdFromRequest(req);
  const seat = reservationId
    ? context.reservations.touch(reservationId, {
        color: request.color,
        engineId: request.engineId,
      })
    : ({ ok: false, reason: 'missing' } as const);
  if (!seat.ok) {
    // The reason lets the web side tell a forgotten seat (this worker restarted:
    // renew quietly) from a seat held under another engine or colour (a bug).
    if (seat.reason === 'mismatch') {
      logger.warn(
        {
          kind: 'engine_reservation_mismatch',
          game_id: request.gameId,
          reservation_id: reservationId,
          expected_engine_id: request.engineId,
          expected_color: request.color,
          reserved_engine_id: seat.reservation.engineId,
          reserved_color: seat.reservation.color,
        },
        'engine reservation engine/colour mismatch',
      );
    }
    writeJson(res, 409, {
      error: 'invalid_engine_reservation',
      reason: seat.reason,
      ...(seat.reason === 'mismatch'
        ? {
            reservation: {
              engineId: seat.reservation.engineId,
              color: seat.reservation.color,
            },
          }
        : {}),
    });
    return;
  }
  const watchdogTimeoutMs = parseWatchdogTimeout(req);
  const computeBudgetMs = parseComputeBudget(req, watchdogTimeoutMs);
  const queuedAt = Date.now();
  const queuedMovesBefore = context.limiter.queueDepth();
  const activeMovesBefore = context.limiter.activeCount();
  const response = await context.limiter.run(async () => {
    const startedAt = Date.now();
    const commonLog = {
      game_id: request.gameId,
      session_id: request.sessionId,
      engine_id: request.engineId,
      color: request.color,
      ply: request.ply,
      legal_count: request.legalMoves.length,
      clock_remaining_ms: request.clock.remaining_ms,
      increment_ms: request.clock.increment_ms,
      watchdog_timeout_ms: watchdogTimeoutMs,
      compute_budget_ms: computeBudgetMs,
      queue_wait_ms: startedAt - queuedAt,
      queued_moves_before: queuedMovesBefore,
      active_moves_before: activeMovesBefore,
      active_moves: context.limiter.activeCount(),
      queued_moves: context.limiter.queueDepth(),
    };
    engineCounters.recordTurnStarted();
    logger.info({ kind: 'engine_turn_started', ...commonLog }, 'engine turn started');
    try {
      const turnResponse = await context.handler(request, watchdogTimeoutMs, computeBudgetMs);
      const elapsedMs = Date.now() - startedAt;
      const decisionSource =
        typeof turnResponse.diagnostics?.decisionSource === 'string'
          ? turnResponse.diagnostics.decisionSource
          : null;
      engineCounters.recordTurnCompleted({
        decisionSource,
        elapsedMs,
        queueWaitMs: commonLog.queue_wait_ms,
      });
      logger.info(
        {
          kind: 'engine_turn_completed',
          ...commonLog,
          elapsed_ms: elapsedMs,
          decision_source: decisionSource,
        },
        'engine turn completed',
      );
      return turnResponse;
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const error = err instanceof Error ? err.message : String(err);
      engineCounters.recordTurnFailed({
        elapsedMs,
        error,
        queueWaitMs: commonLog.queue_wait_ms,
      });
      logger.error(
        {
          kind: 'engine_turn_failed',
          ...commonLog,
          elapsed_ms: elapsedMs,
          error,
        },
        'engine turn failed',
      );
      throw err;
    }
  });
  // A turn that finishes during a drain closes its socket, so the close does
  // not wait out the keep-alive timeout on a connection no one will reuse.
  writeJson(res, 200, response, { close: context.lifecycle.draining });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
  if (!isObject(parsed)) throw new HttpError(400, 'JSON body is not an object');
  return parsed;
}

function parseEngineTurnRequest(value: unknown): EngineTurnRequest {
  if (!isObject(value)) throw new HttpError(400, 'top-level request is not an object');
  if (value.protocolVersion !== '1') throw new HttpError(400, 'unsupported protocol version');
  if (typeof value.gameId !== 'string') throw new HttpError(400, 'missing gameId');
  if (typeof value.engineId !== 'string') throw new HttpError(400, 'missing engineId');
  if (typeof value.sessionId !== 'string') throw new HttpError(400, 'missing sessionId');
  if (value.color !== 'white' && value.color !== 'black') {
    throw new HttpError(400, 'invalid color');
  }
  if (typeof value.ply !== 'number' || !Number.isInteger(value.ply) || value.ply < 0) {
    throw new HttpError(400, 'invalid ply');
  }
  if (typeof value.engineSeed !== 'number' || !Number.isFinite(value.engineSeed)) {
    throw new HttpError(400, 'invalid engineSeed');
  }
  if (!isObject(value.clock)) throw new HttpError(400, 'missing clock');
  const remaining = value.clock.remaining_ms;
  if (remaining !== null && (typeof remaining !== 'number' || !Number.isFinite(remaining))) {
    throw new HttpError(400, 'invalid remaining_ms');
  }
  if (typeof value.clock.increment_ms !== 'number' || !Number.isFinite(value.clock.increment_ms)) {
    throw new HttpError(400, 'invalid increment_ms');
  }
  if (!Array.isArray(value.legalMoves) || !value.legalMoves.every(isMove)) {
    throw new HttpError(400, 'invalid legalMoves');
  }
  const hasTranscript = Array.isArray(value.observationTranscript);
  const hasDelta = value.latestObservationDelta !== undefined;
  if (hasTranscript === hasDelta) {
    throw new HttpError(400, 'request must include exactly one observation field');
  }
  return value as EngineTurnRequest;
}

function isMove(value: unknown): value is Move {
  return (
    isObject(value) &&
    isSquare(value.from) &&
    isSquare(value.to) &&
    (value.promotion === undefined ||
      value.promotion === 'queen' ||
      value.promotion === 'rook' ||
      value.promotion === 'bishop' ||
      value.promotion === 'knight')
  );
}

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-i](?:[1-9]|10)$/.test(value);
}

function parseWatchdogTimeout(req: IncomingMessage): number {
  const raw = req.headers['x-mistboard-engine-timeout-ms'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return DEFAULT_ENGINE_SERVICE_TIMEOUT_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ENGINE_SERVICE_TIMEOUT_MS;
  return Math.min(parsed, MAX_ENGINE_SERVICE_TIMEOUT_MS);
}

function parseComputeBudget(req: IncomingMessage, watchdogTimeoutMs: number): number {
  const raw = req.headers['x-mistboard-engine-compute-budget-ms'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return watchdogTimeoutMs;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return watchdogTimeoutMs;
  return Math.max(1, Math.min(parsed, watchdogTimeoutMs));
}

function engineServicePoolSize(): number {
  const raw = process.env.MISTBOARD_PYTHON_POOL_SIZE;
  if (!raw) return DEFAULT_ENGINE_SERVICE_POOL_SIZE;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ENGINE_SERVICE_POOL_SIZE;
}

function liveEngineSeats(poolSize: number): number {
  const raw = process.env.MISTBOARD_LIVE_ENGINE_SEATS;
  if (!raw) return poolSize;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : poolSize;
}

function engineReservationTtlMs(): number {
  const raw = process.env.MISTBOARD_ENGINE_RESERVATION_TTL_MS;
  if (!raw) return DEFAULT_ENGINE_RESERVATION_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ENGINE_RESERVATION_TTL_MS;
}

function reservationIdFromRequest(req: IncomingMessage): string | null {
  const raw = req.headers['x-mistboard-engine-reservation-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : null;
}

function capacityPayload(reservations: EngineReservationStore, limiter: AsyncLimiter): unknown {
  reservations.pruneExpired();
  return {
    maxLiveEngineSeats: reservations.maxSeats,
    activeEngineSeats: reservations.activeCount(),
    availableEngineSeats: Math.max(0, reservations.maxSeats - reservations.activeCount()),
    maxConcurrentMoves: limiter.max,
    activeMoves: limiter.activeCount(),
    queuedMoves: limiter.queueDepth(),
  };
}

function reservationResponse(
  reservation: EngineReservation,
  store: EngineReservationStore,
): unknown {
  return {
    reservationId: reservation.id,
    engineId: reservation.engineId,
    expiresAt: reservation.expiresAt,
    capacity: {
      activeSeats: store.activeCount(),
      maxSeats: store.maxSeats,
    },
  };
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  return secureEqual(auth.slice('Bearer '.length), token);
}

type EngineReservation = {
  color: 'white' | 'black';
  engineId: string;
  expiresAt: number;
  id: string;
  lastSeenAt: number;
};

class EngineReservationStore {
  private readonly reservations = new Map<string, EngineReservation>();
  readonly maxSeats: number;

  constructor(
    private readonly options: {
      maxSeats: number;
      ttlMs: number;
    },
  ) {
    this.maxSeats = options.maxSeats;
  }

  reserve(engineId: string, color: 'white' | 'black'): EngineReservation | null {
    this.pruneExpired();
    if (this.reservations.size >= this.maxSeats) return null;
    const now = Date.now();
    const reservation: EngineReservation = {
      color,
      engineId,
      expiresAt: now + this.options.ttlMs,
      id: randomUUID(),
      lastSeenAt: now,
    };
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  touch(
    id: string,
    expected: {
      color: 'white' | 'black';
      engineId: string;
    },
  ):
    | { ok: true }
    | { ok: false; reason: 'unknown' }
    | { ok: false; reason: 'mismatch'; reservation: EngineReservation } {
    this.pruneExpired();
    const reservation = this.reservations.get(id);
    if (!reservation) return { ok: false, reason: 'unknown' };
    if (reservation.engineId !== expected.engineId || reservation.color !== expected.color) {
      return { ok: false, reason: 'mismatch', reservation };
    }
    const now = Date.now();
    reservation.lastSeenAt = now;
    reservation.expiresAt = now + this.options.ttlMs;
    return { ok: true };
  }

  release(id: string): void {
    this.reservations.delete(id);
  }

  activeCount(): number {
    this.pruneExpired();
    return this.reservations.size;
  }

  pruneExpired(): void {
    const now = Date.now();
    for (const [id, reservation] of this.reservations) {
      if (reservation.expiresAt <= now) this.reservations.delete(id);
    }
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  options: { close?: boolean } = {},
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    ...(options.close ? { connection: 'close' } : {}),
  });
  res.end(body);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Resolves once in-flight requests have answered; idle kept-alive sockets
    // are dropped now so they cannot carry a new turn into a closing worker.
    server.close((err) => {
      if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class AsyncLimiter {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(readonly max: number) {}

  activeCount(): number {
    return this.active;
  }

  queueDepth(): number {
    return this.queue.length;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}
