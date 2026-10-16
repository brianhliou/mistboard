import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ABJCHESS_LIVE_QUEUE_TIMEOUT_MS,
  JIEQI_ABJCHESS_ENGINE_ID,
  type JieqiEngineTier,
  jieqiEngineTierFor,
  jieqiLiveEngineMove,
  jieqiLivePool,
} from './jieqi-engine.js';
import { jieqiLiveMoveBudgetMs } from './server-jieqi-engine.js';

const FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';

const ab = jieqiEngineTierFor(JIEQI_ABJCHESS_ENGINE_ID) as JieqiEngineTier;

// The ceiling stays the tier's 4 s at every time control (an 8 s timed ceiling was
// measured on 2026-10-06 and parked: no measurable strength gain, longer waits).
test('AB-JChess keeps its 4 s ceiling at every time control', () => {
  const firstMove = (minutes: number, incrementSeconds: number) =>
    jieqiLiveMoveBudgetMs({
      ceilingMs: ab.movetimeMs,
      remainingMs: minutes * 60_000,
      incrementMs: incrementSeconds * 1_000,
    });
  assert.equal(firstMove(1, 1), 2_767, '1+1: the clock binds');
  assert.equal(firstMove(3, 2), 4_000);
  assert.equal(firstMove(5, 5), 4_000);
  assert.equal(firstMove(10, 5), 4_000);
  assert.equal(
    jieqiLiveMoveBudgetMs({ ceilingMs: ab.movetimeMs, remainingMs: null, incrementMs: 0 }),
    4_000,
    'untimed',
  );
});

test('a move that waited for a slot pays the wait out of its own budget', () => {
  const at = (remainingMs: number, waitedMs: number) =>
    jieqiLiveMoveBudgetMs({ ceilingMs: 4_000, remainingMs, incrementMs: 5_000, waitedMs });
  assert.equal(at(300_000, 0), 4_000, 'a healthy clock still gets the ceiling');
  assert.equal(at(31_000, 0), 4_000);
  assert.equal(at(6_000, 0), 4_000, 'unqueued: 5 s usable pays the full 4 s');
  assert.equal(at(6_000, 4_000), 1_000, 'queued 4 s: only the 1 s still usable');
  assert.equal(at(5_000, 5_000), 50, 'the wait ate the clock: think the floor');
});

// The live pool was shared by every jieqi bot: two processes and a 5 s queue timeout,
// so two AB searches could hold every slot a ladder move needs.
test('AB-JChess live moves run in their own pool, so its searches never queue the ladder', async () => {
  const abPool = jieqiLivePool('ab-jchess');
  const ladderPool = jieqiLivePool();
  assert.notEqual(abPool, ladderPool);
  const held: Array<() => void> = [];
  try {
    const slots = abPool.stats().maxProcesses;
    assert.equal(slots, 2, 'two AB processes at most, as the shared pool allowed');
    for (let i = 0; i < slots; i += 1) held.push(await abPool.acquire());
    assert.equal(abPool.stats().active, slots, 'every AB slot is busy');
    const before = ladderPool.stats().waited;
    const release = await ladderPool.acquire();
    release();
    assert.equal(ladderPool.stats().waited, before, 'a ladder move took a slot without waiting');
  } finally {
    for (const release of held) release();
  }
});

test('an AB move queued behind another waits it out instead of being shed', () => {
  // The longest a slot can be held: the tier movetime plus the move's process deadline
  // over it (jieqiEngineSearch: movetime + 4 s).
  assert.ok(ABJCHESS_LIVE_QUEUE_TIMEOUT_MS > ab.movetimeMs + 4_000);
  assert.equal(jieqiLivePool('ab-jchess').stats().name, 'abjchess-live');
});

test('a move that queued for an AB slot re-derives its budget from the wait', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'abjchess-live-'));
  const goLog = join(dir, 'go.log');
  const bin = join(dir, 'ab-jchess.mjs');
  // Answers the handshake and every `go` with a fixed move, logging each go line.
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line === 'uci') {
      process.stdout.write('option name EvalFile type string default\\n');
      process.stdout.write('option name Hash type spin default 16 min 1 max 4096\\n');
      process.stdout.write('option name Threads type spin default 1 min 1 max 16\\n');
      process.stdout.write('uciok\\n');
    }
    if (line === 'isready') process.stdout.write('readyok\\n');
    if (line.startsWith('go')) {
      appendFileSync(${JSON.stringify(goLog)}, line + '\\n');
      process.stdout.write('info depth 3 score cp 12 nodes 30 time 2 pv b2e2\\nbestmove b2e2\\n');
    }
  }
});
`,
  );
  chmodSync(bin, 0o755);
  const prior = {
    path: process.env.MISTBOARD_ABJCHESS_PATH,
    net: process.env.MISTBOARD_ABJCHESS_NET,
  };
  process.env.MISTBOARD_ABJCHESS_PATH = bin;
  process.env.MISTBOARD_ABJCHESS_NET = process.execPath; // any file that exists
  const pool = jieqiLivePool('ab-jchess');
  const held: Array<() => void> = [];
  try {
    for (let i = 0; i < pool.stats().maxProcesses; i += 1) held.push(await pool.acquire());
    let waited = -1;
    const move = jieqiLiveEngineMove(JIEQI_ABJCHESS_ENGINE_ID, FEN, {
      movetimeMs: 4_000,
      budgetAfterWait: (waitedMs) => {
        waited = waitedMs;
        return 1_234;
      },
      newGame: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    held.pop()?.();
    const result = await move;
    assert.equal(result.best, 'b2e2');
    assert.ok(waited >= 30, `the wait was measured (${waited} ms)`);
    assert.deepEqual(readFileSync(goLog, 'utf8').trim().split('\n'), ['go movetime 1234']);
  } finally {
    for (const release of held) release();
    if (prior.path === undefined) delete process.env.MISTBOARD_ABJCHESS_PATH;
    else process.env.MISTBOARD_ABJCHESS_PATH = prior.path;
    if (prior.net === undefined) delete process.env.MISTBOARD_ABJCHESS_NET;
    else process.env.MISTBOARD_ABJCHESS_NET = prior.net;
    rmSync(dir, { recursive: true, force: true });
  }
});
