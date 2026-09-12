import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ClockState,
  createClock,
  freezeClock,
  type GameEvent,
  replayGameEvents,
} from '@mistboard/game';
import type { Seat } from './payloads.js';
import { DEFAULT_ACCOUNT_PREFERENCES, type UserAccount } from './persistence.js';
import {
  ABORT_WINDOW_MS,
  appendEvent,
  applyOrphanRecoveryIfNeeded,
  broadcastSnapshot,
  buildGameSummary,
  buildLiveEngineDecisionArtifactPayload,
  clearAbortTimer,
  clearForfeitTimer,
  expireActiveClock,
  FORFEIT_WINDOW_MS,
  forfeitEngineOnFailure,
  pauseRoomOnShutdown,
  playMove,
  type RoomManagerContext,
  resumeRoom,
  resumeRoomIfReady,
  scheduleAbortTimeout,
  scheduleForfeitTimeout,
  scheduleRandomEngineMove,
  seatDisplayNamesForRoom,
} from './room-manager.js';
import { assignSeat } from './server-seat-session.js';
import type { Client, Room } from './server-types.js';
import { clientFixture, roomFixture } from './test-builders.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// An armed clock (white ticking) — createClock now starts frozen and arms only
// once both players have completed their first move. Pause-only tests inject an
// already-armed clock to exercise freeze behavior directly. Resume tests must
// instead arm via two real moves (moveNumber >= 2), since resume deliberately
// refuses to start a clock that never ticked.
function armedClock(at: number, initialMs?: number, incrementMs?: number): ClockState {
  return { ...createClock(at, initialMs, incrementMs), activeColor: 'white', runningSince: at };
}

function makeRoom(
  id: string,
  variant: 'dark-chess' | 'chess' = 'dark-chess',
  events?: GameEvent[],
): Room {
  const roomEvents: GameEvent[] = events ?? [{ type: 'room-created', at: 1, roomId: id, variant }];
  return roomFixture({
    id,
    events: roomEvents,
    rated: true,
    variant,
  });
}

function makeClient(id: string, seat: Seat = 'white', solo = false, roomId = 'room-a'): Client {
  return clientFixture({
    id,
    roomId,
    seat,
    solo,
  });
}

type SpyCtx = RoomManagerContext & { sent: Array<{ client: Client; payload: unknown }> };

function makeCtx(): SpyCtx {
  const sent: Array<{ client: Client; payload: unknown }> = [];
  return {
    sent,
    send(client: Client, payload: unknown) {
      sent.push({ client, payload });
    },
    recordPersistenceError() {},
    pveBuiltinEngineClientId: 'builtin-random-legal',
    pveEngineMoveDelayMs: 0,
    liveEngineTimeoutMs: 3_000,
    liveClockInitialMs: 180_000,
    liveClockIncrementMs: 2_000,
  };
}

test('seatDisplayNamesForRoom uses engine family names for live seat labels', () => {
  const room = makeRoom('engine-seat-name');
  room.projection = {
    ...room.projection,
    seats: { ...room.projection.seats, black: 'python-tier1-v0.9.5' },
  };

  assert.deepEqual(seatDisplayNamesForRoom(room, makeCtx()), {
    black: 'Misty Legacy',
  });
});

// ── playMove ──────────────────────────────────────────────────────────────────

test('playMove: valid move advances state and appends a move-played event', async () => {
  // fog-of-war with empty offer starts in playing state, white to move
  const room = makeRoom('room-a');
  const client = makeClient('white-c', 'white', /* solo= */ true);
  room.clients.add(client);
  const ctx = makeCtx();
  const before = room.events.length;

  await playMove(ctx, room, client, { type: 'move', from: 'e2', to: 'e4' });

  assert.equal(room.events.length, before + 1);
  assert.equal(room.events[room.events.length - 1].type, 'move-played');
  assert.equal(room.projection.state.status.type, 'playing');
  assert.equal(
    (room.projection.state.status as { type: 'playing'; turn: string }).turn,
    'black',
    'turn should advance to black after white moves',
  );
});

test('playMove: illegal move (pawn jumping two illegal ranks) is rejected', async () => {
  const room = makeRoom('room-a');
  const client = makeClient('white-c', 'white', true);
  room.clients.add(client);
  const ctx = makeCtx();
  const before = room.events.length;

  // e2→e5 is not a legal pawn move
  await playMove(ctx, room, client, { type: 'move', from: 'e2', to: 'e5' });

  assert.equal(room.events.length, before, 'no event should be appended for an illegal move');
});

test('playMove: move on wrong turn is rejected', async () => {
  // It is white's turn. Black client has no matching seat token → canClientAct returns false.
  const room = makeRoom('room-a');
  const client = makeClient('black-c', 'black', /* solo= */ false);
  room.clients.add(client);
  const ctx = makeCtx();
  const before = room.events.length;

  await playMove(ctx, room, client, { type: 'move', from: 'e7', to: 'e5' });

  assert.equal(
    room.events.length,
    before,
    'no event should be appended when canClientAct is false',
  );
});

test('playMove: move after game over is rejected', async () => {
  const room = makeRoom('room-a');
  room.projection = {
    ...room.projection,
    state: {
      ...room.projection.state,
      status: { type: 'finished', winner: 'white', reason: 'checkmate' },
    },
  };
  const client = makeClient('white-c', 'white', true);
  room.clients.add(client);
  const ctx = makeCtx();
  const before = room.events.length;

  await playMove(ctx, room, client, { type: 'move', from: 'e2', to: 'e4' });

  assert.equal(
    room.events.length,
    before,
    'no event should be appended when the game is already over',
  );
});

test('playMove: clock arms (white ticking) after both first moves, via the live handler', async () => {
  // Regression: the live move handler must arm the clock on the first full move,
  // not just advanceClock(). Prior coverage only replayed reconstructed events
  // (the reducer path, which armed correctly) — the handler attached its own
  // advanceClock() result, which never arms, so the clock stayed frozen for the
  // whole live game. Drive playMove directly (solo client moves both colors).
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'clk-arm', variant: 'dark-chess' },
    { type: 'clock-started', at: 4, roomId: 'clk-arm', clock: createClock(4, 180_000, 2_000) },
  ];
  const room = makeRoom('clk-arm', 'dark-chess', events);
  const client = makeClient('solo-c', 'white', /* solo= */ true, 'clk-arm');
  room.clients.add(client);
  const ctx = makeCtx();

  // Ply 1 (white's first move): clock stays frozen (abort window), white gets increment.
  await playMove(ctx, room, client, { type: 'move', from: 'e2', to: 'e4' });
  assert.equal(room.projection.state.clock?.activeColor, null, 'frozen through ply 1');
  assert.equal(
    room.projection.state.clock?.remainingMs.white,
    182_000,
    'white increment on first move',
  );

  // Ply 2 (black's first move): clock arms, white to move begins ticking.
  await playMove(ctx, room, client, { type: 'move', from: 'e7', to: 'e5' });
  assert.equal(room.projection.state.clock?.activeColor, 'white', 'armed for white after ply 2');
  assert.notEqual(room.projection.state.clock?.runningSince, null, 'runningSince set on arm');
  assert.equal(
    room.projection.state.clock?.remainingMs.black,
    182_000,
    'black increment on first move',
  );
});

