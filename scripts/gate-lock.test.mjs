import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { readLock } from './lib/release-lock.mjs';

const MODULE = new URL('./lib/gate-lock.mjs', import.meta.url).href;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const holder = {
  pid: 1234,
  worktree: '/other/worktree',
  branch: 'agent/other',
  command: 'npm run ci:quick',
  startedAt: '2026-11-14T21:50:00.000Z',
  token: 'other-holder',
};

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { file: path.join(dir, 'gate.lock'), env: {}, log() {} };
}

test('full-suite npm entry points use the machine-wide lock; targeted tests stay unlocked', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  for (const name of ['ci:quick', 'test:persistent', 'test', 'verify']) {
    assert.match(scripts[name], /^node scripts\/lib\/gate-lock\.mjs -- /, name);
  }
  for (const name of ['test:unit', 'test:tooling']) {
    assert.doesNotMatch(scripts[name], /gate-lock/, name);
  }
});

test('a second acquirer cannot run while a live holder owns the lock', async (t) => {
  const { withGateLock } = await import(MODULE);
  const options = fixture(t);
  writeFileSync(options.file, JSON.stringify(holder));
  let clock = 0;
  let ran = false;
  const sleeps = [];
  const logs = [];
  await assert.rejects(
    withGateLock(
      'npm test',
      () => {
        ran = true;
      },
      {
        ...options,
        env: { MISTBOARD_GATE_LOCK_TIMEOUT_MS: '20000' },
        isAlive: (pid) => pid === holder.pid,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
        log: (line) => logs.push(line),
      },
    ),
    /timed out.*pid 1234 in \/other\/worktree running npm run ci:quick since 2026-11-14T21:50/,
  );
  assert.equal(ran, false, 'the blocked full suite must never start');
  assert.deepEqual(sleeps, [10000, 10000]);
  assert.match(logs[0], /gate lock held by pid 1234 .*; waiting/);
  assert.deepEqual(readLock(options.file).holder, holder);
});

test('dead holders are taken over and metadata and inherited ownership are recorded', async (t) => {
  const { acquireGateLock } = await import(MODULE);
  const options = fixture(t);
  writeFileSync(options.file, JSON.stringify(holder));
  const logs = [];
  const handle = await acquireGateLock({
    ...options,
    command: 'npm test',
    worktree: '/this/worktree',
    branch: 'agent/this',
    isAlive: () => false,
    log: (line) => logs.push(line),
  });
  const actual = readLock(options.file).holder;
  assert.equal(actual.pid, process.pid);
  assert.equal(actual.worktree, '/this/worktree');
  assert.equal(actual.branch, 'agent/this');
  assert.equal(actual.command, 'npm test');
  assert.ok(Date.parse(actual.startedAt));
  assert.equal(options.env.MISTBOARD_GATE_LOCK_HELD, '1');
  assert.match(logs.join('\n'), /gate lock: took over.*pid 1234/);
  handle.release();
  assert.equal(existsSync(options.file), false);
  assert.equal(options.env.MISTBOARD_GATE_LOCK_HELD, undefined);
});

test('a waiter acquires after the holder releases', async (t) => {
  const { acquireGateLock } = await import(MODULE);
  const options = fixture(t);
  const first = await acquireGateLock(options);
  let sleeps = 0;
  const next = await acquireGateLock({
    ...options,
    env: {},
    isAlive: () => true,
    sleep: async () => {
      sleeps += 1;
      first.release();
    },
  });
  assert.equal(sleeps, 1);
  assert.equal(next.waited, true);
  next.release();
});

for (const env of [{ MISTBOARD_GATE_LOCK_HELD: '1' }, { CI: '1' }, { CI: '' }]) {
  test(`inherited ownership or CI skips all lock IO: ${JSON.stringify(env)}`, async (t) => {
    const { withGateLock } = await import(MODULE);
    const options = fixture(t);
    let ran = false;
    await withGateLock(
      'npm test',
      () => {
        ran = true;
      },
      {
        ...options,
        env,
        file: path.join(options.file, 'missing', 'gate.lock'),
        isAlive: () => assert.fail('must not check pids'),
        sleep: () => assert.fail('must not wait'),
      },
    );
    assert.equal(ran, true);
    assert.equal(existsSync(options.file), false);
  });
}

