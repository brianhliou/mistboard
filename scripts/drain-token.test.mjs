import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRAIN_TOKEN_KEYCHAIN_FALLBACK,
  DRAIN_TOKEN_KEYCHAIN_SERVICE,
  describeDrainToken,
  drainTokenSource,
  resolveDrainToken,
} from './lib/drain-token.mjs';

// The env var wins so a one-off `MISTBOARD_DRAIN_TOKEN=… node scripts/…` still
// overrides whatever is stored, and CI (no keychain) keeps working.
test('the environment wins over the keychain', () => {
  const previous = process.env.MISTBOARD_DRAIN_TOKEN;
  process.env.MISTBOARD_DRAIN_TOKEN = 'from-env';
  try {
    assert.equal(resolveDrainToken(), 'from-env');
    assert.equal(drainTokenSource(), 'env');
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_DRAIN_TOKEN;
    else process.env.MISTBOARD_DRAIN_TOKEN = previous;
  }
});

// A missing keychain entry, a locked keychain, and a non-macOS box all have to
// come back as "no token" rather than throwing: the callers turn null into a
// setup message, and an exception there would read as a release crash.
test('a keychain miss resolves to null instead of throwing', () => {
  const previous = process.env.MISTBOARD_DRAIN_TOKEN;
  delete process.env.MISTBOARD_DRAIN_TOKEN;
  try {
    const token = resolveDrainToken();
    assert.ok(token === null || typeof token === 'string');
    // Whatever the machine has, the two entry points must agree.
    assert.equal(drainTokenSource(), token === null ? null : 'keychain');
  } finally {
    if (previous !== undefined) process.env.MISTBOARD_DRAIN_TOKEN = previous;
  }
});

test('the keychain service name is stable', () => {
  // Renaming this strands the stored credential without any error: resolution
  // just starts returning null and every live-game release blocks again.
  assert.equal(DRAIN_TOKEN_KEYCHAIN_SERVICE, 'mistboard-drain-token');
});

// Regression: this module searched exactly one keychain item, so a token stored
// under railway-secret.mjs's `mistboard/<VAR>` convention resolved to null and
// printed the same "no token" line as never having stored one. Two naming
// conventions for one secret, and nothing said so.
test('the railway-secret item name is a recognized fallback', () => {
  assert.equal(DRAIN_TOKEN_KEYCHAIN_FALLBACK, 'mistboard/MISTBOARD_DRAIN_TOKEN');
  assert.notEqual(DRAIN_TOKEN_KEYCHAIN_FALLBACK, DRAIN_TOKEN_KEYCHAIN_SERVICE);
});

// The whole point of describeDrainToken: absent / empty / denied used to be one
// null, and only the first of those is fixed at the Railway dashboard.
test('describeDrainToken reports a status and a remedy, never the value', () => {
  const previous = process.env.MISTBOARD_DRAIN_TOKEN;
  delete process.env.MISTBOARD_DRAIN_TOKEN;
  try {
    const result = describeDrainToken();
    assert.equal(typeof result.status, 'string');
    assert.ok(result.status.length > 0);
    assert.equal(typeof result.detail, 'string');
    assert.ok(result.detail.length > 0, 'a failure must name its remedy');
    assert.equal(result.ok, resolveDrainToken() !== null);
    // Whatever this machine has, the description must never carry the secret.
    const token = resolveDrainToken();
    if (token) assert.ok(!JSON.stringify(result).includes(token));
  } finally {
    if (previous !== undefined) process.env.MISTBOARD_DRAIN_TOKEN = previous;
  }
});

test('describeDrainToken names the env var as the source when it is set', () => {
  const previous = process.env.MISTBOARD_DRAIN_TOKEN;
  process.env.MISTBOARD_DRAIN_TOKEN = 'from-env';
  try {
    const result = describeDrainToken();
    assert.equal(result.ok, true);
    assert.equal(result.source, 'env');
    assert.ok(!JSON.stringify(result).includes('from-env'));
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_DRAIN_TOKEN;
    else process.env.MISTBOARD_DRAIN_TOKEN = previous;
  }
});
