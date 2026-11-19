import assert from 'node:assert/strict';
import type { UserAccount } from './persistence.js';
import type { XiangqiRuntimeRoom } from './xiangqi-runtime.js';

// send-email.ts and the senders read the env at import, and persistence.js
// reaches send-email.ts, so every project module loads dynamically after the
// env is set. A static import here made every send a silent no-op. The key is a
// placeholder and fetch is stubbed for every send below.
process.env.RESEND_API_KEY = 're_placeholder_for_tests';
process.env.MISTBOARD_AUTH_EMAIL_FROM = 'Mistboard <play@example.com>';
const { correspondenceTimeControl, DAY_MS } = await import('@mistboard/game');
const { createUser, getGameSummary, recordEmailDeliveryEvent } = await import('./persistence.js');
const { getPool } = await import('./persistence-db.js');
const { definePersistenceTests, test } = await import('./persistence-test-support.js');
const { sweepDeadlineWarnings } = await import('./correspondence-deadline-warning.js');
const { sweepCorrespondenceTurnDigests } = await import('./correspondence-turn-digest.js');
const { enableCorrespondenceVariantFlags, legalMoveFor } = await import(
  './correspondence-test-support.js'
);
await import('./variant-tenant/register-tenants.js');
const { appendTenantEvent } = await import('./variant-tenant/events.js');
const { sweepTenantRoomDeadline } = await import('./variant-tenant/lifecycle.js');
const { correspondenceTenantForSpecId } = await import('./variant-tenant/registry.js');
const { xiangqiTenant } = await import('./xiangqi-tenant.js');

enableCorrespondenceVariantFlags();
const noResultEmail = { notifyCorrespondenceGameOver: () => {} };

definePersistenceTests('correspondence notification ledger (#1217)', () => {
  test('deadline warning writes one joined row that survives the game timing out', async (t) => {
    t.after(() => correspondenceTenantForSpecId('xiangqi')!.clearRooms());
    const [first, second] = await accounts();
    const room = await game(first, second);
    // Two plies make expiry a timeout rather than a pregame abort.
    for (let i = 0; i < 2; i++) {
      const status = room.projection.state.status;
      assert.ok(status.type === 'playing');
      await appendTenantEvent(
        xiangqiTenant,
        room,
        {
          type: 'move-played',
          at: Date.now(),
          roomId: room.id,
          color: status.turn,
          move: legalMoveFor('xiangqi', room.projection.state as never) as Parameters<
            typeof xiangqiTenant.rules.applyMove
          >[1],
        },
        noResultEmail,
      );
    }
    const { rows: deadlines } = await getPool().query<{ due_at: Date }>(
      'SELECT due_at FROM room_deadlines WHERE room_id = $1',
      [room.id],
    );
    const dueAt = deadlines[0]!.due_at;
    const now = new Date(dueAt.getTime() - 3_600_000);
    const fetch = t.mock.method(globalThis, 'fetch', async () =>
      Response.json({ id: 'warning-accepted' }),
    );
    await sweepDeadlineWarnings(now, { enabled: true });
    await sweepDeadlineWarnings(now, { enabled: true });
    assert.equal(fetch.mock.callCount(), 1, 'the successful send marks this deadline warned');
    const read = async () =>
      (
        await getPool().query(
          `SELECT room_id, seat, user_id, kind, channel, sent_at, provider_email_id
       FROM correspondence_notifications WHERE room_id = $1 ORDER BY id`,
          [room.id],
        )
      ).rows;
    const before = await read();
    assert.equal(before.length, 1);
    assert.deepEqual(before[0], {
      room_id: room.id,
      seat: 'red',
      user_id: first.id,
      kind: 'deadline-warning',
      channel: 'email',
      sent_at: before[0].sent_at,
      provider_email_id: 'warning-accepted',
    });
    assert.ok(before[0].sent_at instanceof Date);

    assert.equal(
      await sweepTenantRoomDeadline(xiangqiTenant, room, {
        now: () => dueAt.getTime() + 1,
        appendEvent: (target, event) =>
          appendTenantEvent(xiangqiTenant, target, event, noResultEmail),
        broadcastEventAppended: () => {},
      }),
      'expired',
    );
    assert.equal((await getGameSummary(room.id))?.termination, 'timeout');
    assert.equal(
      (await getPool().query('SELECT 1 FROM room_deadlines WHERE room_id = $1', [room.id]))
        .rowCount,
      0,
    );
    assert.deepEqual(await read(), before);

    await recordEmailDeliveryEvent({
      eventId: 'warning-delivery',
      providerEmailId: 'warning-accepted',
      type: 'email.delivered',
      recipients: ['first@example.com'],
      occurredAt: new Date(),
      bounce: null,
      failureReason: null,
    });
    const { rows } = await getPool().query(
      `SELECT n.kind, e.event_type FROM correspondence_notifications n
       JOIN email_delivery_events e USING (provider_email_id) WHERE n.room_id = $1`,
      [room.id],
    );
    assert.deepEqual(rows, [{ kind: 'deadline-warning', event_type: 'email.delivered' }]);
  });

  test('one digest produces a row for each room with the recipient seat and shared provider ID', async (t) => {
    t.after(() => correspondenceTenantForSpecId('xiangqi')!.clearRooms());
    const [first, second] = await accounts();
    const rooms = [await game(first, second), await game(second, first)];
    t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'digest-accepted' }));
    await sweepCorrespondenceTurnDigests(new Date(), {
      enabled: true,
      listCandidates: async () => [
        {
          userId: first.id,
          email: 'first@example.com',
          locale: null,
          games: rooms.map((room) => ({
            roomId: room.id,
            gameSpecId: 'xiangqi',
            opponentName: 'Second',
            dueAt: new Date(Date.now() + DAY_MS),
            warned: false,
          })),
        },
      ],
      markSent: async () => {},
    });
    const { rows } = await getPool().query(
      `SELECT room_id, seat, kind, provider_email_id FROM correspondence_notifications
       WHERE user_id = $1 ORDER BY id`,
      [first.id],
    );
    assert.deepEqual(
      rows,
      rooms.map((room, i) => ({
        room_id: room.id,
        seat: i === 0 ? 'red' : 'black',
        kind: 'digest',
        provider_email_id: 'digest-accepted',
      })),
    );
  });
});

async function accounts(): Promise<UserAccount[]> {
  return Promise.all(
    ['first', 'second'].map((handle) =>
      createUser({
        id: `notification-${handle}`,
        email: `${handle}@example.com`,
        handle,
        displayName: handle,
        emailVerifiedAt: new Date(),
        now: new Date(),
      }),
    ),
  );
}

async function game(first: UserAccount, second: UserAccount): Promise<XiangqiRuntimeRoom> {
  const registration = correspondenceTenantForSpecId('xiangqi')!;
  const created = await registration.createCorrespondenceGameForSeek!({
    timeControl: correspondenceTimeControl(1),
    first: { userId: first.id },
    second: { userId: second.id },
  });
  assert.ok(created.ok);
  return registration.rooms.get(created.room.id) as unknown as XiangqiRuntimeRoom;
}
