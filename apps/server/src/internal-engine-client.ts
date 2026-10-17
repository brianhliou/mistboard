import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type {
  EngineObservationPush,
  EngineTurnRequest,
  EngineTurnResponse,
  Move,
  Square,
} from '@mistboard/game';
import { type KnownEngineFailure, parseKnownEngineFailure } from './engine-known-failures.js';

const ENGINE_TURN_PATH = '/internal/engine/turn';
const ENGINE_OBSERVE_PATH = '/internal/engine/observe';
const ENGINE_RESERVATIONS_PATH = '/internal/engine/reservations';
const DEFAULT_TRANSPORT_GRACE_MS = 1_000;
const DEFAULT_CONTROL_TIMEOUT_MS = 5_000;
const ERROR_BODY_TAIL_CHARS = 1_000;
// A well-formed EngineTurnResponse is a few hundred bytes; 1 MiB is a generous
// ceiling that still stops a hostile (or broken) endpoint from streaming an
// unbounded body to exhaust our memory. Applies to every engine response,
// including our own worker's — its responses are far below this.
const MAX_RESPONSE_BYTES = 1_048_576;

export type InternalEngineClientErrorReason =
  | 'missing_config'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'network_error';

export class InternalEngineClientError extends Error {
  readonly diagnostics?: Record<string, unknown>;
  readonly status?: number;
  readonly timeoutMs?: number;
  /** The worker's own classification of the failure (engine-known-failures.ts). */
  readonly knownFailure?: KnownEngineFailure;

  constructor(
    readonly reason: InternalEngineClientErrorReason,
    message: string,
    options: {
      diagnostics?: Record<string, unknown>;
      knownFailure?: KnownEngineFailure;
      status?: number;
      timeoutMs?: number;
    } = {},
  ) {
    super(message);
    this.diagnostics = options.diagnostics;
    this.knownFailure = options.knownFailure;
    this.status = options.status;
    this.timeoutMs = options.timeoutMs;
  }
}

/**
 * A single engine HTTP endpoint (base URL + bearer token). The live path
 * resolves this from the server's environment; the bot-match arbiter holds a
 * distinct endpoint per seat so it can drive two independent engines (e.g. our
 * live Misty and an external third-party bot) in one process.
 */
export type EngineEndpoint = { baseUrl: string; token: string };

/**
 * POST an `EngineTurnRequest` to an explicit engine endpoint. This is the
 * endpoint-parameterized core; `requestInternalEngineTurn` wraps it with the
 * server-environment endpoint for the live path.
 */
