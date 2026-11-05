import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Exercise the real CLIs and their exit paths. Only external commands and
// sockets are doubled; planted commands are real child processes with chosen
// exit codes. No git/network operation can escape this fixture.
const PRELOAD = `
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
const originalSpawn = cp.spawnSync;
const failures = JSON.parse(process.env.GATE_FIXTURE_FAILURES);
const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
cp.spawnSync = (command, args, options) => {
  appendFileSync(process.env.GATE_FIXTURE_CALLS, JSON.stringify([command, ...args]) + '\\n');
  if (command === 'git') {
    if (args[0] === 'status' || args[0] === 'fetch') return ok();
    if (args[0] === 'ls-files') return ok((failures.untrackedFiles ?? []).join('\\n'));
    if (args[0] === 'ls-remote') return ok(base + '\\trefs/heads/main');
    if (args[0] === 'log') return ok('2020-01-01T00:00:00Z');
    if (args[0] === 'rev-parse') return ok(args.includes('--abbrev-ref') ? 'agent/fixture' : args.at(-1) === 'HEAD' ? head : base);
    if (args[0] === 'merge-base') return ok(base);
    if (args[0] === 'diff' && args.at(-1) === 'origin/main') {
      if (failures.gitDiff) return { status: 1, stderr: 'fixture missing origin/main' };
      return ok([...(failures.files ?? []), ...(failures.dirtyFiles ?? [])].join('\\n'));
    }
    if (args[0] === 'diff') return ok((args.includes('HEAD')
      ? (failures.dirtyFiles ?? [])
      : (failures.files ?? ['apps/server/src/persistence.ts'])).join('\\n'));
    throw new Error('unexpected git operation: ' + args.join(' '));
  }
  if (args[0] === 'scripts/prod-smoke-plan.mjs') {
    return ok('prod-smoke-plan: deploy_required=false\\nreason: fixture');
  }
  if (args[0] === 'scripts/pre-push-check.mjs' && args.includes('--plan')) {
    return originalSpawn(command, args, options);
  }
  if (command === 'node' && args[0] === 'scripts/audit-prod-deps.mjs') {
    return { status: failures.audit ?? 0 };
  }
  if (command === 'npx' && args.includes('packages/game/src/variants-benedict-xiangqi.test.ts')) {
    if (options.env?.MISTBOARD_DEEP_PERFT !== '1') throw new Error('deep perft was not enabled');
    return { status: failures.perft ?? 0 };
  }
  // The release normally uses time-command to preserve stage timings.
  if (args[0] === 'scripts/time-command.mjs') {
    const offset = args.indexOf('--');
    return cp.spawnSync(args[offset + 1], args.slice(offset + 2), options);
  }
  if (command === 'npm' && args[0] === 'run') {
    if (failures.preshipEnv && args[1] === 'test:integration' && options.env?.MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE !== 'true') {
      throw new Error('integration did not use the hosted environment');
    }
    const code = failures[args.slice(1).join(' ')] ?? failures[args[1]] ?? 0;
    if (code === 'signal') return { status: null, signal: 'SIGTERM' };
    if (code === 'spawn') return { status: null, error: new Error('fixture ENOENT') };
    return originalSpawn(process.execPath, ['-e', 'process.exit(' + code + ')'], options);
  }
  throw new Error('unexpected command: ' + command + ' ' + args.join(' '));
};
let onConnection;
net.createServer = (callback) => {
  onConnection = callback;
  const server = new EventEmitter();
  server.address = () => ({ port: 12345 });
  server.close = () => {};
  server.listen = (_port, _host, callback) => queueMicrotask(() => {
    if (failures.loopback) server.emit('error', new Error('fixture EPERM'));
    else callback();
  });
  return server;
};
// tsx (imported by release-prod) dials its parent's IPC pipe by path on load;
// only the TCP loopback preflight is doubled here.
const originalCreateConnection = net.createConnection;
net.createConnection = (...args) => {
  if (typeof args[0] === 'string') return originalCreateConnection(...args);
  const client = new EventEmitter();
  client.destroy = () => {};
  queueMicrotask(() => {
    const accepted = new EventEmitter();
    accepted.end = () => {};
    accepted.destroy = () => {};
    onConnection(accepted);
    client.emit('data', Buffer.from('ok'));
  });
  return client;
};
net.connect = () => {
  const socket = new EventEmitter();
  socket.destroy = () => {};
  queueMicrotask(() => socket.emit('connect'));
  return socket;
};
globalThis.fetch = () => { throw new Error('unexpected network request'); };
syncBuiltinESMExports();
`;

