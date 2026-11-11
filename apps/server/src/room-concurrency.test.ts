import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { GameEvent, Move } from '@mistboard/game';
import { type DarkChessTenantEvent, darkChessTenant } from './dark-chess-tenant.js';
import * as persistence from './persistence.js';
import { getPool } from './persistence-db.js';
import { hydrateRoomOnce } from './room-hydration.js';
import { appendEvent, pauseRoomOnShutdown, resumeRoom } from './room-manager.js';
import { createRoomLifecycle, type RoomLifecycleConfig } from './server-room-lifecycle.js';
import type { Room } from './server-types.js';
import { roomFixture } from './test-builders.js';
import { appendTenantEvent } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
  tenantResumeEventFor,
} from './variant-tenant/runtime.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Keep the reducers, hydrators and event writers real; hold only a database
// read or insert so each race is deterministic without a Postgres process.
function database(t: TestContext, events: persistence.PersistedRoomEvent[]) {
  persistence.init('postgres://unused/unused');
  t.after(() => persistence.close());
  const pool = getPool();
  const entered = gate();
  const held = gate();
  t.after(held.release);
  let hold: 'load' | 'move' | undefined;
  let reads = 0;
  let tokenReads = 0;
  const writes: persistence.PersistedRoomEvent[] = [];
  t.mock.method(pool, 'query', (async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT payload FROM events')) {
      reads += 1;
      const rows = events.map((payload) => ({ payload }));
      if (hold === 'load') {
        entered.release();
        await held.promise;
      }
      return { rows };
    }
    if (sql.includes('FROM room_seat_tokens')) tokenReads += 1;
    if (sql.startsWith('INSERT INTO events')) {
      const event = values[3] as persistence.PersistedRoomEvent;
      if (hold === 'move' && event.type === 'move-played') {
        entered.release();
        await held.promise;
      }
      assert.equal(values[1], events.length, 'one contiguous durable event chain');
      events.push(event);
      writes.push(event);
    }
    return { rows: [], rowCount: 0 };
  }) as typeof pool.query);
  return {
    entered: entered.promise,
    release: held.release,
    hold: (kind: typeof hold) => {
      hold = kind;
    },
    counts: () => ({ reads, tokenReads }),
    writes,
  };
}

function tenantEvents(roomId: string): DarkChessTenantEvent[] {
  return [
    {
      type: 'room-created',
      at: 100,
      roomId,
      gameSpecId: 'dark-chess',
      timeControl: { initialMs: 60_000, incrementMs: 2_000 },
    },
    { type: 'seat-assigned', at: 101, roomId, clientId: 'white-client', seat: 'white' },
    { type: 'seat-assigned', at: 102, roomId, clientId: 'black-client', seat: 'black' },
    { type: 'move-played', at: 200, roomId, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: 300, roomId, color: 'black', move: { from: 'e7', to: 'e5' } },
    {
      type: 'clock-started',
      at: 1_000,
      roomId,
      clock: {
        initialMs: 60_000,
        incrementMs: 2_000,
        remainingMs: { white: 60_000, black: 60_000 },
        activeColor: 'white',
        runningSince: 1_000,
      },
    },
  ];
}

function legacyEvents(roomId: string): GameEvent[] {
  return tenantEvents(roomId).map((event) =>
    event.type === 'room-created' ? { ...event, variant: 'dark-chess' as const } : event,
  ) as GameEvent[];
}

function tenantRoom(roomId: string) {
  const hydrated = createTenantRuntimeRoomFromEvents(darkChessTenant, tenantEvents(roomId));
  assert.ok(hydrated.ok);
  return hydrated.room;
}

function lifecycle(rooms = new Map<string, Room>(), overrides: Partial<RoomLifecycleConfig> = {}) {
  const config: RoomLifecycleConfig = {
    rooms,
    roomMgrCtx: {
      send() {},
      recordPersistenceError() {},
      pveBuiltinEngineClientId: 'builtin-random-legal',
      pveEngineMoveDelayMs: 0,
      liveEngineTimeoutMs: 1_000,
      liveClockInitialMs: 60_000,
      liveClockIncrementMs: 2_000,
    },
    defaultRoomRegion: 'global',
    orphanThresholdMs: 300_000,
    guestPrestartAbortMs: 60_000,
    abortPolicySweepMs: 60_000,
    stalePauseMs: 60_000,
    stalePausedSweepMs: 60_000,
    pauseGraceMs: 90_000,
    recordPersistenceError() {},
    releaseLiveEngineReservation() {},
    reserveHydratedLiveEngineSeat: async () => null,
    seatVacateGraceMs: () => 60_000,
    ...overrides,
  };
  return { api: createRoomLifecycle(config), ctx: config.roomMgrCtx };
}

test('concurrent tenant reconnects share hydration and one orphan pause', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 400_000 });
  const roomId = 'dchx_concurrent_hydration';
  const db = database(t, tenantEvents(roomId));
  db.hold('load');
  const rooms = new Map<string, ReturnType<typeof tenantRoom>>();
  const first = getOrLoadTenantRoom(darkChessTenant, rooms, roomId);
  await db.entered;
  const second = getOrLoadTenantRoom(darkChessTenant, rooms, roomId);
  db.release();
  const [a, b] = await Promise.all([first, second]);
  assert.ok(a);
  assert.equal(a, b, 'both reconnects retain the canonical room');
  assert.equal(rooms.get(roomId), a);
  assert.deepEqual(db.counts(), { reads: 1, tokenReads: 1 });
  assert.deepEqual(
    db.writes.map((event) => event.type),
    ['clock-paused'],
  );
  assert.equal(await getOrLoadTenantRoom(darkChessTenant, rooms, roomId), a);
});

