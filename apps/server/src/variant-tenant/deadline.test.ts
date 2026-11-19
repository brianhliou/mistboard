import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Color,
  correspondenceTimeControl,
  DAY_MS,
  type Move,
  type RoomTimeControl,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { type DarkChessTenantEvent, darkChessTenant } from '../dark-chess-tenant.js';
import { jieqiTenant } from '../jieqi-tenant.js';
import { CORRESPONDENCE_SEEK_TTL_MS } from '../persistence-correspondence-seeks.js';
import { hashSeatToken } from '../server-seat-session.js';
import {
  appendTenantEvent,
  appendTenantSeatAssigned,
  type TenantEventWriterPersistence,
} from './events.js';
import { sweepTenantRoomDeadline, tenantDurableDeadlineFor } from './lifecycle.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantLiveHistoryExtras,
  tenantSnapshotPayload,
} from './runtime.js';
import type { TenantSeatTokenState } from './tenant.js';

// The durable-deadline pipeline for days-per-move rooms, pinned through the
// dark-chess tenant (the correspondence launch tenant): derivation from the
// event log, room_deadlines row maintenance in the event writer, and sweep
// enforcement appending the same terminal events the in-memory timers would.

const CORRESPONDENCE_TC = correspondenceTimeControl(3);
const ALLOWANCE_MS = 3 * DAY_MS;

function roomEvents(roomId: string, timeControl?: RoomTimeControl): DarkChessTenantEvent[] {
  const tc = timeControl ?? CORRESPONDENCE_TC;
  return [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'dark-chess', timeControl: tc },
    {
      type: 'clock-started',
      at: 1_000,
      roomId,
      clock: {
        activeColor: null,
        incrementMs: tc.incrementMs,
        initialMs: tc.initialMs,
        remainingMs: { black: tc.initialMs, white: tc.initialMs },
        runningSince: null,
      },
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'white-client', seat: 'white' },
    { type: 'seat-assigned', at: 5_000, roomId, clientId: 'black-client', seat: 'black' },
  ];
}

function move(roomId: string, at: number, color: Color, mv: Move): DarkChessTenantEvent {
  return { type: 'move-played', at, roomId, color, move: mv };
}

function hydrate(events: DarkChessTenantEvent[]) {
  const hydrated = createTenantRuntimeRoomFromEvents(darkChessTenant, events);
  assert.ok(hydrated.ok, 'fixture event log must hydrate');
  return hydrated.room;
}

type RecordingPersistence = TenantEventWriterPersistence<Color, Move, 'dark-chess'> & {
  deadlineOps: Array<
    | { op: 'delete'; roomId: string }
    | { op: 'upsert'; roomId: string; seat: string; seatUserId: string | null; dueAt: number }
  >;
};

function recordingPersistence(): RecordingPersistence {
  const persistence: RecordingPersistence = {
    abortRunningGame: async () => true,
    appendRoomEvent: async () => {},
    deadlineOps: [],
    deleteRoomDeadline: async (roomId) => {
      persistence.deadlineOps.push({ op: 'delete', roomId });
    },
    isInitialized: () => true,
    recordGameEnd: async () => {},
    upsertRoomDeadline: async (record) => {
      persistence.deadlineOps.push({
        op: 'upsert',
        roomId: record.roomId,
        seat: record.seat,
        seatUserId: record.seatUserId,
        dueAt: record.dueAt.getTime(),
      });
    },
    upsertRoomSeatToken: async () => {},
  };
  return persistence;
}

function seatTokenState(seat: Color, userId: string | null): TenantSeatTokenState<Color> {
  return {
    clientId: `${seat}-client`,
    seat,
    tokenHash: hashSeatToken(`${seat}-token`),
    userId,
    userHandle: userId ? `${seat}-handle` : null,
    userDisplayName: userId ? `${seat} player` : null,
    issuedAt: new Date(1_000),
    lastSeenAt: new Date(1_000),
    revokedAt: null,
  };
}