export async function requestEngineTurnAt(
  endpoint: EngineEndpoint,
  request: EngineTurnRequest,
  watchdogTimeoutMs: number,
  options: {
    computeBudgetMs?: number;
    reservationId?: string;
    /**
     * Whether to trust and pass through the response's free-form `diagnostics`
     * blob. Defaults to true for our own worker. Set false for UNTRUSTED
     * external endpoints so their arbitrary object never flows into our
     * telemetry / storage / UI.
     */
    trustDiagnostics?: boolean;
  } = {},
): Promise<EngineTurnResponse> {
  const { baseUrl, token } = endpoint;
  const reservationId = options.reservationId;

  const timeoutMs = Math.max(1, watchdogTimeoutMs + DEFAULT_TRANSPORT_GRACE_MS);
  const computeBudgetMs = Math.max(
    1,
    Math.min(watchdogTimeoutMs, Math.floor(options.computeBudgetMs ?? watchdogTimeoutMs)),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(engineTurnUrl(baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(reservationId ? { 'x-mistboard-engine-reservation-id': reservationId } : {}),
        'x-mistboard-engine-timeout-ms': String(watchdogTimeoutMs),
        'x-mistboard-engine-compute-budget-ms': String(computeBudgetMs),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyTail = (
        await readCappedText(response, ERROR_BODY_TAIL_CHARS * 4).catch(() => '')
      ).slice(-ERROR_BODY_TAIL_CHARS);
      const knownFailure = knownFailureFromBody(bodyTail);
      throw new InternalEngineClientError(
        'http_error',
        `internal engine service returned HTTP ${response.status}`,
        {
          status: response.status,
          diagnostics: { status: response.status, bodyTail },
          ...(knownFailure ? { knownFailure } : {}),
        },
      );
    }

    let text: string;
    try {
      text = await readCappedText(response, MAX_RESPONSE_BYTES);
    } catch (err) {
      if (err instanceof InternalEngineClientError) throw err;
      throw new InternalEngineClientError(
        'network_error',
        `failed reading engine response: ${(err as Error).message}`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      throw new InternalEngineClientError(
        'invalid_response',
        `internal engine service returned invalid JSON: ${(err as Error).message}`,
      );
    }
    return parseEngineTurnResponse(payload, request, {
      includeDiagnostics: options.trustDiagnostics !== false,
    });
  } catch (err) {
    if (err instanceof InternalEngineClientError) throw err;
    if (isAbortError(err)) {
      throw new InternalEngineClientError(
        'timeout',
        `internal engine service timed out after ${timeoutMs}ms`,
        { timeoutMs },
      );
    }
    throw new InternalEngineClientError(
      'network_error',
      `internal engine service request failed: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Live path: POST an engine turn to the server-environment engine service
 * (`MISTBOARD_INTERNAL_ENGINE_URL` / `MISTBOARD_INTERNAL_ENGINE_TOKEN`).
 * Thin wrapper over {@link requestEngineTurnAt}.
 */
export async function requestInternalEngineTurn(
  request: EngineTurnRequest,
  watchdogTimeoutMs: number,
  reservationId?: string,
  options: { computeBudgetMs?: number } = {},
): Promise<EngineTurnResponse> {
  const baseUrl = process.env.MISTBOARD_INTERNAL_ENGINE_URL?.trim();
  const token = process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new InternalEngineClientError(
      'missing_config',
      'internal engine service URL/token is not configured',
    );
  }
  return requestEngineTurnAt({ baseUrl, token }, request, watchdogTimeoutMs, {
    computeBudgetMs: options.computeBudgetMs,
    reservationId,
  });
}

/**
 * Push a post-move observation to an engine endpoint (the "observe right after
 * you move" step). Fire-and-forget from the caller's view: it POSTs the push
 * and returns once acked. Best-effort — callers (the arbiter) treat a failure as
 * non-fatal, since the same observation also reaches the engine in its next turn
 * request. No reservation required (this requests no compute).
 */
export async function pushEngineObservationAt(
  endpoint: EngineEndpoint,
  push: EngineObservationPush,
): Promise<void> {
  await engineControlJsonAt(endpoint, ENGINE_OBSERVE_PATH, {
    method: 'POST',
    body: JSON.stringify(push),
  });
}

export type InternalEngineReservationResponse = {
  reservationId: string;
  engineId: string;
  expiresAt: number;
  capacity: {
    activeSeats: number;
    maxSeats: number;
  };
};

/** Reserve an engine seat at an explicit endpoint (endpoint-parameterized core). */
export async function requestEngineReservationAt(
  endpoint: EngineEndpoint,
  input: { color: 'white' | 'black'; engineId: string },
): Promise<InternalEngineReservationResponse> {
  const response = await engineControlJsonAt(endpoint, ENGINE_RESERVATIONS_PATH, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return parseReservationResponse(response);
}

/** Release an engine seat at an explicit endpoint. */
export async function releaseEngineReservationAt(
  endpoint: EngineEndpoint,
  reservationId: string,
  reason: string,
): Promise<void> {
  await engineControlJsonAt(
    endpoint,
    `${ENGINE_RESERVATIONS_PATH}/${encodeURIComponent(reservationId)}/release`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

export async function requestInternalEngineReservation(input: {
  color: 'white' | 'black';
  engineId: string;
}): Promise<InternalEngineReservationResponse> {
  return requestEngineReservationAt(engineEndpointFromEnv(), input);
}

export async function releaseInternalEngineReservation(
  reservationId: string,
  reason: string,
): Promise<void> {
  await releaseEngineReservationAt(engineEndpointFromEnv(), reservationId, reason);
}

function engineEndpointFromEnv(): EngineEndpoint {
  const baseUrl = process.env.MISTBOARD_INTERNAL_ENGINE_URL?.trim();
  const token = process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new InternalEngineClientError(
      'missing_config',
      'internal engine service URL/token is not configured',
    );
  }
  return { baseUrl, token };
}

async function engineControlJsonAt(
  endpoint: EngineEndpoint,
  path: string,
  init: {
    body?: string;
    method: 'GET' | 'POST';
  },
): Promise<unknown> {
  const { baseUrl, token } = endpoint;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_CONTROL_TIMEOUT_MS);
  try {
    const response = await fetch(internalEngineUrl(baseUrl, path), {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new InternalEngineClientError(
        'http_error',
        `internal engine service returned HTTP ${response.status}`,
        {
          status: response.status,
          diagnostics: {
            status: response.status,
            bodyTail: (await response.text()).slice(-ERROR_BODY_TAIL_CHARS),
          },
        },
      );
    }
    try {
      return await response.json();
    } catch (err) {
      throw new InternalEngineClientError(
        'invalid_response',
        `internal engine service returned invalid JSON: ${(err as Error).message}`,
      );
    }
  } catch (err) {
    if (err instanceof InternalEngineClientError) throw err;
    if (isAbortError(err)) {
      throw new InternalEngineClientError(
        'timeout',
        `internal engine service control request timed out after ${DEFAULT_CONTROL_TIMEOUT_MS}ms`,
        { timeoutMs: DEFAULT_CONTROL_TIMEOUT_MS },
      );
    }
    throw new InternalEngineClientError(
      'network_error',
      `internal engine service control request failed: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function engineTurnUrl(baseUrl: string): string {
  return internalEngineUrl(baseUrl, ENGINE_TURN_PATH);
}

function internalEngineUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;
  return new URL(path.slice(1), base).toString();
}

function parseEngineTurnResponse(
  value: unknown,
  request: EngineTurnRequest,
  options: { includeDiagnostics?: boolean } = {},
): EngineTurnResponse {
  if (!isObject(value)) throw invalidResponse('top-level response is not an object');
  if (value.protocolVersion !== '1') throw invalidResponse('unsupported protocol version');
  if (value.gameId !== request.gameId) throw invalidResponse('response gameId mismatch');
  if (value.sessionId !== request.sessionId) throw invalidResponse('response sessionId mismatch');

  const move = parseMove(value.move);
  // Untrusted endpoints (external bots) never get their arbitrary diagnostics
  // blob into our system — only the validated move survives.
  const diagnostics =
    options.includeDiagnostics !== false && isObject(value.diagnostics)
      ? value.diagnostics
      : undefined;
  return {
    protocolVersion: '1',
    gameId: request.gameId,
    sessionId: request.sessionId,
    move,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function parseReservationResponse(value: unknown): InternalEngineReservationResponse {
  if (!isObject(value)) throw invalidResponse('reservation response is not an object');
  if (typeof value.reservationId !== 'string') {
    throw invalidResponse('missing reservationId');
  }
  if (typeof value.engineId !== 'string') throw invalidResponse('missing engineId');
  if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) {
    throw invalidResponse('missing expiresAt');
  }
  if (!isObject(value.capacity)) throw invalidResponse('missing capacity');
  if (
    typeof value.capacity.activeSeats !== 'number' ||
    !Number.isFinite(value.capacity.activeSeats)
  ) {
    throw invalidResponse('missing activeSeats');
  }
  if (typeof value.capacity.maxSeats !== 'number' || !Number.isFinite(value.capacity.maxSeats)) {
    throw invalidResponse('missing maxSeats');
  }
  return {
    reservationId: value.reservationId,
    engineId: value.engineId,
    expiresAt: value.expiresAt,
    capacity: {
      activeSeats: value.capacity.activeSeats,
      maxSeats: value.capacity.maxSeats,
    },
  };
}

function parseMove(value: unknown): Move {
  if (!isObject(value)) throw invalidResponse('missing move');
  if (!isSquare(value.from) || !isSquare(value.to)) {
    throw invalidResponse('invalid move squares');
  }
  const promotion = parsePromotion(value.promotion);
  return {
    from: value.from,
    to: value.to,
    ...(promotion ? { promotion } : {}),
  };
}

function invalidResponse(message: string): InternalEngineClientError {
  return new InternalEngineClientError('invalid_response', message);
}

function parsePromotion(value: unknown): Move['promotion'] | null {
  if (value === undefined) return null;
  if (value === 'queen' || value === 'rook' || value === 'bishop' || value === 'knight') {
    return value;
  }
  throw invalidResponse('invalid promotion');
}

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-i](?:[1-9]|10)$/.test(value);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The worker's `known_failure` tag on an error body (engine-known-failures.ts). */
function knownFailureFromBody(body: string): KnownEngineFailure | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isObject(parsed) ? parseKnownEngineFailure(parsed.known_failure) : null;
  } catch {
    return null;
  }
}

/**
 * Read a response body as text, aborting if it exceeds `maxBytes`. Defends
 * against a hostile/broken endpoint streaming an unbounded body: we check the
 * declared Content-Length first, then enforce the cap while streaming (a lying
 * or absent header can't get past the streamed count).
 */
async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new InternalEngineClientError(
      'invalid_response',
      `engine response too large: content-length ${declared} exceeds ${maxBytes} bytes`,
    );
  }
  const body = response.body;
  if (!body) return response.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new InternalEngineClientError(
          'invalid_response',
          `engine response exceeded ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ── Post-game analysis (fog chess) ──────────────────────────────────────────

const ENGINE_ANALYZE_PATH = '/internal/engine/analyze';
// A whole-game analysis runs one solve per ply plus Stockfish grading —
// minutes, not milliseconds.
const DEFAULT_ANALYSIS_TIMEOUT_MS = 15 * 60 * 1_000;
// Analysis documents carry per-ply rows for both seats; far larger than a
// turn response, still bounded.
const MAX_ANALYSIS_RESPONSE_BYTES = 64 * 1_048_576;

export type EngineAnalysisRequestPayload = {
  publication: unknown;
  options?: {
    sfDepth?: number;
    iterations?: number;
    iSample?: number;
    timeBudgetSeconds?: number;
    seat?: 'white' | 'black' | 'both';
    /** Per-ply belief solve; false = grading only (the fast local profile). */
    search?: boolean;
  };
};

/**
 * POST a finished game's publication payload to an engine endpoint's analyze
 * path and return the raw analysis document (validated by the caller —
 * dark-chess-analysis owns the schema).
 */
export async function requestEngineAnalysisAt(
  endpoint: EngineEndpoint,
  payload: EngineAnalysisRequestPayload,
  timeoutMs: number = DEFAULT_ANALYSIS_TIMEOUT_MS,
): Promise<unknown> {
  const { baseUrl, token } = endpoint;
  const url = new URL(internalEngineUrl(baseUrl, ENGINE_ANALYZE_PATH));
  const body = JSON.stringify(payload);
  // node:http, NOT fetch. Node's fetch caps response headers at 300s no matter
  // what the AbortController says, so an analysis running longer than five
  // minutes died as an opaque "fetch failed" while the engine happily kept
  // computing. A whole-game fog analysis is minutes by design (measured: 116s for
  // 53 plies at production parity), so that ceiling is inside the working range.
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const fail = (err: InternalEngineClientError): void => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };

    const req = send(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_ANALYSIS_RESPONSE_BYTES) {
            fail(
              new InternalEngineClientError(
                'invalid_response',
                `engine analysis response exceeded ${MAX_ANALYSIS_RESPONSE_BYTES} bytes`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const text = Buffer.concat(chunks).toString('utf8');
          if (status < 200 || status >= 300) {
            reject(
              new InternalEngineClientError(
                'http_error',
                `internal engine analysis returned HTTP ${status}`,
                {
                  status,
                  diagnostics: { status, bodyTail: text.slice(-ERROR_BODY_TAIL_CHARS) },
                },
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(text) as unknown);
          } catch (err) {
            reject(
              new InternalEngineClientError(
                'invalid_response',
                `internal engine analysis returned invalid JSON: ${(err as Error).message}`,
              ),
            );
          }
        });
        res.on('error', (err) =>
          fail(
            new InternalEngineClientError(
              'network_error',
              `internal engine analysis response failed: ${err.message}`,
            ),
          ),
        );
      },
    );

    // The only ceiling now, and it is the one the caller asked for.
    req.setTimeout(timeoutMs, () => {
      fail(
        new InternalEngineClientError(
          'timeout',
          `internal engine analysis timed out after ${timeoutMs}ms`,
          { timeoutMs },
        ),
      );
    });
    req.on('error', (err) =>
      fail(
        new InternalEngineClientError(
          'network_error',
          `internal engine analysis request failed: ${err.message}`,
        ),
      ),
    );
    req.end(body);
  });
}

/**
 * Live path: analysis via the server-environment engine service
 * (`MISTBOARD_INTERNAL_ENGINE_URL` / `MISTBOARD_INTERNAL_ENGINE_TOKEN`).
 */
export async function requestInternalEngineAnalysis(
  payload: EngineAnalysisRequestPayload,
  timeoutMs?: number,
): Promise<unknown> {
  return requestEngineAnalysisAt(engineEndpointFromEnv(), payload, timeoutMs);
}

/** True when the internal engine service is configured in this environment —
 *  the fog analysis route's engine-availability gate. */
export function internalEngineAnalysisConfigured(): boolean {
  return Boolean(
    process.env.MISTBOARD_INTERNAL_ENGINE_URL?.trim() &&
      process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN?.trim(),
  );
}
