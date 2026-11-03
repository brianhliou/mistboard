import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import test from 'node:test';
import {
  EMAIL_DELIVERY_TYPES,
  normalizeDeliveryEmail,
  verifyResendWebhook,
} from './resend-webhook.js';

// Synthetic signing material only. Sign independently of the verifier library.
const key = Buffer.from('resend-test-signing-key');
const secret = `whsec_${key.toString('base64')}`;
function signed(raw: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const id = 'msg_test';
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}

function payload(type: string) {
  return JSON.stringify({
    type,
    created_at: '2026-11-03T20:00:02.000Z',
    data: {
      created_at: '2026-11-03T20:00:00.000Z',
      email_id: 'email_1',
      from: 'Mistboard <play@example.com>',
      to: [' Player@Example.com ', 'player@example.com', 'OTHER@example.com'],
      subject: 'private login code',
      bounce: {
        type: 'Permanent',
        subType: 'Suppressed',
        message: 'Mailbox unavailable',
        diagnosticCode: ['smtp; 550 5.1.1'],
      },
      failed: { reason: 'reached_daily_quota' },
    },
  });
}

for (const type of EMAIL_DELIVERY_TYPES) {
  test(`Resend verifies official ${type} metadata and discards unrelated fields`, () => {
    const raw = payload(type);
    const event = verifyResendWebhook(Buffer.from(raw), signed(raw), secret);
    assert.deepEqual(event, {
      eventId: 'msg_test',
      providerEmailId: 'email_1',
      type,
      recipients: ['other@example.com', 'player@example.com'],
      occurredAt: new Date('2026-11-03T20:00:02.000Z'),
      bounce:
        type === 'email.bounced'
          ? {
              type: 'Permanent',
              subType: 'Suppressed',
              message: 'Mailbox unavailable',
              diagnosticCode: ['smtp; 550 5.1.1'],
            }
          : null,
      failureReason: type === 'email.failed' ? 'reached_daily_quota' : null,
    });
    assert.ok(!JSON.stringify(event).includes('private login code'));
  });
}

test('Resend signature binds raw bytes, message id, timestamp, and secret', () => {
  const raw = ` ${payload('email.delivered')}\n`;
  const headers = signed(raw);
  assert.ok(verifyResendWebhook(Buffer.from(raw), headers, secret));
  const invalid: [string, IncomingHttpHeaders, string][] = [
    [raw.trim(), headers, secret],
    [raw, { ...headers, 'svix-id': 'msg_tampered' }, secret],
    [raw, { ...headers, 'svix-timestamp': String(Number(headers['svix-timestamp']) + 1) }, secret],
    [raw, headers, `whsec_${Buffer.from('different-key').toString('base64')}`],
    [raw, { ...headers, 'svix-signature': 'v1,bogus' }, secret],
    [
      raw,
      { ...headers, 'svix-signature': headers['svix-signature'].replace('v1,', 'v2,') },
      secret,
    ],
    [raw, { ...headers, 'svix-id': ['duplicate', 'header'] }, secret],
    [raw, { ...headers, 'svix-timestamp': `${headers['svix-timestamp']}junk` }, secret],
    [raw, {}, secret],
  ];
  for (const [body, values, key] of invalid) {
    assert.throws(() => verifyResendWebhook(Buffer.from(body), values, key));
  }
});

test('Resend accepts any valid rotated v1 signature and rejects old/future attempts', () => {
  const raw = payload('email.sent');
  const headers = signed(raw);
  assert.ok(
    verifyResendWebhook(
      Buffer.from(raw),
      {
        ...headers,
        'svix-signature': `v1,bogus ${headers['svix-signature']}`,
      },
      secret,
    ),
  );
  for (const offset of [-301, 301]) {
    const timestamp = String(Math.floor(Date.now() / 1000) + offset);
    assert.throws(() => verifyResendWebhook(Buffer.from(raw), signed(raw, timestamp), secret));
  }
});

test('Resend verifier matches the published Svix signature vector', (t) => {
  // https://docs.svix.com/receiving/verifying-payloads/how-manual
  // Fixed public documentation example, unrelated to any deployed secret.
  t.mock.method(Date, 'now', () => 1731705121000);
  assert.throws(
    () =>
      verifyResendWebhook(
        Buffer.from('{"event_type":"ping","data":{"success":true}}'),
        {
          'svix-id': 'msg_loFOjxBNrRLzqYUf',
          'svix-timestamp': '1731705121',
          'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
        },
        'whsec_plJ3nmyCDGBKInavdOK15jsl',
      ),
    /invalid_payload/,
  );
});

test('Resend acknowledges authenticated unknown types but rejects malformed known events', () => {
  const raw = JSON.stringify({ type: 'email.opened' });
  assert.equal(verifyResendWebhook(Buffer.from(raw), signed(raw), secret), null);
  const base = JSON.parse(payload('email.bounced'));
  for (const malformed of [
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...base, created_at: 'invalid-date' }),
    JSON.stringify({ ...base, data: { ...base.data, email_id: '' } }),
    JSON.stringify({ ...base, data: { ...base.data, to: [] } }),
    JSON.stringify({ ...base, data: { ...base.data, to: [42] } }),
    JSON.stringify({ ...base, data: { ...base.data, to: ['bad address'] } }),
    JSON.stringify({ ...base, data: { ...base.data, bounce: { type: 'Permanent' } } }),
    JSON.stringify({
      ...base,
      type: 'email.failed',
      data: { ...base.data, failed: { reason: 42 } },
    }),
  ]) {
    assert.throws(() => verifyResendWebhook(Buffer.from(malformed), signed(malformed), secret));
  }
});

test('delivery address normalization only trims and lowercases', () => {
  assert.equal(normalizeDeliveryEmail(' Player+Tag@Example.COM '), 'player+tag@example.com');
  for (const address of ['', 'bad', 'a@@b', 'A <a@example.com>', 'a\nb@example.com']) {
    assert.throws(() => normalizeDeliveryEmail(address));
  }
});