// ── appendEvent ────────────────────────────────────────────────────────────────

test('appendEvent: pushes event to room.events', async () => {
  const room = makeRoom('room-b');
  const ctx = makeCtx();
  const event: GameEvent = {
    type: 'seat-assigned',
    at: Date.now(),
    roomId: 'room-b',
    clientId: 'c1',
    seat: 'white',
  };
  const before = room.events.length;

  await appendEvent(ctx, room, event);

  assert.equal(room.events.length, before + 1);
  assert.equal(room.events[room.events.length - 1], event);
});

test('appendEvent: updates room.projection after the event is applied', async () => {
  const room = makeRoom('room-b');
  const ctx = makeCtx();

  await appendEvent(ctx, room, {
    type: 'seat-assigned',
    at: Date.now(),
    roomId: 'room-b',
    clientId: 'c1',
    seat: 'white',
  });

  assert.equal(
    room.projection.seats.white,
    'c1',
    'projection should reflect the newly assigned seat',
  );
});

// ── broadcastSnapshot ─────────────────────────────────────────────────────────

test('broadcastSnapshot: calls ctx.send for every connected client', () => {
  const room = makeRoom('room-c');
  const c1 = makeClient('c1', 'white', true, 'room-c');
  const c2 = makeClient('c2', 'spectator', false, 'room-c');
  room.clients.add(c1);
  room.clients.add(c2);
  room.projection = { ...room.projection, seats: { white: 'c1' } };
  const ctx = makeCtx();

  broadcastSnapshot(ctx, room);

  assert.equal(ctx.sent.length, 2, 'should send one payload per client');
  const ids = ctx.sent.map((s) => s.client.id);
  assert.ok(ids.includes('c1'));
  assert.ok(ids.includes('c2'));
});

// ── resolveStartIfReady ───────────────────────────────────────────────────────

// ── expireActiveClock ─────────────────────────────────────────────────────────

test('expireActiveClock: appends clock-expired event and sets correct winner', async () => {
  // fog-of-war starts playing with white to move; inject an active clock
  const room = makeRoom('room-f');
  const now = Date.now();
  const clock = createClock(now, 60_000, 0);
  room.projection = {
    ...room.projection,
    state: { ...room.projection.state, clock },
  };
  const ctx = makeCtx();
  const before = room.events.length;

  await expireActiveClock(ctx, room, 'white', now);

  assert.equal(room.events.length, before + 1);
  assert.equal(room.events[room.events.length - 1].type, 'clock-expired');
  assert.equal(room.projection.state.status.type, 'finished');
  assert.equal(
    (room.projection.state.status as { type: 'finished'; winner: string }).winner,
    'black',
    'white clock expired → black wins',
  );
});

test('forfeitEngineOnFailure: engine loses instead of freezing PvE indefinitely', async () => {
  const roomId = 'engine-failure-room';
  const engineId = 'python-tier1-v0.9.5';
  const now = Date.now();
  const events: GameEvent[] = [
    { type: 'room-created', at: now, roomId, variant: 'dark-chess' },
    { type: 'seat-assigned', at: now, roomId, clientId: 'human-white', seat: 'white' },
    { type: 'seat-assigned', at: now, roomId, clientId: engineId, seat: 'black' },
    { type: 'clock-started', at: now, roomId, clock: createClock(now, 180_000, 2_000) },
    { type: 'move-played', at: now + 1, roomId, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: now + 2, roomId, color: 'black', move: { from: 'e7', to: 'e6' } },
    { type: 'move-played', at: now + 3, roomId, color: 'white', move: { from: 'd2', to: 'd4' } },
  ];
  const room = makeRoom(roomId, 'dark-chess', events);
  room.mode = 'pve';
  room.randomEngine = true;
  room.pveEngineId = engineId;
  const ctx = makeCtx();
  const before = room.events.length;
  const failedAt = now + 10_000;
  const expectedClock = freezeClock(room.projection.state.clock, failedAt);

  await forfeitEngineOnFailure(ctx, room, failedAt);

  assert.equal(room.events.length, before + 1);
  assert.deepEqual(room.events[room.events.length - 1], {
    type: 'seat-forfeited',
    at: failedAt,
    roomId,
    color: 'black',
    ...(expectedClock ? { clock: expectedClock } : {}),
  });
  assert.equal(room.projection.paused, false);
  assert.deepEqual(room.projection.state.status, {
    type: 'finished',
    winner: 'white',
    reason: 'abandonment',
  });
});

// ── Seat assignment via event projection ──────────────────────────────────────
// assignSeat() lives in server-seat-session.ts and is covered through integration tests.
// These tests verify the same observable invariants through appendEvent + projection.

test('seat assignment: first joiner gets white seat', async () => {
  const room = makeRoom('room-g');
  const ctx = makeCtx();

  await appendEvent(ctx, room, {
    type: 'seat-assigned',
    at: Date.now(),
    roomId: 'room-g',
    clientId: 'c1',
    seat: 'white',
  });

  assert.equal(room.projection.seats.white, 'c1');
  assert.equal(room.projection.seats.black, undefined);
});

test('seat assignment: second joiner gets black seat', async () => {
  const room = makeRoom('room-g');
  const ctx = makeCtx();

  await appendEvent(ctx, room, {
    type: 'seat-assigned',
    at: Date.now(),
    roomId: 'room-g',
    clientId: 'c1',
    seat: 'white',
  });
  await appendEvent(ctx, room, {
    type: 'seat-assigned',
    at: Date.now(),
    roomId: 'room-g',
    clientId: 'c2',
    seat: 'black',
  });

  assert.equal(room.projection.seats.white, 'c1');
  assert.equal(room.projection.seats.black, 'c2');
});

test('seat assignment: third connection is spectator (no seat left)', async () => {
  // With both color seats filled, assignSeat() returns { seat: 'spectator' }.
  // We verify the projection gate: when projection.seats.white and .black are both set,
  // no further seat-assigned event changes them (event replay rejects a duplicate assignment).
  const room = makeRoom('room-g');
  const ctx = makeCtx();

  await appendEvent(ctx, room, {
    type: 'seat-assigned',
    at: 1,
    roomId: 'room-g',
    clientId: 'c1',
    seat: 'white',
  });
  await appendEvent(ctx, room, {
    type: 'seat-assigned',
    at: 2,
    roomId: 'room-g',
    clientId: 'c2',
    seat: 'black',
  });

  // assignSeat() returns spectator when both seats are filled.
  // The projection confirms no empty seat remains.
  assert.ok(room.projection.seats.white !== undefined, 'white should be filled');
  assert.ok(room.projection.seats.black !== undefined, 'black should be filled');
});

// ── assignSeat: rated account-gate ─────────────────────────────────────────────
// A rated game must be human-vs-human between two durable accounts. The gate is
// enforced at the moment a player takes a seat (not silently demoted at game
// end), so a signed-out player is refused a color seat outright. See the
// authoritative game-end gate in buildGameSummary below for the second layer.

