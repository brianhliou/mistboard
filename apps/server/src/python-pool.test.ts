import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { engineCounters } from './obs.js';
import { PythonPool } from './python-pool.js';

// A fake pool worker (node, not python): emits `ready`, then for each request
// reads a shared state file holding `crashes_remaining`. While > 0 it decrements
// and exits(1) (simulating a crash/OOM); once 0 it replies ok. Lets us drive the
// R1-recover retry path deterministically without a real engine or Stockfish.
const FAKE_WORKER = `
import fs from 'node:fs';
const stateFile = process.env.FAKE_WORKER_STATE;
process.stdout.write(JSON.stringify({ kind: 'ready', engineId: 'fake', pid: process.pid }) + '\\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const req = JSON.parse(line);
    let remaining = 0;
    try { remaining = parseInt(fs.readFileSync(stateFile, 'utf8'), 10) || 0; } catch {}
    if (remaining > 0) {
      fs.writeFileSync(stateFile, String(remaining - 1));
      process.exit(1); // crash mid-request
    }
    process.stdout.write(JSON.stringify({
      requestId: req.requestId,
      ok: true,
      response: { move: { from: 'e2', to: 'e4' }, engine: { id: 'fake' }, roomId: 'r' },
    }) + '\\n');
  }
});
`;

let dir: string;
let scriptPath: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'pool-test-'));
  scriptPath = join(dir, 'fake-worker.mjs');
  writeFileSync(scriptPath, FAKE_WORKER);
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makePool(_stateFile: string): PythonPool {
  return new PythonPool({
    engineId: 'fake',
    size: 2,
    pythonBin: process.execPath,
    scriptPath,
    cwd: dir,
    workerSeed: 1,
    readyTimeoutMs: 5_000,
  });
}

const PAYLOAD = { engineTurnRequest: { gameId: 'g', engineId: 'fake' } };

test('R1-recover: a one-off worker crash is retried on a healthy worker', async () => {
  const stateFile = join(dir, 'state-retry');
  writeFileSync(stateFile, '1'); // first dispatch crashes, then recover
  process.env.FAKE_WORKER_STATE = stateFile;
  const pool = makePool(stateFile);
  await pool.start();
  const retriesBefore = engineCounters.totalPythonPoolRetries;
  try {
    const res = await pool.chooseMove(PAYLOAD, 4_000);
    assert.deepEqual(res.move, { from: 'e2', to: 'e4' }, 'move recovered after the crash');
    assert.equal(
      engineCounters.totalPythonPoolRetries,
      retriesBefore + 1,
      'exactly one retry recorded',
    );
  } finally {
    pool.dispose();
  }
});

test('R1-recover: a persistently failing move rejects after exhausting attempts', async () => {
  const stateFile = join(dir, 'state-exhaust');
  writeFileSync(stateFile, '9'); // every dispatch crashes → retries exhaust
  process.env.FAKE_WORKER_STATE = stateFile;
  const pool = makePool(stateFile);
  await pool.start();
  try {
    await assert.rejects(
      pool.chooseMove(PAYLOAD, 4_000),
      /worker .* timeout|pool request|closed|exit|!ok|fail/i,
      'rejects once attempts are exhausted (no infinite retry loop)',
    );
  } finally {
    pool.dispose();
  }
});

// A fake worker that echoes its own pid + the request's gameId, so a test can
// tell WHICH worker served a move and assert session-affinity stickiness.
const FAKE_WORKER_PID = `
process.stdout.write(JSON.stringify({ kind: 'ready', engineId: 'fake', pid: process.pid }) + '\\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const req = JSON.parse(line);
    const gameId = (req.engineTurnRequest && req.engineTurnRequest.gameId) || null;
    process.stdout.write(JSON.stringify({
      requestId: req.requestId,
      ok: true,
      response: { move: { from: 'e2', to: 'e4' }, engine: { id: 'fake' }, roomId: gameId, workerPid: process.pid },
    }) + '\\n');
  }
});
`;

const pidOf = (r: unknown): number | undefined => (r as { workerPid?: number }).workerPid;

test('affinity: a game stays on one worker; concurrent games spread', async () => {
  const scriptFile = join(dir, 'pid-worker.mjs');
  writeFileSync(scriptFile, FAKE_WORKER_PID);
  const pool = new PythonPool({
    engineId: 'fake',
    size: 2,
    pythonBin: process.execPath,
    scriptPath: scriptFile,
    cwd: dir,
    workerSeed: 1,
    readyTimeoutMs: 5_000,
    affinity: true,
  });
  await pool.start();
  try {
    const move = (gameId: string) =>
      pool.chooseMove({ engineTurnRequest: { gameId, engineId: 'fake' } }, 4_000);

    const a1 = await move('A');
    const a2 = await move('A');
    const a3 = await move('A');
    assert.ok(pidOf(a1) !== undefined, 'worker reported its pid');
    assert.equal(pidOf(a2), pidOf(a1), 'game A sticks to its worker (delta-feed)');
    assert.equal(pidOf(a3), pidOf(a1), 'game A sticks across moves');

    // Two games dispatched concurrently land on different workers (2-worker pool).
    const [x, y] = await Promise.all([move('X'), move('Y')]);
    assert.notEqual(pidOf(x), pidOf(y), 'concurrent games spread across workers');
  } finally {
    pool.dispose();
  }
});

