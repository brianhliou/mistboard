import assert from 'node:assert/strict';
import test from 'node:test';
import { type RoomTimeControl, XIANGQI_SPEC_ID } from '@mistboard/game';
import {
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  isTenantEventLog,
  replayTenantEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import type {
  XiangqiCreatorPreference,
  XiangqiEvent,
  XiangqiRuntimeRoom,
  XiangqiSnapshotClient,
} from './xiangqi-runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

// Thin test-local helpers over the generic tenant* runtime — the production
// runtime is types-only. Standard Xiangqi is OPEN INFORMATION, so the coverage
// below asserts that both seats AND spectators receive the full truth board.
function createXiangqiRuntimeRoom(
  roomId: string,
  options: {
    creatorPreference?: XiangqiCreatorPreference;
    now?: number;
    timeControl?: RoomTimeControl;
  } = {},
) {
  return createTenantRuntimeRoom(xiangqiTenant, roomId, options);
}
function createXiangqiRuntimeRoomFromEvents(events: readonly XiangqiEvent[]) {
  return createTenantRuntimeRoomFromEvents(xiangqiTenant, events);
}
function replayXiangqiEvents(events: readonly XiangqiEvent[]) {
  return replayTenantEvents(xiangqiTenant, events);
}
function isXiangqiEventLog(events: readonly unknown[], roomId?: string) {
  return isTenantEventLog(xiangqiTenant, events, roomId);
}
function xiangqiSnapshotPayload(room: XiangqiRuntimeRoom, client: XiangqiSnapshotClient) {
  return tenantSnapshotPayload(xiangqiTenant, room, client);
}

const xiangqiFlag = 'MISTBOARD_XIANGQI_ENABLED';

test('Xiangqi direct runtime creation is disabled without the launch flag', () => {
  const before = process.env[xiangqiFlag];
  delete process.env[xiangqiFlag];
  try {
    const result = createXiangqiRuntimeRoom('xq-baseline', { now: 1 });
    assert.deepEqual(result, { ok: false, error: 'disabled' });
  } finally {
    restoreFlag(before);
  }
});

test('Xiangqi direct runtime creation seeds a replay-backed room', () => {
  const result = createEnabledXiangqiRuntimeRoom('xq-runtime', { now: 123 });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.room.kind, 'xiangqi');
  assert.equal(result.room.gameSpecId, XIANGQI_SPEC_ID);
  assert.deepEqual(result.room.events, [
    {
      type: 'room-created',
      at: 123,
      roomId: 'xq-runtime',
      gameSpecId: XIANGQI_SPEC_ID,
    },
  ]);
  assert.equal(result.room.projection.state.id, 'xq-runtime');
  assert.deepEqual(result.room.projection.state.status, { type: 'playing', turn: 'red' });
});

test('Xiangqi direct runtime creation can seed native red/black clocks', () => {
  const result = createEnabledXiangqiRuntimeRoom('xq-clocked', {
    now: 123,
    timeControl: { initialMs: 180_000, incrementMs: 2_000 },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.room.events.map((event) => event.type),
    ['room-created', 'clock-started'],
  );
  assert.deepEqual(result.room.projection.timeControl, {
    initialMs: 180_000,
    incrementMs: 2_000,
  });
  assert.deepEqual(result.room.projection.clock, {
    activeColor: null,
    incrementMs: 2_000,
    initialMs: 180_000,
    remainingMs: { black: 180_000, red: 180_000 },
    runningSince: null,
  });
});

function createEnabledXiangqiRuntimeRoom(
  ...args: Parameters<typeof createXiangqiRuntimeRoom>
): ReturnType<typeof createXiangqiRuntimeRoom> {
  const before = process.env[xiangqiFlag];
  process.env[xiangqiFlag] = 'true';
  try {
    return createXiangqiRuntimeRoom(...args);
  } finally {
    restoreFlag(before);
  }
}

function restoreFlag(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[xiangqiFlag];
    return;
  }
  process.env[xiangqiFlag] = value;
}

