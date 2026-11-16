import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import {
  correspondenceTimeControl,
  createFFQBanqiDeal,
  type FFQBanqiPlayerView,
  gameSpecForId,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import { FFQ_BANQI_ROOM_ID_PREFIX, ffqBanqiAdmits } from './ffq-banqi-access.js';
import { createFFQBanqiRoom, ffqBanqiRooms } from './ffq-banqi-registration.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { close, getPool, init } from './persistence-db.js';
import { clearPresence } from './presence.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle as lobbyRoute } from './routes/lobby.js';
import { tryHandle as roomsRoute } from './routes/rooms.js';
import {
  handleWebSocketConnection,
  resolveWebSocketLiveRuntime,
  type WebSocketConnectionContext,
} from './server-ws-connection.js';
import './variant-tenant/register-tenants.js';
import {
  registeredVariantTenants,
  type TenantManagedRoom,
  variantTenantForRoomId,
} from './variant-tenant/registry.js';
import {
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
  tenantRoomIsLobbyMatch,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { clearTenantRuntimeTimers } from './variant-tenant/ws.js';

const FLAG = 'MISTBOARD_FFQ_BANQI_ENABLED';
const VALID = [
  { gameSpecId: 'ffq-banqi' },
  { variant: 'ffq-banqi' },
  { gameSpecId: 'ffq-banqi', variant: 'ffq-banqi' },
];
const CONFLICTS = [
  { gameSpecId: 'dark-chess', variant: 'ffq-banqi' },
  { gameSpecId: 'ffq-banqi', variant: 'dark-chess' },
  { gameSpecId: 'banqi', variant: 'ffq-banqi' },
  { gameSpecId: 'unknown', variant: 'ffq-banqi' },
  { gameSpecId: 'ffq-banqi', variant: '' },
  { gameSpecId: 42, variant: 'ffq-banqi' },
];
const CTX = {
  databaseRequired: false,
  refusesCreate: () => false,
  drainDeadlineMs: () => null,
} as unknown as HttpApiContext;
const WS_CTX = {
  defaultRoomRegion: 'test',
  wsMessageLimit: 100,
  wsMessageWindowMs: 1000,
} as WebSocketConnectionContext;

function fixture(
  t: TestContext,
  flag: string | undefined,
  role: 'player' | 'admin' | null,
  surface: 'hidden' | 'casual' = 'hidden',
) {
  const spec = gameSpecForId('ffq-banqi');
  const priorSurface = spec.publicSurface;
  spec.publicSurface = surface;
  t.after(() => {
    spec.publicSurface = priorSurface;
  });
  const before = process.env[FLAG];
  if (flag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flag;
  const logs = new Map<string, FFQBanqiEvent[]>();
  const reads: string[] = [];
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(async () => {
    for (const room of ffqBanqiRooms.values()) clearTenantRuntimeTimers(room);
    ffqBanqiRooms.clear();
    clearPresence();
    await close();
    if (before === undefined) delete process.env[FLAG];
    else process.env[FLAG] = before;
  });
  t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
  t.mock.method(getPool(), 'query', async (sql: string, args: unknown[]) => {
    if (sql.includes('UPDATE account_sessions')) {
      return { rows: role ? [{ id: args[0], handle: 'fixture', account_role: role }] : [] };
    }
    if (sql.startsWith('INSERT INTO events')) {
      const [id, seq, , event] = args as [string, number, string, FFQBanqiEvent];
      const events = logs.get(id) ?? [];
      assert.equal(seq, events.length);
      events.push(structuredClone(event));
      logs.set(id, events);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT payload FROM events')) {
      reads.push(args[0] as string);
      return { rows: (logs.get(args[0] as string) ?? []).map((payload) => ({ payload })) };
    }
    if (sql.includes('FROM room_seat_tokens')) return { rows: [] };
    if (sql.includes('INSERT INTO room_seat_tokens') || sql.includes('room_deadlines'))
      return { rows: [] };
    assert.fail(`unexpected FFQ persistence operation: ${sql}`);
  });
  const headers = (id = 'fixture-user') =>
    role ? { cookie: `mistboard_session=${id}.fixture` } : {};
  return {
    logs,
    reads,
    headers,
    admitted: flag === 'true' && (surface === 'casual' || role === 'admin'),
  };
}

class Socket {
  sent: Record<string, unknown>[] = [];
  closes: unknown[] = [];
  handlers = new Map<string, (data: string) => void>();
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string) {
    this.closes.push([code, reason]);
  }
  on(event: string, handler: (data: string) => void) {
    this.handlers.set(event, handler);
    return this;
  }
  async receive(message: object) {
    this.handlers.get('message')?.(JSON.stringify(message));
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  }
}

async function connect(room: string, headers: IncomingMessage['headers'], selectors = {}) {
  const socket = new Socket();
  await handleWebSocketConnection(
    WS_CTX,
    socket as unknown as WebSocket,
    { url: `/?${new URLSearchParams({ room, ...selectors })}`, headers } as IncomingMessage,
  );
  return socket;
}

async function post(
  path: '/api/rooms' | '/api/lobby',
  body: object,
  headers: IncomingMessage['headers'],
  ctx = CTX,
) {
  const request = Readable.from([
    JSON.stringify({ mode: 'pvp', ...body }),
  ]) as unknown as IncomingMessage;
  request.method = 'POST';
  request.headers = headers;
  let status = 0;
  let payload = '';
  const response = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      payload += chunk;
    },
  } as unknown as ServerResponse;
  assert.equal(
    await (path === '/api/rooms' ? roomsRoute : lobbyRoute)(ctx, request, response, path),
    true,
  );
  return { status, body: JSON.parse(payload) };
}

