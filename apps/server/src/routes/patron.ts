// Patron program HTTP routes (078): donation checkout, billing portal, and the
// Stripe webhook. Stripe is the source of truth — patron status is NEVER granted
// from a client request; only the signature-verified webhook writes it.
//
//   POST /api/patron/checkout  (auth) -> hosted Stripe Checkout url
//   POST /api/patron/portal    (auth) -> hosted Stripe billing-portal url
//   POST /api/webhooks/stripe         -> raw-body, signature-verified, idempotent
//
// The whole surface fails closed when the program is unconfigured
// (isPatronConfigured() === false): 503 patron_unconfigured. That lets the
// feature ship dark on main and switch on by setting Railway env.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type Stripe from 'stripe';
import { currentAccountUser } from './../account-session.js';
import { createAuthRateLimiter } from './../auth-rate-limit.js';
import {
  findPatronTier,
  isPatronConfigured,
  oneTimeMonthsForAmount,
  PATRON_TIERS,
  patronConfig,
} from './../patron-config.js';
import * as persistence from './../persistence.js';
import { PATRON_ONE_TIME_STATUS } from './../persistence-patron.js';
import { getStripeClient } from './../stripe-client.js';
import { requireMethod, requirePersistence, writeJson } from './lib.js';

const MAX_WEBHOOK_BODY_BYTES = 1_048_576; // 1 MiB; Stripe events are well under this.
const patronCheckoutLimiter = createAuthRateLimiter(10, 60 * 60 * 1000);
const patronPortalLimiter = createAuthRateLimiter(30, 60 * 60 * 1000);

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/patron/config') {
    handleConfig(request, response);
    return true;
  }
  if (pathname === '/api/patron/status') {
    await handleStatus(request, response);
    return true;
  }
  if (pathname === '/api/patron/checkout') {
    await handleCheckout(request, response);
    return true;
  }
  if (pathname === '/api/patron/portal') {
    await handlePortal(request, response);
    return true;
  }
  if (pathname === '/api/webhooks/stripe') {
    await handleWebhook(request, response);
    return true;
  }
  return false;
}

// ── Config (public) ───────────────────────────────────────────────────────────
// Lets the donate page render the right state without a failed checkout: whether
// the program is live and which tiers actually have a price configured. No
// secrets are exposed — only tier keys the client already knows.
function handleConfig(request: IncomingMessage, response: ServerResponse): void {
  if (!requireMethod(request, response, 'GET')) return;
  const config = patronConfig();
  const availableTiers = PATRON_TIERS.filter(
    (tier) => config?.priceByTier.has(tier.key) ?? false,
  ).map((tier) => ({ key: tier.key, mode: tier.mode }));
  writeJson(response, 200, {
    configured: config !== null && availableTiers.length > 0,
    tiers: availableTiers,
  });
}

// ── Status (auth) ─────────────────────────────────────────────────────────────
// What the signed-in account's badge rests on, so the page can offer the right
// thing: the billing portal only when there is a subscription to manage, and
// the end date when the badge comes from a one-time payment. Read-only; the
// badge itself still comes from the session (isPatron), never from here.
async function handleStatus(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!requireMethod(request, response, 'GET')) return;
  if (!requirePersistence(response)) return;
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return;
  }
  const standing = await persistence.getPatronStanding(user.id);
  writeJson(response, 200, {
    active: standing.active,
    subscription: standing.subscription,
    until: standing.until?.toISOString() ?? null,
  });
}

