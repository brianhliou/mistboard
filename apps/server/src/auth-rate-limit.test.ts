import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { clientIpForRateLimit, createAuthRateLimiter } from './auth-rate-limit.js';

test('auth rate limiter allows up to the limit then rejects within the window', () => {
  const limiter = createAuthRateLimiter(3, 60_000);
  const now = 1_000;
  assert.equal(limiter.check('ip-a', now), true);
  assert.equal(limiter.check('ip-a', now), true);
  assert.equal(limiter.check('ip-a', now), true);
  // Fourth hit in the same window is over budget.
  assert.equal(limiter.check('ip-a', now), false);
});

test('auth rate limiter keys are independent', () => {
  const limiter = createAuthRateLimiter(1, 60_000);
  const now = 1_000;
  assert.equal(limiter.check('ip-a', now), true);
  assert.equal(limiter.check('ip-a', now), false);
  // A different key has its own budget and is unaffected.
  assert.equal(limiter.check('ip-b', now), true);
});

test('auth rate limiter budget refreshes once old hits leave the window', () => {
  const limiter = createAuthRateLimiter(2, 60_000);
  assert.equal(limiter.check('ip-a', 0), true);
  assert.equal(limiter.check('ip-a', 0), true);
  assert.equal(limiter.check('ip-a', 0), false);
  // Past the window the earlier hits are pruned and the budget is available.
  assert.equal(limiter.check('ip-a', 60_001), true);
});

test('clientIpForRateLimit trusts the proxy-appended hop, not the spoofable first hop', () => {
  // The proxy appends the real client IP as the last hop; the leftmost hop is
  // client-supplied. With one trusted hop (the default) the rightmost entry wins.
  const request = {
    headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.4' },
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as IncomingMessage;
  assert.equal(clientIpForRateLimit(request), '198.51.100.4');
});

test('clientIpForRateLimit ignores an attacker-prepended spoof hop', () => {
  // A client trying to rotate buckets prepends a fake hop. The trusted hop is
  // still the one the proxy appended, so all these requests share one bucket.
  const spoofed = {
    headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.4' },
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as IncomingMessage;
  const alsoSpoofed = {
    headers: { 'x-forwarded-for': '5.6.7.8, 198.51.100.4' },
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as IncomingMessage;
  assert.equal(clientIpForRateLimit(spoofed), '198.51.100.4');
  assert.equal(clientIpForRateLimit(alsoSpoofed), '198.51.100.4');
});

test('clientIpForRateLimit honors a configured trusted-hop depth', () => {
  // Two proxies in front: the real client is the second-from-last hop.
  const request = {
    headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.4, 10.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  assert.equal(
    clientIpForRateLimit(request, { MISTBOARD_TRUSTED_PROXY_HOPS: '2' }),
    '198.51.100.4',
  );
});

test('clientIpForRateLimit falls back to the socket address with no forwarded header', () => {
  const request = {
    headers: {},
    socket: { remoteAddress: '198.51.100.4' },
  } as unknown as IncomingMessage;
  assert.equal(clientIpForRateLimit(request), '198.51.100.4');
});

test('clientIpForRateLimit falls back to the socket when fewer hops than trusted', () => {
  // Only one hop present but two are trusted — the header can't be relied on, so
  // we use the socket address rather than reading a client-supplied value.
  const request = {
    headers: { 'x-forwarded-for': '203.0.113.7' },
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as IncomingMessage;
  assert.equal(clientIpForRateLimit(request, { MISTBOARD_TRUSTED_PROXY_HOPS: '2' }), '10.0.0.1');
});

test('clientIpForRateLimit ignores the forwarded header when hop trust is disabled', () => {
  const request = {
    headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.4' },
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as IncomingMessage;
  assert.equal(clientIpForRateLimit(request, { MISTBOARD_TRUSTED_PROXY_HOPS: '0' }), '10.0.0.1');
});

test('clientIpForRateLimit returns a stable key when no address is available', () => {
  const request = {
    headers: { 'x-forwarded-for': '' },
    socket: {},
  } as unknown as IncomingMessage;
  assert.equal(clientIpForRateLimit(request), 'unknown');
});

function proxyRequest(
  forwarded: string | undefined,
  visitor: string | string[] | undefined,
  remoteAddress = '10.0.0.1',
): IncomingMessage {
  return {
    headers: { 'x-forwarded-for': forwarded, 'cf-connecting-ip': visitor },
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

test('Cloudflare visitors through the same edge have independent auth rate-limit keys', () => {
  const limiter = createAuthRateLimiter(1, 60_000);
  const first = clientIpForRateLimit(proxyRequest('203.0.113.7, 172.70.100.1', '198.51.100.4'), {});
  const second = clientIpForRateLimit(
    proxyRequest('203.0.113.7, 172.70.100.1', '198.51.100.5'),
    {},
  );
  assert.equal(first, '198.51.100.4');
  assert.equal(second, '198.51.100.5');
  assert.notEqual(first, second);
  assert.equal(limiter.check(first, 1_000), true);
  assert.equal(limiter.check(first, 1_000), false);
  assert.equal(limiter.check(second, 1_000), true);
});

test('clientIpForRateLimit rejects forged Cloudflare headers outside the trusted Cloudflare hop', () => {
  for (const hop of ['198.51.100.4', '::ffff:198.51.100.4', '2001:db8::1', 'not-an-ip']) {
    // Even a Cloudflare address in the spoofable prefix must not grant trust.
    assert.equal(
      clientIpForRateLimit(proxyRequest(`172.70.100.1, ${hop}`, '203.0.113.7'), {}),
      hop,
    );
  }
});

test('clientIpForRateLimit requires a single valid Cloudflare visitor address', () => {
  for (const visitor of [
    undefined,
    '',
    'garbage',
    '999.1.2.3',
    '198.51.100.4, 198.51.100.5',
    ['198.51.100.4', '198.51.100.5'],
    ['198.51.100.4'],
  ]) {
    assert.equal(clientIpForRateLimit(proxyRequest('172.70.100.1', visitor), {}), '172.70.100.1');
  }
});

test('clientIpForRateLimit recognizes IPv6 and IPv4-mapped Cloudflare hops', () => {
  for (const hop of [
    '2606:4700::1',
    '2a06:98c7:ffff::1',
    '::ffff:172.70.100.1',
    '::ffff:ac46:6401',
  ]) {
    for (const visitor of ['198.51.100.4', '2001:db8::42', '::ffff:198.51.100.4']) {
      assert.equal(clientIpForRateLimit(proxyRequest(hop, visitor), {}), visitor);
    }
  }
});

test('clientIpForRateLimit checks Cloudflare membership only at the configured trusted hop', () => {
  const request = proxyRequest('203.0.113.7, 172.70.100.1, 10.0.0.2', '198.51.100.4');
  assert.equal(
    clientIpForRateLimit(request, { MISTBOARD_TRUSTED_PROXY_HOPS: '2' }),
    '198.51.100.4',
  );
});

test('clientIpForRateLimit checks a fallback socket before trusting a Cloudflare visitor header', () => {
  assert.equal(
    clientIpForRateLimit(proxyRequest(undefined, '198.51.100.4', '172.70.100.1'), {}),
    '198.51.100.4',
  );
  assert.equal(
    clientIpForRateLimit(proxyRequest(undefined, '198.51.100.4', '203.0.113.7'), {}),
    '203.0.113.7',
  );
  assert.equal(
    clientIpForRateLimit(proxyRequest('172.70.100.1', '198.51.100.4'), {
      MISTBOARD_TRUSTED_PROXY_HOPS: '0',
    }),
    '10.0.0.1',
  );
});