function assertMasked(socket: Socket) {
  const serialized = JSON.stringify(socket.sent);
  assert.doesNotMatch(serialized, /"(?:setup|deal|seed)"/);
  JSON.parse(serialized, (_key, value) => {
    if (value && typeof value === 'object' && value.faceDown === true)
      assert.deepEqual(value, { faceDown: true });
    return value;
  });
  const hello = socket.sent.find((frame) => frame.type === 'hello');
  assert.ok(hello);
  assert.deepEqual((hello.state as FFQBanqiPlayerView).hp, { red: 60, black: 60 });
  assert.deepEqual(socket.closes, []);
  return hello;
}

function eventsFor(id: string, occupied: boolean, finished: boolean): FFQBanqiEvent[] {
  const at = Date.now();
  return [
    {
      type: 'room-created',
      roomId: id,
      at,
      gameSpecId: 'ffq-banqi',
      setup: { deal: createFFQBanqiDeal(800) },
    },
    ...(occupied
      ? ([
          { type: 'seat-assigned', roomId: id, at, seat: 'red', clientId: 'other-red' },
          { type: 'seat-assigned', roomId: id, at, seat: 'black', clientId: 'other-black' },
        ] as FFQBanqiEvent[])
      : []),
    ...(finished
      ? ([{ type: 'seat-resigned', roomId: id, at, color: 'red' }] as FFQBanqiEvent[])
      : []),
  ];
}

const launches = (['hidden', 'casual'] as const).flatMap((surface) =>
  [undefined, 'false', 'true'].map((flag) => ({ surface, flag })),
);

