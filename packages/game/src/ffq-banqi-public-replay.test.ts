import assert from 'node:assert/strict';
import test from 'node:test';
import { ffqBanqiStateToFen } from './ffq-banqi-fen.js';
import {
  applyFFQBanqiReplayMove,
  createInitialFFQBanqiReplayState,
  type FFQBanqiReplayIdentity,
  type FFQBanqiReplayMove,
  ffqBanqiReplayMoveToUci,
  parseFFQBanqiReplayMove,
  parseFFQBanqiReplayStartFen,
} from './ffq-banqi-public-replay.js';
import { ffqBanqiPlyReveal } from './hidden-piece-record.js';
import {
  applyFFQBanqiMove,
  createInitialFFQBanqiState,
  FFQ_BANQI_FACE_UP_SQUARES,
  type FFQBanqiReplayState,
  type FFQBanqiState,
  getFFQBanqiLegalMoves,
  getFFQBanqiPlayerView,
} from './variants-ffq-banqi.js';

const opening: FFQBanqiReplayIdentity[] = [
  { color: 'red', role: 'cannon' },
  { color: 'black', role: 'horse' },
  { color: 'red', role: 'soldier' },
  { color: 'black', role: 'advisor' },
];
const fresh = () => createInitialFFQBanqiReplayState('test', opening);
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const mask = (state: FFQBanqiState) => ({
  ...state,
  board: state.board.map((p) => (p?.faceDown ? { faceDown: true } : p)),
});

test('public opening has exactly four observed identities, fixed seats, and no sampled deal', () => {
  const state = fresh();
  assert.equal(state.board.length, 32);
  assert.equal(state.board.filter((p) => p?.faceDown).length, 28);
  assert.deepEqual(
    FFQ_BANQI_FACE_UP_SQUARES.map((i) => state.board[i]),
    opening.map((p) => ({ ...p, faceDown: false })),
  );
  assert.deepEqual(
    json(state),
    json(parseFFQBanqiReplayStartFen(ffqBanqiStateToFen(state), 'test')),
  );
  assert.deepEqual(state.status, { type: 'playing', turn: 'red' });
  assert.deepEqual(state.hp, { red: 60, black: 60 });
  for (const bad of [
    [],
    opening.slice(1),
    [...opening, opening[0]!],
    Array(4).fill({ color: 'red', role: 'general' }),
    [{ color: 'blue', role: 'horse' }, ...opening.slice(1)],
    [{ color: 'red', role: 'toString' }, ...opening.slice(1)],
  ]) {
    assert.throws(() => createInitialFFQBanqiReplayState('bad', bad as FFQBanqiReplayIdentity[]));
  }
  const fen = ffqBanqiStateToFen(state);
  for (const bad of [
    `${fen} secret-deal`,
    fen.replace('X', 'S'),
    fen.replace('r 60 60', 'b 60 60'),
    fen.replace('60 60', '59 60'),
    fen.replace('0 0 0 1', '1 0 0 1'),
    fen.replace('S4', 'S5'),
  ]) {
    assert.throws(() => parseFFQBanqiReplayStartFen(bad));
  }
});

test('public replay matches every complete kernel output through seeded games and covered captures', () => {
  let covered = 0;
  let terminal = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    let truth = createInitialFFQBanqiState('test', seed);
    let state = createInitialFFQBanqiReplayState(
      'test',
      FFQ_BANQI_FACE_UP_SQUARES.map((i) => truth.board[i]!),
    );
    let random = seed;
    for (let ply = 0; ply < 300 && truth.status.type === 'playing'; ply += 1) {
      assert.deepEqual(json(state), json(mask(truth)));
      for (const seat of ['red', 'black', 'observer'] as const) {
        assert.deepEqual(
          json(getFFQBanqiPlayerView(state, seat)),
          json(getFFQBanqiPlayerView(truth, seat)),
        );
      }
      const moves = getFFQBanqiLegalMoves(truth);
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const action = moves[random % moves.length]!;
      const reveal = ffqBanqiPlyReveal(truth, action);
      const move: FFQBanqiReplayMove = {
        ...action,
        ...(reveal.revealed ? { revealed: reveal.revealed as FFQBanqiReplayIdentity } : {}),
        ...(reveal.capturedHidden
          ? { capturedHidden: reveal.capturedHidden as FFQBanqiReplayIdentity }
          : {}),
      };
      if (move.capturedHidden) covered += 1;
      assert.deepEqual(parseFFQBanqiReplayMove(ffqBanqiReplayMoveToUci(move)), move);
      // Permute every still-secret identity except this action's observation.
      // Serialize the entire result bundle, including both seats and counters.
      const hidden = truth.board.flatMap((p, i) => (p?.faceDown && i !== action.to ? [i] : []));
      const permuted = { ...truth, board: [...truth.board] };
      hidden.forEach((square, i) => {
        permuted.board[square] = truth.board[hidden[hidden.length - i - 1]!]!;
      });
      assert.deepEqual(ffqBanqiPlyReveal(permuted, action), reveal);
      const nextTruth = applyFFQBanqiMove(truth, action);
      const nextPermuted = applyFFQBanqiMove(permuted, action);
      const output = (s: FFQBanqiState) => ({
        state: mask(s),
        fen: ffqBanqiStateToFen(s),
        views: ['red', 'black', 'observer'].map((seat) =>
          getFFQBanqiPlayerView(s, seat as 'red' | 'black' | 'observer'),
        ),
      });
      assert.equal(JSON.stringify(output(nextTruth)), JSON.stringify(output(nextPermuted)));
      state = applyFFQBanqiReplayMove(state, move);
      truth = nextTruth;
      assert.deepEqual(json(state), json(mask(truth)));
      for (const piece of state.board)
        if (piece?.faceDown) assert.deepEqual(piece, { faceDown: true });
    }
    if (truth.status.type === 'finished') terminal += 1;
  }
  assert.ok(covered > 0, 'games include publicly disclosed covered captures');
  assert.ok(terminal > 0, 'games include terminal results');
});

