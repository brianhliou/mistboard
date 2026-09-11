import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DARK_XIANGQI_SPEC_ID,
  type RoomTimeControl,
  type XiangqiBoard,
  type XiangqiGameState,
} from '@mistboard/game';
import type {
  DarkXiangqiCreatorPreference,
  DarkXiangqiEvent,
  DarkXiangqiRuntimeRoom,
  DarkXiangqiSnapshotClient,
} from './dark-xiangqi-runtime.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import {
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  isTenantEventLog,
  replayTenantEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

// The former dark-xiangqi-runtime wrappers, inlined as test-local helpers over
// the generic tenant* runtime — the production runtime is now types-only. These
// preserve the hidden-info redaction regression coverage below unchanged.
function createDarkXiangqiRuntimeRoom(
  roomId: string,
  options: {
    creatorPreference?: DarkXiangqiCreatorPreference;
    now?: number;
    timeControl?: RoomTimeControl;
  } = {},
) {
  return createTenantRuntimeRoom(darkXiangqiTenant, roomId, options);
}
function createDarkXiangqiRuntimeRoomFromEvents(events: readonly DarkXiangqiEvent[]) {
  return createTenantRuntimeRoomFromEvents(darkXiangqiTenant, events);
}
function replayDarkXiangqiEvents(events: readonly DarkXiangqiEvent[]) {
  return replayTenantEvents(darkXiangqiTenant, events);
}
function isDarkXiangqiEventLog(events: readonly unknown[], roomId?: string) {
  return isTenantEventLog(darkXiangqiTenant, events, roomId);
}
function darkXiangqiSnapshotPayload(
  room: DarkXiangqiRuntimeRoom,
  client: DarkXiangqiSnapshotClient,
) {
  return tenantSnapshotPayload(darkXiangqiTenant, room, client);
}

const darkXiangqiFlag = 'MISTBOARD_DARK_XIANGQI_ENABLED';

test('Dark Xiangqi direct runtime creation is disabled without the launch flag', () => {
  const before = process.env[darkXiangqiFlag];
  delete process.env[darkXiangqiFlag];
  try {
    const result = createDarkXiangqiRuntimeRoom('xq-baseline', { now: 1 });
    assert.deepEqual(result, { ok: false, error: 'disabled' });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi direct runtime creation seeds a replay-backed room', () => {
  const result = createEnabledDarkXiangqiRuntimeRoom('xq-runtime', { now: 123 });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.room.kind, 'dark-xiangqi');
  assert.equal(result.room.gameSpecId, DARK_XIANGQI_SPEC_ID);
  assert.deepEqual(result.room.events, [
    {
      type: 'room-created',
      at: 123,
      roomId: 'xq-runtime',
      gameSpecId: DARK_XIANGQI_SPEC_ID,
    },
  ]);
  assert.equal(result.room.projection.state.id, 'xq-runtime');
  assert.deepEqual(result.room.projection.state.status, { type: 'playing', turn: 'red' });
});

test('Dark Xiangqi direct runtime creation can seed native red/black clocks', () => {
  const result = createEnabledDarkXiangqiRuntimeRoom('xq-clocked', {
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

function createEnabledDarkXiangqiRuntimeRoom(
  ...args: Parameters<typeof createDarkXiangqiRuntimeRoom>
): ReturnType<typeof createDarkXiangqiRuntimeRoom> {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    return createDarkXiangqiRuntimeRoom(...args);
  } finally {
    restoreFlag(before);
  }
}

function restoreFlag(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[darkXiangqiFlag];
    return;
  }
  process.env[darkXiangqiFlag] = value;
}

test('Dark Xiangqi replay applies moves from the event log', () => {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-replay', gameSpecId: DARK_XIANGQI_SPEC_ID },
    {
      type: 'move-played',
      at: 2,
      roomId: 'xq-replay',
      color: 'red',
      move: { from: 'b3', to: 'b4' },
    },
  ];

  const projection = replayDarkXiangqiEvents(events);

  assert.deepEqual(projection.state.board.b4, { color: 'red', role: 'cannon' });
  assert.equal(projection.state.board.b3, undefined);
  assert.deepEqual(projection.state.status, { type: 'playing', turn: 'black' });
});

test('Dark Xiangqi replay advances native clocks and applies timeout results', () => {
  const events: DarkXiangqiEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'xq-clock-replay',
      gameSpecId: DARK_XIANGQI_SPEC_ID,
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

  const projection = replayDarkXiangqiEvents(events);

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

test('Dark Xiangqi replay applies resignations as native red/black endings', () => {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-resign', gameSpecId: DARK_XIANGQI_SPEC_ID },
    {
      type: 'seat-resigned',
      at: 2,
      roomId: 'xq-resign',
      color: 'red',
    },
  ];

  const projection = replayDarkXiangqiEvents(events);

  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
});

test('Dark Xiangqi replay applies disconnect forfeits as native abandonment endings', () => {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-forfeit', gameSpecId: DARK_XIANGQI_SPEC_ID },
    {
      type: 'seat-forfeited',
      at: 2,
      roomId: 'xq-forfeit',
      color: 'black',
    },
  ];

  const projection = replayDarkXiangqiEvents(events);

  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'red',
    reason: 'abandonment',
  });
});

