import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  deriveXiangqiPuzzleSetupMove,
  XIANGQI_PUZZLES,
  type XiangqiGameState,
  type XiangqiMove,
  xiangqiPuzzlePreSetupState,
} from './index.js';

// Red's cannon takes the h10 horse on move one (screen: the h8 cannon), then
// black recaptures with the i10 chariot: a short real line with two captures.
const GAME: XiangqiMove[] = [
  { from: 'h3', to: 'h10' },
  { from: 'i10', to: 'h10' },
  { from: 'b3', to: 'e3' },
];

function stateAfter(plies: number): XiangqiGameState {
  let state = createInitialXiangqiState('src');
  for (const move of GAME.slice(0, plies)) state = applyStandardXiangqiMove(state, move);
  return state;
}

function puzzleAt(ply: number) {
  return { initial: stateAfter(ply), sourceGame: { gameId: 'hxq_test', ply } };
}

test('a capturing setup move reports the piece it took', () => {
  const setup = deriveXiangqiPuzzleSetupMove(puzzleAt(1), GAME);
  assert.deepEqual(setup, {
    from: 'h3',
    to: 'h10',
    captured: { color: 'black', role: 'horse' },
  });
});

test('a quiet setup move reports no capture', () => {
  const setup = deriveXiangqiPuzzleSetupMove(puzzleAt(3), GAME);
  assert.deepEqual(setup, { from: 'b3', to: 'e3', captured: null });
});

test('the derived setup move fails closed when the source game disagrees', () => {
  // Wrong ply: the replayed board is not the puzzle's.
  assert.equal(
    deriveXiangqiPuzzleSetupMove({ ...puzzleAt(1), sourceGame: { gameId: 'x', ply: 3 } }, GAME),
    null,
  );
  // Ply past the end of the game.
  assert.equal(
    deriveXiangqiPuzzleSetupMove({ ...puzzleAt(1), sourceGame: { gameId: 'x', ply: 9 } }, GAME),
    null,
  );
  // An illegal move inside the replay.
  const broken: XiangqiMove[] = [{ from: 'h3', to: 'h9' }, ...GAME.slice(1)];
  assert.equal(deriveXiangqiPuzzleSetupMove(puzzleAt(3), broken), null);
  // No source game or no last move.
  assert.equal(deriveXiangqiPuzzleSetupMove({ initial: stateAfter(1) }, GAME), null);
  const { lastMove: _drop, ...noLast } = stateAfter(1);
  assert.equal(
    deriveXiangqiPuzzleSetupMove({ initial: noLast, sourceGame: { gameId: 'x', ply: 1 } }, GAME),
    null,
  );
});

test('the pre-setup state restores the captured piece and replays to initial', () => {
  const initial = stateAfter(1);
  const pre = xiangqiPuzzlePreSetupState(initial, {
    from: 'h3',
    to: 'h10',
    captured: { color: 'black', role: 'horse' },
  });
  assert.ok(pre);
  assert.deepEqual(pre.board.h10, { color: 'black', role: 'horse' });
  assert.deepEqual(pre.board.h3, { color: 'red', role: 'cannon' });
  assert.deepEqual(pre.status, { type: 'playing', turn: 'red' });
  assert.equal(pre.lastMove, undefined);
  assert.deepEqual(pre.board, createInitialXiangqiState('x').board);
  assert.deepEqual(applyStandardXiangqiMove(pre, { from: 'h3', to: 'h10' }).board, initial.board);
});

test('the pre-setup state fails closed on a payload that does not fit initial', () => {
  const initial = stateAfter(1);
  // Claiming a quiet move when the cannon could not have reached h10 without a screen-and-target.
  assert.equal(
    xiangqiPuzzlePreSetupState(initial, { from: 'h3', to: 'h10', captured: null }),
    null,
  );
  // Squares that are not initial.lastMove.
  assert.equal(xiangqiPuzzlePreSetupState(initial, { from: 'b3', to: 'e3', captured: null }), null);
  // A capture of the mover's own colour.
  assert.equal(
    xiangqiPuzzlePreSetupState(initial, {
      from: 'h3',
      to: 'h10',
      captured: { color: 'red', role: 'horse' },
    }),
    null,
  );
  assert.equal(xiangqiPuzzlePreSetupState(initial, null), null);
});

test('every seed puzzle with a quiet setup move rebuilds or fails closed, never a wrong board', () => {
  for (const puzzle of XIANGQI_PUZZLES) {
    const last = puzzle.initial.lastMove;
    if (!last) continue;
    const pre = xiangqiPuzzlePreSetupState(puzzle.initial, { ...last, captured: null });
    if (!pre) continue;
    assert.deepEqual(
      applyStandardXiangqiMove(pre, last).board,
      puzzle.initial.board,
      `${puzzle.id}: rebuilt board must replay to initial`,
    );
  }
});
