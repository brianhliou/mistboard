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
  ABORT_WINDOW_MS,
  JOIN_WINDOW_MS,
  LOBBY_NO_SHOW_ABORT_MS,
  PVP_DISCONNECT_FORFEIT_ENABLED,
} from '../lifecycle-windows.js';
import {
  clearTenantRuntimeTimers,
  scheduleTenantLifecycleTimers,
  type TenantLifecycleClient,
  tenantAbortAnchorAt,
  tenantForfeitingSeat,
} from './lifecycle.js';
import { appendTenantRuntimeEvent, createTenantRuntimeRoomFromEvents } from './runtime.js';

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
  // Anchored to the seat fill that seated the room (5_000), not ctx.now() — a restart
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

test('a reconnect before the first move does not extend the correspondence abort window', () => {
  const roomId = 'dchx_corr_reconnect';
  const room = hydrate([
    ...roomEvents(roomId, CORRESPONDENCE_TC),
    { type: 'seat-assigned', at: 40_000, roomId, clientId: 'white-client', seat: 'white' },
  ]);
  try {
    scheduleTenantLifecycleTimers(darkChessTenant, room, lifecycleContext());
    assert.equal(room.abortPhase, 'white-1');
    assert.equal(room.abortDeadline, 5_000 + 3 * DAY_MS);
    assert.equal(tenantAbortAnchorAt(darkChessTenant, room, 'white-1'), 5_000);
  } finally {
    clearTenantRuntimeTimers(room);
  }
});

test('a reconnect before the first move does not extend the live abort window', () => {
  const roomId = 'dchx_live_reconnect';
  const room = hydrate(roomEvents(roomId, LIVE_TC));
  let now = 1_000_000;
  const ctx = { ...lifecycleContext(), now: () => now };
  try {
    scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);
    assert.equal(room.abortPhase, 'white-1');
    assert.equal(room.abortDeadline, 1_000_000 + ABORT_WINDOW_MS);
    // White reconnects 20 s in: ws.ts appends seat-assigned, then reschedules.
    now = 1_020_000;
    assert.notEqual(
      appendTenantRuntimeEvent(darkChessTenant, room, {
        type: 'seat-assigned',
        at: now,
        roomId,
        clientId: 'white-client',
        seat: 'white',
      }),
      -1,
    );
    scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);
    assert.equal(room.abortPhase, 'white-1');
    assert.equal(room.abortDeadline, 1_000_000 + ABORT_WINDOW_MS);
  } finally {
    clearTenantRuntimeTimers(room);
  }
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

test('the live policy on the same log arms the clock timer', () => {
  const roomId = 'dchx_live_midgame';
  const room = hydrate([...roomEvents(roomId, LIVE_TC), ...firstMoves(roomId)]);
  room.clients = new Set([{ seat: 'white', displaced: false }]);
  const ctx = lifecycleContext();

  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);

  assert.notEqual(room.clockTimer, null);
  clearTenantRuntimeTimers(room);
});

