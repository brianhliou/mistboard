import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { setServerCaptureTransport } from '../analytics-server.js';
import { close, getPool, init } from '../persistence-db.js';
import type { TransactionalEmail } from '../send-email.js';

// Placeholder configuration before importing the senders; fetch is always mocked.
process.env.RESEND_API_KEY = 're_placeholder_for_tests';
process.env.MISTBOARD_AUTH_EMAIL_FROM = 'Mistboard <play@example.com>';
const { accountCodeEmail } = await import('../account-session.js');
const { tryHandle: authRoute } = await import('./auth.js');
const { tryHandle: accountRoute } = await import('./account.js');

let requestNumber = 0;

function harness(
  t: TestContext,
  storedLocale: string | null | undefined,
  options: {
    resolveMx?: typeof dns.resolveMx;
    expectedStatus?: number;
  } = {},
) {
  const sent: TransactionalEmail[] = [];
  const queries: string[] = [];
  t.mock.method(
    dns,
    'resolveMx',
    options.resolveMx ?? (async () => [{ exchange: 'mx.example.com', priority: 10 }]),
  );
  t.mock.method(dns, 'resolve4', async () => []);
  t.mock.method(dns, 'resolve6', async () => []);
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  t.mock.method(getPool(), 'connect', () => {
    assert.fail('these route tests must never connect to a database');
  });
  t.mock.method(getPool(), 'query', async (sql: string) => {
    queries.push(sql);
    if (sql.includes('UPDATE account_sessions')) {
      return {
        rows: [
          {
            id: 'u1',
            email: 'player@example.com',
            handle: 'player',
            display_name: 'player',
            locale: storedLocale,
            patron_since: null,
          },
        ],
      };
    }
    if (sql.includes('FROM users')) return { rows: [] };
    assert.match(sql.trim(), /^(INSERT|UPDATE|DELETE)\b/, 'unexpected database read');
    return { rows: [], rowCount: 1 };
  });
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, 'https://api.resend.com/emails');
    sent.push(JSON.parse(String(options?.body)) as TransactionalEmail);
    return new Response('{}', { status: 200 });
  });

  return async (pathname: string, body: Record<string, unknown>) => {
    const request = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
    request.method = 'POST';
    request.headers = { cookie: 'mistboard_session=session.token', 'accept-language': 'fr' };
    Object.defineProperty(request, 'socket', {
      value: { remoteAddress: `198.51.100.${++requestNumber}` },
    });
    let status = 0;
    let responseBody = '';
    const response = {
      writeHead(code: number) {
        status = code;
      },
      end(chunk: string) {
        responseBody += chunk;
      },
    } as unknown as ServerResponse;
    const route = pathname.startsWith('/api/auth/') ? authRoute : accountRoute;
    assert.equal(await route({}, request, response, pathname), true);
    assert.equal(status, options.expectedStatus ?? 202, responseBody);
    if (status === 400) {
      assert.deepEqual(JSON.parse(responseBody), { error: 'email_cannot_receive' });
      assert.equal(sent.length, 0, 'a domain without mail records must never reach the sender');
      assert.ok(!queries.some((sql) => /INSERT INTO email_login_challenges/.test(sql)));
      return sent[0]!;
    }
    assert.equal(JSON.parse(responseBody).delivery, 'email');
    assert.equal(sent.length, 1);
    return sent[0]!;
  };
}

test('login rejects a domain with no mail records before creating or sending a code', async (t) => {
  const events: unknown[] = [];
  process.env.MISTBOARD_POSTHOG_KEY = 'phc_test';
  process.env.MISTBOARD_POSTHOG_HOST = 'https://analytics.example';
  const previous = setServerCaptureTransport(async (_url, body) => {
    events.push(JSON.parse(body));
  });
  t.after(() => {
    setServerCaptureTransport(previous);
    delete process.env.MISTBOARD_POSTHOG_KEY;
    delete process.env.MISTBOARD_POSTHOG_HOST;
  });
  const call = harness(t, null, { resolveMx: async () => [], expectedStatus: 400 });
  await call('/api/auth/email/start', { email: 'player@no-mail.test' });
  assert.equal(events.length, 1);
  const event = events[0] as { event: string; properties: Record<string, unknown> };
  assert.equal(event.event, 'auth_email_domain_rejected');
  assert.deepEqual(event.properties, { $lib: 'mistboard-server', reason: 'no_mail_records' });
  assert.ok(!JSON.stringify(event).includes('player@no-mail.test'));
});

test('login sends when the domain resolver throws', async (t) => {
  const call = harness(t, null, {
    resolveMx: async () => {
      throw new Error('DNS unavailable');
    },
  });
  await call('/api/auth/email/start', { email: 'player@dns-error.test' });
});

test('login sends when the domain resolver times out', async (t) => {
  const call = harness(t, null, { resolveMx: () => new Promise(() => {}) });
  await call('/api/auth/email/start', { email: 'player@dns-timeout.test' });
});

for (const locale of ['en', 'zh-Hans', 'zh-Hant', undefined, null, 'fr', 'zh-hans', 42, {}]) {
  test(`login requests normalize ${JSON.stringify(locale)} without a stored account locale`, async (t) => {
    const call = harness(t, 'zh-Hant');
    const sent = await call('/api/auth/email/start', { email: 'new-player@example.com', locale });
    const expected = locale === 'zh-Hans' || locale === 'zh-Hant' ? locale : 'en';
    assert.deepEqual(sent.to, ['new-player@example.com']);
    assert.ok(sent.html?.includes(`<html lang="${expected}">`));
    assert.equal(sent.subject, accountCodeEmail('unused', 'login', expected).subject);
  });
}

for (const [purpose, path, recipient] of [
  ['email-change', '/api/account/email/start', 'new-player@example.com'],
  ['account-closure', '/api/account/closure/start', 'player@example.com'],
] as const) {
  for (const locale of ['en', 'zh-Hans', 'zh-Hant', null, undefined, 'fr']) {
    test(`${purpose} uses stored ${locale} locale over request hints`, async (t) => {
      const call = harness(t, locale);
      const sent = await call(path, {
        email: 'new-player@example.com',
        locale: locale === 'zh-Hans' ? 'zh-Hant' : 'zh-Hans',
      });
      const expected = locale === 'zh-Hans' || locale === 'zh-Hant' ? locale : 'en';
      assert.deepEqual(sent.to, [recipient]);
      assert.ok(sent.html?.includes(`<html lang="${expected}">`));
      assert.equal(sent.subject, accountCodeEmail('unused', purpose, expected).subject);
    });
  }
}
