// Local-only concurrent gameplay driver. Receipt timestamps come from the WS
// handler, so buffered-message searches and opponent think time cannot inflate
// the separate authoritative acknowledgment metric.
import type { Color, Move } from '@mistboard/game';
import type { ConnectOptions } from '../integration/harness.js';
import { makeRng, pickRandomMove, type Scenario } from './scenarios.js';

export interface MoveAttempt {
  color: Color;
  move: Move;
  /** Monotonic offsets from the run's origin (not wall-clock timestamps). */
  submittedMs: number;
  receivedMs?: number;
  seq?: number;
  latencyMs?: number;
  phase: 'warmup' | 'measurement';
  outcome: 'acknowledged' | 'rejected' | 'timeout' | 'window-ended' | 'disconnected';
}

export interface GameResult {
  scenario: string;
  gameIdx: number;
  seed: number;
  /** Legacy white send -> next own-turn receipt; includes the opponent's reply. */
  moveLatencies: number[];
  /** Both seats, including warmup and unsuccessful submissions. */
  moveAttempts: MoveAttempt[];
  durationMs: number;
  finishedNaturally: boolean;
  result?: { winner: Color | null; reason: string };
  note?: string;
  /** Sanitized failure categories; never HTTP bodies, socket URLs or tokens. */
  failures: string[];
  error?: string;
}

export interface Activity {
  atMs: number;
  activeGames: number;
}

export interface RunnerOptions {
  serverUrl: string;
  scenario: Scenario;
  concurrency: number;
  /** Measurement duration; warmup is additional. Omit for one game per worker. */
  durationMs?: number;
  warmupMs?: number;
  /**
   * Mean pause before each submission, drawn uniformly from 0.5x to 1.5x so
   * games do not move in lockstep. It precedes the submit timestamp, so it is
   * never part of a latency sample. Omit for a closed loop with no pause.
   */
  thinkMs?: number;
  seed?: number;
  onGameComplete?: (result: GameResult) => void;
  onActivity?: (point: Activity) => void;
}

/** Injectable transport and monotonic clock for deterministic offline tests. */
export interface RunnerIO {
  connect: (opts: ConnectOptions) => Promise<LoadClient>;
  fetch: typeof fetch;
  now: () => number;
  /** Think-time pause; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface LoadClient {
  seat: Color | 'red' | 'spectator' | null;
  messages: unknown[];
  receivedAt(message: object): number | undefined;
  send(payload: object): void;
  waitFor<T = StateMessage>(
    predicate: (message: StateMessage) => boolean,
    opts: { timeoutMs: number },
  ): Promise<T>;
  disconnect(): Promise<void>;
  isClosed(): boolean;
}

export type StateMessage = {
  type: string;
  seq?: number;
  event?: { type: string; color?: Color; move?: Move };
  /** Full snapshots carry the recipient-filtered event list, indexed by seq. */
  events?: Array<{ type: string; color?: Color; move?: Move } | null>;
  state?: {
    status?: { type: string; turn?: Color; winner?: Color | null; reason?: string };
    moveNumber?: number;
    legalMoves?: Move[];
  };
};

/** Numeric loopback literals only: no DNS, credentials, redirect or proxy targets. */
export function validateTarget(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('target must be a loopback WebSocket URL');
  }
  const ipv4 = url.hostname.split('.').map(Number);
  const loopback =
    url.hostname === '[::1]' ||
    (ipv4.length === 4 &&
      ipv4[0] === 127 &&
      ipv4.every((n) => Number.isInteger(n) && n >= 0 && n <= 255));
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    !loopback ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('target must be a bare numeric loopback WebSocket URL');
  }
  return url.origin;
}

export function matchesAcknowledgment(
  message: StateMessage,
  move: Move,
  color: Color,
  afterSeq: number,
): boolean {
  const event = message.event;
  return (
    message.type === 'event-appended' &&
    Number.isSafeInteger(message.seq) &&
    message.seq! > afterSeq &&
    event?.type === 'move-played' &&
    event.color === color &&
    event.move?.from === move.from &&
    event.move.to === move.to &&
    event.move.promotion === move.promotion
  );
}

/**
 * A move that ends the game is not sent as a delta: the server resyncs every
 * seat with a full snapshot. That snapshot acknowledges the move only when its
 * event list holds the submitted move at a sequence newer than `afterSeq`.
 * Returns that sequence, or -1.
 */
export function finalSnapshotAckSeq(
  message: StateMessage,
  move: Move,
  color: Color,
  afterSeq: number,
): number {
  const status = message.state?.status?.type;
  if (message.type !== 'snapshot' || (status !== 'finished' && status !== 'aborted')) return -1;
  const events = message.events ?? [];
  for (let seq = events.length - 1; seq > afterSeq; seq--) {
    const event = events[seq];
    if (
      event?.type === 'move-played' &&
      event.color === color &&
      event.move?.from === move.from &&
      event.move.to === move.to &&
      event.move.promotion === move.promotion
    )
      return seq;
  }
  return -1;
}

