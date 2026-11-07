import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { afterEach, test } from 'node:test';
import type { GomokuColor, GomokuOpening, GomokuSquare } from '@mistboard/game';
import type { WebSocket } from 'ws';
import { scheduleGomokuEngineMove } from './gomoku-engine.js';
import { gomokuWs } from './gomoku-registration.js';
import { gomokuTenant } from './gomoku-tenant.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
} from './variant-tenant/runtime.js';
import { mintTenantSeatToken } from './variant-tenant/seat-session.js';
import { clearTenantRuntimeTimers, createTenantWsRuntime } from './variant-tenant/ws.js';

type Room = Parameters<typeof gomokuWs.handleConnection>[3];
const rooms: Room[] = [];
const passiveWs = createTenantWsRuntime(gomokuTenant);
const flag = process.env.MISTBOARD_GOMOKU_ENABLED;
afterEach(() => {
  for (const room of rooms.splice(0)) clearTenantRuntimeTimers(room);
  if (flag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
  else process.env.MISTBOARD_GOMOKU_ENABLED = flag;
});

class Socket extends EventEmitter {
  sent: Record<string, unknown>[] = [];
  send(payload: string) {
    this.sent.push(JSON.parse(payload));
  }
  close() {}
}
const ctx = { wsMessageLimit: 100, wsMessageWindowMs: 1_000 };
const request = (id: string, token?: string) =>
  ({
    url: `/?client=${id}`,
    headers: {
      host: 'localhost',
      ...(token ? { 'sec-websocket-protocol': `mistboard-seat.${token}` } : {}),
    },
  }) as IncomingMessage;

async function fixture(
  human: GomokuColor,
  runtime = passiveWs,
  bot = true,
  opening?: GomokuOpening,
) {
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  const created = createTenantRuntimeRoom(
    {
      ...gomokuTenant,
      rules: { ...gomokuTenant.rules, createSetup: opening ? () => opening : undefined },
    },
    `gmk_auth_${rooms.length}`,
    {
      creatorPreference: human,
    },
  );
  assert.ok(created.ok);
  const room = created.room as Room;
  rooms.push(room);
  if (bot)
    appendTenantRuntimeEvent(gomokuTenant, room, {
      type: 'seat-assigned',
      at: Date.now(),
      roomId: room.id,
      seat: human === 'black' ? 'white' : 'black',
      clientId: 'rapfi-level-1',
    });
  const socket = new Socket();
  // Existing seats may reconnect after a playtest grant is revoked. Reserve
  // this fixture's seat so bot protocol tests need no account database.
  const { rawToken: seatToken } = mintTenantSeatToken(room, human, {
    userId: null,
    userHandle: null,
    userDisplayName: null,
  });
  await runtime.handleConnection(
    ctx,
    socket as unknown as WebSocket,
    request('human-player', seatToken),
    room,
  );
  return { room, socket, seatToken };
}
async function send(room: Room, socket: Socket, message: Record<string, unknown>) {
  socket.emit('message', JSON.stringify(message));
  await room.pendingWrites;
}
const botMove = (room: Room, to = 'i8') => ({
  type: 'move',
  to,
  browserBot: true,
  roomId: room.id,
  expectedPly: room.projection.state.ply - (room.projection.state.opening?.stones.length ?? 0),
});

test('Gomoku rejects every browser-supplied bot-seat move', async () => {
  for (const human of ['black', 'white'] as const) {
    const { room, socket } = await fixture(human, gomokuWs);
    if (human === 'black') {
      await send(room, socket, botMove(room, 'h8'));
      assert.equal(room.projection.state.ply, 0, 'the delegation flag is always rejected');
      await send(room, socket, { type: 'move', to: 'h8' });
    }
    const before = room.projection.state.ply;
    await send(room, socket, botMove(room));
    assert.equal(room.projection.state.ply, before, 'only the server may play the bot seat');
    await send(room, socket, {
      type: 'move',
      to: 'i8',
      color: human === 'black' ? 'white' : 'black',
    });
    assert.equal(room.projection.state.ply, before);
  }
});

test('a client claiming the bot seat cannot send an ordinary move either', async () => {
  const { room, socket } = await fixture('white');
  const client = [...room.clients].find(
    (candidate) => candidate.socket === (socket as unknown as WebSocket),
  );
  assert.ok(client);
  client.seat = 'black';
  client.id = 'rapfi-level-1';
  await send(room, socket, { type: 'move', to: 'h8' });
  assert.equal(room.projection.state.ply, 0);
});

test('connection and human moves schedule server replies; reconnect does not duplicate them', async () => {
  let calls = 0;
  const runtime = createTenantWsRuntime(gomokuTenant, {
    scheduleEngineMove: (lifecycle, room) =>
      scheduleGomokuEngineMove(lifecycle, room, async () => {
        calls++;
        return { to: calls === 1 ? 'h8' : 'i8' };
      }),
  });
  const { room, socket, seatToken } = await fixture('white', runtime);
  const waitForPly = async (ply: number) => {
    const deadline = Date.now() + 2_000;
    while (room.projection.state.ply < ply && Date.now() < deadline)
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    assert.equal(room.projection.state.ply, ply);
  };
  await waitForPly(1);
  await send(room, socket, { type: 'move', to: 'a1' });
  await waitForPly(3);
  const reconnect = new Socket();
  await runtime.handleConnection(
    ctx,
    reconnect as unknown as WebSocket,
    request('reconnect-human', seatToken),
    room,
  );
  assert.equal(reconnect.sent[0]?.seat, 'white');
  assert.equal(calls, 2);
  assert.equal(room.projection.state.board[112], 'black');
  assert.equal(room.projection.state.board[113], 'black');
});

test('dealt 3/4/5-stone bot games reject client replies regardless of played or absolute ply', async () => {
  for (const count of [3, 4, 5]) {
    const opening: GomokuOpening = {
      stones: ['h8', 'h9', 'i9', 'i8', 'g7'].slice(0, count).map((square, i) => ({
        square: square as GomokuSquare,
        color: i % 2 ? 'white' : 'black',
      })),
      turn: count % 2 ? 'white' : 'black',
    };
    const human = opening.turn === 'white' ? 'black' : 'white';
    const { room, socket } = await fixture(human, passiveWs, true, opening);
    assert.equal(room.projection.state.ply, count);
    await send(room, socket, { ...botMove(room, 'a1'), expectedPly: count });
    assert.equal(room.projection.state.ply, count, 'stone count is not the event ply');
    await send(room, socket, botMove(room, 'a1'));
    assert.equal(room.projection.state.ply, count);
    assert.equal(room.events.filter((event) => event.type === 'move-played').length, 0);
  }
});

for (const human of ['black', 'white'] as const) {
  test(`Gomoku rejects even a kernel-legal client bot turn from its ${human} human`, async () => {
    const { room, socket } = await fixture(human);
    assert.equal(socket.sent[0]?.seat, human);
    if (human === 'black') await send(room, socket, { type: 'move', to: 'h8' });
    const before = room.projection.state.ply;
    await send(room, socket, botMove(room));
    assert.equal(room.projection.state.ply, before);
    assert.equal(room.projection.state.board[113], null);
    // Re-sending while it is the human's turn must not play for the human.
    await send(room, socket, botMove(room, 'j8'));
    assert.equal(room.projection.state.ply, before);
  });
}

test('Gomoku browser bot rejects occupied points, missing/stale ply, wrong room, pause and rated', async () => {
  const { room, socket } = await fixture('black');
  await send(room, socket, { type: 'move', to: 'h8' });
  for (const message of [
    botMove(room, 'h8'),
    botMove(room, 'p1'),
    { ...botMove(room), expectedPly: undefined },
    { ...botMove(room), expectedPly: 0 },
    { ...botMove(room), roomId: 'gmk_another_room' },
    { ...botMove(room), roomId: undefined },
    { type: 'move', to: 'i8', color: 'white' },
  ]) {
    await send(room, socket, message);
    assert.equal(room.projection.state.ply, 1, JSON.stringify(message));
  }
  room.projection.paused = { at: Date.now(), activeColor: 'white' };
  await send(room, socket, botMove(room));
  assert.equal(room.projection.state.ply, 1);
  delete room.projection.paused;
  room.rated = true;
  await send(room, socket, botMove(room));
  assert.equal(room.projection.state.ply, 1);
  room.rated = false;
  await send(room, socket, botMove(room));
  assert.equal(room.projection.state.ply, 1);
});

test('Gomoku runtimes and PvP retain own-seat-only moves', async () => {
  const { room, socket } = await fixture('white', createTenantWsRuntime(gomokuTenant));
  await send(room, socket, botMove(room));
  assert.equal(room.projection.state.ply, 0);
  const pvp = await fixture('white', passiveWs, false);
  const black = new Socket();
  const { rawToken } = mintTenantSeatToken(pvp.room, 'black', {
    userId: null,
    userHandle: null,
    userDisplayName: null,
  });
  await passiveWs.handleConnection(
    ctx,
    black as unknown as WebSocket,
    request('other-player', rawToken),
    pvp.room,
  );
  await send(pvp.room, pvp.socket, botMove(pvp.room));
  assert.equal(pvp.room.projection.state.ply, 0);
  await send(pvp.room, black, { type: 'move', to: 'h8' });
  assert.equal(pvp.room.projection.state.ply, 1);
});

test('spectators, displaced clients and forged engine ids cannot drive another seat', async () => {
  const { room, socket } = await fixture('white');
  for (const id of ['spectator-player', 'rapfi-level-1']) {
    const spectator = new Socket();
    await passiveWs.handleConnection(ctx, spectator as unknown as WebSocket, request(id), room);
    assert.equal(spectator.sent[0]?.seat, 'spectator');
    await send(room, spectator, botMove(room));
    assert.equal(room.projection.state.ply, 0);
  }
  const player = [...room.clients].find(
    (client) => client.socket === (socket as unknown as WebSocket),
  );
  assert.ok(player);
  player.displaced = true;
  await send(room, socket, botMove(room));
  assert.equal(room.projection.state.ply, 0);
  player.displaced = false;
  room.projection.seats.white = 'replacement-player';
  await send(room, socket, botMove(room));
  assert.equal(room.projection.state.ply, 0);
});

test('replayed bot seats survive hydration and reject duplicate client bot replies', async () => {
  const original = await fixture('white');
  const hydrated = createTenantRuntimeRoomFromEvents(gomokuTenant, original.room.events);
  assert.ok(hydrated.ok);
  const room = hydrated.room as Room;
  room.seatTokens = structuredClone(original.room.seatTokens);
  rooms.push(room);
  const socket = new Socket();
  await passiveWs.handleConnection(
    ctx,
    socket as unknown as WebSocket,
    request('reconnected-player', original.seatToken),
    room,
  );
  const reply = botMove(room);
  socket.emit('message', JSON.stringify(reply));
  socket.emit('message', JSON.stringify(reply));
  await room.pendingWrites;
  assert.equal(room.projection.state.ply, 0);
  assert.equal(room.events.filter((event) => event.type === 'move-played').length, 0);
  assert.equal(socket.sent.filter((frame) => frame.type === 'event-appended').length, 0);
});
