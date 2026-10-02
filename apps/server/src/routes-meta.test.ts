import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { beforeEach } from 'node:test';
import { clearPresence, PRESENCE_TTL_MS, touchPresence } from './presence.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/meta.js';
import type { Client, Room } from './server-types.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';

// One shared fake tenant: the registry has no unregister, so tests reuse a
// single registration and reset its mutable contents between tests.
const fakeTenantRooms = new Map<string, TenantManagedRoom>();
let fakeTenantActiveGames = 0;
registerVariantTenant({
  kind: 'test-tenant',
  gameSpecId: 'test-tenant-spec',
  roomIdPrefix: 'ttest_',
  rooms: fakeTenantRooms,
  activeGameCount: () => fakeTenantActiveGames,
} as unknown as VariantTenantRegistration);

function tenantRoom(
  id: string,
  clients: Array<{ id?: string; userId?: string | null; seat?: string }>,
  status: 'playing' | 'waiting' = 'waiting',
): TenantManagedRoom {
  return {
    id,
    clients: clients.map((c) => ({ socket: { close() {}, send() {} }, ...c })),
    projection: { state: { status: { type: status } } },
    pendingWrites: Promise.resolve(),
  };
}

beforeEach(() => {
  clearPresence();
  fakeTenantRooms.clear();
  fakeTenantActiveGames = 0;
});

type ResponseCapture = { body: string; headers: Record<string, string>; status: number | null };

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string>,
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
  return capture as unknown as ServerResponse & ResponseCapture;
}

function getRequest(): IncomingMessage {
  return { method: 'GET', headers: {} } as unknown as IncomingMessage;
}

// Only the bits the live-stats handler reads: a connection identity (id +
// optional userId), a seat, and the room's playing status.
function client(id: string, userId: string | null = null, seat = 'spectator'): Client {
  return { id, userId, seat } as unknown as Client;
}

function room(status: 'playing' | 'waiting', clients: Client[], mode: Room['mode'] = 'pvp'): Room {
  return {
    clients: new Set(clients),
    mode,
    projection: { variant: 'dark-chess', state: { status: { type: status } } },
  } as unknown as Room;
}

function liveStatsContext(rooms: Map<string, Room>): HttpApiContext {
  return { rooms } as unknown as HttpApiContext;
}

type LiveStats = { playing: number; online: number; playingBySpec: Record<string, number> };