for (const { surface, flag } of launches) {
  for (const role of [null, 'player', 'admin'] as const) {
    test(`FFQ creation and connection matrix: surface=${surface}, flag=${flag}, account=${role ?? 'guest'}`, async (t) => {
      const { admitted, headers, logs, reads } = fixture(t, flag, role, surface);
      assert.equal(ffqBanqiAdmits(role ? { accountRole: role } : null), admitted);
      assert.equal(ffqBanqiTenant.roomIdPrefix, FFQ_BANQI_ROOM_ID_PREFIX);
      assert.equal(variantTenantForRoomId('ffq_reserved')?.gameSpecId, 'ffq-banqi');
      const refusedCtx = new Proxy({} as HttpApiContext, {
        get: (_target, key) => assert.fail(`refused request reached runtime: ${String(key)}`),
      });
      for (const selectors of VALID) {
        const result = await post('/api/rooms', selectors, headers(), admitted ? CTX : refusedCtx);
        assert.equal(result.status, admitted ? 201 : 404);
        if (admitted) {
          const room = ffqBanqiRooms.get(result.body.roomId)!;
          assert.ok(room.id.startsWith(FFQ_BANQI_ROOM_ID_PREFIX));
          assert.equal(result.body.gameSpecId, 'ffq-banqi');
          assert.equal(room.rated, false);
          assert.equal(room.pveBotId, null);
          assert.deepEqual(replayTenantEvents(ffqBanqiTenant, logs.get(room.id)!), room.projection);
          const red = assertMasked(await connect(room.id, headers('admin-red'), selectors));
          const black = assertMasked(await connect(room.id, headers('admin-black')));
          const observer = assertMasked(await connect(room.id, headers('admin-observer')));
          assert.equal(red.seat, 'red');
          assert.equal(black.seat, 'black');
          assert.equal(observer.seat, 'spectator');
          assert.doesNotMatch(JSON.stringify(result.body), /setup|deal|seed/);
        } else assert.deepEqual(result.body, { error: 'ffq_banqi_disabled' });
        const publicLobby = admitted && surface === 'casual';
        const lobby = await post(
          '/api/lobby',
          selectors,
          headers(),
          publicLobby
            ? {
                ...CTX,
                lobbyQueue: [],
                lobbyTickets: new Map(),
              }
            : refusedCtx,
        );
        assert.equal(lobby.status, publicLobby ? 202 : admitted ? 501 : 404);
        if (publicLobby) assert.equal(lobby.body.status, 'waiting');
        else
          assert.deepEqual(lobby.body, {
            error: admitted ? 'ffq_banqi_unsupported_surface' : 'ffq_banqi_disabled',
          });
      }
      // PvE follows live admission; bot games stay casual.
      for (const preferredColor of ['red', 'black'] as const) {
        const pve = await post(
          '/api/rooms',
          {
            gameSpecId: 'ffq-banqi',
            mode: 'pve',
            engineId: 'misty-ffq-banqi-level-1',
            preferredColor,
          },
          headers(),
        );
        assert.equal(pve.status, admitted ? 201 : 404);
        if (admitted) {
          const room = ffqBanqiRooms.get(pve.body.roomId)!;
          assert.equal(room.rated, false);
          assert.equal(
            room.projection.seats[preferredColor === 'red' ? 'black' : 'red'],
            'misty-ffq-banqi-level-1',
          );
        }
      }
      const savedEnginePath = process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;
      process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = '/nonexistent/ffq-banqi-engine';
      try {
        const missing = await post(
          '/api/rooms',
          { gameSpecId: 'ffq-banqi', mode: 'pve', engineId: 'misty-ffq-banqi-level-4' },
          headers(),
        );
        assert.equal(missing.status, 404);
        assert.equal(
          missing.body.error,
          admitted ? 'ffq_banqi_engine_disabled' : 'ffq_banqi_disabled',
        );
      } finally {
        if (savedEnginePath === undefined) delete process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;
        else process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = savedEnginePath;
      }
      const invalid = await post(
        '/api/rooms',
        { gameSpecId: 'ffq-banqi', mode: 'pve', engineId: 'unknown' },
        headers(),
      );
      assert.equal(invalid.status, admitted ? 400 : 404);
      assert.equal(invalid.body.error, admitted ? 'invalid_engine' : 'ffq_banqi_disabled');
      const ratedBot = await post(
        '/api/rooms',
        { gameSpecId: 'ffq-banqi', mode: 'pve', engineId: 'misty-ffq-banqi-level-1', rated: true },
        headers(),
      );
      assert.equal(ratedBot.status, admitted ? 501 : 404);
      const direct = await createFFQBanqiRoom(role ? { accountRole: role } : null);
      assert.equal(direct.ok, admitted, 'the factory itself also enforces policy');
      for (const selectors of CONFLICTS) {
        for (const path of ['/api/rooms', '/api/lobby'] as const) {
          const result = await post(path, selectors, headers(), refusedCtx);
          assert.equal(
            result.status,
            admitted && surface === 'hidden' && path === '/api/lobby' ? 501 : 404,
          );
          assert.equal(
            result.body.error,
            !admitted
              ? 'ffq_banqi_disabled'
              : surface === 'hidden' && path === '/api/lobby'
                ? 'ffq_banqi_unsupported_surface'
                : 'unknown_game_spec',
          );
        }
      }
      for (const surface of [{ rated: true }]) {
        const result = await post('/api/rooms', { gameSpecId: 'ffq-banqi', ...surface }, headers());
        assert.equal(result.status, admitted ? 501 : 404);
        assert.equal(
          result.body.error,
          admitted ? 'ffq_banqi_unsupported_surface' : 'ffq_banqi_disabled',
        );
      }
      // Policy applies before seat assignment, observer snapshots or persisted setup reads.
      for (const persisted of [false, true]) {
        for (const finished of [false, true]) {
          for (const occupied of [false, true]) {
            const id = `ffq_matrix-${persisted}-${finished}-${occupied}`;
            const events = eventsFor(id, occupied, finished);
            logs.set(id, events);
            if (!persisted) {
              const room = createTenantRuntimeRoomFromEvents(ffqBanqiTenant, events);
              assert.ok(room.ok);
              ffqBanqiRooms.set(id, room.room);
            }
            const beforeReads = reads.length;
            const socket = await connect(id, headers(`admin-${id}`));
            if (admitted) {
              const hello = assertMasked(socket);
              assert.equal(hello.seat, occupied ? 'spectator' : 'red');
              assert.equal(reads.length - beforeReads, persisted ? 1 : 0);
            } else {
              assert.deepEqual(socket.closes, [[1008, 'game spec disabled']]);
              assert.deepEqual(socket.sent, []);
              assert.equal(reads.length, beforeReads, 'refused hydration never loads secret setup');
            }
          }
        }
      }
      for (const selectors of VALID) {
        for (const room of ['room-chess', 'bq_reserved']) {
          const socket = await connect(room, headers(), selectors);
          assert.deepEqual(socket.closes, [
            [1008, admitted ? 'room unavailable' : 'game spec disabled'],
          ]);
          assert.deepEqual(socket.sent, []);
        }
      }
      for (const selectors of [...CONFLICTS, { gameSpecId: 'dark-chess' }, { variant: 'banqi' }]) {
        const params = Object.fromEntries(
          Object.entries(selectors).map(([k, v]) => [k, String(v)]),
        );
        const socket = await connect('ffq_reserved', headers(), params);
        assert.deepEqual(socket.closes, [
          [1008, admitted ? 'unknown game spec' : 'game spec disabled'],
        ]);
      }
    });
  }
}

