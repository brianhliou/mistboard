// A whole-game jieqi sweep walks 40-100+ positions through ONE engine process
// (withJieqiAnalysisSession; the decisions pass shares it since #482). PikaJieQi is a research fork with its assertions
// compiled out and it does crash mid-search — deterministically, on a warm
// process; see mistboard-engine lab/jieqi-darkmove-2026-08-31/CRASH_FINDINGS.md.
// Without recovery a single crash discards the whole sweep. These tests pin the
// two halves of the contract: a sweep SURVIVES an engine death, and an engine
// that dies every time still SURFACES rather than respawning forever.
//
// Fake-binary fixture pattern, as in uci-engine-session.test.ts — no real engine.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { withJieqiAnalysisSession } from './jieqi-engine.js';

const fixtureDir = mkdtempSync(join(tmpdir(), 'jieqi-session-recovery-'));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));

function writeFakeEngine(name: string, body: string): string {
  const path = join(fixtureDir, name);
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

// The session's initCommands set Hash and Threads, and the harness fails init if a
// configured option was never advertised — so the fake must advertise both.
const PREAMBLE = `let buf = '';
const respond = (s) => process.stdout.write(s);
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line === 'uci') {
      respond('option name Hash type spin default 16 min 1 max 1024\\n');
      respond('option name Threads type spin default 1 min 1 max 64\\n');
      respond('uciok\\n');
    }
    if (line === 'isready') respond('readyok\\n');
    if (line.startsWith('go')) {`;

const POSTAMBLE = `    }
  }
});`;

// Dies on its FIRST `go`, but only while a sentinel file is absent; it creates the
// sentinel on the way out, so the RESPAWNED process serves normally. That makes
// "one crash, then recovery" deterministic rather than timing-dependent.
const crashOnceBin = writeFakeEngine(
  'crash-once.mjs',
  `import fs from 'node:fs';
const sentinel = process.env.JIEQI_TEST_SENTINEL;
${PREAMBLE}
      if (!fs.existsSync(sentinel)) {
        fs.writeFileSync(sentinel, 'crashed');
        process.exit(1);
      }
      respond('info depth 3 score cp 42\\nbestmove a0a1\\n');
${POSTAMBLE}`,
);

// Dies on every `go`, forever.
const crashAlwaysBin = writeFakeEngine(
  'crash-always.mjs',
  `${PREAMBLE}
      process.exit(1);
${POSTAMBLE}`,
);

const FEN = '1x1xkxxx1/9/9/9/9/9/9/9/9/1XX1KXXX1 w R1 0 1';
const BUDGET = { depth: 3, movetimeMs: 50 } as const;

async function withEngine<T>(bin: string, sentinel: string, fn: () => Promise<T>): Promise<T> {
  const prevPath = process.env.MISTBOARD_PIKAFISH_PATH;
  const prevSentinel = process.env.JIEQI_TEST_SENTINEL;
  process.env.MISTBOARD_PIKAFISH_PATH = bin;
  process.env.JIEQI_TEST_SENTINEL = sentinel;
  try {
    return await fn();
  } finally {
    if (prevPath === undefined) delete process.env.MISTBOARD_PIKAFISH_PATH;
    else process.env.MISTBOARD_PIKAFISH_PATH = prevPath;
    if (prevSentinel === undefined) delete process.env.JIEQI_TEST_SENTINEL;
    else process.env.JIEQI_TEST_SENTINEL = prevSentinel;
  }
}

test('a sweep survives the analysis engine dying mid-run', async () => {
  const sentinel = join(fixtureDir, `sentinel-${Date.now()}`);
  assert.equal(existsSync(sentinel), false);

  const scores = await withEngine(crashOnceBin, sentinel, () =>
    withJieqiAnalysisSession(async (evaluateFen) => {
      const out: number[] = [];
      // Three positions: the first kills the engine, and all three must still
      // come back — the killed one via a respawn, not as a hole in the sweep.
      for (let i = 0; i < 3; i++) {
        const evaluation = await evaluateFen(FEN, BUDGET);
        out.push(evaluation.cp ?? Number.NaN);
      }
      return out;
    }, 'pikafish-jieqi'),
  );

  assert.equal(scores.length, 3, 'every position in the sweep produced an eval');
  assert.ok(
    scores.every((s) => s === 42),
    `expected each eval to be the fake engine's cp 42, got ${JSON.stringify(scores)}`,
  );
  assert.ok(existsSync(sentinel), 'the fake engine really did crash once');
});

test('an engine that dies every time surfaces instead of respawning forever', async () => {
  const sentinel = join(fixtureDir, `unused-${Date.now()}`);
  await assert.rejects(
    () =>
      withEngine(crashAlwaysBin, sentinel, () =>
        withJieqiAnalysisSession((evaluateFen) => evaluateFen(FEN, BUDGET), 'pikafish-jieqi'),
      ),
    'a permanently broken engine must fail the sweep, not spin',
  );
});
