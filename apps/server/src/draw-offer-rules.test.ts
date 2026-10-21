/**
 * Draw offers (#530), the guarantees around the live flow in draw-offer.test.ts:
 *
 *   - coverage: every registered two-seat tenant finishes a draw, bar named
 *     exceptions, so a new tenant fails here until it is wired or excused;
 *   - hidden information: on Fog Xiangqi, jieqi, banqi and flip jungle the
 *     whole serialized snapshot of every seat and a spectator is unchanged by
 *     an offer and a decline except for the drawOffer / drawOfferCooldown
 *     fields, which name a seat or a count and nothing on the board;
 *   - correspondence: the offer and the decline cooldown come back when the
 *     room rehydrates from its event log, and the durable move deadline does
 *     not move for either;
 *   - rated: an agreed draw in a rated room between two accounts summarizes
 *     as a rated PvP draw (the Glicko-2 path scores 'draw' as 0.5);
 *   - PvE: a room with a bot seat never takes an offer.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import {
  getBanqiLegalMoves,
  getJieqiLegalMoves,
  getJungleFlipLegalMoves,
  getLegalMoves,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import { atomicXiangqiTenant } from './atomic-xiangqi-tenant.js';
import { banqiTenant } from './banqi-tenant.js';
import { crazyhouseXiangqiTenant } from './crazyhouse-xiangqi-tenant.js';
import { darkChessTenant } from './dark-chess-tenant.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { duckXiangqiTenant } from './duck-xiangqi-tenant.js';
import { fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import { mahjongTenant } from './mahjong-tenant.js';
import { handleXiangqiWebSocketConnection } from './server-ws-xiangqi.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import { tenantDurableDeadlineFor } from './variant-tenant/lifecycle.js';
import './variant-tenant/register-tenants.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  DRAW_OFFER_COOLDOWN_MOVES,
  tenantDrawOfferPlies,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import type { VariantTenant } from './variant-tenant/tenant.js';
import { XIANGQI_DEFAULT_ENGINE_ID } from './xiangqi-engine-catalog.js';
import { xiangqiMahjongTenant } from './xiangqi-mahjong-tenant.js';
import { createXiangqiRoom } from './xiangqi-registration.js';
import type { XiangqiRuntimeRoom } from './xiangqi-runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_XIANGQI_ENABLED = 'true';

// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous list of tenants.
type AnyTenant = VariantTenant<string, string, any, any, any, string>;

// ── Coverage ────────────────────────────────────────────────────────────────

const DRAWING_TENANTS: readonly AnyTenant[] = [
  xiangqiTenant,
  darkXiangqiTenant,
  jieqiTenant,
  banqiTenant,
  jungleTenant,
  jungleFlipTenant,
  duckXiangqiTenant,
  crazyhouseXiangqiTenant,
  atomicXiangqiTenant,
  fortressXiangqiTenant,
] as unknown as AnyTenant[];

// Two-seat tenants with no draw by agreement, each with its reason.
const NO_DRAW_TENANTS: ReadonlyMap<AnyTenant, string> = new Map<AnyTenant, string>([
  // Fog Chess plays on the legacy chess stack; its tenant serves correspondence
  // only, from a client with no draw controls.
  [darkChessTenant as unknown as AnyTenant, 'legacy chess client, no draw controls'],
  // Ends on a points count; the web tenant sets drawOffers: false to match.
  [xiangqiMahjongTenant as unknown as AnyTenant, 'scored by points'],
  // A table of four.
  [mahjongTenant as unknown as AnyTenant, 'four seats'],
]);

test('draw: every two-seat tenant finishes a draw, bar the named exceptions', () => {
  const listed = new Set([...DRAWING_TENANTS, ...NO_DRAW_TENANTS.keys()].map((t) => t.kind));
  const registered = new Set(registeredVariantTenants().map((t) => t.kind));
  assert.deepEqual(
    [...registered].sort(),
    [...listed].sort(),
    'a new tenant must be listed here: wire rules.finishDraw or name why it has none',
  );
  for (const tenant of DRAWING_TENANTS) {
    assert.equal(tenant.colors.length, 2, `${tenant.kind} is a two-seat game`);
    assert.equal(typeof tenant.rules.finishDraw, 'function', `${tenant.kind} finishes a draw`);
  }
  for (const tenant of NO_DRAW_TENANTS.keys()) {
    assert.equal(tenant.rules.finishDraw, undefined, `${tenant.kind} has no draw`);
  }
});

// ── Runtime harness ─────────────────────────────────────────────────────────

type Room = {
  events: { type: string }[];
  projection: {
    // biome-ignore lint/suspicious/noExplicitAny: the harness reads only status.
    state: any;
    drawOffer?: { from: string };
    drawCooldown?: Partial<Record<string, number>>;
  };
};

function hydrate(
  tenant: AnyTenant,
  roomId: string,
  timeControl?: { initialMs: number; incrementMs: number; daysPerMove?: number },
  options: { rated?: boolean } = {},
): Room {
  const [first, second] = tenant.colors;
  const created = createTenantRuntimeRoomFromEvents(tenant, [
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: tenant.gameSpecId,
      creatorPreference: first,
      ...(options.rated ? { rated: true } : {}),
      ...(timeControl ? { timeControl } : {}),
      ...(tenant.rules.createSetup ? { setup: tenant.rules.createSetup({ timeControl }) } : {}),
    },
    ...(timeControl
      ? [
          {
            type: 'clock-started',
            at: 1_000,
            roomId,
            clock: {
              activeColor: null,
              incrementMs: timeControl.incrementMs,
              initialMs: timeControl.initialMs,
              remainingMs: { [first]: timeControl.initialMs, [second]: timeControl.initialMs },
              runningSince: null,
            },
          },
        ]
      : []),
    { type: 'seat-assigned', at: 2_000, roomId, clientId: `client-${first}`, seat: first },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: `client-${second}`, seat: second },
  ] as never);
  assert.ok(created.ok, `${tenant.kind} hydrates`);
  return created.room as unknown as Room;
}

function append(tenant: AnyTenant, room: Room, event: Record<string, unknown>): number {
  return appendTenantRuntimeEvent(tenant, room as never, event as never);
}

// First legal move in a fixed order, so every run plays the same opening.
// biome-ignore lint/suspicious/noExplicitAny: per-variant generators.
const LEGAL_MOVES: Record<string, (state: any) => { from: string; to: string }[]> = {
  'dark-xiangqi': getLegalMoves,
  jieqi: getJieqiLegalMoves,
  banqi: getBanqiLegalMoves,
  'jungle-flip': getJungleFlipLegalMoves,
  xiangqi: getLegalMoves,
};

function playPlies(tenant: AnyTenant, room: Room, plies: number, at = 10_000): void {
  const legal = LEGAL_MOVES[tenant.kind];
  assert.ok(legal, `a move generator for ${tenant.kind}`);
  for (let i = 0; i < plies; i += 1) {
    const state = room.projection.state;
    assert.equal(state.status.type, 'playing');
    const moves = [...legal(state)]
      .map((m) => ({ from: m.from, to: m.to }))
      .filter((m) => tenant.rules.isLegalMove(state, m))
      .sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`));
    assert.ok(moves[0], `${tenant.kind} has a legal move at ply ${i}`);
    const before = room.events.length;
    append(tenant, room, {
      type: 'move-played',
      at: at + i * 1_000,
      roomId: (room.events[0] as unknown as { roomId: string }).roomId,
      color: state.status.turn,
      move: moves[0],
    });
    assert.equal(room.events.length, before + 1, `${tenant.kind} ply ${i} was played`);
  }
}

function serializedFor(tenant: AnyTenant, room: Room, seat: string): Record<string, unknown> {
  const payload = tenantSnapshotPayload(
    tenant,
    room as never,
    {
      id: `client-${seat}`,
      seat,
      solo: false,
    } as never,
  ) as Record<string, unknown>;
  // The one wall-clock field; everything else is the room's.
  return JSON.parse(JSON.stringify({ ...payload, serverAt: 0 })) as Record<string, unknown>;
}

function without(frame: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...frame };
  for (const key of keys) delete copy[key];
  return copy;
}

// ── Hidden information ──────────────────────────────────────────────────────

const HIDDEN_INFO_TENANTS: readonly AnyTenant[] = [
  darkXiangqiTenant,
  jieqiTenant,
  banqiTenant,
  jungleFlipTenant,
] as unknown as AnyTenant[];

for (const tenant of HIDDEN_INFO_TENANTS) {
  test(`draw: ${tenant.kind} offer and decline change no serialized field but the draw ones`, () => {
    const roomId = `${tenant.roomIdPrefix}draw-hidden`;
    const room = hydrate(tenant, roomId, {
      initialMs: 600_000,
      incrementMs: 5_000,
    });
    playPlies(tenant, room, 4);
    const [first, second] = tenant.colors;
    const viewers = [first, second, 'spectator'];
    const before = new Map(viewers.map((seat) => [seat, serializedFor(tenant, room, seat)]));
    for (const frame of before.values()) {
      assert.equal('drawOffer' in frame, false);
      assert.equal('drawOfferPlies' in frame, false);
    }

    append(tenant, room, { type: 'draw-offered', at: 60_000, roomId, color: first });
    assert.deepEqual(room.projection.drawOffer, { from: first });
    for (const seat of viewers) {
      const after = serializedFor(tenant, room, seat);
      assert.deepEqual(after.drawOffer, { from: first }, `${seat}: the offer names a seat only`);
      assert.deepEqual(after.drawOfferPlies, [4], `${seat}: the mark is a ply count only`);
      assert.deepEqual(
        without(after, 'drawOffer', 'drawOfferPlies'),
        before.get(seat),
        `${seat}: the rest of the payload is byte for byte what it was`,
      );
      const events = after.events as { type: string }[];
      assert.ok(events.every((event) => !event.type.startsWith('draw-')));
    }

    append(tenant, room, {
      type: 'draw-declined',
      at: 61_000,
      roomId,
      color: second,
    });
    assert.equal(room.projection.drawOffer, undefined);
    for (const seat of viewers) {
      const after = serializedFor(tenant, room, seat);
      assert.equal('drawOffer' in after, false);
      if (seat === first) assert.equal(after.drawOfferCooldown, DRAW_OFFER_COOLDOWN_MOVES);
      else assert.equal('drawOfferCooldown' in after, false, `${seat}: never sees a cooldown`);
      // The move list keeps the mark after the offer is gone.
      assert.deepEqual(after.drawOfferPlies, [4]);
      assert.deepEqual(without(after, 'drawOfferCooldown', 'drawOfferPlies'), before.get(seat));
    }
  });
}

test('draw: the move list marks each offer at the ply it was made', () => {
  const move = { type: 'move-played' };
  const offer = { type: 'draw-offered' };
  assert.deepEqual(tenantDrawOfferPlies([]), {}, 'no offer, no field');
  assert.deepEqual(tenantDrawOfferPlies([move, move, move]), {});
  assert.deepEqual(
    tenantDrawOfferPlies([
      { type: 'room-created' },
      move,
      move,
      offer,
      { type: 'draw-declined' },
      move,
      move,
      move,
      move,
      move,
      offer,
      move,
    ]),
    { drawOfferPlies: [2, 7] },
  );
  // Offers before the first move never pass the server; one mark per ply.
  assert.deepEqual(tenantDrawOfferPlies([offer, move, offer, offer]), { drawOfferPlies: [1] });
});

// ── Correspondence ──────────────────────────────────────────────────────────

test('draw: a correspondence offer survives a rehydrate and keeps the move deadline', () => {
  const DAY_MS = 86_400_000;
  const timeControl = { initialMs: 3 * DAY_MS, incrementMs: 0, daysPerMove: 3 };
  const roomId = `${xiangqiTenant.roomIdPrefix}draw-corr`;
  const room = hydrate(xiangqiTenant as unknown as AnyTenant, roomId, timeControl);
  const tenant = xiangqiTenant as unknown as AnyTenant;
  playPlies(tenant, room, 3);
  const deadline = () => tenantDurableDeadlineFor(xiangqiTenant, room as never);
  const dueBefore = deadline();
  assert.ok(dueBefore, 'a days-per-move room has a durable deadline');

  // Red offers on black's turn, a day later.
  append(tenant, room, { type: 'draw-offered', at: 14_000 + DAY_MS, roomId, color: 'red' });
  assert.deepEqual(deadline(), dueBefore, 'an offer does not move the deadline');
  const reloaded = createTenantRuntimeRoomFromEvents(xiangqiTenant, room.events as never);
  assert.ok(reloaded.ok);
  assert.deepEqual(reloaded.room.projection.drawOffer, { from: 'red' }, 'the offer is in the log');

  // Black declines; the cooldown is in the log too.
  append(tenant, room, { type: 'draw-declined', at: 15_000 + DAY_MS, roomId, color: 'black' });
  assert.deepEqual(deadline(), dueBefore, 'a decline does not move the deadline');
  const again = createTenantRuntimeRoomFromEvents(xiangqiTenant, room.events as never);
  assert.ok(again.ok);
  assert.equal(again.room.projection.drawOffer, undefined);
  assert.equal(again.room.projection.drawCooldown?.red, DRAW_OFFER_COOLDOWN_MOVES);

  // Black offers, red accepts: the room ends and owes no deadline.
  append(tenant, room, { type: 'draw-offered', at: 16_000 + DAY_MS, roomId, color: 'black' });
  append(tenant, room, { type: 'draw-agreed', at: 17_000 + DAY_MS, roomId, color: 'red' });
  assert.equal(room.projection.state.status.reason, 'agreement');
  assert.equal(deadline(), null);
});

test('draw: a correspondence offer lapses on the opponent move after a reload', () => {
  const DAY_MS = 86_400_000;
  const timeControl = { initialMs: 3 * DAY_MS, incrementMs: 0, daysPerMove: 3 };
  const roomId = `${xiangqiTenant.roomIdPrefix}draw-corr-lapse`;
  const tenant = xiangqiTenant as unknown as AnyTenant;
  const room = hydrate(tenant, roomId, timeControl);
  playPlies(tenant, room, 2);
  append(tenant, room, { type: 'draw-offered', at: 20_000, roomId, color: 'red' });
  const reloaded = createTenantRuntimeRoomFromEvents(xiangqiTenant, room.events as never);
  assert.ok(reloaded.ok);
  const next = reloaded.room as unknown as Room;
  // Red moves: the offer stands. Black moves: it lapses.
  playPlies(tenant, next, 1, 30_000);
  assert.deepEqual(next.projection.drawOffer, { from: 'red' });
  playPlies(tenant, next, 1, 40_000);
  assert.equal(next.projection.drawOffer, undefined);
});

// ── Live socket: rated and PvE ──────────────────────────────────────────────

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

async function sendAs(socket: FakeSocket, message: unknown): Promise<void> {
  socket.receive(message);
  await settle();
}

const seatOf = (socket: FakeSocket) => socket.sent.find((frame) => frame.type === 'hello')?.seat;

// The ws gate (handleDraw) never reads `rated`, and seating two accounts in a
// rated room needs a session store, so this drives the log directly: the
// reducer accepts the draw in a rated room and the summary rates it.
test('draw: an agreed draw in a rated room between two accounts rates as a draw', () => {
  const tenant = xiangqiTenant as unknown as AnyTenant;
  const roomId = `${xiangqiTenant.roomIdPrefix}draw-rated`;
  const room = hydrate(tenant, roomId, { initialMs: 600_000, incrementMs: 5_000 }, { rated: true });
  playPlies(tenant, room, 2);
  append(tenant, room, { type: 'draw-offered', at: 20_000, roomId, color: 'red' });
  append(tenant, room, { type: 'draw-agreed', at: 21_000, roomId, color: 'black' });
  const status = room.projection.state.status;
  assert.equal(status.type === 'finished' ? status.reason : status.type, 'agreement');

  const runtimeRoom = room as unknown as XiangqiRuntimeRoom;
  assert.equal(runtimeRoom.rated, true);
  // Both seats are accounts (the rated gate counts only user participants).
  for (const color of ['red', 'black'] as const) {
    runtimeRoom.seatTokens[color] = {
      ...(runtimeRoom.seatTokens[color] ?? {}),
      userId: `user-${color}`,
      userHandle: `user-${color}`,
    } as never;
  }
  const summary = buildTenantGameSummary(xiangqiTenant, runtimeRoom);
  // persistence-games.ts rates `mode === 'pvp' && rated && !abortedAs`, mapping
  // result 'draw' to RatedResult 'draw', which rating-store.ts scores 0.5.
  assert.equal(summary.mode, 'pvp');
  assert.equal(summary.rated, true);
  assert.ok(!summary.abortedAs);
  assert.equal(summary.result, 'draw');
  assert.equal(summary.termination, 'draw');
});

test('draw: a room with a bot seat takes no draw offer', async () => {
  const created = await createXiangqiRoom(
    { initialMs: 600_000, incrementMs: 5_000 },
    'red',
    false,
    { engineId: XIANGQI_DEFAULT_ENGINE_ID, seat: 'black' },
  );
  assert.ok(created.ok);
  const room = created.room;
  const human = new FakeSocket();
  await handleXiangqiWebSocketConnection(WS_CTX, human.asWebSocket(), request('p-a'), room);
  await settle();
  assert.equal(seatOf(human), 'red');
  // Play both sides through the runtime, so no engine turn is scheduled.
  const tenant = xiangqiTenant as unknown as AnyTenant;
  playPlies(tenant, room as unknown as Room, 2);
  assert.equal(room.projection.state.moveNumber >= 2, true);
  const before = room.events.length;
  await sendAs(human, { type: 'draw:offer' });
  assert.equal(room.events.length, before, 'no draw event is appended');
  assert.equal(room.projection.drawOffer, undefined);
  assert.equal('drawOffer' in (human.sent.at(-1) ?? {}), false);
});
