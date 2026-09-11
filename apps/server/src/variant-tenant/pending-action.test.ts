import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Color, RoomTimeControl } from '@mistboard/game';
import { type DarkChessTenantEvent, darkChessTenant } from '../dark-chess-tenant.js';
import {
  clearTenantRuntimeTimers,
  scheduleTenantActionTimeout,
  type TenantLifecycleClient,
} from './lifecycle.js';
import { createTenantRuntimeRoomFromEvents } from './runtime.js';

// The pending-action timer is what stops one quiet seat hanging a table that is
// waiting on several seats at once. Mahjong is the tenant that needs it; these
// pin the mechanism against a real hydrated room by lending dark chess the hook,
// so the test exercises the runtime rather than a room shape invented for it.

const TC: RoomTimeControl = { initialMs: 180_000, incrementMs: 2_000 };
type Move = { from: string; to: string };
const PASS: Move = { from: 'g1', to: 'f3' };

function hydrate() {
  const roomId = 'pending-action-room';
  const events: DarkChessTenantEvent[] = [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'dark-chess', timeControl: TC },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'white-client', seat: 'white' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'black-client', seat: 'black' },
  ];
  const hydrated = createTenantRuntimeRoomFromEvents(darkChessTenant, events);
  assert.ok(hydrated.ok, 'fixture event log must hydrate');
  return { ...hydrated.room, clients: new Set<TenantLifecycleClient<Color>>() };
}

/** A tenant that wants `move` played for `color` once `at` passes. */
function tenantWanting(pending: () => { at: number; color: Color; move: Move } | null) {
  return { ...darkChessTenant, rules: { ...darkChessTenant.rules, pendingAction: pending } };
}

function recordingContext(room: ReturnType<typeof hydrate>) {
  const appended: DarkChessTenantEvent[] = [];
  const broadcast: number[] = [];
  return {
    appended,
    broadcast,
    ctx: {
      appendEvent: async (_room: unknown, event: DarkChessTenantEvent) => {
        appended.push(event);
        room.events.push(event);
        return room.events.length - 1;
      },
      broadcastEventAppended: (_room: unknown, _event: unknown, seq: number) => {
        broadcast.push(seq);
      },
    },
  };
}

test('a tenant with no pendingAction arms nothing', () => {
  // Every strictly alternating tenant is in this case, so it must stay free.
  const room = hydrate();
  const { ctx } = recordingContext(room);
  scheduleTenantActionTimeout(darkChessTenant, room, ctx);
  assert.equal(room.actionTimer, null);
});

test('a pending action is played for the seat when its deadline passes', async () => {
  const room = hydrate();
  const { appended, broadcast, ctx } = recordingContext(room);
  const tenant = tenantWanting(() => ({ at: Date.now(), color: 'white', move: PASS }));
  scheduleTenantActionTimeout(tenant, room, ctx);
  assert.notEqual(room.actionTimer, null, 'a deadline should arm a timer');
  await sleep(120);
  assert.equal(appended.length, 1);
  assert.deepEqual(appended[0], {
    type: 'move-played',
    at: appended[0]?.at,
    roomId: room.id,
    color: 'white',
    move: PASS,
  });
  assert.equal(broadcast.length, 1, 'the seats must be told the turn moved');
});

test('a wait that settles before the timer fires plays nothing', async () => {
  // The race that matters: a seat answers at the last moment. Its own timeout
  // must not then overrule the answer it just gave.
  const room = hydrate();
  const { appended, ctx } = recordingContext(room);
  let settled = false;
  const tenant = tenantWanting(() =>
    settled ? null : { at: Date.now(), color: 'white', move: PASS },
  );
  scheduleTenantActionTimeout(tenant, room, ctx);
  settled = true;
  await sleep(120);
  assert.deepEqual(appended, []);
});

test('a far-off deadline does not fire early', async () => {
  const room = hydrate();
  const { appended, ctx } = recordingContext(room);
  const tenant = tenantWanting(() => ({ at: Date.now() + 60_000, color: 'white', move: PASS }));
  scheduleTenantActionTimeout(tenant, room, ctx);
  await sleep(80);
  assert.deepEqual(appended, []);
  clearTenantRuntimeTimers(room);
});

test('clearing the room timers disarms a pending action', () => {
  // A room that finished while a claim window was open would otherwise play a
  // move into a finished game.
  const room = hydrate();
  const { ctx } = recordingContext(room);
  scheduleTenantActionTimeout(
    tenantWanting(() => ({ at: Date.now() + 60_000, color: 'white', move: PASS })),
    room,
    ctx,
  );
  assert.notEqual(room.actionTimer, null);
  clearTenantRuntimeTimers(room);
  assert.equal(room.actionTimer, null);
});

test('re-arming replaces the previous timer rather than stacking one', async () => {
  // scheduleTenantLifecycleTimers runs after every event, so without the clear
  // a long claim window would accumulate a timer per move and fire repeatedly.
  const room = hydrate();
  const { appended, ctx } = recordingContext(room);
  const tenant = tenantWanting(() => ({ at: Date.now(), color: 'white', move: PASS }));
  scheduleTenantActionTimeout(tenant, room, ctx);
  scheduleTenantActionTimeout(tenant, room, ctx);
  scheduleTenantActionTimeout(tenant, room, ctx);
  await sleep(120);
  assert.equal(appended.length, 1);
});
