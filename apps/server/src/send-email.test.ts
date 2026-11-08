import assert from 'node:assert/strict';
import test from 'node:test';
import { dmEmailUnsubscribe } from './inbox-email-unsubscribe.js';

// Placeholder only; all provider calls are replaced below.
process.env.RESEND_API_KEY = 're_placeholder_for_tests';
const { sendTransactionalEmail } = await import('./send-email.js');
const message = {
  from: 'Mistboard <play@example.com>',
  to: ['player@example.com'],
  subject: 'Test mail',
  text: 'Test body',
  html: '<p>Test body</p>',
  replyTo: 'reply@example.com',
};

test('transactional email preserves the accepted Resend ID and request fields', async () => {
  const result = await sendTransactionalEmail(message, {
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
      });
      return Response.json({ id: 'resend-login-1' });
    },
  });
  assert.deepEqual(result, { ok: true, providerEmailId: 'resend-login-1' });
});

test('transactional email never propagates an ID from a rejected send', async () => {
  assert.deepEqual(
    await sendTransactionalEmail(message, {
      fetchImpl: async () => Response.json({ id: 'not-accepted' }, { status: 429 }),
    }),
    { ok: false, statusCode: 429 },
  );
  assert.deepEqual(
    await sendTransactionalEmail(message, {
      fetchImpl: async () => {
        throw new Error('network_failure');
      },
    }),
    { ok: false, error: 'network_failure' },
  );
});

test('transactional email passes both RFC 8058 headers to the provider payload', async () => {
  const { headers } = dmEmailUnsubscribe('user_123', {
    MISTBOARD_ENGINE_SECRET: 'test-only-provider-signing-key',
    MISTBOARD_HOST: 'https://mistboard.example',
  });
  const result = await sendTransactionalEmail(
    { ...message, headers },
    {
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        assert.deepEqual(payload.headers, headers);
        assert.equal(payload.reply_to, message.replyTo);
        // These are provider email headers, not HTTP transport headers.
        assert.equal(new Headers(init?.headers).has('List-Unsubscribe'), false);
        return Response.json({ id: 'resend-dm-1' });
      },
    },
  );
  assert.deepEqual(result, { ok: true, providerEmailId: 'resend-dm-1' });
});

test('transactional email preserves acceptance without inventing IDs from missing or malformed bodies', async () => {
  for (const body of ['{}', 'null', '{"id":12}', '{"id":"  "}', 'not json']) {
    assert.deepEqual(
      await sendTransactionalEmail(message, { fetchImpl: async () => new Response(body) }),
      { ok: true },
    );
  }
});

test('transactional email without configuration never calls the provider', async () => {
  delete process.env.RESEND_API_KEY;
  const modulePath = './send-email.js?unconfigured';
  const unconfigured = await import(modulePath);
  assert.deepEqual(
    await unconfigured.sendTransactionalEmail(message, {
      fetchImpl: async () => {
        throw new Error('must_not_send');
      },
    }),
    { ok: false, error: 'not_configured' },
  );
});
