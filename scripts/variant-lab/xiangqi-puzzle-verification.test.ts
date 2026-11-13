import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { XiangqiPuzzle } from '../../packages/game/src/puzzles-xiangqi.ts';
import { XIANGQI_SOLVER_GATE_DEFAULTS } from '../../packages/game/src/puzzles-xiangqi-mining.ts';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
} from '../../packages/game/src/variants-xiangqi-standard.ts';
import { xiangqiMoveToPikafishUci } from '../../packages/game/src/xiangqi-uci.ts';
import { auditXiangqiCorpusPuzzle } from './xiangqi-corpus-quality-audit.ts';
import { parseXiangqiScoredLines } from './xiangqi-pikafish-uci.ts';
import { buildGatedLine, type XiangqiPuzzleMinerOptions } from './xiangqi-puzzle-miner.ts';
import {
  completesXiangqiMateGoal,
  verifyXiangqiSolverTurn,
} from './xiangqi-puzzle-verification.ts';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/puzzle-quality-regressions.json', import.meta.url), 'utf8'),
) as Record<string, XiangqiPuzzle>;
const mate = fixtures.KslJf!;
const fork = fixtures.MHTdb!;
function stateAt(puzzle: XiangqiPuzzle, ply: number) {
  return puzzle.solution
    .slice(0, ply)
    .reduce((s, m) => applyStandardXiangqiMove(s, m), puzzle.initial);
}
function scored(puzzle: XiangqiPuzzle, ply: number, best: string, second: string) {
  const state = stateAt(puzzle, ply),
    stored = puzzle.solution[ply]!;
  const alternatives = getStandardXiangqiLegalMoves(state).filter(
    (m) => m.from !== stored.from || m.to !== stored.to,
  );
  return parseXiangqiScoredLines(
    [
      `info depth 30 multipv 1 score ${best} pv ${xiangqiMoveToPikafishUci(stored)}`,
      `info depth 30 multipv 2 score ${second} pv ${xiangqiMoveToPikafishUci(alternatives[0]!)}`,
      `info depth 30 multipv 3 score cp -800 pv ${xiangqiMoveToPikafishUci(alternatives[1]!)}`,
    ],
    3,
  );
}

test('a later actual mate completes its goal without weakening root admission', async () => {
  const ply = mate.solution.length - 1,
    state = stateAt(mate, ply),
    move = mate.solution[ply]!;
  assert.equal(completesXiangqiMateGoal(state, move, ply, mate.goal), true);
  assert.equal(completesXiangqiMateGoal(state, move, 0, mate.goal), false);
  assert.equal(completesXiangqiMateGoal(state, move, ply, { type: 'winning-advantage' }), false);
  const result = await verifyXiangqiSolverTurn(
    {
      newGame: async () => {
        throw new Error('must not search');
      },
      analyzeFen: async () => {
        throw new Error('must not search');
      },
    },
    state,
    ply,
    move,
    mate.goal,
  );
  assert.equal(result.judgment.reason, 'kernel-mate-goal-completed');
  assert.deepEqual(result.budgets, []);
});

test('a reviewed longer mate is proved or retained for review, never rejected for slower wins', async () => {
  let searches = 0;
  const result = await auditXiangqiCorpusPuzzle(
    {
      newGame: async () => {},
      analyzeFen: async () => {
        const ply = Math.floor(searches++ / 2) * 2;
        assert.ok(ply < 4, 'the final mate is established by the board');
        return scored(mate, ply, `mate ${3 - ply / 2}`, 'cp -400');
      },
    },
    mate,
  );
  if (result.decision.disposition !== 'keep') {
    assert.equal(result.decision.disposition, 'needs-review');
    assert.equal(result.decision.reason, 'mate-goal-budget-exhausted');
  }
  assert.equal(searches, 0, 'the complete mate goal is independently board-proven');
});

test('an ambiguous intermediate fork stays in review instead of losing its chariot payoff', async () => {
  let searches = 0;
  const result = await auditXiangqiCorpusPuzzle(
    {
      newGame: async () => {},
      analyzeFen: async () => {
        const ply = searches < 2 ? 0 : 2;
        searches++;
        return scored(fork, ply, 'cp 484', ply === 0 ? 'cp -345' : 'cp 134');
      },
    },
    fork,
  );
  assert.equal(result.decision.disposition, 'needs-review');
  assert.equal(result.decision.reason, 'tactical-payoff-unverified');
  assert.equal('replacement' in result.decision, false);
});

