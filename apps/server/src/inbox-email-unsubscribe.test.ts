import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  dmEmailUnsubscribe,
  signDmEmailUnsubscribeToken,
  verifyDmEmailUnsubscribeToken,
} from './inbox-email-unsubscribe.js';

const SECRET = 'test-only-inbox-signing-secret';

test('DM unsubscribe tokens round-trip only under their key and purpose', () => {
  const token = signDmEmailUnsubscribeToken('user_123', SECRET);
  assert.equal(verifyDmEmailUnsubscribeToken(token, SECRET), 'user_123');
  assert.equal(verifyDmEmailUnsubscribeToken(token, 'other-test-key'), null);
  const [payload] = token.split('.');
  for (const purpose of ['', 'club-washington.v1.', 'inbox-email-unsubscribe.v2.']) {
    const signature = createHmac('sha256', SECRET)
      .update(`${purpose}${payload}`)
      .digest('base64url');
    assert.equal(verifyDmEmailUnsubscribeToken(`${payload}.${signature}`, SECRET), null);
  }
});

test('DM unsubscribe rejects malformed, altered and noncanonical tokens', () => {
  const token = signDmEmailUnsubscribeToken('user_123', SECRET);
  const [payload, signature] = token.split('.') as [string, string];
  for (const value of [
    null,
    '',
    'not-a-token',
    `${token}.extra`,
    `${token}\n`,
    `${payload}.`,
    `.${signature}`,
    `${payload}=.${signature}`,
    `${payload}.${signature}=`,
    `${payload}.${signature.slice(1)}`,
    `${Buffer.from('other_user').toString('base64url')}.${signature}`,
    `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`,
    'a'.repeat(4096),
  ]) {
    assert.equal(verifyDmEmailUnsubscribeToken(value, SECRET), null);
  }
  // A correctly signed but invalid user claim must still be rejected.
  for (const claim of ['', 'user\n123', 'user_123\n', 'a'.repeat(201)]) {
    assert.throws(() => signDmEmailUnsubscribeToken(claim, SECRET), /invalid_user_id/);
    const encoded = Buffer.from(claim).toString('base64url');
    const mac = createHmac('sha256', SECRET)
      .update(`inbox-email-unsubscribe.v1.${encoded}`)
      .digest('base64url');
    assert.equal(verifyDmEmailUnsubscribeToken(`${encoded}.${mac}`, SECRET), null);
  }
});

test('DM unsubscribe never signs or verifies without a configured secret, even in development', () => {
  const token = signDmEmailUnsubscribeToken('user_123', SECRET);
  for (const secret of [undefined, '', '   ']) {
    assert.throws(() => signDmEmailUnsubscribeToken('user_123', secret), /unconfigured/);
    assert.equal(verifyDmEmailUnsubscribeToken(token, secret), null);
    assert.throws(
      () =>
        dmEmailUnsubscribe('user_123', {
          NODE_ENV: 'development',
          MISTBOARD_ENGINE_SECRET: secret,
        }),
      /unconfigured/,
    );
  }
});

test('DM unsubscribe builds a signed HTTPS URL and both one-click email headers without message content', () => {
  const result = dmEmailUnsubscribe('user_123', {
    MISTBOARD_ENGINE_SECRET: SECRET,
    MISTBOARD_HOST: 'https://mistboard.example/',
  });
  const url = new URL(result.url);
  assert.equal(url.origin, 'https://mistboard.example');
  assert.equal(url.pathname, '/api/inbox/email/unsubscribe');
  assert.equal(verifyDmEmailUnsubscribeToken(url.searchParams.get('t'), SECRET), 'user_123');
  assert.deepEqual(result.headers, {
    'List-Unsubscribe': `<${result.url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
  assert.equal(
    new URL(
      dmEmailUnsubscribe('user_123', {
        MISTBOARD_ENGINE_SECRET: SECRET,
      }).url,
    ).origin,
    'https://mistboard.com',
  );
  for (const host of [
    'http://mistboard.example',
    'https://user:pass@mistboard.example',
    'invalid',
  ]) {
    assert.throws(
      () =>
        dmEmailUnsubscribe('user_123', {
          MISTBOARD_ENGINE_SECRET: SECRET,
          MISTBOARD_HOST: host,
        }),
      /host/,
    );
  }
});