test('replay rejects missing, misplaced, impossible and post-terminal outcomes without mutating input', () => {
  const state = fresh();
  const before = JSON.stringify(state);
  for (const move of [
    { from: 0, to: 0 },
    { from: 0, to: 0, capturedHidden: opening[0] },
    { from: 6, to: 4 }, // cannon captures the covered target across square 5
    { from: 6, to: 4, revealed: opening[1] },
    { from: 6, to: 6, revealed: opening[0] },
    { from: 0, to: 32, revealed: opening[0] },
    { from: 0, to: 0, revealed: { color: 'blue', role: 'horse' } },
    { from: 0, to: 0, revealed: { color: 'red', role: 'toString' } },
  ])
    assert.throws(() => applyFFQBanqiReplayMove(state, move as FFQBanqiReplayMove));
  let general = applyFFQBanqiReplayMove(state, {
    from: 0,
    to: 0,
    revealed: { color: 'red', role: 'general' },
  });
  assert.throws(() =>
    applyFFQBanqiReplayMove(general, {
      from: 1,
      to: 1,
      revealed: { color: 'red', role: 'general' },
    }),
  );
  // A covered friendly capture also consumes the public identity from the pool.
  general = applyFFQBanqiReplayMove(state, {
    from: 6,
    to: 4,
    capturedHidden: { color: 'red', role: 'general' },
  });
  assert.deepEqual(general.hp, { red: 30, black: 60 });
  assert.throws(() =>
    applyFFQBanqiReplayMove(general, {
      from: 0,
      to: 0,
      revealed: { color: 'red', role: 'general' },
    }),
  );
  assert.equal(JSON.stringify(state), before);
  for (const token of ['@a0', 'a0a0', '@a8:R', '@a0:K', 'a0b0x:Z', 'a0b0:R', '@a0:R x:s']) {
    assert.equal(parseFFQBanqiReplayMove(token), null);
  }
});

test('HP, chase and draw endings use the ordinary kernel and preserve masked final boards', () => {
  const capture = { from: 6, to: 4, capturedHidden: { color: 'red', role: 'general' } } as const;
  const loss = applyFFQBanqiReplayMove(
    {
      ...fresh(),
      hp: { red: 30, black: 60 },
      noProgressClock: 29,
      chaseCounts: { red: 4, black: 3 },
    },
    capture,
  );
  assert.deepEqual(loss.status, { type: 'finished', winner: 'black', reason: 'hp' });
  assert.deepEqual(loss.chaseCounts, { red: 0, black: 0 });
  assert.equal(loss.noProgressClock, 0);
  assert.deepEqual(loss.board[0], { faceDown: true });
  assert.throws(() => applyFFQBanqiReplayMove(loss, { from: 0, to: 0, revealed: opening[0] }));

  const setup: FFQBanqiReplayState = {
    ...fresh(),
    board: Array(32).fill(null),
    noProgressClock: 28,
  };
  setup.board[0] = { color: 'red', role: 'horse', faceDown: false };
  setup.board[7] = { color: 'black', role: 'soldier', faceDown: false };
  setup.board[10] = { color: 'black', role: 'horse', faceDown: false };
  setup.board[31] = { faceDown: true };
  const chased = applyFFQBanqiReplayMove(setup, { from: 0, to: 4 });
  assert.equal(chased.chaseCounts.red, 0);
  const draw = applyFFQBanqiReplayMove(chased, { from: 10, to: 9 });
  assert.deepEqual(draw.status, { type: 'finished', winner: null, reason: 'no-progress' });
  assert.equal(draw.noProgressClock, 30);
  assert.deepEqual(draw.board[31], { faceDown: true });
  const chaseSetup = { ...setup, noProgressClock: 0, chaseCounts: { red: 3, black: 2 } };
  chaseSetup.board = [...setup.board];
  chaseSetup.board[7] = null;
  chaseSetup.board[5] = { color: 'black', role: 'soldier', faceDown: false };
  const chase = applyFFQBanqiReplayMove(chaseSetup, { from: 0, to: 4 });
  assert.deepEqual(chase.chaseCounts, { red: 4, black: 2 });
  assert.throws(() =>
    applyFFQBanqiReplayMove(
      { ...chaseSetup, chaseCounts: { red: 4, black: 2 } },
      { from: 0, to: 4 },
    ),
  );
  const flip = applyFFQBanqiReplayMove(chase, {
    from: 31,
    to: 31,
    revealed: { color: 'black', role: 'cannon' },
  });
  assert.deepEqual(flip.chaseCounts, { red: 0, black: 0 });
  assert.equal(flip.noProgressClock, 0);
  const stuck = { ...setup, noProgressClock: 0, board: Array(32).fill(null) };
  stuck.board[0] = { color: 'red', role: 'horse', faceDown: false };
  assert.deepEqual(applyFFQBanqiReplayMove(stuck, { from: 0, to: 4 }).status, {
    type: 'finished',
    winner: 'red',
    reason: 'no-legal-move',
  });
});
