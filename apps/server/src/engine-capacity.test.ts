import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, mock, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

// Configure only synthetic credentials before obs/send-email are first imported.
process.env.RESEND_API_KEY = 'test-key-not-a-secret';
process.env.MISTBOARD_ALERT_EMAIL_FROM = 'ops@example.test';
process.env.MISTBOARD_ALERT_EMAIL_TO = 'oncall@example.test';
// Every delivery in this file stays offline, including unexpected timeout paths.
const fetchGuard = mock.method(
  globalThis,
  'fetch',
  async () => new Response('{}', { status: 200 }),
);
after(() => fetchGuard.mock.restore());
const {
  aggregateEnginePoolStats,
  runUciBestmove,
  runUciEval,
  runUciMultiPv,
  UciEnginePool,
  UciEngineSession,
  UciWarmSessionCache,
} = await import('./uci-engine-harness.js');
const { katagoJungleMove } = await import('./jungle-katago-engine.js');

function pool(name: string, timeout = 5_000) {
  return new UciEnginePool({
    name,
    maxProcessesEnvVar: 'TEST_CAPACITY_POOL_MAX',
    queueTimeoutEnvVar: 'TEST_CAPACITY_POOL_TIMEOUT',
    defaultMaxProcesses: 1,
    defaultQueueTimeoutMs: timeout,
    queueTimeoutMessage: 'capacity test queue timed out',
  });
}

function setEnv(t: TestContext, name: string, value: string) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

function captureEmails(t: TestContext) {
  const bodies: Array<{ subject: string; text: string }> = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: 200 });
  });
  return bodies;
}

test('a planted slow wait logs once and emails a daily digest; fast acquires stay silent', async (t) => {
  const bodies = captureEmails(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  const { logger } = await import('./obs.js');
  const warnings: unknown[] = [];
  t.mock.method(logger, 'warn', (fields: unknown) => warnings.push(fields));
  const p = pool('wait-digest');
  const release = await p.acquire();
  release();
  t.mock.timers.tick(1_001);
  assert.equal(bodies.length, 0);
  assert.equal(warnings.length, 0);

  const held = await p.acquire();
  const queued = p.acquire();
  t.mock.timers.tick(1_001);
  assert.equal(warnings.length, 1, 'warn while the request is still waiting');
  assert.deepEqual(warnings[0], {
    kind: 'engine_pool_queue_wait',
    pool: 'wait-digest',
    wait_ms: 1_001,
    queue_depth: 1,
  });
  assert.equal(bodies.length, 0, 'waits are digested, not paged immediately');
  await Promise.resolve(); // persist-or-memory routing settles outside the timer callback
  held();
  (await queued)();
  // Include another slow wait in the same digest, rather than losing it to a throttle.
  const heldAgain = await p.acquire();
  const queuedAgain = p.acquire();
  t.mock.timers.tick(1_001);
  await Promise.resolve();
  heldAgain();
  (await queuedAgain)();
  t.mock.timers.tick(24 * 60 * 60 * 1_000);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0]!.subject, /WARNING engine_pool_queue_wait/);
  assert.match(bodies[0]!.text, /wait_count: 2/);
  assert.match(bodies[0]!.text, /wait-digest/);
  assert.match(bodies[0]!.text, /max_queue_depth/);
});

test('a planted drop emails promptly, throttles repeats, and does not mask another pool', async (t) => {
  const bodies = captureEmails(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_100_000_000 });
  for (const name of ['drop-a', 'drop-a', 'drop-b']) {
    const p = pool(name, 100);
    const release = await p.acquire();
    const rejected = assert.rejects(p.acquire(), /capacity test queue timed out/);
    t.mock.timers.tick(100);
    await rejected;
    release();
  }
  assert.equal(bodies.length, 2);
  assert.match(bodies[0]!.subject, /CRITICAL engine_pool_queue_timeout/);
  assert.match(bodies[0]!.text, /pool: drop-a/);
  assert.match(bodies[1]!.text, /pool: drop-b/);
});

const fixture = mkdtempSync(join(tmpdir(), 'engine-capacity-'));
const events = join(fixture, 'events');
writeFileSync(events, '');
const bin = join(fixture, 'engine.mjs');
writeFileSync(
  bin,
  `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const log = (event) => appendFileSync(${JSON.stringify(events)}, event + '\\n');
log('start');
let buffer = '';
process.stdin.on('data', (data) => {
  buffer += data;
  let nl;
  while ((nl = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line === 'uci') process.stdout.write('uciok\\n');
    if (line === 'isready') process.stdout.write('readyok\\n');
    if (line.startsWith('go')) process.stdout.write('bestmove a0a1\\n');
  }
});
process.stdin.on('end', () => setTimeout(() => {
  log('stop');
  process.stdout.write('= A1\\n= B1\\n');
}, 150));
`,
  { mode: 0o755 },
);

const spec = { bin, initCommands: ['uci', 'isready'] };
const started = () =>
  readFileSync(events, 'utf8')
    .split('\n')
    .filter((e) => e === 'start').length;

test('the total guard evicts a parked tier before admitting another, across caches', async (t) => {
  setEnv(t, 'MISTBOARD_ENGINE_MAX_PROCESSES', '1');
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_800_200_000_000 });
  const a = new UciWarmSessionCache({ name: 'capacity-a' });
  const b = new UciWarmSessionCache({ name: 'capacity-b' });
  try {
    await a.withSession(spec, (session) => session.ready());
    assert.equal(a.stats().idle, 1);
    t.mock.timers.tick(60_000); // the idle sweeper replaces its retained list
    await b.withSession({ ...spec, initCommands: ['uci', 'ucinewgame', 'isready'] }, (s) =>
      s.ready(),
    );
    assert.equal(a.stats().idle, 0, 'the parked process was evicted');
    assert.equal(a.stats().discarded, 1);
    assert.equal(b.stats().idle, 1);
  } finally {
    a.closeAll();
    b.closeAll();
  }
});

