// #477: an engine-worker restart forgets every seat reservation. Live turns
// must renew the seat and carry on instead of forfeiting the bot, and the
// renewal must never change what the engine is shown.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { EngineTurnRequest, GameEvent } from '@mistboard/game';
import type { DarkXiangqiRuntimeRoom } from './dark-xiangqi-runtime.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { startEngineHttpService } from './engine-service.js';
import { requestInternalEngineReservation } from './internal-engine-client.js';
import {
  playRandomEngineMoveIfReady,
  type RoomManagerContext,
  scheduleRandomEngineMove,
} from './room-manager.js';
import {
  type DarkXiangqiEngineContext,
  playDarkXiangqiEngineMoveIfReady,
} from './server-dark-xiangqi-engine.js';
import {
  type LiveEngineReservationHolder,
  requestLiveEngineTurnWithRenewal,
} from './server-live-engine-reservations.js';
import type { Room } from './server-types.js';
import type { DarkXiangqiLiveRoom } from './server-ws-dark-xiangqi.js';
import { roomFixture } from './test-builders.js';
import { appendTenantRuntimeEvent, createTenantRuntimeRoom } from './variant-tenant/runtime.js';

const TOKEN = 'test-token';
const CHESS_ENGINE = 'python-tier1-v0.9.5';
const DXQ_ENGINE = 'python-fdx-v1.0';

// The fields EngineTurnRequest defines (packages/game/src/engine-protocol.ts),
// the same allow-list engine-protocol/build.test.ts holds the builder to.
const ENGINE_TURN_REQUEST_KEYS = new Set([
  'protocolVersion',
  'gameId',
  'engineId',
  'gameSpecId',
  'sessionId',
  'color',
  'ply',
  'engineSeed',
  'clock',
  'legalMoves',
  'observationTranscript',
  'latestObservationDelta',
]);

// ── A scripted engine endpoint ───────────────────────────────────────────────

type TurnCall = { body: Record<string, unknown>; reservationId: string | null };
type TurnReply = 'reservation-unknown' | 'reservation-mismatch' | 'bad-gateway' | 'move';

type StubEngine = {
  close(): Promise<void>;
  reservations: Array<{ engineId: string; color: string; reservationId: string }>;
  releases: string[];
  turns: TurnCall[];
};

async function startStubEngine(
  script: TurnReply[],
  move: { from: string; to: string },
): Promise<StubEngine> {
  const stub: StubEngine = {
    close: async () => {},
    reservations: [],
    releases: [],
    turns: [],
  };
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    if (req.url === '/internal/engine/reservations') {
      const body = JSON.parse(raw) as { engineId: string; color: string };
      const reservationId = `renewed-${stub.reservations.length + 1}`;
      stub.reservations.push({ ...body, reservationId });
      return json(res, 201, {
        reservationId,
        engineId: body.engineId,
        expiresAt: Date.now() + 60_000,
        capacity: { activeSeats: 1, maxSeats: 4 },
      });
    }
    const release = req.url?.match(/^\/internal\/engine\/reservations\/([^/]+)\/release$/);
    if (release) {
      stub.releases.push(decodeURIComponent(release[1]!));
      return json(res, 200, { ok: true });
    }
    assert.equal(req.url, '/internal/engine/turn');
    const body = JSON.parse(raw) as Record<string, unknown>;
    const header = req.headers['x-mistboard-engine-reservation-id'];
    stub.turns.push({ body, reservationId: typeof header === 'string' ? header : null });
    const reply = script[stub.turns.length - 1] ?? 'move';
    if (reply === 'reservation-unknown') {
      return json(res, 409, { error: 'invalid_engine_reservation', reason: 'unknown' });
    }
    if (reply === 'reservation-mismatch') {
      return json(res, 409, {
        error: 'invalid_engine_reservation',
        reason: 'mismatch',
        reservation: { engineId: 'other-engine', color: 'white' },
      });
    }
    if (reply === 'bad-gateway') return json(res, 502, { error: 'bad gateway' });
    return json(res, 200, {
      protocolVersion: '1',
      gameId: body.gameId,
      sessionId: body.sessionId,
      move,
    });
  });
  await listen(server, 0);
  const restoreEnv = pointEngineEnvAt(serverPort(server));
  stub.close = async () => {
    restoreEnv();
    await closeServer(server);
  };
  return stub;
}

