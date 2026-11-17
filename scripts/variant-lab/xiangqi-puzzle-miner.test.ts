import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiLegalMoves,
  readXiangqiPositionOnlyPuzzle,
  standardXiangqiEngineFen,
  type XiangqiMove,
  xiangqiMoveToPikafishUci,
} from '../../packages/game/src/index.ts';
import {
  assembleMinedXiangqiPuzzle,
  XIANGQI_SOLVER_GATE_DEFAULTS,
} from '../../packages/game/src/puzzles-xiangqi-mining.ts';
import type { XiangqiGameState } from '../../packages/game/src/variants-xiangqi.ts';
import { parseXiangqiScoredLines } from './xiangqi-pikafish-uci.ts';
import { buildXiangqiPositionPacket } from './xiangqi-position-packet.ts';
import {
  buildGatedLine,
  dhtmlxqMeta,
  loadJsonGames,
  mineXiangqiPuzzleGame,
  type XiangqiPuzzleMinerMetrics,
  type XiangqiPuzzleMinerOptions,
} from './xiangqi-puzzle-miner.ts';

test('DPXQ packet creation derives one captured setup move from the local game before auditing', async () => {
  const id = 'xq-mined-dpxq-packet-2';
  const moves: XiangqiMove[] = [
    { from: 'h3', to: 'h10' },
    { from: 'i10', to: 'h10' },
    { from: 'b3', to: 'b10' },
    { from: 'a7', to: 'a6' },
    { from: 'b10', to: 'd10' },
  ];
  let state = createInitialXiangqiState(id);
  for (const move of moves.slice(0, 2)) state = applyStandardXiangqiMove(state, move);
  const puzzle = readXiangqiPositionOnlyPuzzle({
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
  const positions = new Map<string, { state: XiangqiGameState; best: XiangqiMove }>();
  let current = puzzle.initial;
  for (const [ply, move] of puzzle.solution.entries()) {
    if (ply % 2 === 0)
      positions.set(standardXiangqiEngineFen(current), { state: current, best: move });
    current = applyStandardXiangqiMove(current, move);
  }
  const engine = {
    newGame: async () => {},
    analyzeFen: async (fen: string) => {
      const position = positions.get(fen)!;
      assert.ok(position);
      const other = getStandardXiangqiLegalMoves(position.state)
        .filter((m) => m.from !== position.best.from || m.to !== position.best.to)
        .slice(0, 2);
      return [position.best, ...other].map((m, i) => ({
        rank: i + 1,
        score: { cp: i === 0 ? 1000 : -100 * i, mate: null },
        depth: 30,
        pvUci: [xiangqiMoveToPikafishUci(m)],
      }));
    },
  };
  const input = {
    puzzles: [puzzle],
    games: [{ id: 'dpxq-packet', moves }],
    reviewNote: 'Fixture review',
    engine,
  };
  const packet = await buildXiangqiPositionPacket(input);
  const emitted = packet.items[0]!.puzzle;
  assert.deepEqual(emitted.setupMove, {
    from: 'i10',
    to: 'h10',
    captured: { color: 'red', role: 'cannon' },
  });
  assert.deepEqual(emitted.initial.lastMove, moves[1]);
  assert.equal(puzzle.initial.lastMove, undefined);
  assert.doesNotMatch(JSON.stringify(packet), /sourceGame|history|moveLog/);
  assert.equal(JSON.stringify(packet).includes(JSON.stringify(moves[0])), false);
  await assert.rejects(buildXiangqiPositionPacket({ ...input, games: [] }), /Missing local/);
});

const initial: XiangqiGameState = {
  id: 'miner-endpoint',
  moveNumber: 1,
  progressClock: 0,
  positionCounts: {},
  status: { type: 'playing', turn: 'red' },
  board: {
    d1: { color: 'red', role: 'general' },
    a1: { color: 'red', role: 'chariot' },
    e10: { color: 'black', role: 'general' },
    a5: { color: 'black', role: 'horse' },
    a8: { color: 'black', role: 'cannon' },
  },
};
const options = (maxSolutionPlies = 3) =>
  ({
    ...XIANGQI_SOLVER_GATE_DEFAULTS,
    verifyNodes: 25_000_000,
    verifyDepth: 0,
    maxSolutionPlies,
    quietKey: false,
  }) as XiangqiPuzzleMinerOptions;
function fake(mode: 'normal' | 'near-tie' | 'illegal' | 'unfinished-mate' | 'ambiguous-followup') {
  let calls = 0;
  return {
    newGame: async () => {},
    analyzeFen: async (_fen: string, _limits: unknown, ranks: number) => {
      if (ranks === 1)
        return parseXiangqiScoredLines(['info depth 30 multipv 1 score cp -600 pv e9e8'], 1);
      const ply = Math.floor(calls++ / 2) * 2;
      const best = mode === 'unfinished-mate' ? 'mate 2' : 'cp 600';
      const second = mode === 'near-tie' || (mode === 'ambiguous-followup' && ply > 0) ? 550 : -400;
      const token = mode === 'illegal' ? 'a0b1' : ply === 0 ? 'a0a4' : 'a4a7';
      return parseXiangqiScoredLines(
        [
          `info depth 30 multipv 1 score ${best} pv ${token}`,
          `info depth 30 multipv 2 score cp ${second} pv ${ply === 0 ? 'a0b0' : 'a4b4'}`,
          `info depth 30 multipv 3 score cp -500 pv ${ply === 0 ? 'a0a1' : 'a4a5'}`,
        ],
        3,
      );
    },
  };
}
function assemble(
  built: Extract<Awaited<ReturnType<typeof buildGatedLine>>, { ok: true }>,
  minSolutionPlies: number,
) {
  return assembleMinedXiangqiPuzzle(
    {
      gameId: 'fixture',
      blunderPly: 1,
      postBlunderState: initial,
      pv: built.pv,
      verifyScore: built.verifyScore,
      swingCp: 600,
    },
    { maxSolutionPlies: 3, minSolutionPlies, floorAfterTrim: true },
  );
}

test('a short verified key remains offline when it misses the final length floor', async () => {
  const built = await buildGatedLine(fake('normal'), initial, options(1));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(assemble(built, 3), { ok: false, reason: 'too-short' });
  assert.equal(assemble(built, 1).ok, true);
});

test('a near-tie root is rejected by the shared multi-budget verifier', async () => {
  const built = await buildGatedLine(fake('near-tie'), initial, options());
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.reason, 'near-tie');
});

test('an illegal engine continuation cannot produce a mined puzzle', async () => {
  const built = await buildGatedLine(fake('illegal'), initial, options());
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.reason, 'illegal-engine-pv');
});

