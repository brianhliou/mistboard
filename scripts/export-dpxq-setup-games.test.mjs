import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  readXiangqiPositionOnlyPuzzle,
} from '@mistboard/game';
import { tsImport } from 'tsx/esm/api';

const { readXiangqiSetupGames, withXiangqiPositionSetup } = await tsImport(
  '../apps/server/src/xiangqi-puzzle-setup-backfill.ts',
  import.meta.url,
);

const repo = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('./export-dpxq-setup-games.mjs', import.meta.url));
// Same capturing setup and continuation as xiangqi-puzzle-setup-backfill.test.ts.
const moves = [
  { from: 'h3', to: 'h10' },
  { from: 'i10', to: 'h10' },
  { from: 'b3', to: 'b10' },
  { from: 'a7', to: 'a6' },
  { from: 'b10', to: 'd10' },
];
const puzzleId = 'xq-mined-dpxq-fixture-2';

function archive() {
  const dir = mkdtempSync(join(tmpdir(), 'dpxq-setup-test-'));
  writeFileSync(
    join(dir, 'dpxq-fixture.html'),
    // DPXQ pages contain an empty template before the real movelist. The
    // shorter alternative also must not win over the miner's longest run.
    '<script>var template="[DhtmlXQ_movelist][/DhtmlXQ_movelist]";' +
      'var short="[DhtmlXQ_movelist]7770[/DhtmlXQ_movelist]";' +
      'var game="[DhtmlXQ_movelist]77708070171003041030[/DhtmlXQ_movelist]";</script>',
  );
  writeFileSync(join(dir, 'dpxq-other.dhtmlxq'), '[DhtmlXQ_movelist]77477062[/DhtmlXQ_movelist]');
  return dir;
}

function run(args) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

test('a two-game local archive exports only the requested source and preserves the setup move', () => {
  const dir = archive();
  const out = join(dir, 'local.json');
  const result = run(['--dir', dir, '--puzzle', puzzleId, '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(readFileSync(out, 'utf8'));
  const expected = [{ id: 'dpxq-fixture', moves: moves.slice(0, 2) }];
  assert.deepEqual(payload, { games: expected });
  const games = readXiangqiSetupGames(payload);
  assert.deepEqual(games, payload.games, 'the backfill reader must accept output unchanged');

  let state = createInitialXiangqiState(puzzleId);
  for (const move of moves.slice(0, 2)) state = applyStandardXiangqiMove(state, move);
  const puzzle = readXiangqiPositionOnlyPuzzle({
    id: puzzleId,
    variant: 'xiangqi',
    title: 'Red winning advantage',
    initial: {
      id: puzzleId,
      board: state.board,
      status: state.status,
      moveNumber: 1,
      progressClock: 0,
      positionCounts: {},
      progressClockLimit: 60,
    },
    solution: moves.slice(2),
    goal: { type: 'winning-advantage', winner: 'red', centipawns: 1000 },
    themes: ['winning', 'winning-material'],
    credit: {
      name: 'DPXQ',
      event: 'Fixture',
      red: 'Red',
      black: 'Black',
      url: 'http://www.dpxq.com/hldcg/search/view_m_1.html',
    },
  });
  const after = withXiangqiPositionSetup(puzzle, games);
  assert.deepEqual(after, withXiangqiPositionSetup(puzzle, [{ id: 'dpxq-fixture', moves }]));
  assert.deepEqual(after.setupMove, {
    from: 'i10',
    to: 'h10',
    captured: { color: 'red', role: 'cannon' },
  });
});

test('file and repeated argument ids share one game prefix through the largest requested ply', () => {
  const dir = archive();
  const ids = join(dir, 'puzzles.txt');
  writeFileSync(ids, `\n${puzzleId}\n${puzzleId}\n`);
  const result = run([
    '--dir',
    dir,
    '--puzzles-file',
    ids,
    '--puzzle',
    'xq-mined-dpxq-fixture-3',
    '--puzzle',
    puzzleId,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const { out } = JSON.parse(result.stdout);
  assert.ok(isAbsolute(out));
  assert.ok(relative(repo, out).startsWith('..'), 'default output must be outside the repo');
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), {
    games: [{ id: 'dpxq-fixture', moves: moves.slice(0, 3) }],
  });
  const rerun = run(['--dir', dir, '--puzzle', puzzleId, '--out', out]);
  assert.notEqual(rerun.status, 0, 'exports must not overwrite an existing local file');
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).games[0].moves.length, 3);
});

test('invalid, missing, too-short and ambiguous sources fail without writing an export', () => {
  const dir = archive();
  const out = join(dir, 'rejected.json');
  for (const id of [
    'xq-mined-other-2',
    'xq-mined-dpxq-fixture-0',
    'xq-mined-dpxq-fixture-9007199254740992',
    'xq-mined-dpxq-missing-2',
    'xq-mined-dpxq-fixture-6',
  ]) {
    const result = run(['--dir', dir, '--puzzle', id, '--out', out]);
    assert.notEqual(result.status, 0, id);
    assert.equal(existsSync(out), false);
  }
  assert.notEqual(run(['--dir', dir, '--out', out]).status, 0);
  writeFileSync(join(dir, 'dpxq-fixture.txt'), '77708070');
  const ambiguous = run(['--dir', dir, '--puzzle', puzzleId, '--out', out]);
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /[Aa]mbiguous/);
  assert.equal(existsSync(out), false);
});