async function liveStats(rooms: Map<string, Room>): Promise<LiveStats> {
  const response = captureResponse();
  const handled = await tryHandle(
    liveStatsContext(rooms),
    getRequest(),
    response,
    '/api/live-stats',
    new URL('http://localhost/api/live-stats'),
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  return JSON.parse(response.body) as LiveStats;
}

test('live-stats counts a signed-in user once across multiple rooms/tabs', async () => {
  // Same user (userId "u1") connected from two different rooms, each with its
  // own per-room client id — the inflation this fix targets.
  const rooms = new Map<string, Room>([
    ['a', room('playing', [client('room-a-client', 'u1')])],
    ['b', room('waiting', [client('room-b-client', 'u1')])],
  ]);
  const stats = await liveStats(rooms);
  assert.equal(stats.online, 1);
  assert.equal(stats.playing, 1);
});

test('live-stats counts distinct signed-in users separately', async () => {
  const rooms = new Map<string, Room>([
    ['a', room('playing', [client('ca', 'u1'), client('cb', 'u2')])],
  ]);
  const stats = await liveStats(rooms);
  assert.equal(stats.online, 2);
  assert.equal(stats.playing, 1);
});

test('live-stats dedupes anonymous connections by per-room client id', async () => {
  // Two tabs of the same room share a localStorage client id; a third anon
  // connection in another room is a distinct identity.
  const rooms = new Map<string, Room>([
    ['a', room('playing', [client('anon-room-a'), client('anon-room-a')])],
    ['b', room('waiting', [client('anon-room-b')])],
  ]);
  const stats = await liveStats(rooms);
  assert.equal(stats.online, 2);
});

test('live-stats counts EvE games in the playing tally alongside PvP/PvE', async () => {
  // "games in play" is an activity count, not a "humans playing now" count, so
  // engine-vs-engine games count as live games too. A spectator watching the EvE
  // game is a real human and counts as online.
  const rooms = new Map<string, Room>([
    ['pvp', room('playing', [client('a', 'u1'), client('b', 'u2')], 'pvp')],
    ['pve', room('playing', [client('c', 'u3')], 'pve')],
    ['eve', room('playing', [client('spectator', 'u4')], 'eve')],
  ]);
  const stats = await liveStats(rooms);
  assert.equal(stats.playing, 3); // pvp + pve + eve
  assert.equal(stats.online, 4); // every connected human, spectator included
});

// A room whose status is 'playing' is not automatically a game in play: it
// stays 'playing' while paused and while abandoned, and the reapers cannot claim
// every abandoned room (variant-tenant/reaper-coverage.test.ts). Counting raw
// status put dead rooms on the landing page — prod served "7 games in play"
// against 0 players online and nothing featurable on TV. The count now shares
// the deploy gate's classifier, so all three surfaces agree.
function agedRoom(
  lastEventAgoMs: number,
  options: { paused?: boolean; daysPerMove?: number } = {},
): Room {
  return {
    clients: new Set<Client>(),
    mode: 'pvp',
    events: [{ at: Date.now() - lastEventAgoMs }],
    projection: {
      paused: options.paused ?? false,
      state: { status: { type: 'playing' } },
      timeControl: options.daysPerMove ? { daysPerMove: options.daysPerMove } : null,
    },
  } as unknown as Room;
}

test('live-stats excludes abandoned rooms that no reaper has claimed', async () => {
  const stats = await liveStats(
    new Map<string, Room>([
      ['fresh', agedRoom(5_000)],
      ['abandoned', agedRoom(60 * 60_000)],
    ]),
  );
  assert.equal(stats.playing, 1);
});

test('live-stats excludes paused rooms, which keep status playing', async () => {
  const stats = await liveStats(
    new Map<string, Room>([['paused', agedRoom(5_000, { paused: true })]]),
  );
  assert.equal(stats.playing, 0);
});

test('live-stats counts a quiet correspondence game, which is genuinely in play', async () => {
  // The freshness rule must not reach days-per-move rooms: going hours without
  // an event is how correspondence is played, and filtering on it would
  // undercount every correspondence game on the site.
  const stats = await liveStats(
    new Map<string, Room>([['corr', agedRoom(6 * 60 * 60_000, { daysPerMove: 3 })]]),
  );
  assert.equal(stats.playing, 1);
});

test('live-stats keeps signed-in and anonymous id spaces separate', async () => {
  // A userId and a client id with the same raw string must not collapse.
  const rooms = new Map<string, Room>([
    ['a', room('playing', [client('shared', 'shared'), client('shared')])],
  ]);
  const stats = await liveStats(rooms);
  assert.equal(stats.online, 2);
});

// playingBySpec feeds the homepage's per-variant "N playing": a room counts
// only when it is genuinely in play AND a person holds a seat, so an EvE
// bakeoff room (spectated or not) never makes a variant look busy.
test('live-stats playingBySpec counts in-play rooms with a seated human, per spec', async () => {
  const rooms = new Map<string, Room>([
    ['pvp', room('playing', [client('a', 'u1', 'white'), client('b', 'u2', 'black')], 'pvp')],
    ['guest-pve', room('playing', [client('g1', null, 'white')], 'pve')],
    ['eve', room('playing', [client('watcher', 'u4')], 'eve')],
    ['lobby', room('waiting', [client('w', 'u5', 'white')], 'pvp')],
  ]);
  fakeTenantRooms.set(
    'ttest_1',
    tenantRoom('ttest_1', [{ id: 'tc1', userId: 'u6', seat: 'red' }], 'playing'),
  );
  fakeTenantRooms.set(
    'ttest_2',
    tenantRoom('ttest_2', [{ id: 'tc2', userId: null, seat: 'spectator' }], 'playing'),
  );
  fakeTenantRooms.set('ttest_3', tenantRoom('ttest_3', [], 'playing'));
  const stats = await liveStats(rooms);
  assert.deepEqual(stats.playingBySpec, { 'dark-chess': 2, 'test-tenant-spec': 1 });
  // The headline count is unchanged: every in-play room, EvE included.
  assert.equal(stats.playing, 6);
});

test('live-stats playingBySpec leaves out paused rooms and omits zero entries', async () => {
  const paused = agedRoom(5_000, { paused: true });
  (paused.clients as Set<Client>).add(client('p1', 'u1', 'white'));
  const stats = await liveStats(new Map<string, Room>([['paused', paused]]));
  assert.deepEqual(stats.playingBySpec, {});
});

// ── /api/play/variant-order ─────────────────────────────────────────────────

test('play/variant-order returns an empty order without a database', async () => {
  const response = captureResponse();
  const handled = await tryHandle(
    liveStatsContext(new Map()),
    getRequest(),
    response,
    '/api/play/variant-order',
    new URL('http://localhost/api/play/variant-order'),
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as {
    order: string[];
    windowDays: number;
    computedAt: string;
  };
  assert.deepEqual(body.order, []);
  assert.equal(body.windowDays, 28);
  assert.ok(!Number.isNaN(Date.parse(body.computedAt)));
});

// ── /api/players/online ─────────────────────────────────────────────────────

type OnlinePlayers = {
  players: Array<{
    handle: string;
    displayName: string;
    rating: { variant: string; eloRating: number; provisional: boolean } | null;
    playing: boolean;
  }>;
  count: number;
  anonymousOnline: number;
};

async function onlinePlayers(rooms: Map<string, Room> = new Map()): Promise<OnlinePlayers> {
  const response = captureResponse();
  const handled = await tryHandle(
    liveStatsContext(rooms),
    getRequest(),
    response,
    '/api/players/online',
    new URL('http://localhost/api/players/online'),
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  return JSON.parse(response.body) as OnlinePlayers;
}

function presenceUser(
  id: string,
  handle: string,
  profileVisibility: 'public' | 'unlisted' | 'private' = 'public',
) {
  return { id, handle, displayName: handle, profileVisibility };
}

test('players/online lists recently seen users sorted by handle', async () => {
  clearPresence();
  touchPresence(presenceUser('u1', 'zoe'));
  touchPresence(presenceUser('u2', 'amir'));
  const result = await onlinePlayers();
  assert.deepEqual(
    result.players.map((p) => p.handle),
    ['amir', 'zoe'],
  );
  assert.equal(result.count, 2);
  // Without persistence there is no rating lookup; the field is still present.
  assert.equal(result.players[0]!.rating, null);
});

test('players/online drops users past the presence TTL', async () => {
  clearPresence();
  touchPresence(presenceUser('u1', 'stale'), Date.now() - PRESENCE_TTL_MS - 1_000);
  touchPresence(presenceUser('u2', 'fresh'));
  const result = await onlinePlayers();
  assert.deepEqual(
    result.players.map((p) => p.handle),
    ['fresh'],
  );
});

test('players/online hides private profiles but counts them nowhere', async () => {
  clearPresence();
  touchPresence(presenceUser('u1', 'hidden', 'private'));
  touchPresence(presenceUser('u2', 'listed', 'unlisted'));
  const result = await onlinePlayers();
  assert.deepEqual(
    result.players.map((p) => p.handle),
    ['listed'],
  );
  assert.equal(result.count, 1);
});

test('players/online keeps a silent open-socket player listed past the TTL', async () => {
  // A player mid-game holds a WebSocket but may make no authed HTTP request
  // for longer than the TTL. Their live room connection must refresh presence.
  clearPresence();
  touchPresence(presenceUser('u1', 'marathoner'), Date.now() - PRESENCE_TTL_MS - 1_000);
  const rooms = new Map<string, Room>([['a', room('playing', [client('c1', 'u1')])]]);
  const result = await onlinePlayers(rooms);
  assert.deepEqual(
    result.players.map((p) => p.handle),
    ['marathoner'],
  );
});

test('players/online refreshes connections in variant-tenant rooms too', async () => {
  touchPresence(presenceUser('u1', 'tenant-player'), Date.now() - PRESENCE_TTL_MS - 1_000);
  fakeTenantRooms.set('ttest_1', tenantRoom('ttest_1', [{ id: 'tc1', userId: 'u1' }]));
  const result = await onlinePlayers();
  assert.deepEqual(
    result.players.map((p) => p.handle),
    ['tenant-player'],
  );
});

test('live-stats counts tenant rooms in both online and playing', async () => {
  // Legacy: one playing PvP room with an anonymous client. Tenant: one playing
  // room (activeGameCount) holding a signed-in player and a second anonymous
  // spectator. Before the tenant walk, online was 1 and playing was 1.
  const rooms = new Map<string, Room>([['a', room('playing', [client('anon-legacy')])]]);
  fakeTenantActiveGames = 1;
  fakeTenantRooms.set(
    'ttest_1',
    tenantRoom(
      'ttest_1',
      [
        { id: 'tc1', userId: 'u5', seat: 'red' },
        { id: 'tc2', userId: null, seat: 'spectator' },
      ],
      'playing',
    ),
  );
  const stats = await liveStats(rooms);
  assert.equal(stats.online, 3, 'legacy anon + tenant account + tenant anon');
  assert.equal(stats.playing, 2, 'legacy playing room + tenant active game');
});

test('players/online reports playing seats and the anonymous count', async () => {
  touchPresence(presenceUser('u1', 'alpha'));
  touchPresence(presenceUser('u2', 'beta'));
  // alpha holds a color seat in a playing legacy room; beta only spectates a
  // playing tenant room; one anonymous connection sits in each map.
  const rooms = new Map<string, Room>([
    ['a', room('playing', [client('c1', 'u1', 'white'), client('g1')])],
  ]);
  fakeTenantRooms.set(
    'ttest_1',
    tenantRoom(
      'ttest_1',
      [
        { id: 'tc1', userId: 'u2', seat: 'spectator' },
        { id: 'tc2', userId: null, seat: 'spectator' },
      ],
      'playing',
    ),
  );
  const result = await onlinePlayers(rooms);
  const byHandle = new Map(result.players.map((p) => [p.handle, p]));
  assert.equal(byHandle.get('alpha')?.playing, true, 'seated in a playing room');
  assert.equal(byHandle.get('beta')?.playing, false, 'spectating is not playing');
  assert.equal(result.anonymousOnline, 2, 'one legacy + one tenant anonymous connection');
});

// The status route reads the broadcast viewer census off the context the way
// it reads activeGames: a context built without it (tests, tools) reports
// null rather than a fabricated zero.
test('server-status reports the broadcast viewer census from the context', async () => {
  const ctx = {
    rooms: new Map(),
    drainDeadlineMs: () => null,
    activeGameCount: () => 0,
    broadcastViewers: () => ({ current: 2, peakToday: 5, peakSinceBoot: 9 }),
  } as unknown as HttpApiContext;
  const response = captureResponse();
  const handled = await tryHandle(
    ctx,
    getRequest(),
    response,
    '/api/server-status',
    new URL('http://localhost/api/server-status'),
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as { broadcastViewers: unknown; activeGames: number };
  assert.deepEqual(body.broadcastViewers, { current: 2, peakToday: 5, peakSinceBoot: 9 });
  assert.equal(body.activeGames, 0);

  const bare = captureResponse();
  await tryHandle(
    {
      rooms: new Map(),
      drainDeadlineMs: () => null,
      activeGameCount: () => 0,
    } as unknown as HttpApiContext,
    getRequest(),
    bare,
    '/api/server-status',
    new URL('http://localhost/api/server-status'),
  );
  assert.equal((JSON.parse(bare.body) as { broadcastViewers: unknown }).broadcastViewers, null);
});
