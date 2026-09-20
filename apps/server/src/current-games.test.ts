import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { beforeEach } from 'node:test';
import { GAME_SPECS } from '@mistboard/game';
import {
  type CurrentGame,
  collectCurrentGames,
  currentGameBoardPayload,
  sortCurrentGames,
  timeClassFor,
} from './current-games.js';
import { DEPLOY_GATE_IDLE_MS } from './deploy-gate.js';
import { tryHandle } from './routes/current-games.js';
import type { HttpApiContext } from './routes/lib.js';
import { liveObservePolicy } from './server-policy.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';
import { registerLiveWatchPayloadBuilder } from './watch-live.js';

// ---------------------------------------------------------------------------
// Fake tenants, one per visibility class (watch-live.test.ts pattern: the
// registry has no unregister, so register once and reset the room maps per
// test). No real registrations are loaded, so the registry holds exactly these.
// ---------------------------------------------------------------------------

const FAKE_ENGINE_PREFIX = 'fake-engine-';
const openRooms = new Map<string, TenantManagedRoom>();
const fogRooms = new Map<string, TenantManagedRoom>();
const hiddenRooms = new Map<string, TenantManagedRoom>();

function fakeRegistration(args: {
  kind: string;
  gameSpecId: string;
  channelId: string;
  roomIdPrefix: string;
  rooms: Map<string, TenantManagedRoom>;
}): VariantTenantRegistration {
  return {
    kind: args.kind,
    gameSpecId: args.gameSpecId,
    roomIdPrefix: args.roomIdPrefix,
    watch: {
      channelId: args.channelId,
      family: 'xiangqi',
      label: args.kind,
      legacyVariants: [args.channelId],
    },
    isEngineClientId: (clientId: string | undefined) =>
      clientId?.startsWith(FAKE_ENGINE_PREFIX) ?? false,
    engineDisplayName: (clientId: string) => `Engine ${clientId.slice(FAKE_ENGINE_PREFIX.length)}`,
    enabled: () => true,
    rooms: args.rooms,
    activeGameCount: () => 0,
  } as unknown as VariantTenantRegistration;
}

registerVariantTenant(
  fakeRegistration({
    channelId: 'xiangqi',
    gameSpecId: 'xiangqi',
    kind: 'fake-open',
    roomIdPrefix: 'fko_',
    rooms: openRooms,
  }),
);
registerVariantTenant(
  fakeRegistration({
    channelId: 'dark-xiangqi',
    gameSpecId: 'dark-xiangqi',
    kind: 'fake-fog',
    roomIdPrefix: 'fkf_',
    rooms: fogRooms,
  }),
);
registerVariantTenant(
  fakeRegistration({
    channelId: 'jieqi',
    gameSpecId: 'jieqi',
    kind: 'fake-hidden',
    roomIdPrefix: 'fkh_',
    rooms: hiddenRooms,
  }),
);

// Every fake channel gets a builder, including fog, so the tests below prove
// the VISIBILITY policy is what withholds the board (and, for a classified
// hidden-identity spec, what releases the builder's masked one).
const BOARD_MARKER = 'position-would-leak-here';
for (const channelId of ['xiangqi', 'dark-xiangqi', 'jieqi']) {
  registerLiveWatchPayloadBuilder(channelId, async (roomId) => ({
    game: { roomId, result: 'in-progress' },
    view: { board: BOARD_MARKER },
  }));
}

const NOW = 1_800_000_000_000;
const LIVE_TC = { initialMs: 180_000, incrementMs: 2_000 };
const CORR_TC = { initialMs: 86_400_000, incrementMs: 0, daysPerMove: 1 };

function tenantRoom(args: {
  id: string;
  status?: 'playing' | 'finished' | 'waiting';
  seats?: Record<string, string>;
  lastEventAt?: number;
  moveNumber?: number;
  timeControl?: { initialMs: number; incrementMs: number; daysPerMove?: number };
  clock?: unknown;
  paused?: boolean;
}): TenantManagedRoom {
  const lastEventAt = args.lastEventAt ?? NOW - 1_000;
  return {
    id: args.id,
    clients: [],
    events: [
      { type: 'room-created', at: lastEventAt - 60_000 },
      { type: 'move-played', at: lastEventAt },
    ],
    projection: {
      state: { status: { type: args.status ?? 'playing' }, moveNumber: args.moveNumber ?? 4 },
      seats: args.seats ?? { black: 'client-b', red: 'client-a' },
      rated: false,
      timeControl: args.timeControl ?? LIVE_TC,
      ...(args.clock !== undefined ? { clock: args.clock } : {}),
      ...(args.paused ? { paused: true } : {}),
    } as TenantManagedRoom['projection'],
    seatTokens: {
      red: { userDisplayName: 'Ada', userHandle: 'ada', userId: 'user-a' },
    },
    pendingWrites: Promise.resolve(),
  };
}

function context(): HttpApiContext {
  return { rooms: new Map() } as unknown as HttpApiContext;
}

