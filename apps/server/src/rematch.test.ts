import assert from 'node:assert/strict';
import test from 'node:test';
import { type GameEvent, replayGameEvents } from '@mistboard/game';
import type { WebSocket } from 'ws';
import {
  broadcastRematchState,
  cancelRematch,
  declineRematch,
  finalizeRematchIfReady,
  maybeReplayRematchRedirect,
  offerRematch,
  type RematchOrchestrator,
} from './rematch.js';
import type { RoomManagerContext } from './room-manager.js';
import type { Client, Room, SeatTokenState } from './server-types.js';

function makeFinishedRoom(id: string): Room {
  // Forge a minimal finished projection. Easiest path: start a fog-of-war room
  // and synthesise the events for a fool's-mate-like resignation outcome via
  // status mutation after construction (room.projection is mutable in tests).
  const events: GameEvent[] = [{ type: 'room-created', at: 1, roomId: id, variant: 'dark-chess' }];
  const projection = replayGameEvents(events);
  projection.state.status = { type: 'finished', winner: 'white', reason: 'resignation' };
  projection.seats = { white: 'white-client', black: 'black-client' };
  return {
    id,
    clients: new Set(),
    events,
    projection,
    seatTokens: {},
    clockTimer: null,
    engineTimer: null,
    abortTimer: null,
    abortDeadline: null,
    abortPhase: null,
    forfeitTimer: null,
    forfeitDeadline: null,
    forfeitSeat: null,
    mode: 'pvp',
    gameSpecId: projection.gameSpecId,
    rated: true,
    randomEngine: false,
    engineReservationId: null,
    randomSeating: false,
    creatorPreference: null,
    pveEngineId: null,
    pveBotId: null,
    pendingWrites: Promise.resolve(),
    gameEndRecorded: true,
    variant: 'dark-chess',
    timeControl: undefined,
    rematch: { offers: {} },
    pendingVacates: {},
    pauseGraceTimer: null,
  };
}

function makeOngoingRoom(id: string): Room {
  const room = makeFinishedRoom(id);
  room.projection.state.status = { type: 'playing', turn: 'white' };
  return room;
}

function seatToken(opts: {
  seat: 'white' | 'black';
  hash: string;
  userId?: string | null;
}): SeatTokenState {
  return {
    clientId: `${opts.seat}-client`,
    seat: opts.seat,
    tokenHash: opts.hash,
    userId: opts.userId ?? null,
    userHandle: null,
    userDisplayName: null,
    issuedAt: new Date(),
    lastSeenAt: new Date(),
    revokedAt: null,
  };
}

function client(seat: 'white' | 'black', tokenHash: string): Client {
  return {
    id: `${seat}-client`,
    seat,
    solo: false,
    displaced: false,
    seatTokenHash: tokenHash,
    messageTimestamps: [],
    devViews: false,
    debugRequested: false,
    roomId: 'irrelevant',
    socket: { send: () => {} } as unknown as WebSocket,
  };
}

type Spy = {
  sent: Array<{ client: Client; payload: unknown }>;
  createCalls: number;
  issueCalls: number;
};

function makeOrch(): { orch: RematchOrchestrator; spy: Spy; newRoom: Room } {
  const sent: Array<{ client: Client; payload: unknown }> = [];
  const spy: Spy = { sent, createCalls: 0, issueCalls: 0 };
  const newRoom: Room = makeOngoingRoom('new-room');
  newRoom.seatTokens = {};
  const ctx: RoomManagerContext = {
    send: () => {},
    recordPersistenceError: () => {},
    pveBuiltinEngineClientId: 'engine',
    pveEngineMoveDelayMs: 0,
    liveEngineTimeoutMs: 0,
    liveClockInitialMs: 0,
    liveClockIncrementMs: 0,
  };
  const orch: RematchOrchestrator = {
    ctx,
    send: (c, payload) => sent.push({ client: c, payload }),
    buildRoomUrl: (id) => `/?room=${id}`,
    createRoom: async () => {
      spy.createCalls += 1;
      return newRoom;
    },
    issueSeatToken: async (room, seat, identity) => {
      spy.issueCalls += 1;
      const hash = `new-${seat}-hash`;
      const state = seatToken({ seat, hash, userId: identity.userId });
      room.seatTokens[seat] = state;
      return { rawToken: `new-${seat}-token`, state };
    },
  };
  return { orch, spy, newRoom };
}

test('offerRematch: rejected when game is not finished', () => {
  const room = makeOngoingRoom('r');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  const { orch } = makeOrch();
  const result = offerRematch(orch, room, client('white', 'wh'));
  assert.equal(result.ok, false);
  assert.equal(room.rematch.offers.white, undefined);
});

test('offerRematch: rejected for spectators (no seat token)', () => {
  const room = makeFinishedRoom('r');
  const { orch } = makeOrch();
  const spec: Client = { ...client('white', 'wh'), seat: 'spectator' };
  const result = offerRematch(orch, room, spec);
  assert.equal(result.ok, false);
});

test('offerRematch: one-sided offer leaves state pending', async () => {
  const room = makeFinishedRoom('r');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const { orch, spy } = makeOrch();
  offerRematch(orch, room, client('white', 'wh'));
  const finalized = await finalizeRematchIfReady(orch, room);
  assert.equal(finalized, null);
  assert.equal(spy.createCalls, 0);
  assert.ok(room.rematch.offers.white);
  assert.equal(room.rematch.offers.black, undefined);
});

