import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import type { WebSocket } from 'ws';
import { createDrainController } from './server-drain.js';
import type { Room } from './server-types.js';
import { clientFixture, gameProjectionFixture, roomFixture } from './test-builders.js';
import { registerVariantTenant } from './variant-tenant/registry.js';

type ResponseCapture = {
  body: string;
  headers: Record<string, string>;
  status: number | null;
};

type RequestOptions = {
  body?: object;
  headers?: IncomingMessage['headers'];
  method?: string;
  remoteAddress?: string;
};

let drainTestTenantActiveGames = 0;

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {},
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as ServerResponse & ResponseCapture;
}

function request({
  body = {},
  headers = {},
  method = 'POST',
  remoteAddress = '127.0.0.1',
}: RequestOptions = {}): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    headers,
    method,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  } as unknown as IncomingMessage;
}

function responseJson(response: ResponseCapture): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

// A room only gates a deploy while something is still happening in it (see
// deploy-gate.ts), so a fixture standing in for a live game needs a fresh event
// timestamp. roomFixture's default log is stamped at epoch 1, which now reads
// (correctly) as a room nobody has touched in decades.
function playingRoom(id: string, options: { paused?: boolean; lastEventAt?: number } = {}) {
  return roomFixture({
    id,
    events: [
      {
        type: 'room-created',
        at: options.lastEventAt ?? Date.now(),
        roomId: id,
        variant: 'dark-chess',
      },
    ],
    projection: gameProjectionFixture({
      paused: options.paused ?? false,
      roomId: id,
      state: { status: { type: 'playing', turn: 'white' } },
    }),
  });
}

test('drain controller counts only unpaused playing rooms', () => {
  const playing = playingRoom('playing');
  const paused = playingRoom('paused', { paused: true });
  const finished = roomFixture({
    id: 'finished',
    projection: gameProjectionFixture({
      roomId: 'finished',
      state: { status: { type: 'finished', winner: 'white', reason: 'checkmate' } },
    }),
  });
  const rooms = new Map([
    [playing.id, playing],
    [paused.id, paused],
    [finished.id, finished],
  ]);

  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms,
  });

  assert.equal(drain.activeGameCount(), 1);
});

// The gate protects players mid-game, and a room nobody has touched in hours
// has no such player. It used to count anyway, which is how four abandoned tabs
// held activeGames at 4 indefinitely and blocked every release: safe-deploy
// gives up rather than proceeding when its window expires with games "active".
test('an abandoned room stops gating deploys but stays visible in the census', () => {
  const live = playingRoom('live');
  const abandoned = playingRoom('abandoned', { lastEventAt: Date.now() - 6 * 60 * 60_000 });
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms: new Map([
      [live.id, live],
      [abandoned.id, abandoned],
    ]),
  });

  assert.equal(drain.activeGameCount(), 1);
  const census = drain.deployGateCensus();
  assert.equal(census.gating, 1);
  assert.equal(census.idle, 1);
});

test('drain controller counts live variant-tenant games alongside chess rooms', () => {
  drainTestTenantActiveGames = 2;
  registerVariantTenant({
    kind: 'drain-test-tenant',
    gameSpecId: 'drain-test-tenant',
    roomIdPrefix: 'draintest_',
    ownsSpecRouting: true,
    errorPrefix: 'drain_test_tenant',
    enabled: () => true,
    rooms: new Map(),
    activeGameCount: () => drainTestTenantActiveGames,
    getOrLoadRoom: async () => null,
    attachWebSocket: async () => {
      throw new Error('unexpected ws attach in drain test');
    },
    clearRuntimeTimers: () => {},
    clearRooms: () => {},
    http: {
      matchesCreateRequest: () => false,
      handleCreate: async () => {
        throw new Error('unexpected http create in drain test');
      },
    },
    lobby: null,
    sweepDueDeadline: null,
    createCorrespondenceGameForSeek: null,
  });

  const chessRoom = playingRoom('chess-playing');
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms: new Map([[chessRoom.id, chessRoom]]),
  });

  // 1 chess + 2 playing tenant rooms; the finished tenant room is excluded.
  // Without the tenant sum, a deploy gated on activeGames==0 can land over a
  // live DMX game.
  assert.equal(drain.activeGameCount(), 3);
  drainTestTenantActiveGames = 0;
});