function fixture(script, args, failures) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mistboard-gate-'));
  const preload = path.join(dir, 'preload.mjs');
  const callsFile = path.join(dir, 'calls.jsonl');
  const lockFile = path.join(dir, 'release.lock');
  const logFile = path.join(dir, 'releases.jsonl');
  writeFileSync(preload, PRELOAD);
  const result = spawnSync(process.execPath, ['--import', preload, script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      MISTBOARD_RELEASE_LOCK: lockFile,
      MISTBOARD_RELEASE_LOG: logFile,
      MISTBOARD_SKIP_PREPUSH_DB: '0',
      MISTBOARD_RUN_DB_CHECKS: '1',
      GATE_FIXTURE_CALLS: callsFile,
      GATE_FIXTURE_FAILURES: JSON.stringify(failures),
    },
  });
  assert.equal(result.error, undefined);
  const output = result.stdout + result.stderr;
  const calls = existsSync(callsFile)
    ? readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse)
    : [];
  const summary = output.slice(output.indexOf('# gate summary'));
  return { ...result, output, summary, calls, lockFile, logFile };
}

const ran = (calls, script) =>
  calls.some((call) => {
    const line = call.join(' ');
    return line === `npm run ${script}` || line.startsWith(`npm run ${script} `);
  });

test('preship includes every quick stage and all five hosted-only checks', () => {
  const quick = fixture('scripts/ci-checks.mjs', ['quick'], {});
  const result = fixture('scripts/ci-checks.mjs', ['preship'], {
    files: ['apps/web/src/study.ts'],
    preshipEnv: true,
  });
  assert.equal(result.status, 0, result.output);
  const commands = result.calls.filter((call) => call[0] !== 'git');
  assert.deepEqual(commands.slice(0, quick.calls.length), quick.calls);
  assert.deepEqual(commands.slice(quick.calls.length), [
    ['npm', 'run', 'test:integration', '--workspace', '@mistboard/server'],
    ['npm', 'run', 'test:puzzles:corpus'],
    ['npx', 'tsx', '--test', 'packages/game/src/variants-benedict-xiangqi.test.ts'],
    ['node', 'scripts/audit-prod-deps.mjs'],
    ['npm', 'run', 'test:study:persistent'],
  ]);
  assert.ok(result.calls.some((call) => call[0] === 'git' && call.at(-1) === 'origin/main'));
  for (const command of commands) {
    const line = result.summary.split('\n').find((entry) => entry.includes(command.join(' ')));
    assert.match(line ?? '', /passed.*\d+\.\d+s/, command.join(' '));
  }
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['ci:preship'], 'node scripts/ci-checks.mjs preship');
});

test('preship reports all failures and still runs the final browser check', () => {
  const result = fixture('scripts/ci-checks.mjs', ['preship', '--no-keep-going'], {
    files: ['apps/web/src/study.ts'],
    lint: 7,
    'test:integration': 8,
    'test:puzzles:corpus': 9,
    perft: 10,
    audit: 11,
    'test:study:persistent': 12,
  });
  assert.equal(result.status, 1, result.output);
  for (const code of [7, 8, 9, 10, 11, 12]) {
    assert.match(result.summary, new RegExp(`exit ${code}[;) ]`));
  }
  assert.ok(ran(result.calls, 'test:study:persistent'));
  assert.match(result.summary, /ci:preship: 6 failed/);
});

test('preship skips browser smoke with a logged reason for unrelated paths', () => {
  const result = fixture('scripts/ci-checks.mjs', ['preship'], {
    files: ['apps/server/src/persistence.ts', 'packages/game/src/index.ts'],
  });
  assert.equal(result.status, 0, result.output);
  assert.equal(ran(result.calls, 'test:study:persistent'), false);
  assert.match(result.output, /skip:.*test:study:persistent.*no_browser_smoke_pattern_match/);
  assert.ok(ran(result.calls, 'test:integration'));
  assert.ok(ran(result.calls, 'test:puzzles:corpus'));
});

test('preship uses every browser smoke pattern shared with hosted CI', () => {
  for (const file of [
    '.github/workflows/ci.yml',
    'apps/web/src/study.ts',
    'packages/board-render/src/index.ts',
    'package.json',
    'package-lock.json',
    'scripts/ci-browser-smoke-plan.mjs',
  ]) {
    const result = fixture('scripts/ci-checks.mjs', ['preship'], { files: [file] });
    assert.equal(result.status, 0, result.output);
    assert.ok(ran(result.calls, 'test:study:persistent'), file);
  }
});