test('an engine mate score without a forced board mate is rejected before assembly', async () => {
  const built = await buildGatedLine(fake('unfinished-mate'), initial, options(1));
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.reason, 'mate-goal-not-forced');
});

test('a complete uniquely verified material payoff remains mineable', async () => {
  const built = await buildGatedLine(fake('normal'), initial, options());
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.pv.length, 3);
  const result = assemble(built, 3);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.puzzle.solution.length, 3);
});

test('an ambiguous follow-up cannot publish only its earlier preparation capture', async () => {
  const built = await buildGatedLine(fake('ambiguous-followup'), initial, options());
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.reason, 'followup-not-unique');
});

test('DhtmlXQ metadata carries the archive page the source credit needs (#712)', () => {
  const raw = [
    '[DhtmlXQ_title]Title only[/DhtmlXQ_title]',
    '[DhtmlXQ_date]1987.5.3[/DhtmlXQ_date]',
    '[DhtmlXQ_result]黑胜[/DhtmlXQ_result]',
    '[DhtmlXQ_red]R[/DhtmlXQ_red]',
    '[DhtmlXQ_black]B[/DhtmlXQ_black]',
    '[DhtmlXQ_source_url]http://www.dpxq.com/hldcg/search/view_m_7.html[/DhtmlXQ_source_url]',
  ].join('\n');
  assert.deepEqual(dhtmlxqMeta(raw, 'view_m_7', 'dpxq-archive-test'), {
    event: 'Title only',
    playedOn: '1987-05-03',
    result: '0-1',
    redName: 'R',
    blackName: 'B',
    sourceSlug: 'dpxq-archive-test',
    sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_7.html',
    sourceGameId: 'view_m_7',
  });
});