// End-to-end A/B that DISTINGUISHES affinity from legacy (the prod single-game
// trace can't — a lone game lands on worker 0 either way). Two concurrent games
// over two waves, with the SECOND wave issued in REVERSED order. Under legacy
// first-ready dispatch the reversed order swaps which worker each game gets
// (they bounce → cold-replay); under affinity each game returns to its pinned
// worker (sticks → delta-feed). Deterministic: dispatch is synchronous and
// `find(isReady)` scans workers in index order.
async function twoWaveWorkers(affinity: boolean) {
  const scriptFile = join(dir, 'pid-worker.mjs');
  writeFileSync(scriptFile, FAKE_WORKER_PID);
  const pool = new PythonPool({
    engineId: 'fake',
    size: 2,
    pythonBin: process.execPath,
    scriptPath: scriptFile,
    cwd: dir,
    workerSeed: 1,
    readyTimeoutMs: 5_000,
    affinity,
  });
  await pool.start();
  try {
    const move = (g: string) =>
      pool.chooseMove({ engineTurnRequest: { gameId: g, engineId: 'fake' } }, 4_000);
    const [a1, b1] = await Promise.all([move('A'), move('B')]); // wave 1: A,B
    const [b2, a2] = await Promise.all([move('B'), move('A')]); // wave 2: B,A (reversed)
    return { a1: pidOf(a1), b1: pidOf(b1), a2: pidOf(a2), b2: pidOf(b2) };
  } finally {
    pool.dispose();
  }
}

// A fake worker that hangs on a request while a shared counter is > 0 (writing
// its pid to a file first, so the test knows which worker timed out), else
// replies with its pid.
const FAKE_WORKER_HANG = `
import fs from 'node:fs';
const stateFile = process.env.FAKE_WORKER_STATE;
const hungPidFile = process.env.FAKE_WORKER_HUNG_PID;
process.stdout.write(JSON.stringify({ kind: 'ready', engineId: 'fake', pid: process.pid }) + '\\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const req = JSON.parse(line);
    let remaining = 0;
    try { remaining = parseInt(fs.readFileSync(stateFile, 'utf8'), 10) || 0; } catch {}
    if (remaining > 0) {
      fs.writeFileSync(stateFile, String(remaining - 1));
      fs.writeFileSync(hungPidFile, String(process.pid));
      continue; // never reply: the pool request times out
    }
    process.stdout.write(JSON.stringify({
      requestId: req.requestId,
      ok: true,
      response: { move: { from: 'e2', to: 'e4' }, engine: { id: 'fake' }, roomId: 'r', workerPid: process.pid },
    }) + '\\n');
  }
});
`;

for (const size of [1, 2]) {
  test(`R1-recover: a timed-out move is not retried on the worker being killed (size ${size})`, async () => {
    const scriptFile = join(dir, 'hang-worker.mjs');
    writeFileSync(scriptFile, FAKE_WORKER_HANG);
    const stateFile = join(dir, `state-hang-${size}`);
    const hungPidFile = join(dir, `hung-pid-${size}`);
    writeFileSync(stateFile, '1'); // the first dispatch hangs → pool timeout
    process.env.FAKE_WORKER_STATE = stateFile;
    process.env.FAKE_WORKER_HUNG_PID = hungPidFile;
    const pool = new PythonPool({
      engineId: 'fake',
      size,
      pythonBin: process.execPath,
      scriptPath: scriptFile,
      cwd: dir,
      workerSeed: 1,
      readyTimeoutMs: 5_000,
    });
    await pool.start();
    try {
      // 300ms per-dispatch timeout: the first attempt hangs and times out; the
      // retry must land on another worker (size 2) or wait for the dead slot's
      // replacement (size 1), never on the worker being killed.
      const res = await pool.chooseMove(PAYLOAD, 300);
      const hungPid = Number(readFileSync(hungPidFile, 'utf8'));
      assert.ok(hungPid > 0, 'the first attempt hung on a known worker');
      assert.notEqual(pidOf(res), hungPid, 'the retry ran on a different worker process');
    } finally {
      pool.dispose();
    }
  });
}

test('affinity A/B: ON keeps each game on its worker; OFF bounces them (reversed waves)', async () => {
  const on = await twoWaveWorkers(true);
  assert.notEqual(on.a1, on.b1, 'wave 1: the two games are on different workers');
  assert.equal(on.a2, on.a1, 'affinity ON: game A returns to its pinned worker');
  assert.equal(on.b2, on.b1, 'affinity ON: game B returns to its pinned worker');

  const off = await twoWaveWorkers(false);
  assert.notEqual(off.a1, off.b1, 'wave 1: still on different workers');
  assert.notEqual(
    off.a2,
    off.a1,
    'affinity OFF: game A bounces to the other worker under reversed order',
  );
  assert.notEqual(off.b2, off.b1, 'affinity OFF: game B bounces too');
});
