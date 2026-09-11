import assert from 'node:assert/strict';
import test from 'node:test';
import { DARK_MINI_XIANGQI_SPEC_ID, type MiniXiangqiColor } from '@mistboard/game';
import type { WebSocket } from 'ws';
import type {
  DarkMiniXiangqiRuntimeRoom,
  DarkMiniXiangqiSeatTokenState,
} from './dark-mini-xiangqi-runtime.js';
import {
  broadcastDarkMiniXiangqiRematchState,
  cancelDarkMiniXiangqiRematch,
  type DarkMiniXiangqiRematchContext,
  declineDarkMiniXiangqiRematch,
  finalizeDarkMiniXiangqiRematchIfReady,
  maybeReplayDarkMiniXiangqiRematchRedirect,
  offerDarkMiniXiangqiRematch,
} from './server-dark-mini-xiangqi-rematch.js';
import type {
  DarkMiniXiangqiLiveClient,
  DarkMiniXiangqiLiveRoom,
} from './server-ws-dark-mini-xiangqi.js';

function makeRoom(id: string, status: 'playing' | 'finished'): DarkMiniXiangqiLiveRoom {
  return {
    kind: 'dark-mini-xiangqi',
    id,
    clients: new Set<DarkMiniXiangqiLiveClient>(),
    events: [],
    projection: {
      roomId: id,
      gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
      rated: false,
      state: {
        id,
        board: {},
        status:
          status === 'finished'
            ? { type: 'finished', winner: 'red', reason: 'general-captured' }
            : { type: 'playing', turn: 'red' },
        moveNumber: 2,
        progressClock: 0,
        positionCounts: {},
      },
      seats: { red: 'red-client', black: 'black-client' },
    },
    gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
    rated: false,
    abortTimer: null,
    abortDeadline: null,
    abortPhase: null,
    clockTimer: null,
    forfeitTimer: null,
    actionTimer: null,
    forfeitDeadline: null,
    forfeitSeat: null,
    gameEndRecorded: status === 'finished',
    pendingWrites: Promise.resolve(),
    seatTokens: {},
    rematch: { offers: {} },
    engineTimer: null,
    engineReservationId: null,
    pveBotId: null,
  };
}

function seatToken(opts: {
  seat: MiniXiangqiColor;
  hash: string;
  userId?: string | null;
}): DarkMiniXiangqiSeatTokenState {
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

function client(seat: MiniXiangqiColor, tokenHash: string): DarkMiniXiangqiLiveClient {
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
  sent: Array<{ client: DarkMiniXiangqiLiveClient; payload: unknown }>;
  createCalls: number;
  issueCalls: number;
};

function makeCtx(): {
  ctx: DarkMiniXiangqiRematchContext;
  spy: Spy;
  newRoom: DarkMiniXiangqiLiveRoom;
} {
  const sent: Spy['sent'] = [];
  const spy: Spy = { sent, createCalls: 0, issueCalls: 0 };
  const newRoom = makeRoom('new-room', 'playing');
  const ctx: DarkMiniXiangqiRematchContext = {
    send: (c, payload) => sent.push({ client: c, payload }),
    buildRoomUrl: (id) => `/room/${id}`,
    createRoom: async () => {
      spy.createCalls += 1;
      return { ok: true, room: newRoom as DarkMiniXiangqiRuntimeRoom };
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

test('offer is ignored when the game is not finished', () => {
  const room = makeRoom('r', 'playing');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  const { ctx } = makeCtx();
  offerDarkMiniXiangqiRematch(ctx, room, client('red', 'rh'));
  assert.equal(room.rematch.offers.red, undefined);
});

test('offer is ignored when the seat token hash does not match', () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  const { ctx } = makeCtx();
  offerDarkMiniXiangqiRematch(ctx, room, client('red', 'stale-hash'));
  assert.equal(room.rematch.offers.red, undefined);
});

test('one-sided offer leaves the rematch pending', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const { ctx, spy } = makeCtx();
  offerDarkMiniXiangqiRematch(ctx, room, client('red', 'rh'));
  const finalized = await finalizeDarkMiniXiangqiRematchIfReady(ctx, room);
  assert.equal(finalized, null);
  assert.equal(spy.createCalls, 0);
  assert.ok(room.rematch.offers.red);
  assert.equal(room.rematch.offers.black, undefined);
});

test('mutual offer finalizes: new room, colors swapped, per-client redirect sent', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh', userId: 'user-r' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh', userId: 'user-b' });
  const redClient = client('red', 'rh');
  const blackClient = client('black', 'bh');
  room.clients.add(redClient);
  room.clients.add(blackClient);

  const { ctx, spy, newRoom } = makeCtx();
  offerDarkMiniXiangqiRematch(ctx, room, redClient);
  offerDarkMiniXiangqiRematch(ctx, room, blackClient);
  const finalized = await finalizeDarkMiniXiangqiRematchIfReady(ctx, room);

  assert.equal(finalized, newRoom);
  assert.equal(spy.createCalls, 1);
  assert.equal(spy.issueCalls, 2);
  // New-room red seat carries the OLD black player; black carries the old red.
  assert.equal(newRoom.seatTokens.red?.userId, 'user-b');
  assert.equal(newRoom.seatTokens.black?.userId, 'user-r');

  const redirects = spy.sent.filter(
    (m) => (m.payload as { type?: string }).type === 'rematch:redirect',
  );
  assert.equal(redirects.length, 2);
  const redRedirect = redirects.find((r) => r.client === redClient);
  const blackRedirect = redirects.find((r) => r.client === blackClient);
  // The old red player is handed the new black seat (color flipped), and vice versa.
  assert.equal((redRedirect!.payload as { seat: string }).seat, 'black');
  assert.equal((redRedirect!.payload as { seatToken: string }).seatToken, 'new-black-token');
  assert.equal((blackRedirect!.payload as { seat: string }).seat, 'red');
  assert.equal((blackRedirect!.payload as { seatToken: string }).seatToken, 'new-red-token');
  assert.equal(room.rematch.finalizedRoomId, newRoom.id);
});