test('a JSON games export loads in order, skips short games and honours offset and limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xq-miner-json-'));
  const file = join(dir, 'games.json');
  const moves = (n: number) => Array.from({ length: n }, () => 'h3e3');
  writeFileSync(
    file,
    JSON.stringify({
      games: [
        { id: 'a', moves: moves(30) },
        { id: 'short', moves: moves(5) },
        { id: 'b', moves: moves(30), meta: { sourceSlug: 'elephantchess-pvp' } },
        { id: 'c', moves: moves(30) },
      ],
    }),
  );
  const games = loadJsonGames({ gamesFile: file, plyMin: 20, seed: 0, offset: 1, limit: 1 });
  assert.deepEqual(
    games.map((game) => [game.id, game.meta?.sourceSlug]),
    [['b', 'elephantchess-pvp']],
  );
});

test('the mining path retains verified short candidates through its offline hook only', async () => {
  const retained: unknown[] = [];
  const metrics = {
    gamesRequested: 1,
    gamesLoaded: 1,
    gamesScanned: 0,
    gamesFailed: 0,
    gamesIllegalReplay: 0,
    positionsEvaluated: 0,
    verifyEvals: 0,
    candidates: 0,
    verified: 0,
    rejects: {},
    themes: {},
  } as XiangqiPuzzleMinerMetrics;
  const records = await mineXiangqiPuzzleGame(
    {
      newGame: async () => {},
      analyzeMoves: async (moves) => [
        { rank: 1, score: { cp: moves.length === 2 ? 600 : 0, mate: null }, pvUci: ['h2e2'] },
      ],
      analyzeFen: async () =>
        parseXiangqiScoredLines(
          [
            'info depth 30 multipv 1 score cp 600 pv e2e6',
            'info depth 30 multipv 2 score cp -300 pv h0g2',
            'info depth 30 multipv 3 score cp -400 pv a0a1',
          ],
          3,
        ),
    },
    {
      id: 'fixture',
      moves: [
        { from: 'h3', to: 'e3' },
        { from: 'h10', to: 'g8' },
      ],
    },
    {
      ...options(1),
      minSolutionPlies: 3,
      floorAfterTrim: true,
      minPly: 0,
      scanNodes: 100,
      swingCp: 199,
      winCp: 199,
      decidedCp: 635,
      perGame: 3,
    },
    metrics,
    new Set(),
    {
      shortCandidateVerified: async (record) => {
        retained.push(record);
      },
    },
  );
  assert.deepEqual(records, []);
  assert.equal(retained.length, 1);
  assert.equal(metrics.verified, 0);
  assert.deepEqual(metrics.rejects, { 'too-short': 1 });
});

test('verification starts with fresh puzzle history rather than the source-game clock', async () => {
  const engine = fake('normal');
  const seen: string[] = [];
  const result = await buildGatedLine(
    {
      newGame: engine.newGame,
      analyzeFen: async (fen, limits, ranks) => {
        seen.push(fen);
        return engine.analyzeFen(fen, limits, ranks);
      },
    },
    { ...initial, progressClock: 59, positionCounts: { stale: 3 } },
    options(1),
  );
  assert.equal(result.ok, true);
  assert.ok(seen.length === 2 && seen.every((fen) => fen.endsWith(' - - 0 1')));
});
