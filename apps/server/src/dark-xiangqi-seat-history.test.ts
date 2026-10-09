/**
 * Hidden-info regression for the LIVE Fog Xiangqi seat history: the per-ply
 * views a seated player receives in its hello frame so that, after a reload,
 * it can step back through its own game (visibility.seatHistory,
 * tenantSeatHistoryExtras, ws.ts handleConnection).
 *
 * Pins, against the real tenant and the real WS runtime (fake socket, no DB):
 *   a. red's history is exactly what viewForClient served red at each ply
 *      (legalMoves aside), so nothing in it was not already on red's wire;
 *   b. at every ply no opponent piece identity outside red's visibleSquares,
 *      no shrouded entry with a piece, no lastMove for a black move, and never
 *      the truth board;
 *   c. black's hello carries black's own history, never red's;
 *   d. a spectator (admitted on a dev runtime) and a seatless production
 *      visitor get no history in any frame;
 *   e. the gate refuses spectators and finished/aborted rooms, and broadcast
 *      snapshots never carry it.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { DARK_XIANGQI_SPEC_ID, getLegalMoves, type XiangqiMove } from '@mistboard/game';
import type { WebSocket } from 'ws';
import type { DarkXiangqiEvent, DarkXiangqiRuntimeRoom } from './dark-xiangqi-runtime.js';
import {
  type DarkXiangqiWirePlayerView,
  darkXiangqiSeatHistory,
  darkXiangqiTenant,
} from './dark-xiangqi-tenant.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantSeatHistoryExtras,
} from './variant-tenant/runtime.js';
import { mintTenantSeatToken } from './variant-tenant/seat-session.js';
import { createTenantWsRuntime } from './variant-tenant/ws.js';

process.env.MISTBOARD_DARK_XIANGQI_ENABLED = 'true';

const ROOM_ID = 'dxq_seat_history';
const MOVES = 10;

const ws = createTenantWsRuntime(darkXiangqiTenant);
type LiveRoom = Parameters<typeof ws.handleConnection>[3];
const WS_CTX = { wsMessageLimit: 100, wsMessageWindowMs: 1_000 } as const;

type Snapshot = { ply: number; view: DarkXiangqiWirePlayerView };

class FakeSocket {
  sent: Array<Record<string, unknown>> = [];
  closes: { code?: number; reason?: string }[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
  on(): this {
    return this;
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

async function withEnv(key: string, value: string | undefined, fn: () => Promise<void>) {
  const prior = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    await fn();
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

function hydrate(events: DarkXiangqiEvent[]): DarkXiangqiRuntimeRoom {
  const created = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, events);
  assert.ok(created.ok, 'event log must hydrate');
  return created.room;
}

// Prefer a capture (exercises the per-ply capture ledger), else the first
// legal move in a stable order.
function pickMove(room: DarkXiangqiRuntimeRoom): XiangqiMove {
  const state = room.projection.state;
  const moves = [...getLegalMoves(state)].sort((a, b) =>
    `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
  );
  const capture = moves.find((move) => state.board[move.to]);
  const move = capture ?? moves[0];
  assert.ok(move, 'scripted position must have a legal move');
  return { from: move.from, to: move.to };
}

// The log after each ply: logs[p] ends with the p-th move.
function liveGameLogs(): DarkXiangqiEvent[][] {
  const base: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1_000, roomId: ROOM_ID, gameSpecId: DARK_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2_000, roomId: ROOM_ID, clientId: 'client-red', seat: 'red' },
    {
      type: 'seat-assigned',
      at: 3_000,
      roomId: ROOM_ID,
      clientId: 'client-black',
      seat: 'black',
    },
  ];
  const logs = [base];
  for (let ply = 1; ply <= MOVES; ply += 1) {
    const prior = logs[ply - 1]!;
    const room = hydrate(prior);
    const status = room.projection.state.status;
    assert.equal(status.type, 'playing', 'the scripted game must stay live');
    const color = (status as { turn: 'red' | 'black' }).turn;
    logs.push([
      ...prior,
      {
        type: 'move-played',
        at: 10_000 + ply * 1_000,
        roomId: ROOM_ID,
        color,
        move: pickMove(room),
      },
    ]);
  }
  return logs;
}

const LOGS = liveGameLogs();
const FULL_LOG = LOGS.at(-1)!;

function liveRoom(events: DarkXiangqiEvent[] = FULL_LOG): LiveRoom {
  return hydrate(events) as unknown as LiveRoom;
}

function withoutLegalMoves(view: DarkXiangqiWirePlayerView): DarkXiangqiWirePlayerView {
  return { ...view, legalMoves: [] };
}

test('the scripted live game captures at least once (the ledger is exercised)', () => {
  const room = hydrate(FULL_LOG);
  const history = darkXiangqiSeatHistory(room.events, 'red');
  assert.ok(
    history.some((s) => s.view.captures.red.length + s.view.captures.black.length > 0),
    'no capture in the script: pick a different line',
  );
});

test('red live history: each ply is exactly what red was served live at that ply', () => {
  const history = darkXiangqiSeatHistory(FULL_LOG, 'red');
  assert.deepEqual(
    history.map((s) => s.ply),
    Array.from({ length: MOVES + 1 }, (_, ply) => ply),
  );
  for (const [ply, events] of LOGS.entries()) {
    const room = hydrate(events);
    const served = darkXiangqiTenant.visibility.viewForClient(
      room.projection.state,
      { id: 'client-red', seat: 'red', solo: false },
      room.events,
    );
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(history[ply]!.view)),
      JSON.parse(JSON.stringify(withoutLegalMoves(served))),
      `ply ${ply}: history differs from the live view red was sent`,
    );
  }
});

test('red live history: no hidden square, no black-only data, never truth, at any ply', () => {
  const history = darkXiangqiSeatHistory(FULL_LOG, 'red');
  let hiddenBlackPieces = 0;
  for (const [ply, events] of LOGS.entries()) {
    const { view } = history[ply]!;
    const truth = hydrate(events).projection.state;
    const visible = new Set<string>(view.visibleSquares);
    assert.equal(view.perspective, 'red', `ply ${ply}: perspective`);
    assert.ok(view.visibleSquares.length < 90, `ply ${ply}: red must not see every square`);
    for (const [square, entry] of Object.entries(view.board)) {
      if (!entry) continue;
      if (entry.shrouded) {
        assert.ok(!('piece' in entry), `ply ${ply}: shrouded ${square} carries a piece`);
        continue;
      }
      if (entry.piece.color !== 'red') {
        assert.ok(visible.has(square), `ply ${ply}: black piece on hidden ${square}`);
      }
    }
    // Every black piece outside red's vision is absent from red's board or
    // shrouded, so the truth board was never what red received.
    for (const [square, piece] of Object.entries(truth.board)) {
      if (piece?.color !== 'black' || visible.has(square)) continue;
      hiddenBlackPieces += 1;
      const entry = view.board[square as keyof typeof view.board];
      assert.ok(!entry || entry.shrouded, `ply ${ply}: hidden black piece on ${square} revealed`);
    }
    // Black's moves are black-only data: red's view at a black ply has no lastMove.
    const mover = ply === 0 ? null : (events.at(-1) as { color?: string }).color;
    if (mover !== 'red') assert.equal(view.lastMove, undefined, `ply ${ply}: lastMove leaked`);
    else assert.notEqual(view.lastMove, undefined, `ply ${ply}: red's own last move missing`);
    assert.deepEqual(view.legalMoves, [], `ply ${ply}: history carries no legal moves`);
  }
  assert.ok(hiddenBlackPieces > 0, 'the fog check asserted nothing');
});

test('seated red hello carries red history; black hello carries black, never red', async () => {
  await withEnv('NODE_ENV', 'production', async () => {
    const room = liveRoom();
    const red = mintTenantSeatToken(room, 'red', {
      userId: null,
      userHandle: null,
      userDisplayName: null,
    });
    const black = mintTenantSeatToken(room, 'black', {
      userId: null,
      userHandle: null,
      userDisplayName: null,
    });

    const redSocket = new FakeSocket();
    await ws.handleConnection(
      WS_CTX,
      redSocket.asWebSocket(),
      request('red-reload', red.rawToken),
      room,
    );
    const redHello = redSocket.sent.find((frame) => frame.type === 'hello');
    assert.ok(redHello, 'red got a hello');
    assert.equal(redHello.seat, 'red');
    const redHistory = redHello.seatHistory as Snapshot[];
    assert.equal(redHistory.length, MOVES + 1);
    assert.deepStrictEqual(
      redHistory,
      JSON.parse(JSON.stringify(darkXiangqiSeatHistory(room.events, 'red'))),
    );
    assert.ok(redHistory.every((s) => s.view.perspective === 'red'));
    assert.deepStrictEqual(
      redHistory.at(-1)!.view,
      withoutLegalMoves(redHello.state as DarkXiangqiWirePlayerView),
      'the last history ply is the live view',
    );

    const blackSocket = new FakeSocket();
    await ws.handleConnection(
      WS_CTX,
      blackSocket.asWebSocket(),
      request('black-reload', black.rawToken),
      room,
    );
    const blackHello = blackSocket.sent.find((frame) => frame.type === 'hello');
    assert.ok(blackHello);
    assert.equal(blackHello.seat, 'black');
    const blackHistory = blackHello.seatHistory as Snapshot[];
    assert.equal(blackHistory.length, MOVES + 1);
    assert.ok(blackHistory.every((s) => s.view.perspective === 'black'));
    for (const [ply, snapshot] of blackHistory.entries()) {
      assert.notDeepStrictEqual(snapshot.view, redHistory[ply]!.view, `ply ${ply}: red's view`);
    }

    // Every non-hello frame either seat received (the broadcast snapshots that
    // follow each join) carries no history.
    for (const frame of [...redSocket.sent, ...blackSocket.sent]) {
      if (frame.type === 'hello') continue;
      assert.equal('seatHistory' in frame, false, `${frame.type} frame carries history`);
    }
  });
});

test('a spectator and a seatless visitor get no seat history in any frame', async () => {
  // Dev runtime: a full fog room admits a read-only debug spectator.
  await withEnv('NODE_ENV', 'test', async () => {
    const room = liveRoom();
    const socket = new FakeSocket();
    await ws.handleConnection(WS_CTX, socket.asWebSocket(), request('dev-spectator'), room);
    const hello = socket.sent.find((frame) => frame.type === 'hello');
    assert.ok(hello, 'the dev spectator was admitted');
    assert.equal(hello.seat, 'spectator');
    for (const frame of socket.sent) {
      assert.equal('seatHistory' in frame, false, `spectator ${frame.type} carries history`);
    }
  });
  // Production, anonymous, or a token that matches no seat: refused, no frame.
  await withEnv('NODE_ENV', 'production', () =>
    withEnv('MISTBOARD_ADMIN_DEBUG_TOKEN', undefined, async () => {
      for (const token of [undefined, 'not-a-real-token']) {
        const room = liveRoom();
        const socket = new FakeSocket();
        await ws.handleConnection(WS_CTX, socket.asWebSocket(), request('anon', token), room);
        assert.deepEqual(socket.sent, [], 'a seatless visitor receives nothing');
        assert.equal(socket.closes[0]?.code, 1008);
      }
    }),
  );
});

test('the gate: spectators and finished or aborted rooms get nothing', () => {
  const room = hydrate(FULL_LOG);
  assert.deepEqual(
    tenantSeatHistoryExtras(darkXiangqiTenant, room, {
      id: 'spectator',
      seat: 'spectator',
      solo: false,
    }),
    {},
  );
  assert.equal(
    tenantSeatHistoryExtras(darkXiangqiTenant, room, { id: 'r', seat: 'red', solo: false })
      .seatHistory?.length,
    MOVES + 1,
  );
  const status = room.projection.state.status as { turn: 'red' | 'black' };
  const finished = hydrate([
    ...FULL_LOG,
    { type: 'seat-resigned', at: 99_000, roomId: ROOM_ID, color: status.turn },
  ]);
  assert.equal(finished.projection.state.status.type, 'finished');
  const aborted = hydrate([
    ...LOGS[0]!,
    { type: 'game-aborted', at: 4_000, roomId: ROOM_ID, reason: 'user-abort' },
  ]);
  for (const closed of [finished, aborted]) {
    for (const seat of ['red', 'black'] as const) {
      assert.deepEqual(
        tenantSeatHistoryExtras(darkXiangqiTenant, closed, { id: seat, seat, solo: false }),
        {},
      );
    }
  }
});
