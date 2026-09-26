import assert from 'node:assert/strict';
import test from 'node:test';
import { type Color, correspondenceTimeControl, type RoomTimeControl } from '@mistboard/game';
import { type DarkChessTenantEvent, darkChessTenant } from '../dark-chess-tenant.js';
import {
  clearTenantRuntimeTimers,
  pauseTenantRoomsOnShutdown,
  scheduleTenantLifecycleTimers,
  TENANT_PAUSE_GRACE_MS,
  type TenantLifecycleClient,
} from './lifecycle.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  isTenantEventLog,
  replayTenantEvents,
  tenantClockRemainingMs,
  tenantEventsForClient,
  tenantOrphanPauseFor,
  tenantPauseEventFor,
} from './runtime.js';

// A server stop used to leave a live tenant game's clock running: hydration
// replays the log, the clock is still running from the last move, and the
// first seated reconnect armed the flag timer against now. A 200s outage
// flagged a player with 177s left the instant they came back (repro,
// 2026-09-25). Pinned through the dark-chess tenant, which shares the generic
// runtime every xiangqi-family tenant uses.

const LIVE_TC: RoomTimeControl = { initialMs: 180_000, incrementMs: 2_000 };

function liveGame(roomId: string, timeControl: RoomTimeControl = LIVE_TC): DarkChessTenantEvent[] {
  return [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'dark-chess', timeControl },
    {
      type: 'clock-started',
      at: 1_000,
      roomId,
      clock: {
        activeColor: null,
        incrementMs: timeControl.incrementMs,
        initialMs: timeControl.initialMs,
        remainingMs: { black: timeControl.initialMs, white: timeControl.initialMs },
        runningSince: null,
      },
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'white-client', seat: 'white' },
    { type: 'seat-assigned', at: 5_000, roomId, clientId: 'black-client', seat: 'black' },
    { type: 'move-played', at: 10_000, roomId, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: 20_000, roomId, color: 'black', move: { from: 'e7', to: 'e5' } },
  ];
}

function hydrate(events: DarkChessTenantEvent[]) {
  const hydrated = createTenantRuntimeRoomFromEvents(darkChessTenant, events);
  assert.ok(hydrated.ok, 'fixture event log must hydrate');
  return { ...hydrated.room, clients: new Set<TenantLifecycleClient<Color>>() };
}

type Room = ReturnType<typeof hydrate>;

// The real writer re-runs the lifecycle timers after every append; so does
// this one, which is what lets the shutdown test prove the pause's own append
// does not resume a room whose players are still connected.
function writerContext(now: () => number) {
  const appended: DarkChessTenantEvent[] = [];
  const ctx = {
    appendEvent: async (room: Room, event: DarkChessTenantEvent) => {
      const seq = appendTenantRuntimeEvent(darkChessTenant, room, event);
      if (seq >= 0) appended.push(event);
      scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);
      return seq;
    },
    broadcastEventAppended: () => {},
    now,
  };
  return { ctx, appended };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test('a paused game does not flag a player after an outage longer than their clock', async () => {
  const roomId = 'dchx_outage';
  // The server stops at 25s: white has thought 5s of their 182s.
  const events = liveGame(roomId);
  const pause = tenantPauseEventFor(
    replayTenantEvents(darkChessTenant, events),
    25_000,
    'shutdown',
  );
  assert.ok(pause);
  events.push(pause as DarkChessTenantEvent);

  // It comes back 200s later and white reconnects first.
  const room = hydrate(events);
  room.clients = new Set([{ seat: 'white', displaced: false }]);
  const { ctx, appended } = writerContext(() => 225_000);
  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);
  await settle();

  assert.deepEqual(appended, [], 'no clock-expired, no resume while black is away');
  assert.equal(room.clockTimer, null);
  assert.equal(room.resumeDeadline, 225_000 + TENANT_PAUSE_GRACE_MS);
  assert.equal(room.projection.clock?.remainingMs.white, 177_000);
  clearTenantRuntimeTimers(room);
});

test('the clock resumes for the side on move once both players are back', async () => {
  const roomId = 'dchx_both_back';
  const events = liveGame(roomId);
  events.push(
    tenantPauseEventFor(
      replayTenantEvents(darkChessTenant, events),
      25_000,
      'shutdown',
    ) as DarkChessTenantEvent,
  );
  const room = hydrate(events);
  room.clients = new Set([
    { seat: 'white', displaced: false },
    { seat: 'black', displaced: false },
  ]);
  const { ctx, appended } = writerContext(() => 225_000);
  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);
  await settle();

  assert.equal(appended[0]?.type, 'clock-resumed');
  assert.equal(room.projection.paused, undefined);
  const clock = room.projection.clock!;
  assert.equal(clock.activeColor, 'white');
  assert.equal(clock.runningSince, 225_000);
  assert.equal(tenantClockRemainingMs(clock, 'white', 235_000), 167_000);
  assert.notEqual(room.clockTimer, null, 'the flag timer is armed again');
  clearTenantRuntimeTimers(room);
});

