// crazyhouse-xiangqi.ini against the kernel it has to agree with.
//
// The parity fixture (packages/game/src/fixtures/crazyhouse-xiangqi-parity.json)
// ties move generation to Fairy-Stockfish. It says nothing about how a game
// ENDS, and that half lives in .ini options whose defaults come from the
// built-in xiangqi parent: leave one out and the engine silently plays a
// different game (duck xiangqi's nMoveRule, #472; the parent's AXF chasing
// rule here). So every ending the kernel enforces is written in the .ini and
// pinned here.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CRAZYHOUSE_XIANGQI_PROGRESS_CLOCK_LIMIT,
  CRAZYHOUSE_XIANGQI_REPETITION_COUNT,
  CRAZYHOUSE_XIANGQI_START_FEN,
  crazyhouseXiangqiDropRegion,
  crazyhouseXiangqiFen,
  createInitialCrazyhouseXiangqiState,
} from '@mistboard/game';
import { CRAZYHOUSE_XIANGQI_FSF_VARIANT } from './crazyhouse-xiangqi-fsf-engine.js';
import { fairyStockfishPath } from './uci-engine-harness.js';

// Resolved from the repo root: tests also run from dist/, where tsc copies no .ini.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const INI_PATH = resolve(repoRoot, 'apps/server/src/crazyhouse-xiangqi.ini');
const INI = readFileSync(INI_PATH, 'utf8');

function option(name: string): string | null {
  const match = INI.match(new RegExp(`^${name}\\s*=\\s*(\\S+)\\s*$`, 'm'));
  return match ? match[1]! : null;
}

test('the .ini names every game-ending rule the kernel enforces', () => {
  // The generals may not face each other.
  assert.equal(option('flyingGeneral'), 'true');
  // The side with no legal move loses, in check or not.
  assert.equal(option('stalemateValue'), 'loss');
  // Repetition: the kernel's count, a draw, unless one side checked throughout.
  assert.equal(Number(option('nFoldRule')), CRAZYHOUSE_XIANGQI_REPETITION_COUNT);
  assert.equal(option('nFoldValue'), 'draw');
  assert.equal(option('perpetualCheckIllegal'), 'true');
  // No chase law in the kernel; the xiangqi parent would bring AXF's.
  assert.equal(option('chasingRule'), 'none');
  // A drop may give check, and mate.
  assert.equal(option('dropChecks'), 'true');
});

test('the .ini starts where the kernel starts and confines advisors and elephants to their own half', () => {
  // Advisors and elephants in hand, the back rank R N . . K . . N R.
  const startFen = INI.match(/^startFen\s*=\s*(.+?)\s*$/m)?.[1];
  assert.equal(startFen, CRAZYHOUSE_XIANGQI_START_FEN);
  assert.equal(startFen, crazyhouseXiangqiFen(createInitialCrazyhouseXiangqiState('ini-test')));
  // The mobility region is where a piece moves and where it drops.
  const red = '*1 *2 *3 *4 *5';
  const black = '*6 *7 *8 *9 *10';
  const region = (name: string) =>
    INI.match(new RegExp(`^${name}\\s*=\\s*(.+?)\\s*$`, 'm'))?.[1] ?? null;
  assert.equal(region('mobilityRegionWhiteFers'), red);
  assert.equal(region('mobilityRegionBlackFers'), black);
  assert.equal(region('mobilityRegionWhiteElephant'), red);
  assert.equal(region('mobilityRegionBlackElephant'), black);
  for (const role of ['advisor', 'elephant'] as const) {
    assert.deepEqual(
      crazyhouseXiangqiDropRegion(role, 'red').map((sq) => Number(sq.slice(1)) <= 5),
      Array(45).fill(true),
    );
  }
});

test('the .ini keeps no move-count draw because no FSF setting matches the kernel clock', () => {
  // The kernel draws after this many plies without a CAPTURE. Fairy-Stockfish
  // also resets its counter on every DROP, so nMoveRule = limit / 2 would make
  // the engine believe a game drawn later than it is, and any other value
  // earlier. Off is the only honest setting; the server adjudicates the draw.
  assert.equal(CRAZYHOUSE_XIANGQI_PROGRESS_CLOCK_LIMIT, 60);
  assert.equal(Number(option('nMoveRule')), 0);
});

function stockFsf(): string | null {
  try {
    const bin = fairyStockfishPath();
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/**
 * Depth-1 score for the side to move after `moves`, under a copy of the .ini
 * with nMoveRule = 1: FSF then calls a position drawn once its counter reaches
 * 2, so every reply scores 0 exactly when the last move did NOT reset it.
 */
async function depthOneScoreWithOneMoveRule(
  bin: string,
  fen: string,
  moves: string,
): Promise<number | null> {
  const dir = mkdtempSync(join(tmpdir(), 'chx-nmove-'));
  try {
    const ini = join(dir, 'n1.ini');
    writeFileSync(ini, INI.replace(/^nMoveRule\s*=\s*\d+\s*$/m, 'nMoveRule = 1'));
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const done = new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => reject(new Error('fsf probe timed out')), 10_000);
      timer.unref();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        // Quit only once the search has answered: EOF or `quit` mid-search
        // stops it before the score line is printed.
        if (/^bestmove /m.test(output)) {
          clearTimeout(timer);
          child.stdin.end('quit\n');
          resolveDone();
        }
      });
      child.on('error', reject);
    });
    child.stdin.write(
      [
        'uci',
        `setoption name VariantPath value ${ini}`,
        `setoption name UCI_Variant value ${CRAZYHOUSE_XIANGQI_FSF_VARIANT}`,
        'isready',
        `position fen ${fen} moves ${moves}`,
        'go depth 1',
        '',
      ].join('\n'),
    );
    await done;
    const line = output
      .split('\n')
      .filter((l) => l.startsWith('info depth 1 ') && l.includes(' score cp '))
      .at(-1);
    const match = line?.match(/ score cp (-?\d+)/);
    return match ? Number(match[1]) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('stock Fairy-Stockfish resets its move counter on a drop (why nMoveRule stays 0)', async (t) => {
  const bin = stockFsf();
  if (!bin) {
    t.skip('stock Fairy-Stockfish not on this box');
    return;
  }
  // A quiet endgame, no capture within reach: Red drops a chariot, or moves one.
  const afterDrop = await depthOneScoreWithOneMoveRule(
    bin,
    'n4k3/9/9/9/9/9/9/9/9/3K5[R] w - - 0 1',
    'R@a1',
  );
  const afterMove = await depthOneScoreWithOneMoveRule(
    bin,
    'n4k3/9/9/9/9/9/9/9/R8/3K5[] w - - 0 1',
    'a2a1',
  );
  assert.equal(afterMove, 0, 'a quiet board move does not reset the counter: every reply is drawn');
  assert.ok(
    afterDrop !== null && afterDrop !== 0,
    `a drop resets the counter (score ${afterDrop}). If this fails, FSF no longer resets on drops: ` +
      'set nMoveRule = CRAZYHOUSE_XIANGQI_PROGRESS_CLOCK_LIMIT / 2 and update the test above.',
  );
});