test('selective 100M evidence cannot erase a 5M/25M admission disagreement', async () => {
  const budgets: number[] = [];
  const result = await verifyXiangqiSolverTurn(
    {
      newGame: async () => {},
      analyzeFen: async (_fen, limits) => {
        budgets.push(limits.nodes!);
        const cp = limits.nodes === 25_000_000 ? 301 : 289;
        return scored(fork, 0, `cp ${cp}`, 'cp -500');
      },
    },
    fork.initial,
    0,
    fork.solution[0],
    fork.goal,
  );
  assert.deepEqual(budgets, [5_000_000, 25_000_000, 100_000_000]);
  assert.equal(result.judgment.verdict, 'unresolved');
  assert.equal(result.judgment.reason, 'separation-unstable');
});

test('verification refuses an engine hash setting outside the frozen profile before searching', async () => {
  let calls = 0;
  await assert.rejects(
    verifyXiangqiSolverTurn(
      {
        hashMb: 16,
        newGame: async () => {
          calls++;
        },
        analyzeFen: async () => {
          calls++;
          return [];
        },
      },
      fork.initial,
      0,
      fork.solution[0],
      fork.goal,
    ),
    /engine hash.*64 MB/,
  );
  assert.equal(calls, 0);
});

test('stable decisive evidence stops at 25M without a nominal depth target', async () => {
  const calls: unknown[] = [];
  const result = await verifyXiangqiSolverTurn(
    {
      hashMb: 64,
      newGame: async () => {},
      analyzeFen: async (_fen, limits) => {
        calls.push(limits);
        return scored(fork, 0, 'cp 600', 'cp -300');
      },
    },
    fork.initial,
    0,
    fork.solution[0],
    fork.goal,
  );
  assert.deepEqual(calls, [
    { nodes: 5_000_000, movetimeMs: 30_000 },
    { nodes: 25_000_000, movetimeMs: 90_000 },
  ]);
  assert.equal(result.judgment.verdict, 'pass');
});

test('two mating starts remain ambiguous in a winning-advantage exercise', async () => {
  const p = fixtures['48gHj']!;
  const result = await verifyXiangqiSolverTurn(
    { newGame: async () => {}, analyzeFen: async () => scored(p, 0, 'mate 9', 'mate 10') },
    p.initial,
    0,
    p.solution[0],
    p.goal,
  );
  assert.equal(result.judgment.verdict, 'fail');
  assert.equal(result.judgment.reason, 'mate-not-unique');
});

test('a time-capped earlier search remains unresolved even after a complete 100M search', async () => {
  const engine = {
    lastSearch: undefined as import('./xiangqi-pikafish-uci.ts').PikafishEngine['lastSearch'],
    newGame: async () => {},
    analyzeFen: async (
      _fen: string,
      limits: import('./xiangqi-pikafish-uci.ts').XiangqiSearchLimits,
      multipv: number,
    ) => {
      const capped = limits.nodes === 25_000_000;
      engine.lastSearch = {
        limits,
        multipv,
        elapsedMs: capped ? limits.movetimeMs! : 1,
        rawInfo: [`info nodes ${capped ? 1000 : limits.nodes}`, 'bestmove a0a4'],
      };
      return scored(fork, 0, 'cp 600', 'cp -300');
    },
  };
  const result = await verifyXiangqiSolverTurn(
    engine,
    fork.initial,
    0,
    fork.solution[0],
    fork.goal,
  );
  assert.deepEqual(result.budgets, [5_000_000, 25_000_000, 100_000_000]);
  assert.equal(result.judgment.reason, 'search-time-cap');
  assert.equal(result.judgment.verdict, 'unresolved');
  assert.equal(result.transcripts.length, 3);
});

test('the miner completes the same reviewed mate without an admission bypass at its final turn', async () => {
  let calls = 0;
  let replies = 0;
  const result = await buildGatedLine(
    {
      newGame: async () => {},
      analyzeFen: async (_fen, _limits, ranks) => {
        const ply = Math.floor(calls / 2) * 2;
        if (ranks === 1)
          return parseXiangqiScoredLines(
            [
              `info depth 30 multipv 1 score cp -600 pv ${xiangqiMoveToPikafishUci(mate.solution[replies++ * 2 + 1]!)}`,
            ],
            1,
          );
        calls++;
        return scored(mate, ply, `mate ${3 - ply / 2}`, 'cp -400');
      },
    },
    mate.initial,
    {
      ...XIANGQI_SOLVER_GATE_DEFAULTS,
      verifyNodes: 25_000_000,
      verifyDepth: 0,
      maxSolutionPlies: 7,
    } as XiangqiPuzzleMinerOptions,
  );
  if (!result.ok) {
    assert.equal(result.reason, 'mate-goal-budget-exhausted');
    return;
  }
  assert.deepEqual(result.pv, mate.solution);
  assert.equal(calls, 2, 'later mate bounds are board-proven instead of re-evaluated');
});