type ResponseCapture = { body: string; status: number | null };

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    status: null as number | null,
    setHeader() {
      return capture;
    },
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}

async function getCurrent(query = ''): Promise<{
  status: number | null;
  payload: {
    games: Array<CurrentGame & { payload?: unknown }>;
    total: number;
    channels: unknown[];
  };
}> {
  const response = captureResponse();
  const url = `/api/games/current${query}`;
  const handled = await tryHandle(
    context(),
    { method: 'GET', url, headers: {} } as unknown as IncomingMessage,
    response,
    '/api/games/current',
    new URL(url, 'http://localhost'),
  );
  assert.equal(handled, true);
  return { payload: JSON.parse(response.body), status: response.status };
}

beforeEach(() => {
  openRooms.clear();
  fogRooms.clear();
  hiddenRooms.clear();
});

// ---------------------------------------------------------------------------
// The hidden-information boundary. This is the test that matters.
// ---------------------------------------------------------------------------

test('observe follows liveObservePolicy for every spec, and only open games may carry a board', () => {
  // Exhaustive over the registry: a new visibility class fails the switch at
  // compile time, a new spec lands here automatically.
  for (const spec of GAME_SPECS) {
    const policy = liveObservePolicy(spec.visibility, spec.id);
    if (spec.visibility === 'dark') assert.equal(policy, 'sealed', `${spec.id} is fog`);
    if (spec.visibility === 'open') assert.equal(policy, 'open', `${spec.id} is open`);
  }
});

test('a fog game is listed as a card and never carries a board payload', async () => {
  fogRooms.set(
    'fkf_1',
    tenantRoom({
      id: 'fkf_1',
      clock: {
        activeColor: 'red',
        remainingMs: { red: 100_000, black: 90_000 },
        runningSince: NOW - 5_000,
      },
    }),
  );
  const listed = collectCurrentGames(context(), NOW);
  assert.equal(listed.length, 1);
  const game = listed[0]!;
  assert.equal(game.observe, 'sealed');
  assert.equal(game.gameSpecId, 'dark-xiangqi');
  // What both players already know is fine to show: names, move count, clocks.
  assert.equal(game.ply, 4);
  assert.equal(game.players.length, 2);
  assert.equal(game.clock?.remainingMs.red, 95_000);
  assert.equal(await currentGameBoardPayload(game), null);
  const { payload } = await getCurrent();
  assert.equal(payload.games.length, 1);
  assert.equal('payload' in payload.games[0]!, false);
  assert.equal(JSON.stringify(payload).includes(BOARD_MARKER), false);
});

// Jieqi is asymmetric hidden-identity, but it has a purpose-built public view
// (getJieqiPublicView) and is classified 'open' since 2026-09-20, so it lists
// WITH a board: the one its registered live builder masks, nothing hand-rolled.
test('a classified hidden-identity game is open: listed with its builder board', async () => {
  hiddenRooms.set('fkh_1', tenantRoom({ id: 'fkh_1' }));
  const listed = collectCurrentGames(context(), NOW);
  assert.equal(listed[0]?.observe, 'open');
  assert.ok(await currentGameBoardPayload(listed[0]!), 'the builder payload is served');
  const { payload } = await getCurrent();
  assert.equal(JSON.stringify(payload).includes(BOARD_MARKER), true);
});

// An unclassified hidden-identity spec has no public view and fails closed.
test('an unclassified hidden-identity spec stays masked', () => {
  assert.equal(liveObservePolicy('hidden-identity', 'not-a-real-spec'), 'masked');
});

test('an open game carries its board payload, omitted when the client already has that ply', async () => {
  openRooms.set('fko_1', tenantRoom({ id: 'fko_1', moveNumber: 7 }));
  const listed = collectCurrentGames(context(), NOW);
  assert.equal(listed[0]?.observe, 'open');
  const first = await getCurrent();
  assert.equal(first.status, 200);
  assert.equal(first.payload.games.length, 1);
  assert.ok(first.payload.games[0]!.payload, 'open game should carry a payload');
  const known = await getCurrent('?known=fko_1:7');
  assert.equal('payload' in known.payload.games[0]!, false);
  const stale = await getCurrent('?known=fko_1:5');
  assert.ok(stale.payload.games[0]!.payload, 'a stale known ply refreshes the payload');
});

// ---------------------------------------------------------------------------
// Which rooms count as "in progress".
// ---------------------------------------------------------------------------

test('finished, waiting, paused, engine-only and abandoned rooms are not listed', () => {
  openRooms.set('fko_done', tenantRoom({ id: 'fko_done', status: 'finished' }));
  openRooms.set('fko_wait', tenantRoom({ id: 'fko_wait', status: 'waiting' }));
  openRooms.set('fko_paused', tenantRoom({ id: 'fko_paused', paused: true }));
  openRooms.set(
    'fko_eve',
    tenantRoom({
      id: 'fko_eve',
      seats: { black: `${FAKE_ENGINE_PREFIX}b`, red: `${FAKE_ENGINE_PREFIX}a` },
    }),
  );
  openRooms.set(
    'fko_idle',
    tenantRoom({ id: 'fko_idle', lastEventAt: NOW - DEPLOY_GATE_IDLE_MS - 1 }),
  );
  openRooms.set('fko_live', tenantRoom({ id: 'fko_live' }));
  const listed = collectCurrentGames(context(), NOW);
  assert.deepEqual(
    listed.map((game) => game.roomId),
    ['fko_live'],
  );
});

