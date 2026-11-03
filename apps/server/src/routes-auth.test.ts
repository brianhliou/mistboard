import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setServerCaptureTransport } from './analytics-server.js';
import { getPool } from './persistence-db.js';

// Run the same real routes in isolated module graphs for dev and provider mode.
// All email uses a placeholder key and a stubbed fetch, never the network.
const providerMode = process.env.MISTBOARD_TEST_LOGIN_MAIL_MODE === 'provider';
process.env.RESEND_API_KEY = providerMode ? 're_placeholder_for_tests' : '';
process.env.MISTBOARD_AUTH_EMAIL_FROM = 'Mistboard <play@example.com>';
process.env.MISTBOARD_DEV_AUTH_CODES = 'true';
const {
  closeUserAccount,
  consumeEmailLoginChallenge,
  createEmailLoginChallenge,
  findUserByEmail,
  getEmailDeliveryAddress,
  getLoginEmailRequest,
  recordEmailDeliveryEvent,
  recordLoginEmailRequest,
} = await import('./persistence.js');
const { definePersistenceTests, test } = await import('./persistence-test-support.js');
const { hashSecret, ensureUserForEmail, sendEmailChangeCode } = await import(
  './account-session.js'
);
const { authCounters } = await import('./obs.js');
const { tryHandle } = await import('./routes/auth.js');
let providerSend = 0;
if (providerMode) {
  globalThis.fetch = async () => Response.json({ id: `provider-route-${++providerSend}` });
}

type ResponseCapture = {
  body: string;
  headers: Record<string, string | string[]>;
  status: number | null;
};