// ── The helper against the real worker HTTP service ──────────────────────────

test('a worker restart renews the seat once and the turn still answers', async () => {
  const handler = async (request: EngineTurnRequest) => ({
    protocolVersion: '1' as const,
    gameId: request.gameId,
    sessionId: request.sessionId,
    move: { from: 'e7', to: 'e5' } as const,
  });
  let service = await startEngineHttpService({
    handler,
    host: '127.0.0.1',
    port: 0,
    poolSize: 1,
    liveEngineSeats: 2,
    token: TOKEN,
  });
  const port = service.port;
  const restoreEnv = pointEngineEnvAt(port);
  try {
    const reservation = await requestInternalEngineReservation({
      engineId: CHESS_ENGINE,
      color: 'black',
    });
    const holder: LiveEngineReservationHolder = {
      id: 'restart-room',
      engineReservationId: reservation.reservationId,
    };
    const request = minimalTurnRequest();
    const budget = { computeBudgetMs: 1_000, watchdogTimeoutMs: 5_000 };

    const first = await requestLiveEngineTurnWithRenewal({ holder, request, budget });
    assert.deepEqual(first.move, { from: 'e7', to: 'e5' });
    assert.equal(holder.engineReservationId, reservation.reservationId);

    // Restart: same address, empty reservation store.
    await service.close();
    service = await startEngineHttpService({
      handler,
      host: '127.0.0.1',
      port,
      poolSize: 1,
      liveEngineSeats: 2,
      token: TOKEN,
    });

    const second = await requestLiveEngineTurnWithRenewal({ holder, request, budget });
    assert.deepEqual(second.move, { from: 'e7', to: 'e5' });
    assert.ok(holder.engineReservationId, 'the holder carries a seat');
    assert.notEqual(holder.engineReservationId, reservation.reservationId);

    const capacity = (await fetch(`http://127.0.0.1:${port}/internal/engine/capacity`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }).then((r) => r.json())) as { activeEngineSeats: number };
    assert.equal(capacity.activeEngineSeats, 1, 'exactly one renewal on the fresh worker');
  } finally {
    restoreEnv();
    await service.close();
  }
});

test('the worker says why it rejected a seat', async () => {
  const service = await startEngineHttpService({
    handler: async (request) => ({
      protocolVersion: '1',
      gameId: request.gameId,
      sessionId: request.sessionId,
      move: { from: 'e7', to: 'e5' },
    }),
    host: '127.0.0.1',
    port: 0,
    poolSize: 1,
    token: TOKEN,
  });
  try {
    const base = `http://127.0.0.1:${service.port}`;
    const reserve = await fetch(`${base}/internal/engine/reservations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ engineId: CHESS_ENGINE, color: 'white' }),
    }).then((r) => r.json() as Promise<{ reservationId: string }>);
    const turn = (reservationId: string) =>
      fetch(`${base}/internal/engine/turn`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'x-mistboard-engine-reservation-id': reservationId,
        },
        body: JSON.stringify(minimalTurnRequest()),
      });

    const mismatch = await turn(reserve.reservationId);
    assert.equal(mismatch.status, 409);
    assert.deepEqual(await mismatch.json(), {
      error: 'invalid_engine_reservation',
      reason: 'mismatch',
      reservation: { engineId: CHESS_ENGINE, color: 'white' },
    });
    const unknown = await turn('never-issued');
    assert.equal(unknown.status, 409);
    assert.deepEqual(await unknown.json(), {
      error: 'invalid_engine_reservation',
      reason: 'unknown',
    });
  } finally {
    await service.close();
  }
});

test('a closing worker lets its in-flight turn finish and answer', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = await startEngineHttpService({
    handler: async (request) => {
      await gate;
      return {
        protocolVersion: '1',
        gameId: request.gameId,
        sessionId: request.sessionId,
        move: { from: 'e7', to: 'e5' },
      };
    },
    host: '127.0.0.1',
    port: 0,
    poolSize: 1,
    token: TOKEN,
  });
  const restoreEnv = pointEngineEnvAt(service.port);
  try {
    const reservation = await requestInternalEngineReservation({
      engineId: CHESS_ENGINE,
      color: 'black',
    });
    const holder = { id: 'drain-room', engineReservationId: reservation.reservationId };
    const inFlight = requestLiveEngineTurnWithRenewal({
      holder,
      request: minimalTurnRequest(),
      budget: { computeBudgetMs: 1_000, watchdogTimeoutMs: 5_000 },
    });
    await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${service.port}/internal/engine/capacity`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      return ((await r.json()) as { activeMoves: number }).activeMoves === 1;
    });
    const closing = service.close();
    release();
    const result = await inFlight;
    assert.deepEqual(result.move, { from: 'e7', to: 'e5' }, 'the in-flight turn finishes');
    await closing;
  } finally {
    restoreEnv();
  }
});

