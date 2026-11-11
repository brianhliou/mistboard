import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { XiangqiPuzzle } from '../../packages/game/src/puzzles-xiangqi.ts';
import { proveXiangqiMateGoal } from '../../packages/game/src/puzzles-xiangqi-mate.ts';
import { XIANGQI_SOLVER_GATE_DEFAULTS } from '../../packages/game/src/puzzles-xiangqi-mining.ts';
import {
  positionRepetitionKey,
  type XiangqiGameState,
} from '../../packages/game/src/variants-xiangqi.ts';
import { applyStandardXiangqiMove } from '../../packages/game/src/variants-xiangqi-standard.ts';
import { auditXiangqiCorpusPuzzle } from './xiangqi-corpus-quality-audit.ts';
import { parseXiangqiScoredLines } from './xiangqi-pikafish-uci.ts';
import { buildGatedLine, type XiangqiPuzzleMinerOptions } from './xiangqi-puzzle-miner.ts';
import { verifyXiangqiSolverTurn } from './xiangqi-puzzle-verification.ts';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/mate-goal-regressions.json', import.meta.url), 'utf8'),
) as Record<string, XiangqiPuzzle>;
const noEngine = {
  newGame: async () => {
    throw new Error('exact stored mate goals must not depend on engine scores');
  },
  analyzeFen: async () => {
    throw new Error('exact stored mate goals must not depend on engine scores');
  },
};

for (const [code, puzzle] of Object.entries(fixtures)) {
  const bound = (puzzle.solution.length + 1) / 2;
  test(`${code}: the unique mate in ${bound} survives slower winning alternatives`, async () => {
    const before = JSON.stringify(puzzle);
    const proof = proveXiangqiMateGoal(puzzle.initial, bound);
    assert.equal(proof.verdict, 'unique');
    assert.equal(proof.complete, true);
    assert.deepEqual(proof.winningMoves, [puzzle.solution[0]]);
    const audit = await auditXiangqiCorpusPuzzle(noEngine, puzzle);
    assert.equal(audit.decision.disposition, 'keep');
    assert.equal(audit.evidence[0]?.mateGoalEvidence?.mateIn, bound);
    assert.deepEqual(audit.evidence[0]?.budgets, []);
    assert.equal(JSON.stringify(puzzle), before);
  });
}

test('two moves within the stated bound fail even when both mate immediately', async () => {
  const state: XiangqiGameState = {
    id: 'two-immediate-mates',
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
    status: { type: 'playing', turn: 'red' },
    board: {
      d1: { color: 'red', role: 'general' },
      e10: { color: 'black', role: 'general' },
      a9: { color: 'red', role: 'chariot' },
      h9: { color: 'red', role: 'chariot' },
    },
  };
  const proof = proveXiangqiMateGoal(state, 1);
  assert.equal(proof.verdict, 'ambiguous');
  assert.equal(proof.winningMoves.length, 2);
  const result = await verifyXiangqiSolverTurn(
    noEngine,
    state,
    0,
    { from: 'a9', to: 'a10' },
    { type: 'checkmate' },
    XIANGQI_SOLVER_GATE_DEFAULTS,
    1,
  );
  assert.equal(result.judgment.verdict, 'fail');
  assert.equal(result.judgment.reason, 'multiple-within-goal');
});

test('mate-in-three follow-ups use the remaining bound rather than a new three-move allowance', async () => {
  const p = fixtures['mate-in-three-control']!;
  const audit = await auditXiangqiCorpusPuzzle(noEngine, p);
  assert.equal(audit.decision.disposition, 'keep');
  assert.deepEqual(
    audit.evidence.slice(0, 2).map((e) => e.mateGoalEvidence?.mateIn),
    [3, 2],
  );
});

