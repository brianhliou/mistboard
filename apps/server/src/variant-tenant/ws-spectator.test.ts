/**
 * Debug-authorized spectator admission for the generic tenant WS runtime.
 *
 * The dev /game-sheet Room mode iframes /room/:id for seeded corpus rooms whose
 * two seats are both taken by private guests. A visitor with no seat token is
 * normally closed 1008 'private room' (fail-closed). handleConnection admits a
 * READ-ONLY spectator instead when the runtime is debug-authorized (non-
 * production, or an admin debug token in production). This suite pins:
 *
 *   a. Fail-closed: production runtime + no admin token → a SEALED (fog) room
 *      still closes 1008. (Jieqi used to be the closed example; since 2026-09-20
 *      hidden-identity rooms admit spectators on their public view.)
 *   b. Dev spectator: non-production + full room → hello, no seat-assigned event
 *      appended, no seatToken in the hello.
 *   c. Read-only: a spectator's resign / move append NOTHING to the event log;
 *      snapshot:request is still answered.
 *   d. Hidden-info regression (repo invariant for any observer/payload change):
 *      against the REAL jieqi tenant (identity-hidden), the spectator payload
 *      carries no face-down identity and no capture role a seat lacks: jieqi's
 *      viewForClient returns the PUBLIC view for seat 'spectator'.
 *
 * The runtime is driven directly with a fake socket + a room hydrated from an
 * event log (both seats filled), so no server subprocess or DB is needed. The
 * spectator paths never persist (no seat event, and read-only messages return
 * before any append), so appendTenantEvent is never reached.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import {
  DARK_XIANGQI_SPEC_ID,
  JIEQI_SPEC_ID,
  STANDARD_JIEQI_DEAL,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import type { DarkXiangqiEvent } from '../dark-xiangqi-runtime.js';
import { darkXiangqiTenant } from '../dark-xiangqi-tenant.js';
import type { JieqiEvent, JieqiRuntimeRoom } from '../jieqi-runtime.js';
import { jieqiTenant } from '../jieqi-tenant.js';
import type { XiangqiEvent } from '../xiangqi-runtime.js';
import { xiangqiTenant } from '../xiangqi-tenant.js';
import { createTenantRuntimeRoomFromEvents, tenantSnapshotPayload } from './runtime.js';
import { createTenantWsRuntime } from './ws.js';

process.env.MISTBOARD_JIEQI_ENABLED = 'true';
process.env.MISTBOARD_XIANGQI_ENABLED = 'true';
process.env.MISTBOARD_DARK_XIANGQI_ENABLED = 'true';

const jieqiWs = createTenantWsRuntime(jieqiTenant);

// The exact live-room shape handleConnection expects (clients: Set<LiveClient>),
// derived from the runtime so it stays in lock-step without re-deriving generics.
type JieqiLiveRoom = Parameters<typeof jieqiWs.handleConnection>[3];

const WS_CTX = { wsMessageLimit: 100, wsMessageWindowMs: 1_000 } as const;

// Minimal fake of the `ws` WebSocket surface handleConnection touches: send /
// close / on('message') / on('close'). receive() drives the registered message
// handler the way an inbound frame would.
class FakeSocket {
  sent: unknown[] = [];
  closes: { code?: number; reason?: string }[] = [];
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

  receive(message: unknown): void {
    this.handlers.get('message')?.(JSON.stringify(message));
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

function fakeRequest(clientId: string, adminToken?: string): IncomingMessage {
  const headers: Record<string, string> = { host: 'localhost' };
  if (adminToken) headers['sec-websocket-protocol'] = `mistboard-admin-debug.${adminToken}`;
  return {
    url: `/?client=${clientId}`,
    headers,
  } as unknown as IncomingMessage;
}

// A jieqi room hydrated to a FULL private room: both color seats occupied, so a
// tokenless visitor fails assignTenantSeat with reason 'private room'.
function fullJieqiRoom(roomId: string): JieqiLiveRoom {
  const events: JieqiEvent[] = [
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: JIEQI_SPEC_ID,
      setup: STANDARD_JIEQI_DEAL,
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-red', seat: 'red' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
  ];
  const created = createTenantRuntimeRoomFromEvents(jieqiTenant, events);
  assert.ok(created.ok, 'fixture event log must hydrate');
  return created.room as unknown as JieqiLiveRoom;
}

// Restore an env var to its prior value (delete when it had none) so mutating
// process.env in one test never leaks into the next (tests in a file run
// sequentially).
function withEnv(key: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prior = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return fn().finally(() => {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  });
}

const xiangqiWs = createTenantWsRuntime(xiangqiTenant);
type XiangqiLiveRoom = Parameters<typeof xiangqiWs.handleConnection>[3];

const darkXiangqiWs = createTenantWsRuntime(darkXiangqiTenant);
type DarkXiangqiLiveRoom = Parameters<typeof darkXiangqiWs.handleConnection>[3];

// A full, still-LIVE fog xiangqi room: the sealed class, closed to spectators
// at any status short of finished, on any runtime.
function fullDarkXiangqiRoom(roomId: string): DarkXiangqiLiveRoom {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: DARK_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-red', seat: 'red' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
  ];
  const created = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, events);
  assert.ok(created.ok, 'fixture event log must hydrate');
  return created.room as unknown as DarkXiangqiLiveRoom;
}

// A full, still-LIVE xiangqi room: both seats taken, no moves needed.
function fullXiangqiRoom(roomId: string): XiangqiLiveRoom {
  const events: XiangqiEvent[] = [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-red', seat: 'red' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
  ];
  const created = createTenantRuntimeRoomFromEvents(xiangqiTenant, events);
  assert.ok(created.ok, 'fixture event log must hydrate');
  return created.room as unknown as XiangqiLiveRoom;
}

test('an OPEN spec admits a live spectator in production with no admin token', async () => {
  // The room gate now consults liveObservePolicy, the same predicate Mistboard TV
  // uses. Xiangqi hides nothing, so watching a live game from its room URL needs
  // no token and no dev runtime — previously this closed 1008 for everyone.
  await withEnv('NODE_ENV', 'production', () =>
    withEnv('MISTBOARD_ADMIN_DEBUG_TOKEN', undefined, async () => {
      const room = fullXiangqiRoom('xq_spectator_prod');
      const socket = new FakeSocket();
      await xiangqiWs.handleConnection(
        WS_CTX,
        socket.asWebSocket(),
        fakeRequest('prod-visitor-open'),
        room,
      );

      assert.deepEqual(socket.closes, [], 'an open-spec live room does not close a spectator');
      assert.equal(room.clients.size, 1, 'the spectator joined');
      assert.equal(socket.sent.length > 0, true, 'the spectator received a hello frame');
      assert.equal(
        room.events.filter((event) => event.type === 'seat-assigned').length,
        2,
        'admitting a spectator appends no seat-assigned event',
      );
    }),
  );
});

test('spectator fallback stays fail-closed in production without an admin token', async () => {
  await withEnv('NODE_ENV', 'production', () =>
    withEnv('MISTBOARD_ADMIN_DEBUG_TOKEN', undefined, async () => {
      const room = fullDarkXiangqiRoom('dxq_spectator_prod');
      const socket = new FakeSocket();
      await darkXiangqiWs.handleConnection(
        WS_CTX,
        socket.asWebSocket(),
        fakeRequest('prod-visitor-01'),
        room,
      );

      assert.deepEqual(socket.closes, [{ code: 1008, reason: 'private room' }]);
      assert.deepEqual(socket.sent, [], 'a fail-closed visitor receives no frame');
      assert.equal(room.clients.size, 0, 'no spectator was admitted');
    }),
  );
});

test('production admits a spectator when the request carries a valid admin debug token', async () => {
  await withEnv('NODE_ENV', 'production', () =>
    withEnv('MISTBOARD_ADMIN_DEBUG_TOKEN', 'test-admin-token', async () => {
      const room = fullJieqiRoom('jq_spectator_prod_ok');
      const socket = new FakeSocket();
      await jieqiWs.handleConnection(
        WS_CTX,
        socket.asWebSocket(),
        fakeRequest('prod-admin-01', 'test-admin-token'),
        room,
      );

      assert.deepEqual(socket.closes, [], 'authorized spectator is not closed');
      const hello = socket.sent[0] as { type: string; seat: string };
      assert.equal(hello?.type, 'hello');
      assert.equal(hello?.seat, 'spectator');
    }),
  );
});

test('dev spectator joins a full room: hello, no seat event, no seat token', async () => {
  await withEnv('NODE_ENV', 'test', async () => {
    const room = fullJieqiRoom('jq_spectator_dev');
    const eventsBefore = room.events.length;
    const socket = new FakeSocket();
    await jieqiWs.handleConnection(
      WS_CTX,
      socket.asWebSocket(),
      fakeRequest('dev-visitor-01'),
      room,
    );

    assert.deepEqual(socket.closes, [], 'a dev spectator is not closed');
    assert.equal(room.clients.size, 1, 'spectator joined room.clients');

    const hello = socket.sent[0] as { type: string; seat: string; seatToken?: string };
    assert.equal(hello?.type, 'hello');
    assert.equal(hello?.seat, 'spectator');
    assert.equal('seatToken' in hello, false, 'a spectator hello carries no seat token');

    assert.equal(
      room.events.length,
      eventsBefore,
      'spectator admission appends no seat-assigned event',
    );
    assert.ok(
      !room.events.some(
        (e) => e.type === 'seat-assigned' && (e as { seat?: string }).seat === 'spectator',
      ),
      'no seat-assigned event names the spectator',
    );
  });
});

test('spectator is read-only: resign / move append nothing; snapshot:request answered', async () => {
  await withEnv('NODE_ENV', 'test', async () => {
    const room = fullJieqiRoom('jq_spectator_readonly');
    const socket = new FakeSocket();
    await jieqiWs.handleConnection(
      WS_CTX,
      socket.asWebSocket(),
      fakeRequest('dev-visitor-02'),
      room,
    );
    const eventsBefore = room.events.length;

    // Mutating messages from a spectator must be dropped before any append.
    socket.receive({ type: 'resign' });
    socket.receive({ type: 'move', from: 'a0', to: 'a1' });
    socket.receive({ type: 'abort' });
    await Promise.resolve();

    assert.equal(
      room.events.length,
      eventsBefore,
      'a spectator resign/move/abort must not append to the event log',
    );

    // snapshot:request is a permitted read-only message and is still answered.
    const sentBefore = socket.sent.length;
    socket.receive({ type: 'snapshot:request' });
    await Promise.resolve();
    const reply = socket.sent[sentBefore] as { type: string } | undefined;
    assert.equal(reply?.type, 'snapshot', 'snapshot:request is answered for a spectator');
  });
});

test('hidden-info: spectator payload holds no face-down identity and no private capture role', async () => {
  await withEnv('NODE_ENV', 'test', async () => {
    const room = fullJieqiRoom('jq_spectator_hidden');
    const socket = new FakeSocket();
    await jieqiWs.handleConnection(
      WS_CTX,
      socket.asWebSocket(),
      fakeRequest('dev-visitor-03'),
      room,
    );

    const hello = socket.sent[0] as {
      seat: string;
      state: {
        board: Record<string, { faceDown: boolean; role?: string }>;
        captured: unknown[];
        legalMoves: unknown[];
      };
      events: Array<{ type: string; setup?: unknown }>;
    };
    assert.equal(hello.seat, 'spectator');

    // A seated view of the SAME room is the same masked board (a face-down piece
    // hides its role from its owner too), so the spectator gets exactly that:
    // 32 pieces, only the two generals face-up, no role on anything face-down.
    const redView = tenantSnapshotPayload(jieqiTenant, room as unknown as JieqiRuntimeRoom, {
      id: 'client-red',
      seat: 'red',
      solo: false,
    });
    assert.equal(Object.keys(redView.state.board).length, 32);
    assert.deepEqual(hello.state.board, redView.state.board, 'spectator sees the shared mask');
    const faceDown = Object.values(hello.state.board).filter((entry) => entry.faceDown);
    assert.equal(faceDown.length, 30, 'only the generals are face-up at the start');
    for (const entry of faceDown) assert.ok(!('role' in entry), 'a face-down piece has no role');
    assert.deepEqual(hello.state.legalMoves, [], 'a spectator has nothing to play');
    // The public log, with the deal stripped from room-created.
    assert.ok(hello.events.length > 0, 'spectator receives the public log');
    for (const event of hello.events) assert.ok(!('setup' in event), 'the deal never ships');
  });
});
