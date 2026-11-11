import assert from 'node:assert/strict';
import test from 'node:test';
import { ffqBanqiStateToFen } from './ffq-banqi-fen.js';
import {
  applyFFQBanqiMove,
  createInitialFFQBanqiState,
  type FFQBanqiState,
} from './variants-ffq-banqi.js';

test('FFQ public FEN has eight top-first ranks, fixed ink turn, HP, clock and BOTH chase counts', () => {
  const state: FFQBanqiState = {
    ...createInitialFFQBanqiState('fen', 800),
    board: Array.from({ length: 32 }, () => null),
    hp: { red: 43, black: 20 },
    noProgressClock: 17,
    chaseCounts: { red: 4, black: 2 },
    ply: 9,
    moveNumber: 5,
    status: { type: 'playing', turn: 'black' },
  };
  state.board[0] = { color: 'red', role: 'general', faceDown: false };
  state.board[31] = { color: 'black', role: 'horse', faceDown: false };
  state.board[8] = { color: 'red', role: 'horse', faceDown: true };
  assert.equal(
    ffqBanqiStateToFen(state),
    '3h/4/4/4/4/X3/4/G3 b 43 20 17 4 2 5 A2E2R2H2C2S5g1a2e2r2h1c2s5 0 0',
  );
});

test('setup FEN masks 28 tiles, carries four revealed pieces and no per-square deal', () => {
  const state = createInitialFFQBanqiState('fen', 800);
  const fields = ffqBanqiStateToFen(state).split(' ');
  assert.equal(fields.length, 11);
  assert.equal(fields[0].split('/').length, 8);
  assert.equal([...fields[0]].filter((c) => c === 'X').length, 28);
  assert.equal([...fields[0]].filter((c) => /[GAERHCSgaerhcs]/.test(c)).length, 4);
  assert.equal(fields.slice(1, 8).join(' '), 'r 60 60 0 0 0 1');
  const swapped = { ...state, board: [...state.board] };
  const hidden = state.board.flatMap((piece, i) => (piece?.faceDown ? [i] : []));
  const reverse = [...hidden].reverse();
  hidden.forEach((square, i) => {
    swapped.board[square] = state.board[reverse[i]];
  });
  assert.equal(ffqBanqiStateToFen(swapped), ffqBanqiStateToFen(state));
});

test('public FEN subtracts every disclosed covered capture from the pool, live AND finished', () => {
  const initial: FFQBanqiState = {
    ...createInitialFFQBanqiState('fen', 800),
    board: Array.from({ length: 32 }, () => null),
  };
  initial.board[0] = { color: 'red', role: 'cannon', faceDown: false };
  initial.board[4] = { color: 'black', role: 'soldier', faceDown: false };
  initial.board[8] = { color: 'black', role: 'horse', faceDown: true };
  initial.board[31] = { color: 'black', role: 'general', faceDown: true };
  const horse = applyFFQBanqiMove(initial, { from: 0, to: 8 });
  const elephant = applyFFQBanqiMove(
    {
      ...initial,
      board: initial.board.map((piece, i) => (i === 8 ? { ...piece!, role: 'elephant' } : piece)),
    },
    { from: 0, to: 8 },
  );
  for (const finished of [false, true]) {
    if (finished)
      for (const state of [horse, elephant])
        state.status = { type: 'finished', winner: 'red', reason: 'hp' };
    const horseFields = ffqBanqiStateToFen(horse).split(' ');
    const elephantFields = ffqBanqiStateToFen(elephant).split(' ');
    assert.equal(horseFields.length, 11);
    assert.equal(horseFields.slice(0, 8).join(' '), '3X/4/4/4/4/C3/s3/4 b 60 55 0 0 0 1');
    assert.deepEqual(horseFields.slice(0, 8), elephantFields.slice(0, 8));
    assert.equal(horseFields[8], 'G1A2E2R2H2C1S5g1a2e2r2h1c2s4');
    assert.equal(elephantFields[8], 'G1A2E2R2H2C1S5g1a2e1r2h2c2s4');
    assert.deepEqual(horseFields.slice(9), ['0', '0']);
    assert.deepEqual(elephantFields.slice(9), ['0', '0']);
    // Changing an identity still on the board cannot change even the pool.
    const masked = {
      ...horse,
      board: horse.board.map((piece) =>
        piece?.faceDown
          ? { color: 'red' as const, role: 'advisor' as const, faceDown: true }
          : piece,
      ),
    };
    assert.equal(ffqBanqiStateToFen(masked), ffqBanqiStateToFen(horse));
  }
});

test('empty public pool is a dash, with no exact-deal suffix', () => {
  const initial = createInitialFFQBanqiState('fen', 800);
  const state = {
    ...initial,
    board: initial.board.map((piece) => ({ ...piece!, faceDown: false })),
  };
  assert.equal(ffqBanqiStateToFen(state).split(' ')[8], '-');
  assert.equal(ffqBanqiStateToFen(state).split(' ').length, 11);
});
