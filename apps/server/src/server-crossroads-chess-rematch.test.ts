import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROSSROADS_CHESS_SPEC_ID,
  type CrossroadsChessColor,
  createInitialCrossroadsChessBoard,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import type {
  CrossroadsChessRuntimeRoom,
  CrossroadsChessSeatTokenState,
} from './crossroads-chess-runtime.js';
import {
  broadcastCrossroadsChessRematchState,
  type CrossroadsChessRematchContext,
  cancelCrossroadsChessRematch,
  declineCrossroadsChessRematch,
  finalizeCrossroadsChessRematchIfReady,
  maybeReplayCrossroadsChessRematchRedirect,
  offerCrossroadsChessRematch,
} from './server-crossroads-chess-rematch.js';
import type {
  CrossroadsChessLiveClient,
  CrossroadsChessLiveRoom,
} from './server-ws-crossroads-chess.js';

function makeRoom(id: string, status: 'playing' | 'finished'): CrossroadsChessLiveRoom {
  return {
    kind: 'crossroads-chess',
    id,
    clients: new Set<CrossroadsChessLiveClient>(),
    events: [],
    projection: {
      roomId: id,
      gameSpecId: CROSSROADS_CHESS_SPEC_ID,
      rated: false,
      state: {
        id,
        board: createInitialCrossroadsChessBoard(),
        status:
          status === 'finished'
            ? { type: 'finished', winner: 'white', reason: 'king-captured' }
            : { type: 'playing', turn: 'white' },
        moveNumber: 2,
        progressClock: 0,
        positionCounts: {},
      },
      seats: { white: 'white-client', red: 'red-client' },
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    },
    gameSpecId: CROSSROADS_CHESS_SPEC_ID,
    rated: false,
    abortTimer: null,
    abortDeadline: null,
    abortPhase: null,
    clockTimer: null,
    engineTimer: null,
    engineReservationId: null,
    forfeitTimer: null,
    actionTimer: null,
    forfeitDeadline: null,
    forfeitSeat: null,
    gameEndRecorded: status === 'finished',
    pendingWrites: Promise.resolve(),
    seatTokens: {},
    rematch: { offers: {} },
    pveBotId: null,
  };
}

function seatToken(opts: {
  seat: CrossroadsChessColor;
  hash: string;
  userId?: string | null;
}): CrossroadsChessSeatTokenState {
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

function client(seat: CrossroadsChessColor, tokenHash: string): CrossroadsChessLiveClient {
  return {
    debugRequested: false,
    displaced: false,
    id: `${seat}-client`,
    messageTimestamps: [],
    roomId: 'irrelevant',
    seat,
    seatTokenHash: tokenHash,
    socket: { send: () => {} } as unknown as WebSocket,
    solo: false,
    userId: null,
  };
}

type Spy = {
  sent: Array<{ client: CrossroadsChessLiveClient; payload: unknown }>;
  createCalls: number;
  issueCalls: number;
};

function makeCtx(): {
  ctx: CrossroadsChessRematchContext;
  spy: Spy;
  newRoom: CrossroadsChessLiveRoom;
} {
  const sent: Spy['sent'] = [];
  const spy: Spy = { sent, createCalls: 0, issueCalls: 0 };
  const newRoom = makeRoom('new-room', 'playing');
  const ctx: CrossroadsChessRematchContext = {
    send: (c, payload) => sent.push({ client: c, payload }),
    buildRoomUrl: (id) => `/room/${id}`,
    createRoom: async () => {
      spy.createCalls += 1;
      return { ok: true, room: newRoom as CrossroadsChessRuntimeRoom };
    },
    issueSeatToken: async (room, seat, identity) => {
      spy.issueCalls += 1;
      const state = seatToken({ seat, hash: `new-${seat}-hash`, userId: identity.userId });
      room.seatTokens[seat] = state;
      return { rawToken: `new-${seat}-token`, state };
    },
  };
  return { ctx, spy, newRoom };
}

test('Crossroads rematch offer is ignored when the game is not finished', () => {
  const room = makeRoom('r', 'playing');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  const { ctx } = makeCtx();
  offerCrossroadsChessRematch(ctx, room, client('white', 'wh'));
  assert.equal(room.rematch.offers.white, undefined);
});

test('Crossroads rematch offer is ignored when the seat token hash does not match', () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  const { ctx } = makeCtx();
  offerCrossroadsChessRematch(ctx, room, client('white', 'stale-hash'));
  assert.equal(room.rematch.offers.white, undefined);
});

test('Crossroads rematch one-sided offer leaves the rematch pending', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  const { ctx, spy } = makeCtx();
  offerCrossroadsChessRematch(ctx, room, client('white', 'wh'));
  const finalized = await finalizeCrossroadsChessRematchIfReady(ctx, room);
  assert.equal(finalized, null);
  assert.equal(spy.createCalls, 0);
  assert.ok(room.rematch.offers.white);
  assert.equal(room.rematch.offers.red, undefined);
});

