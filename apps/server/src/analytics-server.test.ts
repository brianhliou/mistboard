import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildServerCapturePayload,
  captureServerEvent,
  clientIpForAnalytics,
  serverAnalyticsConfig,
  setServerCaptureTransport,
} from './analytics-server.js';

test('config comes from the web build vars, with the MISTBOARD_ overrides winning', () => {
  assert.equal(serverAnalyticsConfig({}), null);
  assert.equal(serverAnalyticsConfig({ VITE_POSTHOG_KEY: 'phc_x' }), null, 'key without host');
  assert.deepEqual(
    serverAnalyticsConfig({ VITE_POSTHOG_KEY: 'phc_x', VITE_POSTHOG_HOST: 'https://ph.example/' }),
    { key: 'phc_x', host: 'https://ph.example' },
  );
  assert.deepEqual(
    serverAnalyticsConfig({
      VITE_POSTHOG_KEY: 'phc_x',
      VITE_POSTHOG_HOST: 'https://ph.example',
      MISTBOARD_POSTHOG_KEY: 'phc_server',
      MISTBOARD_POSTHOG_HOST: 'https://server.example',
    }),
    { key: 'phc_server', host: 'https://server.example' },
  );
});

test('payload carries the server lib marker, the caller ip, and an ISO timestamp', () => {
  const payload = buildServerCapturePayload({
    key: 'phc_x',
    event: 'signup_completed',
    distinctId: 'user_1',
    properties: { handle: 'alice' },
    ip: '203.0.113.7',
    now: new Date('2026-08-27T10:00:00.000Z'),
  });
  assert.deepEqual(payload, {
    api_key: 'phc_x',
    event: 'signup_completed',
    distinct_id: 'user_1',
    properties: { $lib: 'mistboard-server', handle: 'alice', $ip: '203.0.113.7' },
    timestamp: '2026-08-27T10:00:00.000Z',
  });
  const noIp = buildServerCapturePayload({ key: 'k', event: 'e', distinctId: 'd', ip: null });
  assert.equal('$ip' in noIp.properties, false);
});

test('capture posts to /capture/ on the configured host and is a no-op without a key', async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const previous = setServerCaptureTransport(async (url, body) => {
    calls.push({ url, body });
  });
  try {
    const skipped = await captureServerEvent({
      event: 'signup_completed',
      distinctId: 'user_1',
      env: {},
    });
    assert.equal(skipped, false);
    assert.equal(calls.length, 0);

    const sent = await captureServerEvent({
      event: 'signup_completed',
      distinctId: 'user_1',
      ip: '203.0.113.7',
      env: { VITE_POSTHOG_KEY: 'phc_x', VITE_POSTHOG_HOST: 'https://ph.example' },
    });
    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://ph.example/capture/');
    const body = JSON.parse(calls[0]!.body);
    assert.equal(body.api_key, 'phc_x');
    assert.equal(body.event, 'signup_completed');
    assert.equal(body.distinct_id, 'user_1');
    assert.equal(body.properties.$ip, '203.0.113.7');
    assert.equal(body.properties.$lib, 'mistboard-server');
  } finally {
    setServerCaptureTransport(previous);
  }
});

test('a failing transport never throws out of capture', async () => {
  const previous = setServerCaptureTransport(async () => {
    throw new Error('network down');
  });
  try {
    const sent = await captureServerEvent({
      event: 'signup_completed',
      distinctId: 'user_1',
      env: { VITE_POSTHOG_KEY: 'phc_x', VITE_POSTHOG_HOST: 'https://ph.example' },
    });
    assert.equal(sent, false);
  } finally {
    setServerCaptureTransport(previous);
  }
});

test('analytics ip prefers cf-connecting-ip over the trusted proxy hop', () => {
  const socket = { remoteAddress: '10.0.0.1' } as never;
  const behindCloudflare = {
    headers: {
      'x-forwarded-for': '203.0.113.50, 172.70.100.1',
      'cf-connecting-ip': ' 36.112.5.9 ',
    },
    socket,
  };
  assert.equal(clientIpForAnalytics(behindCloudflare), '36.112.5.9');
  assert.equal(
    clientIpForAnalytics({ headers: { 'cf-connecting-ip': '2408:8207::1' }, socket }),
    '2408:8207::1',
  );
  // No header, or one that is not an address: same answer as the rate-limit key.
  assert.equal(
    clientIpForAnalytics({ headers: { 'x-forwarded-for': '203.0.113.50, 172.70.100.1' }, socket }),
    '172.70.100.1',
  );
  assert.equal(
    clientIpForAnalytics({
      headers: { 'x-forwarded-for': '172.70.100.1', 'cf-connecting-ip': 'not-an-ip' },
      socket,
    }),
    '172.70.100.1',
  );
  assert.equal(clientIpForAnalytics({ headers: {}, socket }), '10.0.0.1');
});
