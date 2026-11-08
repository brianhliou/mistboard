import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import test, { afterEach, beforeEach, mock } from 'node:test';
import {
  compareDrainTokenFingerprints,
  DRAIN_TOKEN_KEYCHAIN_FALLBACK,
  DRAIN_TOKEN_KEYCHAIN_SERVICE,
  describeDrainToken,
  drainTokenSource,
  fingerprintDrainToken,
  listDrainTokenFingerprints,
  PROD_FINGERPRINT_COMMAND,
  parseProdFingerprint,
  resolveDrainToken,
} from './lib/drain-token.mjs';

let keychain;
beforeEach(() => {
  keychain = new Map();
  mock.method(childProcess, 'spawnSync', (command, args) => {
    assert.equal(command, 'security');
    const item = args[args.indexOf('-s') + 1];
    if (keychain.has(item)) return { status: 0, stdout: `${keychain.get(item)}\n` };
    return { status: 44, stderr: 'The specified item could not be found in the keychain.' };
  });
  syncBuiltinESMExports();
});
afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});

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
  assert.equal(DRAIN_TOKEN_KEYCHAIN_SERVICE, 'mistboard/MISTBOARD_DRAIN_TOKEN');
});

test('the old item name remains a fallback for existing installations', () => {
  assert.equal(DRAIN_TOKEN_KEYCHAIN_FALLBACK, 'mistboard-drain-token');
  assert.notEqual(DRAIN_TOKEN_KEYCHAIN_FALLBACK, DRAIN_TOKEN_KEYCHAIN_SERVICE);
});

test('a stale legacy item cannot shadow a rotated canonical token', () => {
  const previous = process.env.MISTBOARD_DRAIN_TOKEN;
  delete process.env.MISTBOARD_DRAIN_TOKEN;
  keychain.set('mistboard/MISTBOARD_DRAIN_TOKEN', 'fixture-rotated-token');
  keychain.set('mistboard-drain-token', 'fixture-stale-token');
  try {
    assert.equal(resolveDrainToken(), 'fixture-rotated-token');
    assert.equal(describeDrainToken().item, 'mistboard/MISTBOARD_DRAIN_TOKEN');
    const entries = listDrainTokenFingerprints();
    assert.equal(entries[0].item, 'mistboard/MISTBOARD_DRAIN_TOKEN');
    const prod = { unset: false, ...fingerprintDrainToken('fixture-rotated-token') };
    assert.equal(compareDrainTokenFingerprints(entries, prod).verdict, 'match');
  } finally {
    if (previous !== undefined) process.env.MISTBOARD_DRAIN_TOKEN = previous;
  }
});

test('a legacy-only installation can still resolve its token', () => {
  const previous = process.env.MISTBOARD_DRAIN_TOKEN;
  delete process.env.MISTBOARD_DRAIN_TOKEN;
  keychain.set('mistboard-drain-token', 'fixture-legacy-token');
  try {
    assert.equal(resolveDrainToken(), 'fixture-legacy-token');
    assert.equal(describeDrainToken().item, 'mistboard-drain-token');
  } finally {
    if (previous !== undefined) process.env.MISTBOARD_DRAIN_TOKEN = previous;
  }
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

// The equality check. Readability had been verified (drain:token-status) and
// the token still 401ed twice; nothing compared the two copies because neither
// may be printed. Fingerprints are the comparison, so both sides must derive
// the same one from the same bytes, and a trailing newline (the classic
// paste error) must show up as a different length.
test('the shell fingerprint the container runs matches the node fingerprint', () => {
  const value = 'not-a-real-token-0123456789';
  const out = execFileSync(
    'sh',
    [
      '-c',
      PROD_FINGERPRINT_COMMAND.replace(/sha256sum/g, 'openssl dgst -sha256 | sed "s/^.*= //"'),
    ],
    {
      env: { ...process.env, MISTBOARD_DRAIN_TOKEN: value },
      encoding: 'utf8',
    },
  );
  assert.deepEqual(parseProdFingerprint(out), { unset: false, ...fingerprintDrainToken(value) });

  const unset = execFileSync('sh', ['-c', PROD_FINGERPRINT_COMMAND], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.deepEqual(parseProdFingerprint(unset), { unset: true });
  assert.equal(parseProdFingerprint('Unauthorized\n'), null);
  assert.notEqual(fingerprintDrainToken(value).length, fingerprintDrainToken(`${value}\n`).length);
});

test('the verdict names the copy a release sends, not just whether one matches', () => {
  const a = fingerprintDrainToken('copy-a');
  const b = fingerprintDrainToken('copy-b');
  const primary = { item: DRAIN_TOKEN_KEYCHAIN_SERVICE, status: 'ok', fingerprint: a };
  const fallback = { item: DRAIN_TOKEN_KEYCHAIN_FALLBACK, status: 'ok', fingerprint: b };
  const prodB = { unset: false, ...b };

  // The release sends the first readable source. A later source holding
  // prod's value is the SHADOWED case: the fix is the earlier item, and a
  // plain "mismatch" would send the reader to the Railway dashboard instead.
  assert.equal(compareDrainTokenFingerprints([primary, fallback], prodB).verdict, 'shadowed');
  assert.equal(compareDrainTokenFingerprints([fallback, primary], prodB).verdict, 'match');
  assert.equal(compareDrainTokenFingerprints([primary], prodB).verdict, 'mismatch');
  assert.equal(
    compareDrainTokenFingerprints(
      [{ item: DRAIN_TOKEN_KEYCHAIN_SERVICE, status: 'absent', fingerprint: null }],
      prodB,
    ).verdict,
    'local-none',
  );
  assert.equal(compareDrainTokenFingerprints([primary], { unset: true }).verdict, 'prod-unset');
  assert.equal(compareDrainTokenFingerprints([primary], null).verdict, 'prod-unreadable');
});
