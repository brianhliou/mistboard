import {
  applyPatronSubscription,
  createUser,
  expireLapsedPatrons,
  PATRON_ONE_TIME_STATUS,
  type PatronSubscriptionInput,
  processStripeEvent,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('patron', () => {
  test('Stripe event claim and patron lifecycle update commit atomically', async () => {
    const now = new Date('2026-07-12T00:00:00.000Z');
    await createUser({
      id: 'patron_user',
      email: 'patron@example.com',
      emailVerifiedAt: now,
      handle: 'patron-player',
      displayName: 'Patron Player',
      now,
    });

    const active = patronInput('active');
    let applications = 0;
    const first = await processStripeEvent(
      'evt_patron_active',
      'customer.subscription.created',
      async (transaction) => {
        applications += 1;
        await applyPatronSubscription(active, transaction);
      },
    );
    assert.equal(first, true);

    const duplicate = await processStripeEvent(
      'evt_patron_active',
      'customer.subscription.created',
      async () => {
        applications += 1;
      },
    );
    assert.equal(duplicate, false);
    assert.equal(applications, 1);

    let state = await patronState();
    assert.equal(state.eventCount, 1);
    assert.equal(state.status, 'active');
    assert.ok(state.patronSince);

    await assert.rejects(
      processStripeEvent(
        'evt_patron_canceled',
        'customer.subscription.deleted',
        async (transaction) => {
          await applyPatronSubscription(patronInput('canceled'), transaction);
          throw new Error('simulated failure after patron update');
        },
      ),
      /simulated failure/,
    );

    state = await patronState();
    assert.equal(state.eventCount, 1, 'failed event claim rolls back');
    assert.equal(state.status, 'active', 'failed patron update rolls back');
    assert.ok(state.patronSince);

    const retry = await processStripeEvent(
      'evt_patron_canceled',
      'customer.subscription.deleted',
      (transaction) => applyPatronSubscription(patronInput('canceled'), transaction),
    );
    assert.equal(retry, true);

    state = await patronState();
    assert.equal(state.eventCount, 2);
    assert.equal(state.status, 'canceled');
    assert.equal(state.patronSince, null);
  });

  // A one-time payment carries the badge until its period end and then lapses
  // under the sweep, with nothing from Stripe to end it. The sweep must leave a
  // live recurring patron alone.
  test('a one-time payment lapses under the expiry sweep; a recurring patron does not', async () => {
    const now = new Date('2026-09-20T00:00:00.000Z');
    for (const id of ['once_user', 'monthly_user']) {
      await createUser({
        id,
        email: `${id}@example.com`,
        emailVerifiedAt: now,
        handle: id.replace('_', '-'),
        displayName: id,
        now,
      });
    }
    await applyPatronSubscription({
      accountId: 'once_user',
      stripeCustomerId: 'cus_once',
      stripeSubscriptionId: null,
      status: PATRON_ONE_TIME_STATUS,
      tier: 'once_10',
      currentPeriodEnd: new Date('2026-11-20T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      isLifetime: false,
    });
    await applyPatronSubscription({
      ...patronInput('active'),
      accountId: 'monthly_user',
      stripeSubscriptionId: 'sub_monthly_user',
      currentPeriodEnd: new Date('2026-10-20T00:00:00.000Z'),
    });
    assert.ok(await patronSince('once_user'), 'one-time grant sets the badge');
    assert.ok(await patronSince('monthly_user'));

    assert.equal(await expireLapsedPatrons(new Date('2026-11-19T23:59:59.000Z')), 0);
    assert.ok(await patronSince('once_user'), 'still inside the paid months');

    assert.equal(await expireLapsedPatrons(new Date('2026-11-20T00:00:01.000Z')), 1);
    assert.equal(await patronSince('once_user'), null, 'lapsed');
    // Stripe's period end is not ours to enforce: a recurring row stays until a
    // webhook says otherwise, however far past current_period_end the clock is.
    assert.ok(await patronSince('monthly_user'), 'recurring patron untouched');

    assert.equal(await expireLapsedPatrons(new Date('2027-01-01T00:00:00.000Z')), 0, 'idempotent');
  });
});

async function patronSince(accountId: string): Promise<Date | null> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ patron_since: Date | null }>(
      'SELECT patron_since FROM users WHERE id = $1',
      [accountId],
    );
    return rows[0]?.patron_since ?? null;
  } finally {
    await client.end();
  }
}

function patronInput(status: string): PatronSubscriptionInput {
  return {
    accountId: 'patron_user',
    stripeCustomerId: 'cus_patron',
    stripeSubscriptionId: 'sub_patron',
    status,
    tier: 'monthly_5',
    currentPeriodEnd: new Date('2026-08-12T00:00:00.000Z'),
    cancelAtPeriodEnd: status === 'canceled',
    isLifetime: false,
  };
}

async function patronState(): Promise<{
  eventCount: number;
  patronSince: Date | null;
  status: string | null;
}> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const events = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM stripe_events',
    );
    const subscriptions = await client.query<{ status: string }>(
      'SELECT status FROM patron_subscriptions WHERE stripe_subscription_id = $1',
      ['sub_patron'],
    );
    const users = await client.query<{ patron_since: Date | null }>(
      'SELECT patron_since FROM users WHERE id = $1',
      ['patron_user'],
    );
    return {
      eventCount: Number(events.rows[0]?.count ?? 0),
      patronSince: users.rows[0]?.patron_since ?? null,
      status: subscriptions.rows[0]?.status ?? null,
    };
  } finally {
    await client.end();
  }
}