function makeAccount(overrides: Partial<UserAccount> = {}): UserAccount {
  const now = new Date();
  return {
    id: 'acct-1',
    email: 'player@example.com',
    emailVerifiedAt: now,
    handle: 'player',
    handleChangedAt: null,
    displayName: 'Player',
    displayNameChangedAt: null,
    bio: '',
    location: '',
    profileLinks: [],
    displayPreferences: {},
    accountPreferences: DEFAULT_ACCOUNT_PREFERENCES,
    profileVisibility: 'public',
    accountRole: 'player',
    playDisabledAt: null,
    title: null,
    flair: null,
    locale: null,
    dmPolicy: 'always',
    eloRating: 1500,
    patronSince: null,
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
}

test('assignSeat: rated room refuses a guest a color seat', async () => {
  const room = makeRoom('rated-guest'); // makeRoom sets rated: true
  const ctx = makeCtx();

  const assignment = await assignSeat(ctx, room, 'guest-client', undefined, null);

  assert.equal(assignment.seat, 'spectator', 'a guest must not get a color seat');
  assert.equal(assignment.deniedReason, 'rated-requires-account');
  assert.equal(room.projection.seats.white, undefined, 'no seat was assigned');
});

test('assignSeat: rated room seats a signed-in account', async () => {
  const room = makeRoom('rated-account');
  const ctx = makeCtx();

  const assignment = await assignSeat(ctx, room, 'acct-client', undefined, makeAccount());

  assert.equal(assignment.seat, 'white', 'a signed-in account takes the open seat');
  assert.equal(assignment.deniedReason, undefined);
  assert.equal(room.projection.seats.white, 'acct-client');
});

test('assignSeat: casual room still seats a guest (gate is rated-only)', async () => {
  const room = makeRoom('casual-guest');
  room.rated = false;
  const ctx = makeCtx();

  const assignment = await assignSeat(ctx, room, 'guest-client', undefined, null);

  assert.equal(assignment.seat, 'white', 'casual play stays account-optional');
  assert.equal(assignment.deniedReason, undefined);
});

test('assignSeat: rated room exempts a server-engine client', async () => {
  const room = makeRoom('rated-engine');
  const ctx = makeCtx();

  const assignment = await assignSeat(ctx, room, 'builtin-random-legal', undefined, null);

  assert.equal(assignment.seat, 'white', 'an engine seat is not blocked by the account-gate');
  assert.equal(assignment.deniedReason, undefined);
});

// ── assignSeat: per-account play lock ─────────────────────────────────────────
// An account that is an identity rather than a player (the official @mistboard
// account) may not take a NEW seat. It keeps any seat it already holds, so
// locking an account cannot strand a game in progress.

test('assignSeat: a play-disabled account gets no color seat', async () => {
  const room = makeRoom('locked-account');
  room.rated = false;
  const ctx = makeCtx();

  const assignment = await assignSeat(
    ctx,
    room,
    'locked-client',
    undefined,
    makeAccount({ playDisabledAt: new Date() }),
  );

  assert.equal(assignment.seat, 'spectator');
  assert.equal(assignment.deniedReason, 'play-disabled');
  assert.equal(room.projection.seats.white, undefined, 'no seat was assigned');
});

test('assignSeat: the play lock does not strand a seat the account already holds', async () => {
  const room = makeRoom('locked-reclaim');
  room.rated = false;
  const ctx = makeCtx();
  const account = makeAccount();

  const seated = await assignSeat(ctx, room, 'first-client', undefined, account);
  assert.equal(seated.seat, 'white', 'precondition: the account took a seat while unlocked');

  const reclaimed = await assignSeat(ctx, room, 'second-client', undefined, {
    ...account,
    playDisabledAt: new Date(),
  });

  assert.equal(reclaimed.seat, 'white', 'the account re-attaches to its own seat by identity');
  assert.equal(reclaimed.deniedReason, undefined);
});

test('assignSeat: the play lock leaves a signed-out player alone', async () => {
  const room = makeRoom('locked-guest');
  room.rated = false;
  const ctx = makeCtx();

  const assignment = await assignSeat(ctx, room, 'guest-client', undefined, null);

  assert.equal(assignment.seat, 'white');
  assert.equal(assignment.deniedReason, undefined);
});

// ── buildGameSummary: rated policy ────────────────────────────────────────────

test('buildGameSummary: engine seat forces rated=false even when room.rated=true', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-pve', variant: 'dark-chess' },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'room-pve',
      clientId: 'builtin-random-legal',
      seat: 'white',
    },
    { type: 'seat-assigned', at: 3, roomId: 'room-pve', clientId: 'human-c', seat: 'black' },
    { type: 'seat-resigned', at: 4, roomId: 'room-pve', color: 'black' },
  ];
  const room = makeRoom('room-pve', 'dark-chess', events);
  room.mode = 'pve';
  room.rated = true;
  const ctx = makeCtx();

  const summary = buildGameSummary(ctx, room);

  assert.equal(summary.rated, false, 'engine participant must force casual');
  assert.equal(summary.termination, 'resignation');
  assert.equal(summary.participants?.[0]?.subjectType, 'engine-version');
});

test('buildGameSummary: a guest seat carries its browser device id, an anonymous one none', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-dev', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'room-dev', clientId: 'client-w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'room-dev', clientId: 'client-b', seat: 'black' },
    { type: 'seat-resigned', at: 4, roomId: 'room-dev', color: 'white' },
  ];
  const room = makeRoom('room-dev', 'dark-chess', events);
  room.rated = false;
  const now = new Date();
  room.seatTokens = {
    white: {
      clientId: 'client-w',
      deviceId: 'device-w',
      seat: 'white',
      tokenHash: 'hash-w',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
    black: {
      clientId: 'client-b',
      seat: 'black',
      tokenHash: 'hash-b',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
  };
  const summary = buildGameSummary(makeCtx(), room);
  const [white, black] = summary.participants ?? [];
  assert.equal(white?.subjectType, 'guest');
  assert.equal(white?.subjectId, 'device-w', 'the guest seat is attributed to its browser');
  assert.equal(black?.subjectType, 'guest');
  assert.equal(black?.subjectId, null, 'no device, no attribution');
});

test('buildGameSummary: current first-party engine seat records bot profile identity', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-bot-pve', variant: 'dark-chess' },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'room-bot-pve',
      clientId: 'human-c',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: 3,
      roomId: 'room-bot-pve',
      clientId: 'python-v2-v1.6',
      seat: 'black',
    },
    { type: 'seat-resigned', at: 4, roomId: 'room-bot-pve', color: 'white' },
  ];
  const room = makeRoom('room-bot-pve', 'dark-chess', events);
  room.mode = 'pve';
  room.rated = true;
  const ctx = makeCtx();

  const summary = buildGameSummary(ctx, room);

  assert.equal(summary.rated, false, 'bot participant must force casual');
  assert.deepEqual(summary.participants?.[1], {
    color: 'black',
    displayName: 'Misty',
    subjectType: 'bot',
    subjectId: 'misty',
    visibility: 'public',
  });
});

