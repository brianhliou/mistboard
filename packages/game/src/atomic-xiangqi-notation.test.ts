import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAtomicXiangqiMove, formatAtomicXiangqiMoves } from './atomic-xiangqi-notation.js';
import {
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  type AtomicXiangqiSquare,
  atomicXiangqiStateFromFen,
} from './variants-atomic-xiangqi.js';
import { formatXiangqiMove, formatXiangqiMoves } from './xiangqi-notation-format.js';

function fromFen(fen: string): AtomicXiangqiGameState {
  const state = atomicXiangqiStateFromFen(fen, 'test');
  assert.ok(state, `fen parses: ${fen}`);
  return state;
}

function uci(from: string, to: string): AtomicXiangqiMove {
  return { from: from as AtomicXiangqiSquare, to: to as AtomicXiangqiSquare };
}

test('blowing up the general is marked as mate, not as a standard check', () => {
  // Red chariot d9 takes the advisor beside the black general: the blast takes
  // the general and wins. The standard rules call this a plain check.
  const state = fromFen('3ak4/3R5/9/9/9/9/9/9/5R3/5K3 w - - 0 1');
  const move = uci('d9', 'd10');
  assert.equal(formatAtomicXiangqiMove(state, move, 'algebraic'), 'Rxd10#');
  // The shared standard formatter, which atomic used before, calls it check.
  assert.equal(formatXiangqiMove(state as never, move, 'algebraic'), 'Rxd10+');
});

test('a chariot bearing on the advisor beside the general is atomic check', () => {
  // Rd9 attacks d10, and taking the advisor there would blow up e10. The
  // standard rules see no attack on the general at all.
  const state = fromFen('3ak4/9/9/9/9/9/9/9/3R5/5K3 w - - 0 1');
  const move = uci('d2', 'd9');
  assert.equal(formatAtomicXiangqiMove(state, move, 'algebraic'), 'Rd9+');
  assert.equal(formatXiangqiMove(state as never, move, 'algebraic'), 'Rd9');
});

test('a quiet move carries no mark, and non-algebraic styles match the shared formatter', () => {
  const state = fromFen('3ak4/9/9/9/9/9/9/9/3R5/5K3 w - - 0 1');
  const move = uci('d2', 'c2');
  assert.equal(formatAtomicXiangqiMove(state, move, 'algebraic'), 'Rc2');
  for (const style of ['coordinate', 'iccs', 'wxf', 'chinese-simplified'] as const) {
    assert.equal(
      formatAtomicXiangqiMove(state, move, style),
      formatXiangqiMove(state as never, move, style),
    );
  }
});

test('a line replays through the atomic kernel past the first capture', () => {
  // Red's cannon takes the b10 horse over the b8 screen. In atomic the cannon
  // goes with its target, so b10 is empty and black's chariot steps there; the
  // standard replay keeps the cannon on b10 and calls the same move a capture.
  const moves = [uci('b3', 'b10'), uci('a10', 'b10')];
  assert.deepEqual(formatAtomicXiangqiMoves(moves, 'algebraic'), ['Cxb10', 'Rb10']);
  assert.deepEqual(formatXiangqiMoves(moves, 'algebraic'), ['Cxb10', 'Rxb10']);
});
