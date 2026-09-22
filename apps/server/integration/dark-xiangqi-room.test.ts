import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleDarkXiangqiLifecycleTimers } from '../src/server-ws-dark-xiangqi.js';
import {
  connectClient,
  startTestServer,
  type TestServer,
  waitUntil,
  withProductionRuntime,
} from './harness.js';

const darkXiangqiKey = 'MISTBOARD_DARK_XIANGQI_ENABLED';

test('Dark Xiangqi direct room creation stays hidden while the flag is off', async () => {
  const before = process.env[darkXiangqiKey];
  delete process.env[darkXiangqiKey];
  const server = await startTestServer();
  try {
    const response = await createDarkXiangqiRoom(server);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'dark_xiangqi_disabled' });
  } finally {
    restoreEnv(darkXiangqiKey, before);
    await server.close();
  }
});

test('Dark Xiangqi room create + websocket loop is flag-gated and redacted', async () => {
  const before = process.env[darkXiangqiKey];
  process.env[darkXiangqiKey] = 'true';
  const server = await startTestServer();
  try {
    const unsupported = await createDarkXiangqiRoom(server, { mode: 'pve', engineId: 'random' });
    assert.equal(unsupported.status, 400);
    assert.deepEqual(await unsupported.json(), { error: 'invalid_engine' });

    const createdResponse = await createDarkXiangqiRoom(server);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as {
      roomId: string;
      url: string;
      mode: string;
      gameSpecId: string;
    };
    assert.equal(created.gameSpecId, 'dark-xiangqi');
    assert.equal(created.mode, 'pvp');
    assert.equal(created.roomId.startsWith('dxq_'), true);
    assert.equal(created.url, `/room/${encodeURIComponent(created.roomId)}`);

    const red = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    assert.equal(red.seat, 'red');
    assert.ok(red.seatToken);
    const redHello = red.messages.find((msg) => (msg as { type?: string }).type === 'hello') as {
      state: { board: Record<string, unknown>; visibleSquares: string[] };
    };
    assert.deepEqual(redHello.state.board.b8, { color: 'black', shrouded: true });
    assert.equal(redHello.state.visibleSquares.includes('b9'), false);

    const redReclaim = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
      seatToken: red.seatToken,
    });
    assert.equal(redReclaim.seat, 'red');
    await red.closed;
    assert.equal(red.isClosed(), true);

    const black = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    assert.equal(black.seat, 'black');

    // The tenant WS runtime admits a tokenless visitor as a read-only spectator
    // in non-production; pin the production fail-closed path so a full private
    // room rejects the extra connections with 1008 (otherwise they are admitted
    // and the awaits hang).
    await withProductionRuntime(server.url, async () => {
      const third = await connectClient({
        url: server.url,
        room: created.roomId,
        gameSpecId: 'dark-xiangqi',
        awaitHello: false,
      });
      await third.closed;
      assert.equal(third.isClosed(), true);

      const copiedClientId = await connectClient({
        url: server.url,
        room: created.roomId,
        gameSpecId: 'dark-xiangqi',
        clientId: redReclaim.clientId ?? undefined,
        awaitHello: false,
      });
      await copiedClientId.closed;
      assert.equal(copiedClientId.isClosed(), true);
      assert.equal(copiedClientId.closeCode(), 1008);
      assert.equal(copiedClientId.closeReason(), 'private room');
    });

    redReclaim.send({ type: 'move', from: 'b3', to: 'b4' });
    const redMoveFrame = await redReclaim.waitFor<{
      type: string;
      event?: {
        type: string;
        at: number;
        roomId: string;
        color: string;
        move: { from: string; to: string };
      };
      state: { board: Record<string, unknown>; lastMove?: { from: string; to: string } };
    }>((msg) => msg.type === 'event-appended' && msg.gameSpecId === 'dark-xiangqi');
    assert.equal(redMoveFrame.event?.type, 'move-played');
    assert.equal(redMoveFrame.event.roomId, created.roomId);
    assert.equal(redMoveFrame.event.color, 'red');
    assert.deepEqual(redMoveFrame.event.move, { from: 'b3', to: 'b4' });
    assert.deepEqual(redMoveFrame.state.lastMove, { from: 'b3', to: 'b4' });

    const blackMoveFrame = await black.waitFor<{
      type: string;
      event?: unknown;
      state: {
        board: Record<string, unknown>;
        visibleSquares: string[];
        lastMove?: { from: string; to: string };
      };
    }>((msg) => msg.type === 'event-appended' && msg.gameSpecId === 'dark-xiangqi');
    assert.equal('event' in blackMoveFrame, false);
    assert.equal(blackMoveFrame.state.lastMove, undefined);
    assert.doesNotMatch(JSON.stringify(blackMoveFrame), /"lastMove"/);
  } finally {
    restoreEnv(darkXiangqiKey, before);
    await server.close();
  }
});

