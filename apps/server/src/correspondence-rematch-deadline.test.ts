import assert from 'node:assert/strict';
import test from 'node:test';
import { correspondenceTimeControl, DAY_MS, isRetiredGameSpec } from '@mistboard/game';
import {
  CORRESPONDENCE_TEST_TENANTS,
  enableCorrespondenceVariantFlags,
} from './correspondence-test-support.js';
import { close, getPool, init } from './persistence-db.js';
import './variant-tenant/register-tenants.js';
import { tenantDurableDeadlineFor } from './variant-tenant/lifecycle.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';
import { finalizeTenantRematchIfReady } from './variant-tenant/rematch.js';
import { registeredTenantRematchContext } from './variant-tenant/rematch-context.js';
import {
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { mintTenantSeatToken } from './variant-tenant/seat-session.js';

enableCorrespondenceVariantFlags();

for (const [specId, { tenant }] of Object.entries(CORRESPONDENCE_TEST_TENANTS)) {
  if (tenant.rematch || isRetiredGameSpec(tenant.gameSpecId)) continue;
  test(`${specId}: correspondence rematch writes its first-move deadline before either reconnects`, async (t) => {
    const registration = correspondenceTenantForSpecId(specId)!;
    assert.ok(registration.lobby);
    const events = new Map<string, unknown[]>();
    const deadlines = new Map<string, { seat: string; userId: string; dueAt: Date }>();
    init('postgres://mistboard@127.0.0.1:9/never');
    t.mock.method(getPool(), 'query', async (sql: string, values: unknown[] = []) => {
      const id = String(values[0]);
      if (sql.includes('AS locked')) return { rows: [{ locked: false }] };
      if (sql.includes('AS allowed')) return { rows: [{ allowed: true }] };
      if (sql.startsWith('INSERT INTO events')) {
        const log = events.get(id) ?? [];
        assert.equal(values[1], log.length, 'events have contiguous durable sequences');
        log.push(structuredClone(values[3]));
        events.set(id, log);
      } else if (sql.includes('INSERT INTO room_deadlines')) {
        deadlines.set(id, {
          seat: String(values[2]),
          userId: String(values[3]),
          dueAt: values[4] as Date,
        });
      } else if (sql.startsWith('DELETE FROM room_deadlines')) {
        deadlines.delete(id);
      } else {
        assert.match(sql.trim(), /^(INSERT|UPDATE)\b/, 'unexpected database read');
      }
      return { rows: [], rowCount: 1 };
    });
    t.after(async () => {
      registration.clearRooms();
      await close();
    });

    const created = createTenantRuntimeRoom(tenant, `${tenant.roomIdPrefix}finished`, {
      timeControl: correspondenceTimeControl(3),
    });
    assert.ok(created.ok);
    const previous = created.room;
    previous.projection.state = tenant.rules.finish(
      previous.projection.state,
      tenant.colors[0]!,
      'resignation',
    );
    for (const seat of tenant.colors) {
      const { state } = mintTenantSeatToken(previous, seat, {
        userId: `account-${seat}`,
        userHandle: seat,
        userDisplayName: seat,
      });
      previous.rematch.offers[seat] = {
        tokenHash: state.tokenHash,
        userId: state.userId,
        at: Date.now(),
      };
    }
    const context = registeredTenantRematchContext(previous.id, () => {});
    assert.ok(context);
    const next = await finalizeTenantRematchIfReady(tenant, context, previous);
    assert.ok(next);
    assert.equal(next.clients.size, 0, 'neither player has followed the redirect');
    assert.equal(next.events.filter((event) => event.type === 'move-played').length, 0);
    const deadline = deadlines.get(next.id);
    assert.ok(deadline, 'a first-move room_deadlines row exists at rematch finalization');
    const derived = tenantDurableDeadlineFor(tenant, next);
    assert.ok(derived);
    assert.equal(deadline.seat, derived.seat);
    assert.equal(deadline.userId, next.seatTokens[derived.seat]?.userId);
    assert.equal(deadline.dueAt.getTime(), derived.dueAt);
    assert.ok(derived.dueAt > Date.now() + 2 * DAY_MS);
    assert.equal(next.seatTokens[tenant.colors[0]!]!.userId, `account-${tenant.colors[1]}`);

    const restored = createTenantRuntimeRoomFromEvents(tenant, events.get(next.id) as never);
    assert.ok(restored.ok, 'the durable event log hydrates without a connection');
    assert.deepEqual(restored.room.projection.seats, next.projection.seats);
    assert.deepEqual(tenantDurableDeadlineFor(tenant, restored.room), derived);
    // Serialize the entire new-room payload for both seats and an observer:
    // pre-seating must never expose a hidden deal before the first connection.
    for (const seat of [...tenant.colors, 'spectator']) {
      const wire = JSON.stringify(
        tenantSnapshotPayload(tenant, next, {
          id: next.projection.seats[seat] ?? 'observer',
          seat,
          solo: false,
        }),
      );
      if (['jieqi', 'banqi', 'dark-xiangqi', 'jungle-flip'].includes(specId))
        assert.ok(!wire.includes('"setup"'), 'the hidden deal is server-only');
      assertMasked(JSON.parse(wire));
    }
  });
}

function assertMasked(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) assertMasked(child);
  } else if (value && typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    if (entry.faceDown === true) assert.ok(!('role' in entry));
    if (entry.shrouded === true) {
      assert.ok(!('piece' in entry));
      assert.ok(!('role' in entry));
    }
    for (const child of Object.values(entry)) assertMasked(child);
  }
}