test('unaccepted correspondence invites expire at the seek TTL and replay as aborted', async () => {
  for (const seatCount of [0, 1]) {
    const room = hydrate(roomEvents(`dchx_invite_${seatCount}`).slice(0, 2 + seatCount));
    const persistence = recordingPersistence();
    let broadcasts = 0;
    const sweep = (at: number) =>
      sweepTenantRoomDeadline(darkChessTenant, room, {
        now: () => at,
        appendEvent: (target, event) =>
          appendTenantEvent(darkChessTenant, target, event, { persistence }),
        broadcastEventAppended: () => {
          broadcasts++;
        },
      });
    assert.equal(await sweep(1_000 + 13 * DAY_MS), 'no-deadline');
    assert.equal(room.projection.state.status.type, 'playing');
    assert.equal(await sweep(1_000 + CORRESPONDENCE_SEEK_TTL_MS), 'aborted');
    assert.deepEqual(room.projection.state.status, { type: 'aborted', reason: 'pregame-timeout' });
    assert.equal(hydrate(room.events).projection.state.status.type, 'aborted');
    assert.equal(await sweep(1_000 + 15 * DAY_MS), 'no-deadline');
    assert.equal(room.events.filter((event) => event.type === 'game-aborted').length, 1);
    assert.equal(broadcasts, 1);
  }
});

test('an invite expiry queued behind the second seat cannot abort the accepted room', async () => {
  const room = hydrate(roomEvents('dchx_invite_race').slice(0, 3));
  const persistence = recordingPersistence();
  let release!: () => void;
  room.pendingWrites = new Promise<void>((resolve) => {
    release = resolve;
  });
  const at = 1_000 + CORRESPONDENCE_SEEK_TTL_MS;
  const seated = appendTenantSeatAssigned(
    darkChessTenant,
    room,
    {
      event: {
        type: 'seat-assigned',
        at,
        roomId: room.id,
        clientId: 'black-client',
        seat: 'black',
      },
      tokenState: seatTokenState('black', null),
    },
    { persistence },
  );
  let broadcasts = 0;
  const swept = sweepTenantRoomDeadline(darkChessTenant, room, {
    now: () => at,
    appendEvent: (target, event) =>
      appendTenantEvent(darkChessTenant, target, event, { persistence }),
    broadcastEventAppended: () => {
      broadcasts++;
    },
  });
  release();
  await seated;
  await swept;
  assert.equal(room.projection.state.status.type, 'playing');
  assert.equal(room.events.filter((event) => event.type === 'game-aborted').length, 0);
  assert.equal(broadcasts, 0);
});

test('overlapping processes and repeated invite sweeps persist one abort and resync the loser', async () => {
  const stored = roomEvents('dchx_invite_processes').slice(0, 3);
  const rooms = [hydrate(stored), hydrate(stored)];
  const persistence = recordingPersistence();
  let abortRecords = 0;
  let resyncs = 0;
  persistence.abortRunningGame = async () => {
    abortRecords++;
    return true;
  };
  persistence.appendRoomEvent = async (_id, seq, event) => {
    if (seq < stored.length)
      throw Object.assign(new Error('taken seq'), { code: '23505', constraint: 'events_pkey' });
    assert.equal(seq, stored.length);
    stored.push(event);
  };
  persistence.loadRoomEvents = async () => stored;
  persistence.loadRoomSeatTokens = async () => ({});
  const sweep = (room: (typeof rooms)[number]) =>
    sweepTenantRoomDeadline(darkChessTenant, room, {
      now: () => 1_000 + 15 * DAY_MS,
      appendEvent: (target, event) =>
        appendTenantEvent(darkChessTenant, target, event, {
          persistence,
          onRoomResynced: () => {
            resyncs++;
          },
        }),
      broadcastEventAppended: () => {},
    });
  await Promise.all(rooms.map(sweep));
  await Promise.all(rooms.map(sweep));
  assert.equal(stored.filter((event) => event.type === 'game-aborted').length, 1);
  assert.equal(abortRecords, 1);
  assert.equal(resyncs, 1);
  for (const room of rooms) assert.equal(room.projection.state.status.type, 'aborted');
  assert.equal(hydrate(stored).projection.state.status.type, 'aborted');
});

