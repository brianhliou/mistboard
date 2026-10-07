import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ABJCHESS_LIVE_QUEUE_TIMEOUT_MS,
  JIEQI_ABJCHESS_ENGINE_ID,
  JIEQI_DEFAULT_ENGINE_ID,
  type JieqiEngineTier,
  jieqiEngineTierFor,
  jieqiLiveCeilingMs,
  jieqiLiveEngineMove,
  jieqiLivePool,
} from './jieqi-engine.js';
import { jieqiLiveMoveBudgetMs } from './server-jieqi-engine.js';

const FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';

const ab = jieqiEngineTierFor(JIEQI_ABJCHESS_ENGINE_ID) as JieqiEngineTier;
const level8 = jieqiEngineTierFor(JIEQI_DEFAULT_ENGINE_ID) as JieqiEngineTier;

function tc(minutes: number, incrementSeconds: number) {
  return { initialMs: minutes * 60_000, incrementMs: incrementSeconds * 1_000 };
}

/** The bot's first move of a game: its whole clock remains. */
function firstMove(tier: JieqiEngineTier, clock: ReturnType<typeof tc> | null) {
  return jieqiLiveMoveBudgetMs({ tier, clock, remainingMs: clock?.initialMs ?? null });
}

// 2026-10-06: AB-JChess played every 10+5 game on a flat 4 s and ended them with more
// clock than it started with (median 616 s of 600), while humans beat it in the
// middlegame. The timed ceiling spends some of that clock; blitz keeps today's pace.
test('AB-JChess thinks longer only in games whose clock pays for it', () => {
  assert.equal(firstMove(ab, tc(1, 1)), 2_767, '1+1: the clock binds, as before');
  assert.equal(firstMove(ab, tc(3, 2)), 4_000, '3+2: unchanged 4 s');
  assert.equal(firstMove(ab, tc(5, 5)), 5_000, '5+5: up to 5 s');
  assert.equal(firstMove(ab, tc(10, 5)), 8_000, '10+5: up to 8 s');
  assert.equal(firstMove(ab, tc(30, 20)), 8_000, 'slower games never pass 8 s');
  assert.equal(firstMove(ab, null), 4_000, 'untimed: the rated 4 s');
});

test('every other jieqi tier keeps its own movetime as the ceiling', () => {
  for (const clock of [tc(1, 1), tc(3, 2), tc(5, 5), tc(10, 5), null]) {
    assert.equal(jieqiLiveCeilingMs(level8, clock), level8.movetimeMs);
  }
  assert.equal(firstMove(level8, tc(10, 5)), 4_000);
  assert.equal(level8.timedCeilingMs, undefined);
});

test('the rated config stays 4 s: the timed ceiling is not the tier movetime', () => {
  assert.equal(ab.movetimeMs, 4_000, 'movetimeMs feeds configHash and the EvE rating');
  assert.equal(ab.timedCeilingMs, 8_000);
});

test('a decided position gets the base time back', () => {
  const clock = tc(10, 5);
  const at = (lastScore: { cp?: number | null; mate?: number | null }) =>
    jieqiLiveMoveBudgetMs({ tier: ab, clock, remainingMs: 600_000, lastScore });
  assert.equal(at({ cp: 120 }), 8_000);
  assert.equal(at({ cp: -499 }), 8_000);
  assert.equal(at({ cp: 500 }), 4_000);
  assert.equal(at({ cp: -650 }), 4_000);
  assert.equal(at({ mate: 3 }), 4_000);
  assert.equal(at({ mate: -2 }), 4_000);
});

test('the clock allocator still shrinks the extra time when the clock runs low', () => {
  const clock = tc(10, 5);
  const at = (remainingMs: number, waitedMs = 0) =>
    jieqiLiveMoveBudgetMs({ tier: ab, clock, remainingMs, waitedMs });
  // bank/30 + 0.8 x increment: 8 s holds down to ~121 s left.
  assert.equal(at(300_000), 8_000);
  assert.equal(at(91_000), 7_000);
  assert.equal(at(31_000), 5_000);
  assert.equal(at(1_500), 500, 'never more than the usable clock');
  // A move that queued for a slot pays the wait out of its own budget.
  assert.equal(at(31_000, 15_000), 4_500);
  assert.equal(at(5_000, 5_000), 50, 'the wait ate the clock: think the floor');
});

test('a 10+5 game on the new ceiling stays solvent and ends with clock to spare', () => {
  // Simulate 70 bot moves (a long game) at the full ceiling, the move time charged
  // and the increment added each move.
  const clock = tc(10, 5);
  let remaining = clock.initialMs;
  let spent = 0;
  for (let move = 0; move < 70; move += 1) {
    const budget = jieqiLiveMoveBudgetMs({ tier: ab, clock, remainingMs: remaining });
    spent += budget;
    remaining = remaining - budget + clock.incrementMs;
    assert.ok(remaining > 60_000, `move ${move}: ${remaining} ms left`);
  }
  assert.equal(spent / 70, 8_000, 'the clock never had to shrink the ceiling');
});

// The live pool was shared by every jieqi bot: two processes and a 5 s queue timeout.
// Two AB games thinking 8 s each would shed a ladder move queued behind them.
test('AB-JChess live moves run in their own pool, so its long thinks never queue the ladder', async () => {
  const abPool = jieqiLivePool('ab-jchess');
  const ladderPool = jieqiLivePool();
  assert.notEqual(abPool, ladderPool);
  const held: Array<() => void> = [];
  try {
    const slots = abPool.stats().maxProcesses;
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
  // The longest a slot can be held: the longest timed ceiling plus the move's process
  // deadline over its movetime (jieqiEngineSearch: movetime + 4 s).
  const longestHoldMs = (ab.timedCeilingMs ?? ab.movetimeMs) + 4_000;
  assert.ok(ABJCHESS_LIVE_QUEUE_TIMEOUT_MS > longestHoldMs);
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
      movetimeMs: 8_000,
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
