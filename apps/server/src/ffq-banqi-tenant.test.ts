import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test, { type TestContext } from 'node:test';
import {
  applyFFQBanqiMove,
  createFFQBanqiDeal,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiMove,
  type FFQBanqiState,
  getFFQBanqiLegalMoves,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import {
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
} from './variant-tenant/runtime.js';
import { clearTenantRuntimeTimers, createTenantWsRuntime } from './variant-tenant/ws.js';

const ws = createTenantWsRuntime(ffqBanqiTenant);
type LiveRoom = Parameters<typeof ws.handleConnection>[3];
const CTX = { defaultRoomRegion: 'test', wsMessageLimit: 1000, wsMessageWindowMs: 1000 };

class FakeSocket {
  sent: Record<string, unknown>[] = [];
  closes: unknown[] = [];
  private handlers = new Map<string, (arg: unknown) => void>();
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
  on(event: string, cb: (arg: unknown) => void): this {
    this.handlers.set(event, cb);
    return this;
  }
  async receive(message: unknown): Promise<void> {
    this.handlers.get('message')?.(JSON.stringify(message));
    for (let n = 0; n < 10; n++) await new Promise((resolve) => setImmediate(resolve));
  }
  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

function request(id: string, token?: string): IncomingMessage {
  return {
    url: `/?client=${id}`,
    headers: {
      host: 'localhost',
      ...(token ? { 'sec-websocket-protocol': `mistboard-seat.${token}` } : {}),
    },
  } as IncomingMessage;
}

function roomFor(t: TestContext): LiveRoom {
  const hydrated = createTenantRuntimeRoomFromEvents(ffqBanqiTenant, [
    {
      type: 'room-created',
      at: Date.now(),
      roomId: 'ffq_test',
      gameSpecId: FFQ_BANQI_SPEC_ID,
      setup: { deal: createFFQBanqiDeal(800) },
    },
  ]);
  assert.ok(hydrated.ok);
  const room = hydrated.room as LiveRoom;
  t.after(() => clearTenantRuntimeTimers(room));
  return room;
}

async function join(room: LiveRoom, id: string, token?: string): Promise<FakeSocket> {
  const socket = new FakeSocket();
  await ws.handleConnection(CTX, socket.asWebSocket(), request(id, token), room);
  assert.deepEqual(socket.closes, []);
  return socket;
}

function hello(socket: FakeSocket) {
  const frame = socket.sent.find((frame) => frame.type === 'hello');
  assert.ok(frame);
  return frame;
}

test('FFQ creates a durable random setup, with no bot or rematch plumbing', () => {
  const created = createTenantRuntimeRoom(ffqBanqiTenant, 'ffq_random');
  assert.ok(created.ok);
  const first = created.room.events[0];
  assert.equal(first.type, 'room-created');
  assert.ok(first.type === 'room-created' && first.setup);
  assert.deepEqual(
    replayTenantEvents(ffqBanqiTenant, created.room.events),
    created.room.projection,
  );
  assert.equal(created.room.rated, false);
  assert.equal(created.room.pveBotId, null);
  assert.equal(ffqBanqiTenant.engine, undefined);
  assert.ok(ffqBanqiTenant.rematch?.optOut);
  for (const setup of [undefined, {}, { deal: [] }]) {
    const hydrated = createTenantRuntimeRoomFromEvents(ffqBanqiTenant, [
      {
        type: 'room-created',
        at: 1,
        roomId: 'ffq_bad',
        gameSpecId: FFQ_BANQI_SPEC_ID,
        setup,
      },
    ]);
    assert.deepEqual(hydrated, { ok: false, error: 'unreplayable_event_log' });
  }
});

test('FFQ joins fixed Red/Black seats, waits for both, alternates and rejects illegal moves', async (t) => {
  const room = roomFor(t);
  const red = await join(room, 'client-red');
  assert.equal(hello(red).seat, 'red');
  await red.receive({ type: 'move', from: 0, to: 0 });
  assert.equal(room.projection.state.ply, 0, 'wait for the opponent');
  const black = await join(room, 'client-black');
  assert.equal(hello(black).seat, 'black');
  const watcher = await join(room, 'watcher');
  assert.equal(hello(watcher).seat, 'spectator');

  const before = JSON.stringify(room.events);
  for (const message of [
    { type: 'move', from: -1, to: -1 },
    { type: 'move', from: 32, to: 32 },
    { type: 'move', from: 0.5, to: 0.5 },
    { type: 'move', from: '0', to: '0' },
    { type: 'move', from: null, to: null },
    { type: 'move', from: 0 },
    { type: 'move', from: 0, to: 1 }, // covered pieces cannot move
    { type: 'move', from: 15, to: 15 }, // face-up pieces cannot flip
  ])
    await red.receive(message);
  await black.receive({ type: 'move', from: 0, to: 0 });
  await watcher.receive({ type: 'move', from: 0, to: 0 });
  assert.equal(JSON.stringify(room.events), before, 'rejections never enter the log');

  await red.receive({ type: 'move', from: 0, to: 0 });
  assert.deepEqual(room.projection.state.status, { type: 'playing', turn: 'black' });
  await red.receive({ type: 'move', from: 1, to: 1 });
  assert.equal(room.projection.state.ply, 1);
  await black.receive({ type: 'move', from: 1, to: 1 });
  assert.equal(room.projection.state.ply, 2);
  assert.deepEqual(room.projection.state.status, { type: 'playing', turn: 'red' });
  assert.deepEqual(room.projection.state.hp, { red: 60, black: 60 });

  const token = hello(red).seatToken;
  assert.equal(typeof token, 'string');
  const reconnect = await join(room, 'client-returned', token as string);
  assert.equal(hello(reconnect).seat, 'red');
  assert.equal((hello(reconnect).liveHistory as unknown[]).length, 3);
  assert.equal(room.clients.size, 4, 'the newer red connection displaced the old one');
  assert.equal([...room.clients].filter((client) => client.displaced).length, 1);
  for (const socket of [red, black, watcher, reconnect]) {
    const wire = JSON.stringify(socket.sent);
    assert.ok(!wire.includes('"setup"'));
    assert.ok(!wire.includes('"deal"'));
    for (const frame of socket.sent) {
      const state = frame.state as FFQBanqiState | undefined;
      if (state)
        for (const piece of state.board)
          if (piece?.faceDown) assert.deepEqual(piece, { faceDown: true });
    }
  }
});

for (const goal of ['hp', 'no-progress'] as const) {
  test(`FFQ plays through the websocket to ${goal === 'hp' ? 'zero HP' : 'the 30-ply draw'}, then freezes`, async (t) => {
    const room = roomFor(t);
    const red = await join(room, 'client-red');
    const black = await join(room, 'client-black');
    const watcher = await join(room, 'watcher');
    let captures = 0;
    for (let ply = 0; ply < 100 && room.projection.state.status.type === 'playing'; ply++) {
      const state = room.projection.state;
      const moves = getFFQBanqiLegalMoves(state);
      const flips = moves.filter((move) => move.from === move.to);
      const quiet = moves.filter((move) => move.from !== move.to && !state.board[move.to]);
      const takes = moves.filter((move) => move.from !== move.to && state.board[move.to]);
      const move =
        goal === 'hp' ? (takes[0] ?? flips[0] ?? quiet[0]) : (flips[0] ?? quiet[0] ?? takes[0]);
      assert.ok(move);
      const expected = applyFFQBanqiMove(state, move);
      if (expected.captures.length > state.captures.length) captures++;
      await (state.status.type === 'playing' && state.status.turn === 'red' ? red : black).receive({
        type: 'move',
        ...move,
      });
      assert.deepEqual(room.projection.state, expected);
    }
    assert.ok(captures > 0, 'line includes captures and public HP damage');
    assert.deepEqual(room.projection.state.status, {
      type: 'finished',
      winner: goal === 'hp' ? 'red' : null,
      reason: goal,
    });
    assert.equal(room.projection.state.ply, goal === 'hp' ? 25 : 60);
    if (goal === 'hp') assert.equal(room.projection.state.hp.black, 0);
    else assert.equal(room.projection.state.noProgressClock, 30);
    const summary = buildTenantGameSummary(ffqBanqiTenant, room);
    assert.equal(summary.result, goal === 'hp' ? 'red-wins' : 'draw');
    assert.equal(summary.termination, goal === 'hp' ? 'points' : 'progress-clock');
    const before = JSON.stringify(room.events);
    await red.receive({ type: 'move', from: 0, to: 0 });
    await black.receive({ type: 'move', from: 1, to: 1 });
    assert.equal(JSON.stringify(room.events), before);
    assert.deepEqual(replayTenantEvents(ffqBanqiTenant, room.events), room.projection);
    for (const socket of [red, black, watcher]) {
      await socket.receive({ type: 'snapshot:request' });
      const frame = socket.sent.at(-1)!;
      assert.equal(frame.type, 'snapshot');
      const state = frame.state as FFQBanqiState;
      for (const piece of JSON.parse(JSON.stringify(state.board))) {
        if (piece?.faceDown) assert.deepEqual(piece, { faceDown: true });
      }
      assert.ok(!JSON.stringify(frame).includes('"setup"'));
    }
    const late = await join(room, 'late-watcher');
    assert.equal(hello(late).seat, 'spectator');
    assert.equal((hello(late).liveHistory as unknown[]).length, room.projection.state.ply + 1);
  });
}

test('FFQ lifecycle endings replay and every termination has a persistence mapping', () => {
  const roomId = 'ffq_lifecycle';
  const header: FFQBanqiEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId,
      gameSpecId: FFQ_BANQI_SPEC_ID,
      setup: { deal: createFFQBanqiDeal(800) },
    },
    { type: 'seat-assigned', at: 2, roomId, seat: 'red', clientId: 'r' },
    { type: 'seat-assigned', at: 3, roomId, seat: 'black', clientId: 'b' },
  ];
  const endings: Array<[FFQBanqiEvent, FFQBanqiState['status']]> = [
    [
      { type: 'seat-resigned', at: 4, roomId, color: 'red' },
      { type: 'finished', winner: 'black', reason: 'resignation' },
    ],
    [
      { type: 'seat-forfeited', at: 4, roomId, color: 'black' },
      { type: 'finished', winner: 'red', reason: 'abandonment' },
    ],
    [
      {
        type: 'clock-expired',
        at: 4,
        roomId,
        color: 'red',
        clock: {
          activeColor: null,
          incrementMs: 0,
          initialMs: 1000,
          remainingMs: { red: 0, black: 1000 },
          runningSince: null,
        },
      },
      { type: 'finished', winner: 'black', reason: 'timeout' },
    ],
    [
      { type: 'game-aborted', at: 4, roomId, reason: 'user-abort' },
      { type: 'aborted', reason: 'user-abort' },
    ],
  ];
  for (const [ending, status] of endings)
    assert.deepEqual(replayTenantEvents(ffqBanqiTenant, [...header, ending]).state.status, status);
  const draw = ffqBanqiTenant.rules.finishDraw!;
  assert.deepEqual(draw(replayTenantEvents(ffqBanqiTenant, header).state).status, {
    type: 'finished',
    winner: null,
    reason: 'agreement',
  });
  assert.deepEqual(
    [
      'hp',
      'no-progress',
      'no-legal-move',
      'timeout',
      'resignation',
      'abandonment',
      'agreement',
    ].map(ffqBanqiTenant.persistence.termination),
    ['points', 'progress-clock', 'no-legal-moves', 'timeout', 'resignation', 'abandonment', 'draw'],
  );
  assert.throws(() => ffqBanqiTenant.persistence.termination('unknown'));
});

test('FFQ parses integer index moves without retaining client-supplied identity fields', () => {
  const move = { from: 0, to: 31, role: 'general', setup: { secret: true } };
  assert.ok(ffqBanqiTenant.rules.isMove(move));
  assert.deepEqual(ffqBanqiTenant.rules.moveFromMessage(move as never), {
    from: 0,
    to: 31,
  } satisfies FFQBanqiMove);
});