test('Xiangqi replay applies moves from the event log', () => {
  const events: XiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-replay', gameSpecId: XIANGQI_SPEC_ID },
    {
      type: 'move-played',
      at: 2,
      roomId: 'xq-replay',
      color: 'red',
      move: { from: 'b3', to: 'b4' },
    },
  ];

  const projection = replayXiangqiEvents(events);

  assert.deepEqual(projection.state.board.b4, { color: 'red', role: 'cannon' });
  assert.equal(projection.state.board.b3, undefined);
  assert.deepEqual(projection.state.status, { type: 'playing', turn: 'black' });
});

test('Xiangqi replay advances native clocks and applies timeout results', () => {
  const events: XiangqiEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'xq-clock-replay',
      gameSpecId: XIANGQI_SPEC_ID,
      timeControl: { initialMs: 10_000, incrementMs: 1_000 },
    },
    {
      type: 'clock-started',
      at: 1,
      roomId: 'xq-clock-replay',
      clock: {
        activeColor: null,
        incrementMs: 1_000,
        initialMs: 10_000,
        remainingMs: { black: 10_000, red: 10_000 },
        runningSince: null,
      },
    },
    {
      type: 'move-played',
      at: 2,
      roomId: 'xq-clock-replay',
      color: 'red',
      move: { from: 'b3', to: 'b4' },
    },
    {
      type: 'move-played',
      at: 3,
      roomId: 'xq-clock-replay',
      color: 'black',
      move: { from: 'b8', to: 'b7' },
    },
    {
      type: 'clock-expired',
      at: 10_004,
      roomId: 'xq-clock-replay',
      color: 'red',
      clock: {
        activeColor: null,
        incrementMs: 1_000,
        initialMs: 10_000,
        remainingMs: { black: 11_000, red: 0 },
        runningSince: null,
      },
    },
  ];

  const projection = replayXiangqiEvents(events);

  assert.deepEqual(projection.clock, {
    activeColor: null,
    incrementMs: 1_000,
    initialMs: 10_000,
    remainingMs: { black: 11_000, red: 0 },
    runningSince: null,
  });
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'timeout',
  });
});

test('Xiangqi replay applies resignations as native red/black endings', () => {
  const events: XiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-resign', gameSpecId: XIANGQI_SPEC_ID },
    {
      type: 'seat-resigned',
      at: 2,
      roomId: 'xq-resign',
      color: 'red',
    },
  ];

  const projection = replayXiangqiEvents(events);

  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
});

test('Xiangqi replay applies disconnect forfeits as native abandonment endings', () => {
  const events: XiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-forfeit', gameSpecId: XIANGQI_SPEC_ID },
    {
      type: 'seat-forfeited',
      at: 2,
      roomId: 'xq-forfeit',
      color: 'black',
    },
  ];

  const projection = replayXiangqiEvents(events);

  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'red',
    reason: 'abandonment',
  });
});

test('Xiangqi replay applies first-move aborts as native aborted endings', () => {
  const events: XiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-abort', gameSpecId: XIANGQI_SPEC_ID },
    {
      type: 'game-aborted',
      at: 2,
      roomId: 'xq-abort',
      reason: 'pregame-timeout',
    },
  ];

  const projection = replayXiangqiEvents(events);

  assert.deepEqual(projection.state.status, {
    type: 'aborted',
    reason: 'pregame-timeout',
  });
});

test('Xiangqi runtime hydrates from canonical events', () => {
  const events: XiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-hydrate', gameSpecId: XIANGQI_SPEC_ID },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'xq-hydrate',
      clientId: 'red-client',
      seat: 'red',
    },
    {
      type: 'move-played',
      at: 3,
      roomId: 'xq-hydrate',
      color: 'red',
      move: { from: 'b3', to: 'b4' },
    },
  ];

  const result = createXiangqiRuntimeRoomFromEvents(events);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.room.id, 'xq-hydrate');
  assert.equal(result.room.events.length, events.length);
  assert.equal(result.room.projection.seats.red, 'red-client');
  assert.deepEqual(result.room.projection.state.board.b4, { color: 'red', role: 'cannon' });
});