test('a PvP tenant room arms no forfeit while the PvP policy is off (#436)', () => {
  const roomId = 'dchx_pvp_leaver';
  const room = hydrate([...roomEvents(roomId, LIVE_TC), ...firstMoves(roomId)]);
  // Mid-game, black's socket gone, white still there: the shape the 30 s window
  // was written for. Off by policy until a waiting player says the wait is the
  // problem; the clock timer below is what ends this game instead.
  room.clients = new Set([{ seat: 'white', displaced: false }]);
  const ctx = lifecycleContext();

  scheduleTenantLifecycleTimers(darkChessTenant, room, ctx);

  assert.equal(PVP_DISCONNECT_FORFEIT_ENABLED, false, 'policy under test');
  assert.equal(tenantForfeitingSeat(darkChessTenant, room), null);
  assert.equal(room.forfeitSeat, null);
  assert.equal(room.forfeitDeadline, null);
  assert.equal(room.forfeitTimer, null);
  assert.notEqual(room.clockTimer, null, 'the clock is the reaper now');
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

// ── Lobby no-show (prod, 2026-10-02) ──────────────────────────────────────
//
// A lobby match creates a room exactly like an invite link, so a seeker whose
// tab had died left the joiner alone in it. The 'unjoined' phase never aborts
// while someone sits in the room (right for an invite: waiting for a friend is
// normal), so the joiner waited forever under a "copy the invite link" prompt.
// A lobby room has nobody to invite: both players were already waiting, so an
// opponent who has not connected within LOBBY_NO_SHOW_ABORT_MS is not coming.

function lobbyRoomEvents(roomId: string, options: { lobby: boolean }): DarkChessTenantEvent[] {
  const [created, ...rest] = roomEvents(roomId, LIVE_TC);
  return [
    { ...created!, ...(options.lobby ? { lobbyMatch: true } : {}) } as DarkChessTenantEvent,
    ...rest.slice(0, 2), // clock-started + white seated; black never arrives
  ];
}

test('a lobby room whose opponent never connects aborts 30 s after creation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const room = hydrate(lobbyRoomEvents('dchx_lobby_no_show', { lobby: true }));
  room.clients.add({ displaced: false, seat: 'white' });
  const appended: { type: string; reason?: string }[] = [];
  const created = 1_000;
  const scheduledAt = created + 5_000; // the seeker connects 5 s after the match
  try {
    scheduleTenantLifecycleTimers(darkChessTenant, room, {
      appendEvent: async (_room, event) => {
        appended.push(event);
        return 0;
      },
      broadcastEventAppended: () => {},
      now: () => scheduledAt,
    });
    assert.equal(LOBBY_NO_SHOW_ABORT_MS, 30_000);
    assert.equal(room.abortDeadline, created + LOBBY_NO_SHOW_ABORT_MS, 'anchored to creation');
    assert.equal(room.abortPhase, 'unjoined');
    t.mock.timers.tick(created + LOBBY_NO_SHOW_ABORT_MS - scheduledAt - 1);
    assert.equal(appended.length, 0, 'not before the window closes');
    t.mock.timers.tick(100);
    assert.equal(appended.length, 1);
    assert.equal(appended[0]?.type, 'game-aborted');
    assert.equal(appended[0]?.reason, 'pregame-timeout');
  } finally {
    clearTenantRuntimeTimers(room);
  }
});

test('an invite room in the same state keeps waiting with no abort armed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const room = hydrate(lobbyRoomEvents('dchx_invite_waiting', { lobby: false }));
  room.clients.add({ displaced: false, seat: 'white' });
  const appended: { type: string; reason?: string }[] = [];
  try {
    scheduleTenantLifecycleTimers(darkChessTenant, room, {
      appendEvent: async (_room, event) => {
        appended.push(event);
        return 0;
      },
      broadcastEventAppended: () => {},
      now: () => 6_000,
    });
    assert.equal(room.abortDeadline, null, 'a friend link waits for the friend');
    assert.equal(room.abortTimer, null);
    t.mock.timers.tick(JOIN_WINDOW_MS * 2);
    assert.equal(appended.length, 0);
  } finally {
    clearTenantRuntimeTimers(room);
  }
});

test('a lobby room nobody connected to also closes at the no-show window', () => {
  const room = hydrate(lobbyRoomEvents('dchx_lobby_empty', { lobby: true }));
  try {
    scheduleTenantLifecycleTimers(darkChessTenant, room, lifecycleContext());
    assert.equal(room.abortPhase, 'unjoined');
    assert.equal(room.abortDeadline, 1_000 + LOBBY_NO_SHOW_ABORT_MS);
  } finally {
    clearTenantRuntimeTimers(room);
  }
});

test('a lobby room with both seats filled uses the ordinary first-move window', () => {
  const [created, ...rest] = roomEvents('dchx_lobby_full', LIVE_TC);
  const room = hydrate([{ ...created!, lobbyMatch: true } as DarkChessTenantEvent, ...rest]);
  try {
    scheduleTenantLifecycleTimers(darkChessTenant, room, lifecycleContext());
    assert.equal(room.abortPhase, 'white-1');
    assert.equal(room.abortDeadline, 1_000_000 + ABORT_WINDOW_MS);
  } finally {
    clearTenantRuntimeTimers(room);
  }
});