// ── Checkout ────────────────────────────────────────────────────────────────
async function handleCheckout(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!requireMethod(request, response, 'POST')) return;
  if (!requirePersistence(response)) return;
  const config = patronConfig();
  if (!config) {
    writeJson(response, 503, { error: 'patron_unconfigured' });
    return;
  }
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return;
  }
  if (!patronCheckoutLimiter.check(user.id)) {
    writeJson(response, 429, { error: 'rate_limited' });
    return;
  }

  const body = await readJsonBodyLocal(request);
  const tierKey = typeof body.tier === 'string' ? body.tier : '';
  const tier = findPatronTier(tierKey);
  if (!tier) {
    writeJson(response, 400, { error: 'invalid_tier' });
    return;
  }
  const priceId = config.priceByTier.get(tier.key);
  if (!priceId) {
    // Configured overall but this tier's price env var is unset.
    writeJson(response, 400, { error: 'tier_unavailable' });
    return;
  }

  const stripe = getStripeClient();

  // Reuse the account's Stripe customer if we have one; otherwise create it and
  // persist the mapping so future checkouts and the portal find it.
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { mistboard_account_id: user.id },
    });
    customerId = customer.id;
    await persistence.setStripeCustomerId(user.id, customerId);
  }

  const metadata = { mistboard_account_id: user.id, tier: tier.key };
  const session = await stripe.checkout.sessions.create({
    mode: tier.mode,
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${config.publicHost}/patron?status=thanks`,
    cancel_url: `${config.publicHost}/patron`,
    metadata,
    // Stamp the same metadata on the subscription / payment so the webhook can
    // resolve account + tier without a DB lookup.
    ...(tier.mode === 'subscription'
      ? { subscription_data: { metadata } }
      : { payment_intent_data: { metadata } }),
  });

  if (!session.url) {
    writeJson(response, 502, { error: 'checkout_failed' });
    return;
  }
  writeJson(response, 200, { url: session.url });
}

// ── Billing portal ────────────────────────────────────────────────────────────
async function handlePortal(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!requireMethod(request, response, 'POST')) return;
  if (!requirePersistence(response)) return;
  const config = patronConfig();
  if (!config) {
    writeJson(response, 503, { error: 'patron_unconfigured' });
    return;
  }
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return;
  }
  if (!patronPortalLimiter.check(user.id)) {
    writeJson(response, 429, { error: 'rate_limited' });
    return;
  }
  const customerId = user.stripeCustomerId ?? (await persistence.getStripeCustomerId(user.id));
  if (!customerId) {
    writeJson(response, 400, { error: 'no_subscription' });
    return;
  }
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${config.publicHost}/account`,
  });
  writeJson(response, 200, { url: session.url });
}

// ── Webhook ────────────────────────────────────────────────────────────────
async function handleWebhook(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!requireMethod(request, response, 'POST')) return;
  const config = patronConfig();
  if (!config) {
    writeJson(response, 503, { error: 'patron_unconfigured' });
    return;
  }
  if (!persistence.isInitialized()) {
    // 503 (not 200) so Stripe retries once persistence is back.
    writeJson(response, 503, { error: 'persistence_disabled' });
    return;
  }

  let raw: Buffer;
  try {
    raw = await readRawBody(request);
  } catch {
    writeJson(response, 413, { error: 'request_body_too_large' });
    return;
  }
  const signature = headerValue(request, 'stripe-signature');
  if (!signature) {
    writeJson(response, 400, { error: 'missing_signature' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(raw, signature, config.webhookSecret);
  } catch {
    // Bad signature / malformed payload: reject, write nothing.
    writeJson(response, 400, { error: 'invalid_signature' });
    return;
  }

  // Idempotency and state application are one transaction. A processing error
  // rolls back the event claim so Stripe can retry it safely.
  const fresh = await processWebhookEvent(event);
  if (!fresh) {
    writeJson(response, 200, { received: true, duplicate: true });
    return;
  }

  writeJson(response, 200, { received: true });
}

type ProcessStripeEvent = (
  eventId: string,
  eventType: string,
  apply: (transaction: persistence.PatronTransaction) => Promise<void>,
) => Promise<boolean>;

// Claim and apply exactly once, in the same transaction. The injected seams
// keep the route contract unit-testable without Stripe or Postgres.
export async function processWebhookEvent(
  event: Stripe.Event,
  processEvent: ProcessStripeEvent = persistence.processStripeEvent,
  apply: (
    event: Stripe.Event,
    transaction?: persistence.PatronTransaction,
  ) => Promise<void> = applyEvent,
): Promise<boolean> {
  return processEvent(event.id, event.type, (transaction) => apply(event, transaction));
}

// Route a Stripe event to persistence. Account resolution + the customer-map
// side effect live here (DB-bound); the input-building below is kept pure so the
// state machine is unit-testable without a database. Unknown event types are
// acked and ignored (fail-closed: no state change).
export async function applyEvent(
  event: Stripe.Event,
  transaction?: persistence.PatronTransaction,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = idOf(session.customer);
      const accountId = await resolveAccount(
        customerId,
        session.client_reference_id,
        session.metadata,
        transaction,
      );
      if (!accountId) {
        logUnresolved(event.type, customerId);
        return;
      }
      // Persist the account -> customer map for both modes so the portal + future
      // checkouts find it, even when the recurring row is written by a later
      // customer.subscription.* event.
      if (customerId) {
        await persistence.setStripeCustomerId(accountId, customerId, transaction);
      }
      const input = oneTimeInputFromSession(session, accountId, customerId);
      if (input) await persistence.applyPatronSubscription(input, transaction);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = idOf(sub.customer);
      const accountId = await resolveAccount(customerId, null, sub.metadata, transaction);
      if (!accountId) {
        logUnresolved('customer.subscription.*', customerId);
        return;
      }
      await persistence.applyPatronSubscription(
        subscriptionInputFromStripe(sub, accountId, customerId),
        transaction,
      );
      return;
    }
    default:
      // Ignored on purpose. Adding a handled type means adding a case above.
      return;
  }
}

