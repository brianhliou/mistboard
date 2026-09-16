import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATOMIC_XIANGQI_START_FEN,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  type AtomicXiangqiSquare,
  applyAtomicXiangqiMove,
  atomicXiangqiBoardAfterMove,
  atomicXiangqiFen,
  atomicXiangqiStateFromFen,
  createInitialAtomicXiangqiState,
  getAtomicXiangqiLegalMoves,
  getAtomicXiangqiPlayerView,
  isAtomicXiangqiGeneralInCheck,
  isAtomicXiangqiLegalMove,
} from './variants-atomic-xiangqi.js';
import { createInitialXiangqiState } from './variants-xiangqi.js';
import { getStandardXiangqiLegalMoves } from './variants-xiangqi-standard.js';

function fromFen(fen: string): AtomicXiangqiGameState {
  const state = atomicXiangqiStateFromFen(fen, 'test');
  assert.ok(state, `fen parses: ${fen}`);
  return state;
}

function uci(text: string): AtomicXiangqiMove {
  const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(text);
  assert.ok(m, `uci: ${text}`);
  return { from: m[1] as AtomicXiangqiSquare, to: m[2] as AtomicXiangqiSquare };
}

function play(state: AtomicXiangqiGameState, ...moves: string[]): AtomicXiangqiGameState {
  let next = state;
  for (const m of moves) next = applyAtomicXiangqiMove(next, uci(m));
  return next;
}

test('the opening array is xiangqi: same legal moves as the standard kernel', () => {
  const atomic = createInitialAtomicXiangqiState('g');
  const standard = createInitialXiangqiState('g');
  const key = (m: { from: string; to: string }) => `${m.from}${m.to}`;
  assert.deepEqual(
    getAtomicXiangqiLegalMoves(atomic).map(key).sort(),
    getStandardXiangqiLegalMoves(standard).map(key).sort(),
  );
  assert.equal(atomicXiangqiFen(atomic), ATOMIC_XIANGQI_START_FEN);
});

test('a chariot capture removes both pieces and the orthogonal neighbours; soldiers survive', () => {
  // Red chariot e1 takes the black horse on e5. Beside it: a black chariot on
  // d5, a black soldier on e6, a red soldier two points away on g5.
  const state = fromFen('4k4/9/9/9/4p4/3rn1P2/9/9/9/3KR4 w - - 0 1');
  assert.equal(state.board.e5?.role, 'horse');
  const { board, blast } = atomicXiangqiBoardAfterMove(state.board, uci('e1e5'));
  assert.equal(board.e5, undefined, 'the capturer is gone too');
  assert.equal(board.d5, undefined, 'the chariot beside the target is gone');
  assert.equal(board.e6?.role, 'soldier', 'the soldier survives');
  assert.equal(board.g5?.role, 'soldier', 'two points away is untouched');
  assert.deepEqual(
    blast.map((v) => `${v.square}:${v.piece.role}`).sort(),
    ['d5:chariot', 'e5:horse'],
    'the aftermath lists what stood on the cleared points, not the origin',
  );
});

test('D13: a cannon capture removes only the cannon and its target', () => {
  // Red cannon e2 over the screen on e4 takes the black horse on e6. Beside
  // it: a black chariot on d6 and a black soldier on f6.
  const state = fromFen('4k4/9/9/9/3rnp3/9/4P4/9/4C4/4K4 w - - 0 1');
  assert.equal(state.board.e6?.role, 'horse');
  const after = applyAtomicXiangqiMove(state, uci('e2e6'));
  assert.equal(after.board.e6, undefined, 'the target is gone');
  assert.equal(after.board.e2, undefined, 'the cannon is gone');
  assert.equal(after.board.d6?.role, 'chariot', 'the neighbour is untouched');
  assert.equal(after.board.f6?.role, 'soldier');
  assert.deepEqual(
    after.lastBlast.map((v) => v.square),
    ['e6'],
    'the aftermath is the target alone',
  );
  assert.equal(after.status.type, 'playing');
});

test('a move that blows up your own general is illegal; blowing up theirs wins', () => {
  // Red chariot d9 may take the black advisor on d10 beside the general on
  // e10, and it ends the game. Red chariot f2 may not take the black horse on
  // f1 beside the red general on e1.
  const state = fromFen('3ak4/3R5/9/9/9/9/9/9/5R3/4Kn3 w - - 0 1');
  assert.equal(isAtomicXiangqiLegalMove(state, uci('f2f1')), false);
  assert.equal(isAtomicXiangqiLegalMove(state, uci('d9d10')), true);
  const won = applyAtomicXiangqiMove(state, uci('d9d10'));
  assert.deepEqual(won.status, { type: 'finished', winner: 'red', reason: 'general-captured' });
  assert.deepEqual(won.lastBlast.map((v) => `${v.square}:${v.piece.role}`).sort(), [
    'd10:advisor',
    'e10:general',
  ]);
});

test('D14: a chariot bearing on the advisor is check on the board, and the view says so', () => {
  const state = fromFen('3ak4/3R5/9/9/9/9/9/9/9/4K4 b - - 0 1');
  assert.equal(isAtomicXiangqiGeneralInCheck(state.board, 'black'), true);
  assert.equal(isAtomicXiangqiGeneralInCheck(state.board, 'red'), false);
  assert.equal(getAtomicXiangqiPlayerView(state, 'black').inCheck, true);
  assert.equal(getAtomicXiangqiPlayerView(state, 'red').inCheck, false);
  // The threat is not a legality constraint: black may step aside or not.
  assert.equal(isAtomicXiangqiLegalMove(state, uci('e10f10')), true);
});

test('a one-sided shuffle on the advisor file is perpetual check and loses', () => {
  // The lab's dance. Black's chariot hops between d9 and f9, each hop bearing
  // on an advisor beside the red general; red's cannon block parries and, by
  // D13, threatens nothing back. Black checked on every move of the cycle.
  const state = fromFen('4k4/3r5/9/9/9/9/4P4/5C3/9/3AKA3 w - - 0 1');
  const end = play(state, 'f3d3', 'd9f9', 'd3f3', 'f9d9', 'f3d3', 'd9f9', 'd3f3', 'f9d9');
  assert.deepEqual(end.status, { type: 'finished', winner: 'red', reason: 'perpetual-check' });
});

test('a quiet repetition is a draw, and the aftermath is empty after a quiet move', () => {
  const state = fromFen('5k3/9/9/9/9/9/9/9/9/3K5 w - - 0 1');
  const end = play(state, 'd1d2', 'f10f9', 'd2d1', 'f9f10', 'd1d2', 'f10f9', 'd2d1', 'f9f10');
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.deepEqual(end.lastBlast, []);
});

test('sixty plies without a capture is a draw, named as persistence names it', () => {
  const state = fromFen('5k3/9/9/9/9/9/9/9/9/R2K5 w - - 59 30');
  const end = applyAtomicXiangqiMove(state, uci('a1a2'));
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'progress-clock' });
});

test('the view carries the legal moves of the side to move for either seat', () => {
  const state = createInitialAtomicXiangqiState('g');
  assert.equal(getAtomicXiangqiPlayerView(state, 'red').legalMoves.length, 44);
  assert.equal(getAtomicXiangqiPlayerView(state, 'black').legalMoves.length, 44);
  assert.equal(getAtomicXiangqiPlayerView(state, 'red').inCheck, false);
});
