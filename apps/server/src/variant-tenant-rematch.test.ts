/**
 * Rematch is on by default for every registered tenant (2026-10-14). This is
 * the conformance point: every registration is driven through the real ws
 * runtime and its own lobby factory, so a new tenant is covered the day it
 * registers, and one that cannot rematch has to say why (tenant.rematch.optOut).
 *
 * For each tenant that rematches: two guests in a finished PvP room both
 * offer, both are redirected into one new live room with their seats swapped
 * (for banqi and flip jungle, where the first seat opens, that swaps who opens)
 * on the same clock, and take those seats with the redirect tokens. The new
 * room's payloads are the hidden-info regression: no deal on the wire, nothing
 * face-down or shrouded with an identity, and a fresh deal server-side.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { isRetiredGameSpec } from '@mistboard/game';
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
import './variant-tenant/register-tenants.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';
import { tenantRoomOffersRematch, tenantSnapshotPayload } from './variant-tenant/runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

for (const flag of [
  'BANQI',
  'CRAZYHOUSE_XIANGQI',
  'DARK_XIANGQI',
  'ATOMIC_XIANGQI',
  'DUCK_XIANGQI',
  'FORTRESS_XIANGQI',
  'JIEQI',
  'JUNGLE',
  'JUNGLE_FLIP',
  'MAHJONG',
  'XIANGQI',
]) {
  process.env[`MISTBOARD_${flag}_ENABLED`] = 'true';
}

// Loose on purpose: the test drives each tenant through its registration and
// needs only these fields of the tenant itself.
type AnyTenant = {
  kind: string;
  colors: readonly string[];
  gameSpecId: string;
  rematch?: { optOut: string };
  rules: { finish(state: never, winner: string | null, reason: string): unknown };
};

// Every registered kind must appear here; a missing one fails below, so a new
// tenant cannot register without being held to the rematch contract.
const TENANTS: Record<string, AnyTenant> = Object.fromEntries(
  [
    atomicXiangqiTenant,
    banqiTenant,
    crazyhouseXiangqiTenant,
    darkChessTenant,
    darkXiangqiTenant,
    duckXiangqiTenant,
    fortressXiangqiTenant,
    jieqiTenant,
    jungleFlipTenant,
    jungleTenant,
    mahjongTenant,
    xiangqiTenant,
  ].map((tenant) => [tenant.kind, tenant as unknown as AnyTenant]),
);

const HIDDEN_INFO_KINDS = new Set(['jieqi', 'banqi', 'dark-xiangqi', 'jungle-flip']);
const DEALT_KINDS = new Set(['jieqi', 'banqi', 'jungle-flip']);
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
  ofType(type: string): Record<string, unknown>[] {
    return this.sent.filter((payload) => payload.type === type);
  }
}

function request(clientId: string, seatToken?: string): IncomingMessage {
  const headers: Record<string, string> = { host: 'localhost' };
  if (seatToken) headers['sec-websocket-protocol'] = `mistboard-seat.${seatToken}`;
  return { url: `/?client=${clientId}`, headers } as unknown as IncomingMessage;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

type Registration = ReturnType<typeof registeredVariantTenants>[number];
type LiveRoom = {
  id: string;
  events: readonly { type: string; setup?: unknown }[];
  rated: boolean;
  projection: { state: { status: { type: string } }; timeControl?: unknown };
};

async function connect(registration: Registration, room: LiveRoom, id: string, token?: string) {
  const socket = new FakeSocket();
  await registration.attachWebSocket(
    WS_CTX,
    socket as unknown as WebSocket,
    request(id, token),
    room as never,
  );
  await settle();
  const hello = socket.ofType('hello')[0];
  assert.ok(hello, `${id} got a hello`);
  return { socket, seat: hello.seat as string };
}

// Every object on the wire that hides a piece must hide its identity. Returns
// how many hidden entries it checked, so a test can prove it checked some.
function assertNoHiddenIdentity(kind: string, label: string, value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((n, item) => n + assertNoHiddenIdentity(kind, label, item), 0);
  }
  if (typeof value !== 'object' || value === null) return 0;
  const entry = value as Record<string, unknown>;
  let hidden = entry.faceDown === true || entry.shrouded === true ? 1 : 0;
  if (entry.faceDown === true) {
    assert.ok(!('role' in entry), `${kind} ${label}: a face-down entry carries its role`);
  }
  if (entry.shrouded === true) {
    assert.ok(!('piece' in entry), `${kind} ${label}: a shrouded entry carries its piece`);
    assert.ok(!('role' in entry), `${kind} ${label}: a shrouded entry carries its role`);
  }
  for (const child of Object.values(entry)) hidden += assertNoHiddenIdentity(kind, label, child);
  return hidden;
}

test('every registered tenant is held to the rematch contract', () => {
  const registrations = registeredVariantTenants();
  assert.ok(registrations.length >= 12, 'register-tenants loaded every registration');
  for (const registration of registrations) {
    const tenant = TENANTS[registration.kind];
    assert.ok(tenant, `${registration.kind} is missing from this test's tenant table`);
    if (tenant.rematch) {
      assert.ok(tenant.rematch.optOut.trim().length > 0, `${tenant.kind} opts out with a reason`);
      continue;
    }
    // On by default: the rematch room comes from the lobby factory.
    assert.ok(registration.lobby, `${tenant.kind} rematches but has no lobby factory`);
    assert.equal(tenant.colors.length, 2, `${tenant.kind} rematch swaps exactly two seats`);
  }
  assert.ok(TENANTS.mahjong?.rematch, 'mahjong (four seats) opts out');
  assert.ok(TENANTS['dark-chess']?.rematch, 'dark chess (correspondence only, #531) opts out');
});

test('a retired variant offers no rematch: it opens no new rooms', async () => {
  const retired = registeredVariantTenants().filter((registration) =>
    isRetiredGameSpec(registration.gameSpecId),
  );
  assert.ok(retired.length > 0, 'no retired tenant to check: this test asserted nothing');
  for (const registration of retired) {
    const tenant = TENANTS[registration.kind]!;
    const room = {
      id: `${registration.roomIdPrefix}retired`,
      events: [],
      rated: false,
      clients: new Set(),
      seatTokens: new Map(),
      rematch: { offers: {} },
      projection: {
        state: { status: { type: 'finished', winner: tenant.colors[0], reason: 'resignation' } },
        timeControl: TEN_PLUS_FIVE,
      },
    };
    assert.equal(tenantRoomOffersRematch(tenant as never, room as never), false, tenant.kind);
  }
});

for (const registration of registeredVariantTenants()) {
  const tenant = TENANTS[registration.kind];
  if (!tenant || tenant.rematch || !registration.lobby) continue;
  if (isRetiredGameSpec(registration.gameSpecId)) continue;
  const lobby = registration.lobby;
  const [first, second] = tenant.colors as [string, string];

  test(`${tenant.kind} rematch: mutual offers open one new room, seats swapped, same clock`, async () => {
    const created = await lobby.createRoom(TEN_PLUS_FIVE, false);
    const room = registration.rooms.get(created.id) as unknown as LiveRoom | undefined;
    assert.ok(room, 'the lobby room is live');
    const a = await connect(registration, room, 'client-a');
    const b = await connect(registration, room, 'client-b');
    assert.deepEqual(new Set([a.seat, b.seat]), new Set([first, second]));
    const firstSeat = a.seat === first ? a : b;
    const secondSeat = a.seat === first ? b : a;

    // A live room offers nothing: the snapshot carries no rematch block and an
    // offer is ignored.
    a.socket.receive({ type: 'rematch:offer' });
    await settle();
    assert.equal(a.socket.ofType('rematch:state').length, 0, 'no rematch while live');

    room.projection = {
      ...room.projection,
      state: tenant.rules.finish(room.projection.state as never, first, 'resignation') as never,
    };
    const finishedSnapshot = tenantSnapshotPayload(
      tenant as never,
      room as never,
      {
        seat: first,
      } as never,
    ) as Record<string, unknown>;
    assert.deepEqual(finishedSnapshot.rematch, {
      offers: { [first]: false, [second]: false },
      finalizedRoomId: null,
    });

    firstSeat.socket.receive({ type: 'rematch:offer' });
    await settle();
    secondSeat.socket.receive({ type: 'rematch:offer' });
    await settle();

    const firstRedirect = firstSeat.socket.ofType('rematch:redirect')[0];
    const secondRedirect = secondSeat.socket.ofType('rematch:redirect')[0];
    assert.ok(firstRedirect && secondRedirect, 'both players are redirected');
    assert.equal(firstRedirect.roomId, secondRedirect.roomId, 'into one room');
    assert.equal(firstRedirect.seat, second, `the ${first} player plays ${second} next`);
    assert.equal(secondRedirect.seat, first, `the ${second} player plays ${first} next`);

    const next = registration.rooms.get(firstRedirect.roomId as string) as unknown as
      | LiveRoom
      | undefined;
    assert.ok(next, 'the new room is live');
    assert.notEqual(next.id, room.id);
    assert.deepEqual(next.projection.timeControl, TEN_PLUS_FIVE, 'same clock');
    assert.equal(next.rated, false, 'a casual game rematches casual');
    if (DEALT_KINDS.has(tenant.kind)) {
      assert.ok(next.events[0]?.setup, 'the new room holds a deal server-side');
      assert.notDeepEqual(next.events[0]?.setup, room.events[0]?.setup, 'fresh deal');
    }

    const nowFirst = await connect(
      registration,
      next,
      'client-b-next',
      secondRedirect.seatToken as string,
    );
    const nowSecond = await connect(
      registration,
      next,
      'client-a-next',
      firstRedirect.seatToken as string,
    );
    assert.equal(nowFirst.seat, first);
    assert.equal(nowSecond.seat, second);
    const watcher = await connect(registration, next, 'client-watch');
    assert.equal(watcher.seat, 'spectator', 'no token, no seat');

    if (HIDDEN_INFO_KINDS.has(tenant.kind)) {
      for (const client of [nowFirst, nowSecond, watcher]) {
        const wire = JSON.stringify(client.socket.sent);
        assert.ok(!wire.includes('"setup"'), `${client.seat} received the deal`);
        const hidden = assertNoHiddenIdentity(tenant.kind, client.seat, client.socket.sent);
        if (client !== watcher || tenant.kind !== 'dark-xiangqi') {
          // A Fog spectator sees an empty board live; everyone else is shown
          // hidden pieces, so the check above saw some.
          assert.ok(hidden > 0, `${tenant.kind} ${client.seat}: no hidden entry was checked`);
        }
      }
    }
    assert.ok(!('rematch' in (nowFirst.socket.ofType('hello')[0] ?? {})), 'live room: no offers');
    registration.clearRuntimeTimers(room as never);
    registration.clearRuntimeTimers(next as never);
  });
}