// A completed Checkout in `payment` mode is a one-time payment: it carries the
// badge for a fixed number of months from now (the tier's, or derived from the
// amount when the tier key is unknown), then lapses under the expiry sweep.
// Only a session Stripe reports as PAID grants anything: Alipay, WeChat Pay and
// cards confirm synchronously, so `checkout.session.completed` already says
// `paid`; a delayed method completes `unpaid` and pays later through
// `checkout.session.async_payment_succeeded`, which lands here too (Stripe sends
// it only for a session that completed unpaid, so one session grants once).
// `subscription` mode completions are handled by the customer.subscription.*
// events, so this returns null for them (the customer map is persisted by the
// caller regardless). Pure: no DB, no I/O.
export function oneTimeInputFromSession(
  session: Stripe.Checkout.Session,
  accountId: string,
  customerId: string | null,
  now: Date = new Date(),
): persistence.PatronSubscriptionInput | null {
  if (session.mode !== 'payment') return null;
  if (session.payment_status !== 'paid') return null;
  const tierKey = session.metadata?.tier ?? null;
  const tier = tierKey ? findPatronTier(tierKey) : null;
  const months = tier?.months ?? oneTimeMonthsForAmount(session.amount_total);
  return {
    accountId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    status: PATRON_ONE_TIME_STATUS,
    tier: tierKey,
    currentPeriodEnd: addMonths(now, months),
    cancelAtPeriodEnd: false,
    isLifetime: false,
  };
}

// Calendar months, UTC, clamped to the last day of the target month so a
// payment on the 31st never spills into the month after.
export function addMonths(from: Date, months: number): Date {
  const target = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth() + months,
      1,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return target;
}

// Map a Stripe subscription object to our upsert input. Pure: no DB, no I/O —
// unit-tested directly. Account is resolved by the caller.
export function subscriptionInputFromStripe(
  sub: Stripe.Subscription,
  accountId: string,
  customerId: string | null,
): persistence.PatronSubscriptionInput {
  return {
    accountId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    tier: sub.metadata?.tier ?? null,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    isLifetime: false,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
// Resolve the mistboard account behind an event: prefer the id we stamped in
// client_reference_id / metadata at checkout; fall back to the stored customer
// map. Exported (the metadata half) for tests via resolveAccountIdFromMetadata.
export function resolveAccountIdFromMetadata(
  clientReferenceId: string | null | undefined,
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  return clientReferenceId || metadata?.mistboard_account_id || null;
}

async function resolveAccount(
  customerId: string | null,
  clientReferenceId: string | null | undefined,
  metadata: Stripe.Metadata | null | undefined,
  transaction?: persistence.PatronTransaction,
): Promise<string | null> {
  const direct = resolveAccountIdFromMetadata(clientReferenceId, metadata);
  if (direct) return direct;
  if (customerId) {
    return persistence.findAccountIdByStripeCustomerId(customerId, transaction);
  }
  return null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function unixToDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

// The current billing period moved from the subscription to its items in recent
// Stripe API versions. For our single-price patron subscription, the first
// item's period end is the renewal date.
function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  return unixToDate(sub.items?.data?.[0]?.current_period_end);
}

function logUnresolved(eventType: string, customerId: string | null): void {
  console.error(
    `[patron] webhook ${eventType} could not resolve an account (customer=${customerId ?? 'none'})`,
  );
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_WEBHOOK_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBodyLocal(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(request);
  if (raw.byteLength === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf-8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Re-exported so the guard is visible to callers/tests alongside the routes.
export { isPatronConfigured };
