import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { type HttpApiContext, handleApiRequest, routes } from '../http-api.js';
import { signDmEmailUnsubscribeToken } from '../inbox-email-unsubscribe.js';
import { createInboxEmailUnsubscribeRoute, tryHandle } from './inbox-email-unsubscribe.js';

const SECRET = 'test-only-route-secret';
const PATH = '/api/inbox/email/unsubscribe';
const token = signDmEmailUnsubscribeToken('user_123', SECRET);

function request(method: string, url: string, body = '') {
  return Object.assign(Readable.from([body]), {
    method,
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }) as IncomingMessage;
}

function captureResponse() {
  const captured = { status: 0, headers: {} as Record<string, string>, body: '' };
  const response = {
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      captured.headers = headers;
      return this;
    },
    end(body: string) {
      captured.body = body;
    },
  } as unknown as ServerResponse;
  return { captured, response };
}

function harness(secret: string | undefined = SECRET, initialized = true) {
  const preferences = { inboxEmail: true, inboxBell: true, correspondenceTurnDigest: true };
  const writes: unknown[][] = [];
  const route = createInboxEmailUnsubscribeRoute({
    env: { MISTBOARD_ENGINE_SECRET: secret },
    isInitialized: () => initialized,
    updatePreference: async (id, key, value, at) => {
      writes.push([id, key, value, at]);
      if (id !== 'user_123') return null;
      assert.equal(key, 'inboxEmail');
      assert.equal(value, false);
      preferences.inboxEmail = false;
      return { id };
    },
  });
  async function call(method: string, query = `?t=${token}`, body = '') {
    const { response, captured } = captureResponse();
    const url = new URL(`${PATH}${query}`, 'https://mistboard.example');
    assert.equal(
      await route.tryHandle(
        {},
        request(method, url.pathname + url.search, body),
        response,
        url.pathname,
        url,
      ),
      true,
    );
    return captured;
  }
  return { call, writes, preferences, route };
}

test('DM unsubscribe GET confirms without writing preferences or requiring sign-in', async () => {
  const h = harness();
  const result = await h.call('GET');
  assert.equal(result.status, 200);
  assert.match(result.body, /<form[^>]+method="post"/);
  assert.match(result.body, /Stop direct-message emails/);
  assert.ok(result.body.includes(`${PATH}?t=${token}`));
  assert.equal(h.writes.length, 0);
  assert.equal(h.preferences.inboxEmail, true);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.equal(result.headers['x-robots-tag'], 'noindex');
});

test('DM unsubscribe POST accepts RFC 8058 without cookies and disables only inboxEmail, idempotently', async () => {
  const h = harness();
  for (const body of ['List-Unsubscribe=One-Click', '']) {
    const result = await h.call('POST', `?t=${token}`, body);
    assert.equal(result.status, 200);
    assert.match(result.body, /Direct-message emails are turned off/);
  }
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[0]?.slice(0, 3), ['user_123', 'inboxEmail', false]);
  assert.ok(h.writes[0]?.[3] instanceof Date);
  assert.deepEqual(h.preferences, {
    inboxEmail: false,
    inboxBell: true,
    correspondenceTurnDigest: true,
  });
});

test('invalid, missing, duplicate, tampered and unknown DM tokens change nothing', async () => {
  const h = harness();
  for (const query of [
    '',
    '?t=garbage',
    `?t=${token}x`,
    `?t=${token}&t=${token}`,
    `?t=${signDmEmailUnsubscribeToken('user_unknown', SECRET)}`,
  ]) {
    const result = await h.call('POST', query, 'List-Unsubscribe=One-Click');
    assert.equal(result.status, 400);
  }
  assert.deepEqual(
    h.writes.map((write) => write[0]),
    ['user_unknown'],
  );
  assert.equal(h.preferences.inboxEmail, true);
  assert.equal((await h.call('GET', '?t=invalid')).status, 400);
});

test('missing DM signing configuration and unavailable persistence fail closed', async () => {
  for (const secret of ['', '   ']) {
    const h = harness(secret);
    for (const method of ['GET', 'POST']) assert.equal((await h.call(method)).status, 503);
    assert.equal(h.writes.length, 0);
  }
  const h = harness(SECRET, false);
  assert.equal((await h.call('POST')).status, 503);
  assert.equal(h.writes.length, 0);
});

test('DM unsubscribe rejects other methods and does not claim other email or inbox routes', async () => {
  const h = harness();
  for (const method of ['HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.equal((await h.call(method)).status, 405);
  }
  assert.equal(h.writes.length, 0);
  for (const path of [
    '/api/inbox',
    '/api/inbox/someone',
    '/api/club/washington/confirm',
    `${PATH}/extra`,
  ]) {
    const { response } = captureResponse();
    assert.equal(
      await h.route.tryHandle(
        {},
        request('POST', path),
        response,
        path,
        new URL(path, 'https://mistboard.example'),
      ),
      false,
    );
  }
});

test('DM unsubscribe is registered before the general inbox handler and reachable through the dispatcher', async () => {
  const unsubscribeIndex = routes.findIndex((route) => route.tryHandle === tryHandle);
  assert.ok(unsubscribeIndex >= 0);
  const inbox = await import('./inbox.js');
  assert.ok(unsubscribeIndex < routes.findIndex((route) => route.tryHandle === inbox.tryHandle));
  const { response, captured } = captureResponse();
  await handleApiRequest({} as HttpApiContext, request('HEAD', PATH), response);
  assert.equal(captured.status, 405);
});
