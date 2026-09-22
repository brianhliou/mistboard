import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Color,
  correspondenceTimeControl,
  DAY_MS,
  type RoomTimeControl,
} from '@mistboard/game';
import { type DarkChessTenantEvent, darkChessTenant } from '../dark-chess-tenant.js';
import {
  clearTenantRuntimeTimers,
  scheduleTenantLifecycleTimers,
  type TenantLifecycleClient,
  tenantAbortAnchorAt,
} from './lifecycle.js';
import { createTenantRuntimeRoomFromEvents } from './runtime.js';

// Lifecycle behavior under the days-per-move clock policy, pinned through the
// dark-chess tenant (the correspondence launch tenant). The live policy's
// behavior is pinned by the per-variant lifecycle suites (DMX et al.).

const CORRESPONDENCE_TC = correspondenceTimeControl(3);
const LIVE_TC: RoomTimeControl = { initialMs: 180_000, incrementMs: 2_000 };

function roomEvents(roomId: string, timeControl: RoomTimeControl): DarkChessTenantEvent[] {
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
  ];
}

function firstMoves(roomId: string): DarkChessTenantEvent[] {
  return [
    { type: 'move-played', at: 10_000, roomId, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: 20_000, roomId, color: 'black', move: { from: 'e7', to: 'e5' } },
  ];
}

// Lifecycle rooms carry player-seated clients (the ws host's shape); re-type
// the hydrated room's empty client set accordingly.
function hydrate(events: DarkChessTenantEvent[]) {
  const hydrated = createTenantRuntimeRoomFromEvents(darkChessTenant, events);
  assert.ok(hydrated.ok, 'fixture event log must hydrate');
  return { ...hydrated.room, clients: new Set<TenantLifecycleClient<Color>>() };
}

function lifecycleContext() {
  return {
    appendEvent: async () => {
      throw new Error('no lifecycle event expected in this test');
    },
    broadcastEventAppended: () => {},
    now: () => 1_000_000,
  };
}

test('days-per-move pregame abort window is the allowance anchored to the seat fill', () => {
  const room = hydrate(roomEvents('dchx_corr_abort', CORRESPONDENCE_TC));
  const ctx = lifecycleContext();

  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);

  assert.equal(room.abortPhase, 'white-1');
  // Anchored to the last seat-assigned (5_000), not ctx.now() — a restart
  // re-derives the same deadline instead of extending the window.
  assert.equal(room.abortDeadline, 5_000 + 3 * DAY_MS);
  assert.equal(room.abortTimer, null);
  assert.equal(room.clockTimer, null);
  clearTenantRuntimeTimers(room);
});

test('days-per-move second-mover abort window anchors to the first move', () => {
  const events = roomEvents('dchx_corr_abort2', CORRESPONDENCE_TC);
  events.push({
    type: 'move-played',
    at: 10_000,
    roomId: 'dchx_corr_abort2',
    color: 'white',
    move: { from: 'e2', to: 'e4' },
  });
  const room = hydrate(events);
  const ctx = lifecycleContext();

  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);

  assert.equal(room.abortPhase, 'black-1');
  assert.equal(room.abortDeadline, 10_000 + 3 * DAY_MS);
  assert.equal(room.abortTimer, null);
  assert.equal(tenantAbortAnchorAt(darkChessTenant, room, 'black-1'), 10_000);
  clearTenantRuntimeTimers(room);
});

test('days-per-move arms no clock timer and never forfeits a disconnected seat', () => {
  const roomId = 'dchx_corr_midgame';
  const room = hydrate([...roomEvents(roomId, CORRESPONDENCE_TC), ...firstMoves(roomId)]);
  // Mid-game with only white connected — a live room would arm the
  // disconnect-forfeit window against black here.
  room.clients = new Set([{ seat: 'white', displaced: false }]);
  const ctx = lifecycleContext();

  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);

  assert.equal(room.projection.clock?.activeColor, 'white');
  assert.equal(room.clockTimer, null);
  assert.equal(room.forfeitSeat, null);
  assert.equal(room.forfeitDeadline, null);
  assert.equal(room.forfeitTimer, null);
  clearTenantRuntimeTimers(room);
});

test('the live policy on the same log still arms clock and forfeit timers', () => {
  const roomId = 'dchx_live_midgame';
  const room = hydrate([...roomEvents(roomId, LIVE_TC), ...firstMoves(roomId)]);
  room.clients = new Set([{ seat: 'white', displaced: false }]);
  const ctx = lifecycleContext();

  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);

  assert.notEqual(room.clockTimer, null);
  assert.equal(room.forfeitSeat, 'black');
  assert.notEqual(room.forfeitTimer, null);
  clearTenantRuntimeTimers(room);
});

test('a PvE tenant room never arms the disconnect forfeit (#436)', () => {
  // Same log, same absent seat as the live-policy test above, but white's seat
  // holds the engine client. Nobody is waiting, so nothing is forfeited; the
  // human's clock still runs and flags if they never come back.
  const roomId = 'dchx_pve_midgame';
  const room = hydrate([...roomEvents(roomId, LIVE_TC), ...firstMoves(roomId)]);
  room.clients = new Set([]); // the human (black) is gone; white is the engine
  const ctx = lifecycleContext();
  const pveTenant = {
    ...darkChessTenant,
    engine: { isEngineClientId: (clientId: string | undefined) => clientId === 'white-client' },
  };

  scheduleTenantLifecycleTimers(pveTenant, room, ctx);

  assert.notEqual(room.clockTimer, null, 'the clock still runs, so a leaver flags');
  assert.equal(room.forfeitSeat, null);
  assert.equal(room.forfeitDeadline, null);
  assert.equal(room.forfeitTimer, null);
  clearTenantRuntimeTimers(room);
});

test('replay applies the days-per-move reset through the tenant projection', () => {
  const roomId = 'dchx_corr_reset';
  const sixHoursLater = 20_000 + DAY_MS / 4;
  const room = hydrate([
    ...roomEvents(roomId, CORRESPONDENCE_TC),
    ...firstMoves(roomId),
    {
      type: 'move-played',
      at: sixHoursLater,
      roomId,
      color: 'white',
      move: { from: 'd2', to: 'd4' },
    },
  ]);

  // White spent six hours on the move; the allowance resets to the full
  // three days instead of banking the remainder.
  assert.equal(room.projection.clock?.remainingMs.white, 3 * DAY_MS);
  assert.equal(room.projection.clock?.activeColor, 'black');
  assert.equal(room.projection.clock?.runningSince, sixHoursLater);
});
