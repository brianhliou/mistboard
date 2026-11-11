import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  PROVIDER_TOKEN_KEYCHAIN_SERVICE,
  storeNewProviderToken,
} from './banqi-provider-store-token.mjs';

test('credential storage refuses noninteractive or non-macOS execution before generating a value', () => {
  for (const options of [
    { interactive: false, platform: 'darwin' },
    { interactive: true, platform: 'linux' },
  ]) {
    let touched = false;
    assert.throws(
      () =>
        storeNewProviderToken({
          ...options,
          generate: () => {
            touched = true;
          },
        }),
      /interactive macOS terminal/,
    );
    assert.equal(touched, false);
  }
});

test('credential storage uses the fixed Keychain item without reading or overwriting an existing value', () => {
  const token = randomBytes(32).toString('base64url');
  let calls = 0;
  const result = storeNewProviderToken({
    interactive: true,
    platform: 'darwin',
    account: 'operator',
    generate: () => token,
    run: (command, args, options) => {
      calls++;
      assert.equal(command, '/usr/bin/security');
      assert.deepEqual(args, [
        'add-generic-password',
        '-a',
        'operator',
        '-s',
        PROVIDER_TOKEN_KEYCHAIN_SERVICE,
        '-w',
        token,
      ]);
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      return { status: 0 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result, undefined, 'the generated value is never returned');
});

test('credential storage sanitizes failures even when subprocess diagnostics contain its arguments', () => {
  const token = randomBytes(32).toString('base64url');
  assert.throws(
    () =>
      storeNewProviderToken({
        interactive: true,
        platform: 'darwin',
        account: 'operator',
        generate: () => token,
        run: () => ({ status: 45, error: new Error(token), stderr: token, stdout: token }),
      }),
    (error) =>
      !error.message.includes(token) &&
      /existing credential was left unchanged/.test(error.message),
  );
});

test('credential storage also sanitizes a thrown subprocess failure', () => {
  const token = randomBytes(32).toString('base64url');
  assert.throws(
    () =>
      storeNewProviderToken({
        interactive: true,
        platform: 'darwin',
        account: 'operator',
        generate: () => token,
        run: () => {
          throw new Error(token);
        },
      }),
    (error) => !error.message.includes(token) && /diagnostics were withheld/.test(error.message),
  );
});
