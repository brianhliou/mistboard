import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { maxHandleLength, normalizeProfileHandle } from './account-identity.js';

process.env.RESEND_API_KEY = 're_placeholder_for_tests';
process.env.MISTBOARD_AUTH_EMAIL_FROM = 'Mistboard <play@example.com>';

const {
  accountSessionCookie,
  accountSessionsFromRequest,
  expiredAccountSessionCookie,
  handleCollisionAttempt,
  legacyHostOnlyAccountSessionEviction,
  sendEmailLoginCode,
  sendEmailChangeCode,
  sendAccountClosureCode,
} = await import('./account-session.js');

function requestWithCookie(cookie: string | undefined): IncomingMessage {
  return { headers: cookie === undefined ? {} : { cookie } } as unknown as IncomingMessage;
}

function withCookieDomain<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.MISTBOARD_COOKIE_DOMAIN;
  if (value === undefined) delete process.env.MISTBOARD_COOKIE_DOMAIN;
  else process.env.MISTBOARD_COOKIE_DOMAIN = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MISTBOARD_COOKIE_DOMAIN;
    else process.env.MISTBOARD_COOKIE_DOMAIN = prev;
  }
}

test('handleCollisionAttempt keeps signup retry handles within the public handle cap', () => {
  const baseHandle = 'a'.repeat(maxHandleLength);

  for (let i = 0; i < 20; i += 1) {
    const handle = handleCollisionAttempt(baseHandle);
    assert.equal(handle.length, maxHandleLength);
    assert.equal(normalizeProfileHandle(handle), handle);
    assert.match(handle, /^a+-\d{5}$/);
  }
});

test('handleCollisionAttempt separates the suffix from a short base with a hyphen', () => {
  for (let i = 0; i < 20; i += 1) {
    assert.match(handleCollisionAttempt('brian'), /^brian-\d{5}$/);
  }
});

test('session cookie scopes to Domain when MISTBOARD_COOKIE_DOMAIN is set (cross-subdomain WS auth)', () => {
  const cookie = withCookieDomain('mistboard.com', () =>
    accountSessionCookie('sid', 'tok', new Date(Date.now() + 60_000)),
  );
  assert.match(cookie, /(^|; )Domain=mistboard\.com(;|$)/);
  // Existing hardening attributes must survive the Domain addition.
  assert.match(cookie, /(^|; )HttpOnly(;|$)/);
  assert.match(cookie, /(^|; )SameSite=Lax(;|$)/);
  assert.match(cookie, /(^|; )Path=\/(;|$)/);
});

test('session cookie stays host-only (no Domain) when MISTBOARD_COOKIE_DOMAIN is unset', () => {
  const cookie = withCookieDomain(undefined, () =>
    accountSessionCookie('sid', 'tok', new Date(Date.now() + 60_000)),
  );
  assert.doesNotMatch(cookie, /Domain=/);
});

test('blank MISTBOARD_COOKIE_DOMAIN is treated as unset (no Domain attribute)', () => {
  const cookie = withCookieDomain('   ', () =>
    accountSessionCookie('sid', 'tok', new Date(Date.now() + 60_000)),
  );
  assert.doesNotMatch(cookie, /Domain=/);
});

test('logout cookie clears across the same Domain scope so the subdomain session is cleared too', () => {
  const cookie = withCookieDomain('mistboard.com', () => expiredAccountSessionCookie());
  assert.match(cookie, /(^|; )Domain=mistboard\.com(;|$)/);
  assert.match(cookie, /(^|; )Max-Age=0(;|$)/);
});

test('accountSessionsFromRequest returns every mistboard_session candidate in header order', () => {
  // A legacy host-only cookie and the newer Domain-scoped cookie share a name;
  // the browser sends both. We must surface both so the live one is not shadowed
  // by a stale first match.
  const sessions = accountSessionsFromRequest(
    requestWithCookie('mistboard_session=sidA.tokA; other=x; mistboard_session=sidB.tokB'),
  );
  assert.deepEqual(sessions, [
    { sessionId: 'sidA', token: 'tokA' },
    { sessionId: 'sidB', token: 'tokB' },
  ]);
});

test('accountSessionsFromRequest skips malformed candidates but keeps valid ones', () => {
  const sessions = accountSessionsFromRequest(
    requestWithCookie('mistboard_session=no-dot; mistboard_session=sid.tok'),
  );
  assert.deepEqual(sessions, [{ sessionId: 'sid', token: 'tok' }]);
});

test('accountSessionsFromRequest returns nothing when no cookie header is present', () => {
  assert.deepEqual(accountSessionsFromRequest(requestWithCookie(undefined)), []);
});

test('legacy host-only eviction targets the no-Domain duplicate when a Domain is configured', () => {
  const cookie = withCookieDomain('mistboard.com', () => legacyHostOnlyAccountSessionEviction());
  assert.ok(cookie !== null);
  assert.match(cookie, /^mistboard_session=;/);
  assert.match(cookie, /(^|; )Max-Age=0(;|$)/);
  assert.match(cookie, /(^|; )Path=\/(;|$)/);
  assert.match(cookie, /(^|; )HttpOnly(;|$)/);
  // Host-only: it must NOT carry a Domain, or it would target the wrong entry.
  assert.doesNotMatch(cookie, /Domain=/);
});

test('legacy host-only eviction is a no-op when no Domain is configured', () => {
  const cookie = withCookieDomain(undefined, () => legacyHostOnlyAccountSessionEviction());
  assert.equal(cookie, null);
});

test('account code senders preserve Resend IDs for each purpose without conflating templates', async (t) => {
  const subjects: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    subjects.push(JSON.parse(String(init?.body)).subject);
    return Response.json({ id: `provider-${subjects.length}` });
  });
  for (const [index, send] of [
    sendEmailLoginCode,
    sendEmailChangeCode,
    sendAccountClosureCode,
  ].entries()) {
    assert.deepEqual(await send('player@example.com', '12345678'), {
      ok: true,
      providerEmailId: `provider-${index + 1}`,
    });
  }
  assert.equal(new Set(subjects).size, 3);
});

test('login code sender propagates failure without a provider ID', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ id: 'rejected' }, { status: 503 }),
  );
  assert.deepEqual(await sendEmailLoginCode('player@example.com', '12345678'), { ok: false });
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network_failure');
  });
  assert.deepEqual(await sendEmailLoginCode('player@example.com', '12345678'), { ok: false });
});