test('Dark Xiangqi time controls use native red/black clocks and timeout results', async () => {
  const before = process.env[darkXiangqiKey];
  process.env[darkXiangqiKey] = 'true';
  const server = await startTestServer();
  try {
    const createdResponse = await createDarkXiangqiRoom(server, {
      timeControl: { initialMs: 10_000, incrementMs: 1_000 },
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as { roomId: string };

    const red = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    const black = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    const redHello = red.messages.find((msg) => (msg as { type?: string }).type === 'hello') as {
      clock?: { activeColor: string | null; remainingMs: { red: number; black: number } };
      timeControl?: { initialMs: number; incrementMs: number };
    };
    assert.deepEqual(redHello.timeControl, { initialMs: 10_000, incrementMs: 1_000 });
    assert.deepEqual(redHello.clock, {
      activeColor: null,
      incrementMs: 1_000,
      initialMs: 10_000,
      remainingMs: { black: 10_000, red: 10_000 },
      runningSince: null,
    });

    red.send({ type: 'move', from: 'b3', to: 'b4' });
    await black.waitFor<{
      clock: { activeColor: string | null; remainingMs: Record<string, number> };
    }>(
      (msg) =>
        msg.type === 'event-appended' &&
        msg.gameSpecId === 'dark-xiangqi' &&
        (msg as { clock?: { remainingMs?: { red?: number } } }).clock?.remainingMs?.red === 11_000,
    );

    black.send({ type: 'move', from: 'b8', to: 'b7' });
    await red.waitFor<{
      clock: { activeColor: string | null; remainingMs: Record<string, number> };
    }>(
      (msg) =>
        msg.type === 'event-appended' &&
        msg.gameSpecId === 'dark-xiangqi' &&
        (msg as { clock?: { activeColor?: string; remainingMs?: { black?: number } } }).clock
          ?.activeColor === 'red' &&
        (msg as { clock?: { remainingMs?: { black?: number } } }).clock?.remainingMs?.black ===
          11_000,
    );

    const room = server.darkXiangqiRooms.get(created.roomId);
    assert.ok(room?.projection.clock);
    room.projection.clock.remainingMs.red = 0;
    room.projection.clock.runningSince = Date.now() - 1;

    red.send({ type: 'move', from: 'b4', to: 'b5' });
    const timeoutFrame = await black.waitFor<{
      clock: { activeColor: null; remainingMs: { red: number } };
      state: { status: { type: string; winner: string; reason: string } };
    }>(
      (msg) =>
        msg.type === 'snapshot' &&
        msg.gameSpecId === 'dark-xiangqi' &&
        (msg as { state?: { status?: { reason?: string } } }).state?.status?.reason === 'timeout',
    );

    assert.equal(timeoutFrame.clock.activeColor, null);
    assert.equal(timeoutFrame.clock.remainingMs.red, 0);
    assert.deepEqual(timeoutFrame.state.status, {
      type: 'finished',
      winner: 'black',
      reason: 'timeout',
    });
  } finally {
    restoreEnv(darkXiangqiKey, before);
    await server.close();
  }
});

test('Dark Xiangqi room ids fail closed instead of falling through to chess', async () => {
  const before = process.env[darkXiangqiKey];
  process.env[darkXiangqiKey] = 'true';
  const server = await startTestServer();
  try {
    const missingRoomId = `dxq_missing_${Date.now()}`;
    const client = await connectClient({
      url: server.url,
      room: missingRoomId,
      awaitHello: false,
    });

    await client.closed;
    assert.equal(client.isClosed(), true);
    assert.equal(client.closeCode(), 1008);
    assert.equal(client.closeReason(), 'room unavailable');
    assert.equal(server.rooms.has(missingRoomId), false);
  } finally {
    restoreEnv(darkXiangqiKey, before);
    await server.close();
  }
});

test('Dark Xiangqi rooms accept native resignation after both first moves', async () => {
  const before = process.env[darkXiangqiKey];
  process.env[darkXiangqiKey] = 'true';
  const server = await startTestServer();
  try {
    const createdResponse = await createDarkXiangqiRoom(server);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as { roomId: string };

    const red = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    const black = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });

    red.send({ type: 'move', from: 'b3', to: 'b4' });
    await black.waitFor<{ type: string }>(
      (msg) => msg.type === 'event-appended' && msg.gameSpecId === 'dark-xiangqi',
    );

    black.send({ type: 'move', from: 'b8', to: 'b7' });
    await red.waitFor<{ type: string }>(
      (msg) => msg.type === 'event-appended' && msg.gameSpecId === 'dark-xiangqi',
    );

    red.send({ type: 'resign' });
    const finalFrame = await black.waitFor<{
      type: string;
      state: { status: { type: string; winner: string; reason: string } };
    }>(
      (msg) =>
        msg.type === 'snapshot' &&
        msg.gameSpecId === 'dark-xiangqi' &&
        (msg.state as { status?: { type?: string; reason?: string } } | undefined)?.status?.type ===
          'finished' &&
        (msg.state as { status?: { reason?: string } } | undefined)?.status?.reason ===
          'resignation',
    );

    assert.deepEqual(finalFrame.state.status, {
      type: 'finished',
      winner: 'black',
      reason: 'resignation',
    });
  } finally {
    restoreEnv(darkXiangqiKey, before);
    await server.close();
  }
});