test('invite expiry leaves live, moved, terminal and previously accepted rooms alone', async () => {
  const at = 1_000 + 15 * DAY_MS;
  const recentlyFilled = roomEvents('dchx_accepted').map((event) =>
    event.type === 'seat-assigned' ? { ...event, at } : event,
  );
  const fixtures = [
    roomEvents('dchx_live_invite', { initialMs: 60_000, incrementMs: 0 }).slice(0, 3),
    recentlyFilled,
    [
      ...roomEvents('dchx_moved').slice(0, 3),
      move('dchx_moved', 6_000, 'white', { from: 'e2', to: 'e4' }),
    ],
    [
      ...roomEvents('dchx_terminal').slice(0, 3),
      { type: 'game-aborted', at: 6_000, roomId: 'dchx_terminal', reason: 'user-abort' } as const,
    ],
    [
      ...recentlyFilled,
      {
        type: 'seat-vacated',
        at,
        roomId: 'dchx_accepted',
        clientId: 'black-client',
        seat: 'black',
      } as const,
    ],
  ];
  for (const events of fixtures) {
    const room = hydrate(events);
    const count = room.events.length;
    await sweepTenantRoomDeadline(darkChessTenant, room, {
      now: () => at,
      appendEvent: async () => {
        assert.fail('unaccepted invite pass must not abort this room');
      },
      broadcastEventAppended: () => {
        assert.fail('no broadcast without an expiry');
      },
    });
    assert.equal(room.events.length, count);
  }
});

test('expired hidden-info invites keep whole reconnect payloads masked for both seats and spectators', async () => {
  const created = createTenantRuntimeRoomFromEvents(jieqiTenant, [
    {
      type: 'room-created',
      at: 1_000,
      roomId: 'jq_invite_private',
      gameSpecId: 'jieqi',
      timeControl: CORRESPONDENCE_TC,
      setup: { ...STANDARD_JIEQI_DEAL, secretMarker: 'invite-deal-must-stay-private' },
    },
  ]);
  assert.ok(created.ok);
  const room = created.room;
  await sweepTenantRoomDeadline(jieqiTenant, room, {
    now: () => 1_000 + CORRESPONDENCE_SEEK_TTL_MS,
    appendEvent: (target, event) => appendTenantEvent(jieqiTenant, target, event),
    broadcastEventAppended: () => {},
  });
  assert.equal(room.projection.state.status.type, 'aborted');
  const replay = createTenantRuntimeRoomFromEvents(jieqiTenant, room.events);
  assert.ok(replay.ok);
  for (const seat of ['red', 'black', 'spectator'] as const) {
    const client = { id: `client-${seat}`, seat, solo: false };
    const payload = (target: typeof room) =>
      JSON.stringify({
        ...tenantSnapshotPayload(jieqiTenant, target, client),
        ...tenantLiveHistoryExtras(jieqiTenant, target, client),
        serverAt: 0,
      });
    const serialized = payload(room);
    assert.equal(serialized, payload(replay.room));
    assert.doesNotMatch(serialized, /"setup"|invite-deal-must-stay-private/);
    const wire = JSON.parse(serialized);
    let hidden = 0;
    for (const piece of Object.values(wire.state.board) as Array<Record<string, unknown>>) {
      if (piece.faceDown) {
        hidden++;
        assert.equal('role' in piece, false);
      }
    }
    assert.ok(hidden > 0, 'the test must include hidden pieces');
  }
});