test('the rook-first alternative in n6sE3 does not force the stated mate in two', async () => {
  const p = fixtures.n6sE3!;
  const result = await verifyXiangqiSolverTurn(
    noEngine,
    p.initial,
    0,
    { from: 'f6', to: 'f10' },
    p.goal,
    XIANGQI_SOLVER_GATE_DEFAULTS,
    2,
  );
  assert.equal(result.judgment.verdict, 'fail');
  assert.equal(result.judgment.reason, 'stored-answer-mismatch');
  assert.equal(proveXiangqiMateGoal(p.initial, 1).verdict, 'no-mate');
});

test('budget exhaustion never turns one discovered key into a uniqueness certificate', () => {
  const proof = proveXiangqiMateGoal(fixtures.n6sE3!.initial, 2, { maxNodes: 1 });
  assert.equal(proof.verdict, 'unresolved');
  assert.equal(proof.complete, false);
  assert.equal(proof.reason, 'mate-goal-budget-exhausted');
  assert.equal(proveXiangqiMateGoal(fixtures.n6sE3!.initial, 1000).verdict, 'unresolved');
});

test('actual repetition and progress history can invalidate an otherwise mating key', () => {
  const p = fixtures.n6sE3!;
  const child = applyStandardXiangqiMove(p.initial, p.solution[0]!);
  const repeated = {
    ...p.initial,
    positionCounts: { ...p.initial.positionCounts, [positionRepetitionKey(child)]: 2 },
  };
  assert.equal(proveXiangqiMateGoal(repeated, 2).verdict, 'no-mate');
  assert.equal(proveXiangqiMateGoal({ ...p.initial, progressClock: 119 }, 2).verdict, 'no-mate');
});

test('an engine mate score without a board mate is insufficient', async () => {
  const p = fixtures.n6sE3!;
  const result = await verifyXiangqiSolverTurn(
    {
      newGame: async () => {},
      analyzeFen: async () =>
        parseXiangqiScoredLines(
          [
            'info depth 30 multipv 1 score mate 1 pv h5g7',
            'info depth 30 multipv 2 score cp -500 pv f5f9',
            'info depth 30 multipv 3 score cp -600 pv c2d4',
          ],
          3,
        ),
    },
    p.initial,
    0,
  );
  assert.equal(result.judgment.verdict, 'fail');
  assert.equal(result.judgment.reason, 'mate-goal-not-forced');
});

test('mining and audit use the same bounded goal rather than the runner-up win score', async () => {
  const p = fixtures.n6sE3!;
  const engine = {
    newGame: async () => {},
    analyzeFen: async (_fen: string, _limits: unknown, ranks: number) =>
      parseXiangqiScoredLines(
        ranks === 1
          ? ['info depth 30 multipv 1 score mate -1 pv a6a5']
          : [
              'info depth 30 multipv 1 score mate 2 pv h5g7',
              'info depth 30 multipv 2 score mate 10 pv c2d4',
              'info depth 30 multipv 3 score cp 1500 pv f5f9',
            ],
        ranks,
      ),
  };
  const result = await buildGatedLine(engine, p.initial, {
    ...XIANGQI_SOLVER_GATE_DEFAULTS,
    verifyNodes: 25_000_000,
    verifyDepth: 0,
    maxSolutionPlies: 7,
  } as XiangqiPuzzleMinerOptions);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.pv, p.solution);
});

test('changing engine mate bounds cannot fall back to ordinary score admission', async () => {
  const p = fixtures.n6sE3!;
  let calls = 0;
  const result = await verifyXiangqiSolverTurn(
    {
      newGame: async () => {},
      analyzeFen: async () =>
        parseXiangqiScoredLines(
          [
            `info depth 30 multipv 1 score mate ${calls++ === 0 ? 2 : 3} pv h5g7`,
            'info depth 30 multipv 2 score cp -500 pv f5f9',
            'info depth 30 multipv 3 score cp -600 pv c2d4',
          ],
          3,
        ),
    },
    p.initial,
    0,
  );
  assert.equal(result.judgment.verdict, 'unresolved');
  assert.equal(result.judgment.reason, 'mate-goal-bound-unstable');
});