definePersistenceTests('auth routes', () => {
  test('email auth returns delivery timing and creates a session after confirmation', async () => {
    const sentBefore = authCounters.totalCodesSent;
    const startResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'route-login@example.com' }, '198.51.100.10'),
      startResponse,
      '/api/auth/email/start',
    );

    assert.equal(startResponse.status, 202);
    const started = JSON.parse(startResponse.body) as {
      devCode: string;
      email: string;
      expiresAt: string;
      loginId: string;
      resendAvailableAt: string;
    };
    assert.equal(started.email, 'route-login@example.com');
    assert.match(started.devCode, /^\d{8}$/);
    assert.ok(new Date(started.expiresAt) > new Date(started.resendAvailableAt));

    const ledger = await getLoginEmailRequest(started.loginId);
    assert.ok(ledger);
    assert.equal(ledger.email, started.email);
    assert.equal(ledger.completedAt, null);
    assert.equal(!!ledger.providerEmailId, providerMode);
    assert.equal(authCounters.totalCodesSent - sentBefore, providerMode ? 1 : 0);
    // API acceptance and dev-code responses create no delivery webhook evidence.
    assert.equal(await getEmailDeliveryAddress(started.email), null);

    const confirmResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ code: started.devCode, loginId: started.loginId }, '198.51.100.10'),
      confirmResponse,
      '/api/auth/email/confirm',
    );

    assert.equal(confirmResponse.status, 200);
    const completed = await getLoginEmailRequest(started.loginId);
    assert.ok(completed?.completedAt instanceof Date);
    const replayResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ code: started.devCode, loginId: started.loginId }, '198.51.100.10'),
      replayResponse,
      '/api/auth/email/confirm',
    );
    assert.equal(replayResponse.status, 400);
    assert.deepEqual(await getLoginEmailRequest(started.loginId), completed);
    await getPool().query('DELETE FROM email_login_challenges WHERE id = $1', [started.loginId]);
    assert.deepEqual(await getLoginEmailRequest(started.loginId), completed);
    assert.ok(confirmResponse.headers['set-cookie']);
    assert.equal((JSON.parse(confirmResponse.body) as { isNewUser: boolean }).isNewUser, true);
    assert.equal(
      (await findUserByEmail('route-login@example.com'))?.emailVerifiedAt instanceof Date,
      true,
    );
  });

  test('email auth applies a durable resend cooldown per normalized email', async () => {
    const first = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'cooldown@example.com' }, '198.51.100.11'),
      first,
      '/api/auth/email/start',
    );
    assert.equal(first.status, 202);

    const second = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'COOLDOWN@example.com' }, '198.51.100.11'),
      second,
      '/api/auth/email/start',
    );
    assert.equal(second.status, 429);
    assert.deepEqual(JSON.parse(second.body), { error: 'rate_limited' });
    assert.equal(
      (await getPool().query('SELECT request_id FROM login_email_requests')).rowCount,
      1,
    );
  });

  test('a successfully issued code supersedes a previous live challenge', async () => {
    const now = new Date();
    const oldHash = hashSecret('12345678');
    await createEmailLoginChallenge({
      id: 'route-old-code',
      email: 'supersede-route@example.com',
      codeHash: oldHash,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    await recordLoginEmailRequest({
      requestId: 'route-old-code',
      email: 'supersede-route@example.com',
      requestedAt: now,
    });
    const response = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'supersede-route@example.com' }, '198.51.100.12'),
      response,
      '/api/auth/email/start',
    );

    assert.equal(response.status, 202);
    assert.equal(await consumeEmailLoginChallenge('route-old-code', oldHash, new Date()), null);
    assert.equal((await getLoginEmailRequest('route-old-code'))?.completedAt, null);
    assert.ok(await getLoginEmailRequest(JSON.parse(response.body).loginId));
  });

  test('signup_completed geolocates the visitor from cf-connecting-ip, not the Cloudflare edge', async () => {
    const sent = await signupCaptureIp('cf-geo@example.com', {
      // Railway appends the Cloudflare edge it saw; the visitor is only in
      // the header Cloudflare sets.
      'x-forwarded-for': '203.0.113.50, 172.70.100.1',
      'cf-connecting-ip': '36.112.5.9',
    });
    assert.equal(sent, '36.112.5.9');
  });

  test('signup_completed keeps the trusted forwarded hop without cf-connecting-ip', async () => {
    const sent = await signupCaptureIp('no-cf-geo@example.com', {
      'x-forwarded-for': '203.0.113.50, 198.51.100.77',
    });
    assert.equal(sent, '198.51.100.77');
  });

  test('invalid requests and rejected confirmations never create completions', async () => {
    const invalid = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'invalid' }, '198.51.100.20'),
      invalid,
      '/api/auth/email/start',
    );
    assert.equal(invalid.status, 400);
    assert.equal(
      (await getPool().query('SELECT request_id FROM login_email_requests')).rowCount,
      0,
    );
    const start = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'reject@example.com' }, '198.51.100.20'),
      start,
      '/api/auth/email/start',
    );
    const { loginId, devCode } = JSON.parse(start.body);
    const wrong = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ loginId, code: `${devCode}0` }, '198.51.100.20'),
      wrong,
      '/api/auth/email/confirm',
    );
    assert.equal(wrong.status, 400);
    assert.equal((await getLoginEmailRequest(loginId))?.completedAt, null);
    await getPool().query(
      "UPDATE email_login_challenges SET expires_at = now() - interval '1 second' WHERE id = $1",
      [loginId],
    );
    const expired = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ loginId, code: devCode }, '198.51.100.20'),
      expired,
      '/api/auth/email/confirm',
    );
    assert.equal(expired.status, 400);
    assert.equal((await getLoginEmailRequest(loginId))?.completedAt, null);
  });

  test('a correct code for a closed account is not a completed sign-in', async () => {
    const email = 'closed-login@example.com';
    const account = await ensureUserForEmail(email, new Date());
    assert.ok(!('closed' in account));
    assert.deepEqual(
      await closeUserAccount(
        account.user.id,
        {
          closedEmailHash: hashSecret(email),
          closedHandle: 'closed-login',
          placeholderEmail: 'closed-placeholder@example.com',
        },
        new Date(),
      ),
      { ok: true },
    );
    const start = captureResponse();
    await tryHandle({}, jsonRequest({ email }, '198.51.100.21'), start, '/api/auth/email/start');
    const { loginId, devCode } = JSON.parse(start.body);
    const confirm = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ loginId, code: devCode }, '198.51.100.21'),
      confirm,
      '/api/auth/email/confirm',
    );
    assert.equal(confirm.status, 403);
    assert.equal((await getLoginEmailRequest(loginId))?.completedAt, null);
    assert.equal((await getPool().query('SELECT id FROM account_sessions')).rowCount, 0);
  });

  test('session creation must succeed before a consumed challenge counts as a completed sign-in', async () => {
    const email = 'session-failure@example.com';
    const requestId = 'session-failure';
    const now = new Date();
    await recordLoginEmailRequest({ requestId, email, requestedAt: now });
    await createEmailLoginChallenge({
      id: requestId,
      email,
      codeHash: hashSecret('12345678'),
      expiresAt: new Date(now.getTime() + 60000),
    });
    await getPool().query(
      "ALTER TABLE account_sessions ADD CONSTRAINT login_completion_test_failure CHECK (user_agent IS DISTINCT FROM 'reject-test-session')",
    );
    try {
      await assert.rejects(
        tryHandle(
          {},
          jsonRequest({ loginId: requestId, code: '12345678' }, '198.51.100.22', {
            'user-agent': 'reject-test-session',
          }),
          captureResponse(),
          '/api/auth/email/confirm',
        ),
        /login_completion_test_failure/,
      );
      assert.equal((await getLoginEmailRequest(requestId))?.completedAt, null);
    } finally {
      await getPool().query(
        'ALTER TABLE account_sessions DROP CONSTRAINT login_completion_test_failure',
      );
    }
  });

  if (providerMode) {
    test('provider rejection or network failure retains the request after deleting its challenge', async (t) => {
      t.mock.method(console, 'error', () => {});
      for (const [index, reply] of [
        async () => Response.json({ id: 'rejected' }, { status: 503 }),
        async () => {
          throw new Error('network_failure');
        },
      ].entries()) {
        t.mock.method(globalThis, 'fetch', reply);
        const email = `failed-${index}@example.com`;
        const oldId = `previous-${index}`;
        await createEmailLoginChallenge({
          id: oldId,
          email,
          codeHash: hashSecret('12345678'),
          expiresAt: new Date(Date.now() + 60000),
        });
        const response = captureResponse();
        const before = authCounters.totalCodesSent;
        await tryHandle(
          {},
          jsonRequest({ email }, `198.51.100.${30 + index}`),
          response,
          '/api/auth/email/start',
        );
        assert.equal(response.status, 502);
        const { rows } = await getPool().query(
          'SELECT request_id FROM login_email_requests WHERE email = $1',
          [email],
        );
        assert.equal(rows.length, 1);
        const requestId = rows[0].request_id as string;
        const ledger = await getLoginEmailRequest(requestId);
        assert.ok(ledger);
        assert.equal(ledger.providerEmailId, null);
        assert.equal(ledger.completedAt, null);
        assert.equal(
          (
            await getPool().query('SELECT id FROM email_login_challenges WHERE id = $1', [
              requestId,
            ])
          ).rowCount,
          0,
        );
        assert.equal(authCounters.totalCodesSent, before);
        assert.equal(await getEmailDeliveryAddress(email), null);
        // A failed resend must leave the earlier valid challenge usable.
        assert.ok(await consumeEmailLoginChallenge(oldId, hashSecret('12345678'), new Date()));
      }
    });

    test('provider events correlate before and after acceptance, excluding unrelated mail to the same address', async (t) => {
      const email = 'correlate-route@example.com';
      t.mock.method(globalThis, 'fetch', async () => {
        const pending = await getPool().query(
          'SELECT request_id, provider_email_id FROM login_email_requests WHERE email = $1',
          [email],
        );
        assert.equal(pending.rowCount, 1);
        assert.equal(pending.rows[0].provider_email_id, null);
        await recordEmailDeliveryEvent({
          eventId: 'early-login',
          providerEmailId: 'accepted-login',
          type: 'email.sent',
          recipients: [email],
          occurredAt: new Date(),
          bounce: null,
          failureReason: null,
        });
        return Response.json({ id: 'accepted-login' });
      });
      const start = captureResponse();
      await tryHandle({}, jsonRequest({ email }, '198.51.100.40'), start, '/api/auth/email/start');
      assert.equal(start.status, 202);
      const { loginId } = JSON.parse(start.body);
      assert.equal((await getLoginEmailRequest(loginId))?.providerEmailId, 'accepted-login');
      assert.equal((await getEmailDeliveryAddress(email))?.lastDeliveredAt, null);
      t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'unrelated-change' }));
      assert.equal((await sendEmailChangeCode(email, '12345678')).ok, true);
      for (const [eventId, providerEmailId] of [
        ['other-delivery', 'unrelated-change'],
        ['login-delivery', 'accepted-login'],
      ]) {
        await recordEmailDeliveryEvent({
          eventId: eventId!,
          providerEmailId: providerEmailId!,
          type: 'email.delivered',
          recipients: [email],
          occurredAt: new Date(),
          bounce: null,
          failureReason: null,
        });
      }
      const events = await getPool().query(
        `SELECT e.event_id FROM email_delivery_events e JOIN login_email_requests r USING (provider_email_id) WHERE r.request_id = $1 ORDER BY e.event_id`,
        [loginId],
      );
      assert.deepEqual(
        events.rows.map((row) => row.event_id),
        ['early-login', 'login-delivery'],
      );
      assert.equal(
        (await getPool().query('SELECT request_id FROM login_email_requests')).rowCount,
        1,
      );
    });
  } else {
    test('auth routes with configured provider in an isolated process', async () => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          ...(import.meta.url.endsWith('.ts') ? ['--import', 'tsx'] : []),
          '--test',
          '--test-reporter=tap',
          '--test-concurrency=1',
          fileURLToPath(import.meta.url),
        ],
        {
          env: {
            ...process.env,
            NODE_TEST_CONTEXT: undefined,
            MISTBOARD_TEST_LOGIN_MAIL_MODE: 'provider',
          },
          timeout: 120000,
        },
      );
      assert.match(stdout, /# fail 0/);
    });
  }
});

