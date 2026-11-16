import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import {
  type AccountBroadcastPushDependencies,
  createAccountBroadcastPushHandler,
} from './account-broadcast-push.js';

const metadata = {
  id: 'bpt_12345678',
  tourSlug: 'test',
  label: 'Clock',
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
};
function harness(overrides: Partial<AccountBroadcastPushDependencies> = {}) {
  const calls: unknown[] = [];
  const handler = createAccountBroadcastPushHandler({
    currentUser: async () => ({ id: 'owner', playDisabledAt: null }),
    available: () => true,
    list: async () => [{ tourSlug: 'test', name: 'Test', tokens: [metadata] }],
    create: async (...args) => {
      calls.push(args);
      return { token: 'one-time-test-value', metadata };
    },
    revoke: async (...args) => {
      calls.push(args);
      return args[2] === metadata.id;
    },
    ...overrides,
  });
  async function request(
    method = 'GET',
    suffix = '',
    body: unknown = { label: ' Clock ' },
    headers: Record<string, string> = {},
  ) {
    const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
    req.method = method;
    req.headers = { host: 'mistboard.com', 'content-type': 'application/json', ...headers };
    let code = 0;
    let raw = '';
    const outputHeaders: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => {
        outputHeaders[k] = v;
      },
      writeHead: (s: number, h: Record<string, string>) => {
        code = s;
        Object.assign(outputHeaders, h);
      },
      end: (s: string) => {
        raw = s;
      },
    } as unknown as ServerResponse;
    const handled = await handler(req, res, `/api/account/broadcast-push${suffix}`);
    return { code, raw, headers: outputHeaders, handled, body: raw ? JSON.parse(raw) : null };
  }
  return { request, calls };
}

test('account token creation returns plaintext only on create; subsequent lists contain safe metadata', async () => {
  const h = harness();
  const created = await h.request('POST', '/test');
  assert.equal(created.code, 201);
  assert.equal(created.body.token, 'one-time-test-value');
  assert.deepEqual(h.calls, [['owner', 'test', 'Clock']]);
  for (const suffix of ['', '/test']) {
    const listed = await h.request('GET', suffix);
    assert.equal(listed.code, 200);
    assert.equal(listed.raw.includes('one-time-test-value'), false);
    assert.equal(listed.raw.includes('token_hash'), false);
    assert.equal(listed.headers['Cache-Control'], 'no-store');
  }
  assert.equal((await h.request('DELETE', '/test/bpt_12345678')).code, 200);
});

test('ungranted tours cannot be listed, created or revoked, including tokens owned by someone else', async () => {
  const h = harness();
  for (const [method, path] of [
    ['GET', '/other'],
    ['POST', '/other'],
    ['DELETE', '/other/bpt_12345678'],
    ['DELETE', '/test/bpt_87654321'],
  ])
    assert.equal((await h.request(method, path)).code, 404);
  assert.equal(
    h.calls.filter((args) => (args as string[]).length === 3 && (args as string[])[2] === 'Clock')
      .length,
    0,
  );
});

test('account auth, CSRF, labels, disabled accounts, token cap and rate limits are enforced', async () => {
  assert.equal((await harness({ currentUser: async () => null }).request()).code, 401);
  assert.equal(
    (
      await harness({
        currentUser: async () => ({ id: 'owner', playDisabledAt: new Date() }),
      }).request('POST', '/test')
    ).code,
    403,
  );
  const h = harness();
  assert.equal(
    (await h.request('POST', '/test', {}, { origin: 'https://attacker.test' })).code,
    403,
  );
  assert.equal(
    (await h.request('DELETE', '/test/bpt_12345678', {}, { 'sec-fetch-site': 'cross-site' })).code,
    403,
  );
  // A sibling subdomain is same-site but not same-origin.
  assert.equal((await h.request('POST', '/test', {}, { 'sec-fetch-site': 'same-site' })).code, 403);
  // Behind a proxy that rewrites Host (the Vite dev proxy), Origin never matches
  // Host; the browser's same-origin verdict is what counts.
  const proxied = harness();
  assert.equal(
    (
      await proxied.request(
        'POST',
        '/test',
        { label: 'Clock' },
        {
          host: 'localhost:3031',
          origin: 'http://localhost:3030',
          'sec-fetch-site': 'same-origin',
        },
      )
    ).code,
    201,
  );
  assert.equal((await h.request('POST', '/test', {}, { 'content-type': 'text/plain' })).code, 415);
  for (const label of ['', ' ', 'x'.repeat(101), 3])
    assert.equal((await h.request('POST', '/test', { label })).code, 400);
  const limited = harness({ create: async () => 'token_limit' });
  assert.equal((await limited.request('POST', '/test')).code, 409);
  const rate = harness();
  for (let i = 0; i < 10; i++) assert.equal((await rate.request('POST', '/test')).code, 201);
  assert.equal((await rate.request('POST', '/test')).code, 429);
});

test('driver errors cannot escape into logs or include credential details in responses', async () => {
  const h = harness({
    create: async () => {
      throw new Error('unsafe planted credential/hash');
    },
  });
  const result = await h.request('POST', '/test');
  assert.equal(result.code, 500);
  assert.equal(result.raw.includes('unsafe planted'), false);
});
