import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { createFFQBanqiDeal, type FFQBanqiPlayerView } from '@mistboard/game';
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
import { createTenantRuntimeRoomFromEvents, replayTenantEvents } from './variant-tenant/runtime.js';
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

function fixture(t: TestContext, flag: string | undefined, role: 'player' | 'admin' | null) {
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
  return { logs, reads, headers, admitted: flag === 'true' && role === 'admin' };
}

class Socket {
  sent: Record<string, unknown>[] = [];
  closes: unknown[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string) {
    this.closes.push([code, reason]);
  }
  on() {
    return this;
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

for (const flag of [undefined, 'false', 'true']) {
  for (const role of [null, 'player', 'admin'] as const) {
    test(`FFQ creation and connection matrix: flag=${flag}, account=${role ?? 'guest'}`, async (t) => {
      const { admitted, headers, logs, reads } = fixture(t, flag, role);
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
        const lobby = await post('/api/lobby', selectors, headers(), refusedCtx);
        assert.equal(lobby.status, admitted ? 501 : 404);
        assert.deepEqual(lobby.body, {
          error: admitted ? 'ffq_banqi_unsupported_surface' : 'ffq_banqi_disabled',
        });
      }
      const direct = await createFFQBanqiRoom(role ? { accountRole: role } : null);
      assert.equal(direct.ok, admitted, 'the factory itself also enforces policy');
      for (const selectors of CONFLICTS) {
        for (const path of ['/api/rooms', '/api/lobby'] as const) {
          const result = await post(path, selectors, headers(), refusedCtx);
          assert.equal(result.status, admitted && path === '/api/lobby' ? 501 : 404);
          assert.equal(
            result.body.error,
            !admitted
              ? 'ffq_banqi_disabled'
              : path === '/api/lobby'
                ? 'ffq_banqi_unsupported_surface'
                : 'unknown_game_spec',
          );
        }
      }
      for (const surface of [
        { mode: 'pve' },
        { rated: true },
        { engineId: 'anything' },
        { botId: 'misty' },
      ]) {
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
