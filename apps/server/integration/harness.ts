// Two-client WebSocket harness for integration tests.
//
// Each test boots a fresh server on an ephemeral port, opens any number of
// simulated clients via ws.WebSocket, and asserts on the message stream.
//
// Persistence is disabled (no DATABASE_URL); the goal is to lock the in-memory
// game-flow / rematch / reconnect contract. Persistence-on coverage is a
// later, separate variant.

import type { VariantId } from '@mistboard/game';
import { WebSocket } from 'ws';
import { type StartedServer, startServer, stopServer } from '../src/index.js';
import type { Room } from '../src/server-types.js';
import type { DarkXiangqiLiveRoom } from '../src/server-ws-dark-xiangqi.js';

const DEFAULT_WAIT_TIMEOUT_MS = 2_000;

export interface TestServer {
  url: string;
  port: number;
  rooms: Map<string, Room>;
  darkXiangqiRooms: Map<string, DarkXiangqiLiveRoom>;
  close(): Promise<void>;
}

export interface TestClient {
  readonly room: string;
  /** Messages observed so far, in order. */
  readonly messages: unknown[];
  /** Seat assignment captured from the most recent `hello`. */
  seat: 'white' | 'black' | 'red' | 'spectator' | null;
  /** Server-issued seat token captured from `hello` if any. */
  seatToken: string | null;
  /** Server-assigned client UUID. */
  clientId: string | null;
  send(payload: object): void;
  /**
   * Wait for the next message that matches `predicate`. Searches the buffer
   * first; otherwise waits for an incoming message. Resolves with the matched
   * message. Rejects on timeout (default 2s).
   */
  waitFor<T = MessageOf>(
    predicate: (msg: MessageOf) => boolean,
    opts?: { timeoutMs?: number },
  ): Promise<T>;
  /** Convenience: wait for a message with `type === expected`. */
  expectMessage<T = MessageOf>(type: string, opts?: { timeoutMs?: number }): Promise<T>;
  /** Close the socket cleanly. */
  disconnect(opts?: { code?: number; reason?: string }): Promise<void>;
  /** Has the socket closed? */
  isClosed(): boolean;
  /** WebSocket close code observed by the harness, once closed. */
  closeCode(): number | null;
  /** WebSocket close reason observed by the harness, once closed. */
  closeReason(): string;
  /** Wait for the close event to fire. */
  closed: Promise<void>;
}

type MessageOf = { type: string; [key: string]: unknown };

export async function startTestServer(
  opts: { seatVacateGraceMs?: number } = {},
): Promise<TestServer> {
  // Make sure no leaked server from a prior test is still bound.
  await stopServer().catch(() => undefined);
  const started: StartedServer = await startServer({
    port: 0,
    seatVacateGraceMs: opts.seatVacateGraceMs,
  });
  const url = `ws://127.0.0.1:${started.port}`;
  return {
    url,
    port: started.port,
    rooms: started.rooms,
    darkXiangqiRooms: started.darkXiangqiRooms,
    close: async () => {
      await started.close();
    },
  };
}

export interface ConnectOptions {
  url: string;
  room: string;
  variant?: VariantId;
  gameSpecId?: 'dark-xiangqi' | 'jungle';
  clientId?: string;
  seatToken?: string;
  /**
   * Account-session cookie to send on the WS upgrade. Makes the connection
   * authenticated, so the server resolves a userId and the claimed seat binds
   * to that account (subjectType 'user') — required to exercise rated play.
   */
  cookie?: string;
  /** Wait for the initial `hello` message before resolving. Default: true. */
  awaitHello?: boolean;
  /** Timeout for the hello message. */
  helloTimeoutMs?: number;
}

