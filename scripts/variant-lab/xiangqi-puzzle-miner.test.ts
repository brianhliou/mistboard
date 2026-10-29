import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  validateStandardXiangqiPuzzle,
  type XiangqiPuzzle,
} from '../../packages/game/src/index.ts';

const execFileAsync = promisify(execFile);
const miner = resolve(import.meta.dirname, 'xiangqi-puzzle-miner.ts');

// A legal opening leaves Red a cannon capture on e7. The canned UCI searches
// isolate verification outcomes without requiring Pikafish, a net or a DB.
async function mineFixture(mode: 'short' | 'near-tie' | 'illegal' | 'unfinished-mate' | 'long') {
  const dir = mkdtempSync(join(tmpdir(), 'xq-miner-short-'));
  const games = join(dir, 'games');
  mkdirSync(games);
  writeFileSync(join(games, 'fixture.txt'), 'h3e3 h10g8');
  const binary = join(dir, 'engine.mjs');
  writeFileSync(
    binary,
    `#!${process.execPath}
import { createInterface } from 'node:readline';
const mode = ${JSON.stringify(mode)};
let position = '';
let multipv = 1;
let solverSearches = 0;
for await (const command of createInterface({ input: process.stdin })) {
  if (command === 'uci') console.log('uciok');
  else if (command === 'isready') console.log('readyok');
  else if (command.startsWith('setoption name MultiPV')) multipv = Number(command.split(' ').at(-1));
  else if (command.startsWith('position ')) position = command;
  else if (command.startsWith('go ')) {
    let score = 'cp 0';
    let second = 'cp 40';
    let move = 'e2e6';
    if (position.startsWith('position startpos')) {
      // Only the second recorded move is a blunder: scans [0, 0, 600].
      if (position === 'position startpos moves h2e2 h9g7') score = 'cp 600';
    } else if (multipv === 1) {
      score = 'cp -600';
      move = 'b9c7';
    } else {
      solverSearches += 1;
      score = mode === 'unfinished-mate' ? 'mate 2' : 'cp 600';
      if (mode === 'near-tie' || (solverSearches > 1 && mode !== 'long')) second = 'cp 550';
      if (mode === 'illegal') move = 'e2f3';
      else if (solverSearches > 1) move = 'h0g2';
    }
    console.log('info depth 20 multipv 1 score ' + score + ' pv ' + move);
    if (multipv === 2) console.log('info depth 20 multipv 2 score ' + second + ' pv b2e2');
    console.log('bestmove ' + move);
  } else if (command === 'quit') break;
}
`,
  );
  chmodSync(binary, 0o755);
  const jsonl = join(dir, 'mine.jsonl');
  const seed = join(dir, 'seed.json');
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      miner,
      '--source',
      'dir',
      '--dir',
      games,
      '--binary',
      binary,
      '--net',
      join(dir, 'unused.nnue'),
      '--concurrency',
      '1',
      '--ply-min',
      '0',
      '--min-ply',
      '0',
      '--max-solution-plies',
      '3',
      '--jsonl',
      jsonl,
      '--emit-seed',
      '--seed-path',
      seed,
    ],
    { timeout: 30_000 },
  );
  return {
    sidecar: readFileSync(jsonl, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    seed: JSON.parse(readFileSync(seed, 'utf8')) as { puzzles: XiangqiPuzzle[] },
    metrics: JSON.parse(stdout.trim().split('\n').at(-1)!) as {
      games: { scanned: number; failed: number };
      candidates: number;
      verified: number;
      verifiedShort: number;
      rejects: Record<string, number>;
    },
  };
}

test('offline output retains a verified one-ply line without publishing it', async () => {
  const { sidecar, seed, metrics } = await mineFixture('short');
  assert.deepEqual(metrics.games, {
    requested: 50,
    loaded: 1,
    scanned: 1,
    failed: 0,
    illegalReplayTruncated: 0,
  });
  assert.equal(metrics.candidates, 1);
  assert.equal(sidecar.length, 1, 'a verified short candidate must survive in offline output');
  const record = sidecar[0];
  assert.equal(record.disposition, 'verified-short');
  assert.equal(record.minSolutionPlies, 3);
  assert.equal(record.solutionPlyCount, 1);
  assert.deepEqual(record.solution, ['e3-e7']);
  assert.equal(record.gameId, 'fixture');
  assert.equal(record.ply, 2);
  assert.equal(record.swingCp, 600);
  assert.equal(record.verifyBestCp, 600);
  assert.equal(record.verifySecondCp, 40);
  assert.deepEqual(record.puzzle.solution, [{ from: 'e3', to: 'e7' }]);
  assert.deepEqual(record.puzzle.sourceGame, { gameId: 'fixture', ply: 2 });
  assert.equal(validateStandardXiangqiPuzzle(record.puzzle).ok, true);
  assert.equal(metrics.verifiedShort, 1);
  assert.equal(metrics.verified, 0);
  assert.deepEqual(metrics.rejects, { 'too-short': 1 });
  assert.deepEqual(seed.puzzles, [], 'retained candidates must not enter the serving seed');
});

for (const mode of ['near-tie', 'illegal', 'unfinished-mate'] as const) {
  test(`offline output does not retain a ${mode} line as a verified short candidate`, async () => {
    const { sidecar, seed, metrics } = await mineFixture(mode);
    assert.equal(metrics.games.scanned, 1);
    assert.equal(metrics.games.failed, 0);
    assert.equal(metrics.candidates, 1);
    assert.equal(metrics.verified, 0);
    assert.equal(metrics.verifiedShort, 0);
    assert.deepEqual(sidecar, []);
    assert.deepEqual(seed.puzzles, []);
    assert.deepEqual(metrics.rejects, {
      [mode === 'near-tie' ? 'near-tie' : mode === 'illegal' ? 'pv-illegal' : 'mate-not-reached']:
        1,
    });
  });
}

test('normal candidates still publish when their verified line meets the minimum', async () => {
  const { sidecar, seed, metrics } = await mineFixture('long');
  assert.equal(metrics.games.failed, 0);
  assert.equal(metrics.verified, 1);
  assert.equal(metrics.verifiedShort, 0);
  assert.deepEqual(metrics.rejects, {});
  assert.equal(sidecar.length, 1);
  assert.equal(sidecar[0].disposition, undefined);
  assert.equal(sidecar[0].puzzle, undefined);
  // Existing payoff trimming remains allowed to reduce an accepted 3-ply line
  // to a one-ply capture. Only lines rejected by the minimum get retained.
  assert.equal(seed.puzzles.length, 1);
  assert.equal(seed.puzzles[0]?.solution.length, 1);
  assert.equal(validateStandardXiangqiPuzzle(seed.puzzles[0]!).ok, true);
});