async function signupCaptureIp(
  email: string,
  headers: Record<string, string>,
): Promise<string | undefined> {
  const bodies: string[] = [];
  const previousTransport = setServerCaptureTransport(async (_url, body) => {
    bodies.push(body);
  });
  const previousKey = process.env.MISTBOARD_POSTHOG_KEY;
  const previousHost = process.env.MISTBOARD_POSTHOG_HOST;
  process.env.MISTBOARD_POSTHOG_KEY = 'phc_test';
  process.env.MISTBOARD_POSTHOG_HOST = 'https://ph.example';
  try {
    const start = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email }, '10.0.0.9', headers),
      start,
      '/api/auth/email/start',
    );
    assert.equal(start.status, 202);
    const { devCode, loginId } = JSON.parse(start.body) as { devCode: string; loginId: string };
    const confirm = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ code: devCode, loginId }, '10.0.0.9', headers),
      confirm,
      '/api/auth/email/confirm',
    );
    assert.equal(confirm.status, 200);
    const signups = bodies
      .map((body) => JSON.parse(body) as { event: string; properties: { $ip?: string } })
      .filter((payload) => payload.event === 'signup_completed');
    assert.equal(signups.length, 1);
    return signups[0]!.properties.$ip;
  } finally {
    setServerCaptureTransport(previousTransport);
    if (previousKey === undefined) delete process.env.MISTBOARD_POSTHOG_KEY;
    else process.env.MISTBOARD_POSTHOG_KEY = previousKey;
    if (previousHost === undefined) delete process.env.MISTBOARD_POSTHOG_HOST;
    else process.env.MISTBOARD_POSTHOG_HOST = previousHost;
  }
}

function jsonRequest(
  body: unknown,
  remoteAddress: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const request = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
  request.method = 'POST';
  request.headers = { ...headers };
  Object.defineProperty(request, 'socket', { value: { remoteAddress } });
  return request;
}

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string | string[]>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}