test('Xiangqi event logs reject wrong room families and mixed room ids', () => {
  assert.equal(
    isXiangqiEventLog([
      { type: 'room-created', at: 1, roomId: 'chess-room', variant: 'dark-chess' },
    ]),
    false,
  );
  assert.equal(
    isXiangqiEventLog([
      { type: 'room-created', at: 1, roomId: 'xq-invalid', gameSpecId: XIANGQI_SPEC_ID },
      {
        type: 'move-played',
        at: 2,
        roomId: 'other-room',
        color: 'red',
        move: { from: 'b3', to: 'b4' },
      },
    ]),
    false,
  );
});

// ── Open-information invariant ────────────────────────────────────────────────
// Standard Xiangqi is open info: both seats AND spectators receive the complete
// truth board on every update. No shrouded piece identities, no per-seat move
// redaction, no spectator empty view, no lastMove stripping.

test('Xiangqi payload sends the full truth board to both seats and spectators', () => {
  const room = enabledXiangqiRoom('xq-openinfo');
  const truthBoard = room.projection.state.board;

  const redPayload = xiangqiSnapshotPayload(room, { id: 'red-client', seat: 'red', solo: false });
  const blackPayload = xiangqiSnapshotPayload(room, {
    id: 'black-client',
    seat: 'black',
    solo: false,
  });
  const spectatorPayload = xiangqiSnapshotPayload(room, {
    id: 'spectator-client',
    seat: 'spectator',
    solo: false,
  });

  // Every client sees the identical, complete truth board — no redaction.
  assert.deepEqual(redPayload.state.board, truthBoard);
  assert.deepEqual(blackPayload.state.board, truthBoard);
  assert.deepEqual(spectatorPayload.state.board, truthBoard);

  // Sanity: the initial position's landmark pieces are present for everyone.
  for (const payload of [redPayload, blackPayload, spectatorPayload]) {
    assert.deepEqual(payload.state.board.e1, { color: 'red', role: 'general' });
    assert.deepEqual(payload.state.board.e10, { color: 'black', role: 'general' });
    assert.deepEqual(payload.state.board.b3, { color: 'red', role: 'cannon' });
  }

  // Red is to move: red's view carries legal moves; the waiting side's does not.
  assert.equal(redPayload.state.legalMoves.length > 0, true);
  assert.equal(blackPayload.state.legalMoves.length, 0);
  // Spectator view uses red's perspective (the side to move).
  assert.equal(spectatorPayload.state.legalMoves.length > 0, true);
});

test('Xiangqi payload shows move events to both seats and spectators', () => {
  const events: XiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-events', gameSpecId: XIANGQI_SPEC_ID },
    {
      type: 'move-played',
      at: 2,
      roomId: 'xq-events',
      color: 'red',
      move: { from: 'b3', to: 'b4' },
    },
  ];
  const created = createXiangqiRuntimeRoomFromEvents(events);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const room = created.room;

  const redPayload = xiangqiSnapshotPayload(room, { id: 'red-client', seat: 'red', solo: false });
  const blackPayload = xiangqiSnapshotPayload(room, {
    id: 'black-client',
    seat: 'black',
    solo: false,
  });
  const spectatorPayload = xiangqiSnapshotPayload(room, {
    id: 'spectator-client',
    seat: 'spectator',
    solo: false,
  });

  for (const payload of [redPayload, blackPayload, spectatorPayload]) {
    assert.equal(
      payload.events.some((event) => event.type === 'move-played'),
      true,
    );
    // The moved piece is visible to everyone.
    assert.deepEqual(payload.state.board.b4, { color: 'red', role: 'cannon' });
    assert.equal(payload.state.board.b3, undefined);
  }
});

function enabledXiangqiRoom(roomId: string): XiangqiRuntimeRoom {
  const result = createEnabledXiangqiRuntimeRoom(roomId, { now: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('failed to create enabled xiangqi room');
  return result.room;
}
