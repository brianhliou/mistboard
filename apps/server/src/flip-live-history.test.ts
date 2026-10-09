/**
 * Hidden-info regression for the LIVE per-ply history of the flip variants
 * (banqi, Flip Jungle): the masked views a viewer receives in its hello frame
 * so that, after a reload, it can step back through a live game whose deal is
 * a server secret (visibility.liveHistory -> tenantPerPlyViews,
 * tenantLiveHistoryExtras, ws.ts handleConnection + joinAsSpectator).
 *
 * Pins, against the real tenants and the real WS runtime (fake socket, no DB):
 *   a. each viewer's history is exactly viewForClient at every ply (legalMoves
 *      aside), its tip the viewer's live view;
 *   b. no ply carries an identity on a face-down tile, the deal, or a face-up
 *      tile that is still face-down live;
 *   c. a seat and a live spectator both get one in the hello (hidden-identity:
 *      the spectator is shown the public board), no broadcast snapshot does;
 *   d. a finished room's hello carries none (it reveals truth instead);
 *   e. perfect-info tenants declare no hook; a 'dark' tenant's spectator gets
 *      nothing even though the tenant has one.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import {
  BANQI_SPEC_ID,
  createBanqiDeal,
  createJungleFlipDeal,
  DARK_XIANGQI_SPEC_ID,
  getBanqiLegalMoves,
  getJungleFlipLegalMoves,
  JUNGLE_FLIP_SPEC_ID,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import { atomicXiangqiTenant } from './atomic-xiangqi-tenant.js';
import { banqiTenant } from './banqi-tenant.js';
import { crazyhouseXiangqiTenant } from './crazyhouse-xiangqi-tenant.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { duckXiangqiTenant } from './duck-xiangqi-tenant.js';
import { fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantLiveHistoryExtras,
} from './variant-tenant/runtime.js';
import { mintTenantSeatToken } from './variant-tenant/seat-session.js';
import { createTenantWsRuntime } from './variant-tenant/ws.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_BANQI_ENABLED = 'true';
process.env.MISTBOARD_JUNGLE_FLIP_ENABLED = 'true';
process.env.MISTBOARD_DARK_XIANGQI_ENABLED = 'true';

const MOVES = 16;
const WS_CTX = { wsMessageLimit: 100, wsMessageWindowMs: 1_000 } as const;

type BoardEntry = { color?: string; role?: string; faceDown: boolean };
type FlipView = {
  perspective: string;
  board: Record<string, BoardEntry>;
  captured: unknown[];
  legalMoves: unknown[];
  status: { type: string };
};
type Entry = { ply: number; view: FlipView };
type Move = { from: string; to: string };
// biome-ignore lint/suspicious/noExplicitAny: one harness over two tenants' generics
type AnyTenant = any;
// biome-ignore lint/suspicious/noExplicitAny: room shapes differ per tenant
type AnyRoom = any;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type Case = {
  name: string;
  tenant: AnyTenant;
  specId: string;
  deal: unknown;
  legalMoves: (state: AnyRoom) => Move[];
};

const CASES: Case[] = [
  {
    name: 'banqi',
    tenant: banqiTenant,
    specId: BANQI_SPEC_ID,
    deal: createBanqiDeal(seeded(7)),
    legalMoves: (state) => getBanqiLegalMoves(state),
  },
  {
    name: 'flip jungle',
    tenant: jungleFlipTenant,
    specId: JUNGLE_FLIP_SPEC_ID,
    deal: createJungleFlipDeal(seeded(7)),
    legalMoves: (state) => getJungleFlipLegalMoves(state),
  },
];

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

function hydrate(tenant: AnyTenant, events: unknown[]): AnyRoom {
  const created = createTenantRuntimeRoomFromEvents(tenant, events as never);
  assert.ok(created.ok, 'event log must hydrate');
  return created.room;
}

// Prefer a board move that captures (exercises the captured pool), then a flip
// (shuffling revealed pieces back and forth ends the game by repetition), then
// any board move, in a stable order.
function pickMove(c: Case, room: AnyRoom): Move {
  const state = room.projection.state;
  const moves = [...c.legalMoves(state)].sort((a, b) =>
    `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
  );
  const boardMoves = moves.filter((move) => move.from !== move.to);
  const move =
    boardMoves.find((m) => state.board[m.to] && !state.board[m.to].faceDown) ??
    moves.find((m) => m.from === m.to) ??
    boardMoves[0];
  assert.ok(move, 'scripted position must have a legal move');
  return { from: move.from, to: move.to };
}

function liveLog(c: Case, roomId: string): unknown[] {
  const events: unknown[] = [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: c.specId, setup: c.deal },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-red', seat: 'red' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
  ];
  for (let ply = 1; ply <= MOVES; ply += 1) {
    const room = hydrate(c.tenant, events);
    const status = room.projection.state.status;
    assert.equal(
      status.type,
      'playing',
      `${c.name}: not live at ply ${ply}: ${JSON.stringify(status)}`,
    );
    events.push({
      type: 'move-played',
      at: 10_000 + ply * 1_000,
      roomId,
      color: status.turn,
      move: pickMove(c, room),
    });
  }
  return events;
}

function assertMaskedHistory(where: string, history: Entry[], live: FlipView): void {
  assert.equal(history.length, MOVES + 1, `${where}: one view per ply`);
  assert.deepEqual(
    history.map((entry) => entry.ply),
    history.map((_, index) => index),
    `${where}: plies are not 0..n`,
  );
  assert.deepStrictEqual(
    history.at(-1)!.view,
    { ...live, legalMoves: [] },
    `${where}: tip is not the live view`,
  );
  assert.ok(!JSON.stringify(history).includes('"setup"'), `${where}: setup in history`);
  let faceDownSeen = 0;
  for (const { ply, view } of history) {
    assert.equal(view.perspective, live.perspective, `${where}: ply ${ply} perspective`);
    assert.deepEqual(view.legalMoves, [], `${where}: ply ${ply} carries legal moves`);
    for (const [square, entry] of Object.entries(view.board)) {
      if (entry.faceDown) {
        faceDownSeen += 1;
        assert.deepStrictEqual(
          Object.keys(entry),
          ['faceDown'],
          `${where}: ply ${ply} face-down ${square} leaks an identity`,
        );
      } else {
        assert.ok(
          !live.board[square]?.faceDown,
          `${where}: ply ${ply} shows ${square} face-up while it is face-down live`,
        );
      }
    }
  }
  assert.ok(faceDownSeen > 0, `${where}: no face-down tile in any ply: asserted nothing`);
}

for (const c of CASES) {
  test(`${c.name}: each viewer's live history is viewForClient at every ply, masked`, () => {
    const roomId = `${c.name.replace(' ', '-')}_live_history`;
    const log = liveLog(c, roomId);
    const room = hydrate(c.tenant, log);
    let boardMoves = 0;
    for (const event of log) {
      const move = (event as { move?: Move }).move;
      if (move && move.from !== move.to) boardMoves += 1;
    }
    assert.ok(boardMoves > 0, `${c.name}: the script never moved a revealed piece`);
    for (const seat of ['red', 'black', 'spectator'] as const) {
      const client = { id: `client-${seat}`, seat, solo: false };
      const extras = tenantLiveHistoryExtras(c.tenant, room, client) as {
        liveHistory?: Entry[];
      };
      const history = JSON.parse(JSON.stringify(extras.liveHistory ?? null)) as Entry[] | null;
      assert.ok(history, `${c.name}: ${seat} got no history`);
      const live = JSON.parse(
        JSON.stringify(c.tenant.visibility.viewForClient(room.projection.state, client, log)),
      ) as FlipView;
      assertMaskedHistory(`${c.name}/${seat}`, history, live);
      // (a) every ply is what the room served this viewer after that move.
      let ply = 0;
      for (const [index, event] of log.entries()) {
        if ((event as { type: string }).type !== 'move-played') continue;
        ply += 1;
        const prefix = hydrate(c.tenant, log.slice(0, index + 1));
        const served = c.tenant.visibility.viewForClient(
          prefix.projection.state,
          client,
          log.slice(0, index + 1),
        );
        assert.deepStrictEqual(
          history[ply]!.view,
          JSON.parse(JSON.stringify({ ...served, legalMoves: [] })),
          `${c.name}/${seat}: ply ${ply} is not what the room served`,
        );
      }
    }
  });

  test(`${c.name}: seated and spectator hellos carry the history, broadcasts never`, async () => {
    const roomId = `${c.name.replace(' ', '-')}_live_history_ws`;
    const log = liveLog(c, roomId);
    const ws = createTenantWsRuntime(c.tenant);
    const room = hydrate(c.tenant, log) as Parameters<typeof ws.handleConnection>[3];
    const red = mintTenantSeatToken(room as never, 'red', {
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
    assertMaskedHistory(
      `${c.name}/red hello`,
      redHello.liveHistory as Entry[],
      redHello.state as FlipView,
    );

    const spectatorSocket = new FakeSocket();
    await ws.handleConnection(WS_CTX, spectatorSocket.asWebSocket(), request('watcher'), room);
    const spectatorHello = spectatorSocket.sent.find((frame) => frame.type === 'hello');
    assert.ok(spectatorHello, 'a live spectator was admitted');
    assert.equal(spectatorHello.seat, 'spectator');
    assertMaskedHistory(
      `${c.name}/spectator hello`,
      spectatorHello.liveHistory as Entry[],
      spectatorHello.state as FlipView,
    );

    for (const frame of [...redSocket.sent, ...spectatorSocket.sent]) {
      if (frame.type === 'hello') continue;
      assert.equal('liveHistory' in frame, false, `${frame.type} frame carries history`);
    }
  });

  test(`${c.name}: a finished room's hello carries no live history`, () => {
    const roomId = `${c.name.replace(' ', '-')}_live_history_done`;
    const log = liveLog(c, roomId);
    log.push({
      type: 'seat-resigned',
      at: 99_000,
      roomId,
      color: hydrate(c.tenant, log).projection.state.status.turn,
    });
    const room = hydrate(c.tenant, log);
    assert.notEqual(room.projection.state.status.type, 'playing');
    for (const seat of ['red', 'black', 'spectator'] as const) {
      assert.deepEqual(
        tenantLiveHistoryExtras(c.tenant, room, { id: seat, seat, solo: false }),
        {},
      );
    }
  });
}

test('perfect-information tenants declare no live history (their clients rebuild it)', () => {
  for (const tenant of [
    xiangqiTenant,
    fortressXiangqiTenant,
    duckXiangqiTenant,
    atomicXiangqiTenant,
    crazyhouseXiangqiTenant,
    jungleTenant,
  ] as AnyTenant[]) {
    assert.equal(tenant.visibility.liveHistory, undefined, `${tenant.gameSpecId} has a hook`);
  }
});

test("a 'dark' tenant's live spectator gets nothing even though the tenant has a hook", () => {
  assert.ok(darkXiangqiTenant.visibility.liveHistory);
  const roomId = 'dxq_live_history_spectator';
  const room = hydrate(darkXiangqiTenant, [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: DARK_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-red', seat: 'red' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
    { type: 'move-played', at: 4_000, roomId, color: 'red', move: { from: 'b3', to: 'e3' } },
  ]);
  assert.equal(room.projection.state.status.type, 'playing');
  assert.deepEqual(
    tenantLiveHistoryExtras(darkXiangqiTenant, room, { id: 's', seat: 'spectator', solo: false }),
    {},
  );
  assert.ok(
    (
      tenantLiveHistoryExtras(darkXiangqiTenant, room, { id: 'r', seat: 'red', solo: false }) as {
        liveHistory?: unknown[];
      }
    ).liveHistory?.length === 2,
  );
});
