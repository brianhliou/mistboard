import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitialJungleState, jungleStateToEngineFen } from '@mistboard/game';
import { botLadderFor } from './bot-vs-bot-pairing.js';
import { mistyLevelForEngine } from './first-party-bots.js';
import {
  jungleClassicalBinaryAvailable,
  jungleLiveEngineMove,
  jungleRustTierFor,
} from './jungle-engine.js';
import { isJunglePlayableEngineClientId } from './server-jungle-engine.js';

test('skill-capable binary gate fails closed, invalidates on replacement, and sends the measured policy', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jungle-classical-'));
  const bin = join(dir, 'engine');
  const pathBefore = process.env.MISTBOARD_JUNGLE_ENGINE_PATH;
  const flagBefore = process.env.MISTBOARD_JUNGLE_RUST_ENGINE;
  t.after(() => {
    if (pathBefore === undefined) delete process.env.MISTBOARD_JUNGLE_ENGINE_PATH;
    else process.env.MISTBOARD_JUNGLE_ENGINE_PATH = pathBefore;
    if (flagBefore === undefined) delete process.env.MISTBOARD_JUNGLE_RUST_ENGINE;
    else process.env.MISTBOARD_JUNGLE_RUST_ENGINE = flagBefore;
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.MISTBOARD_JUNGLE_ENGINE_PATH = bin;
  process.env.MISTBOARD_JUNGLE_RUST_ENGINE = 'true';
  const easy = 'misty-jungle-classical-level-1';
  writeFileSync(bin, `#!${process.execPath}\nconsole.log('id name MistyJungle 0.0.6');\n`, {
    mode: 0o755,
  });
  assert.equal(jungleClassicalBinaryAvailable(), false);
  assert.equal(isJunglePlayableEngineClientId(easy), false);
  assert.equal(botLadderFor('jungle')?.includes(easy), false);
  await assert.rejects(
    jungleLiveEngineMove(easy, jungleStateToEngineFen(createInitialJungleState('test'))),
    /skill-capable/,
  );

  writeFileSync(
    bin,
    `#!${process.execPath}
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', (line) => {
  if (line === 'uci') console.log('id name MistyJungle 0.0.7\\ninfo string classical_skill 1\\nuciok');
  if (line === 'isready') console.log('readyok');
  if (line === 'quit') process.exit(0);
  if (line.startsWith('go ')) {
    if (line !== 'go nodes 20000 movetime 1500 depth 1 noise 1000 seed 42') process.exit(7);
    console.log('info depth 1 nodes 24 time 1 score cp 3 pv a1a2\\nbestmove a1a2');
  }
});
`,
    { mode: 0o755 },
  );
  assert.equal(jungleClassicalBinaryAvailable(), true);
  assert.equal(isJunglePlayableEngineClientId(easy), true);
  assert.equal(botLadderFor('jungle')?.includes(easy), true);
  const result = await jungleLiveEngineMove(
    easy,
    jungleStateToEngineFen(createInitialJungleState('test')),
    { seed: 42 },
  );
  assert.equal(result.best, 'a1a2');
  assert.equal(result.nodes, 24);
  assert.equal(result.depth, 1);
  process.env.MISTBOARD_JUNGLE_RUST_ENGINE = 'false';
  assert.equal(isJunglePlayableEngineClientId(easy), false);
});

test('new game level snapshots preserve historical budgets without relabelling retired ids', () => {
  assert.equal(mistyLevelForEngine('jungle', 'misty-jungle-level-1'), null);
  assert.equal(mistyLevelForEngine('jungle', 'misty-jungle-level-3'), null);
  assert.equal(jungleRustTierFor('misty-jungle-level-1')?.nodes, 20_000);
  assert.equal(jungleRustTierFor('misty-jungle-level-3')?.nodes, 1_000_000);
  assert.equal(mistyLevelForEngine('jungle', 'misty-jungle-level-2'), 7);
  for (let level = 1; level < 7; level++) {
    assert.equal(mistyLevelForEngine('jungle', `misty-jungle-classical-level-${level}`), level);
  }
  assert.equal(mistyLevelForEngine('jungle', 'misty-jungle-classical-level-8'), null);
  assert.equal(mistyLevelForEngine('jungle-flip', 'misty-jungle-classical-level-1'), null);
});