test('durable deadline derivation walks the room states', () => {
  const roomId = 'dchx_derive';
  // Waiting on the second seat: nothing enforceable yet.
  const waiting = hydrate(roomEvents(roomId).slice(0, 3));
  assert.equal(tenantDurableDeadlineFor(darkChessTenant, waiting), null);

  // Fully seated pregame: white must move within the allowance of seat fill.
  const seated = hydrate(roomEvents(roomId));
  assert.deepEqual(tenantDurableDeadlineFor(darkChessTenant, seated), {
    seat: 'white',
    dueAt: 5_000 + ALLOWANCE_MS,
  });

  // After white's first move: black's window anchors at the move.
  const afterWhite = hydrate([
    ...roomEvents(roomId),
    move(roomId, 10_000, 'white', { from: 'e2', to: 'e4' }),
  ]);
  assert.deepEqual(tenantDurableDeadlineFor(darkChessTenant, afterWhite), {
    seat: 'black',
    dueAt: 10_000 + ALLOWANCE_MS,
  });

  // Armed mid-game clock: the active seat flags at runningSince + remaining.
  const midGame = hydrate([
    ...roomEvents(roomId),
    move(roomId, 10_000, 'white', { from: 'e2', to: 'e4' }),
    move(roomId, 20_000, 'black', { from: 'e7', to: 'e5' }),
  ]);
  assert.deepEqual(tenantDurableDeadlineFor(darkChessTenant, midGame), {
    seat: 'white',
    dueAt: 20_000 + ALLOWANCE_MS,
  });

  // Live policy rooms never produce a durable deadline.
  const live = hydrate(roomEvents(roomId, { initialMs: 180_000, incrementMs: 2_000 }));
  assert.equal(tenantDurableDeadlineFor(darkChessTenant, live), null);
});

test('the event writer maintains the room_deadlines row across the game', async () => {
  const roomId = 'dchx_row_maintenance';
  const room = hydrate(roomEvents(roomId).slice(0, 3));
  room.seatTokens.white = seatTokenState('white', 'white-user');
  const persistence = recordingPersistence();
  const ctx = { persistence };

  // The second seat fill opens white's first-move window.
  await appendTenantSeatAssigned(
    darkChessTenant,
    room,
    {
      event: { type: 'seat-assigned', at: 5_000, roomId, clientId: 'black-client', seat: 'black' },
      tokenState: seatTokenState('black', 'black-user'),
    },
    ctx,
  );
  assert.deepEqual(persistence.deadlineOps.at(-1), {
    op: 'upsert',
    roomId,
    seat: 'white',
    seatUserId: 'white-user',
    dueAt: 5_000 + ALLOWANCE_MS,
  });

  // Each move hands the deadline to the other seat.
  await appendTenantEvent(
    darkChessTenant,
    room,
    move(roomId, 10_000, 'white', { from: 'e2', to: 'e4' }),
    ctx,
  );
  assert.deepEqual(persistence.deadlineOps.at(-1), {
    op: 'upsert',
    roomId,
    seat: 'black',
    seatUserId: 'black-user',
    dueAt: 10_000 + ALLOWANCE_MS,
  });

  // A terminal event clears the row.
  await appendTenantEvent(
    darkChessTenant,
    room,
    { type: 'seat-resigned', at: 11_000, roomId, color: 'white' },
    ctx,
  );
  assert.deepEqual(persistence.deadlineOps.at(-1), { op: 'delete', roomId });
});

test('a reconnect before the first move does not move the first-move deadline', () => {
  const roomId = 'dchx_reconnect_derive';
  // Both seats filled at 5_000; then each player reconnects (a new device
  // reclaims the seat, so the clientId differs too). Neither re-assignment is a
  // new occupant, so white's window still runs from the seat fill.
  const reconnected = hydrate([
    ...roomEvents(roomId),
    { type: 'seat-assigned', at: 50_000, roomId, clientId: 'white-phone', seat: 'white' },
    { type: 'seat-assigned', at: 60_000, roomId, clientId: 'black-client', seat: 'black' },
  ]);
  assert.deepEqual(tenantDurableDeadlineFor(darkChessTenant, reconnected), {
    seat: 'white',
    dueAt: 5_000 + ALLOWANCE_MS,
  });
});