test('drain controller activates idempotently and broadcasts restart schedule', async () => {
  const sent: string[] = [];
  const socket = {
    send(message: string) {
      sent.push(message);
    },
  } as unknown as WebSocket;
  const room = roomFixture({ clients: [clientFixture({ socket })] });
  const rooms = new Map([[room.id, room]]);
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms,
  });

  const first = captureResponse();
  await drain.handleRequest(request({ body: { windowMs: 1500 } }), first, '/admin/drain');

  assert.equal(first.status, 200);
  const firstBody = responseJson(first);
  assert.equal(firstBody.draining, true);
  assert.equal(firstBody.idempotent, false);
  assert.equal(typeof firstBody.restartAt, 'number');
  assert.equal(drain.isDraining(), true);
  assert.equal(drain.drainDeadlineMs(), firstBody.restartAt);
  assert.equal(drain.restartPhase(), 'pending');
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(sent[0]!) as Record<string, unknown>, {
    type: 'server_restart_scheduled',
    phase: 'pending',
    restartAt: firstBody.restartAt,
  });

  const second = captureResponse();
  await drain.handleRequest(request({ body: { windowMs: 2000 } }), second, '/admin/drain');

  assert.equal(second.status, 200);
  const secondBody = responseJson(second);
  assert.equal(secondBody.idempotent, true);
  assert.equal(secondBody.restartAt, firstBody.restartAt);
  assert.equal(sent.length, 1, 'idempotent drain activation should not rebroadcast');
});

test('restart commit requires zero active games and broadcasts immediately before deploy', async () => {
  const sent: string[] = [];
  const socket = {
    send(message: string) {
      sent.push(message);
    },
  } as unknown as WebSocket;
  const room = playingRoom('restart-commit');
  room.clients.add(clientFixture({ socket }));
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms: new Map([[room.id, room]]),
  });

  await drain.handleRequest(
    request({ body: { windowMs: 1500 } }),
    captureResponse(),
    '/admin/drain',
  );
  const blocked = captureResponse();
  await drain.handleRequest(request({ body: { phase: 'restarting' } }), blocked, '/admin/drain');
  assert.equal(blocked.status, 409);
  assert.deepEqual(responseJson(blocked), { error: 'active_games_remaining', activeGames: 1 });
  assert.equal(drain.restartPhase(), 'pending');

  room.projection.state.status = {
    type: 'finished',
    winner: 'white',
    reason: 'checkmate',
  };
  const committed = captureResponse();
  await drain.handleRequest(request({ body: { phase: 'restarting' } }), committed, '/admin/drain');
  assert.equal(committed.status, 200);
  assert.equal(responseJson(committed).phase, 'restarting');
  assert.equal(drain.restartPhase(), 'restarting');
  assert.deepEqual(JSON.parse(sent[1]!) as Record<string, unknown>, {
    type: 'server_restart_scheduled',
    phase: 'restarting',
  });
});

test('drain controller cancels active drains and broadcasts cancellation', async () => {
  const sent: string[] = [];
  const socket = {
    send(message: string) {
      sent.push(message);
    },
  } as unknown as WebSocket;
  const room = roomFixture({ clients: [clientFixture({ socket })] });
  const rooms = new Map([[room.id, room]]);
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms,
  });

  await drain.handleRequest(
    request({ body: { windowMs: 1500 } }),
    captureResponse(),
    '/admin/drain',
  );

  const cancel = captureResponse();
  await drain.handleRequest(request(), cancel, '/admin/drain/cancel');

  assert.equal(cancel.status, 200);
  assert.equal(responseJson(cancel).draining, false);
  assert.equal(drain.isDraining(), false);
  assert.equal(drain.drainDeadlineMs(), null);
  assert.equal(drain.restartPhase(), null);
  assert.deepEqual(JSON.parse(sent[1]!) as Record<string, unknown>, {
    type: 'server_restart_cancelled',
  });
});