// ── Retry bounds ─────────────────────────────────────────────────────────────

test('a second rejection after renewal throws instead of looping', async () => {
  const stub = await startStubEngine(['reservation-unknown', 'reservation-unknown'], {
    from: 'e7',
    to: 'e5',
  });
  try {
    const holder = { id: 'twice-room', engineReservationId: 'stale' };
    await assert.rejects(
      requestLiveEngineTurnWithRenewal({
        holder,
        request: minimalTurnRequest(),
        budget: { computeBudgetMs: 1_000, watchdogTimeoutMs: 5_000 },
      }),
      /rejected again after renewal/,
    );
    assert.equal(stub.turns.length, 2);
    assert.equal(stub.reservations.length, 1);
  } finally {
    await stub.close();
  }
});

test('an unreachable worker is retried until the turn deadline, then throws with the cause', async () => {
  // Bind and close to get a port nothing listens on: every attempt is refused.
  const probe = createServer();
  await listen(probe, 0);
  const deadPort = serverPort(probe);
  await closeServer(probe);
  const restoreEnv = pointEngineEnvAt(deadPort);
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const budgets: number[] = [];
  try {
    await assert.rejects(
      requestLiveEngineTurnWithRenewal({
        holder: { id: 'dead-room', engineReservationId: 'seat' },
        request: minimalTurnRequest(),
        budget: { computeBudgetMs: 2_000, watchdogTimeoutMs: 4_000 },
        rebudget: () => {
          budgets.push(clock);
          return { computeBudgetMs: 2_000, watchdogTimeoutMs: 4_000 };
        },
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
      }),
      (err: Error) => {
        assert.match(err.message, /engine unreachable until the turn deadline/);
        assert.match(err.message, /request failed/);
        return true;
      },
    );
    const waited = sleeps.reduce((a, b) => a + b, 0);
    assert.ok(waited <= 4_000, `never sleeps past the deadline (slept ${waited}ms)`);
    assert.ok(waited >= 3_500, `keeps retrying until the window closes (slept ${waited}ms)`);
    assert.deepEqual(sleeps.slice(0, 4), [250, 500, 1_000, 2_000]);
    assert.ok(budgets.length >= 3, 'each retry re-derives its budget');
  } finally {
    restoreEnv();
  }
});

test('a 502 while the new worker comes up is retried, then the turn completes', async () => {
  const stub = await startStubEngine(['bad-gateway', 'reservation-unknown', 'move'], {
    from: 'e7',
    to: 'e5',
  });
  try {
    const holder = { id: 'gateway-room', engineReservationId: 'stale' };
    const result = await requestLiveEngineTurnWithRenewal({
      holder,
      request: minimalTurnRequest(),
      budget: { computeBudgetMs: 1_000, watchdogTimeoutMs: 5_000 },
      sleep: async () => {},
    });
    assert.deepEqual(result.move, { from: 'e7', to: 'e5' });
    assert.equal(holder.engineReservationId, 'renewed-1');
    // The old seat's release is fire-and-forget.
    await waitFor(async () => stub.releases.includes('stale'));
  } finally {
    await stub.close();
  }
});

