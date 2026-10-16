import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  acquireReleaseLock,
  isPidAlive,
  lockInfo,
  readLock,
  releaseLock,
  tryAcquireLock,
} from './lib/release-lock.mjs';

const MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'release-lock.mjs');

function tempLock(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A missing parent directory is created on first use.
  return path.join(dir, 'nested', 'release.lock');
}

const info = (overrides = {}) => ({
  ...lockInfo({ worktree: '/w/task', branch: 'agent/task', head: 'a'.repeat(40) }),
  ...overrides,
});

// The pid of a process that has exited, so nothing holds it.
function deadPid() {
  const result = spawnSync(process.execPath, ['-e', '']);
  assert.ok(!isPidAlive(result.pid));
  return result.pid;
}

test('an uncontested lock is taken and records who holds it', async (t) => {
  const file = tempLock(t);
  const mine = info();
  const handle = await acquireReleaseLock({ file, info: mine, log: () => {} });
  const { holder } = readLock(file);
  assert.equal(holder.pid, process.pid);
  assert.equal(holder.worktree, '/w/task');
  assert.equal(holder.branch, 'agent/task');
  assert.equal(holder.head, 'a'.repeat(40));
  assert.ok(Date.parse(holder.startedAt) > 0);
  assert.equal(handle.waited, false);
  assert.equal(handle.release(), true);
  assert.equal(existsSync(file), false);
});

test('a stale lock (dead pid) is taken over and the takeover is said out loud', async (t) => {
  const file = tempLock(t);
  const pid = deadPid();
  tryAcquireLock(file, info({ pid, token: 'old' }));
  const logs = [];
  const mine = info();
  await acquireReleaseLock({ file, info: mine, log: (line) => logs.push(line) });
  assert.equal(readLock(file).holder.token, mine.token);
  assert.match(logs.join('\n'), new RegExp(`took over a stale lock from pid ${pid}`));
});

test('a live holder makes the caller wait, then time out naming the holder', async (t) => {
  const file = tempLock(t);
  // The test runner's parent process is alive for the whole test.
  tryAcquireLock(file, info({ pid: process.ppid, token: 'live', worktree: '/w/other' }));
  const logs = [];
  let clock = 0;
  const sleeps = [];
  await assert.rejects(
    acquireReleaseLock({
      file,
      info: info(),
      timeoutMs: 30_000,
      pollMs: 10_000,
      log: (line) => logs.push(line),
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    }),
    new RegExp(`timed out after .* waiting for pid ${process.ppid}.*in /w/other`),
  );
  assert.deepEqual(sleeps, [10_000, 10_000, 10_000]);
  assert.match(logs[0], /held by pid \d+ .*in \/w\/other on agent\/task at a{12}; waiting for it/);
  // The holder's lock is untouched.
  assert.equal(readLock(file).holder.token, 'live');
});

test('a waiter takes the lock once the live holder releases it', async (t) => {
  const file = tempLock(t);
  const holder = info({ pid: process.ppid, token: 'live' });
  tryAcquireLock(file, holder);
  let polls = 0;
  const mine = info();
  const handle = await acquireReleaseLock({
    file,
    info: mine,
    pollMs: 1,
    log: () => {},
    sleep: async () => {
      polls += 1;
      if (polls === 2) releaseLock(file, holder);
    },
  });
  assert.equal(handle.waited, true);
  assert.equal(readLock(file).holder.token, mine.token);
});

test('release leaves a lock that is no longer ours alone', (t) => {
  const file = tempLock(t);
  const mine = info();
  tryAcquireLock(file, mine);
  writeFileSync(file, JSON.stringify(info({ token: 'someone-else' })));
  assert.equal(releaseLock(file, mine), false);
  assert.equal(readLock(file).holder.token, 'someone-else');
});

// A child process that takes the lock, installs releaseOnExit, then dies the
// way a release does: a thrown error, process.exit(1), or a signal.
function holderScript(file, ending) {
  return `
    import { acquireReleaseLock, lockInfo, releaseOnExit } from ${JSON.stringify(MODULE)};
    const handle = await acquireReleaseLock({
      file: ${JSON.stringify(file)},
      info: lockInfo({ worktree: 'w', branch: 'b', head: 'h' }),
      log: () => {},
    });
    releaseOnExit(handle);
    console.log('locked');
    ${ending}
  `;
}

function runHolder(file, ending) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', holderScript(file, ending)], {
    encoding: 'utf8',
  });
}

test('the lock is released when the release throws', (t) => {
  const file = tempLock(t);
  const result = runHolder(file, "throw new Error('ci failed');");
  assert.match(result.stdout, /locked/);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ci failed/);
  assert.equal(existsSync(file), false);
});

test('the lock is released on process.exit(1) from a failure path', (t) => {
  const file = tempLock(t);
  const result = runHolder(file, 'process.exit(1);');
  assert.equal(result.status, 1);
  assert.equal(existsSync(file), false);
});

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  test(`the lock is released on ${signal}`, async (t) => {
    const file = tempLock(t);
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', holderScript(file, 'setInterval(() => {}, 1000);')],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await new Promise((resolve) => child.stdout.once('data', resolve));
    assert.equal(readLock(file).holder.pid, child.pid);
    const exited = new Promise((resolve) => child.on('exit', (status) => resolve(status)));
    child.kill(signal);
    assert.equal(await exited, code);
    assert.equal(existsSync(file), false);
  });
}

test('an unreadable lock file is respected briefly, then treated as stale', (t) => {
  const file = tempLock(t);
  tryAcquireLock(file, info());
  writeFileSync(file, '');
  assert.equal(tryAcquireLock(file, info(), { now: () => Date.now() }).acquired, false);
  const later = tryAcquireLock(file, info({ token: 'next' }), {
    now: () => Date.now() + 60_000,
  });
  assert.equal(later.acquired, true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, 'next');
});
