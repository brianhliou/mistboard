import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough, Writable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { startEngineHttpService } from './engine-service.js';
import { engineCounters } from './obs.js';
import { disposeAllPythonPools, getPythonPool, PythonPool } from './python-pool.js';
import {
  runUciBestmove,
  runUciEval,
  runUciMultiPv,
  UciEngineSession,
} from './uci-engine-harness.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const pipeError = Object.assign(new Error('engine pipe closed'), { code: 'EPIPE' });

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  killed = false;
  pid = 123;
  failWrite = false;
  pipeWasHandled = false;
  requests: Record<string, unknown>[] = [];

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        if (this.failWrite) {
          queueMicrotask(() => {
            this.pipeWasHandled = this.stdin.listenerCount('error') > 0;
            // Keep the pre-fix regression safe: observe the stream error without
            // intercepting uncaughtException or terminating the test process.
            this.stdin.once('error', () => {});
            callback(pipeError);
          });
        } else {
          for (const line of chunk.toString().trim().split('\n')) {
            if (line.startsWith('{')) this.requests.push(JSON.parse(line));
          }
          callback();
        }
      },
    });
  }

  send(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    queueMicrotask(() => {
      this.emit('exit', null, 'SIGKILL');
      this.emit('close', null, 'SIGKILL');
    });
    return true;
  }
}

function fakeSpawns(t: TestContext, configure?: (child: FakeChild) => void): FakeChild[] {
  const children: FakeChild[] = [];
  const mock = t.mock.method(childProcess, 'spawn', () => {
    const child = new FakeChild();
    configure?.(child);
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
  return children;
}

for (const run of [runUciBestmove, runUciEval, runUciMultiPv]) {
  test(`${run.name} contains asynchronous stdin EPIPE and rejects its request`, async (t) => {
    const children = fakeSpawns(t, (child) => {
      child.failWrite = true;
    });
    let failure: unknown;
    const result = run({
      bin: 'fake-engine',
      commands: ['uci', 'isready', 'go nodes 1'],
      timeoutMs: 100,
      timeoutMessage: 'test timeout',
    }).catch((err: unknown) => {
      failure = err;
    });
    try {
      await flush();
      assert.equal(children[0]!.pipeWasHandled, true);
      assert.equal(failure, pipeError);
      assert.equal(children[0]!.killed, true);
      // Cleanup can race another error; the listener must remain attached.
      assert.doesNotThrow(() => children[0]!.stdin.emit('error', pipeError));
    } finally {
      await result;
    }
  });
}

for (const phase of ['init', 'search', 'idle']) {
  test(`UciEngineSession contains asynchronous stdin EPIPE during ${phase}`, async (t) => {
    const children = fakeSpawns(t, (child) => {
      child.failWrite = phase === 'init';
    });
    const session = new UciEngineSession({
      bin: 'fake-engine',
      initCommands: ['uci', 'isready'],
      initTimeoutMs: 100,
    });
    t.after(() => session.close());
    let failure: unknown;
    const ready = session.ready().catch((err: unknown) => {
      failure = err;
    });
    await flush();
    const child = children[0]!;
    if (phase === 'init') {
      assert.equal(child.pipeWasHandled, true);
      assert.equal(failure, pipeError);
      await ready;
    } else {
      child.stdout.write('readyok\n');
      await ready;
      child.failWrite = true;
      const args = {
        positionCommand: 'position startpos',
        goCommand: 'go nodes 1',
        timeoutMs: 100,
        timeoutMessage: 'test timeout',
      };
      if (phase === 'idle') {
        // An error arriving after a prior command completed still poisons the session.
        assert.doesNotThrow(() => child.stdin.emit('error', pipeError));
      }
      const first = session.evalPosition(args).catch((err: unknown) => {
        failure = err;
      });
      const queued = session.evalPosition(args).catch((err: unknown) => err);
      await flush();
      assert.equal(failure, pipeError);
      assert.equal(await queued, pipeError);
      await first;
    }
    assert.equal(session.failed, true);
    assert.equal(child.killed, true);
  });
}

function makePool(size = 1, affinity = false): PythonPool {
  return new PythonPool({
    engineId: 'fake',
    size,
    affinity,
    pythonBin: 'fake-python',
    scriptPath: 'fake-worker',
    cwd: '.',
    workerSeed: 1,
    readyTimeoutMs: 30_000,
  });
}

const payload = { engineTurnRequest: { gameId: 'game', engineId: 'fake' } };
const response = { move: { from: 'e2', to: 'e4' }, engine: { id: 'fake' }, roomId: 'game' };

test('PythonPool contains asynchronous stdin EPIPE and retries on a replacement only once', async (t) => {
  const children = fakeSpawns(t);
  const pool = makePool();
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready' });
  await start;
  children[0]!.failWrite = true;
  const result = pool.chooseMove(payload, 1_000).catch((err: unknown) => err);
  await flush();
  assert.equal(children[0]!.pipeWasHandled, true);
  assert.equal(children.length, 2, 'write callback, stream error, and close share one restart');
  children[1]!.send({ kind: 'ready' });
  await flush();
  children[1]!.send({ requestId: children[1]!.requests[0]!.requestId, ok: true, response });
  assert.deepEqual(await result, response);
});

test('PythonPool retries a replacement that fails before ready and serves queued work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  const children = fakeSpawns(t);
  const pool = makePool();
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready' });
  await start;
  const result = pool.chooseMove(payload, 10_000).catch((err: unknown) => err);
  children[0]!.kill();
  await flush();
  assert.equal(children.length, 2);
  children[1]!.send({ kind: 'ready_error', error: 'temporary init failure' });
  await flush();
  t.mock.timers.tick(500);
  await flush();
  assert.equal(children.length, 3, 'failed replacement must schedule another startup');
  children[2]!.send({ kind: 'ready' });
  await flush();
  children[2]!.send({ requestId: children[2]!.requests[0]!.requestId, ok: true, response });
  assert.deepEqual(await result, response);
  t.mock.timers.tick(20_000);
  assert.equal(children[2]!.killed, false, 'successful requests clear their total deadline');
});

test('PythonPool total deadline also stops a retry already running on a replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  const children = fakeSpawns(t);
  const pool = makePool();
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready' });
  await start;
  let failure: unknown;
  const result = pool.chooseMove(payload, 20).catch((err: unknown) => {
    failure = err;
  });
  t.mock.timers.tick(10);
  children[0]!.kill();
  await flush();
  t.mock.timers.tick(20);
  children[1]!.send({ kind: 'ready' });
  await flush();
  assert.equal(children[1]!.requests.length, 1);
  t.mock.timers.tick(10);
  await flush();
  assert.match(String(failure), /total.*timeout/i);
  assert.equal(children[1]!.killed, false, 'the caller deadline does not kill an active search');
  t.mock.timers.tick(10);
  await flush();
  assert.equal(children[1]!.killed, true, 'the per-attempt timeout still bounds a stuck search');
  await result;
});