test('a dormant correspondence game IS listed, with its class and deadline', () => {
  const dueAt = new Date(NOW + 20 * 3_600_000);
  openRooms.set(
    'fko_corr',
    tenantRoom({ id: 'fko_corr', lastEventAt: NOW - 2 * 86_400_000, timeControl: CORR_TC }),
  );
  const listed = collectCurrentGames(
    context(),
    NOW,
    new Map([['fko_corr', { seat: 'black', dueAt }]]),
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.timeClass, 'correspondence');
  assert.deepEqual(listed[0]?.deadline, { seat: 'black', dueAt: dueAt.toISOString() });
  assert.equal(listed[0]?.timeControl?.daysPerMove, 1);
});

test('engine seats are labelled through the tenant display name, PvE composition', () => {
  openRooms.set(
    'fko_pve',
    tenantRoom({ id: 'fko_pve', seats: { black: `${FAKE_ENGINE_PREFIX}l4`, red: 'client-a' } }),
  );
  const [game] = collectCurrentGames(context(), NOW);
  assert.equal(game?.composition, 'pve');
  const engine = game?.players.find((player) => player.isEngine);
  assert.equal(engine?.name, 'Engine l4');
  assert.equal(engine?.handle, null);
  const human = game?.players.find((player) => !player.isEngine);
  assert.equal(human?.name, 'Ada');
  assert.equal(human?.handle, 'ada');
});

// ---------------------------------------------------------------------------
// Classification and ordering.
// ---------------------------------------------------------------------------

test('timeClassFor decides correspondence by daysPerMove, never by the ms value', () => {
  assert.equal(timeClassFor(CORR_TC), 'correspondence');
  assert.equal(timeClassFor({ initialMs: 86_400_000, incrementMs: 0 }), 'classical');
  assert.equal(timeClassFor({ initialMs: 180_000, incrementMs: 2_000 }), 'blitz');
  assert.equal(timeClassFor({ initialMs: 60_000, incrementMs: 1_000 }), 'bullet');
  assert.equal(timeClassFor(null), null);
});

test('live human games lead, then live engine games, then correspondence by soonest deadline', () => {
  const base = (over: Partial<CurrentGame>): CurrentGame => ({
    channelId: 'xiangqi',
    clock: null,
    composition: 'pvp',
    deadline: null,
    gameSpecId: 'xiangqi',
    lastActivityAt: NOW,
    observe: 'open',
    players: [],
    ply: 3,
    rated: false,
    roomId: 'x',
    startedAt: null,
    timeClass: 'blitz',
    timeControl: LIVE_TC,
    url: '/room/x',
    ...over,
  });
  const sorted = sortCurrentGames([
    base({
      roomId: 'corr-late',
      timeClass: 'correspondence',
      deadline: { seat: 'red', dueAt: new Date(NOW + 2 * 86_400_000).toISOString() },
    }),
    base({ roomId: 'pve-old', composition: 'pve', lastActivityAt: NOW - 50_000 }),
    base({
      roomId: 'corr-soon',
      timeClass: 'correspondence',
      deadline: { seat: 'red', dueAt: new Date(NOW + 3_600_000).toISOString() },
    }),
    base({ roomId: 'pvp-old', lastActivityAt: NOW - 10_000 }),
    base({ roomId: 'pvp-new' }),
    base({ roomId: 'pve-new', composition: 'pve' }),
  ]);
  assert.deepEqual(
    sorted.map((game) => game.roomId),
    ['pvp-new', 'pvp-old', 'pve-new', 'pve-old', 'corr-soon', 'corr-late'],
  );
});

// ---------------------------------------------------------------------------
// Route shape.
// ---------------------------------------------------------------------------

test('the route filters by channel, counts per channel, and 404s unknown channels', async () => {
  openRooms.set('fko_1', tenantRoom({ id: 'fko_1' }));
  fogRooms.set('fkf_1', tenantRoom({ id: 'fkf_1' }));
  const all = await getCurrent();
  assert.equal(all.payload.total, 2);
  assert.equal(all.payload.games.length, 2);
  const counts = Object.fromEntries(
    (all.payload.channels as Array<{ id: string; count: number }>).map((c) => [c.id, c.count]),
  );
  assert.equal(counts.xiangqi, 1);
  assert.equal(counts['dark-xiangqi'], 1);
  const one = await getCurrent('?channel=xiangqi');
  assert.deepEqual(
    one.payload.games.map((game) => game.roomId),
    ['fko_1'],
  );
  assert.equal(one.payload.total, 2, 'total stays site-wide so the rail can show it');
  const missing = await getCurrent('?channel=no-such-channel');
  assert.equal(missing.status, 404);
});
