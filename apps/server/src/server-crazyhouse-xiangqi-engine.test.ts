// The Crazyhouse Xiangqi <-> Fairy-Stockfish move encoding and the
// immediate-loss guard.
//
// The encoding is the kernel's own (`<from><to>`, drops `<L>@<to>`), so the
// tests are about the places a wrong answer would be silent: the matcher must
// hand back the KERNEL's move object, drops included, and refuse anything
// else; and the guard must catch a move that hangs mate in one.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type CrazyhouseXiangqiGameState,
  crazyhouseXiangqiMoveToUci,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiLegalMoves,
  isCrazyhouseXiangqiDropMove,
  parseCrazyhouseXiangqiFen,
} from '@mistboard/game';
import {
  guardCrazyhouseXiangqiEngineMove,
  legalMoveForUci,
} from './server-crazyhouse-xiangqi-engine.js';

function fromFen(fen: string): CrazyhouseXiangqiGameState {
  const parsed = parseCrazyhouseXiangqiFen(fen, 'engine-test');
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.state;
}

test('every legal move, board and drop, round-trips back to the same move', () => {
  // Both sides hold a chariot, a horse and a soldier: the a-file chariots, the
  // b-file horses and the a-file soldiers have been traded into hand.
  const state = fromFen(
    '2bakabnr/9/1c5c1/2p1p1p1p/9/9/2P1P1P1P/1C5C1/9/2BAKABNR[RNPrnp] w - - 0 1',
  );
  const moves = getCrazyhouseXiangqiLegalMoves(state);
  assert.ok(moves.some(isCrazyhouseXiangqiDropMove), 'the position has drops');
  const seen = new Set<string>();
  for (const move of moves) {
    const uci = crazyhouseXiangqiMoveToUci(move);
    assert.ok(!seen.has(uci), `two moves spell the same token: ${uci}`);
    seen.add(uci);
    assert.equal(legalMoveForUci(moves, uci), move, uci);
  }
  assert.deepEqual(legalMoveForUci(moves, 'R@e5'), { drop: 'chariot', to: 'e5' });
  assert.deepEqual(legalMoveForUci(moves, 'P@e6'), { drop: 'soldier', to: 'e6' });
});

test('an unmatched engine reply fails closed rather than guessing', () => {
  const moves = getCrazyhouseXiangqiLegalMoves(createInitialCrazyhouseXiangqiState('reject'));
  for (const token of [
    '',
    'a1a2 a2a3', // a pv, not a move
    'a1a1', // null move
    'R@d4', // a drop with an empty hand
    'Q@d4', // the fortress treasure letter
    'e1d2', // legal shape, but a general does not move diagonally
    '(none)', // FSF's bestmove when it has nothing
  ]) {
    assert.equal(legalMoveForUci(moves, token), null, `should not match: "${token}"`);
  }
});

// A position from a seeded random game: Red to move with eight legal moves, and
// the general stepping up (e2e3) is the one that lets Black win on the reply.
const HANG_FEN = '5k1n1/2P1a4/9/9/9/5r3/2c5R/5N2n/c1C1K4/3r5[RBBACPPPPPPnbbaappp] w - - 1 34';

test('the guard replaces a move that hangs a win in one, and keeps a safe one', () => {
  const state = fromFen(HANG_FEN);
  const moves = getCrazyhouseXiangqiLegalMoves(state);
  const hangs = legalMoveForUci(moves, 'e2e3');
  assert.ok(hangs, 'e2e3 is legal');
  const replaced = guardCrazyhouseXiangqiEngineMove(state, hangs, moves);
  assert.notEqual(replaced, hangs, 'the hang is replaced');
  assert.ok(moves.includes(replaced), 'by one of the legal moves');
  assert.equal(guardCrazyhouseXiangqiEngineMove(state, replaced, moves), replaced, 'which is safe');
});

test('the guard keeps the engine move when its replacement search is out of time', () => {
  const state = fromFen(HANG_FEN);
  const moves = getCrazyhouseXiangqiLegalMoves(state);
  const hangs = legalMoveForUci(moves, 'e2e3')!;
  assert.equal(guardCrazyhouseXiangqiEngineMove(state, hangs, moves, -1), hangs);
});
