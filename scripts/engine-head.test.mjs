import assert from 'node:assert/strict';
import test from 'node:test';
import { formatEnginePin, readEngineHead } from './lib/engine-head.mjs';

const HEAD = `11cac5f${'a'.repeat(33)}`;

test('a short engine pin matches the full main HEAD', () => {
  assert.equal(formatEnginePin('11cac5f', { sha: HEAD }), 'engine_pin: current (11cac5f)');
});

test('a trailing engine pin warns with both SHAs and the exact bump command', () => {
  const line = formatEnginePin('eca5313', { sha: HEAD });
  assert.match(line, /^engine_pin: behind \(engine.ref eca5313, mistboard-engine main 11cac5f\)/);
  assert.match(
    line,
    /run node scripts\/deploy-engine-worker.mjs --bump and commit it into this batch/,
  );
  assert.match(line, /next engine-worker deploy refuses/);
  assert.doesNotMatch(line, /current/);
});

test('lookup failure and invalid refs report unknown without throwing', () => {
  assert.equal(
    formatEnginePin('eca5313', { error: 'SSH unavailable' }),
    'engine_pin: unknown (SSH unavailable)',
  );
  assert.match(formatEnginePin('main', { sha: HEAD }), /^engine_pin: unknown/);
  assert.match(formatEnginePin('eca5313', { sha: '' }), /^engine_pin: unknown/);
});

test('shared lookup defaults to main, respects a deploy ref, and bounds noninteractive SSH', () => {
  for (const ref of [undefined, 'release-candidate']) {
    const result = readEngineHead({
      ref,
      run(command, args, options) {
        assert.equal(command, 'git');
        assert.deepEqual(args, [
          'ls-remote',
          'git@github.com:brianhliou/mistboard-engine.git',
          ref ?? 'main',
        ]);
        assert.equal(options.timeout, 5_000);
        assert.equal(options.killSignal, 'SIGKILL');
        assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
        assert.match(options.env.GIT_SSH_COMMAND, /BatchMode=yes/);
        assert.match(options.env.GIT_SSH_COMMAND, /ConnectTimeout=3/);
        return { status: 0, stdout: `${HEAD}\trefs/heads/main\n` };
      },
    });
    assert.deepEqual(result, { sha: HEAD });
  }
});

test('shared lookup returns safe errors for SSH failure, timeout, spawn failure and malformed output', () => {
  for (const response of [
    { status: 128, stderr: 'fixture-private-value' },
    { status: null, error: { code: 'ETIMEDOUT' } },
    { status: null, error: { code: 'ENOENT' } },
    { status: 0, stdout: 'fixture-private-value' },
    { status: 0, stdout: '' },
  ]) {
    const result = readEngineHead({ run: () => response });
    assert.equal(typeof result.error, 'string');
    assert.equal(result.sha, undefined);
    assert.match(formatEnginePin('eca5313', result), /^engine_pin: unknown/);
    assert.doesNotMatch(result.error, /fixture-private-value/);
  }
  assert.equal(
    readEngineHead({
      run() {
        throw new Error('fixture-private-value');
      },
    }).error,
    'git ls-remote could not start',
  );
});
