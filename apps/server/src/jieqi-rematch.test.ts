/**
 * Jieqi PvP rematch, end to end through the real ws adapter and room factory
 * (in-memory, no DB): offer, decline, cancel, and the mutual accept that opens
 * a new room with colours swapped, the same clock, and a fresh server-side
 * deal. Spectators can neither offer nor follow the redirect. The new room's
 * payloads are the hidden-info regression: no deal, no face-down role.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import {
  getJieqiLegalMoves,
  JIEQI_SPEC_ID,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import { createJieqiRoom, jieqiRooms } from './jieqi-registration.js';
import type { JieqiEvent, JieqiRuntimeRoom } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { handleJieqiWebSocketConnection, type JieqiLiveRoom } from './server-ws-jieqi.js';
import {
  finalizeTenantRematchIfReady,
  type TenantRematchContext,
} from './variant-tenant/rematch.js';
import { registeredTenantRematchContext } from './variant-tenant/rematch-context.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';
import { mintTenantSeatToken } from './variant-tenant/seat-session.js';

process.env.MISTBOARD_JIEQI_ENABLED = 'true';

const TEN_PLUS_FIVE = { initialMs: 600_000, incrementMs: 5_000 };
const WS_CTX = {
  defaultRoomRegion: 'test',
  wsMessageLimit: 1_000,
  wsMessageWindowMs: 1_000,
};

class FakeSocket {
  sent: Record<string, unknown>[] = [];
  private handlers = new Map<string, (arg: unknown) => void>();
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {}
  on(event: string, cb: (arg: unknown) => void): this {
    this.handlers.set(event, cb);
    return this;
  }
  receive(message: unknown): void {
    this.handlers.get('message')?.(JSON.stringify(message));
  }
  ofType(type: string): Record<string, unknown>[] {
    return this.sent.filter((payload) => payload.type === type);
  }
  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

function request(clientId: string, seatToken?: string): IncomingMessage {
  const headers: Record<string, string> = { host: 'localhost' };
  if (seatToken) headers['sec-websocket-protocol'] = `mistboard-seat.${seatToken}`;
  return { url: `/?client=${clientId}`, headers } as unknown as IncomingMessage;
}

// Message handlers are async (rematch finalize awaits room creation).
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function connect(room: JieqiLiveRoom, clientId: string, seatToken?: string) {
  const socket = new FakeSocket();
  await handleJieqiWebSocketConnection(
    WS_CTX,
    socket.asWebSocket(),
    request(clientId, seatToken),
    room,
  );
  await settle();
  const hello = socket.ofType('hello')[0];
  assert.ok(hello, `${clientId} got a hello`);
  return { socket, seat: hello.seat as JieqiColor | 'spectator' };
}

function dealOf(room: { events: readonly unknown[] }): unknown {
  return (room.events[0] as { setup?: unknown }).setup;
}

// Two guests seated in a fresh casual room play a move each (resign needs two
// plies; before that it is an abort), then one resigns.
async function finishedRoom() {
  const created = await createJieqiRoom(TEN_PLUS_FIVE, 'random');
  assert.ok(created.ok);
  const room = created.room;
  const a = await connect(room, 'client-a');
  const b = await connect(room, 'client-b');
  assert.deepEqual(new Set([a.seat, b.seat]), new Set(['red', 'black']));
  for (let ply = 0; ply < 2; ply += 1) {
    const status = room.projection.state.status;
    assert.equal(status.type, 'playing');
    const mover = status.type === 'playing' && status.turn === a.seat ? a : b;
    const move = getJieqiLegalMoves(room.projection.state)[0]!;
    mover.socket.receive({ type: 'move', from: move.from, to: move.to });
    await settle();
  }
  assert.equal(room.projection.state.moveNumber, 2);
  a.socket.receive({ type: 'resign' });
  await settle();
  assert.equal(room.projection.state.status.type, 'finished');
  const red = a.seat === 'red' ? a : b;
  const black = a.seat === 'red' ? b : a;
  return { room, red, black };
}

function lastRematchState(socket: FakeSocket) {
  return socket.ofType('rematch:state').at(-1) as
    | { offers: Record<JieqiColor, boolean>; finalizedRoomId: string | null }
    | undefined;
}

test('jieqi rematch: decline and cancel clear the offer, and a spectator cannot offer', async () => {
  const { room, red, black } = await finishedRoom();
  const spectator = await connect(room, 'client-watch');
  assert.equal(spectator.seat, 'spectator');

  spectator.socket.receive({ type: 'rematch:offer' });
  await settle();
  assert.deepEqual(room.rematch.offers, {}, 'a spectator offer is ignored');

  red.socket.receive({ type: 'rematch:offer' });
  await settle();
  assert.deepEqual(lastRematchState(black.socket)?.offers, { red: true, black: false });
  // The finished snapshot carries the same flags, for a reload.
  black.socket.receive({ type: 'snapshot:request' });
  await settle();
  const snapshot = black.socket.sent.at(-1) as { rematch?: unknown };
  assert.deepEqual(snapshot.rematch, {
    offers: { red: true, black: false },
    finalizedRoomId: null,
  });

  black.socket.receive({ type: 'rematch:decline' });
  await settle();
  assert.deepEqual(lastRematchState(red.socket)?.offers, { red: false, black: false });

  black.socket.receive({ type: 'rematch:offer' });
  await settle();
  black.socket.receive({ type: 'rematch:cancel' });
  await settle();
  assert.deepEqual(lastRematchState(red.socket)?.offers, { red: false, black: false });
  assert.equal(room.rematch.finalizedRoomId, undefined, 'no room was created');
});

test('jieqi rematch: mutual offers open a new room, colours swapped, same clock, fresh deal, no leak', async () => {
  const { room, red, black } = await finishedRoom();
  const spectator = await connect(room, 'client-watch');

  red.socket.receive({ type: 'rematch:offer' });
  await settle();
  black.socket.receive({ type: 'rematch:offer' });
  await settle();

  const redRedirect = red.socket.ofType('rematch:redirect')[0];
  const blackRedirect = black.socket.ofType('rematch:redirect')[0];
  assert.ok(redRedirect && blackRedirect, 'both players are redirected');
  assert.equal(spectator.socket.ofType('rematch:redirect').length, 0, 'the spectator is not');
  assert.equal(redRedirect.roomId, blackRedirect.roomId);
  assert.equal(redRedirect.url, `/room/${redRedirect.roomId}`);
  assert.equal(redRedirect.seat, 'black', 'red plays black next');
  assert.equal(blackRedirect.seat, 'red', 'black plays red next');
  assert.equal(lastRematchState(spectator.socket)?.finalizedRoomId, redRedirect.roomId);

  const next = jieqiRooms.get(redRedirect.roomId as string);
  assert.ok(next, 'the new room is live');
  assert.notEqual(next.id, room.id);
  assert.deepEqual(next.projection.timeControl, TEN_PLUS_FIVE, 'same clock');
  assert.equal(next.rated, false, 'a casual game rematches casual');
  assert.ok(dealOf(next), 'the new room holds a deal server-side');
  assert.notDeepEqual(dealOf(next), dealOf(room), 'fresh deal');

  // Both players take their swapped seats with the redirect tokens.
  const newRed = await connect(next, 'client-new-red', blackRedirect.seatToken as string);
  const newBlack = await connect(next, 'client-new-black', redRedirect.seatToken as string);
  assert.equal(newRed.seat, 'red');
  assert.equal(newBlack.seat, 'black');
  // An old spectator has no token, so it cannot take a seat in the new room.
  const watcher = await connect(next, 'client-watch');
  assert.equal(watcher.seat, 'spectator');

  // Hidden-info regression over every payload the new room sent anyone.
  for (const client of [newRed, newBlack, watcher]) {
    const wire = JSON.stringify(client.socket.sent);
    assert.ok(!wire.includes('"setup"'), `${client.seat} received the deal`);
    for (const payload of client.socket.sent) {
      const board = (payload.state as { board?: Record<string, Record<string, unknown>> })?.board;
      for (const [square, entry] of Object.entries(board ?? {})) {
        if (entry.faceDown) {
          assert.ok(!('role' in entry), `${client.seat} sees the role under ${square}`);
        }
      }
    }
  }
  // The live new room carries no rematch state yet.
  assert.ok(!('rematch' in (newRed.socket.ofType('hello')[0] ?? {})));

  // A late offer on the old room does nothing: it is already finalized.
  red.socket.receive({ type: 'rematch:offer' });
  await settle();
  assert.equal(red.socket.ofType('rematch:redirect').length, 1);
});

// ── finalize rules, against a hydrated finished room ─────────────────────────

type JieqiCtx = TenantRematchContext<
  'jieqi',
  JieqiColor,
  JieqiMove,
  JieqiGameState,
  typeof JIEQI_SPEC_ID,
  { seat: JieqiColor | 'spectator'; seatTokenHash?: string }
>;

function finishedHydratedRoom(rated: boolean, users: { red: string | null; black: string | null }) {
  const roomId = 'jq_rematch_unit';
  const events: JieqiEvent[] = [
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: JIEQI_SPEC_ID,
      setup: STANDARD_JIEQI_DEAL,
      timeControl: { initialMs: 60_000, incrementMs: 1_000 },
      ...(rated ? { rated: true } : {}),
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'c-red', seat: 'red' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'c-black', seat: 'black' },
    { type: 'seat-resigned', at: 4_000, roomId, color: 'red' },
  ];
  const created = createTenantRuntimeRoomFromEvents(jieqiTenant, events);
  assert.ok(created.ok);
  const room = created.room;
  assert.equal(room.projection.state.status.type, 'finished');
  for (const seat of ['red', 'black'] as const) {
    const { state } = mintTenantSeatToken(room, seat, {
      userId: users[seat],
      userHandle: null,
      userDisplayName: null,
    });
    room.seatTokens[seat] = state;
    room.rematch.offers[seat] = { tokenHash: state.tokenHash, userId: users[seat], at: 5_000 };
  }
  return room;
}

function stubContext(overrides: Partial<JieqiCtx> = {}) {
  const calls: { rated: boolean }[] = [];
  const ctx: JieqiCtx = {
    send: () => {},
    createRoom: async (timeControl, rated) => {
      calls.push({ rated });
      const created = await createJieqiRoom(timeControl, 'random', undefined, rated);
      assert.ok(created.ok);
      return { ok: true, room: created.room as unknown as JieqiRuntimeRoom };
    },
    issueSeatToken: async (room, seat, identity) => mintTenantSeatToken(room, seat, identity),
    buildRoomUrl: (roomId) => `/room/${roomId}`,
    ...overrides,
  };
  return { ctx, calls };
}

test('jieqi rematch: a rated game rematches rated only between two accounts', async () => {
  const accounts = finishedHydratedRoom(true, { red: 'u-red', black: 'u-black' });
  const a = stubContext();
  await finalizeTenantRematchIfReady(jieqiTenant, a.ctx, accounts);
  assert.deepEqual(a.calls, [{ rated: true }]);

  const guest = finishedHydratedRoom(true, { red: 'u-red', black: null });
  const b = stubContext();
  await finalizeTenantRematchIfReady(jieqiTenant, b.ctx, guest);
  assert.deepEqual(b.calls, [{ rated: false }]);

  const casual = finishedHydratedRoom(false, { red: 'u-red', black: 'u-black' });
  const c = stubContext();
  await finalizeTenantRematchIfReady(jieqiTenant, c.ctx, casual);
  assert.deepEqual(c.calls, [{ rated: false }]);
});

test('jieqi rematch context: rated carries over only while the rated switch and pace allow it', async () => {
  const prior = process.env.MISTBOARD_RATED_ENABLED;
  // The default context every tenant gets (rematch-context.ts), found by room id.
  const jieqiRematchContext = registeredTenantRematchContext<
    'jieqi',
    JieqiColor,
    JieqiMove,
    JieqiGameState,
    string,
    JieqiLiveRoom['clients'] extends Set<infer Client> ? Client : never
  >(`${jieqiTenant.roomIdPrefix}probe`, () => {});
  assert.ok(jieqiRematchContext, 'jieqi resolves the registry rematch context');
  try {
    process.env.MISTBOARD_RATED_ENABLED = 'true';
    const rated = await jieqiRematchContext.createRoom(
      { initialMs: 60_000, incrementMs: 1_000 },
      true,
    );
    assert.ok(rated.ok);
    assert.equal(rated.room.rated, true, 'rated 1+1 stays rated');
    const offPace = await jieqiRematchContext.createRoom(TEN_PLUS_FIVE, true);
    assert.ok(offPace.ok);
    assert.equal(offPace.room.rated, false, 'a pace with no rated pool rematches casual');
    process.env.MISTBOARD_RATED_ENABLED = 'false';
    const switchedOff = await jieqiRematchContext.createRoom(
      { initialMs: 60_000, incrementMs: 1_000 },
      true,
    );
    assert.ok(switchedOff.ok);
    assert.equal(switchedOff.room.rated, false, 'rated switched off rematches casual');
  } finally {
    if (prior === undefined) delete process.env.MISTBOARD_RATED_ENABLED;
    else process.env.MISTBOARD_RATED_ENABLED = prior;
  }
});

test('jieqi rematch: a play-locked account cancels the rematch', async () => {
  const room = finishedHydratedRoom(true, { red: 'u-red', black: 'u-locked' });
  const { ctx, calls } = stubContext({ accountMayPlay: async (userId) => userId !== 'u-locked' });
  const result = await finalizeTenantRematchIfReady(jieqiTenant, ctx, room);
  assert.equal(result, null);
  assert.deepEqual(calls, [], 'no room is created');
  assert.deepEqual(room.rematch.offers, {}, 'the offers are cleared');
});

test('jieqi rematch: a repeated offer during finalize does not open a second room', async () => {
  const room = finishedHydratedRoom(false, { red: null, black: null });
  const { ctx, calls } = stubContext();
  const [first, second] = await Promise.all([
    finalizeTenantRematchIfReady(jieqiTenant, ctx, room),
    finalizeTenantRematchIfReady(jieqiTenant, ctx, room),
  ]);
  assert.equal(calls.length, 1);
  assert.ok(first);
  assert.equal(second, null);
});