test('PythonPool recovers a partially failed initial startup without losing the slot', async (t) => {
  const children = fakeSpawns(t);
  const pool = makePool(2);
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready_error', error: 'temporary startup failure' });
  children[1]!.send({ kind: 'ready' });
  await start;
  assert.equal(children.length, 3);
  assert.equal(pool.isReady(), true, 'surviving slot still serves');
  children[2]!.send({ kind: 'ready' });
  await flush();
  const first = pool.chooseMove(payload, 1_000);
  const second = pool.chooseMove(payload, 1_000);
  assert.equal(pool.isReady(), true, 'busy workers count as live capacity');
  for (const child of [children[1]!, children[2]!]) {
    assert.equal(child.requests.length, 1);
    child.send({ requestId: child.requests[0]!.requestId, ok: true, response });
  }
  await Promise.all([first, second]);
});

test('PythonPool disposal settles active and queued work and suppresses replacement failures', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  const children = fakeSpawns(t);
  const pool = makePool();
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready' });
  await start;
  const active = pool.chooseMove(payload, 1_000).catch((err: unknown) => err);
  const queued = pool.chooseMove(payload, 1_000).catch((err: unknown) => err);
  const errors = engineCounters.totalPythonPoolErrors;
  pool.dispose();
  assert.match(String(await active), /pool disposed/);
  assert.match(String(await queued), /pool disposed/);
  await assert.rejects(pool.chooseMove(payload, 1_000), /pool disposed/);
  t.mock.timers.tick(100_000);
  await flush();
  assert.equal(children.length, 1);
  assert.equal(engineCounters.totalPythonPoolErrors, errors);

  const replacingPool = makePool();
  t.after(() => replacingPool.dispose());
  const restarting = replacingPool.start();
  children[1]!.send({ kind: 'ready' });
  await restarting;
  children[1]!.kill();
  await flush();
  assert.equal(children.length, 3);
  replacingPool.dispose();
  children[2]!.send({ kind: 'ready_error', error: 'shutdown during init' });
  t.mock.timers.tick(100_000);
  await flush();
  assert.equal(children.length, 3);
  assert.equal(engineCounters.totalPythonPoolErrors, errors);
});