test('a player who never returns gets their clock back running after the grace window', async () => {
  const roomId = 'dchx_grace';
  const events = liveGame(roomId);
  events.push(
    tenantPauseEventFor(
      replayTenantEvents(darkChessTenant, events),
      25_000,
      'shutdown',
    ) as DarkChessTenantEvent,
  );
  const room = hydrate(events);
  room.clients = new Set([{ seat: 'black', displaced: false }]);
  const { ctx, appended } = writerContext(() => Date.now());
  room.resumeDeadline = Date.now() + 20; // a short window stands in for the real one
  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);
  await settle();

  assert.equal(appended[0]?.type, 'clock-resumed');
  assert.equal(
    (appended[0] as Extract<DarkChessTenantEvent, { type: 'clock-resumed' }>).reason,
    'grace-elapsed',
  );
  assert.equal(room.projection.clock?.activeColor, 'white');
  clearTenantRuntimeTimers(room);
});

test('a paused game refuses moves, and its log replays to the same clock', () => {
  const roomId = 'dchx_replay';
  const events = liveGame(roomId);
  events.push(
    tenantPauseEventFor(
      replayTenantEvents(darkChessTenant, events),
      25_000,
      'shutdown',
    ) as DarkChessTenantEvent,
  );
  const room = hydrate(events);

  const refused = appendTenantRuntimeEvent(darkChessTenant, room, {
    type: 'move-played',
    at: 30_000,
    roomId,
    color: 'white',
    move: { from: 'g1', to: 'f3' },
  });
  assert.equal(refused, -1);

  const resumed = {
    type: 'clock-resumed',
    at: 225_000,
    roomId,
    reason: 'players-returned',
    clock: { ...room.projection.clock!, activeColor: 'white', runningSince: 225_000 },
  } as const;
  assert.ok(appendTenantRuntimeEvent(darkChessTenant, room, resumed) >= 0);
  assert.ok(
    appendTenantRuntimeEvent(darkChessTenant, room, {
      type: 'move-played',
      at: 235_000,
      roomId,
      color: 'white',
      move: { from: 'g1', to: 'f3' },
    }) >= 0,
  );

  assert.ok(isTenantEventLog(darkChessTenant, room.events, roomId));
  const replayed = replayTenantEvents(darkChessTenant, room.events);
  assert.deepEqual(replayed.clock, room.projection.clock);
  // 177s at the pause, 10s thought after the resume, plus the increment.
  assert.equal(replayed.clock?.remainingMs.white, 169_000);
});

test('pause bookkeeping never reaches a client', () => {
  const roomId = 'dchx_wire';
  const events = liveGame(roomId);
  events.push(
    tenantPauseEventFor(
      replayTenantEvents(darkChessTenant, events),
      25_000,
      'shutdown',
    ) as DarkChessTenantEvent,
  );
  const room = hydrate(events);
  for (const seat of ['white', 'black', 'spectator'] as const) {
    const visible = tenantEventsForClient(darkChessTenant, room, { id: 'x', seat, solo: false });
    assert.equal(
      visible.some((event) => event.type === 'clock-paused' || event.type === 'clock-resumed'),
      false,
      seat,
    );
  }
});

test('the shutdown pause does not resume a room whose players are still connected', async () => {
  const roomId = 'dchx_shutdown';
  const room = hydrate(liveGame(roomId));
  room.clients = new Set([
    { seat: 'white', displaced: false },
    { seat: 'black', displaced: false },
  ]);
  const { ctx, appended } = writerContext(() => 25_000);

  const paused = await pauseTenantRoomsOnShutdown(darkChessTenant, [room], ctx, 25_000);
  await settle();

  assert.equal(paused, 1);
  assert.deepEqual(
    appended.map((event) => event.type),
    ['clock-paused'],
  );
  assert.deepEqual(room.projection.paused, { at: 25_000, activeColor: 'white' });
  assert.equal(room.clockTimer, null);
  assert.equal(room.resumeTimer ?? null, null);
});

test('only a live, timed, running game is paused', () => {
  const live = replayTenantEvents(darkChessTenant, liveGame('dchx_only_live'));
  assert.ok(tenantPauseEventFor(live, 25_000, 'shutdown'));

  const correspondence = replayTenantEvents(
    darkChessTenant,
    liveGame('dchx_only_corr', correspondenceTimeControl(3)),
  );
  assert.equal(tenantPauseEventFor(correspondence, 25_000, 'shutdown'), null);

  const alreadyPaused = {
    ...live,
    paused: { at: 24_000, activeColor: 'white' as const },
  };
  assert.equal(tenantPauseEventFor(alreadyPaused, 25_000, 'shutdown'), null);
});

test('a server that died without pausing is paused at its last event on hydration', () => {
  const events = liveGame('dchx_orphan');
  const projection = replayTenantEvents(darkChessTenant, events);

  const orphan = tenantOrphanPauseFor(projection, events, 20_000 + 400_000, 300_000);
  assert.equal(orphan?.at, 20_001);
  assert.equal(orphan?.reason, 'orphaned');
  // White's clock stops a millisecond after black moved.
  assert.equal(orphan?.clock.remainingMs.white, 181_999);

  // A long think is not an outage.
  assert.equal(tenantOrphanPauseFor(projection, events, 20_000 + 60_000, 300_000), null);
});