test('preship considers dirty and untracked browser fixes before a commit', () => {
  for (const field of ['dirtyFiles', 'untrackedFiles']) {
    const result = fixture('scripts/ci-checks.mjs', ['preship'], {
      files: ['docs/operations.md'],
      [field]: ['apps/web/src/study.ts'],
    });
    assert.equal(result.status, 0, result.output);
    assert.ok(ran(result.calls, 'test:study:persistent'), field);
  }
});

test('preship conservatively includes browser smoke for an empty or unknown diff', () => {
  for (const failures of [{ files: [] }, { gitDiff: true }]) {
    const result = fixture('scripts/ci-checks.mjs', ['preship'], failures);
    assert.equal(result.status, 0, result.output);
    assert.ok(ran(result.calls, 'test:study:persistent'), result.output);
  }
});

test('the shared browser planner preserves its hosted CLI outputs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mistboard-browser-plan-'));
  const output = path.join(dir, 'github-output.txt');
  const summary = path.join(dir, 'summary.md');
  const result = spawnSync(
    process.execPath,
    [
      'scripts/ci-browser-smoke-plan.mjs',
      '--file',
      'apps/web/src/study.ts',
      '--github-output',
      output,
      '--summary',
      summary,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /run_browser_smoke=true/);
  assert.match(readFileSync(output, 'utf8'), /reason=browser_smoke_pattern_match/);
  assert.match(readFileSync(summary, 'utf8'), /Browser smoke: \*\*run\*\*/);
});