test('a second finalize is a no-op once the rematch is finalized', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const { ctx, spy } = makeCtx();
  offerDarkMiniXiangqiRematch(ctx, room, client('red', 'rh'));
  offerDarkMiniXiangqiRematch(ctx, room, client('black', 'bh'));
  await finalizeDarkMiniXiangqiRematchIfReady(ctx, room);
  const again = await finalizeDarkMiniXiangqiRematchIfReady(ctx, room);
  assert.equal(again, null);
  assert.equal(spy.createCalls, 1);
});

test('cancel clears only the caller’s offer', () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const { ctx } = makeCtx();
  offerDarkMiniXiangqiRematch(ctx, room, client('red', 'rh'));
  offerDarkMiniXiangqiRematch(ctx, room, client('black', 'bh'));
  cancelDarkMiniXiangqiRematch(ctx, room, client('red', 'rh'));
  assert.equal(room.rematch.offers.red, undefined);
  assert.ok(room.rematch.offers.black);
});

test('decline clears both offers', () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const { ctx } = makeCtx();
  offerDarkMiniXiangqiRematch(ctx, room, client('red', 'rh'));
  declineDarkMiniXiangqiRematch(ctx, room, client('black', 'bh'));
  assert.equal(room.rematch.offers.red, undefined);
  assert.equal(room.rematch.offers.black, undefined);
});

test('finalize refuses when a seat token rotated under us (identity drift)', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  room.rematch.offers.red = { tokenHash: 'stale-hash', userId: null, at: Date.now() };
  room.rematch.offers.black = { tokenHash: 'bh', userId: null, at: Date.now() };

  const { ctx, spy } = makeCtx();
  const finalized = await finalizeDarkMiniXiangqiRematchIfReady(ctx, room);
  assert.equal(finalized, null);
  assert.equal(spy.createCalls, 0);
  assert.equal(room.rematch.offers.red, undefined, 'offers cleared on identity drift');
});

test('reconnect after finalize replays the redirect for the seat', async () => {
  const room = makeRoom('r', 'finished');
  room.seatTokens.red = seatToken({ seat: 'red', hash: 'rh' });
  room.seatTokens.black = seatToken({ seat: 'black', hash: 'bh' });
  const redClient = client('red', 'rh');
  const blackClient = client('black', 'bh');
  room.clients.add(redClient);
  room.clients.add(blackClient);

  const { ctx } = makeCtx();
  offerDarkMiniXiangqiRematch(ctx, room, redClient);
  offerDarkMiniXiangqiRematch(ctx, room, blackClient);
  await finalizeDarkMiniXiangqiRematchIfReady(ctx, room);

  const { ctx: replayCtx, spy } = makeCtx();
  maybeReplayDarkMiniXiangqiRematchRedirect(replayCtx, room, redClient);
  assert.equal(spy.sent.length, 1);
  const redirect = spy.sent[0]!.payload as { type: string; seat: string };
  assert.equal(redirect.type, 'rematch:redirect');
  assert.equal(redirect.seat, 'black');
});

test('reconnect with no pending redirect is a no-op', () => {
  const room = makeRoom('r', 'finished');
  const { ctx, spy } = makeCtx();
  maybeReplayDarkMiniXiangqiRematchRedirect(ctx, room, client('red', 'rh'));
  assert.equal(spy.sent.length, 0);
});

test('broadcast sends rematch state to every client', () => {
  const room = makeRoom('r', 'finished');
  const c1 = client('red', 'rh');
  const c2 = client('black', 'bh');
  room.clients.add(c1);
  room.clients.add(c2);
  room.rematch.offers.red = { tokenHash: 'rh', userId: null, at: 1 };
  const { ctx, spy } = makeCtx();
  broadcastDarkMiniXiangqiRematchState(ctx, room);
  assert.equal(spy.sent.length, 2);
  for (const m of spy.sent) {
    const p = m.payload as { type: string; offers: { red: boolean; black: boolean } };
    assert.equal(p.type, 'rematch:state');
    assert.equal(p.offers.red, true);
    assert.equal(p.offers.black, false);
  }
});