test('a seat renewed after the game ended is released, not kept', async () => {
  const stub = await startStubEngine(['reservation-unknown'], { from: 'e7', to: 'e5' });
  try {
    const holder = { id: 'ended-room', engineReservationId: 'stale' };
    await assert.rejects(
      requestLiveEngineTurnWithRenewal({
        holder,
        request: minimalTurnRequest(),
        budget: { computeBudgetMs: 1_000, watchdogTimeoutMs: 5_000 },
        stillNeeded: () => false,
      }),
      /stopped needing it/,
    );
    assert.equal(holder.engineReservationId, 'stale');
    await waitFor(async () => stub.releases.includes('renewed-1'));
  } finally {
    await stub.close();
  }
});

// ── Fog chess (room-manager) ─────────────────────────────────────────────────

test('fog chess: a forgotten seat renews and the engine still moves (hidden-info bodies equal)', async () => {
  const stub = await startStubEngine(['reservation-mismatch', 'move'], { from: 'e7', to: 'e5' });
  try {
    const room = fogPveRoom('renew-fog-room');
    room.engineReservationId = 'stale-seat';

    await playRandomEngineMoveIfReady(roomCtx(), room);

    const types = room.events.map((event) => event.type);
    assert.equal(types.at(-1), 'move-played');
    assert.ok(!types.includes('seat-forfeited'));
    assert.equal(room.engineReservationId, 'renewed-1');
    assert.deepEqual(stub.reservations, [
      { engineId: CHESS_ENGINE, color: 'black', reservationId: 'renewed-1' },
    ]);
    assertSameRedactedBody(stub.turns);
    assert.deepEqual(
      stub.turns.map((t) => t.reservationId),
      ['stale-seat', 'renewed-1'],
    );
  } finally {
    await stub.close();
  }
});

test('fog chess: rejected twice forfeits the engine seat, once', async () => {
  const stub = await startStubEngine(['reservation-unknown', 'reservation-unknown'], {
    from: 'e7',
    to: 'e5',
  });
  try {
    const room = fogPveRoom('renew-fog-forfeit');
    room.engineReservationId = 'stale-seat';

    scheduleRandomEngineMove(roomCtx(), room);
    await waitFor(async () => room.events.at(-1)?.type === 'seat-forfeited');

    assert.equal(stub.turns.length, 2, 'no retry loop after the second rejection');
    assert.equal(room.events.filter((e) => e.type === 'seat-forfeited').length, 1);
  } finally {
    await stub.close();
  }
});

// ── Dark Xiangqi (tenant) ────────────────────────────────────────────────────

test('dark xiangqi: a forgotten seat renews and the engine still moves (hidden-info bodies equal)', async () => {
  await withDarkXiangqi(async () => {
    const stub = await startStubEngine(['reservation-unknown', 'move'], { from: 'a1', to: 'a2' });
    try {
      const room = dxqPveRoom();
      room.engineReservationId = 'stale-seat';

      await playDarkXiangqiEngineMoveIfReady(dxqCtx(room), room);

      const types = room.events.map((event) => event.type);
      assert.equal(types.at(-1), 'move-played');
      assert.ok(!types.includes('seat-forfeited'));
      assert.equal(room.engineReservationId, 'renewed-1');
      // Red reserves as white: the colour the worker checks the turn against.
      assert.deepEqual(stub.reservations, [
        { engineId: DXQ_ENGINE, color: 'white', reservationId: 'renewed-1' },
      ]);
      assertSameRedactedBody(stub.turns);
    } finally {
      await stub.close();
    }
  });
});

