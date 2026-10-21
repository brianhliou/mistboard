/**
 * Draw offers in PvP tenant games (#530), end to end through the real ws
 * adapter and room factory (in-memory, no DB): offer and accept ends the game
 * as a draw (result 'draw', termination 'draw', rated as a draw), a decline
 * blocks the same player's next offer for DRAW_OFFER_COOLDOWN_MOVES of their
 * own moves, an offer lapses when the offerer's opponent moves, and only one
 * offer is pending at a time. The Fog Xiangqi half is the hidden-info
 * regression: the draw events never reach a client and the snapshot field
 * names only the offering seat.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import type { WebSocket } from 'ws';
import { createDarkXiangqiRoom } from './dark-xiangqi-registration.js';
import type { DarkXiangqiRuntimeRoom } from './dark-xiangqi-runtime.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { handleDarkXiangqiWebSocketConnection } from './server-ws-dark-xiangqi.js';
import { handleXiangqiWebSocketConnection } from './server-ws-xiangqi.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import { DRAW_OFFER_COOLDOWN_MOVES, replayTenantEvents } from './variant-tenant/runtime.js';
import { createXiangqiRoom } from './xiangqi-registration.js';
import type { XiangqiRuntimeRoom } from './xiangqi-runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_XIANGQI_ENABLED = 'true';
process.env.MISTBOARD_DARK_XIANGQI_ENABLED = 'true';

const TEN_PLUS_FIVE = { initialMs: 600_000, incrementMs: 5_000 };
const WS_CTX = { defaultRoomRegion: 'test', wsMessageLimit: 1_000, wsMessageWindowMs: 1_000 };

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
  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

function request(clientId: string): IncomingMessage {
  return { url: `/?client=${clientId}`, headers: { host: 'localhost' } } as IncomingMessage;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

type Seat = { socket: FakeSocket; send(message: unknown): Promise<void> };

function seat(socket: FakeSocket): Seat {
  return {
    socket,
    async send(message) {
      socket.receive(message);
      await settle();
    },
  };
}

// Plain opening moves (ranks 1-10, red on 1), legal in xiangqi and in fog
// xiangqi alike.
const RED_MOVES = [
  { from: 'h3', to: 'e3' },
  { from: 'b1', to: 'c3' },
  { from: 'h1', to: 'g3' },
  { from: 'a1', to: 'a2' },
  { from: 'i1', to: 'i2' },
  { from: 'a2', to: 'd2' },
  { from: 'i2', to: 'f2' },
  { from: 'c4', to: 'c5' },
  { from: 'g4', to: 'g5' },
  { from: 'a4', to: 'a5' },
  { from: 'i4', to: 'i5' },
  { from: 'e4', to: 'e5' },
];
const BLACK_MOVES = [
  { from: 'h8', to: 'e8' },
  { from: 'b10', to: 'c8' },
  { from: 'h10', to: 'g8' },
  { from: 'a10', to: 'a9' },
  { from: 'i10', to: 'i9' },
  { from: 'a9', to: 'd9' },
  { from: 'i9', to: 'f9' },
  { from: 'c7', to: 'c6' },
  { from: 'g7', to: 'g6' },
  { from: 'a7', to: 'a6' },
  { from: 'i7', to: 'i6' },
  { from: 'e7', to: 'e6' },
];

// The two sockets by the seat each hello assigned.
function bySeat(a: FakeSocket, b: FakeSocket): { red: Seat; black: Seat } {
  const seatOf = (socket: FakeSocket) => socket.sent.find((frame) => frame.type === 'hello')?.seat;
  assert.deepEqual(new Set([seatOf(a), seatOf(b)]), new Set(['red', 'black']));
  return seatOf(a) === 'red' ? { red: seat(a), black: seat(b) } : { red: seat(b), black: seat(a) };
}

async function xiangqiGame() {
  const created = await createXiangqiRoom(TEN_PLUS_FIVE, 'red');
  assert.ok(created.ok);
  const room = created.room;
  const a = new FakeSocket();
  await handleXiangqiWebSocketConnection(WS_CTX, a.asWebSocket(), request('c-a'), room);
  const b = new FakeSocket();
  await handleXiangqiWebSocketConnection(WS_CTX, b.asWebSocket(), request('c-b'), room);
  await settle();
  return { room, ...bySeat(a, b) };
}

// Plays `plies` alternating moves from the start (red first).
async function play(
  game: { red: Seat; black: Seat; room: { events: readonly { type: string }[] } },
  plies: number,
  from = 0,
) {
  for (let ply = from; ply < from + plies; ply += 1) {
    const isRed = ply % 2 === 0;
    const moves = isRed ? RED_MOVES : BLACK_MOVES;
    const move = moves[Math.floor(ply / 2)];
    assert.ok(move, `fixture has a move for ply ${ply}`);
    await (isRed ? game.red : game.black).send({ type: 'move', ...move });
    const played = game.room.events.filter((event) => event.type === 'move-played').length;
    assert.equal(played, ply + 1, `ply ${ply} was played`);
  }
}

function lastFrame(socket: FakeSocket): Record<string, unknown> {
  const frame = socket.sent.at(-1);
  assert.ok(frame);
  return frame;
}

test('draw: an accepted offer ends the game as a draw by agreement', async () => {
  const game = await xiangqiGame();
  await play(game, 2);
  await game.red.send({ type: 'draw:offer' });
  assert.deepEqual(game.room.projection.drawOffer, { from: 'red' });
  // Both seats are told who offered, and nothing else about it.
  assert.deepEqual(lastFrame(game.black.socket).drawOffer, { from: 'red' });
  assert.deepEqual(lastFrame(game.red.socket).drawOffer, { from: 'red' });

  await game.black.send({ type: 'draw:accept' });
  const status = game.room.projection.state.status;
  assert.equal(status.type, 'finished');
  assert.equal(status.type === 'finished' ? status.winner : 'x', null);
  assert.equal(status.type === 'finished' ? status.reason : 'x', 'agreement');
  assert.equal(game.room.projection.drawOffer, undefined, 'the offer is spent');
  assert.equal(game.room.projection.clock?.runningSince, null, 'the clock stops');

  const summary = buildTenantGameSummary(xiangqiTenant, game.room as unknown as XiangqiRuntimeRoom);
  assert.equal(summary.result, 'draw');
  assert.equal(summary.termination, 'draw');

  // The log replays to the same finish (correspondence and reload read it back).
  const replayed = replayTenantEvents(xiangqiTenant, game.room.events);
  assert.deepEqual(replayed.state.status, status);
});

test('draw: offering while the opponent has an offer pending accepts it', async () => {
  const game = await xiangqiGame();
  await play(game, 2);
  await game.red.send({ type: 'draw:offer' });
  await game.black.send({ type: 'draw:offer' });
  const status = game.room.projection.state.status;
  assert.equal(status.type === 'finished' ? status.reason : status.type, 'agreement');
});

test('draw: no offer before both sides have moved, none from a spectator, one at a time', async () => {
  const game = await xiangqiGame();
  await game.red.send({ type: 'draw:offer' });
  assert.equal(game.room.projection.drawOffer, undefined, 'no offer before move 2');
  await play(game, 2);

  const watcher = new FakeSocket();
  await handleXiangqiWebSocketConnection(
    WS_CTX,
    watcher.asWebSocket(),
    request('c-watch'),
    game.room,
  );
  watcher.receive({ type: 'draw:offer' });
  await settle();
  assert.equal(game.room.projection.drawOffer, undefined, 'a spectator cannot offer');

  await game.red.send({ type: 'draw:offer' });
  const before = game.room.events.length;
  await game.red.send({ type: 'draw:offer' });
  assert.equal(game.room.events.length, before, 'a second offer from the same seat is dropped');
  // Accepting your own offer does nothing.
  await game.red.send({ type: 'draw:accept' });
  assert.equal(game.room.projection.state.status.type, 'playing');
});

test('draw: the offer lapses when the opponent moves instead of answering', async () => {
  const game = await xiangqiGame();
  await play(game, 3);
  // Black to move; red offers on black's turn.
  await game.red.send({ type: 'draw:offer' });
  assert.deepEqual(game.room.projection.drawOffer, { from: 'red' });
  await play(game, 1, 3);
  assert.equal(game.room.projection.drawOffer, undefined, 'the reply move declines it');
  assert.equal(lastFrame(game.red.socket).drawOffer, undefined);
  // A lapsed offer is not a decline: red may offer again at once.
  await game.red.send({ type: 'draw:offer' });
  assert.deepEqual(game.room.projection.drawOffer, { from: 'red' });
});

test('draw: the offerer moving keeps the offer standing', async () => {
  const game = await xiangqiGame();
  await play(game, 2);
  // Red to move; red offers and then moves.
  await game.red.send({ type: 'draw:offer' });
  await play(game, 1, 2);
  assert.deepEqual(game.room.projection.drawOffer, { from: 'red' });
});

test('draw: a decline blocks the same player for N of their own moves', async () => {
  const game = await xiangqiGame();
  await play(game, 2);
  await game.red.send({ type: 'draw:offer' });
  await game.black.send({ type: 'draw:decline' });
  assert.equal(game.room.projection.drawOffer, undefined);
  assert.equal(game.room.projection.state.status.type, 'playing');
  assert.equal(game.room.projection.drawCooldown?.red, DRAW_OFFER_COOLDOWN_MOVES);
  assert.equal(lastFrame(game.red.socket).drawOfferCooldown, DRAW_OFFER_COOLDOWN_MOVES);
  assert.equal(
    lastFrame(game.black.socket).drawOfferCooldown,
    undefined,
    "a seat is never told the other seat's cooldown",
  );

  await game.red.send({ type: 'draw:offer' });
  assert.equal(game.room.projection.drawOffer, undefined, 'red is cooling down');
  // Black was not declined, so black may still offer.
  await play(game, 1, 2);
  await game.black.send({ type: 'draw:offer' });
  assert.deepEqual(game.room.projection.drawOffer, { from: 'black' });
  await game.red.send({ type: 'draw:decline' });

  // Red's cooldown counts red's own moves: one already played above.
  let ply = 3;
  for (let redMoves = 1; redMoves < DRAW_OFFER_COOLDOWN_MOVES; redMoves += 1) {
    await game.red.send({ type: 'draw:offer' });
    assert.equal(game.room.projection.drawOffer, undefined, `blocked after ${redMoves} moves`);
    await play(game, 2, ply);
    ply += 2;
  }
  await game.red.send({ type: 'draw:offer' });
  assert.deepEqual(game.room.projection.drawOffer, { from: 'red' }, 'unblocked after N moves');
  assert.equal(game.room.projection.drawCooldown?.red ?? 0, 0);
});

test('draw: Fog Xiangqi sends no draw event to any client and only the offering seat', async () => {
  const created = await createDarkXiangqiRoom(TEN_PLUS_FIVE, 'red');
  assert.ok(created.ok);
  const room = created.room;
  const a = new FakeSocket();
  await handleDarkXiangqiWebSocketConnection(WS_CTX, a.asWebSocket(), request('f-a'), room);
  const b = new FakeSocket();
  await handleDarkXiangqiWebSocketConnection(WS_CTX, b.asWebSocket(), request('f-b'), room);
  await settle();
  const game = { room, ...bySeat(a, b) };
  const redSocket = game.red.socket;
  const blackSocket = game.black.socket;
  await play(game, 3);
  const beforeOffer = lastFrame(blackSocket);
  await game.red.send({ type: 'draw:offer' });

  const offerFrame = lastFrame(blackSocket);
  assert.equal(offerFrame.type, 'event-appended');
  assert.equal('event' in offerFrame, false, 'the draw event itself never ships');
  assert.deepEqual(offerFrame.drawOffer, { from: 'red' }, 'the field is the seat and nothing else');
  assert.deepEqual(offerFrame.drawOfferPlies, [3], 'the move-list mark is a ply count');
  // Nothing else in the frame differs from what black already held: the same
  // board, the same keys bar the event (absent) and the offer (added).
  assert.deepEqual(offerFrame.state, beforeOffer.state, 'the board half is unchanged');
  const keys = (frame: Record<string, unknown>) =>
    Object.keys(frame)
      .filter((key) => key !== 'event' && key !== 'drawOffer' && key !== 'drawOfferPlies')
      .sort();
  assert.deepEqual(keys(offerFrame), keys(beforeOffer));

  await game.black.send({ type: 'draw:decline' });
  await game.red.send({ type: 'snapshot:request' });
  const snapshot = lastFrame(redSocket) as { events: { type: string }[] };
  for (const event of snapshot.events) {
    assert.ok(!event.type.startsWith('draw-'), `${event.type} stays on the server`);
  }
  // An accepted fog draw finishes the room and reveals as every finish does.
  await play(game, 1, 3);
  await game.black.send({ type: 'draw:offer' });
  await game.red.send({ type: 'draw:accept' });
  const status = room.projection.state.status;
  assert.equal(status.type === 'finished' ? status.reason : status.type, 'agreement');
  const runtimeRoom = room as unknown as DarkXiangqiRuntimeRoom;
  const summary =
    darkXiangqiTenant.persistence.buildGameSummary?.(runtimeRoom) ??
    buildTenantGameSummary(darkXiangqiTenant, runtimeRoom);
  assert.equal(summary.result, 'draw');
  assert.equal(summary.termination, 'draw');
});