test('mutual offer finalizes: new room created, colors swapped, per-client redirect sent', async () => {
  const room = makeFinishedRoom('r');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh', userId: 'user-w' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh', userId: 'user-b' });
  const whiteClient = client('white', 'wh');
  const blackClient = client('black', 'bh');
  room.clients.add(whiteClient);
  room.clients.add(blackClient);

  const { orch, spy, newRoom } = makeOrch();
  offerRematch(orch, room, whiteClient);
  offerRematch(orch, room, blackClient);
  const finalized = await finalizeRematchIfReady(orch, room);

  assert.equal(finalized, newRoom);
  assert.equal(spy.createCalls, 1);
  assert.equal(spy.issueCalls, 2);

  // New room tokens: white seat carries old black's userId, black carries old white's.
  assert.equal(newRoom.seatTokens.white?.userId, 'user-b');
  assert.equal(newRoom.seatTokens.black?.userId, 'user-w');

  const redirects = spy.sent.filter(
    (m) => (m.payload as { type?: string }).type === 'rematch:redirect',
  );
  assert.equal(redirects.length, 2);
  const whiteRedirect = redirects.find((r) => r.client === whiteClient);
  const blackRedirect = redirects.find((r) => r.client === blackClient);
  // Old white seat should be handed the black seat token in the new room (color flipped).
  assert.equal((whiteRedirect!.payload as { seatToken: string }).seatToken, 'new-black-token');
  assert.equal((blackRedirect!.payload as { seatToken: string }).seatToken, 'new-white-token');
  assert.equal(room.rematch.finalizedRoomId, newRoom.id);
});

test('cancelRematch: clears own offer only', () => {
  const room = makeFinishedRoom('r');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const { orch } = makeOrch();
  offerRematch(orch, room, client('white', 'wh'));
  offerRematch(orch, room, client('black', 'bh'));
  cancelRematch(orch, room, client('white', 'wh'));
  assert.equal(room.rematch.offers.white, undefined);
  assert.ok(room.rematch.offers.black);
});

test('declineRematch: clears both offers', () => {
  const room = makeFinishedRoom('r');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const { orch } = makeOrch();
  offerRematch(orch, room, client('white', 'wh'));
  declineRematch(orch, room, client('black', 'bh'));
  assert.equal(room.rematch.offers.white, undefined);
  assert.equal(room.rematch.offers.black, undefined);
});

test('finalize refuses when seat token rotated under us (identity drift)', async () => {
  const room = makeFinishedRoom('r');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  offerRematch(makeOrch().orch, room, client('white', 'wh'));
  offerRematch(makeOrch().orch, room, client('black', 'bh'));
  // Simulate token rotation: white seat token replaced after offer was recorded.
  room.rematch.offers.white = { tokenHash: 'stale-hash', userId: null, at: Date.now() };

  const { orch, spy } = makeOrch();
  const finalized = await finalizeRematchIfReady(orch, room);
  assert.equal(finalized, null);
  assert.equal(spy.createCalls, 0);
  assert.equal(room.rematch.offers.white, undefined, 'offers should be cleared on identity-drift');
});

test('reconnect after finalize: maybeReplayRematchRedirect re-sends per seat', async () => {
  const room = makeFinishedRoom('r');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const whiteClient = client('white', 'wh');
  const blackClient = client('black', 'bh');
  room.clients.add(whiteClient);
  room.clients.add(blackClient);

  const { orch } = makeOrch();
  offerRematch(orch, room, whiteClient);
  offerRematch(orch, room, blackClient);
  await finalizeRematchIfReady(orch, room);

  // A fresh orchestrator on the "reconnect" — we only check that replay sends
  // the right payload to the reconnecting client.
  const { orch: replayOrch, spy } = makeOrch();
  // Simulate: old client disconnected and reconnected — replay the redirect.
  maybeReplayRematchRedirect(replayOrch, room, whiteClient);
  assert.equal(spy.sent.length, 1);
  const redirect = spy.sent[0]!.payload as { type: string; seat: string; seatToken: string };
  assert.equal(redirect.type, 'rematch:redirect');
  // Old white player should be redirected to the black seat in the new room.
  assert.equal(redirect.seat, 'black');
});

test('reconnect with no pending redirect: no-op', () => {
  const room = makeFinishedRoom('r');
  const c = client('white', 'wh');
  const { orch, spy } = makeOrch();
  maybeReplayRematchRedirect(orch, room, c);
  assert.equal(spy.sent.length, 0);
});

test('broadcastRematchState: sends state to every client', () => {
  const room = makeFinishedRoom('r');
  const c1 = client('white', 'wh');
  const c2 = client('black', 'bh');
  room.clients.add(c1);
  room.clients.add(c2);
  room.rematch.offers.white = { tokenHash: 'wh', userId: null, at: 1 };
  const { orch, spy } = makeOrch();
  broadcastRematchState(orch, room);
  assert.equal(spy.sent.length, 2);
  for (const m of spy.sent) {
    const p = m.payload as { type: string; offers: { white: boolean; black: boolean } };
    assert.equal(p.type, 'rematch:state');
    assert.equal(p.offers.white, true);
    assert.equal(p.offers.black, false);
  }
});