test('drain controller rejects invalid methods and windows', async () => {
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms: new Map(),
  });

  const getResponse = captureResponse();
  await drain.handleRequest(request({ method: 'GET' }), getResponse, '/admin/drain');
  assert.equal(getResponse.status, 405);
  assert.equal(responseJson(getResponse).error, 'method_not_allowed');

  const invalidWindow = captureResponse();
  await drain.handleRequest(request({ body: { windowMs: -1 } }), invalidWindow, '/admin/drain');
  assert.equal(invalidWindow.status, 400);
  assert.equal(responseJson(invalidWindow).error, 'invalid_window');
});

// Registers a tenant with a live client, so it stays LAST in this file: any
// drain activated after this registration also reaches that client.
test('drain broadcasts reach variant-tenant room clients', async () => {
  const tenantSent: string[] = [];
  const tenantRoom = {
    id: 'drainbcast_room',
    clients: [
      {
        socket: {
          close: () => {},
          send: (message: string) => tenantSent.push(message),
        },
      },
    ],
    pendingWrites: Promise.resolve(),
  };
  registerVariantTenant({
    kind: 'drain-broadcast-tenant',
    gameSpecId: 'drain-broadcast-tenant',
    roomIdPrefix: 'drainbcast_',
    ownsSpecRouting: true,
    errorPrefix: 'drain_broadcast_tenant',
    enabled: () => true,
    rooms: new Map([[tenantRoom.id, tenantRoom]]),
    activeGameCount: () => 0,
    getOrLoadRoom: async () => null,
    attachWebSocket: async () => {
      throw new Error('unexpected ws attach in drain test');
    },
    clearRuntimeTimers: () => {},
    clearRooms: () => {},
    http: {
      matchesCreateRequest: () => false,
      handleCreate: async () => {
        throw new Error('unexpected http create in drain test');
      },
    },
    lobby: null,
    sweepDueDeadline: null,
    createCorrespondenceGameForSeek: null,
  });

  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms: new Map(),
  });

  await drain.handleRequest(
    request({ body: { windowMs: 1500 } }),
    captureResponse(),
    '/admin/drain',
  );
  assert.equal(tenantSent.length, 1);
  assert.equal((JSON.parse(tenantSent[0]!) as { type: string }).type, 'server_restart_scheduled');

  await drain.handleRequest(request(), captureResponse(), '/admin/drain/cancel');
  assert.equal(tenantSent.length, 2);
  assert.equal((JSON.parse(tenantSent[1]!) as { type: string }).type, 'server_restart_cancelled');
});

// Two sessions releasing at once. The first drains, fails before pushing, and
// runs its cleanup; without an owner on the drain that cleanup cancelled the
// SECOND session's drain, and the second session then deployed into live games.
test('a drain cancel from another release is refused, and leaves the drain running', async () => {
  const rooms = new Map<string, Room>();
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms,
  });

  await drain.handleRequest(
    request({ body: { windowMs: 1500, owner: 'release-b' } }),
    captureResponse(),
    '/admin/drain',
  );

  const refused = captureResponse();
  await drain.handleRequest(
    request({ body: { owner: 'release-a' } }),
    refused,
    '/admin/drain/cancel',
  );

  assert.equal(refused.status, 409);
  assert.equal(responseJson(refused).error, 'drain_owned_by_another');
  assert.equal(responseJson(refused).owner, 'release-b');
  assert.equal(drain.isDraining(), true, 'release-b is still waiting for its games to finish');
});

test('a release can cancel the drain it started', async () => {
  const rooms = new Map<string, Room>();
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms,
  });

  await drain.handleRequest(
    request({ body: { windowMs: 1500, owner: 'release-b' } }),
    captureResponse(),
    '/admin/drain',
  );

  const cancel = captureResponse();
  await drain.handleRequest(
    request({ body: { owner: 'release-b' } }),
    cancel,
    '/admin/drain/cancel',
  );

  assert.equal(cancel.status, 200);
  assert.equal(drain.isDraining(), false);
});