export async function connectClient(opts: ConnectOptions): Promise<TestClient> {
  const variant = opts.variant ?? 'dark-chess';
  const spec = opts.gameSpecId ? `&gameSpecId=${encodeURIComponent(opts.gameSpecId)}` : '';
  const clientParam = opts.clientId ? `&client=${encodeURIComponent(opts.clientId)}` : '';
  const target = `${opts.url}/?room=${encodeURIComponent(opts.room)}&variant=${variant}${spec}${clientParam}`;

  const protocols = opts.seatToken ? [`mistboard-seat.${opts.seatToken}`] : undefined;
  // Production WS handshake requires an Origin header matching the host
  // (server-policy.ts: isAllowedWebSocketOrigin). Local dev/integration is
  // permissive, so deriving Origin from the URL is safe everywhere and lets
  // the harness target deployed services like wss://mistboard.com.
  const parsedUrl = new URL(opts.url);
  const originScheme = parsedUrl.protocol === 'wss:' ? 'https:' : 'http:';
  const origin = `${originScheme}//${parsedUrl.host}`;
  const socket = new WebSocket(target, protocols, {
    origin,
    headers: opts.cookie ? { Cookie: opts.cookie } : undefined,
  });

  const messages: unknown[] = [];
  const waiters: Array<{
    predicate: (msg: MessageOf) => boolean;
    resolve: (msg: MessageOf) => void;
  }> = [];
  let closedResolve!: () => void;
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve;
  });
  let isClosed = false;
  let closeCode: number | null = null;
  let closeReason = '';

  socket.on('message', (raw) => {
    let parsed: MessageOf;
    try {
      parsed = JSON.parse(raw.toString()) as MessageOf;
    } catch {
      return;
    }
    messages.push(parsed);
    // Fan out to any pending waiters whose predicate now matches.
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i]!;
      if (waiter.predicate(parsed)) {
        waiters.splice(i, 1);
        waiter.resolve(parsed);
      }
    }
  });
  socket.on('close', (code, reason) => {
    isClosed = true;
    closeCode = code;
    closeReason = reason.toString();
    closedResolve();
  });
  socket.on('error', () => {
    // Tests assert on close events; swallow stray errors so they don't crash
    // the runner.
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      socket.off('open', onOpen);
      reject(err);
    };
    const onOpen = () => {
      socket.off('error', onError);
      resolve();
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
  });

  const client: TestClient = {
    room: opts.room,
    messages,
    seat: null,
    seatToken: null,
    clientId: null,
    send(payload: object) {
      socket.send(JSON.stringify(payload));
    },
    async waitFor<T = MessageOf>(
      predicate: (msg: MessageOf) => boolean,
      waitOpts: { timeoutMs?: number } = {},
    ): Promise<T> {
      const existing = messages.find((m) => predicate(m as MessageOf));
      if (existing) return existing as T;
      const timeoutMs = waitOpts.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      return new Promise<T>((resolve, reject) => {
        const entry = {
          predicate,
          resolve: (msg: MessageOf) => {
            clearTimeout(timer);
            resolve(msg as T);
          },
        };
        waiters.push(entry);
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) waiters.splice(idx, 1);
          const buffered = messages.map((m) => (m as MessageOf).type).join(',');
          reject(
            new Error(`waitFor timed out after ${timeoutMs}ms. Buffered types: [${buffered}]`),
          );
        }, timeoutMs);
      });
    },
    expectMessage(type, expectOpts) {
      return this.waitFor((msg) => msg.type === type, expectOpts);
    },
    async disconnect(closeOpts = {}) {
      if (isClosed) return;
      socket.close(closeOpts.code ?? 1000, closeOpts.reason ?? 'test-disconnect');
      await closed;
    },
    isClosed: () => isClosed,
    closeCode: () => closeCode,
    closeReason: () => closeReason,
    closed,
  };

  if (opts.awaitHello !== false) {
    const hello = await client.expectMessage('hello', {
      timeoutMs: opts.helloTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
    });
    const h = hello as unknown as {
      seat: 'white' | 'black' | 'red' | 'spectator';
      seatToken?: string;
      clientId: string;
    };
    client.seat = h.seat;
    client.seatToken = h.seatToken ?? opts.seatToken ?? null;
    client.clientId = h.clientId;
  }

  return client;
}

/** Convenience: pause for `ms`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polling helper for non-message-based conditions (e.g. server-side state on
 * the rooms map). Polls every `intervalMs` until the predicate returns true,
 * or rejects after `timeoutMs`.
 */
export async function waitUntil(
  predicate: () => boolean,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(intervalMs);
  }
  if (predicate()) return;
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

/** Generate a unique room id per test. */
export function uniqueRoomId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run `fn` with a production-like runtime, restoring the prior env afterward.
 * The tenant WS runtime admits a tokenless visitor to a full/private room as a
 * READ-ONLY spectator in non-production (dev /game-sheet spectates seeded
 * rooms); production stays fail-closed and closes 1008. Any integration
 * assertion that a private/full room REJECTS an uncredentialed or extra
 * connection must run inside this window, or the connection is admitted and
 * `await client.closed` hangs forever. Mirrors withProductionRuntime in the
 * server-ws-*.test unit suites.
 *
 * Production also enforces the WS Origin allowlist (server-policy.ts). Since
 * connectClient derives its Origin from the server url as `<scheme>//<host>`
 * (http for ws), the allowlist is pinned to that exact origin here — otherwise
 * the default `https://<host>` fallback rejects the http origin as
 * 'origin not allowed' before the room-membership decision is reached.
 */
export async function withProductionRuntime(
  serverUrl: string,
  fn: () => Promise<void>,
): Promise<void> {
  const beforeEnv = process.env.NODE_ENV;
  const beforeOrigins = process.env.MISTBOARD_ALLOWED_ORIGINS;
  const url = new URL(serverUrl);
  const scheme = url.protocol === 'wss:' ? 'https:' : 'http:';
  process.env.NODE_ENV = 'production';
  process.env.MISTBOARD_ALLOWED_ORIGINS = `${scheme}//${url.host}`;
  try {
    await fn();
  } finally {
    if (beforeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = beforeEnv;
    if (beforeOrigins === undefined) delete process.env.MISTBOARD_ALLOWED_ORIGINS;
    else process.env.MISTBOARD_ALLOWED_ORIGINS = beforeOrigins;
  }
}