test('Dark Xiangqi rooms accept native aborts before both first moves', async () => {
  const before = process.env[darkXiangqiKey];
  process.env[darkXiangqiKey] = 'true';
  const server = await startTestServer();
  try {
    const createdResponse = await createDarkXiangqiRoom(server);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as { roomId: string };

    const red = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    const black = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });

    red.send({ type: 'abort' });
    const finalFrame = await black.waitFor<{
      type: string;
      state: { status: { type: string; reason: string } };
    }>(
      (msg) =>
        msg.type === 'snapshot' &&
        msg.gameSpecId === 'dark-xiangqi' &&
        (msg.state as { status?: { type?: string; reason?: string } } | undefined)?.status?.type ===
          'aborted',
    );

    assert.deepEqual(finalFrame.state.status, {
      type: 'aborted',
      reason: 'user-abort',
    });
  } finally {
    restoreEnv(darkXiangqiKey, before);
    await server.close();
  }
});

test('Dark Xiangqi rooms keep playing when a seat disconnects after both first moves', async () => {
  const before = process.env[darkXiangqiKey];
  process.env[darkXiangqiKey] = 'true';
  const server = await startTestServer();
  try {
    const createdResponse = await createDarkXiangqiRoom(server);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as { roomId: string };

    const red = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    const black = await connectClient({
      url: server.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });

    red.send({ type: 'move', from: 'b3', to: 'b4' });
    await black.waitFor<{ type: string }>(
      (msg) => msg.type === 'event-appended' && msg.gameSpecId === 'dark-xiangqi',
    );

    black.send({ type: 'move', from: 'b8', to: 'b7' });
    await red.waitFor<{ type: string }>(
      (msg) => msg.type === 'event-appended' && msg.gameSpecId === 'dark-xiangqi',
    );

    // Until #436 this armed a 30 s countdown against black and ended the game by
    // abandonment. Both halves of that rule are off now (lifecycle-windows.ts:
    // PvE on its own merits, PvP pending evidence), so a dropped socket ends
    // nothing: black's clock runs on and black flags if they never return.
    await black.disconnect();
    const room = server.darkXiangqiRooms.get(created.roomId);
    assert.ok(room);

    // No countdown is armed, and re-deriving the timers does not create one.
    await waitUntil(() => room.clients.size === 1);
    scheduleDarkXiangqiLifecycleTimers(room);
    assert.equal(room.forfeitSeat, null);
    assert.equal(room.forfeitDeadline, null);
    assert.equal(room.forfeitTimer, null);

    // The game is still on: red plays again and the move lands.
    red.send({ type: 'move', from: 'b4', to: 'b5' });
    const moved = await red.waitFor<{ type: string; state: { status: { type: string } } }>(
      (msg) =>
        msg.type === 'snapshot' &&
        msg.gameSpecId === 'dark-xiangqi' &&
        (msg.state as { status?: { type?: string } } | undefined)?.status?.type === 'playing',
    );
    assert.equal(moved.state.status.type, 'playing');
  } finally {
    restoreEnv(darkXiangqiKey, before);
    await server.close();
  }
});

async function createDarkXiangqiRoom(
  server: TestServer,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'pvp', gameSpecId: 'dark-xiangqi', ...body }),
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
