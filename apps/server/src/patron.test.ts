// Patron program unit tests (078). Covers the pure webhook state-mapping (no
// DB), the tier/config contract, and the Stripe signature-verification the
// webhook route relies on. Atomic event storage is DB-bound and covered by
// persistence-patron.test.ts; the route-level exactly-once contract is covered
// here with an injected transaction callback.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe from 'stripe';
import {
  findPatronTier,
  loadPatronConfig,
  oneTimeMonthsForAmount,
  PATRON_TIERS,
} from './patron-config.js';
import type { PatronTransaction } from './persistence.js';
import { PATRON_ACTIVE_STATUSES, PATRON_ONE_TIME_STATUS } from './persistence-patron.js';
import {
  addMonths,
  oneTimeInputFromSession,
  processWebhookEvent,
  resolveAccountIdFromMetadata,
  subscriptionInputFromStripe,
} from './routes/patron.js';

function subscription(overrides: Record<string, unknown>): Stripe.Subscription {
  return {
    id: 'sub_123',
    customer: 'cus_123',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { tier: 'monthly_10' },
    items: { data: [{ current_period_end: 1_800_000_000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function session(overrides: Record<string, unknown>): Stripe.Checkout.Session {
  return {
    id: 'cs_123',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 2000,
    customer: 'cus_123',
    client_reference_id: 'acct_1',
    metadata: { tier: 'once_20', mistboard_account_id: 'acct_1' },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

// ── subscription mapping ─────────────────────────────────────────────────────
test('active subscription maps to an active, non-lifetime patron input', () => {
  const input = subscriptionInputFromStripe(subscription({}), 'acct_1', 'cus_123');
  assert.equal(input.accountId, 'acct_1');
  assert.equal(input.stripeSubscriptionId, 'sub_123');
  assert.equal(input.stripeCustomerId, 'cus_123');
  assert.equal(input.status, 'active');
  assert.equal(input.tier, 'monthly_10');
  assert.equal(input.isLifetime, false);
  assert.equal(input.cancelAtPeriodEnd, false);
  assert.equal(input.currentPeriodEnd?.getTime(), 1_800_000_000 * 1000);
});

test('subscription status passes straight through (past_due, canceled)', () => {
  for (const status of ['past_due', 'canceled', 'unpaid', 'incomplete']) {
    const input = subscriptionInputFromStripe(subscription({ status }), 'acct_1', 'cus_123');
    assert.equal(input.status, status);
    assert.equal(input.isLifetime, false);
  }
});

test('cancel_at_period_end and missing period end are handled', () => {
  const input = subscriptionInputFromStripe(
    subscription({ cancel_at_period_end: true, items: { data: [] } }),
    'acct_1',
    'cus_123',
  );
  assert.equal(input.cancelAtPeriodEnd, true);
  assert.equal(input.currentPeriodEnd, null);
});

test('subscription with no tier metadata yields a null tier, never a guess', () => {
  const input = subscriptionInputFromStripe(subscription({ metadata: {} }), 'acct_1', 'cus_123');
  assert.equal(input.tier, null);
});

// ── one-time mapping ─────────────────────────────────────────────────────────
const NOW = new Date('2026-09-20T10:00:00.000Z');

test("a paid payment-mode checkout grants the badge for the tier's months", () => {
  const input = oneTimeInputFromSession(session({}), 'acct_1', 'cus_123', NOW);
  assert.ok(input);
  assert.equal(input.isLifetime, false);
  assert.equal(input.status, PATRON_ONE_TIME_STATUS);
  assert.equal(input.stripeSubscriptionId, null);
  assert.equal(input.tier, 'once_20');
  // $20 one-time = four months, lichess's one month per $5.
  assert.equal(input.currentPeriodEnd?.toISOString(), '2027-01-20T10:00:00.000Z');
});

test('an unpaid payment-mode completion grants nothing (a delayed method pays later)', () => {
  assert.equal(
    oneTimeInputFromSession(session({ payment_status: 'unpaid' }), 'acct_1', 'cus_123', NOW),
    null,
  );
  assert.equal(
    oneTimeInputFromSession(
      session({ payment_status: 'no_payment_required' }),
      'acct_1',
      'cus_123',
      NOW,
    ),
    null,
  );
});

test('an unknown one-time tier key falls back to the amount paid, never to zero months', () => {
  const input = oneTimeInputFromSession(
    session({ metadata: { tier: 'lifetime' }, amount_total: 5000 }),
    'acct_1',
    'cus_123',
    NOW,
  );
  assert.ok(input);
  assert.equal(input.tier, 'lifetime');
  assert.equal(input.currentPeriodEnd?.toISOString(), '2027-07-20T10:00:00.000Z');
});

test('one-time months derive from the amount: one per $5, floor, never below one', () => {
  assert.equal(oneTimeMonthsForAmount(500), 1);
  assert.equal(oneTimeMonthsForAmount(2000), 4);
  assert.equal(oneTimeMonthsForAmount(2499), 4);
  assert.equal(oneTimeMonthsForAmount(100), 1);
  assert.equal(oneTimeMonthsForAmount(0), 1);
  assert.equal(oneTimeMonthsForAmount(null), 1);
});

test('addMonths clamps to the last day of the target month', () => {
  assert.equal(
    addMonths(new Date('2026-01-31T12:00:00.000Z'), 1).toISOString(),
    '2026-02-28T12:00:00.000Z',
  );
  assert.equal(
    addMonths(new Date('2026-10-31T00:00:00.000Z'), 4).toISOString(),
    '2027-02-28T00:00:00.000Z',
  );
  assert.equal(
    addMonths(new Date('2026-09-20T10:00:00.000Z'), 10).toISOString(),
    '2027-07-20T10:00:00.000Z',
  );
});

test('subscription-mode checkout completion is NOT a one-time row', () => {
  // The recurring row is written by the customer.subscription.* event instead.
  const input = oneTimeInputFromSession(session({ mode: 'subscription' }), 'acct_1', 'cus_123');
  assert.equal(input, null);
});

// ── account resolution ───────────────────────────────────────────────────────
test('account resolves from client_reference_id first, then metadata', () => {
  assert.equal(
    resolveAccountIdFromMetadata('acct_ref', { mistboard_account_id: 'acct_meta' }),
    'acct_ref',
  );
  assert.equal(
    resolveAccountIdFromMetadata(null, { mistboard_account_id: 'acct_meta' }),
    'acct_meta',
  );
  assert.equal(resolveAccountIdFromMetadata(null, {}), null);
  assert.equal(resolveAccountIdFromMetadata(undefined, undefined), null);
});

// ── entitlement statuses ─────────────────────────────────────────────────────
test('only active + trialing count as active patron statuses', () => {
  assert.deepEqual([...PATRON_ACTIVE_STATUSES].sort(), ['active', 'trialing']);
  for (const dead of ['past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']) {
    assert.equal(PATRON_ACTIVE_STATUSES.includes(dead), false);
  }
});

// ── tier catalog / config ────────────────────────────────────────────────────
test('tier catalog: valid keys resolve, unknown keys reject', () => {
  assert.equal(findPatronTier('monthly_10')?.mode, 'subscription');
  assert.equal(findPatronTier('monthly_10')?.months, null);
  assert.equal(findPatronTier('once_10')?.mode, 'payment');
  assert.equal(findPatronTier('once_10')?.months, 2);
  assert.equal(findPatronTier('lifetime'), null);
  assert.equal(findPatronTier('monthly_999'), null);
  assert.equal(findPatronTier(''), null);
  // The same amount ladder under both frequencies: every monthly amount has a
  // one-time twin, so the page can swap frequency without changing the amounts.
  const amounts = (mode: string) =>
    PATRON_TIERS.filter((t) => t.mode === mode).map((t) => t.key.split('_')[1]);
  assert.deepEqual(amounts('subscription'), ['5', '10', '20', '50']);
  assert.deepEqual(amounts('payment'), ['5', '10', '20', '50']);
  // One-time badge months follow the amount, one month per $5.
  for (const tier of PATRON_TIERS.filter((t) => t.mode === 'payment')) {
    assert.equal(tier.months, Number(tier.key.split('_')[1]) / 5);
  }
});

test('config is null without both Stripe secrets (fail closed)', () => {
  assert.equal(loadPatronConfig({}), null);
  assert.equal(loadPatronConfig({ STRIPE_SECRET_KEY: 'sk_test_x' }), null);
  assert.equal(loadPatronConfig({ STRIPE_WEBHOOK_SECRET: 'whsec_x' }), null);
});

test('config builds a price map only for tiers whose price env var is set', () => {
  const config = loadPatronConfig({
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_MONTHLY_10: 'price_10',
    STRIPE_PRICE_ONCE_10: 'price_once_10',
  });
  assert.ok(config);
  assert.equal(config.priceByTier.get('monthly_10'), 'price_10');
  assert.equal(config.priceByTier.get('once_10'), 'price_once_10');
  // monthly_5 has no env var set -> not offered.
  assert.equal(config.priceByTier.has('monthly_5'), false);
});

// ── signature verification (the exact mechanism the webhook route uses) ──────
test('constructEvent accepts a valid signature and rejects a tampered one', () => {
  const stripe = new Stripe('sk_test_x', { telemetry: false });
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const secret = 'whsec_test_secret';
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

  const event = stripe.webhooks.constructEvent(payload, header, secret);
  assert.equal(event.id, 'evt_1');

  assert.throws(() => stripe.webhooks.constructEvent(payload, 'bad-signature', secret));
  // A payload that doesn't match the signed digest is also rejected.
  assert.throws(() => stripe.webhooks.constructEvent(`${payload} `, header, secret));
});

test('webhook processing applies a fresh event exactly once inside its transaction', async () => {
  const event = { id: 'evt_once', type: 'customer.subscription.updated' } as Stripe.Event;
  const transaction = {} as PatronTransaction;
  let applications = 0;

  const fresh = await processWebhookEvent(
    event,
    async (eventId, eventType, apply) => {
      assert.equal(eventId, event.id);
      assert.equal(eventType, event.type);
      await apply(transaction);
      return true;
    },
    async (receivedEvent, receivedTransaction) => {
      applications += 1;
      assert.equal(receivedEvent, event);
      assert.equal(receivedTransaction, transaction);
    },
  );

  assert.equal(fresh, true);
  assert.equal(applications, 1);
});

test('duplicate webhook processing does not apply the event again', async () => {
  const event = { id: 'evt_duplicate', type: 'customer.subscription.updated' } as Stripe.Event;
  let applications = 0;

  const fresh = await processWebhookEvent(
    event,
    async () => false,
    async () => {
      applications += 1;
    },
  );

  assert.equal(fresh, false);
  assert.equal(applications, 0);
});