test('nested gates reuse ownership, and cleanup releases only our lock', async (t) => {
  const { withGateLock } = await import(MODULE);
  const options = fixture(t);
  await withGateLock(
    'outer',
    async () => {
      const original = readFileSync(options.file, 'utf8');
      await withGateLock('inner', () => {}, options);
      assert.equal(readFileSync(options.file, 'utf8'), original);
    },
    options,
  );
  assert.equal(existsSync(options.file), false);
  await assert.rejects(
    withGateLock(
      'failed suite',
      () => {
        throw new Error('failed stage');
      },
      options,
    ),
    /failed stage/,
  );
  assert.equal(existsSync(options.file), false);
  await withGateLock(
    'replaced',
    () => {
      writeFileSync(options.file, JSON.stringify(holder));
    },
    options,
  );
  assert.deepEqual(readLock(options.file).holder, holder);
});

test('release local gates hold one lock across inline CI and persistence', async () => {
  const source = readFileSync(new URL('./release-prod.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function runLocalGate(');
  const end = source.indexOf('\nfunction runLocalCommand(', start);
  const events = [];
  const context = vm.createContext({
    release: {},
    workdir: ROOT,
    withGateLock: async (command, run) => {
      assert.match(command, /release:prod/);
      events.push('lock');
      try {
        return await run();
      } finally {
        events.push('unlock');
      }
    },
    console: { log() {} },
    runCiChecks: async () => {
      events.push('ci');
      return { results: [], buildSucceeded: true, loopbackSucceeded: true };
    },
    runLocalCommand() {},
    runReleasePersistenceGate: async () => {
      events.push('persistent');
    },
    printGateSummary() {},
    writeGateStamp() {},
  });
  await vm.runInContext(
    `${source.slice(start, end)}\nrunLocalGate({ kind: 'full', commands: [['npm', 'run', 'ci:quick']] }, []);`,
    context,
  );
  assert.deepEqual(events, ['lock', 'ci', 'persistent', 'unlock']);
});

test('the command wrapper inherits ownership and preserves child failure and spawn errors', async (t) => {
  const { runLockedCommand } = await import(MODULE);
  const options = fixture(t);
  assert.equal(
    await runLockedCommand(
      [
        process.execPath,
        '-e',
        "process.exit(process.env.MISTBOARD_GATE_LOCK_HELD === '1' ? 23 : 99);",
      ],
      options,
    ),
    23,
  );
  assert.equal(existsSync(options.file), false);
  await assert.rejects(
    runLockedCommand([path.join(path.dirname(options.file), 'missing')], options),
    /ENOENT/,
  );
  assert.equal(existsSync(options.file), false);
});

for (const ending of ['', "throw new Error('suite failed');", 'process.exit(17);']) {
  test(`normal and failure exits remove the lock: ${ending || 'normal'}`, (t) => {
    const options = fixture(t);
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { withGateLock } from ${JSON.stringify(MODULE)};
      await withGateLock('fixture suite', () => { ${ending} }, {
        file: ${JSON.stringify(options.file)}, env: {},
      });
    `,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, ending ? (ending.includes('17') ? 17 : 1) : 0, result.stderr);
    assert.equal(existsSync(options.file), false);
  });
}

for (const [signal, code, inherited] of [
  ['SIGINT', 130, false],
  ['SIGTERM', 143, false],
  ['SIGTERM', 143, true],
]) {
  test(`the command wrapper forwards ${signal}, waits for the child, and releases (nested=${inherited})`, {
    timeout: 3000,
  }, async (t) => {
    const options = fixture(t);
    const script = `
      import { runLockedCommand } from ${JSON.stringify(MODULE)};
      process.exitCode = await runLockedCommand([process.execPath, '-e',
        "process.on('${signal}', () => { setTimeout(() => process.exit(0), 20); }); console.log('ready'); setInterval(() => {}, 100);"
      ], { file: ${JSON.stringify(options.file)}, env: ${inherited ? "{ MISTBOARD_GATE_LOCK_HELD: '1' }" : '{}'} });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('exit', () => reject(new Error(`exited before ready: ${stderr}`)));
    });
    if (!inherited) assert.equal(readLock(options.file).holder.pid, child.pid);
    child.kill(signal);
    assert.equal(await exited, code, stderr);
    assert.equal(existsSync(options.file), false);
  });
}