for (const affinity of [false, true]) {
  test(`PythonPool bounds queueing and retries by one total deadline (affinity ${affinity})`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
    const children = fakeSpawns(t);
    const pool = makePool(1, affinity);
    t.after(() => pool.dispose());
    const start = pool.start();
    children[0]!.send({ kind: 'ready' });
    await start;
    const active = pool.chooseMove(payload, 20).catch((err: unknown) => err);
    let queuedFailure: unknown;
    const queued = pool.chooseMove(payload, 20).catch((err: unknown) => {
      queuedFailure = err;
    });
    t.mock.timers.tick(20);
    await flush();
    children[1]!.send({ kind: 'ready_error', error: 'temporary init failure' });
    await flush();
    t.mock.timers.tick(20);
    await flush();
    assert.match(String(queuedFailure), /total.*timeout/i);
    assert.match(String(await active), /total.*timeout/i);
    await queued;
    // Expired requests must never dispatch when capacity returns.
    t.mock.timers.tick(500);
    await flush();
    children[2]!.send({ kind: 'ready' });
    await flush();
    assert.equal(children[2]!.requests.length, 0);
  });
}

test('PythonPool rejects queued and new work when every slot exhausts restart attempts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  const children = fakeSpawns(t);
  const pool = makePool();
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready' });
  await start;
  let failure: unknown;
  const result = pool.chooseMove(payload, 1_000_000).catch((err: unknown) => {
    failure = err;
  });
  children[0]!.kill();
  await flush();
  for (let i = 1; i <= 5; i += 1) {
    assert.equal(children.length, i + 1);
    children[i]!.send({ kind: 'ready_error', error: 'init unavailable' });
    await flush();
    t.mock.timers.tick(5_000);
    await flush();
  }
  assert.match(String(failure), /no recoverable.*workers/i);
  await result;
  await assert.rejects(pool.chooseMove(payload, 1_000_000), /no recoverable.*workers/i);
  t.mock.timers.tick(100_000);
  await flush();
  assert.equal(children.length, 6, 'restart attempts are bounded');
});

for (const affinity of [false, true]) {
  test(`PythonPool queue wait never sacrifices a healthy worker (affinity ${affinity})`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
    const children = fakeSpawns(t);
    const pool = makePool(1, affinity);
    t.after(() => pool.dispose());
    const start = pool.start();
    children[0]!.send({ kind: 'ready' });
    await start;
    const active = pool.chooseMove(payload, 1_000).catch((err: unknown) => err);
    const queued = pool.chooseMove(payload, 20).catch((err: unknown) => err);
    t.mock.timers.tick(30); // Only 10ms of the queued move's 40ms total budget remains.
    children[0]!.send({ requestId: children[0]!.requests[0]!.requestId, ok: true, response });
    await active;
    t.mock.timers.tick(10);
    await flush();
    assert.equal(children[0]!.killed, false, 'queue delay must not kill a healthy worker');
    assert.equal(children[0]!.requests.length, 2, 'the queued request started its search');
    assert.match(String(await queued), /timeout/i);
    assert.equal(children.length, 1, 'queue expiry must not restart the slot');
    const next = pool.chooseMove(payload, 20).catch((err: unknown) => err);
    assert.equal(children[0]!.requests.length, 2, 'the expired search still occupies its worker');
    t.mock.timers.tick(5);
    children[0]!.send({ requestId: children[0]!.requests[1]!.requestId, ok: true, response });
    assert.equal(children[0]!.requests.length, 3, 'a late response frees the worker');
    children[0]!.send({ requestId: children[0]!.requests[2]!.requestId, ok: true, response });
    assert.deepEqual(await next, response, 'the same worker still serves fresh work');
  });
}