test('dark xiangqi: rejected twice forfeits the engine seat', async () => {
  await withDarkXiangqi(async () => {
    const stub = await startStubEngine(['reservation-unknown', 'reservation-unknown'], {
      from: 'a1',
      to: 'a2',
    });
    try {
      const room = dxqPveRoom();
      room.engineReservationId = 'stale-seat';

      await playDarkXiangqiEngineMoveIfReady(dxqCtx(room), room);

      assert.equal(room.events.at(-1)?.type, 'seat-forfeited');
      assert.equal(stub.turns.length, 2);
    } finally {
      await stub.close();
    }
  });
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

function assertSameRedactedBody(turns: TurnCall[]): void {
  assert.equal(turns.length, 2, 'one attempt before the renewal, one after');
  const [before, after] = turns as [TurnCall, TurnCall];
  assert.deepEqual(after.body, before.body, 'the renewal resends the same redacted request');
  for (const key of Object.keys(before.body)) {
    assert.ok(ENGINE_TURN_REQUEST_KEYS.has(key), `unexpected request field: ${key}`);
  }
  for (const key of ['protocolVersion', 'gameId', 'engineId', 'sessionId', 'color', 'ply']) {
    assert.ok(key in before.body, `request is missing ${key}`);
  }
}

function minimalTurnRequest(): EngineTurnRequest {
  return {
    protocolVersion: '1',
    gameId: 'renewal-game',
    engineId: CHESS_ENGINE,
    sessionId: 'renewal-session',
    color: 'black',
    ply: 1,
    engineSeed: 7,
    clock: { remaining_ms: null, increment_ms: 0 },
    legalMoves: [{ from: 'e7', to: 'e5' }],
    observationTranscript: [],
  } as unknown as EngineTurnRequest;
}

function fogPveRoom(id: string): Room {
  const now = Date.now();
  const events: GameEvent[] = [
    { type: 'room-created', at: now, roomId: id, variant: 'dark-chess' },
    { type: 'seat-assigned', at: now, roomId: id, clientId: 'human-white', seat: 'white' },
    { type: 'seat-assigned', at: now, roomId: id, clientId: CHESS_ENGINE, seat: 'black' },
    {
      type: 'move-played',
      at: now + 1,
      roomId: id,
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];
  const room = roomFixture({ id, events, variant: 'dark-chess' });
  room.mode = 'pve';
  room.randomEngine = true;
  room.pveEngineId = CHESS_ENGINE;
  return room;
}

function roomCtx(): RoomManagerContext {
  return {
    send() {},
    recordPersistenceError() {},
    pveBuiltinEngineClientId: 'builtin-random-legal',
    pveEngineMoveDelayMs: 0,
    liveEngineTimeoutMs: 3_000,
    liveClockInitialMs: 180_000,
    liveClockIncrementMs: 2_000,
  };
}

function dxqPveRoom(): DarkXiangqiLiveRoom {
  const created = createTenantRuntimeRoom(darkXiangqiTenant, 'dxq_renewal_test');
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error('room create failed');
  const room = created.room;
  appendTenantRuntimeEvent(darkXiangqiTenant, room, {
    type: 'seat-assigned',
    at: 1,
    roomId: room.id,
    clientId: DXQ_ENGINE,
    seat: 'red',
  });
  appendTenantRuntimeEvent(darkXiangqiTenant, room, {
    type: 'seat-assigned',
    at: 2,
    roomId: room.id,
    clientId: 'human',
    seat: 'black',
  });
  return room as DarkXiangqiLiveRoom;
}

function dxqCtx(room: DarkXiangqiRuntimeRoom): DarkXiangqiEngineContext {
  return {
    appendEvent: async (_room, event) => appendTenantRuntimeEvent(darkXiangqiTenant, room, event),
    broadcastEventAppended: () => {},
    now: () => 1_000,
  };
}

async function withDarkXiangqi(fn: () => Promise<void>): Promise<void> {
  const before = process.env.MISTBOARD_DARK_XIANGQI_ENABLED;
  process.env.MISTBOARD_DARK_XIANGQI_ENABLED = 'true';
  try {
    await fn();
  } finally {
    restoreEnvVar('MISTBOARD_DARK_XIANGQI_ENABLED', before);
  }
}

function pointEngineEnvAt(port: number): () => void {
  const previousUrl = process.env.MISTBOARD_INTERNAL_ENGINE_URL;
  const previousToken = process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN;
  process.env.MISTBOARD_INTERNAL_ENGINE_URL = `http://127.0.0.1:${port}`;
  process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN = TOKEN;
  return () => {
    restoreEnvVar('MISTBOARD_INTERNAL_ENGINE_URL', previousUrl);
    restoreEnvVar('MISTBOARD_INTERNAL_ENGINE_TOKEN', previousToken);
  };
}

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('condition not met in time');
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });
}

function serverPort(server: Server): number {
  return (server.address() as AddressInfo).port;
}
