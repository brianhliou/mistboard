import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createAuthRateLimiter } from '../auth-rate-limit.js';
import {
  CLUB_SIGNUP_TOKEN_TTL_MS,
  clubConfirmEmail,
  clubConfirmPage,
  signClubToken,
  verifyClubToken,
} from '../club-signup.js';
import type { TransactionalEmail } from '../send-email.js';
import { type ClubSignupDeps, createClubSignupRoute } from './club-signup.js';

const SECRET = 'test-club-secret';
const ENV = {
  RESEND_API_KEY: 're_test_send',
  MISTBOARD_AUTH_EMAIL_FROM: 'Mistboard <hello@mail.example>',
  MISTBOARD_CLUB_SIGNUP_SECRET: SECRET,
  MISTBOARD_CLUB_RESEND_AUDIENCE_ID: 'aud_club',
  MISTBOARD_HOST: 'https://mistboard.example',
};

type Captured = { status: number; headers: Record<string, unknown>; body: string };

function fakeRequest(method: string, url: string, body?: unknown, ip = '203.0.113.7') {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const request = Readable.from(chunks) as unknown as IncomingMessage;
  Object.assign(request, {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: ip },
  });
  return request;
}

function fakeResponse(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: '' };
  const response = {
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      captured.status = status;
      captured.headers = headers;
      return this;
    },
    end(chunk?: string) {
      captured.body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return { response, captured };
}

function harness(overrides: Partial<ClubSignupDeps> = {}) {
  const sent: TransactionalEmail[] = [];
  const contactCalls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    contactCalls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      auth: headers.authorization ?? '',
    });
    return new Response(JSON.stringify({ id: 'contact_1' }), { status: 201 });
  }) as typeof fetch;
  const route = createClubSignupRoute({
    env: ENV,
    sendEmail: async (message) => {
      sent.push(message);
      return { ok: true };
    },
    fetchImpl,
    ipLimiter: createAuthRateLimiter(100, 60_000),
    emailLimiter: createAuthRateLimiter(100, 60_000),
    ...overrides,
  });
  async function call(method: string, url: string, body?: unknown, ip?: string) {
    const { response, captured } = fakeResponse();
    const parsed = new URL(url, 'http://localhost');
    const handled = await route.tryHandle(
      {},
      fakeRequest(method, url, body, ip),
      response,
      parsed.pathname,
      parsed,
    );
    assert.equal(handled, true);
    return captured;
  }
  return { call, sent, contactCalls };
}

