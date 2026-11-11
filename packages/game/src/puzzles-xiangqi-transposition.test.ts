import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiGameState, XiangqiMove, XiangqiPuzzle } from './index.js';
import * as game from './index.js';

function moves(line: string): XiangqiMove[] {
  if (!line) return [];
  return line.split(' ').map((token) => {
    const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token);
    assert.ok(match, `bad fixture move: ${token}`);
    return { from: match[1] as XiangqiMove['from'], to: match[2] as XiangqiMove['to'] };
  });
}

function puzzle(fen: string, line: string): XiangqiPuzzle {
  const parsed = game.parseStandardXiangqiFen(fen);
  assert.ok(parsed.ok, `bad fixture FEN: ${fen}`);
  return {
    id: 'transposition-fixture',
    variant: game.XIANGQI_SPEC_ID,
    title: 'Transposition fixture',
    initial: parsed.state,
    solution: moves(line),
    goal: { type: 'checkmate' },
    themes: [],
  };
}

function replay(initial: XiangqiGameState, line: string): XiangqiGameState {
  let state = initial;
  for (const move of moves(line)) {
    assert.ok(game.isStandardXiangqiLegalMove(state, move), `illegal fixture move: ${line}`);
    state = game.applyStandardXiangqiMove(state, move);
  }
  return state;
}

// Each chariot takes a soldier, in either order. Both branches reach the same
// position after three plies; the stored continuation then mates in two.
const RED_FEN = '4k4/9/9/p7p/9/9/9/9/R7R/3K5 r - - 0 1';
const RED_SOLUTION = 'a2a7 e10f10 i2i7 f10e10 a7a9 e10f10 i7i10';
const RED_BRANCH = 'i2i7 e10f10 a2a7';
const BLACK_FEN = '5k3/r7r/9/9/9/9/P7P/9/9/4K4 b - - 0 1';
const BLACK_SOLUTION = 'i9i4 e1d1 a9a4 d1e1 i4i2 e1d1 a4a1';
const BLACK_BRANCH = 'a9a4 e1d1 i9i4';

test('transposition: reordered captures rejoin the solution for either solver color', () => {
  for (const [fen, solution, branch] of [
    [RED_FEN, RED_SOLUTION, RED_BRANCH],
    [BLACK_FEN, BLACK_SOLUTION, BLACK_BRANCH],
  ] as const) {
    const fixture = puzzle(fen, solution);
    assert.equal(game.validateStandardXiangqiPuzzle(fixture).ok, true);
    const before = JSON.stringify(fixture);
    const alternative = moves(branch);
    const alternativeBefore = JSON.stringify(alternative);
    assert.deepEqual(game.detectStandardXiangqiPuzzleTransposition(fixture, alternative), {
      solutionPly: 3,
      alternativePly: 3,
    });
    assert.equal(JSON.stringify(fixture), before, 'detector must not mutate the puzzle');
    assert.equal(JSON.stringify(alternative), alternativeBefore, 'branch must not be mutated');
  }
});

test('transposition: the same detector works for a winning-advantage payoff', () => {
  const fixture = puzzle(RED_FEN, 'a2a7 e10f10 i2i7');
  fixture.goal = { type: 'winning-advantage', centipawns: 900 };
  assert.equal(game.validateStandardXiangqiPuzzle(fixture).ok, true);
  assert.deepEqual(game.detectStandardXiangqiPuzzleTransposition(fixture, moves(RED_BRANCH)), {
    solutionPly: 3,
    alternativePly: 3,
  });
});

test('transposition: divergence may follow a shared prefix', () => {
  const fixture = puzzle(RED_FEN, RED_SOLUTION);
  fixture.initial = replay(fixture.initial, 'a2b2 e10f10');
  fixture.solution = moves('b2a2 f10e10 a2a7 e10f10 i2i7 f10e10 a7a9 e10f10 i7i10');
  assert.equal(game.validateStandardXiangqiPuzzle(fixture).ok, true);
  assert.deepEqual(
    game.detectStandardXiangqiPuzzleTransposition(fixture, moves('b2a2 f10e10 i2i7 e10f10 a2a7')),
    { solutionPly: 5, alternativePly: 5 },
  );
});

test('transposition: a legal detour may rejoin at a different ply', () => {
  const fixture = puzzle(RED_FEN, RED_SOLUTION);
  const detour = 'i2h2 e10f10 h2h7 f10e10 h7i7 e10f10 a2a7';
  const alternative = replay(fixture.initial, detour);
  const stored = replay(fixture.initial, 'a2a7 e10f10 i2i7');
  assert.equal(
    game.standardXiangqiPositionKey(alternative),
    game.standardXiangqiPositionKey(stored),
  );
  assert.notEqual(alternative.moveNumber, stored.moveNumber);
  assert.notDeepEqual(alternative.positionCounts, stored.positionCounts);
  assert.deepEqual(game.detectStandardXiangqiPuzzleTransposition(fixture, moves(detour)), {
    solutionPly: 3,
    alternativePly: 7,
  });
});