for (const role of [null, 'player'] as const) {
  test(`launched FFQ plays PvE and casual PvP through production handlers: ${role ?? 'guest'}`, async (t) => {
    // Use the committed launch state rather than substituting a hypothetical switch.
    const surface = gameSpecForId('ffq-banqi').publicSurface;
    assert.equal(surface, 'casual');
    const { headers } = fixture(t, 'true', role, surface);
    const pvp = await post('/api/rooms', { gameSpecId: 'ffq-banqi' }, headers());
    assert.equal(pvp.status, 201);
    const red = await connect(pvp.body.roomId, headers('red-player'));
    const black = await connect(pvp.body.roomId, headers('black-player'));
    assertMasked(red);
    assertMasked(black);
    await red.receive({ type: 'move', from: 0, to: 0 });
    await black.receive({ type: 'move', from: 1, to: 1 });
    const room = ffqBanqiRooms.get(pvp.body.roomId)!;
    assert.equal(room.projection.state.ply, 2);
    assert.equal(room.rated, false);
    assert.doesNotMatch(JSON.stringify([...red.sent, ...black.sent]), /"(?:setup|deal|seed)"/);

    const pve = await post(
      '/api/rooms',
      {
        gameSpecId: 'ffq-banqi',
        mode: 'pve',
        engineId: 'misty-ffq-banqi-level-1',
        preferredColor: 'red',
      },
      headers(),
    );
    assert.equal(pve.status, 201);
    const human = await connect(pve.body.roomId, headers('human-player'));
    assertMasked(human);
    await human.receive({ type: 'move', from: 0, to: 0 });
    const botRoom = ffqBanqiRooms.get(pve.body.roomId)!;
    const deadline = Date.now() + 8_000;
    while (botRoom.projection.state.ply < 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(botRoom.projection.state.ply, 2, 'the real Level 1 bot replies');
    assert.equal(botRoom.rated, false);
    assert.ok(human.sent.some((frame) => frame.type === 'snapshot'));
    assert.doesNotMatch(JSON.stringify(human.sent), /"(?:setup|deal|seed)"/);
  });
}

test('missing FFQ registration never selects chess', async (t) => {
  const { headers } = fixture(t, 'true', 'admin');
  const registrations = registeredVariantTenants().filter(
    (entry) => entry.gameSpecId !== 'ffq-banqi',
  );
  assert.deepEqual(
    await resolveWebSocketLiveRuntime(
      registrations,
      'ffq_missing',
      async () => ({ accountRole: 'admin' }) as never,
    ),
    {
      kind: 'variant-tenant-unavailable',
      reason: 'room unavailable',
    },
  );
  const foreign = {
    ...registrations[0]!,
    rooms: new Map([['ffq_missing', {} as TenantManagedRoom]]),
  };
  assert.deepEqual(
    await resolveWebSocketLiveRuntime(
      [foreign],
      'ffq_missing',
      async () => ({ accountRole: 'admin' }) as never,
    ),
    { kind: 'variant-tenant-unavailable', reason: 'room unavailable' },
    'a foreign live map cannot claim the reserved FFQ namespace',
  );
  const registration = variantTenantForRoomId('ffq_missing')!;
  const original = registration.gameSpecId;
  registration.gameSpecId = 'test-missing-ffq';
  try {
    assert.deepEqual(await post('/api/rooms', { gameSpecId: 'ffq-banqi' }, headers()), {
      status: 501,
      body: { error: 'ffq_banqi_not_integrated' },
    });
    const socket = await connect('ffq_missing', headers(), { variant: 'ffq-banqi' });
    assert.deepEqual(socket.closes, [[1008, 'game spec not integrated']]);
    assert.deepEqual(socket.sent, []);
  } finally {
    registration.gameSpecId = original;
  }
});

for (const role of [null, 'player', 'admin'] as const) {
  test(`FFQ public live launch keeps existing correspondence sockets private: ${role ?? 'guest'}`, async (t) => {
    const { headers, logs } = fixture(t, 'true', role, 'casual');
    const direct = await createFFQBanqiRoom(
      role ? { accountRole: role } : null,
      correspondenceTimeControl(3),
    );
    assert.equal(
      direct.ok,
      role === 'admin',
      'the factory cannot turn live admission into correspondence',
    );
    for (const persisted of [false, true]) {
      for (const occupied of [false, true]) {
        for (const finished of [false, true]) {
          const id = `ffq_corr-${persisted}-${occupied}-${finished}`;
          const events = eventsFor(id, occupied, finished);
          const created = events[0]!;
          assert.equal(created.type, 'room-created');
          if (created.type === 'room-created') created.timeControl = correspondenceTimeControl(3);
          logs.set(id, events);
          if (!persisted) {
            const room = createTenantRuntimeRoomFromEvents(ffqBanqiTenant, events);
            assert.ok(room.ok);
            ffqBanqiRooms.set(id, room.room);
          }
          const socket = await connect(id, headers());
          if (role === 'admin') assertMasked(socket);
          else {
            assert.deepEqual(socket.closes, [[1008, 'game spec disabled']]);
            assert.deepEqual(socket.sent, []);
          }
        }
      }
    }
    const create = await post(
      '/api/rooms',
      { gameSpecId: 'ffq-banqi', mode: 'correspondence', daysPerMove: 3 },
      headers(),
    );
    assert.equal(create.status, 501);
    assert.deepEqual(create.body, { error: 'ffq_banqi_unsupported_surface' });
  });
}

test('FFQ guest casual lobby matches only after launch and never accepts rated or correspondence', async (t) => {
  fixture(t, 'true', null, 'casual');
  const spec = gameSpecForId('ffq-banqi');
  const tc = { initialMs: 180_000, incrementMs: 2_000 };
  const ctx = { ...CTX, lobbyQueue: [], lobbyTickets: new Map() } as HttpApiContext;
  const postSeek = async (_ctx: HttpApiContext, gameSpecId: string, extra: object = {}) =>
    (await post('/api/lobby', { gameSpecId, timeControl: tc, ...extra }, {}, ctx)).body;
  spec.publicSurface = 'casual';
  process.env.MISTBOARD_FFQ_BANQI_ENABLED = 'true';
  const seek = await postSeek(ctx, spec.id);
  assert.equal(seek.status, 'waiting');
  const match = await postSeek(ctx, spec.id);
  assert.equal(match.status, 'matched');
  const room = ffqBanqiRooms.get(match.roomId as string);
  assert.ok(room);
  assert.equal(tenantRoomIsLobbyMatch(room), true);
  assert.equal(room.rated, false);
  assert.equal(room.projection.rated, false);
  const snapshot = tenantSnapshotPayload(ffqBanqiTenant, room, {
    id: 'guest',
    seat: 'spectator',
    solo: false,
  });
  assert.doesNotMatch(JSON.stringify({ seek, match, snapshot }), /"(?:setup|deal|seed)"/);
  assert.equal(ctx.lobbyQueue.length, 0);
  for (const extra of [
    { rated: true },
    { mode: 'correspondence', daysPerMove: 3 },
    { timeControl: { initialMs: 259_200_000, incrementMs: 0, daysPerMove: 3 } },
    { variant: 'banqi' },
  ]) {
    const refused = await postSeek(ctx, spec.id, extra);
    assert.ok(refused.error, JSON.stringify(extra));
    assert.equal(ctx.lobbyQueue.length, 0);
  }
  spec.publicSurface = 'hidden';
  assert.deepEqual(await postSeek(ctx, spec.id), { error: 'ffq_banqi_disabled' });
  spec.publicSurface = 'casual';
  process.env.MISTBOARD_FFQ_BANQI_ENABLED = 'false';
  assert.deepEqual(await postSeek(ctx, spec.id), { error: 'ffq_banqi_disabled' });
});
