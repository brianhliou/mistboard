// The Atomic Xiangqi <-> Fairy-Stockfish move encoding, and the win scan.
//
// The encoding is a passthrough (`<from><to>`, a1-i10 on both sides), so the
// tests are about the two places a wrong answer would be silent: the matcher
// must hand back the KERNEL's own move object and refuse anything else, and
// the win scan must see a blast that removes the general, not only a direct
// capture, because under these rules that is how generals actually die.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atomicXiangqiStateFromFen,
  createInitialAtomicXiangqiState,
  getAtomicXiangqiLegalMoves,
} from '@mistboard/game';
import {
  atomicXiangqiMoveToUci,
  atomicXiangqiWinningMove,
  legalMoveForUci,
} from './server-atomic-xiangqi-engine.js';

test('every legal move at the start array round-trips back to the same move', () => {
  const state = createInitialAtomicXiangqiState('atomic-roundtrip-fixture');
  const moves = getAtomicXiangqiLegalMoves(state);
  // The count the railpack build gate asserts against the binary.
  assert.equal(moves.length, 44);
  const seen = new Set<string>();
  for (const move of moves) {
    const uci = atomicXiangqiMoveToUci(move);
    assert.match(uci, /^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$/, uci);
    assert.ok(!seen.has(uci), `two moves spell the same token: ${uci}`);
    seen.add(uci);
    assert.equal(legalMoveForUci(moves, uci), move, uci);
  }
  assert.equal(atomicXiangqiMoveToUci({ from: 'i10', to: 'i9' }), 'i10i9');
});

test('the win scan takes the blast that removes the general, and only that', () => {
  // Red chariot d9 can take the black advisor d10 beside the general on e10;
  // red chariot f2 must not take the horse on f1 beside its own general, and
  // the kernel already excludes it. Nothing captures the general directly.
  const state = atomicXiangqiStateFromFen('3ak4/3R5/9/9/9/9/9/9/5R3/4Kn3 w - - 0 1', 'win');
  assert.ok(state);
  const moves = getAtomicXiangqiLegalMoves(state);
  assert.deepEqual(atomicXiangqiWinningMove(state, moves, 'red'), { from: 'd9', to: 'd10' });
  assert.equal(legalMoveForUci(moves, 'f2f1'), null, 'a self-blast is not a legal move');
});

test('a cannon shot beside the general does not read as a win (D13)', () => {
  // The red cannon on d2 fires over the black chariot on d9 and takes the
  // advisor on d10. The shot does not blast, so the general on e10 survives
  // and the scan finds nothing. (Red's general stands on f1: on e1 the two
  // generals would face down the open file and the position would be illegal.)
  const state = atomicXiangqiStateFromFen('3ak4/3r5/9/9/9/9/9/9/3C5/5K3 w - - 0 1', 'shot');
  assert.ok(state);
  const moves = getAtomicXiangqiLegalMoves(state);
  assert.ok(legalMoveForUci(moves, 'd2d10'), 'the shot itself is legal');
  assert.equal(atomicXiangqiWinningMove(state, moves, 'red'), null);
});

test('an unmatched engine reply fails closed rather than guessing', () => {
  const moves = getAtomicXiangqiLegalMoves(createInitialAtomicXiangqiState('atomic-reject'));
  for (const token of [
    '',
    'a1a2,a2a1', // the duck encoding
    'a1a2 a2a3', // a pv, not a move
    'a1a1', // null move
    'R@d4', // the fortress drop encoding
    'e1d2', // legal shape, but a general does not move diagonally
    '(none)', // FSF's bestmove when it has nothing
  ]) {
    assert.equal(legalMoveForUci(moves, token), null, `should not match: "${token}"`);
  }
});