test('transposition: matching board placement with the other side to move is not a match', () => {
  const fixture = puzzle('4k4/9/9/p7p/9/1r7/9/9/R7R/3K5 r - - 0 1', RED_SOLUTION);
  const branch = `${RED_BRANCH} b5b6 a7a8 b6b7 a8a7 b7b5`;
  const alternative = replay(fixture.initial, branch);
  const stored = replay(fixture.initial, 'a2a7 e10f10 i2i7');
  assert.equal(
    game.standardXiangqiPlacementKey(alternative),
    game.standardXiangqiPlacementKey(stored),
  );
  assert.notDeepEqual(alternative.status, stored.status);
  assert.equal(game.detectStandardXiangqiPuzzleTransposition(fixture, moves(branch)), null);
});

test('transposition: empty paths, stored prefixes, and legal non-matching branches return null', () => {
  const fixture = puzzle(RED_FEN, RED_SOLUTION);
  for (const branch of [
    '',
    'a2a7',
    'a2a7 e10f10 i2i7',
    RED_SOLUTION,
    'i2i6',
    'i2i7 e10f10',
    `${RED_BRANCH} f10e10 a7b7`,
    'a2a7 e10f10 i2i7 f10e10 a7b7 e10f10 b7a7',
  ]) {
    replay(fixture.initial, branch);
    assert.equal(
      game.detectStandardXiangqiPuzzleTransposition(fixture, moves(branch)),
      null,
      branch,
    );
  }
});

test('transposition: the entire supplied branch must be legal, including after a match', () => {
  const fixture = puzzle(RED_FEN, RED_SOLUTION);
  for (const branch of ['i2i8 e10f10 a2a7', `${RED_BRANCH} e10e9`]) {
    assert.equal(game.detectStandardXiangqiPuzzleTransposition(fixture, moves(branch)), null);
  }
});

test('transposition: matching placement cannot hide a repetition or progress-clock finish', () => {
  for (const [fen, branch, reason] of [
    [RED_FEN, `${RED_BRANCH} f10e10 a7b7 e10f10 b7a7 f10e10 a7b7 e10f10 b7a7`, 'repetition'],
    [
      '4k4/9/9/9/9/9/9/9/R7R/3K5 r - - 53 1',
      'i2h2 e10f10 h2h7 f10e10 h7i7 e10f10 a2a7',
      'progress-clock',
    ],
  ] as const) {
    const fixture = puzzle(fen, RED_SOLUTION);
    assert.equal(game.validateStandardXiangqiPuzzle(fixture).ok, true);
    const stored = replay(fixture.initial, 'a2a7 e10f10 i2i7');
    const alternative = replay(fixture.initial, branch);
    assert.equal(
      game.standardXiangqiPlacementKey(alternative),
      game.standardXiangqiPlacementKey(stored),
    );
    assert.deepEqual(stored.status, { type: 'playing', turn: 'black' });
    assert.deepEqual(alternative.status, { type: 'finished', winner: null, reason });
    assert.equal(game.detectStandardXiangqiPuzzleTransposition(fixture, moves(branch)), null);
  }
});

test('transposition: return the first matching visit after divergence', () => {
  const fixture = puzzle(
    RED_FEN,
    'a2a7 e10f10 i2i7 f10e10 a7b7 e10f10 b7a7 f10e10 a7a9 e10f10 i7i10',
  );
  assert.equal(game.validateStandardXiangqiPuzzle(fixture).ok, true);
  assert.deepEqual(game.detectStandardXiangqiPuzzleTransposition(fixture, moves(RED_BRANCH)), {
    solutionPly: 3,
    alternativePly: 3,
  });
});

test('transposition: reject illegal stored lines and moves after a terminal state', () => {
  const fixture = puzzle(RED_FEN, RED_SOLUTION);
  const alternativeMate = `${RED_BRANCH} f10e10 a7a9 e10f10 i7i10`;
  assert.deepEqual(game.detectStandardXiangqiPuzzleTransposition(fixture, moves(alternativeMate)), {
    solutionPly: 7,
    alternativePly: 7,
  });
  assert.equal(
    game.detectStandardXiangqiPuzzleTransposition(fixture, moves(`${alternativeMate} f10e10`)),
    null,
  );
  for (const line of ['', 'a2a8 e10f10 i2i7', `${RED_SOLUTION} f10e10`]) {
    assert.equal(
      game.detectStandardXiangqiPuzzleTransposition(
        { ...fixture, solution: moves(line) },
        moves(RED_BRANCH),
      ),
      null,
    );
  }
});

test('transposition: unsupported variants and non-playing starts fail closed', () => {
  const fixture = puzzle(RED_FEN, RED_SOLUTION);
  assert.equal(
    game.detectStandardXiangqiPuzzleTransposition(
      { ...fixture, variant: 'unknown-variant' } as unknown as XiangqiPuzzle,
      moves(RED_BRANCH),
    ),
    null,
  );
  assert.equal(
    game.detectStandardXiangqiPuzzleTransposition(
      { ...fixture, initial: replay(fixture.initial, RED_SOLUTION) },
      moves(RED_BRANCH),
    ),
    null,
  );
});

test('transposition: detection alone does not change the strict puzzle grader', () => {
  const fixture = puzzle(RED_FEN, RED_SOLUTION);
  const attempt = game.attemptStandardXiangqiPuzzleLine(fixture, moves('i2i7'));
  assert.equal(attempt.ok, false);
  if (!attempt.ok) assert.equal(attempt.code, 'incorrect-move');
  assert.deepEqual(game.detectStandardXiangqiPuzzleTransposition(fixture, moves(RED_BRANCH)), {
    solutionPly: 3,
    alternativePly: 3,
  });
});