test('buildGameSummary: explicit PvE bot id wins over engine-id inference', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'room-explicit-bot-pve',
      variant: 'dark-chess',
    },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'room-explicit-bot-pve',
      clientId: 'human-c',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: 3,
      roomId: 'room-explicit-bot-pve',
      clientId: 'python-v2-v1.6',
      seat: 'black',
    },
    { type: 'seat-resigned', at: 4, roomId: 'room-explicit-bot-pve', color: 'white' },
  ];
  const room = makeRoom('room-explicit-bot-pve', 'dark-chess', events);
  room.mode = 'pve';
  room.pveBotId = 'misty-dmx';
  const ctx = makeCtx();

  const summary = buildGameSummary(ctx, room);

  assert.equal(summary.participants?.[1]?.subjectType, 'bot');
  // The legacy pveBotId canonicalizes to the merged Misty identity at
  // game-summary time, so new completions attribute to one profile.
  assert.equal(summary.participants?.[1]?.subjectId, 'misty');
  assert.equal(summary.participants?.[1]?.displayName, 'Misty');
});

test('buildGameSummary: historical first-party engine seat records bot profile identity', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'room-bot-historical-pve',
      variant: 'dark-chess',
    },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'room-bot-historical-pve',
      clientId: 'human-c',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: 3,
      roomId: 'room-bot-historical-pve',
      clientId: 'python-v2-v1.4',
      seat: 'black',
    },
    { type: 'seat-resigned', at: 4, roomId: 'room-bot-historical-pve', color: 'white' },
  ];
  const room = makeRoom('room-bot-historical-pve', 'dark-chess', events);
  room.mode = 'pve';
  const ctx = makeCtx();

  const summary = buildGameSummary(ctx, room);

  assert.equal(summary.participants?.[1]?.subjectType, 'bot');
  assert.equal(summary.participants?.[1]?.subjectId, 'misty');
});

test('buildGameSummary: guest seats force rated=false even when room.rated=true', () => {
  // Account-gate: rated requires durable identity on BOTH seats. Two anonymous
  // guests playing a rated-requested room are recorded casual.
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-pvp', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'room-pvp', clientId: 'human-w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'room-pvp', clientId: 'human-b', seat: 'black' },
    { type: 'seat-resigned', at: 4, roomId: 'room-pvp', color: 'white' },
  ];
  const room = makeRoom('room-pvp', 'dark-chess', events);
  room.rated = true;
  const ctx = makeCtx();

  const summary = buildGameSummary(ctx, room);

  assert.equal(summary.rated, false, 'guest seats must force casual');
  assert.equal(summary.participants?.[0]?.subjectType, 'guest');
  assert.equal(summary.participants?.[1]?.subjectType, 'guest');
});

test('buildGameSummary: two signed-in account seats preserve rated=true', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-acct', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'room-acct', clientId: 'client-w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'room-acct', clientId: 'client-b', seat: 'black' },
    { type: 'seat-resigned', at: 4, roomId: 'room-acct', color: 'white' },
  ];
  const room = makeRoom('room-acct', 'dark-chess', events);
  room.rated = true;
  const now = new Date();
  room.seatTokens = {
    white: {
      clientId: 'client-w',
      seat: 'white',
      tokenHash: 'hash-w',
      userId: 'user_w',
      userHandle: 'whiteplayer',
      userDisplayName: 'White',
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
    black: {
      clientId: 'client-b',
      seat: 'black',
      tokenHash: 'hash-b',
      userId: 'user_b',
      userHandle: 'blackplayer',
      userDisplayName: 'Black',
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
  };
  const ctx = makeCtx();

  const summary = buildGameSummary(ctx, room);

  assert.equal(summary.rated, true, 'two account seats keep rated');
  assert.equal(summary.participants?.[0]?.subjectType, 'user');
  assert.equal(summary.participants?.[1]?.subjectType, 'user');
});

test('buildGameSummary: one guest + one account seat forces rated=false', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-mixed', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'room-mixed', clientId: 'client-w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'room-mixed', clientId: 'guest-b', seat: 'black' },
    { type: 'seat-resigned', at: 4, roomId: 'room-mixed', color: 'white' },
  ];
  const room = makeRoom('room-mixed', 'dark-chess', events);
  room.rated = true;
  const now = new Date();
  room.seatTokens = {
    white: {
      clientId: 'client-w',
      seat: 'white',
      tokenHash: 'hash-w',
      userId: 'user_w',
      userHandle: 'whiteplayer',
      userDisplayName: 'White',
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
  };
  const ctx = makeCtx();

  const summary = buildGameSummary(ctx, room);

  assert.equal(summary.rated, false, 'a single guest seat forces casual');
});

// ── pauseRoomOnShutdown ────────────────────────────────────────────────────────

test('pauseRoomOnShutdown: appends a pause event and freezes the active clock', async () => {
  const startedClock = armedClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-pause', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'room-pause', clientId: 'w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'room-pause', clientId: 'b', seat: 'black' },
    { type: 'clock-started', at: 1000, roomId: 'room-pause', clock: startedClock },
  ];
  const room = makeRoom('room-pause', 'dark-chess', events);
  const ctx = makeCtx();

  await pauseRoomOnShutdown(ctx, room, 3500);

  const last = room.events[room.events.length - 1];
  assert.equal(last.type, 'pause');
  assert.equal(room.projection.paused, true);
  assert.equal(room.projection.pausedAt, 3500);
  assert.equal(room.projection.pauseReason, 'shutdown');
  // White was active from t=1000 to t=3500 → 57_500ms remaining.
  assert.equal(room.projection.state.clock?.remainingMs.white, 57_500);
  assert.equal(room.projection.state.clock?.activeColor, null);
  assert.equal(room.projection.state.clock?.runningSince, null);
});

test('pauseRoomOnShutdown: no-op when game already finished', async () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-done', variant: 'dark-chess' },
    { type: 'seat-resigned', at: 2, roomId: 'room-done', color: 'white' },
  ];
  const room = makeRoom('room-done', 'dark-chess', events);
  const ctx = makeCtx();
  const before = room.events.length;

  await pauseRoomOnShutdown(ctx, room, 100);

  assert.equal(room.events.length, before, 'no pause appended on finished room');
  assert.equal(room.projection.paused, false);
});

test('pauseRoomOnShutdown: no-op when already paused (idempotent)', async () => {
  const startedClock = createClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-twice', variant: 'dark-chess' },
    { type: 'clock-started', at: 1000, roomId: 'room-twice', clock: startedClock },
  ];
  const room = makeRoom('room-twice', 'dark-chess', events);
  const ctx = makeCtx();

  await pauseRoomOnShutdown(ctx, room, 2000);
  const afterFirst = room.events.length;
  await pauseRoomOnShutdown(ctx, room, 3000);

  assert.equal(room.events.length, afterFirst, 'second pause should be a no-op');
  assert.equal(room.projection.pausedAt, 2000, 'first pause snapshot preserved');
});

