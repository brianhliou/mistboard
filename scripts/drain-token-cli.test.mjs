import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROTATED = 'fixture-rotated-token';
const STALE = 'fixture-stale-token';

// Run the real CLI with all Keychain/Railway calls replaced before its imports
// load. No real credentials, project link, network, or temporary files needed.
const runner = `
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const fixture = JSON.parse(process.argv[1]);
const calls = [];
process.on('exit', () => console.log('fixture-calls:' + JSON.stringify(calls)));
childProcess.spawnSync = (command, args) => {
  if (command === 'security') {
    const item = args[args.indexOf('-s') + 1];
    calls.push('security:' + item);
    const value = item === 'mistboard/MISTBOARD_DRAIN_TOKEN' ? fixture.canonical
      : item === 'mistboard-drain-token' ? fixture.legacy : 'fixture-other-secret';
    return value === undefined
      ? { status: 44, stderr: 'The specified item could not be found in the keychain.' }
      : { status: 0, stdout: value + '\\n' };
  }
  if (command === 'railway') {
    calls.push('railway:' + args[0]);
    if (args[0] === 'status') return { status: 0, stdout: 'edd519d3-638e-40da-81b4-a8a70eb7eb94' };
    if (args[0] === 'variables') return { status: fixture.pushStatus ?? 0, stdout: fixture.canonical };
    if (args[0] === 'ssh') {
      const sha = createHash('sha256').update(fixture.prod).digest('hex').slice(0, 12);
      return { status: 0, stdout: sha + ' ' + Buffer.byteLength(fixture.prod) + '\\n' };
    }
  }
  throw new Error('Unexpected subprocess: ' + command);
};
syncBuiltinESMExports();
process.argv = [process.execPath, fixture.script, ...fixture.args];
await import(fixture.script);
`;

function run(script, fixture = {}) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      runner,
      JSON.stringify({
        script: new URL(script, import.meta.url).href,
        args: ['--service', 'web', '--var', 'MISTBOARD_DRAIN_TOKEN'],
        canonical: ROTATED,
        legacy: STALE,
        prod: ROTATED,
        ...fixture,
      }),
    ],
    {
      env: {
        PATH: process.env.PATH,
        USER: 'fixture-user',
        MISTBOARD_DRAIN_TOKEN: fixture.override ?? '',
      },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  for (const value of [ROTATED, STALE, 'fixture-other-secret']) {
    assert.ok(!output.includes(value), 'the CLI must not print fixture secret values');
  }
  const audit = result.stdout.split('\n').find((line) => line.startsWith('fixture-calls:'));
  assert.ok(audit, result.stderr);
  return { ...result, calls: JSON.parse(audit.slice('fixture-calls:'.length)) };
}

test('token-check rejects a planted stale legacy token when canonical is absent', () => {
  const result = run('./drain-token-check.mjs', { args: ['--json'], canonical: undefined });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout.split('\n')[0]).verdict, 'mismatch');
});

test('token-check selects the canonical token despite a planted stale legacy item', () => {
  const result = run('./drain-token-check.mjs', { args: ['--json'] });
  assert.equal(result.status, 0, result.stderr);
  const verdict = JSON.parse(result.stdout.split('\n')[0]);
  assert.equal(verdict.verdict, 'match');
  assert.equal(verdict.active.item, 'mistboard/MISTBOARD_DRAIN_TOKEN');
});

test('a drain token push verifies the active release copy after the write', () => {
  const result = run('./railway-secret.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /drain token.*matches.*pushed/i);
  assert.ok(
    result.calls.lastIndexOf('security:mistboard/MISTBOARD_DRAIN_TOKEN') >
      result.calls.indexOf('railway:variables'),
    'verification must happen after Railway accepts the write',
  );
});

test('a push fails loudly when a stale environment token would win the release lookup', () => {
  const result = run('./railway-secret.mjs', { override: STALE });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /drain token.*SHADOWED/);
  assert.match(result.stderr, /already.*set/i);
  assert.equal(result.calls.filter((call) => call === 'railway:variables').length, 1);
});

test('an inline drain token push also detects a different active Keychain copy', () => {
  const result = run('./railway-secret.mjs', {
    args: ['--service', 'web', '--set', 'MISTBOARD_DRAIN_TOKEN=fixture-other-token'],
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /drain token.*MISMATCH/);
  assert.ok(!(result.stdout + result.stderr).includes('fixture-other-token'));
});

test('dry runs, unrelated secrets, and failed writes do not run the drain comparison', () => {
  for (const fixture of [
    { args: ['--service', 'web', '--var', 'MISTBOARD_DRAIN_TOKEN', '--dry-run'] },
    { args: ['--service', 'web', '--var', 'OTHER_SECRET'] },
    { pushStatus: 1 },
  ]) {
    const result = run('./railway-secret.mjs', fixture);
    assert.equal(result.status, fixture.pushStatus ?? 0, result.stderr);
    assert.equal(result.calls.filter((call) => call.startsWith('security:')).length, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /drain token/);
  }
});