test('PythonPool total deadline replacements do not consume the crash burst', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  const children = fakeSpawns(t);
  const pool = makePool();
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready' });
  await start;
  for (let i = 0; i < 6; i += 1) {
    const child = children[i]!;
    const active = pool.chooseMove(payload, 1_000).catch((err: unknown) => err);
    const expiring = pool.chooseMove(payload, 20).catch((err: unknown) => err);
    t.mock.timers.tick(20);
    child.send({ requestId: child.requests[0]!.requestId, ok: true, response });
    await active;
    assert.equal(child.requests.length, 2, 'a full attempt budget still permits dispatch');
    t.mock.timers.tick(20); // Total deadline and per-attempt timeout coincide.
    await flush();
    assert.match(String(await expiring), /total.*timeout/i);
    assert.equal(children.length, i + 2, 'deadline replacement must not back off or retire');
    children[i + 1]!.send({ kind: 'ready' });
    await flush();
  }
  assert.equal(pool.isReady(), true);
});

test('PythonPool retires replacements that repeatedly time out before ready', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  const children = fakeSpawns(t);
  const pool = makePool();
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready' });
  await start;
  let failure: unknown;
  const queued = pool.chooseMove(payload, 1_000_000).catch((err: unknown) => {
    failure = err;
  });
  children[0]!.kill();
  await flush();
  for (let i = 1; i <= 5; i += 1) {
    t.mock.timers.tick(30_000);
    await flush();
    t.mock.timers.tick(5_000);
    await flush();
  }
  assert.match(String(failure), /no recoverable.*workers/i);
  await queued;
  await assert.rejects(pool.chooseMove(payload, 1_000), /no recoverable.*workers/i);
  t.mock.timers.tick(100_000);
  await flush();
  assert.equal(children.length, 6, 'slow startup failures still exhaust restart attempts');
});

test('PythonPool deadline is terminal even when the wall clock is just before deadlineAt', async (t) => {
  const now = 1_800_000_000_000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  const children = fakeSpawns(t);
  const pool = makePool();
  t.after(() => pool.dispose());
  const start = pool.start();
  children[0]!.send({ kind: 'ready' });
  await start;
  const active = pool.chooseMove(payload, 1_000).catch((err: unknown) => err);
  let failure: unknown;
  const queued = pool.chooseMove(payload, 20).catch((err: unknown) => {
    failure = err;
  });
  const retries = engineCounters.totalPythonPoolRetries;
  t.mock.method(Date, 'now', () => now + 39);
  t.mock.timers.tick(40);
  await flush();
  assert.match(String(failure), /total.*timeout/i, 'the fired deadline must settle the request');
  assert.equal(engineCounters.totalPythonPoolRetries, retries, 'a deadline cannot retry');
  children[0]!.send({ requestId: children[0]!.requests[0]!.requestId, ok: true, response });
  await active;
  await queued;
  assert.equal(children[0]!.requests.length, 1, 'expired work must never be dispatched later');
});

test('engine-worker health reports unavailable required pools and recovers with a live worker', async (t) => {
  const children = fakeSpawns(t);
  t.after(() => disposeAllPythonPools());
  const service = await startEngineHttpService({ host: '127.0.0.1', port: 0 });
  t.after(() => service.close());
  const health = () => fetch(`http://127.0.0.1:${service.port}/health`);
  assert.equal((await health()).status, 200, 'unused lazy pools do not block service boot');
  const starting = getPythonPool('python-tier1-v0.9.5', { defaultSize: 1 });
  assert.equal((await health()).status, 503, 'required pool is still starting');
  children[0]!.send({ kind: 'ready' });
  await starting;
  assert.equal((await health()).status, 200);
  children[0]!.kill();
  await flush();
  assert.equal((await health()).status, 503, 'no live workers during replacement');
  children[1]!.send({ kind: 'ready' });
  await flush();
  assert.equal((await health()).status, 200);
});