test('Dark Xiangqi replay applies first-move aborts as native aborted endings', () => {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-abort', gameSpecId: DARK_XIANGQI_SPEC_ID },
    {
      type: 'game-aborted',
      at: 2,
      roomId: 'xq-abort',
      reason: 'pregame-timeout',
    },
  ];

  const projection = replayDarkXiangqiEvents(events);

  assert.deepEqual(projection.state.status, {
    type: 'aborted',
    reason: 'pregame-timeout',
  });
});

test('Dark Xiangqi runtime hydrates from canonical events', () => {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-hydrate', gameSpecId: DARK_XIANGQI_SPEC_ID },
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

  const result = createDarkXiangqiRuntimeRoomFromEvents(events);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.room.id, 'xq-hydrate');
  assert.equal(result.room.events.length, events.length);
  assert.equal(result.room.projection.seats.red, 'red-client');
  assert.deepEqual(result.room.projection.state.board.b4, { color: 'red', role: 'cannon' });
});

test('Dark Xiangqi event logs reject wrong room families and mixed room ids', () => {
  assert.equal(
    isDarkXiangqiEventLog([
      { type: 'room-created', at: 1, roomId: 'chess-room', variant: 'dark-chess', offer: [] },
    ]),
    false,
  );
  assert.equal(
    isDarkXiangqiEventLog([
      { type: 'room-created', at: 1, roomId: 'xq-invalid', gameSpecId: DARK_XIANGQI_SPEC_ID },
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

test('Dark Xiangqi payload hides cannon gap squares and redacts shrouded piece identities', () => {
  const state = darkXiangqiState({
    e1: { color: 'red', role: 'general' },
    e3: { color: 'red', role: 'cannon' },
    e5: { color: 'black', role: 'advisor' },
    e8: { color: 'black', role: 'soldier' },
    a10: { color: 'black', role: 'general' },
  });
  const room = darkXiangqiRoomFixture({
    id: 'xq-redaction',
    events: [
      { type: 'room-created', at: 1, roomId: 'xq-redaction', gameSpecId: DARK_XIANGQI_SPEC_ID },
    ],
    state,
  });

  const payload = darkXiangqiSnapshotPayload(room, {
    id: 'red-client',
    seat: 'red',
    solo: false,
  });

  assert.deepEqual(payload.state.board.e5, { color: 'black', shrouded: true });
  assert.deepEqual(payload.state.board.e8, {
    piece: { color: 'black', role: 'soldier' },
    shrouded: false,
  });
  assert.equal(payload.state.board.e6, undefined);
  assert.equal(payload.state.board.e7, undefined);
  assert.equal(payload.state.visibleSquares.includes('e6'), false);
  assert.equal(payload.state.visibleSquares.includes('e7'), false);

  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, /advisor/);
  assert.doesNotMatch(json, /"e6"/);
  assert.doesNotMatch(json, /"e7"/);
});

test('Dark Xiangqi payload hides opponent move events from seated players and all move events from spectators', () => {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-events', gameSpecId: DARK_XIANGQI_SPEC_ID },
    {
      type: 'move-played',
      at: 2,
      roomId: 'xq-events',
      color: 'black',
      move: { from: 'i10', to: 'i9' },
    },
  ];
  const room = darkXiangqiRoomFixture({
    id: 'xq-events',
    events,
    state: darkXiangqiState({
      e1: { color: 'red', role: 'general' },
      a10: { color: 'black', role: 'general' },
      i10: { color: 'black', role: 'chariot' },
    }),
  });

  const redPayload = darkXiangqiSnapshotPayload(room, {
    id: 'red-client',
    seat: 'red',
    solo: false,
  });
  const spectatorPayload = darkXiangqiSnapshotPayload(room, {
    id: 'spectator-client',
    seat: 'spectator',
    solo: false,
  });

  assert.equal(
    redPayload.events.some((event) => event.type === 'move-played'),
    false,
  );
  assert.equal(
    spectatorPayload.events.some((event) => event.type === 'move-played'),
    false,
  );
  assert.deepEqual(spectatorPayload.state.board, {});
  assert.deepEqual(spectatorPayload.state.visibleSquares, []);

  const json = JSON.stringify(redPayload);
  assert.doesNotMatch(json, /"i10"/);
  assert.doesNotMatch(json, /"i9"/);
  assert.doesNotMatch(json, /chariot/);
});

test('Dark Xiangqi payload hides opponent lastMove coordinates even when squares are visible', () => {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: 'xq-lastmove', gameSpecId: DARK_XIANGQI_SPEC_ID },
    {
      type: 'move-played',
      at: 2,
      roomId: 'xq-lastmove',
      color: 'black',
      move: { from: 'e10', to: 'e9' },
    },
  ];
  const room = darkXiangqiRoomFixture({
    id: 'xq-lastmove',
    events,
    state: {
      ...darkXiangqiState({
        e1: { color: 'red', role: 'general' },
        e3: { color: 'red', role: 'chariot' },
        e9: { color: 'black', role: 'general' },
      }),
      status: { type: 'playing', turn: 'red' },
      lastMove: { from: 'e10', to: 'e9' },
    },
  });

  const redPayload = darkXiangqiSnapshotPayload(room, {
    id: 'red-client',
    seat: 'red',
    solo: false,
  });
  const blackPayload = darkXiangqiSnapshotPayload(room, {
    id: 'black-client',
    seat: 'black',
    solo: false,
  });

  assert.equal(redPayload.state.visibleSquares.includes('e9'), true);
  assert.equal(redPayload.state.lastMove, undefined);
  assert.deepEqual(blackPayload.state.lastMove, { from: 'e10', to: 'e9' });

  const json = JSON.stringify(redPayload);
  assert.doesNotMatch(json, /"lastMove"/);
  assert.doesNotMatch(json, /"e10"/);
});

function darkXiangqiState(board: XiangqiBoard): XiangqiGameState {
  return {
    id: 'xq-test',
    board,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
}

function darkXiangqiRoomFixture({
  id,
  events,
  state,
}: {
  id: string;
  events: DarkXiangqiEvent[];
  state: XiangqiGameState;
}): DarkXiangqiRuntimeRoom {
  return {
    kind: 'dark-xiangqi',
    id,
    clients: new Set([
      { seat: 'red', displaced: false },
      { seat: 'black', displaced: false },
    ]),
    events,
    projection: {
      roomId: id,
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      rated: false,
      state,
      seats: { red: 'red-client', black: 'black-client' },
    },
    gameSpecId: DARK_XIANGQI_SPEC_ID,
    abortTimer: null,
    abortDeadline: null,
    abortPhase: null,
    clockTimer: null,
    forfeitTimer: null,
    actionTimer: null,
    forfeitDeadline: null,
    forfeitSeat: null,
    gameEndRecorded: state.status.type !== 'playing',
    pendingWrites: Promise.resolve(),
    seatTokens: {},
    rated: false,
    rematch: { offers: {} },
    engineTimer: null,
    engineReservationId: null,
    pveBotId: null,
  };
}