test('Crossroads rematch mutual offer finalizes with colors swapped', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh', userId: 'user-w' });
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh', userId: 'user-r' });
  const whiteClient = client('white', 'wh');
  const redClient = client('red', 'rh');
  room.clients.add(whiteClient);
  room.clients.add(redClient);

  const { ctx, spy, newRoom } = makeCtx();
  offerCrossroadsChessRematch(ctx, room, whiteClient);
  offerCrossroadsChessRematch(ctx, room, redClient);
  const finalized = await finalizeCrossroadsChessRematchIfReady(ctx, room);

  assert.equal(finalized, newRoom);
  assert.equal(spy.createCalls, 1);
  assert.equal(spy.issueCalls, 2);
  assert.equal(newRoom.seatTokens.white?.userId, 'user-r');
  assert.equal(newRoom.seatTokens.red?.userId, 'user-w');

  const redirects = spy.sent.filter(
    (m) => (m.payload as { type?: string }).type === 'rematch:redirect',
  );
  assert.equal(redirects.length, 2);
  const whiteRedirect = redirects.find((r) => r.client === whiteClient);
  const redRedirect = redirects.find((r) => r.client === redClient);
  assert.equal((whiteRedirect!.payload as { seat: string }).seat, 'red');
  assert.equal((whiteRedirect!.payload as { seatToken: string }).seatToken, 'new-red-token');
  assert.equal((redRedirect!.payload as { seat: string }).seat, 'white');
  assert.equal((redRedirect!.payload as { seatToken: string }).seatToken, 'new-white-token');
  assert.equal(room.rematch.finalizedRoomId, newRoom.id);
});

test('Crossroads rematch second finalize is a no-op once finalized', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  const { ctx, spy } = makeCtx();
  offerCrossroadsChessRematch(ctx, room, client('white', 'wh'));
  offerCrossroadsChessRematch(ctx, room, client('red', 'rh'));
  await finalizeCrossroadsChessRematchIfReady(ctx, room);
  const again = await finalizeCrossroadsChessRematchIfReady(ctx, room);
  assert.equal(again, null);
  assert.equal(spy.createCalls, 1);
});

test('Crossroads rematch cancel clears only the caller offer', () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  const { ctx } = makeCtx();
  offerCrossroadsChessRematch(ctx, room, client('white', 'wh'));
  offerCrossroadsChessRematch(ctx, room, client('red', 'rh'));
  cancelCrossroadsChessRematch(ctx, room, client('white', 'wh'));
  assert.equal(room.rematch.offers.white, undefined);
  assert.ok(room.rematch.offers.red);
});

test('Crossroads rematch decline clears both offers', () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  const { ctx } = makeCtx();
  offerCrossroadsChessRematch(ctx, room, client('white', 'wh'));
  declineCrossroadsChessRematch(ctx, room, client('red', 'rh'));
  assert.equal(room.rematch.offers.white, undefined);
  assert.equal(room.rematch.offers.red, undefined);
});

test('Crossroads rematch finalize refuses identity drift', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  room.rematch.offers.white = { tokenHash: 'stale-hash', userId: null, at: Date.now() };
  room.rematch.offers.red = { tokenHash: 'rh', userId: null, at: Date.now() };

  const { ctx, spy } = makeCtx();
  const finalized = await finalizeCrossroadsChessRematchIfReady(ctx, room);
  assert.equal(finalized, null);
  assert.equal(spy.createCalls, 0);
  assert.equal(room.rematch.offers.white, undefined, 'offers cleared on identity drift');
});

test('Crossroads rematch reconnect after finalize replays the redirect for the seat', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.white = seatToken({ seat: 'white', hash: 'wh' });
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  const whiteClient = client('white', 'wh');
  const redClient = client('red', 'rh');
  room.clients.add(whiteClient);
  room.clients.add(redClient);

  const { ctx } = makeCtx();
  offerCrossroadsChessRematch(ctx, room, whiteClient);
  offerCrossroadsChessRematch(ctx, room, redClient);
  await finalizeCrossroadsChessRematchIfReady(ctx, room);

  const { ctx: replayCtx, spy } = makeCtx();
  maybeReplayCrossroadsChessRematchRedirect(replayCtx, room, whiteClient);
  assert.equal(spy.sent.length, 1);
  const redirect = spy.sent[0]!.payload as { type: string; seat: string };
  assert.equal(redirect.type, 'rematch:redirect');
  assert.equal(redirect.seat, 'red');
});

test('Crossroads rematch reconnect with no pending redirect is a no-op', () => {
  const room = makeRoom('r', 'finished');
  const { ctx, spy } = makeCtx();
  maybeReplayCrossroadsChessRematchRedirect(ctx, room, client('white', 'wh'));
  assert.equal(spy.sent.length, 0);
});

test('Crossroads rematch broadcast sends rematch state to every client', () => {
  const room = makeRoom('r', 'finished');
  const c1 = client('white', 'wh');
  const c2 = client('red', 'rh');
  room.clients.add(c1);
  room.clients.add(c2);
  room.rematch.offers.white = { tokenHash: 'wh', userId: null, at: 1 };
  const { ctx, spy } = makeCtx();
  broadcastCrossroadsChessRematchState(ctx, room);
  assert.equal(spy.sent.length, 2);
  for (const m of spy.sent) {
    const p = m.payload as { type: string; offers: { white: boolean; red: boolean } };
    assert.equal(p.type, 'rematch:state');
    assert.equal(p.offers.white, true);
    assert.equal(p.offers.red, false);
  }
});
