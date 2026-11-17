import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { XiangqiPuzzle } from '../../packages/game/src/puzzles-xiangqi.ts';
import {
  proveXiangqiMateGoal,
  proveXiangqiMateGoalWithRetry,
  proveXiangqiMateMove,
} from '../../packages/game/src/puzzles-xiangqi-mate.ts';
import { XIANGQI_SOLVER_GATE_DEFAULTS } from '../../packages/game/src/puzzles-xiangqi-mining.ts';
import {
  positionRepetitionKey,
  type XiangqiGameState,
} from '../../packages/game/src/variants-xiangqi.ts';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
} from '../../packages/game/src/variants-xiangqi-standard.ts';
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
  for (const move of proof.winningMoves) {
    assert.equal(proveXiangqiMateMove(state, move, 1).verdict, 'proved');
  }
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

test('only exhausted mate-in-three proofs receive one tested retry; both receipts survive', () => {
  const p = fixtures['mate-in-three-control']!;
  const exhausted = proveXiangqiMateGoal(p.initial, 3, { maxNodes: 1 });
  const success = proveXiangqiMateGoal(p.initial, 3);
  const seen: unknown[] = [];
  const verified = proveXiangqiMateGoalWithRetry(p.initial, 3, (_state, _n, limits) => {
    seen.push(limits);
    return seen.length === 1 ? exhausted : success;
  });
  assert.deepEqual(seen, [undefined, { maxNodes: 5_000_000, maxTimeMs: 30_000 }]);
  assert.deepEqual(verified.attempts, [exhausted, success]);
  assert.equal(verified.proof.verdict, 'unique');
  for (const n of [1, 2, 4]) {
    let calls = 0;
    const result = proveXiangqiMateGoalWithRetry(p.initial, n, () => {
      calls++;
      return exhausted;
    });
    assert.equal(calls, 1);
    assert.equal(result.proof.verdict, 'unresolved');
  }
  for (const receipt of [
    success,
    { ...exhausted, verdict: 'ambiguous' as const },
    { ...exhausted, reason: 'invalid-mate-goal' },
  ]) {
    let calls = 0;
    proveXiangqiMateGoalWithRetry(p.initial, 3, () => {
      calls++;
      return receipt;
    });
    assert.equal(calls, 1, 'a conclusive or invalid proof is not retried');
  }
});

test('forcing move ordering agrees with exhaustive natural-order proofs, including quiet defences', () => {
  for (const p of Object.values(fixtures)) {
    const solver = p.initial.status.type === 'playing' ? p.initial.status.turn : null;
    const wins = (state: XiangqiGameState, remaining: number): boolean => {
      if (state.status.type !== 'playing')
        return (
          state.status.type === 'finished' &&
          state.status.winner === solver &&
          ['checkmate', 'stalemate'].includes(state.status.reason)
        );
      if (!remaining) return false;
      const replies = getStandardXiangqiLegalMoves(state);
      const next = (m: (typeof p.solution)[number]) =>
        wins(applyStandardXiangqiMove(state, m), remaining - 1);
      return state.status.turn === solver
        ? replies.some(next)
        : replies.length > 0 && replies.every(next);
    };
    const expected = getStandardXiangqiLegalMoves(p.initial).filter((m) =>
      wins(applyStandardXiangqiMove(p.initial, m), 2),
    );
    const result = proveXiangqiMateGoal(p.initial, 2);
    assert.equal(
      result.verdict,
      expected.length === 0 ? 'no-mate' : expected.length === 1 ? 'unique' : 'ambiguous',
    );
    assert.deepEqual(result.winningMoves, expected.slice(0, 2));
  }
});

test('a subsequent board proof retains why its engine evidence was escalated', async () => {
  const p = fixtures.n6sE3!;
  const result = await verifyXiangqiSolverTurn(
    {
      newGame: async () => {},
      analyzeFen: async () =>
        parseXiangqiScoredLines(
          [
            'info depth 30 multipv 1 score mate 2 pv h5g7',
            'info depth 30 multipv 2 score cp 130 pv f5f9',
            'info depth 30 multipv 3 score cp -600 pv c2d4',
          ],
          3,
        ),
    },
    p.initial,
    0,
  );
  assert.equal(result.judgment.verdict, 'pass');
  assert.ok(result.escalationReasons.includes('near-separation-cutoff'));
  assert.deepEqual(result.budgets, [5_000_000, 25_000_000, 100_000_000]);
});

test('partitioned move proofs cover the same mate objective without asserting uniqueness', () => {
  const p = fixtures.n6sE3!;
  const before = JSON.stringify(p.initial);
  const legal = getStandardXiangqiLegalMoves(p.initial);
  const proofs = legal.map((move) => proveXiangqiMateMove(p.initial, move, 2));
  assert(proofs.every((proof) => proof.complete && proof.verdict !== 'unresolved'));
  assert.deepEqual(
    proofs.filter((proof) => proof.verdict === 'proved').map((proof) => proof.move),
    [p.solution[0]],
  );
  assert.equal(JSON.stringify(p.initial), before);
  assert(proofs.every((proof) => proof.legalMoveCount === legal.length));
});

test('one-move proof fails closed on illegal keys, exhausted budgets and history-based draws', () => {
  const p = fixtures.n6sE3!;
  assert.equal(
    proveXiangqiMateMove(p.initial, { from: 'a1', to: 'i10' }, 2).reason,
    'invalid-root-move',
  );
  const exhausted = proveXiangqiMateMove(p.initial, p.solution[0]!, 2, { maxNodes: 1 });
  assert.equal(exhausted.verdict, 'unresolved');
  assert.equal(exhausted.complete, false);
  const expired = proveXiangqiMateMove(p.initial, p.solution[0]!, 2, {
    maxTimeMs: Number.MIN_VALUE,
  });
  assert.equal(expired.verdict, 'unresolved');
  const child = applyStandardXiangqiMove(p.initial, p.solution[0]!);
  const repeated = {
    ...p.initial,
    positionCounts: { ...p.initial.positionCounts, [positionRepetitionKey(child)]: 2 },
  };
  assert.equal(proveXiangqiMateMove(repeated, p.solution[0]!, 2).verdict, 'refuted');
  assert.equal(
    proveXiangqiMateMove({ ...p.initial, progressClock: 119 }, p.solution[0]!, 2).verdict,
    'refuted',
  );
});