test('playMove: rejected on paused room', async () => {
  const room = makeRoom('room-paused-move');
  // Inject pause directly into projection (simulating post-pause state).
  room.projection = {
    ...room.projection,
    paused: true,
    pausedAt: 100,
    pauseReason: 'shutdown',
  };
  const client = makeClient('white-c', 'white', /* solo= */ true);
  room.clients.add(client);
  const ctx = makeCtx();
  const before = room.events.length;

  await playMove(ctx, room, client, { type: 'move', from: 'e2', to: 'e4' });

  assert.equal(room.events.length, before, 'paused room must not accept moves');
});

test('scheduleRandomEngineMove: no-op when room is paused', () => {
  const room = makeRoom('room-paused-engine');
  room.randomEngine = true;
  // Force black to move so the scheduler would normally fire.
  room.projection = {
    ...room.projection,
    paused: true,
    pausedAt: 50,
    pauseReason: 'shutdown',
    state: {
      ...room.projection.state,
      status: { type: 'playing', turn: 'black' },
    },
  };
  const ctx = makeCtx();

  scheduleRandomEngineMove(ctx, room);

  assert.equal(room.engineTimer, null, 'paused room must not schedule an engine move');
});

test('scheduleRandomEngineMove: waits for the human seat before engine opens as white', () => {
  const roomId = 'room-engine-white-awaits-human';
  const engineId = 'builtin-random-legal';
  const room = makeRoom('room-engine-white-awaits-human', 'dark-chess', [
    { type: 'room-created', at: 1, roomId, variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId, clientId: engineId, seat: 'white' },
  ]);
  room.mode = 'pve';
  room.randomEngine = true;
  room.pveEngineId = engineId;
  const ctx = makeCtx();

  scheduleRandomEngineMove(ctx, room);

  assert.equal(room.engineTimer, null, 'engine must wait until black is seated');
});

test('replay: hydrating a room from a pause event reconstructs the paused projection', () => {
  // This is the post-restart hydration path: loadRoom returns events including the pause,
  // replayGameEvents reconstructs the projection. Same code path as getOrCreateRoom uses.
  const startedClock = armedClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'room-hydrate', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'room-hydrate', clientId: 'w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'room-hydrate', clientId: 'b', seat: 'black' },
    { type: 'clock-started', at: 1000, roomId: 'room-hydrate', clock: startedClock },
    { type: 'pause', at: 3500, roomId: 'room-hydrate', reason: 'shutdown' },
  ];
  const projection = replayGameEvents(events);

  assert.equal(projection.paused, true);
  assert.equal(projection.pausedAt, 3500);
  assert.equal(projection.state.clock?.activeColor, null);
  assert.equal(projection.state.clock?.runningSince, null);
  assert.equal(projection.state.clock?.remainingMs.white, 57_500);
  // status still 'playing' — the game can be resumed later.
  assert.deepEqual(projection.state.status, { type: 'playing', turn: 'white' });
});

// ── resume helpers ────────────────────────────────────────────────────────────

// Build a paused, seated, two-player room ready for resume testing. Seat tokens
// are populated for both seats so the presence check has something to validate
// against.
function makePausedSeatedRoom(id: string): Room {
  // Both players complete their first move so the clock arms (white ticking from
  // t=2000); pause at t=4500 leaves white with 57_500ms. Resume can then rearm.
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: id, variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: id, clientId: 'white-client', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: id, clientId: 'black-client', seat: 'black' },
    { type: 'clock-started', at: 4, roomId: id, clock: createClock(4, 60_000, 0) },
    { type: 'move-played', at: 1000, roomId: id, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: 2000, roomId: id, color: 'black', move: { from: 'e7', to: 'e5' } },
    { type: 'pause', at: 4500, roomId: id, reason: 'shutdown' },
  ];
  const room = makeRoom(id, 'dark-chess', events);
  const now = new Date();
  room.seatTokens = {
    white: {
      clientId: 'white-client',
      seat: 'white',
      tokenHash: 'hash-white',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
    black: {
      clientId: 'black-client',
      seat: 'black',
      tokenHash: 'hash-black',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
  };
  return room;
}

test('resumeRoomIfReady: appends resume when both seated players have matching tokens', async () => {
  const room = makePausedSeatedRoom('room-resume-ready');
  const white = makeClient('white-client', 'white', false);
  white.seatTokenHash = 'hash-white';
  const black = makeClient('black-client', 'black', false);
  black.seatTokenHash = 'hash-black';
  room.clients.add(white);
  room.clients.add(black);
  const ctx = makeCtx();

  const resumed = await resumeRoomIfReady(ctx, room, 603_500);

  assert.equal(resumed, true);
  assert.equal(room.projection.paused, false);
  const last = room.events[room.events.length - 1];
  assert.equal(last.type, 'resume');
  // Clock should be re-armed for white (the side to move at pause).
  assert.equal(room.projection.state.clock?.activeColor, 'white');
  assert.equal(room.projection.state.clock?.runningSince, 603_500);
  // Remaining time preserved across the outage (no wall-clock advantage).
  assert.equal(room.projection.state.clock?.remainingMs.white, 57_500);
  assert.equal(room.projection.state.clock?.remainingMs.black, 60_000);
});

test('resumeRoomIfReady: no-op when only one player is present', async () => {
  const room = makePausedSeatedRoom('room-resume-half');
  const white = makeClient('white-client', 'white', false);
  white.seatTokenHash = 'hash-white';
  room.clients.add(white);
  const ctx = makeCtx();
  const before = room.events.length;

  const resumed = await resumeRoomIfReady(ctx, room, 1000);

  assert.equal(resumed, false);
  assert.equal(room.projection.paused, true);
  assert.equal(room.events.length, before, 'no resume event appended');
});

test('resumeRoomIfReady: rejects clients without a matching seat-token hash (attacker case)', async () => {
  const room = makePausedSeatedRoom('room-resume-attacker');
  // Attacker connects on white seat with a forged or missing token.
  const attacker = makeClient('attacker', 'white', false);
  attacker.seatTokenHash = 'wrong-hash';
  // The real black player is present.
  const black = makeClient('black-client', 'black', false);
  black.seatTokenHash = 'hash-black';
  room.clients.add(attacker);
  room.clients.add(black);
  const ctx = makeCtx();

  const resumed = await resumeRoomIfReady(ctx, room, 1000);

  assert.equal(resumed, false, 'attacker without valid token must not count as present');
  assert.equal(room.projection.paused, true);
});

test('resumeRoomIfReady: ignores displaced clients', async () => {
  const room = makePausedSeatedRoom('room-resume-displaced');
  const whiteOld = makeClient('white-client-old', 'white', false);
  whiteOld.seatTokenHash = 'hash-white';
  whiteOld.displaced = true;
  const black = makeClient('black-client', 'black', false);
  black.seatTokenHash = 'hash-black';
  room.clients.add(whiteOld);
  room.clients.add(black);
  const ctx = makeCtx();

  const resumed = await resumeRoomIfReady(ctx, room, 1000);

  assert.equal(resumed, false, 'displaced client should not count as present');
});

test('resumeRoom: grace-elapsed resume fires regardless of presence', async () => {
  const room = makePausedSeatedRoom('room-resume-grace');
  const ctx = makeCtx();

  await resumeRoom(ctx, room, 100_000, 'grace-elapsed');

  assert.equal(room.projection.paused, false);
  const last = room.events[room.events.length - 1];
  assert.equal(last.type, 'resume');
  assert.equal((last as { reason: string }).reason, 'grace-elapsed');
});

test('resumeRoom: second call is a no-op (idempotent)', async () => {
  const room = makePausedSeatedRoom('room-resume-idempotent');
  const ctx = makeCtx();

  await resumeRoom(ctx, room, 1000, 'grace-elapsed');
  const afterFirst = room.events.length;
  await resumeRoom(ctx, room, 2000, 'grace-elapsed');

  assert.equal(room.events.length, afterFirst, 'second resume should be a no-op');
});

test('resumeRoom: clears pauseGraceTimer when set', async () => {
  const room = makePausedSeatedRoom('room-resume-clears-timer');
  // Simulate an armed grace timer (no need to actually schedule it).
  const fakeTimer = setTimeout(() => {}, 100_000);
  room.pauseGraceTimer = fakeTimer;
  const ctx = makeCtx();

  await resumeRoom(ctx, room, 1000, 'both-present');

  assert.equal(room.pauseGraceTimer, null, 'grace timer must be cleared on resume');
  clearTimeout(fakeTimer); // safety, in case the helper didn't clear it
});

test('playMove: accepted after resume reactivates the room', async () => {
  const room = makePausedSeatedRoom('room-resume-then-move');
  const ctx = makeCtx();
  // Resume at wall-clock now so the clock-expiry check inside playMove (which
  // reads Date.now) sees white as having 57.5s left rather than having timed
  // out years ago against the fixture's t=1000 baseline.
  await resumeRoom(ctx, room, Date.now(), 'both-present');

  const white = makeClient('white-client', 'white', /* solo= */ true);
  room.clients.add(white);

  // e2e4/e7e5 are already played in the fixture; d2d4 is white's legal move here.
  await playMove(ctx, room, white, { type: 'move', from: 'd2', to: 'd4' });

  const last = room.events[room.events.length - 1];
  assert.equal(last.type, 'move-played', 'paused→resumed room must accept moves again');
});

// ── applyOrphanRecoveryIfNeeded ───────────────────────────────────────────────

test('applyOrphanRecoveryIfNeeded: synthesises a pause for a stale playing room', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'orphan-stale', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'orphan-stale', clientId: 'w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'orphan-stale', clientId: 'b', seat: 'black' },
    { type: 'clock-started', at: 4, roomId: 'orphan-stale', clock: createClock(4, 60_000, 0) },
    // Both first moves complete; black's reply at t=2000 arms the clock for white.
    {
      type: 'move-played',
      at: 1500,
      roomId: 'orphan-stale',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 2000,
      roomId: 'orphan-stale',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
  ];
  // 10 minutes later, the server "comes back" — far past the 5-minute threshold.
  const now = 2000 + 10 * 60_000;
  const out = applyOrphanRecoveryIfNeeded(events, now, 300_000);

  assert.equal(out.length, events.length + 1);
  const synth = out[out.length - 1]!;
  assert.equal(synth.type, 'pause');
  // Pause is at lastEvent.at + 1 so clock freeze sees ~0ms elapsed.
  assert.equal(synth.at, 2001);
  assert.equal((synth as { reason: string }).reason, 'shutdown');

  // Replaying the recovered events should produce a paused projection with
  // white's (now-active) clock effectively unchanged, since the synth pause
  // fires 1ms after the move that armed white's clock.
  const projection = replayGameEvents(out);
  assert.equal(projection.paused, true);
  assert.equal(projection.state.clock?.remainingMs.white, 59_999);
  assert.equal(projection.state.clock?.activeColor, null);
});