test('a web and a server unit failure are both reported in one run', () => {
  const result = fixture('scripts/ci-checks.mjs', ['quick'], {
    'test:unit --workspace @mistboard/web': 3,
    'test:unit --workspace @mistboard/server': 4,
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.summary, /npm run test:unit --workspace @mistboard\/web.*exit 3/);
  assert.match(result.summary, /npm run test:unit --workspace @mistboard\/server.*exit 4/);
  assert.match(result.summary, /npm run test:unit --workspace @mistboard\/game.*passed/);
  assert.match(result.summary, /npm run test:tooling.*passed/);
});

test('quick reports two planted command failures together and exits 1', () => {
  const result = fixture('scripts/ci-checks.mjs', ['quick'], { lint: 7, 'test:unit': 9 });
  assert.equal(result.status, 1, result.output);
  assert.ok(ran(result.calls, 'check:cycles'), 'must reach the last independent command');
  assert.match(result.summary, /npm run lint.*exit 7/);
  assert.match(result.summary, /npm run test:unit.*exit 9/);
  assert.doesNotMatch(result.output, /ci:quick: ok/);
});

test('failed build skips dist consumers while independent checks still run', () => {
  const result = fixture('scripts/ci-checks.mjs', ['local', '--keep-going'], { build: 5 });
  assert.equal(result.status, 1, result.output);
  assert.ok(ran(result.calls, 'check:cycles'));
  assert.equal(ran(result.calls, 'test:unit'), false);
  assert.equal(ran(result.calls, 'test:persistent'), false);
  assert.equal(
    result.calls.some((call) => call.includes('test:integration')),
    false,
  );
  assert.match(result.summary, /npm run test:unit.*skipped: build failed/);
  assert.match(result.summary, /npm run test:integration.*skipped: build failed/);
  assert.match(result.summary, /npm run test:persistent.*skipped: build failed/);
});

test('explicit fail-fast remains available', () => {
  const result = fixture('scripts/ci-checks.mjs', ['quick', '--no-keep-going'], { lint: 7 });
  assert.equal(result.status, 1, result.output);
  assert.equal(ran(result.calls, 'build'), false);
});

test('a failed loopback preflight still runs independent checks and skips tests', () => {
  const result = fixture('scripts/ci-checks.mjs', ['quick'], { loopback: 1, lint: 7 });
  assert.equal(result.status, 1, result.output);
  assert.ok(ran(result.calls, 'build'));
  assert.ok(ran(result.calls, 'check:cycles'));
  assert.equal(ran(result.calls, 'test:unit'), false);
  assert.match(result.summary, /loopback preflight.*fixture EPERM/);
  assert.match(result.summary, /npm run lint.*exit 7/);
  assert.match(result.summary, /npm run test:unit.*skipped: loopback preflight failed/);
});

test('signals and spawn failures are failures and do not hide later commands', () => {
  const result = fixture('scripts/ci-checks.mjs', ['quick'], {
    lint: 'signal',
    'i18n:check': 'spawn',
  });
  assert.equal(result.status, 1, result.output);
  assert.ok(ran(result.calls, 'check:cycles'));
  assert.match(result.summary, /npm run lint.*SIGTERM/);
  assert.match(result.summary, /npm run i18n:check.*fixture ENOENT/);
});

test('release runs persistence after failed quick checks and summarizes both', () => {
  const result = fixture('scripts/release-prod.mjs', ['--push', '--full-ci'], {
    lint: 7,
    'test:persistent': 9,
  });
  assert.equal(result.status, 1, result.output);
  assert.ok(ran(result.calls, 'test:persistent'), result.output);
  assert.match(result.summary, /npm run lint.*exit 7/);
  assert.match(result.summary, /npm run test:persistent.*exit 9/);
  assert.equal(
    result.calls.some((call) => call[0] === 'git' && call[1] === 'push'),
    false,
  );
});

test('release never pushes when only persistence fails', () => {
  const result = fixture('scripts/release-prod.mjs', ['--push', '--full-ci'], {
    'test:persistent': 9,
  });
  assert.equal(result.status, 1, result.output);
  assert.ok(ran(result.calls, 'test:persistent'));
  assert.match(result.summary, /npm run test:persistent.*exit 9/);
  assert.equal(
    result.calls.some((call) => call[0] === 'git' && call[1] === 'push'),
    false,
  );
});

test('a targeted release still runs persistence after an unrelated lint failure', () => {
  const result = fixture('scripts/release-prod.mjs', ['--push'], {
    lint: 7,
    'test:persistent': 9,
  });
  assert.equal(result.status, 1, result.output);
  assert.ok(ran(result.calls, 'test:persistent'), result.output);
  assert.match(result.summary, /npm run lint.*exit 7/);
  assert.match(result.summary, /npm run test:persistent.*exit 9/);
  assert.equal(
    result.calls.some((call) => call[0] === 'git' && call[1] === 'push'),
    false,
  );
});

test('release skips persistence on a failed build', () => {
  const result = fixture('scripts/release-prod.mjs', ['--push', '--full-ci'], { build: 5 });
  assert.equal(result.status, 1, result.output);
  assert.equal(ran(result.calls, 'test:persistent'), false);
  assert.match(result.summary, /npm run test:persistent.*skipped: build failed/);
});

test('gate-only runs the full release gate without release side effects', () => {
  const result = fixture('scripts/release-prod.mjs', ['--gate-only'], {});
  assert.equal(result.status, 0, result.output);
  assert.ok(ran(result.calls, 'build'));
  assert.ok(ran(result.calls, 'test:unit'));
  assert.ok(ran(result.calls, 'test:persistent'));
  assert.equal(existsSync(result.logFile), false, 'must not write a release record');
  assert.doesNotMatch(result.output, /release lock: held/);
  assert.equal(existsSync(result.lockFile), false);
  assert.ok(
    result.calls
      .filter((call) => call[0] === 'git')
      .every((call) => ['rev-parse', 'diff', 'ls-files'].includes(call[1])),
    'gate-only must use local refs, without status, fetch, merge, commit or push',
  );
});

test('gate-only selects persistence for uncommitted and untracked fixes', () => {
  for (const field of ['dirtyFiles', 'untrackedFiles']) {
    const result = fixture('scripts/release-prod.mjs', ['--gate-only'], {
      files: [],
      [field]: ['apps/server/src/persistence.ts'],
      'test:persistent': 9,
    });
    assert.equal(result.status, 1, result.output);
    assert.ok(ran(result.calls, 'test:persistent'));
    assert.match(result.summary, /npm run test:persistent.*exit 9/);
    assert.equal(existsSync(result.logFile), false);
    assert.doesNotMatch(result.output, /release lock: held/);
  }
});

test('gate-only keeps persistence conditional on the changed paths', () => {
  const result = fixture('scripts/release-prod.mjs', ['--gate-only'], {
    files: ['apps/web/src/main.ts'],
  });
  assert.equal(result.status, 0, result.output);
  assert.equal(ran(result.calls, 'test:persistent'), false);
});

test('gate-only rejects push and changelog options before running commands', () => {
  for (const args of [['--push'], ['--changelog', 'Technical: Improve the release gate']]) {
    const result = fixture('scripts/release-prod.mjs', ['--gate-only', ...args], {});
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /--gate-only/);
    assert.deepEqual(result.calls, []);
  }
});