export async function runScenario(opts: RunnerOptions, injected?: RunnerIO): Promise<GameResult[]> {
  const serverUrl = validateTarget(opts.serverUrl);
  if (!Number.isSafeInteger(opts.concurrency) || opts.concurrency < 1)
    throw new Error('invalid concurrency');
  if (opts.durationMs !== undefined && (!Number.isFinite(opts.durationMs) || opts.durationMs <= 0))
    throw new Error('invalid duration');
  if (!Number.isFinite(opts.warmupMs ?? 0) || (opts.warmupMs ?? 0) < 0)
    throw new Error('invalid warmup');
  if (!Number.isFinite(opts.thinkMs ?? 0) || (opts.thinkMs ?? 0) < 0)
    throw new Error('invalid think time');
  const io: RunnerIO = injected ?? {
    connect: async (options) => (await import('../integration/harness.js')).connectClient(options),
    fetch: globalThis.fetch,
    now: () => performance.now(),
  };
  const origin = io.now();
  const warmupMs = opts.warmupMs ?? 0;
  const deadline = opts.durationMs === undefined ? Infinity : origin + warmupMs + opts.durationMs;
  const results: GameResult[] = [];
  let nextGame = 0;
  let activeGames = 0;
  const activity = (change: number) => {
    activeGames += change;
    opts.onActivity?.({ atMs: io.now() - origin, activeGames });
  };
  activity(0);
  const worker = async (workerIdx: number) => {
    do {
      if (io.now() >= deadline) break;
      const gameIdx = nextGame++;
      const seed = ((opts.seed ?? 42) ^ ((workerIdx + 1) * 0x9e3779b1) ^ (gameIdx * 0xcafe)) >>> 0;
      const start = io.now();
      const result: GameResult = {
        scenario: opts.scenario.name,
        gameIdx,
        seed,
        moveLatencies: [],
        moveAttempts: [],
        durationMs: 0,
        finishedNaturally: false,
        failures: [],
      };
      const clients: LoadClient[] = [];
      let active = false;
      try {
        const roomId = await createRoom(serverUrl, opts.scenario, io);
        clients.push(
          await io.connect({
            url: serverUrl,
            room: roomId,
            variant: opts.scenario.variant,
            helloTimeoutMs: opts.scenario.moveTimeoutMs,
          }),
        );
        if (opts.scenario.mode === 'pvp') {
          clients.push(
            await io.connect({
              url: serverUrl,
              room: roomId,
              variant: opts.scenario.variant,
              helloTimeoutMs: opts.scenario.moveTimeoutMs,
            }),
          );
          if (!clients.some((c) => c.seat === 'white') || !clients.some((c) => c.seat === 'black'))
            throw new Error('pairing-failed');
        }
        // Count only rooms with all required seats and authoritative playing state.
        await clients[0]!.waitFor((m) => (m as StateMessage).state?.status?.type === 'playing', {
          timeoutMs: Math.max(1, Math.min(opts.scenario.moveTimeoutMs, deadline - io.now())),
        });
        active = true;
        activity(1);
        await Promise.all(
          clients.map((client) =>
            playLoop(
              client,
              opts.scenario,
              result,
              seed ^ (client.seat === 'white' ? 1 : 2),
              start,
              origin,
              warmupMs,
              opts.thinkMs ?? 0,
              Math.min(deadline, start + opts.scenario.maxGameMs),
              io,
            ),
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        result.error = /^(room-create-\d+|room-create-invalid|pairing-failed)$/.test(message)
          ? message
          : 'transport-or-setup-failed';
        result.failures.push(result.error);
      } finally {
        if (active) activity(-1);
        await Promise.all(
          clients.map((client) =>
            client.disconnect().catch(() => {
              result.failures.push('disconnect-failed');
            }),
          ),
        );
      }
      result.durationMs = io.now() - start;
      results.push(result);
      opts.onGameComplete?.(result);
      // Avoid retry storms when room creation or either seat fails.
      if (result.failures.length) break;
    } while (opts.durationMs !== undefined && io.now() < deadline);
  };
  await Promise.all(Array.from({ length: opts.concurrency }, (_, i) => worker(i)));
  activity(0);
  return results.sort((a, b) => a.gameIdx - b.gameIdx);
}

async function createRoom(serverUrl: string, scenario: Scenario, io: RunnerIO): Promise<string> {
  const response = await io.fetch(`${serverUrl.replace(/^ws/, 'http')}/api/rooms`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: scenario.mode,
      variant: scenario.variant,
      timeControl: scenario.timeControl,
      ...(scenario.mode === 'pve'
        ? { preferredColor: 'white', ...(scenario.engineId ? { engineId: scenario.engineId } : {}) }
        : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`room-create-${response.status}`);
  const body = (await response.json()) as { roomId?: unknown };
  if (typeof body.roomId !== 'string' || !body.roomId) throw new Error('room-create-invalid');
  return body.roomId;
}

async function playLoop(
  client: LoadClient,
  scenario: Scenario,
  result: GameResult,
  seed: number,
  gameStart: number,
  origin: number,
  warmupMs: number,
  thinkMs: number,
  deadline: number,
  io: RunnerIO,
): Promise<void> {
  const color = client.seat;
  if (color !== 'white' && color !== 'black') throw new Error('pairing-failed');
  const rng = makeRng(seed);
  let actedOnMove = -1;
  let lastSent: number | undefined;
  for (let count = 0; count < scenario.maxMoves && io.now() < deadline; count++) {
    let snapshot: StateMessage;
    // A wait cut short by the window is censored, never a timeout: the timer
    // can fire a hair before the monotonic clock reads the deadline.
    let cutByWindow = deadline - io.now() <= scenario.moveTimeoutMs;
    try {
      snapshot = await client.waitFor<StateMessage>(
        (m) => {
          const message = m as StateMessage;
          if (message.type !== 'snapshot' && message.type !== 'event-appended') return false;
          const status = message.state?.status;
          return (
            status?.type === 'finished' ||
            (status?.type === 'playing' &&
              status.turn === color &&
              (message.state?.moveNumber ?? -1) > actedOnMove)
          );
        },
        { timeoutMs: Math.max(1, Math.min(scenario.moveTimeoutMs, deadline - io.now())) },
      );
    } catch {
      if (!cutByWindow && io.now() < deadline) result.failures.push(`${color}-turn-timeout`);
      break;
    }
    if (lastSent !== undefined && color === 'white') {
      const receipt = client.receivedAt(snapshot);
      if (receipt !== undefined) result.moveLatencies.push(receipt - lastSent);
    }
    if (snapshot.state?.status?.type === 'finished') {
      result.finishedNaturally = true;
      result.result = {
        winner: snapshot.state.status.winner ?? null,
        reason: snapshot.state.status.reason ?? '',
      };
      break;
    }
    if (thinkMs > 0) {
      const pause = Math.min(thinkMs * (0.5 + rng()), deadline - io.now());
      if (pause > 0) {
        await (io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(pause);
      }
    }
    if (io.now() >= deadline || result.failures.length) break;
    const move = pickRandomMove(snapshot.state?.legalMoves ?? [], rng);
    if (!move) {
      result.failures.push(`${color}-no-legal-moves`);
      break;
    }
    const afterSeq = client.messages.reduce<number>(
      (seq, m) => Math.max(seq, (m as StateMessage).seq ?? -1),
      -1,
    );
    const bufferStart = client.messages.length;
    const submitted = io.now();
    const attempt: MoveAttempt = {
      color,
      move,
      submittedMs: submitted - origin,
      phase: submitted - origin < warmupMs ? 'warmup' : 'measurement',
      outcome: 'disconnected',
    };
    result.moveAttempts.push(attempt);
    lastSent = submitted;
    cutByWindow = deadline - submitted <= scenario.moveTimeoutMs;
    try {
      client.send({ type: 'move', ...move });
      const ack = await client.waitFor<StateMessage>(
        (m) => {
          const message = m as StateMessage;
          const receipt = client.receivedAt(message);
          return (
            client.messages.indexOf(message) >= bufferStart &&
            receipt !== undefined &&
            receipt >= submitted &&
            (message.type === 'error' ||
              matchesAcknowledgment(message, move, color, afterSeq) ||
              finalSnapshotAckSeq(message, move, color, afterSeq) >= 0)
          );
        },
        { timeoutMs: Math.max(1, Math.min(scenario.moveTimeoutMs, deadline - io.now())) },
      );
      const received = client.receivedAt(ack)!;
      attempt.receivedMs = received - origin;
      if (ack.type === 'error') {
        attempt.outcome = 'rejected';
        result.failures.push(`${color}-move-rejected`);
        break;
      }
      attempt.seq = ack.seq ?? finalSnapshotAckSeq(ack, move, color, afterSeq);
      if (received > deadline) {
        attempt.outcome = 'window-ended';
        break;
      }
      attempt.outcome = 'acknowledged';
      attempt.latencyMs = received - submitted;
    } catch {
      attempt.outcome =
        client.isClosed() && io.now() < deadline
          ? 'disconnected'
          : cutByWindow || io.now() >= deadline
            ? 'window-ended'
            : 'timeout';
      if (attempt.outcome !== 'window-ended')
        result.failures.push(`${color}-ack-${attempt.outcome}`);
      break;
    }
    actedOnMove = snapshot.state?.moveNumber ?? actedOnMove;
  }
  result.note ??=
    io.now() >= deadline
      ? io.now() - gameStart >= scenario.maxGameMs
        ? 'maxGameMs-exceeded'
        : 'window-ended'
      : 'maxMoves-cap';
}
