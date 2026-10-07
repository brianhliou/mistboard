import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { hashSecret } from './account-session.js';
import { setServerCaptureTransport } from './analytics-server.js';
import {
  consumeEmailLoginChallenge,
  createEmailLoginChallenge,
  findUserByEmail,
} from './persistence.js';
import { definePersistenceTests, test } from './persistence-test-support.js';
import { tryHandle } from './routes/auth.js';

type ResponseCapture = {
  body: string;
  headers: Record<string, string | string[]>;
  status: number | null;
};

definePersistenceTests('auth routes', () => {
  test('email auth returns delivery timing and creates a session after confirmation', async () => {
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

    const confirmResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ code: started.devCode, loginId: started.loginId }, '198.51.100.10'),
      confirmResponse,
      '/api/auth/email/confirm',
    );

    assert.equal(confirmResponse.status, 200);
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

    const response = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'supersede-route@example.com' }, '198.51.100.12'),
      response,
      '/api/auth/email/start',
    );

    assert.equal(response.status, 202);
    assert.equal(await consumeEmailLoginChallenge('route-old-code', oldHash, new Date()), null);
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
