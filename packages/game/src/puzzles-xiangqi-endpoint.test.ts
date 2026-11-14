import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialXiangqiState,
  decideXiangqiPuzzleAudit,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPuzzle,
  xiangqiPuzzleSolutionEndpoint,
} from './index.js';

const initial: XiangqiGameState = {
  id: 'endpoint',
  moveNumber: 1,
  progressClock: 0,
  positionCounts: {},
  status: { type: 'playing', turn: 'red' },
  board: {
    d1: { color: 'red', role: 'general' },
    a1: { color: 'red', role: 'chariot' },
    e10: { color: 'black', role: 'general' },
    a5: { color: 'black', role: 'horse' },
  },
};
const solution: XiangqiMove[] = [
  { from: 'a1', to: 'a5' },
  { from: 'e10', to: 'e9' },
  { from: 'a5', to: 'a6' },
  { from: 'e9', to: 'e10' },
  { from: 'a6', to: 'a7' },
];
const puzzle: XiangqiPuzzle = {
  id: 'endpoint',
  variant: 'xiangqi',
  title: 'Material',
  themes: ['winning'],
  goal: { type: 'winning-advantage', winner: 'red', centipawns: 500 },
  initial,
  solution,
};

test('a material solution stops at its payoff and obeys its final length floor', () => {
  assert.deepEqual(xiangqiPuzzleSolutionEndpoint(initial, solution, puzzle.goal), {
    ok: true,
    moves: [solution[0]],
    kind: 'material-payoff',
  });
  assert.deepEqual(xiangqiPuzzleSolutionEndpoint(initial, solution, puzzle.goal, 3), {
    ok: false,
    reason: 'too-short',
  });
});

test('a mate goal cannot be repaired by stopping at an earlier material win', () => {
  const matePuzzle = { ...puzzle, goal: { type: 'checkmate', winner: 'red' } as const };
  const result = decideXiangqiPuzzleAudit(matePuzzle, [
    { solutionPly: 0, verdict: 'pass', reason: 'separated' },
    { solutionPly: 2, verdict: 'fail', reason: 'alternative-mates' },
  ]);
  assert.equal(result.disposition, 'withhold-candidate');
  assert.equal(result.reason, 'goal-incomplete');
  assert.equal(result.replacement, undefined);
});

test('a unique defensive key can end an exercise without a quiet continuation', () => {
  const checked: XiangqiGameState = {
    ...initial,
    board: {
      e1: { color: 'red', role: 'general' },
      d1: { color: 'red', role: 'advisor' },
      f10: { color: 'black', role: 'general' },
      e10: { color: 'black', role: 'chariot' },
    },
  };
  const moves: XiangqiMove[] = [
    { from: 'd1', to: 'e2' },
    { from: 'e10', to: 'e9' },
    { from: 'e1', to: 'd1' },
  ];
  assert.deepEqual(xiangqiPuzzleSolutionEndpoint(checked, moves, puzzle.goal), {
    ok: true,
    moves: [moves[0]],
    kind: 'defensive-key',
  });
});

test('quiet positional play without a concrete endpoint needs review', () => {
  const opening = createInitialXiangqiState('quiet-endpoint');
  const moves: XiangqiMove[] = [
    { from: 'h3', to: 'e3' },
    { from: 'h8', to: 'e8' },
    { from: 'h1', to: 'g3' },
  ];
  assert.deepEqual(xiangqiPuzzleSolutionEndpoint(opening, moves, puzzle.goal), {
    ok: false,
    reason: 'no-tactical-payoff',
  });
});

test('a checking tactic may establish the advantage before its forced capture', () => {
  const position: XiangqiGameState = {
    ...initial,
    board: {
      d1: { color: 'red', role: 'general' },
      a8: { color: 'red', role: 'chariot' },
      b1: { color: 'red', role: 'chariot' },
      e9: { color: 'black', role: 'general' },
    },
  };
  const moves: XiangqiMove[] = [{ from: 'b1', to: 'b9' }];
  assert.deepEqual(xiangqiPuzzleSolutionEndpoint(position, moves, { type: 'winning-advantage' }), {
    ok: true,
    moves,
    kind: 'forcing-key',
  });
});

test('a shorter replacement is planned from only the verified prefix without mutating the source', () => {
  const before = JSON.stringify(puzzle);
  const result = decideXiangqiPuzzleAudit(puzzle, [
    { solutionPly: 0, verdict: 'pass', reason: 'separated' },
    { solutionPly: 2, verdict: 'fail', reason: 'insufficient-separation' },
  ]);
  assert.equal(result.disposition, 'shorter-replacement');
  assert.deepEqual(result.replacement?.solution, [solution[0]]);
  assert.equal(JSON.stringify(puzzle), before);
});

test('missing or unstable evidence is not a keep or a withholding instruction', () => {
  assert.equal(decideXiangqiPuzzleAudit(puzzle, []).disposition, 'needs-review');
  assert.equal(
    decideXiangqiPuzzleAudit(puzzle, [{ solutionPly: 2, verdict: 'pass', reason: 'gap' }])
      .disposition,
    'needs-review',
  );
  assert.equal(
    decideXiangqiPuzzleAudit(puzzle, [
      { solutionPly: 0, verdict: 'pass', reason: 'gap' },
      { solutionPly: 2, verdict: 'unresolved', reason: 'budget-disagreement' },
    ]).disposition,
    'needs-review',
  );
});

test('a concrete complete line is kept and a failed starting choice is flagged', () => {
  const short = { ...puzzle, solution: [solution[0] as XiangqiMove] };
  assert.equal(
    decideXiangqiPuzzleAudit(short, [{ solutionPly: 0, verdict: 'pass', reason: 'gap' }])
      .disposition,
    'keep',
  );
  assert.equal(
    decideXiangqiPuzzleAudit(short, [{ solutionPly: 0, verdict: 'fail', reason: 'gap' }])
      .disposition,
    'withhold-candidate',
  );
});

test('root score ambiguity is review of an advantage exercise, not proof it should be withheld', () => {
  for (const reason of [
    'mate-not-unique',
    'runner-up-mates',
    'insufficient-separation',
    'stored-answer-mismatch',
  ]) {
    const before = JSON.stringify(puzzle);
    const result = decideXiangqiPuzzleAudit(puzzle, [{ solutionPly: 0, verdict: 'fail', reason }]);
    assert.equal(result.disposition, 'needs-review', reason);
    assert.equal(result.reason, reason);
    assert.equal(result.replacement, undefined);
    assert.equal(JSON.stringify(puzzle), before);
  }
  const actualMate = { ...puzzle, goal: { type: 'checkmate' } as const };
  assert.equal(
    decideXiangqiPuzzleAudit(actualMate, [
      { solutionPly: 0, verdict: 'fail', reason: 'multiple-within-goal' },
    ]).disposition,
    'withhold-candidate',
  );
});