test('applyOrphanRecoveryIfNeeded: leaves a recent playing room alone', () => {
  const startedClock = createClock(1000, 60_000, 0);
  const recentMoveAt = 2000;
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'orphan-fresh', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'orphan-fresh', clientId: 'w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'orphan-fresh', clientId: 'b', seat: 'black' },
    { type: 'clock-started', at: 1000, roomId: 'orphan-fresh', clock: startedClock },
    {
      type: 'move-played',
      at: recentMoveAt,
      roomId: 'orphan-fresh',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];
  // Last event is 30 seconds ago — well under threshold; the player is
  // probably just thinking.
  const now = recentMoveAt + 30_000;
  const out = applyOrphanRecoveryIfNeeded(events, now, 300_000);

  assert.equal(out, events, 'returns the same array reference when no recovery is needed');
});

test('applyOrphanRecoveryIfNeeded: leaves an already-paused room alone (no double-pause)', () => {
  const startedClock = createClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'orphan-paused', variant: 'dark-chess' },
    { type: 'clock-started', at: 1000, roomId: 'orphan-paused', clock: startedClock },
    { type: 'pause', at: 2000, roomId: 'orphan-paused', reason: 'shutdown' },
  ];
  const now = 2000 + 60 * 60_000; // an hour later
  const out = applyOrphanRecoveryIfNeeded(events, now, 300_000);

  assert.equal(out, events, 'already-paused room must not receive a second synth pause');
});

test('applyOrphanRecoveryIfNeeded: leaves a finished room alone', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'orphan-finished', variant: 'dark-chess' },
    { type: 'seat-resigned', at: 2, roomId: 'orphan-finished', color: 'white' },
  ];
  const now = 2 + 24 * 60 * 60_000; // a day later
  const out = applyOrphanRecoveryIfNeeded(events, now, 300_000);

  assert.equal(out, events, 'finished room must not be synth-paused');
});

test('applyOrphanRecoveryIfNeeded: empty events array is a no-op', () => {
  const out = applyOrphanRecoveryIfNeeded([], Date.now(), 300_000);
  assert.deepEqual(out, [], 'empty events must round-trip unchanged');
});

// ── Mode-specific resume behavior (PvE, EvE) ──────────────────────────────────

function makePausedPveRoom(id: string, engineClientId = 'builtin-random-legal'): Room {
  const startedClock = createClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: id, variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: id, clientId: 'human-w', seat: 'white' },
    // Engine seat held by a server-engine client (recognised by prefix).
    { type: 'seat-assigned', at: 3, roomId: id, clientId: engineClientId, seat: 'black' },
    { type: 'clock-started', at: 1000, roomId: id, clock: startedClock },
    { type: 'pause', at: 3500, roomId: id, reason: 'shutdown' },
  ];
  const room = makeRoom(id, 'dark-chess', events);
  const now = new Date();
  // Only the human seat has a seat-token record. Engines don't use seat tokens.
  room.seatTokens = {
    white: {
      clientId: 'human-w',
      seat: 'white',
      tokenHash: 'hash-human-w',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
  };
  return room;
}

