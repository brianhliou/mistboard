import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  pikafishXiangqiWarmSessionStats,
  XIANGQI_PLAYABLE_ENGINES,
  xiangqiLiveEngineMove,
} from './xiangqi-pikafish-engine.js';

const fixtureDir = mkdtempSync(join(tmpdir(), 'xiangqi-pikafish-'));
const logPath = join(fixtureDir, 'commands.log');
const binPath = join(fixtureDir, 'pikafish.mjs');
const netPath = join(fixtureDir, 'xiangqi-test.nnue');

// Answers the handshake and every `go` with a fixed move, and appends
// "<pid> <command>" to a log so a test can see which process got which line.
writeFileSync(
  binPath,
  `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    appendFileSync(${JSON.stringify(logPath)}, process.pid + ' ' + line + '\\n');
    if (line === 'uci') process.stdout.write('option name EvalFile type string default\\nuciok\\n');
    if (line === 'isready') process.stdout.write('readyok\\n');
    if (line.startsWith('go')) process.stdout.write('info depth 3 score cp 12 nodes 30 time 2 pv h2e2\\nbestmove h2e2\\n');
  }
});
`,
);
chmodSync(binPath, 0o755);
writeFileSync(netPath, '');

const priorEnv = {
  bin: process.env.MISTBOARD_PIKAFISH_XIANGQI_PATH,
  net: process.env.MISTBOARD_PIKAFISH_XIANGQI_NET,
};
before(() => {
  process.env.MISTBOARD_PIKAFISH_XIANGQI_PATH = binPath;
  process.env.MISTBOARD_PIKAFISH_XIANGQI_NET = netPath;
});
after(() => {
  for (const [name, value] of [
    ['MISTBOARD_PIKAFISH_XIANGQI_PATH', priorEnv.bin],
    ['MISTBOARD_PIKAFISH_XIANGQI_NET', priorEnv.net],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(fixtureDir, { recursive: true, force: true });
});

function logLines(): Array<{ pid: string; line: string }> {
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((row) => {
      const space = row.indexOf(' ');
      return { pid: row.slice(0, space), line: row.slice(space + 1) };
    });
}

test('each Pikafish level gets its own process, so a weak level never searches from a strong level hash', async () => {
  const weak = XIANGQI_PLAYABLE_ENGINES[0];
  const strong = XIANGQI_PLAYABLE_ENGINES[XIANGQI_PLAYABLE_ENGINES.length - 1];
  assert.ok(weak && strong && weak.id !== strong.id);
  const start = pikafishXiangqiWarmSessionStats();

  await xiangqiLiveEngineMove(strong.id, ['h2e2'], { movetimeMs: 50 });
  await xiangqiLiveEngineMove(weak.id, ['h2e2', 'h9g7'], { movetimeMs: 50 });
  await xiangqiLiveEngineMove(strong.id, ['h2e2', 'h9g7', 'b0c2'], { movetimeMs: 50 });

  const stats = pikafishXiangqiWarmSessionStats();
  assert.equal(stats.spawned - start.spawned, 2, 'one process per level');
  assert.equal(stats.reused - start.reused, 1, 'a level reuses only its own process');

  const goByPid = new Map<string, string[]>();
  for (const { pid, line } of logLines()) {
    if (line.startsWith('go ')) goByPid.set(pid, [...(goByPid.get(pid) ?? []), line]);
  }
  for (const gos of goByPid.values()) {
    assert.equal(new Set(gos).size, 1, `one process saw two node budgets: ${gos.join(' | ')}`);
  }
});

test('a move that starts or switches games clears the hash with ucinewgame; a move that continues one does not', async () => {
  const tier = XIANGQI_PLAYABLE_ENGINES[1];
  assert.ok(tier);
  const histories = [
    [], // game A, first move
    ['h2e2'], // game A, the other side's first move
    ['h2e2', 'h9g7'], // game A continues
    ['b0c2', 'g6g5', 'h2e2'], // game B, opened from a pre-played book line
    ['b0c2', 'g6g5', 'h2e2', 'h9g7'], // game B continues
    ['h2e2', 'h9g7', 'b0c2'], // back to game A on the same process
  ];
  const expectReset = [true, true, false, true, false, true];
  writeFileSync(logPath, '');
  for (const moves of histories) await xiangqiLiveEngineMove(tier.id, moves, { movetimeMs: 50 });

  const sent = logLines()
    .map(({ line }) => line)
    .filter((line) => line === 'ucinewgame' || line.startsWith('position'));
  const resets: boolean[] = [];
  sent.forEach((line, index) => {
    if (line.startsWith('position')) resets.push(sent[index - 1] === 'ucinewgame');
  });
  assert.deepEqual(resets, expectReset);
});
