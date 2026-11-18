import { correspondenceTimeControl, DAY_MS } from '@mistboard/game';
import {
  type AnyTenant,
  CORRESPONDENCE_TEST_TENANTS,
  enableCorrespondenceVariantFlags,
} from './correspondence-test-support.js';
import { darkChessTenant } from './dark-chess-tenant.js';
import { listExpiredCorrespondenceInvites, loadRoomEvents } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import './variant-tenant/register-tenants.js';
import { startTenantDeadlineSweeper } from './variant-tenant/deadline-sweeper.js';
import { appendTenantEvent } from './variant-tenant/events.js';
import {
  correspondenceTenantForSpecId,
  type TenantManagedRoom,
} from './variant-tenant/registry.js';
import { createTenantRuntimeRoomFromEvents, isTenantEventLog } from './variant-tenant/runtime.js';
import type { TenantGameStateLike, TenantRuntimeRoom } from './variant-tenant/tenant.js';

enableCorrespondenceVariantFlags();
type Room = TenantRuntimeRoom<string, string, unknown, TenantGameStateLike<string>, string>;

definePersistenceTests('correspondence invite expiry (#1219)', () => {
  // End-only games persistence and start-writing persistence both matter:
  // the former has no games row for this pass to discover.
  for (const specId of ['xiangqi', 'dark-chess']) {
    test(`${specId}: cold sweep expires a 15-day invite, preserves young/accepted rooms, and replays`, async () => {
      const registration = correspondenceTenantForSpecId(specId)!;
      const tenant = tenantFor(specId);
      const expired = await invite(specId, 15);
      const young = await invite(specId, 13);
      const empty = await invite(specId, 15, 0);
      const accepted = await invite(specId, 15, 2);
      const terminal = await invite(specId, 15);
      await appendTenantEvent(tenant, terminal, {
        type: 'game-aborted',
        at: Date.now(),
        roomId: terminal.id,
        reason: 'user-abort',
      });
      const candidates = await listExpiredCorrespondenceInvites(new Date());
      assert.deepEqual(
        new Set(candidates.map((row) => row.roomId)),
        new Set([expired.id, empty.id]),
      );
      assert.equal((await gameRow(expired.id)) !== null, specId === 'dark-chess');
      registration.clearRooms();
      try {
        await tick();
        for (const room of [expired, empty]) {
          const events = await loadRoomEvents(room.id);
          assert.ok(events && isTenantEventLog(tenant, events, room.id));
          const replay = createTenantRuntimeRoomFromEvents(tenant, events);
          assert.ok(replay.ok);
          assert.deepEqual(replay.room.projection.state.status, {
            type: 'aborted',
            reason: 'pregame-timeout',
          });
          const cold = await registration.getOrLoadRoom(room.id);
          assert.equal(cold?.projection?.state.status.type, 'aborted');
          assert.equal(events.filter((event) => event.type === 'game-aborted').length, 1);
          const row = await gameRow(room.id);
          if (specId === 'dark-chess') {
            assert.ok(row);
            assert.deepEqual(row, { status: 'aborted', result: null, termination: 'abandoned' });
          } else assert.equal(row, null);
        }
        for (const room of [young, accepted]) {
          const cold = await registration.getOrLoadRoom(room.id);
          assert.equal(cold?.projection?.state.status.type, 'playing');
        }
        await tick();
        assert.deepEqual(await listExpiredCorrespondenceInvites(new Date()), []);
        assert.equal(
          (await loadRoomEvents(expired.id))?.filter((event) => event.type === 'game-aborted')
            .length,
          1,
        );
      } finally {
        registration.clearRooms();
      }
    });

    test(`${specId}: overlapping processes resync a stale loaded invite without a second abort`, async () => {
      const registration = correspondenceTenantForSpecId(specId)!;
      const tenant = tenantFor(specId);
      const stale = await invite(specId, 15);
      const snapshots: Array<{ state?: { status?: { type: string; winner?: string } } }> = [];
      stale.clients.add({
        id: `${tenant.colors[0]}-client`,
        seat: tenant.colors[0]!,
        solo: false,
        displaced: false,
        socket: {
          send: (data: string) => {
            snapshots.push(JSON.parse(data));
          },
        },
      } as never);
      const events = await loadRoomEvents(stale.id);
      assert.ok(events && isTenantEventLog(tenant, events, stale.id));
      const other = createTenantRuntimeRoomFromEvents(tenant, events);
      assert.ok(other.ok);
      const rooms = registration.rooms as Map<string, TenantManagedRoom>;
      rooms.set(stale.id, other.room as unknown as TenantManagedRoom);
      try {
        await tick();
        rooms.set(stale.id, stale as unknown as TenantManagedRoom);
        assert.equal(stale.projection.state.status.type, 'playing');
        await tick();
        await tick();
        assert.equal(stale.projection.state.status.type, 'aborted');
        const snapshot = snapshots.at(-1);
        assert.equal(snapshot?.state?.status?.type, 'aborted', 'the open socket learns the result');
        assert.equal(
          snapshot?.state?.status?.winner,
          undefined,
          'no player wins an expired invite',
        );
        const stored = await loadRoomEvents(stale.id);
        assert.equal(stored?.filter((event) => event.type === 'game-aborted').length, 1);
      } finally {
        registration.clearRooms();
      }
    });
  }
});

function tenantFor(specId: string): AnyTenant {
  return specId === 'dark-chess'
    ? (darkChessTenant as unknown as AnyTenant)
    : CORRESPONDENCE_TEST_TENANTS[specId]!.tenant;
}

async function invite(specId: string, ageDays: number, seats = 1): Promise<Room> {
  const registration = correspondenceTenantForSpecId(specId)!;
  const created = await registration.createCorrespondenceRoom!(correspondenceTimeControl(3));
  assert.ok(created.ok);
  const room = registration.rooms.get(created.room.id) as unknown as Room;
  const tenant = tenantFor(specId);
  for (const seat of tenant.colors.slice(0, seats)) {
    await appendTenantEvent(tenant, room, {
      type: 'seat-assigned',
      at: Date.now(),
      roomId: room.id,
      seat,
      clientId: `${seat}-client`,
    });
  }
  const at = Date.now() - ageDays * DAY_MS;
  room.events[0]!.at = at;
  await query(
    `UPDATE events SET payload = jsonb_set(payload, '{at}', to_jsonb($2::bigint)), created_at = to_timestamp($2 / 1000.0) WHERE room_id = $1 AND seq = 0`,
    [room.id, at],
  );
  return room;
}

async function tick(): Promise<void> {
  const sweeper = startTenantDeadlineSweeper({
    warnDeadlines: async () => {},
    digestTurns: async () => {},
    emailInbox: async () => {},
    sweepExpiredSeeks: async () => 0,
  });
  try {
    await sweeper.tick();
  } finally {
    sweeper.stop();
  }
}

async function query(sql: string, values: unknown[]) {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return await client.query(sql, values);
  } finally {
    await client.end();
  }
}

async function gameRow(roomId: string) {
  const result = await query('SELECT status, result, termination FROM games WHERE room_id = $1', [
    roomId,
  ]);
  return result.rows[0] ?? null;
}