// The escape hatch has to stay open: a human cancelling by hand is the remedy
// when the automation is the thing that went wrong, so an unowned cancel takes
// any drain.
test('a cancel that names no owner still cancels an owned drain', async () => {
  const rooms = new Map<string, Room>();
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms,
  });

  await drain.handleRequest(
    request({ body: { windowMs: 1500, owner: 'release-b' } }),
    captureResponse(),
    '/admin/drain',
  );

  const cancel = captureResponse();
  await drain.handleRequest(request(), cancel, '/admin/drain/cancel');

  assert.equal(cancel.status, 200);
  assert.equal(drain.isDraining(), false);
});

function loggedKinds(calls: readonly { arguments: unknown[] }[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const call of calls) {
    const line = call.arguments[0];
    if (typeof line !== 'string' || !line.startsWith('{')) continue;
    out.push(JSON.parse(line) as Record<string, unknown>);
  }
  return out;
}

// A drain whose deadline passes without a restart used to end silently: the
// server stopped refusing games, but no client was told, so every open tab kept
// "Update pending" until a reload. The lapse now broadcasts the cancel and
// closes the drain's summary.
test('a lapsed drain tells clients and closes its summary as lapsed', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const sent: string[] = [];
  const socket = {
    send(message: string) {
      sent.push(message);
    },
  } as unknown as WebSocket;
  const room = roomFixture({ clients: [clientFixture({ socket })] });
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms: new Map([[room.id, room]]),
  });

  await drain.handleRequest(request({ body: { windowMs: 20 } }), captureResponse(), '/admin/drain');
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(drain.isDraining(), false);
  assert.deepEqual(JSON.parse(sent.at(-1)!) as Record<string, unknown>, {
    type: 'server_restart_cancelled',
  });
  const summary = loggedKinds(log.mock.calls).find((entry) => entry.kind === 'drain_summary');
  assert.equal(summary?.outcome, 'lapsed');
  assert.equal(summary?.committed, false);
});

test('a cancelled drain summary counts the creates it refused, by route', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms: new Map(),
  });

  drain.noteRefusedCreate('/api/rooms'); // before any drain: not counted
  await drain.handleRequest(
    request({ body: { windowMs: 1500 } }),
    captureResponse(),
    '/admin/drain',
  );
  drain.noteRefusedCreate('/api/rooms');
  drain.noteRefusedCreate('/api/rooms');
  drain.noteRefusedCreate('/api/xiangqi/rooms/xq_0a1b2c3d-4e5f/join');
  await drain.handleRequest(request(), captureResponse(), '/admin/drain/cancel');

  const summary = loggedKinds(log.mock.calls).find((entry) => entry.kind === 'drain_summary');
  assert.equal(summary?.outcome, 'cancelled');
  assert.equal(summary?.refusedCreates, 3);
  assert.deepEqual(summary?.refusedByRoute, {
    '/api/rooms': 2,
    '/api/xiangqi/rooms/:id/join': 1,
  });
});

test('shutdown closes a committed drain, and a shutdown with no drain says so', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const drain = createDrainController({
    drainWindowDefaultMs: 1000,
    drainWindowMaxMs: 2000,
    rooms: new Map(),
  });

  await drain.handleRequest(
    request({ body: { windowMs: 1500 } }),
    captureResponse(),
    '/admin/drain',
  );
  await drain.handleRequest(
    request({ body: { phase: 'restarting' } }),
    captureResponse(),
    '/admin/drain',
  );
  await drain.finalizeOnShutdown();

  const logged = loggedKinds(log.mock.calls);
  const summary = logged.find((entry) => entry.kind === 'drain_summary');
  assert.equal(summary?.outcome, 'shutdown');
  assert.equal(summary?.committed, true);
  assert.equal(typeof summary?.commitWaitMs, 'number');
  assert.equal(
    logged.some((entry) => entry.kind === 'shutdown_without_drain'),
    false,
  );

  await drain.finalizeOnShutdown();
  assert.equal(
    loggedKinds(log.mock.calls).some((entry) => entry.kind === 'shutdown_without_drain'),
    true,
  );
});