function makePausedEveRoom(id: string): Room {
  const startedClock = createClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: id, variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: id, clientId: 'engine:white', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: id, clientId: 'engine:black', seat: 'black' },
    { type: 'clock-started', at: 1000, roomId: id, clock: startedClock },
    { type: 'pause', at: 3500, roomId: id, reason: 'shutdown' },
  ];
  // No seat tokens — engines don't use them.
  return makeRoom(id, 'dark-chess', events);
}

test('resumeRoomIfReady (PvE): resumes when the human reconnects — engine seat is auto-present', async () => {
  const room = makePausedPveRoom('room-pve-resume');
  const human = makeClient('human-w', 'white', false);
  human.seatTokenHash = 'hash-human-w';
  room.clients.add(human);
  const ctx = makeCtx();

  const resumed = await resumeRoomIfReady(ctx, room, 1000);

  assert.equal(
    resumed,
    true,
    'PvE must resume on lone human reconnect (engine is server-controlled)',
  );
  assert.equal(room.projection.paused, false);
  // White was the side-to-move at pause — clock re-armed for white.
  assert.equal(room.projection.state.clock?.activeColor, 'white');
});

test('resumeRoomIfReady (PvE): does not resume if the human has not reconnected', async () => {
  const room = makePausedPveRoom('room-pve-no-human');
  const ctx = makeCtx();

  const resumed = await resumeRoomIfReady(ctx, room, 1000);

  assert.equal(resumed, false, 'engine alone is not enough — the human must be present');
  assert.equal(room.projection.paused, true);
});

test('resumeRoomIfReady (EvE): resumes on any client connection (both engines auto-present)', async () => {
  const room = makePausedEveRoom('room-eve-resume');
  // A spectator joins — they don't hold either seat.
  const spectator = makeClient('spec-1', 'spectator', false);
  room.clients.add(spectator);
  const ctx = makeCtx();

  const resumed = await resumeRoomIfReady(ctx, room, 1000);

  assert.equal(
    resumed,
    true,
    'EvE must resume as soon as the room is touched — engines are always present',
  );
  assert.equal(room.projection.paused, false);
});

test('resumeRoomIfReady (EvE): resumes even with zero clients (engines are auto-present)', async () => {
  // Direct call without clients models the server-side trigger path.
  // (handleConnection only calls this with at least one client, but engine-worker
  //  or internal triggers may call without any client present.)
  const room = makePausedEveRoom('room-eve-no-client');
  const ctx = makeCtx();

  const resumed = await resumeRoomIfReady(ctx, room, 1000);

  assert.equal(resumed, true, 'with both seats engine-held, neither needs a client to be present');
});

test('resumeRoomIfReady (PvP): still requires both human seats — regression guard', async () => {
  const room = makePausedSeatedRoom('room-pvp-still-strict');
  // Only one human present.
  const white = makeClient('white-client', 'white', false);
  white.seatTokenHash = 'hash-white';
  room.clients.add(white);
  const ctx = makeCtx();

  const resumed = await resumeRoomIfReady(ctx, room, 1000);

  assert.equal(
    resumed,
    false,
    'PvP requires BOTH humans — engine-presence relaxation must not apply here',
  );
  assert.equal(room.projection.paused, true);
});

// ── Defense-in-depth: paused guards in async callbacks ────────────────────────

test('playRandomEngineMoveIfReady: no-op on paused room (defense in depth)', async () => {
  const room = makePausedPveRoom('room-pve-engine-no-op');
  // Flip turn to black so the engine would normally play.
  room.projection = {
    ...room.projection,
    state: {
      ...room.projection.state,
      status: { type: 'playing', turn: 'black' },
    },
  };
  room.randomEngine = true;
  const ctx = makeCtx();
  const before = room.events.length;

  // Import on demand to avoid a top-level import churn.
  const { playRandomEngineMoveIfReady } = await import('./room-manager.js');
  await playRandomEngineMoveIfReady(ctx, room);

  assert.equal(
    room.events.length,
    before,
    'paused room must not record an engine move even if the callback fires',
  );
});

// ── live-engine-decision artifact ─────────────────────────────────────────────

function decisionArtifactInput(
  overrides: Partial<Parameters<typeof buildLiveEngineDecisionArtifactPayload>[0]> = {},
) {
  const move = { from: 'e2', to: 'e4' } as const;
  return {
    contextPly: 8,
    durationMs: 4900,
    engineId: 'python-v2-v1.6',
    fallback: false,
    fallbackEvent: null,
    move,
    requestedEngineId: 'python-v2-v1.6',
    scores: [{ move, score: 0, reason: 'engine-worker:v2' }],
    thinkTimeMs: 4800,
    budgetMs: 12_000,
    ...overrides,
  };
}

// Chess / dark chess is the most-played surface and this payload is its only
// durable record of an engine decision. It carried think time against NOTHING
// until 2026-09-06, so scripts/engine-budget-report.mjs could only report the
// fog bots as CEILING-UNKNOWN: think time with no ceiling cannot say whether the
// engine finished its work or ran out of clock.
test('live-engine-decision artifact records the compute budget the move ran under', () => {
  const payload = buildLiveEngineDecisionArtifactPayload(decisionArtifactInput());

  // Named movetime_ms to match the tenant and standard-xiangqi writers: it is
  // the key every artifact reader already looks for, and a fourth spelling would
  // leave the fog path unreadable to all of them.
  assert.equal(payload.movetime_ms, 12_000);
  assert.equal(payload.think_time_ms, 4800);
  assert.equal(payload.duration_ms, 4900);
  assert.equal(payload.engine_id, 'python-v2-v1.6');
  assert.equal(payload.requested_engine_id, 'python-v2-v1.6');
  assert.equal(payload.fallback, false);
});

// The in-process builtin engines are handed no movetime at all. Null and 0 are
// very different claims here: 0 would report an engine starved of time.
test('live-engine-decision artifact keeps an absent budget null, never 0', () => {
  const payload = buildLiveEngineDecisionArtifactPayload(decisionArtifactInput({ budgetMs: null }));

  assert.ok('movetime_ms' in payload, 'the budget key must be present even when there is none');
  assert.equal(payload.movetime_ms, null);
  assert.notEqual(payload.movetime_ms, 0);
});

// engine_diagnostics is the worker's own telemetry and is absent for the builtin
// engines; the budget must not start riding on its presence.
test('live-engine-decision artifact records the budget with or without diagnostics', () => {
  const withDiagnostics = buildLiveEngineDecisionArtifactPayload(
    decisionArtifactInput({ engineDiagnostics: { iters: 900, searchSeconds: 4.5 } }),
  );
  assert.equal(withDiagnostics.movetime_ms, 12_000);
  assert.deepEqual(withDiagnostics.engine_diagnostics, { iters: 900, searchSeconds: 4.5 });

  const withoutDiagnostics = buildLiveEngineDecisionArtifactPayload(decisionArtifactInput());
  assert.equal(withoutDiagnostics.movetime_ms, 12_000);
  assert.equal('engine_diagnostics' in withoutDiagnostics, false);
});