test('concurrent legacy reconnects share hydration and one reservation restoration', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 400_000 });
  const roomId = 'legacy_concurrent_hydration';
  const events = legacyEvents(roomId);
  const engineSeat = events.find(
    (event) => event.type === 'seat-assigned' && event.seat === 'black',
  );
  assert.ok(engineSeat?.type === 'seat-assigned');
  engineSeat.clientId = 'builtin-random-legal';
  const db = database(t, events);
  db.hold('load');
  const rooms = new Map<string, Room>();
  let reservations = 0;
  const { api } = lifecycle(rooms, {
    reserveHydratedLiveEngineSeat: async () => {
      reservations += 1;
      return 'restored-reservation';
    },
  });
  const first = api.getOrCreateRoom(roomId, 'dark-chess');
  await db.entered;
  const second = api.getOrCreateRoom(roomId, 'dark-chess');
  db.release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b, 'both reconnects retain the canonical room');
  assert.equal(rooms.get(roomId), a);
  assert.deepEqual(db.counts(), { reads: 1, tokenReads: 1 });
  assert.deepEqual(
    db.writes.map((event) => event.type),
    ['pause'],
  );
  assert.equal(reservations, 1);
  assert.equal(a.engineReservationId, 'restored-reservation');
});

test('tenant shutdown pause rebases after a move waiting on persistence', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_600 });
  const roomId = 'dchx_shutdown_pending_move';
  const events = tenantEvents(roomId);
  const db = database(t, [...events]);
  db.hold('move');
  const room = tenantRoom(roomId);
  const ctx = {
    appendEvent: (target: typeof room, event: DarkChessTenantEvent) =>
      appendTenantEvent(darkChessTenant, target, event),
    broadcastEventAppended() {},
  };
  const move = ctx.appendEvent(room, {
    type: 'move-played',
    at: 1_500,
    roomId,
    color: 'white',
    move: { from: 'g1', to: 'f3' },
  });
  await db.entered;
  assert.equal(room.projection.clock?.activeColor, 'white', 'old projection while insert waits');
  const pause = pauseTenantRoomsOnShutdown(darkChessTenant, [room], ctx, 1_600);
  db.release();
  await move;
  assert.equal(await pause, 1);
  const resume = tenantResumeEventFor(room.projection, 2_000, 'players-returned');
  assert.ok(resume);
  await ctx.appendEvent(room, resume);
  assert.deepEqual(room.projection.state.status, { type: 'playing', turn: 'black' });
  assert.equal(room.projection.clock?.activeColor, 'black');
  assert.deepEqual(room.projection.clock?.remainingMs, { white: 61_500, black: 59_900 });
  assert.deepEqual(replayTenantEvents(darkChessTenant, room.events).clock, room.projection.clock);
  assert.deepEqual(
    db.writes.map((event) => event.type),
    ['move-played', 'clock-paused', 'clock-resumed'],
  );
});

test('legacy shutdown pause preserves balances after a move waiting on persistence', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_600 });
  const roomId = 'legacy_shutdown_pending_move';
  const events = legacyEvents(roomId);
  const db = database(t, [...events]);
  db.hold('move');
  const room = roomFixture({ id: roomId, events, variant: 'dark-chess' });
  const { ctx } = lifecycle();
  const move = appendEvent(ctx, room, {
    type: 'move-played',
    at: 1_500,
    roomId,
    color: 'white',
    move: { from: 'g1', to: 'f3' } as Move,
  });
  await db.entered;
  const pause = pauseRoomOnShutdown(ctx, room, 1_600);
  db.release();
  await Promise.all([move, pause]);
  await resumeRoom(ctx, room, 2_000, 'both-present');
  assert.equal(room.projection.state.clock?.activeColor, 'black');
  assert.deepEqual(room.projection.state.clock?.remainingMs, { white: 61_500, black: 59_900 });
  assert.deepEqual(
    db.writes.map((event) => event.type),
    ['move-played', 'pause', 'resume'],
  );
});

test('room hydration retries misses and failures instead of retaining settled loads', async () => {
  const rooms = new Map();
  assert.equal(await hydrateRoomOnce(rooms, 'retry', async () => null), null);
  await assert.rejects(
    hydrateRoomOnce(rooms, 'retry', async () => {
      throw new Error('temporary load failure');
    }),
    /temporary load failure/,
  );
  const room = {};
  assert.equal(await hydrateRoomOnce(rooms, 'retry', async () => room), room);
});

test('room hydration isolates registries and lets different room ids load independently', async () => {
  const a = new Map();
  const b = new Map();
  const held = gate();
  const first = hydrateRoomOnce(a, 'one', async () => {
    await held.promise;
    return 'first';
  });
  try {
    assert.equal(await hydrateRoomOnce(a, 'two', async () => 'second'), 'second');
    assert.equal(await hydrateRoomOnce(b, 'one', async () => 'other registry'), 'other registry');
  } finally {
    held.release();
  }
  assert.equal(await first, 'first');
});
