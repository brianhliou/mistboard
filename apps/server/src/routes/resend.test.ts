import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { type HttpApiContext, handleApiRequest } from '../http-api.js';
import { close, getPool, init } from '../persistence-db.js';
import { EMAIL_DELIVERY_TYPES } from '../resend-webhook.js';

process.env.RESEND_WEBHOOK_SECRET = '';

function request(body = '{}', method = 'POST'): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
  stream.method = method;
  stream.url = '/api/webhooks/resend';
  stream.headers = {};
  return stream;
}

function response() {
  const result = { status: 0, body: '' };
  const stream = {
    writeHead(status: number) {
      result.status = status;
    },
    end(body: string) {
      result.body = body;
    },
  } as unknown as ServerResponse;
  return { result, stream };
}

test('Resend webhook is registered and fails closed without a signing secret', async () => {
  process.env.RESEND_WEBHOOK_SECRET = '';
  const res = response();
  await handleApiRequest({} as HttpApiContext, request(), res.stream);
  assert.equal(res.result.status, 503);
  assert.deepEqual(JSON.parse(res.result.body), { error: 'resend_webhook_unconfigured' });
});

const key = Buffer.from('resend-route-test-key');
const secret = `whsec_${key.toString('base64')}`;
function signedRequest(type = 'email.delivered', id = 'msg_route'): IncomingMessage {
  process.env.RESEND_WEBHOOK_SECRET = secret;
  const raw = JSON.stringify({
    type,
    created_at: '2026-11-03T20:00:02.000Z',
    data: {
      email_id: 'email_route',
      to: [' Player@Example.COM '],
      bounce: { type: 'Permanent', subType: 'General', message: 'No mailbox' },
      failed: { reason: 'reached_daily_quota' },
    },
  });
  const req = request(raw);
  const timestamp = String(Math.floor(Date.now() / 1000));
  req.headers = {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64')}`,
  };
  return req;
}

for (const type of EMAIL_DELIVERY_TYPES) {
  test(`Resend route durably acknowledges ${type}`, async (t) => {
    init('postgres://mistboard@127.0.0.1:9/never-connect');
    t.after(() => close());
    const calls: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    t.mock.method(getPool(), 'connect', async () => client);
    const res = response();
    await handleApiRequest({} as HttpApiContext, signedRequest(type), res.stream);
    assert.equal(res.result.status, 200);
    assert.deepEqual(JSON.parse(res.result.body), { received: true, duplicate: false });
    const event = calls.find((call) => call.sql.includes('INSERT INTO email_delivery_events'));
    assert.deepEqual(event?.values.slice(0, 4), [
      'msg_route',
      'email_route',
      type,
      ['player@example.com'],
    ]);
    assert.equal(calls.at(-1)?.sql, 'COMMIT');
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO email_delivery_addresses')));
  });
}

test('Resend route rejects bad authentication before touching persistence', async () => {
  const req = signedRequest();
  req.headers['svix-signature'] = 'v1,planted-invalid-signature';
  const res = response();
  await handleApiRequest({} as HttpApiContext, req, res.stream);
  assert.equal(res.result.status, 400);
});

test('Resend route authenticates unknown events then acknowledges without persistence', async () => {
  const res = response();
  await handleApiRequest({} as HttpApiContext, signedRequest('email.opened'), res.stream);
  assert.equal(res.result.status, 200);
  const req = signedRequest('future.event');
  req.headers['svix-signature'] = 'v1,invalid';
  const invalid = response();
  await handleApiRequest({} as HttpApiContext, req, invalid.stream);
  assert.equal(invalid.result.status, 400);
});

test('Resend route requests a retry while persistence is disabled', async () => {
  const res = response();
  await handleApiRequest({} as HttpApiContext, signedRequest(), res.stream);
  assert.equal(res.result.status, 503);
});

test('Resend route acknowledges duplicate delivery without reapplying the projection', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  const queries: string[] = [];
  t.mock.method(getPool(), 'connect', async () => ({
    async query(sql: string) {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  }));
  const res = response();
  await handleApiRequest({} as HttpApiContext, signedRequest(), res.stream);
  assert.equal(res.result.status, 200);
  assert.equal(JSON.parse(res.result.body).duplicate, true);
  assert.equal(queries.length, 3, 'BEGIN, deduplicated insert, COMMIT only');
});

test('Resend route rolls back partial processing and returns 503 without leaking errors', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  const queries: string[] = [];
  let released = false;
  t.mock.method(getPool(), 'connect', async () => ({
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('INSERT INTO email_delivery_addresses'))
        throw new Error('private provider details');
      return { rows: [], rowCount: 1 };
    },
    release() {
      released = true;
    },
  }));
  const res = response();
  await handleApiRequest({} as HttpApiContext, signedRequest(), res.stream);
  assert.equal(res.result.status, 503);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(released, true);
  assert.ok(!res.result.body.includes('private provider details'));
});

test('Resend route limits raw bytes and accepts POST only', async () => {
  process.env.RESEND_WEBHOOK_SECRET = secret;
  const oversized = response();
  await handleApiRequest(
    {} as HttpApiContext,
    request('x'.repeat(256 * 1024 + 1)),
    oversized.stream,
  );
  assert.equal(oversized.result.status, 413);
  const method = response();
  await handleApiRequest({} as HttpApiContext, request('{}', 'GET'), method.stream);
  assert.equal(method.result.status, 405);
});
