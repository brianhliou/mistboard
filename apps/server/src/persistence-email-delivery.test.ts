import { readFile } from 'node:fs/promises';
import { runMigrations } from './migrate.js';
import {
  completeLoginEmailRequest,
  correlateLoginEmailRequest,
  createEmailLoginChallenge,
  deleteEmailLoginChallenge,
  getEmailDeliveryAddress,
  getLoginEmailRequest,
  recordEmailDeliveryEvent,
  recordLoginEmailRequest,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import {
  EMAIL_DELIVERY_TYPES,
  type EmailDeliveryEvent,
  type EmailDeliveryType,
} from './resend-webhook.js';

const start = new Date('2026-11-03T20:00:00.000Z');
function event(
  type: EmailDeliveryType,
  seconds: number,
  id = `${type}_${seconds}`,
): EmailDeliveryEvent {
  return {
    eventId: id,
    providerEmailId: 'provider_1',
    type,
    recipients: [' Player@Example.COM ', 'player@example.com'],
    occurredAt: new Date(start.getTime() + seconds * 1000),
    bounce:
      type === 'email.bounced'
        ? { type: 'Permanent', subType: 'General', message: `bounce ${seconds}` }
        : null,
    failureReason: type === 'email.failed' ? 'reached_daily_quota' : null,
  };
}

definePersistenceTests('email delivery', () => {
  test('persistence delivery migration applies once, enforces normalized addresses, and preserves auth challenges', async () => {
    const client = await getPool().connect();
    try {
      assert.deepEqual(await runMigrations(client), []);
      const applied = await client.query(
        "SELECT name FROM _migrations WHERE name = '186_email_delivery.sql'",
      );
      assert.equal(applied.rowCount, 1);
      // Exercise the migration itself in a disposable schema, including rollback.
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA email_delivery_migration_probe');
      await client.query('SET LOCAL search_path TO email_delivery_migration_probe');
      await client.query(
        await readFile(new URL('../migrations/186_email_delivery.sql', import.meta.url), 'utf8'),
      );
      const tables = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'email_delivery_migration_probe'",
      );
      assert.equal(tables.rowCount, 3);
      await assert.rejects(
        client.query(
          "INSERT INTO login_email_requests (request_id, email, requested_at) VALUES ('bad', 'UPPER@Example.com', now())",
        ),
        /check constraint/,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await createEmailLoginChallenge({
      id: 'challenge',
      email: 'player@example.com',
      codeHash: 'never-a-code',
      expiresAt: new Date(start.getTime() + 600000),
    });
    await recordLoginEmailRequest({
      requestId: 'challenge',
      email: ' Player@Example.COM ',
      requestedAt: start,
    });
    await deleteEmailLoginChallenge('challenge');
    assert.equal((await getLoginEmailRequest('challenge'))?.email, 'player@example.com');
  });

  test('persistence delivery stores all six event types, counts once per normalized recipient, and retains history', async () => {
    for (const [index, type] of EMAIL_DELIVERY_TYPES.entries()) {
      const input = event(type, index);
      assert.equal(await recordEmailDeliveryEvent(input), true);
      assert.equal(await recordEmailDeliveryEvent(input), false);
    }
    const address = await getEmailDeliveryAddress(' PLAYER@example.com ');
    assert.ok(address);
    assert.equal(address.eventCount, 6);
    assert.deepEqual(address.counts, {
      sent: 1,
      delivered: 1,
      delivery_delayed: 1,
      bounced: 1,
      complained: 1,
      failed: 1,
    });
    assert.equal(address.status, 'failed');
    assert.equal(address.failureReason, 'reached_daily_quota');
    assert.deepEqual(address.bounce, event('email.bounced', 3).bounce);
    assert.equal(address.firstEventAt.toISOString(), start.toISOString());
    assert.equal(
      address.lastEventAt.toISOString(),
      event('email.failed', 5).occurredAt.toISOString(),
    );
    const history = await getPool().query(
      'SELECT * FROM email_delivery_events ORDER BY occurred_at',
    );
    assert.equal(history.rowCount, 6);
    assert.deepEqual(history.rows[0].recipients, ['player@example.com']);
    assert.equal(history.rows[0].provider_email_id, 'provider_1');
    assert.ok(history.rows.every((row) => row.received_at instanceof Date));
  });

  test('persistence delivery handles concurrent duplicates, out-of-order progress, and older bounce details', async () => {
    const delivered = event('email.delivered', 20);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => recordEmailDeliveryEvent(delivered)),
    );
    assert.equal(results.filter(Boolean).length, 1);
    await recordEmailDeliveryEvent(event('email.delivery_delayed', 10));
    await recordEmailDeliveryEvent(event('email.sent', 0));
    assert.equal((await getEmailDeliveryAddress('player@example.com'))?.status, 'delivered');
    await recordEmailDeliveryEvent(event('email.bounced', 30));
    await recordEmailDeliveryEvent(event('email.bounced', 5));
    const state = await getEmailDeliveryAddress('player@example.com');
    assert.equal(state?.status, 'bounced');
    assert.equal(state?.eventCount, 5);
    assert.equal(state?.counts.bounced, 2);
    assert.equal(state?.bounce?.message, 'bounce 30');
    assert.equal(state?.lastDeliveredAt?.getTime(), delivered.occurredAt.getTime());
    assert.equal(state?.lastBouncedAt?.getTime(), event('email.bounced', 30).occurredAt.getTime());
    assert.equal(state?.firstEventAt.getTime(), start.getTime());
  });

  test('persistence delivery equal-timestamp status is independent of arrival order', async () => {
    for (const [email, types] of [
      ['first@example.com', EMAIL_DELIVERY_TYPES],
      ['second@example.com', [...EMAIL_DELIVERY_TYPES].reverse()],
    ] as const) {
      for (const type of types)
        await recordEmailDeliveryEvent({
          ...event(type, 0, `${email}_${type}`),
          recipients: [email],
        });
    }
    const first = await getEmailDeliveryAddress('first@example.com');
    const second = await getEmailDeliveryAddress('second@example.com');
    assert.equal(first?.status, 'complained');
    assert.equal(second?.status, 'complained');
    assert.deepEqual(first?.counts, second?.counts);
  });

  test('persistence delivery rolls back a claimed event on projection failure so retry succeeds', async () => {
    await getPool().query(
      `ALTER TABLE email_delivery_addresses ADD CONSTRAINT email_delivery_test_failure CHECK (email <> 'retry@example.com')`,
    );
    const input = {
      ...event('email.delivered', 1, 'retry_event'),
      recipients: ['a@example.com', 'retry@example.com'],
    };
    try {
      await assert.rejects(recordEmailDeliveryEvent(input), /email_delivery_test_failure/);
      const claimed = await getPool().query(
        'SELECT event_id FROM email_delivery_events WHERE event_id = $1',
        [input.eventId],
      );
      assert.equal(claimed.rowCount, 0);
      assert.equal(await getEmailDeliveryAddress('a@example.com'), null);
    } finally {
      await getPool().query(
        'ALTER TABLE email_delivery_addresses DROP CONSTRAINT email_delivery_test_failure',
      );
    }
    assert.equal(await recordEmailDeliveryEvent(input), true);
    assert.equal((await getEmailDeliveryAddress('a@example.com'))?.eventCount, 1);
    assert.equal((await getEmailDeliveryAddress('retry@example.com'))?.eventCount, 1);
  });

  test('persistence login ledger correlates events received before send response and retains first completion', async () => {
    assert.equal(await recordEmailDeliveryEvent(event('email.delivered', 2)), true);
    await recordLoginEmailRequest({
      requestId: 'request_1',
      email: ' Player@Example.com ',
      requestedAt: start,
    });
    await recordLoginEmailRequest({
      requestId: 'request_1',
      email: 'other@example.com',
      requestedAt: new Date(),
    });
    assert.equal(await correlateLoginEmailRequest('request_1', 'provider_1'), true);
    assert.equal(await correlateLoginEmailRequest('request_1', 'provider_1'), true);
    assert.equal(await correlateLoginEmailRequest('request_1', 'different_provider_id'), false);
    assert.equal(
      await completeLoginEmailRequest('request_1', new Date(start.getTime() - 1)),
      false,
    );
    const completed = new Date(start.getTime() + 30000);
    assert.equal(await completeLoginEmailRequest('request_1', completed), true);
    await completeLoginEmailRequest('request_1', new Date(completed.getTime() + 1000));
    assert.deepEqual(await getLoginEmailRequest('request_1'), {
      requestId: 'request_1',
      email: 'player@example.com',
      requestedAt: start,
      providerEmailId: 'provider_1',
      completedAt: completed,
    });
    const correlated = await getPool().query(
      `SELECT e.event_type FROM email_delivery_events e JOIN login_email_requests r ON r.provider_email_id = e.provider_email_id WHERE r.request_id = 'request_1'`,
    );
    assert.equal(correlated.rows[0].event_type, 'email.delivered');
    assert.equal(await correlateLoginEmailRequest('missing', 'provider_missing'), false);
    assert.equal(await completeLoginEmailRequest('missing', completed), false);
    assert.equal(await getLoginEmailRequest('missing'), null);
  });
});