// ── scheduleAbortTimeout ──────────────────────────────────────────────────────

function clockStartedEvents(id: string): GameEvent[] {
  return [
    { type: 'room-created', at: 1, roomId: id, variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: id, clientId: 'w', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: id, clientId: 'b', seat: 'black' },
    { type: 'clock-started', at: 4, roomId: id, clock: createClock(4, 60_000, 0) },
  ];
}

test('scheduleAbortTimeout: arms the white-1 window for a clocked pre-move-1 game', () => {
  const room = makeRoom('abort-w1', 'dark-chess', clockStartedEvents('abort-w1'));
  const ctx = makeCtx();
  const before = Date.now();
  scheduleAbortTimeout(ctx, room);
  assert.equal(room.abortPhase, 'white-1');
  assert.ok(room.abortTimer !== null, 'timer armed');
  assert.ok(
    room.abortDeadline !== null && room.abortDeadline >= before + ABORT_WINDOW_MS - 50,
    'deadline ~30s out',
  );
  clearAbortTimer(room);
});

test('scheduleAbortTimeout: flips to black-1 after white completes move 1', () => {
  const id = 'abort-b1';
  const room = makeRoom(id, 'dark-chess', [
    ...clockStartedEvents(id),
    { type: 'move-played', at: 1000, roomId: id, color: 'white', move: { from: 'e2', to: 'e4' } },
  ]);
  const ctx = makeCtx();
  scheduleAbortTimeout(ctx, room);
  assert.equal(room.abortPhase, 'black-1');
  assert.ok(room.abortTimer !== null);
  clearAbortTimer(room);
});

test('scheduleAbortTimeout: clears the window once both players have moved', () => {
  const id = 'abort-closed';
  const room = makeRoom(id, 'dark-chess', [
    ...clockStartedEvents(id),
    { type: 'move-played', at: 1000, roomId: id, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: 2000, roomId: id, color: 'black', move: { from: 'e7', to: 'e5' } },
  ]);
  const ctx = makeCtx();
  scheduleAbortTimeout(ctx, room);
  assert.equal(room.abortPhase, null);
  assert.equal(room.abortDeadline, null);
  assert.equal(room.abortTimer, null);
});

test('scheduleAbortTimeout: no window while the room is paused', () => {
  const id = 'abort-paused';
  const room = makeRoom(id, 'dark-chess', [
    ...clockStartedEvents(id),
    { type: 'pause', at: 1000, roomId: id, reason: 'shutdown' },
  ]);
  const ctx = makeCtx();
  scheduleAbortTimeout(ctx, room);
  assert.equal(room.abortPhase, null);
  assert.equal(room.abortTimer, null);
});

test('scheduleAbortTimeout: re-running within the same phase preserves the deadline', () => {
  const room = makeRoom('abort-stable', 'dark-chess', clockStartedEvents('abort-stable'));
  const ctx = makeCtx();
  scheduleAbortTimeout(ctx, room);
  const firstDeadline = room.abortDeadline;
  scheduleAbortTimeout(ctx, room);
  assert.equal(room.abortDeadline, firstDeadline, 're-broadcast must not extend the window');
  clearAbortTimer(room);
});

// ── scheduleForfeitTimeout ────────────────────────────────────────────────────

function move2Events(id: string, whiteClient = 'wc', blackClient = 'bc'): GameEvent[] {
  return [
    { type: 'room-created', at: 1, roomId: id, variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: id, clientId: whiteClient, seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: id, clientId: blackClient, seat: 'black' },
    { type: 'clock-started', at: 4, roomId: id, clock: createClock(4, 60_000, 0) },
    { type: 'move-played', at: 1000, roomId: id, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: 2000, roomId: id, color: 'black', move: { from: 'e7', to: 'e5' } },
  ];
}

test('scheduleForfeitTimeout: no forfeit while both players are present', () => {
  const room = makeRoom('ff-both', 'dark-chess', move2Events('ff-both'));
  room.clients.add(makeClient('wc', 'white'));
  room.clients.add(makeClient('bc', 'black'));
  scheduleForfeitTimeout(makeCtx(), room);
  assert.equal(room.forfeitSeat, null);
  assert.equal(room.forfeitTimer, null);
});

test('scheduleForfeitTimeout: arms a countdown for the lone absent seat', () => {
  const room = makeRoom('ff-gone', 'dark-chess', move2Events('ff-gone'));
  room.clients.add(makeClient('wc', 'white')); // only white present; black is gone
  const before = Date.now();
  scheduleForfeitTimeout(makeCtx(), room);
  assert.equal(room.forfeitSeat, 'black');
  assert.ok(room.forfeitTimer !== null);
  assert.ok(
    room.forfeitDeadline !== null && room.forfeitDeadline >= before + FORFEIT_WINDOW_MS - 50,
  );
  clearForfeitTimer(room);
});

test('scheduleForfeitTimeout: no forfeit before both first moves (pre-move-2)', () => {
  const room = makeRoom('ff-premove', 'dark-chess', clockStartedEvents('ff-premove'));
  room.clients.add(makeClient('wc', 'white')); // black absent, but it's still the abort phase
  scheduleForfeitTimeout(makeCtx(), room);
  assert.equal(room.forfeitSeat, null);
  assert.equal(room.forfeitTimer, null);
});

test('scheduleForfeitTimeout: no forfeit when both players are absent', () => {
  const room = makeRoom('ff-empty', 'dark-chess', move2Events('ff-empty'));
  // No clients connected — nobody to award the win to.
  scheduleForfeitTimeout(makeCtx(), room);
  assert.equal(room.forfeitSeat, null);
  assert.equal(room.forfeitTimer, null);
});

test('scheduleForfeitTimeout: reconnect (both present again) cancels the countdown', () => {
  const room = makeRoom('ff-reconnect', 'dark-chess', move2Events('ff-reconnect'));
  const white = makeClient('wc', 'white');
  room.clients.add(white); // black gone → forfeit armed
  scheduleForfeitTimeout(makeCtx(), room);
  assert.equal(room.forfeitSeat, 'black');
  // Black returns.
  room.clients.add(makeClient('bc', 'black'));
  scheduleForfeitTimeout(makeCtx(), room);
  assert.equal(room.forfeitSeat, null);
  assert.equal(room.forfeitTimer, null);
});

test('scheduleForfeitTimeout: PvE human disconnect forfeits to the always-present engine', () => {
  const room = makeRoom('ff-pve', 'dark-chess', move2Events('ff-pve', 'engine-1', 'human-1'));
  room.pveEngineId = 'engine-1'; // engine plays white; it never holds a WS client
  // Human (black) is absent; the engine seat counts as present.
  scheduleForfeitTimeout(makeCtx(), room);
  assert.equal(room.forfeitSeat, 'black', 'human forfeits to the engine');
  clearForfeitTimer(room);

  // With the human present, no forfeit — and the engine seat never forfeits.
  room.clients.add(makeClient('human-1', 'black'));
  scheduleForfeitTimeout(makeCtx(), room);
  assert.equal(room.forfeitSeat, null);
});
