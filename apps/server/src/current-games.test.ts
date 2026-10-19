import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test, { beforeEach } from 'node:test';
import { GAME_SPECS } from '@mistboard/game';
import {
  type CurrentGame,
  collectCurrentGames,
  currentGameBoardPayload,
  isStaleLiveGame,
  LIVE_STALE_AFTER_MS,
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
      clientId === 'pikafish-jieqi-strongest' ||
      (clientId?.startsWith(FAKE_ENGINE_PREFIX) ?? false),
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
  pveBotId?: string;
}): TenantManagedRoom {
  const lastEventAt = args.lastEventAt ?? NOW - 1_000;
  return {
    id: args.id,
    clients: [],
    ...(args.pveBotId ? { pveBotId: args.pveBotId } : {}),
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

// #469: a player who starts a new bot game without resigning the old one left
// the old one listed until its clock flagged (prod 2026-09-27: five jieqi vs
// Pikafish games listed, three of them abandoned). Inside the deploy gate's 10
// minutes, a live game with no move for its class's window is hidden.
test('a live bot game with no move for its time-class window is hidden, not ended (#469)', () => {
  const RAPID_TC = { initialMs: 600_000, incrementMs: 5_000 };
  const engineSeats = { black: `${FAKE_ENGINE_PREFIX}b`, red: 'client-a' };
  const runningClock = {
    activeColor: 'red',
    remainingMs: { red: 300_000, black: 590_000 },
    runningSince: NOW - 3 * 60_000,
  };
  // Blitz (3+2), 3 min since the bot's reply: past the 2-min window, inside the
  // deploy gate's 10, clock still running toward the flag.
  hiddenRooms.set(
    'fkh_abandoned',
    tenantRoom({
      id: 'fkh_abandoned',
      seats: engineSeats,
      lastEventAt: NOW - 3 * 60_000,
      clock: runningClock,
    }),
  );
  // Rapid (10+5), same 3 min: a player thinking, still listed.
  hiddenRooms.set(
    'fkh_thinking',
    tenantRoom({
      id: 'fkh_thinking',
      seats: engineSeats,
      lastEventAt: NOW - 3 * 60_000,
      timeControl: RAPID_TC,
      clock: runningClock,
    }),
  );
  // Rapid, 6 min: past the 5-min window.
  hiddenRooms.set(
    'fkh_rapid_gone',
    tenantRoom({
      id: 'fkh_rapid_gone',
      seats: engineSeats,
      lastEventAt: NOW - 6 * 60_000,
      timeControl: RAPID_TC,
    }),
  );
  // A reconnect or seat event is not a move: it does not keep a game fresh.
  const reconnected = tenantRoom({
    id: 'fkh_reconnected',
    seats: engineSeats,
    lastEventAt: NOW - 3 * 60_000,
  });
  (reconnected.events as Array<{ type: string; at: number }>).push({
    type: 'client-connected',
    at: NOW - 1_000,
  });
  hiddenRooms.set('fkh_reconnected', reconnected);
  // PvP follows the same rule.
  openRooms.set('fko_pvp_gone', tenantRoom({ id: 'fko_pvp_gone', lastEventAt: NOW - 3 * 60_000 }));
  hiddenRooms.set('fkh_fresh', tenantRoom({ id: 'fkh_fresh', seats: engineSeats }));

  assert.deepEqual(
    collectCurrentGames(context(), NOW)
      .map((game) => game.roomId)
      .sort(),
    ['fkh_fresh', 'fkh_thinking'],
  );
  // The game itself is untouched, and its next move lists it again.
  const abandoned = hiddenRooms.get('fkh_abandoned')!;
  assert.equal(abandoned.projection?.state.status.type, 'playing');
  (abandoned.events as Array<{ type: string; at: number }>).push({
    type: 'move-played',
    at: NOW - 500,
  });
  assert.ok(collectCurrentGames(context(), NOW).some((game) => game.roomId === 'fkh_abandoned'));
});

test('isStaleLiveGame: window by time class, correspondence never stale', () => {
  assert.equal(isStaleLiveGame('blitz', NOW - LIVE_STALE_AFTER_MS.blitz, NOW), false);
  assert.equal(isStaleLiveGame('blitz', NOW - LIVE_STALE_AFTER_MS.blitz - 1, NOW), true);
  assert.equal(isStaleLiveGame('bullet', NOW - 61_000, NOW), true);
  assert.equal(isStaleLiveGame('rapid', NOW - 4 * 60_000, NOW), false);
  assert.equal(isStaleLiveGame('classical', NOW - 7 * 60_000, NOW), false);
  assert.equal(isStaleLiveGame(null, NOW - 9 * 60_000, NOW), true);
  assert.equal(isStaleLiveGame('correspondence', NOW - 30 * 86_400_000, NOW), false);
  assert.equal(isStaleLiveGame('blitz', null, NOW), false);
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

// A dormant correspondence game (hydrated from room_deadlines, nobody
// connected) is an in-progress game like any other: an open one carries its
// builder board, so /games draws it instead of the grey placeholder. Verified
// live on 2026-10-02 against a real 3-days-per-move xiangqi game after a
// server restart.
test('a dormant open correspondence game carries its builder board', async () => {
  openRooms.set(
    'fko_corr',
    tenantRoom({ id: 'fko_corr', lastEventAt: NOW - 2 * 86_400_000, timeControl: CORR_TC }),
  );
  const [game] = collectCurrentGames(context(), NOW);
  assert.equal(game?.timeClass, 'correspondence');
  assert.equal(game?.observe, 'open');
  assert.ok(await currentGameBoardPayload(game!), 'the builder payload is served');
  const { payload } = await getCurrent();
  assert.equal(payload.games[0]?.timeClass, 'correspondence');
  assert.ok(payload.games[0]?.payload, 'the route attaches it');
});

// The correspondence path must not open a side door around the fog: a
// days-per-move fog game is sealed and carries nothing, through the route too.
test('a dormant fog correspondence game stays a card with no board', async () => {
  fogRooms.set(
    'fkf_corr',
    tenantRoom({ id: 'fkf_corr', lastEventAt: NOW - 2 * 86_400_000, timeControl: CORR_TC }),
  );
  const [game] = collectCurrentGames(context(), NOW);
  assert.equal(game?.timeClass, 'correspondence');
  assert.equal(game?.observe, 'sealed');
  assert.equal(await currentGameBoardPayload(game!), null);
  const { payload } = await getCurrent();
  assert.equal('payload' in payload.games[0]!, false);
  assert.equal(JSON.stringify(payload).includes(BOARD_MARKER), false);
});

test('a Fog Chess correspondence game never gets a board, even mislabelled open', async () => {
  const fogChess: CurrentGame = {
    channelId: 'dark-xiangqi',
    clock: null,
    composition: 'pvp',
    deadline: { dueAt: new Date(NOW + 86_400_000).toISOString(), seat: 'white' },
    gameSpecId: 'dark-chess',
    lastActivityAt: NOW - 86_400_000,
    observe: 'sealed',
    players: [],
    ply: 9,
    rated: false,
    roomId: 'fog-corr',
    startedAt: NOW - 3 * 86_400_000,
    timeClass: 'correspondence',
    timeControl: { daysPerMove: 7, incrementMs: 0, initialMs: 7 * 86_400_000 },
    url: '/room/fog-corr',
  };
  assert.equal(await currentGameBoardPayload(fogChess), null);
  // canServeLiveBoard re-checks the spec, so a wrong observe label still serves nothing.
  assert.equal(await currentGameBoardPayload({ ...fogChess, observe: 'open' }), null);
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

test('current games keep the Jieqi Pikafish Level 8 label and shared profile link', () => {
  for (const pveBotId of [undefined, 'pikafish', 'pika-jieqi-strongest']) {
    hiddenRooms.set(
      'fkh_level8',
      tenantRoom({
        id: 'fkh_level8',
        seats: { black: 'pikafish-jieqi-strongest', red: 'client-a' },
        pveBotId,
      }),
    );
    const [game] = collectCurrentGames(context(), NOW);
    const engineSeat = game?.players.find((player) => player.isEngine);
    assert.equal(engineSeat?.name, 'Pikafish Level 8');
    assert.equal(engineSeat?.botId, 'pikafish');
  }
});

test('an engine seat fronted by a first-party bot is named after the bot, as the room names it', () => {
  // The room wire resolves the bot profile first; the tile used to resolve the
  // tier name only, so one game read "Pikafish" in the room and
  // "PikaJieQi - Strongest" on /games.
  openRooms.set(
    'fko_bot',
    tenantRoom({
      id: 'fko_bot',
      seats: { black: `${FAKE_ENGINE_PREFIX}strongest`, red: 'client-a' },
      pveBotId: 'pikafish',
    }),
  );
  const [game] = collectCurrentGames(context(), NOW);
  const engine = game?.players.find((player) => player.isEngine);
  assert.equal(engine?.name, 'Pikafish');
  assert.equal(engine?.botId, 'pikafish');
  openRooms.delete('fko_bot');
});

// A chess-stack room seats the engine under its build id. The tile showed that
// id ("python-v2-v1.6") where the room shows "Misty", because only the tenant
// path went through the bot table.
function chessRoomContext(pveBotId?: string): HttpApiContext {
  const room = {
    id: 'fog_chess_pve',
    gameSpecId: 'dark-chess',
    rated: false,
    timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    events: [{ type: 'move-played', at: NOW - 2_000 }],
    projection: {
      state: { status: { type: 'playing' }, moveNumber: 35 },
      seats: { white: 'python-v2-v1.6', black: 'client-guest' },
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    },
    seatTokens: {},
    ...(pveBotId ? { pveBotId } : {}),
  };
  return { rooms: new Map([[room.id, room]]) } as unknown as HttpApiContext;
}

test('a chess-stack engine seat is named after the bot that fronts it, not its build id', () => {
  for (const pveBotId of [undefined, 'misty']) {
    const [game] = collectCurrentGames(chessRoomContext(pveBotId), NOW);
    const engine = game?.players.find((player) => player.isEngine);
    assert.equal(engine?.name, 'Misty', `pveBotId=${pveBotId}`);
    assert.equal(engine?.botId, 'misty', `pveBotId=${pveBotId}`);
  }
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