test('a seat vacated and refilled before the first move restarts the window at the refill', () => {
  // Legacy live-stack logs (acceptsSeatVacated) can empty a seat pregame. The
  // room drops back to waiting, so the game starts again when it refills.
  const roomId = 'dchx_vacate_refill';
  const refilled = hydrate([
    ...roomEvents(roomId),
    { type: 'seat-vacated', at: 7_000, roomId, clientId: 'black-client', seat: 'black' },
    { type: 'seat-assigned', at: 9_000, roomId, clientId: 'new-black', seat: 'black' },
    { type: 'seat-assigned', at: 70_000, roomId, clientId: 'new-black', seat: 'black' },
  ]);
  assert.deepEqual(tenantDurableDeadlineFor(darkChessTenant, refilled), {
    seat: 'white',
    dueAt: 9_000 + ALLOWANCE_MS,
  });
});

test('a reconnect before the first move re-writes the same deadline row (warned_at survives)', async () => {
  const roomId = 'dchx_reconnect_row';
  const room = hydrate(roomEvents(roomId));
  room.seatTokens.white = seatTokenState('white', 'white-user');
  room.seatTokens.black = seatTokenState('black', 'black-user');
  const persistence = recordingPersistence();

  // White reconnects two days into the window. The upsert keeps warned_at only
  // when due_at is unchanged (persistence-room-deadlines.ts), so an extended
  // due_at would both stall the game and re-arm the warning email.
  await appendTenantSeatAssigned(
    darkChessTenant,
    room,
    {
      event: {
        type: 'seat-assigned',
        at: 5_000 + 2 * DAY_MS,
        roomId,
        clientId: 'white-client',
        seat: 'white',
      },
      tokenState: seatTokenState('white', 'white-user'),
    },
    { persistence },
  );
  assert.deepEqual(persistence.deadlineOps.at(-1), {
    op: 'upsert',
    roomId,
    seat: 'white',
    seatUserId: 'white-user',
    dueAt: 5_000 + ALLOWANCE_MS,
  });
});

test('live rooms never touch the room_deadlines table', async () => {
  const roomId = 'dchx_live_rows';
  const room = hydrate(roomEvents(roomId, { initialMs: 180_000, incrementMs: 2_000 }));
  const persistence = recordingPersistence();

  await appendTenantEvent(
    darkChessTenant,
    room,
    move(roomId, 10_000, 'white', { from: 'e2', to: 'e4' }),
    { persistence },
  );

  assert.deepEqual(persistence.deadlineOps, []);
});

test('sweep enforcement aborts a due pregame room and expires a due clock', async () => {
  const persistence = recordingPersistence();
  const broadcasts: string[] = [];
  type Room = ReturnType<typeof hydrate>;
  const lifecycleCtx = (nowMs: number) => ({
    appendEvent: (room: Room, event: DarkChessTenantEvent) =>
      appendTenantEvent(darkChessTenant, room, event, { persistence }),
    broadcastEventAppended: (_room: Room, event: DarkChessTenantEvent, _seq: number) => {
      broadcasts.push(event.type);
    },
    now: () => nowMs,
  });

  // Not due yet: nothing happens.
  const pregame = hydrate(roomEvents('dchx_sweep_abort'));
  assert.equal(
    await sweepTenantRoomDeadline(darkChessTenant, pregame, lifecycleCtx(5_000 + DAY_MS)),
    'not-due',
  );
  assert.equal(pregame.events.length, 4);

  // Due pregame window: the game aborts, never forfeits.
  assert.equal(
    await sweepTenantRoomDeadline(darkChessTenant, pregame, lifecycleCtx(5_000 + ALLOWANCE_MS + 1)),
    'aborted',
  );
  assert.equal(pregame.projection.state.status.type, 'aborted');
  assert.deepEqual(broadcasts, ['game-aborted']);
  assert.deepEqual(persistence.deadlineOps.at(-1), { op: 'delete', roomId: 'dchx_sweep_abort' });

  // Due mid-game clock: the active seat flags and the opponent wins.
  broadcasts.length = 0;
  const midGame = hydrate([
    ...roomEvents('dchx_sweep_expire'),
    move('dchx_sweep_expire', 10_000, 'white', { from: 'e2', to: 'e4' }),
    move('dchx_sweep_expire', 20_000, 'black', { from: 'e7', to: 'e5' }),
  ]);
  assert.equal(
    await sweepTenantRoomDeadline(
      darkChessTenant,
      midGame,
      lifecycleCtx(20_000 + ALLOWANCE_MS + 1),
    ),
    'expired',
  );
  const status = midGame.projection.state.status;
  assert.equal(status.type, 'finished');
  assert.ok(status.type === 'finished');
  assert.equal(status.winner, 'black');
  assert.equal(status.reason, 'timeout');
  assert.deepEqual(broadcasts, ['clock-expired']);
  assert.deepEqual(persistence.deadlineOps.at(-1), { op: 'delete', roomId: 'dchx_sweep_expire' });
});