function tokenFromMail(mail: TransactionalEmail): string {
  const match = /\/api\/club\/washington\/confirm\?t=([^&\s"]+)/.exec(mail.text);
  assert.ok(match, 'confirm link in the text part');
  return decodeURIComponent(match[1] as string);
}

test('subscribe stores nothing and sends exactly one confirm mail', async () => {
  const h = harness();
  const res = await h.call('POST', '/api/club/washington/subscribe', {
    email: ' Player@Example.COM ',
    locale: 'zh-Hant',
    website: '',
  });
  assert.equal(res.status, 202);
  assert.equal(h.sent.length, 1);
  assert.equal(h.contactCalls.length, 0, 'no contact before the link is clicked');
  const mail = h.sent[0] as TransactionalEmail;
  assert.deepEqual(mail.to, ['player@example.com']);
  assert.equal(mail.from, ENV.MISTBOARD_AUTH_EMAIL_FROM);
  assert.match(mail.subject, /華州象棋/);
  assert.match(mail.text, / https:\/\/mistboard\.example\/api\/club\/washington\/confirm\?t=/);
  assert.deepEqual(verifyClubToken(tokenFromMail(mail), SECRET), {
    email: 'player@example.com',
    locale: 'zh-Hant',
  });
});

test('a valid confirm adds the contact to the club audience', async () => {
  const h = harness();
  await h.call('POST', '/api/club/washington/subscribe', { email: 'a@example.com', locale: 'en' });
  const token = tokenFromMail(h.sent[0] as TransactionalEmail);
  const res = await h.call('GET', `/api/club/washington/confirm?t=${encodeURIComponent(token)}`);
  assert.equal(res.status, 200);
  assert.match(res.body, /data-outcome="done"/);
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(h.contactCalls.length, 1);
  const call = h.contactCalls[0];
  assert.equal(call?.url, 'https://api.resend.com/audiences/aud_club/contacts');
  assert.deepEqual(call?.body, { email: 'a@example.com', unsubscribed: false });
  assert.equal(call?.auth, 'Bearer re_test_send');
});

test('a dedicated contacts key is used for the contact call when set', async () => {
  const h = harness({ env: { ...ENV, MISTBOARD_CLUB_RESEND_API_KEY: 're_full' } });
  const token = signClubToken('b@example.com', 'en', SECRET);
  await h.call('GET', `/api/club/washington/confirm?t=${encodeURIComponent(token)}`);
  assert.equal(h.contactCalls[0]?.auth, 'Bearer re_full');
});

test('confirming twice still shows the success page', async () => {
  const h = harness({
    fetchImpl: (async () =>
      new Response('{"message":"Contact already exists"}', { status: 422 })) as typeof fetch,
  });
  const token = signClubToken('c@example.com', 'en', SECRET);
  const res = await h.call('GET', `/api/club/washington/confirm?t=${encodeURIComponent(token)}`);
  assert.equal(res.status, 200);
  assert.match(res.body, /data-outcome="done"/);
});

test('a Resend failure on confirm is an error page, not a success', async () => {
  const h = harness({
    fetchImpl: (async () => new Response('{}', { status: 401 })) as typeof fetch,
  });
  const token = signClubToken('d@example.com', 'zh-Hans', SECRET);
  const res = await h.call('GET', `/api/club/washington/confirm?t=${encodeURIComponent(token)}`);
  assert.equal(res.status, 502);
  assert.match(res.body, /data-outcome="error"/);
  assert.match(res.body, /lang="zh-Hans"/);
});

test('a tampered token is refused and adds no contact', async () => {
  const h = harness();
  const token = signClubToken('e@example.com', 'en', SECRET);
  const [payload, mac] = token.split('.') as [string, string];
  const forged = Buffer.from(
    JSON.stringify({ e: 'victim@example.com', l: 'en', x: Date.now() + 1e9 }),
  ).toString('base64url');
  for (const bad of [
    `${forged}.${mac}`,
    `${payload}.${mac.slice(0, -2)}xx`,
    signClubToken('e@example.com', 'en', 'some-other-secret'),
    'not-a-token',
    '',
  ]) {
    const res = await h.call('GET', `/api/club/washington/confirm?t=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, `refused: ${bad.slice(0, 20)}`);
    assert.match(res.body, /data-outcome="invalid"/);
  }
  assert.equal(h.contactCalls.length, 0);
});

test('an expired token is refused after 7 days', async () => {
  const issued = Date.UTC(2026, 9, 1);
  const token = signClubToken('f@example.com', 'en', SECRET, issued);
  assert.ok(verifyClubToken(token, SECRET, issued + CLUB_SIGNUP_TOKEN_TTL_MS - 1000));
  assert.equal(verifyClubToken(token, SECRET, issued + CLUB_SIGNUP_TOKEN_TTL_MS + 1000), null);

  const h = harness({ now: () => issued + CLUB_SIGNUP_TOKEN_TTL_MS + 1000 });
  const res = await h.call(
    'GET',
    `/api/club/washington/confirm?t=${encodeURIComponent(token)}&lang=zh-Hans`,
  );
  assert.equal(res.status, 400);
  assert.match(res.body, /data-outcome="invalid"/);
  assert.match(res.body, /lang="zh-Hans"/, 'the lang hint localizes the refusal');
  assert.equal(h.contactCalls.length, 0);
});

test('a honeypot submission answers like success and sends nothing', async () => {
  const h = harness();
  const res = await h.call('POST', '/api/club/washington/subscribe', {
    email: 'bot@example.com',
    website: 'https://spam.example',
  });
  assert.equal(res.status, 202);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.equal(h.sent.length, 0);
});

test('an invalid address is a 400 and sends nothing', async () => {
  const h = harness();
  for (const email of ['', 'nope', 'a@b', 'a b@example.com', 42]) {
    const res = await h.call('POST', '/api/club/washington/subscribe', { email });
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body), { error: 'invalid_email' });
  }
  assert.equal(h.sent.length, 0);
});

test('unset config answers 503 on both endpoints, never crashes', async () => {
  for (const missing of [
    'RESEND_API_KEY',
    'MISTBOARD_CLUB_SIGNUP_SECRET',
    'MISTBOARD_CLUB_RESEND_AUDIENCE_ID',
  ] as const) {
    const env: Record<string, string | undefined> = { ...ENV };
    delete env[missing];
    const h = harness({ env });
    const sub = await h.call('POST', '/api/club/washington/subscribe', { email: 'g@example.com' });
    assert.equal(sub.status, 503, missing);
    assert.deepEqual(JSON.parse(sub.body), { error: 'signup_unavailable' });
    const conf = await h.call('GET', '/api/club/washington/confirm?t=x');
    assert.equal(conf.status, 503, missing);
    assert.match(conf.body, /data-outcome="unavailable"/);
    assert.equal(h.sent.length, 0);
    assert.equal(h.contactCalls.length, 0);
  }
  // No sender at all: neither from-address variable set.
  const { MISTBOARD_AUTH_EMAIL_FROM: _from, ...noFrom } = ENV;
  const h = harness({ env: noFrom });
  const res = await h.call('POST', '/api/club/washington/subscribe', { email: 'g@example.com' });
  assert.equal(res.status, 503);
});

test('the subscribe endpoint is rate limited per IP and per address', async () => {
  const byIp = harness({ ipLimiter: createAuthRateLimiter(2, 60_000) });
  for (const email of ['h1@example.com', 'h2@example.com']) {
    assert.equal(
      (await byIp.call('POST', '/api/club/washington/subscribe', { email })).status,
      202,
    );
  }
  const blocked = await byIp.call('POST', '/api/club/washington/subscribe', {
    email: 'h3@example.com',
  });
  assert.equal(blocked.status, 429);
  assert.equal(byIp.sent.length, 2);

  const byEmail = harness({ emailLimiter: createAuthRateLimiter(1, 60_000) });
  const body = { email: 'same@example.com' };
  assert.equal(
    (await byEmail.call('POST', '/api/club/washington/subscribe', body, '198.51.100.1')).status,
    202,
  );
  assert.equal(
    (await byEmail.call('POST', '/api/club/washington/subscribe', body, '198.51.100.2')).status,
    429,
  );
  assert.equal(byEmail.sent.length, 1);
});

test('a failed send is a 502, not a silent success', async () => {
  const h = harness({ sendEmail: async () => ({ ok: false, statusCode: 403 }) });
  const res = await h.call('POST', '/api/club/washington/subscribe', { email: 'i@example.com' });
  assert.equal(res.status, 502);
});

test('wrong methods are refused; HEAD on confirm subscribes nobody', async () => {
  const h = harness();
  assert.equal((await h.call('GET', '/api/club/washington/subscribe')).status, 405);
  const token = signClubToken('j@example.com', 'en', SECRET);
  const head = await h.call('HEAD', `/api/club/washington/confirm?t=${encodeURIComponent(token)}`);
  assert.equal(head.status, 405);
  assert.equal(h.contactCalls.length, 0);
});

test('mail and page copy exist in all three locales, with no em dashes', () => {
  for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
    const mail = clubConfirmEmail(locale, 'https://mistboard.example/x');
    assert.ok(mail.subject.length > 0);
    assert.match(mail.text, /https:\/\/mistboard\.example\/x/);
    assert.match(mail.html, new RegExp(`lang="${locale}"`));
    assert.doesNotMatch(mail.text, /—/);
    for (const outcome of ['done', 'invalid', 'error', 'unavailable'] as const) {
      const page = clubConfirmPage(locale, outcome);
      assert.match(page, new RegExp(`<html lang="${locale}">`));
      assert.match(page, /href="\/washington-xiangqi"/);
      assert.doesNotMatch(page, /—/);
    }
  }
  assert.match(clubConfirmEmail('en', 'u').text, /unsubscribe/i);
});

test('the route ignores paths it does not own', async () => {
  const route = createClubSignupRoute({ env: ENV });
  const { response } = fakeResponse();
  const handled = await route.tryHandle(
    {},
    fakeRequest('GET', '/api/feedback'),
    response,
    '/api/feedback',
  );
  assert.equal(handled, false);
});
