import assert from 'node:assert/strict';
import test from 'node:test';
import {
  jieqiMoveToPikafishUci,
  jieqiStateToPikafishFen,
  pikafishUciToJieqiMove,
} from './jieqi-fen.js';
import { applyJieqiMove, createInitialJieqiState, STANDARD_JIEQI_DEAL } from './variants-jieqi.js';

// The exact FEN the Pikafish jieqi/jieqi_old binary prints for `position startpos`
// (verified by running the engine). Our encoder must reproduce it byte-for-byte —
// this is the ground-truth check on the whole encoding.
const START_FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';

test('start position matches the Pikafish-jieqi reference FEN exactly', () => {
  assert.equal(jieqiStateToPikafishFen(createInitialJieqiState('t')), START_FEN);
});

test('the board field leaks no dark-piece identity (only X/x, generals, digits)', () => {
  const board = jieqiStateToPikafishFen(createInitialJieqiState('t')).split(' ')[0];
  assert.match(board, /^[0-9XxKk/]+$/);
});

test('different hidden identities with the same public dark board encode the same board field', () => {
  const left = createInitialJieqiState('left');
  const right = createInitialJieqiState('right', {
    red: [...STANDARD_JIEQI_DEAL.red].reverse(),
    black: [...STANDARD_JIEQI_DEAL.black].reverse(),
  });
  const leftBoard = jieqiStateToPikafishFen(left).split(' ')[0];
  const rightBoard = jieqiStateToPikafishFen(right).split(' ')[0];
  assert.equal(leftBoard, rightBoard);
});

test('revealing a piece sets its role char and decrements the hidden pool', () => {
  // Standard deal: a1 is a corner chariot. Red moves it a1->a2, revealing it.
  let state = createInitialJieqiState('t');
  state = applyJieqiMove(state, { from: 'a1', to: 'a2' });
  const [board, stm, rest, clock, full] = jieqiStateToPikafishFen(state).split(' ');
  assert.ok(board.includes('R'), `expected a revealed red chariot in: ${board}`);
  assert.ok(rest.startsWith('R1A2C2P5N2B2'), `red hidden pool not decremented: ${rest}`);
  assert.equal(stm, 'b'); // black to move
  assert.equal(clock, '1'); // one ply since the last capture
  assert.equal(full, '1'); // still move 1 (full move increments after black)
});

test('move <-> Pikafish UCI round-trips with the rank-1 <-> rank-0 offset', () => {
  assert.equal(jieqiMoveToPikafishUci({ from: 'a1', to: 'a2' }), 'a0a1');
  assert.equal(jieqiMoveToPikafishUci({ from: 'e10', to: 'e9' }), 'e9e8');
  assert.deepEqual(pikafishUciToJieqiMove('a0a1'), { from: 'a1', to: 'a2' });
  assert.deepEqual(pikafishUciToJieqiMove('e9e8'), { from: 'e10', to: 'e9' });
  assert.equal(pikafishUciToJieqiMove('nope'), null);
});

test('the viewer never learns which of its own dark pieces were captured', () => {
  // Black takes red's face-down b1 piece. Truth and black (the capturer) drop
  // that identity from red's pool; red's own FEN keeps it, because under
  // capturer-only reveal red was never told what it lost.
  const state = createInitialJieqiState('t');
  const victim = state.board.b1;
  assert.ok(victim?.faceDown && victim.color === 'red');
  const board = { ...state.board };
  delete board.b1;
  const captured = {
    ...state,
    board,
    captures: [{ owner: 'red' as const, role: victim.role, revealedAtCapture: false }],
  };
  const pool = (fen: string): string => fen.split(' ')[2]!;
  const before = pool(jieqiStateToPikafishFen(state));
  assert.equal(before, pool(jieqiStateToPikafishFen(state, { viewer: 'red' })));
  assert.equal(before, pool(jieqiStateToPikafishFen(state, { viewer: 'black' })));

  const truth = pool(jieqiStateToPikafishFen(captured));
  assert.equal(truth, pool(jieqiStateToPikafishFen(captured, { viewer: 'black' })));
  assert.notEqual(truth, before);
  assert.equal(pool(jieqiStateToPikafishFen(captured, { viewer: 'red' })), before);
});