test('the total guard queues behind active sessions and evicts one that parks later', async (t) => {
  setEnv(t, 'MISTBOARD_ENGINE_MAX_PROCESSES', '1');
  const cache = new UciWarmSessionCache({ name: 'capacity-late-park' });
  let returnToCache!: () => void;
  const hold = new Promise<void>((resolve) => {
    returnToCache = resolve;
  });
  let ready!: () => void;
  const firstReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const first = cache.withSession(spec, async (s) => {
    await s.ready();
    ready();
    await hold;
  });
  const second = new UciEngineSession(spec);
  try {
    await firstReady;
    const before = started();
    let admitted = false;
    const next = second.ready().then(() => {
      admitted = true;
    });
    await delay(250);
    assert.equal(admitted, false);
    assert.equal(started(), before);
    returnToCache();
    await first;
    await next;
    assert.equal(cache.stats().idle, 0);
  } finally {
    returnToCache();
    await first;
    second.close();
    cache.closeAll();
  }
});

for (const run of [runUciBestmove, runUciEval, runUciMultiPv]) {
  test(`the total guard also counts ${run.name} processes`, async (t) => {
    setEnv(t, 'MISTBOARD_ENGINE_MAX_PROCESSES', '1');
    const session = new UciEngineSession(spec);
    await session.ready();
    const before = started();
    const result = run({
      bin,
      commands: ['uci', 'isready', 'go nodes 1'],
      timeoutMs: 2_000,
      timeoutMessage: 'test timeout',
    });
    try {
      await delay(250);
      assert.equal(started(), before, 'another runner must wait for the physical process slot');
    } finally {
      session.close();
      await result;
    }
  });
}

test('the total guard alerts on a drop and fails an unspawned session closed', async (t) => {
  setEnv(t, 'MISTBOARD_ENGINE_MAX_PROCESSES', '1');
  setEnv(t, 'MISTBOARD_ENGINE_QUEUE_TIMEOUT_MS', '100');
  const emails = captureEmails(t);
  const held = new UciEngineSession(spec);
  await held.ready();
  const queued = new UciEngineSession(spec);
  try {
    await assert.rejects(queued.ready(), /Total engine process queue timed out/);
    assert.equal(queued.failed, true);
    assert.equal(emails.length, 1);
    assert.match(emails[0]!.text, /pool: all-engine-processes/);
  } finally {
    queued.close();
    held.close();
  }
});

test('closing a queued session never spawns it or leaks the total lease', async (t) => {
  setEnv(t, 'MISTBOARD_ENGINE_MAX_PROCESSES', '1');
  const held = new UciEngineSession(spec);
  await held.ready();
  const before = started();
  const queued = new UciEngineSession(spec);
  const rejected = assert.rejects(queued.ready(), /session closed/);
  queued.close();
  held.close();
  await rejected;
  assert.equal(started(), before);
  const next = new UciEngineSession(spec);
  try {
    await next.ready();
    assert.equal(aggregateEnginePoolStats().processes.active, 1);
  } finally {
    next.close();
  }
});

test('a failed spawn releases its physical slot for a subsequent engine', async (t) => {
  setEnv(t, 'MISTBOARD_ENGINE_MAX_PROCESSES', '1');
  await assert.rejects(
    runUciBestmove({
      bin: join(fixture, 'missing-engine'),
      commands: [],
      timeoutMs: 1_000,
      timeoutMessage: 'test',
    }),
    /ENOENT/,
  );
  const next = new UciEngineSession(spec);
  try {
    await next.ready();
  } finally {
    next.close();
  }
});

test('KataGo never exceeds its configured cap and shares the total guard', async (t) => {
  setEnv(t, 'MISTBOARD_KATAGO_JUNGLE_MAX_PROCESSES', '1');
  setEnv(t, 'MISTBOARD_ENGINE_MAX_PROCESSES', '1');
  setEnv(t, 'MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH', bin);
  setEnv(t, 'MISTBOARD_KATAGO_JUNGLE_NET_PATH', bin);
  setEnv(t, 'MISTBOARD_KATAGO_JUNGLE_CONFIG_PATH', bin);
  appendFileSync(events, 'batch\n');
  const session = new UciEngineSession(spec);
  await session.ready();
  const fen = 't5l/1c3d1/e1w1p1r/7/7/7/R1P1W1E/1D3C1/L5T r 0 1';
  const before = started();
  const moves = Promise.all(Array.from({ length: 3 }, () => katagoJungleMove(fen, 'red')));
  try {
    await delay(250);
    assert.equal(started(), before, 'KataGo queues behind the UCI session');
  } finally {
    session.close();
    // With total capacity available, only KataGo's own cap should serialize this burst.
    process.env.MISTBOARD_ENGINE_MAX_PROCESSES = '8';
    await moves;
  }
  const batch = readFileSync(events, 'utf8').split('batch\n').at(-1)!;
  let active = 0;
  let peak = 0;
  // Exclude the held UCI session's start; KataGo logs normal process completion.
  for (const event of batch.trim().split('\n').slice(1)) {
    active += event === 'start' ? 1 : -1;
    peak = Math.max(peak, active);
  }
  assert.equal(peak, 1);
  assert.equal(active, 0);
  assert.equal(
    aggregateEnginePoolStats().pools.find((p) => p.name === 'katago-jungle')?.maxProcesses,
    1,
  );
});
