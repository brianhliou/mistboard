/**
 * A socket's ?client= id is chosen by the client, and engine ids are public
 * (snapshot `seats`, /api/games/current). An engine seat is authorised by its id
 * alone, so a network id the server would read as an engine must never reach a
 * seat: the tenant runtime treats it as absent and mints a random id, and the
 * connection takes the seat as an ordinary player (seat token, PvP room).
 *
 * Driven directly with a fake socket and an in-memory room (persistence is not
 * initialised, so the seat-assigned append stays in memory).
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import type { WebSocket } from 'ws';
import { XIANGQI_DEFAULT_ENGINE_ID } from '../xiangqi-engine-catalog.js';
import type { XiangqiEvent } from '../xiangqi-runtime.js';
import { xiangqiTenant } from '../xiangqi-tenant.js';
import { createTenantRuntimeRoomFromEvents } from './runtime.js';
import { createTenantWsRuntime } from './ws.js';

process.env.MISTBOARD_XIANGQI_ENABLED = 'true';

const xiangqiWs = createTenantWsRuntime(xiangqiTenant);
type XiangqiLiveRoom = Parameters<typeof xiangqiWs.handleConnection>[3];

const WS_CTX = { wsMessageLimit: 100, wsMessageWindowMs: 1_000 } as const;

class FakeSocket {
  sent: unknown[] = [];
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

function fakeRequest(clientId: string): IncomingMessage {
  return {
    url: `/?client=${encodeURIComponent(clientId)}`,
    headers: { host: 'localhost' },
  } as unknown as IncomingMessage;
}

// A PvP invite: red has joined, black is open.
function openXiangqiRoom(roomId: string): XiangqiLiveRoom {
  const events: XiangqiEvent[] = [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-red-0001', seat: 'red' },
  ];
  const created = createTenantRuntimeRoomFromEvents(xiangqiTenant, events);
  assert.ok(created.ok, 'fixture event log must hydrate');
  return created.room as unknown as XiangqiLiveRoom;
}

for (const spoofed of [XIANGQI_DEFAULT_ENGINE_ID, 'engine:black']) {
  test(`a tenant socket naming engine id ${spoofed} joins as a guest, not as the engine`, async () => {
    if (spoofed === XIANGQI_DEFAULT_ENGINE_ID) {
      assert.ok(xiangqiTenant.engine?.isEngineClientId(spoofed), 'fixture id is an engine id');
    }
    const room = openXiangqiRoom(`xq_engine_spoof_${spoofed.replace(/\W/g, '_')}`);
    const socket = new FakeSocket();
    await xiangqiWs.handleConnection(WS_CTX, socket.asWebSocket(), fakeRequest(spoofed), room);

    assert.deepEqual(socket.closes, []);
    const hello = socket.sent[0] as { type: string; seat: string; clientId: string };
    assert.equal(hello?.type, 'hello');
    assert.equal(hello?.seat, 'black');
    assert.notEqual(hello?.clientId, spoofed, 'the client-chosen engine id is not honoured');
    assert.notEqual(room.projection.seats.black, spoofed, 'the seat is not an engine seat');
    assert.equal(xiangqiTenant.engine?.isEngineClientId(room.projection.seats.black), false);
    assert.equal(room.seatTokens.black?.clientId, hello.clientId, 'a seat token backs the seat');

    for (const client of room.clients) room.clients.delete(client);
  });
}
