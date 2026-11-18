import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  readXiangqiPositionOnlyPuzzle,
  type XiangqiMove,
} from '@mistboard/game';
import { close, getPool, init } from './persistence-db.js';
import {
  applyXiangqiPuzzleSetupBackfill,
  planXiangqiPuzzleSetupBackfill,
  readXiangqiSetupGames,
  withXiangqiPositionSetup,
} from './xiangqi-puzzle-setup-backfill.js';

const moves: XiangqiMove[] = [
  { from: 'h3', to: 'h10' },
  { from: 'i10', to: 'h10' },
  { from: 'b3', to: 'b10' },
  { from: 'a7', to: 'a6' },
  { from: 'b10', to: 'd10' },
];
const games = [{ id: 'dpxq-fixture', moves }];
function fixture() {
  const id = 'xq-mined-dpxq-fixture-2';
  let state = createInitialXiangqiState(id);
  for (const move of moves.slice(0, 2)) state = applyStandardXiangqiMove(state, move);
  return readXiangqiPositionOnlyPuzzle({
    id,
    variant: 'xiangqi',
    title: 'Red winning advantage',
    initial: {
      id,
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
}

test('local source replay emits only the capturing setup and a fresh puzzle state', () => {
  const before = fixture();
  const puzzle = withXiangqiPositionSetup(before, games);
  assert.deepEqual(puzzle.setupMove, {
    from: 'i10',
    to: 'h10',
    captured: { color: 'red', role: 'cannon' },
  });
  assert.deepEqual(puzzle.initial.lastMove, moves[1]);
  assert.deepEqual(puzzle.initial.positionCounts, {});
  assert.equal(puzzle.initial.moveNumber, 1);
  assert.equal(before.initial.lastMove, undefined);
  assert.equal(before.setupMove, undefined);
  const { setupMove: _setup, initial, ...core } = puzzle;
  const { lastMove: _last, ...originalInitial } = initial;
  assert.deepEqual({ ...core, initial: originalInitial }, before);
  assert.doesNotMatch(JSON.stringify(puzzle), /sourceGame|history|moveLog/);
  assert.equal(JSON.stringify(puzzle).includes(JSON.stringify(moves[0])), false);
});

test('quiet setup moves also replay without a captured piece', () => {
  const source = [
    {
      id: 'dpxq-quiet',
      moves: [
        { from: 'h3', to: 'h10' },
        { from: 'a7', to: 'a6' },
      ] as XiangqiMove[],
    },
  ];
  const puzzle = fixture();
  const id = 'xq-mined-dpxq-quiet-2';
  let state = createInitialXiangqiState(id);
  for (const move of source[0]!.moves) state = applyStandardXiangqiMove(state, move);
  // The same legal three-ply material line works from this board.
  puzzle.id = id;
  const initial = {
    id,
    board: state.board,
    status: state.status,
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
    progressClockLimit: 60,
  };
  puzzle.initial = initial;
  puzzle.solution = [
    { from: 'b3', to: 'b10' },
    { from: 'a6', to: 'a5' },
    { from: 'b10', to: 'd10' },
  ];
  assert.deepEqual(withXiangqiPositionSetup(puzzle, source).setupMove, {
    from: 'a7',
    to: 'a6',
    captured: null,
  });
});

test('setup payloads reject missing pairs, mismatches and nested history', () => {
  const good = withXiangqiPositionSetup(fixture(), games);
  const bad: unknown[] = [
    { ...fixture(), setupMove: good.setupMove },
    { ...fixture(), initial: good.initial },
    { ...good, setupMove: { ...good.setupMove, to: 'h9' } },
    { ...good, setupMove: { ...good.setupMove, history: moves } },
    { ...good, setupMove: { ...good.setupMove, captured: { color: 'black', role: 'cannon' } } },
    { ...good, setupMove: { ...good.setupMove, captured: { color: 'red', role: 'dragon' } } },
    { ...good, setupMove: { ...good.setupMove, captured: { color: 'red', role: 'general' } } },
    {
      ...good,
      setupMove: { ...good.setupMove, captured: { color: 'red', role: 'cannon', history: moves } },
    },
    {
      ...good,
      initial: { ...good.initial, lastMove: { ...good.initial.lastMove, history: moves } },
    },
    { ...good, history: moves },
    { ...good, sourceGame: { gameId: games[0]!.id, ply: 2 } },
  ];
  for (const value of bad) assert.throws(() => readXiangqiPositionOnlyPuzzle(value));
  const copy = readXiangqiPositionOnlyPuzzle(good);
  good.setupMove!.captured!.role = 'horse';
  assert.equal(copy.setupMove!.captured!.role, 'cannon');
});

test('source disagreements and bad local input fail closed', () => {
  assert.throws(() => withXiangqiPositionSetup(fixture(), []), /Missing local/);
  assert.throws(
    () => withXiangqiPositionSetup(fixture(), [{ ...games[0]!, moves: moves.slice(1) }]),
    /disagrees/,
  );
  const changed = fixture();
  changed.initial.board.a5 = changed.initial.board.a4!;
  delete changed.initial.board.a4;
  assert.throws(() => withXiangqiPositionSetup(changed, games), /disagrees/);
  const wrongCapture = withXiangqiPositionSetup(fixture(), games);
  wrongCapture.setupMove!.captured = null;
  assert.throws(() => withXiangqiPositionSetup(wrongCapture, games), /Stored setup disagrees/);
  assert.deepEqual(readXiangqiSetupGames({ games }), games);
  for (const value of [
    {},
    { games: [games[0], games[0]] },
    { games: [{ id: 'x', moves: ['h3h10'] }] },
  ])
    assert.throws(() => readXiangqiSetupGames(value));
});

test('the exact 14-puzzle backfill is stable on rerun and never includes earlier moves', () => {
  const puzzles = Array.from({ length: 14 }, (_, i) => {
    const p = fixture();
    p.id = `xq-mined-dpxq-fixture-${i}-2`;
    p.initial.id = p.id;
    return p;
  });
  const sources = puzzles.map((_, i) => ({ id: `dpxq-fixture-${i}`, moves }));
  const plan = planXiangqiPuzzleSetupBackfill(puzzles, sources, 14);
  assert.equal(plan.total, 14);
  assert.equal(plan.entries.filter((e) => !e.before.setupMove).length, 14);
  const after = plan.entries.map((e) => e.after);
  assert.equal(planXiangqiPuzzleSetupBackfill(after.reverse(), sources, 14).sha256, plan.sha256);
  assert.throws(() => planXiangqiPuzzleSetupBackfill(puzzles.slice(1), sources, 14), /count/);
  assert.throws(
    () => planXiangqiPuzzleSetupBackfill([puzzles[0], puzzles[0]], sources, 2),
    /repeats/,
  );
  assert.equal(JSON.stringify(plan).includes(JSON.stringify(moves[0])), false);
});

test('backfill apply locks, pins the hash, changes only puzzle data and is idempotent', async (t) => {
  init('postgres://unused@127.0.0.1:9/never');
  t.after(close);
  let stored = fixture();
  const statements: string[] = [];
  t.mock.method(getPool(), 'connect', async () => ({
    query: async (sql: string, args: string[] = []) => {
      statements.push(sql);
      if (sql.startsWith('SELECT data')) return { rows: [{ data: stored }] };
      if (sql.startsWith('UPDATE')) {
        assert.deepEqual(JSON.parse(args[2]!), stored);
        assert.equal(args[0], stored.id);
        stored = JSON.parse(args[1]!);
        return { rowCount: 1 };
      }
      return {};
    },
    release() {},
  }));
  const plan = planXiangqiPuzzleSetupBackfill([stored], games, 1);
  const input = { games, expectedTotal: 1, expectedSha256: plan.sha256 };
  await assert.rejects(
    applyXiangqiPuzzleSetupBackfill({ ...input, expectedSha256: '0'.repeat(64) }),
    /hash changed/,
  );
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(stored.setupMove, undefined);
  assert.equal((await applyXiangqiPuzzleSetupBackfill(input)).updated, 1);
  assert.equal((await applyXiangqiPuzzleSetupBackfill(input)).updated, 0);
  assert.equal(statements.at(-1), 'COMMIT');
  assert.ok(statements.some((s) => s.endsWith('FOR UPDATE')));
  assert.ok(statements.some((s) => s.includes('pg_advisory_xact_lock')));
  assert.equal(statements.filter((s) => s.startsWith('UPDATE')).length, 1);
  assert.doesNotMatch(
    statements.join('\n'),
    /historical_xiangqi_games|xiangqi_position_publications/,
  );
});
