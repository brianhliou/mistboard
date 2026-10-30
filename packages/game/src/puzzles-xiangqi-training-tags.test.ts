import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialXiangqiState,
  isXiangqiTrainingTagId,
  XIANGQI_OPENING_MAX_PLY,
  XIANGQI_TRAINING_TAGS,
  type XiangqiMove,
  type XiangqiPuzzle,
  xiangqiPuzzleTrainingTags,
} from './index.js';
import { loadSeedPuzzleRegistry } from './puzzle-seed.js';
import { parseStandardXiangqiFen } from './xiangqi-position.js';

// Only the line's length is read, so the moves need not be legal.
const line = (plies: number): XiangqiMove[] =>
  Array.from({ length: plies }, () => ({ from: 'a1', to: 'a2' }) as XiangqiMove);

const ENDGAME_FEN = '4k4/R8/2N6/9/9/9/9/9/9/3K5 r - - 0 1';

function endgameInitial() {
  const parsed = parseStandardXiangqiFen(ENDGAME_FEN);
  assert.ok(parsed.ok);
  return parsed.state;
}

function tags(
  plies: number,
  goal: XiangqiPuzzle['goal']['type'],
  opts: { initial?: XiangqiPuzzle['initial']; ply?: number } = {},
) {
  return xiangqiPuzzleTrainingTags({
    initial: opts.initial ?? endgameInitial(),
    solution: line(plies),
    goal: goal === 'checkmate' ? { type: 'checkmate' } : { type: 'winning-advantage' },
    ...(opts.ply !== undefined ? { sourceGame: { gameId: 'g', ply: opts.ply } } : {}),
  });
}

test('mate in N follows the solver moves, through mate in 4 (seven plies)', () => {
  assert.deepEqual(tags(1, 'checkmate'), ['matein1', 'endgame', 'checkmate', 'one-move']);
  assert.deepEqual(tags(3, 'checkmate'), ['matein2', 'endgame', 'checkmate', 'short']);
  assert.deepEqual(tags(5, 'checkmate'), ['matein3', 'endgame', 'checkmate', 'long']);
  assert.deepEqual(tags(7, 'checkmate'), ['matein4', 'endgame', 'checkmate', 'very-long']);
});

test('length buckets count player moves: one, short (2), long (3), very long (4+)', () => {
  assert.ok(tags(1, 'winning-advantage').includes('one-move'));
  assert.ok(tags(3, 'winning-advantage').includes('short'));
  assert.ok(tags(5, 'winning-advantage').includes('long'));
  assert.ok(tags(7, 'winning-advantage').includes('very-long'));
  assert.ok(tags(9, 'winning-advantage').includes('very-long'));
});

test('a winning-advantage puzzle gets the winning goal and no mate-in tag', () => {
  const found = tags(3, 'winning-advantage');
  assert.deepEqual(found, ['endgame', 'winning', 'short']);
});

test('phase: endgame by piece count, opening by source ply, otherwise middlegame', () => {
  const full = createInitialXiangqiState('training-tags');
  assert.ok(
    tags(1, 'checkmate', { initial: full, ply: XIANGQI_OPENING_MAX_PLY }).includes('opening'),
  );
  assert.ok(
    tags(1, 'checkmate', { initial: full, ply: XIANGQI_OPENING_MAX_PLY + 1 }).includes(
      'middlegame',
    ),
  );
  // No source game: never an opening, whatever the move counter says.
  assert.ok(tags(1, 'checkmate', { initial: full }).includes('middlegame'));
  // Few pieces left is an endgame even early in the source game.
  assert.ok(tags(1, 'checkmate', { ply: 5 }).includes('endgame'));
});

test('every seed puzzle gets exactly one phase, goal and length tag, and mates a mate-in tag', () => {
  const groupOf = new Map(XIANGQI_TRAINING_TAGS.map((tag) => [tag.id, tag.group]));
  const puzzles = loadSeedPuzzleRegistry('xiangqi') as XiangqiPuzzle[];
  assert.ok(puzzles.length > 0);
  for (const puzzle of puzzles) {
    const groups = xiangqiPuzzleTrainingTags(puzzle).map((id) => groupOf.get(id));
    for (const group of ['phase', 'goal', 'length'] as const) {
      assert.equal(groups.filter((g) => g === group).length, 1, `${puzzle.id} ${group}`);
    }
    const mates = groups.filter((g) => g === 'mate').length;
    assert.equal(mates, puzzle.goal.type === 'checkmate' ? 1 : 0, `${puzzle.id} mate-in`);
  }
});

test('tag ids accept derived tags and kill patterns, nothing else', () => {
  assert.ok(isXiangqiTrainingTagId('matein4'));
  assert.ok(isXiangqiTrainingTagId('very-long'));
  assert.ok(isXiangqiTrainingTagId('ma-hou-pao'));
  assert.ok(!isXiangqiTrainingTagId('crushing'));
  assert.ok(!isXiangqiTrainingTagId(''));
});