test('expiry policy persists a legal move, moves the durable row, and rejects competing stale expiry', async () => {
  const roomId = 'dchx_expiry_move';
  const tenant = {
    ...darkChessTenant,
    rules: { ...darkChessTenant.rules, clockExpiryMove: () => ({ from: 'd2', to: 'd4' }) as Move },
  };
  const makeRoom = () =>
    hydrate([
      ...roomEvents(roomId),
      move(roomId, 10_000, 'white', { from: 'e2', to: 'e4' }),
      move(roomId, 20_000, 'black', { from: 'e7', to: 'e5' }),
    ]);
  const room = makeRoom();
  const persistence = recordingPersistence();
  const persisted: DarkChessTenantEvent[] = [];
  persistence.appendRoomEvent = async (_id, _seq, event) => {
    persisted.push(event);
  };
  const dueAt = 20_000 + ALLOWANCE_MS;
  const broadcasts: string[] = [];
  const ctx = {
    appendEvent: (r: typeof room, event: DarkChessTenantEvent) =>
      appendTenantEvent(tenant, r, event, { persistence }),
    broadcastEventAppended: (_r: typeof room, event: DarkChessTenantEvent) => {
      broadcasts.push(event.type);
    },
    now: () => dueAt,
  };
  await sweepTenantRoomDeadline(tenant, room, ctx);
  assert.equal(room.projection.state.status.type, 'playing');
  assert.equal(persisted.at(-1)?.type, 'move-played');
  assert.deepEqual(broadcasts, ['move-played']);
  assert.deepEqual(persistence.deadlineOps.at(-1), {
    op: 'upsert',
    roomId,
    seat: 'black',
    seatUserId: null,
    dueAt: dueAt + ALLOWANCE_MS,
  });
  assert.deepEqual(hydrate(JSON.parse(JSON.stringify(room.events))).projection, room.projection);
  assert.equal(await sweepTenantRoomDeadline(tenant, room, ctx), 'not-due');
  assert.equal(persisted.length, 1);

  // The player write is queued but has not updated the projection when the
  // sweep sees its old deadline. The serialized writer must reject that expiry.
  const competing = makeRoom();
  const player = ctx.appendEvent(
    competing,
    move(roomId, dueAt - 1, 'white', { from: 'd2', to: 'd4' }),
  );
  const sweep = sweepTenantRoomDeadline(tenant, competing, ctx);
  await player;
  assert.equal(await sweep, 'not-due');
  assert.equal(competing.events.length, 7);
  assert.equal(competing.projection.state.status.type, 'playing');
  assert.equal(competing.projection.clock?.activeColor, 'black');
});

test('an illegal expiry policy falls back to the normal timeout loss', async () => {
  const roomId = 'dchx_illegal_expiry';
  const tenant = {
    ...darkChessTenant,
    rules: { ...darkChessTenant.rules, clockExpiryMove: () => ({ from: 'e1', to: 'e8' }) as Move },
  };
  const room = hydrate([
    ...roomEvents(roomId),
    move(roomId, 10_000, 'white', { from: 'e2', to: 'e4' }),
    move(roomId, 20_000, 'black', { from: 'e7', to: 'e5' }),
  ]);
  await sweepTenantRoomDeadline(tenant, room, {
    appendEvent: (r, event) => appendTenantEvent(tenant, r, event),
    broadcastEventAppended: () => {},
    now: () => 20_000 + ALLOWANCE_MS,
  });
  assert.equal(room.events.at(-1)?.type, 'clock-expired');
  assert.deepEqual(room.projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'timeout',
  });
});
