import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiLegalMoves,
  getStandardXiangqiLegalMovesFrom,
  getStandardXiangqiPlayerView,
  isStandardXiangqiGeneralInCheck,
  isStandardXiangqiLegalMove,
  positionRepetitionKey,
  type XiangqiBoard,
  type XiangqiGameState,
  type XiangqiMove,
  xiangqiPerpetualCheckLoser,
} from './index.js';

test('initial position has 44 legal moves for red', () => {
  const state = createInitialXiangqiState('initial');
  assert.equal(getStandardXiangqiLegalMoves(state).length, 44);
});

test('player view carries the full truth board; legal moves only for the side to move', () => {
  const state = createInitialXiangqiState('view');
  const red = getStandardXiangqiPlayerView(state, 'red');
  const black = getStandardXiangqiPlayerView(state, 'black');

  // Both players see every piece (open information).
  assert.equal(Object.keys(red.board).length, Object.keys(state.board).length);
  assert.equal(Object.keys(black.board).length, Object.keys(state.board).length);

  // Only the side to move (red) has a populated legal-move list.
  assert.ok(red.legalMoves.length > 0);
  assert.equal(black.legalMoves.length, 0);
});

test('a self-check move is illegal (check-filtered)', () => {
  // Red chariot on e5 is pinned to the red general on e1 by the black chariot
  // on e10. Sliding it off the e-file exposes the general.
  const state = playingState({
    e1: { color: 'red', role: 'general' },
    e5: { color: 'red', role: 'chariot' },
    d10: { color: 'black', role: 'general' },
    e10: { color: 'black', role: 'chariot' },
  });

  // Moving along the pin (staying on the e-file / capturing the pinner) is legal.
  assert.equal(isStandardXiangqiLegalMove(state, { from: 'e5', to: 'e4' }), true);
  assert.equal(isStandardXiangqiLegalMove(state, { from: 'e5', to: 'e10' }), true);

  // Stepping off the file leaves the general in check → filtered out.
  assert.equal(isStandardXiangqiLegalMove(state, { from: 'e5', to: 'd5' }), false);
  assert.equal(
    getStandardXiangqiLegalMovesFrom(state, 'e5').some((m) => m.to === 'd5' || m.to === 'f5'),
    false,
  );
});

test('flying-general: a move that opens the general file is illegal', () => {
  // The red horse on e5 is the only piece between the two generals on the
  // e-file. Every horse move vacates e5 and would leave the generals facing.
  const state = playingState({
    e1: { color: 'red', role: 'general' },
    e5: { color: 'red', role: 'horse' },
    e10: { color: 'black', role: 'general' },
  });

  assert.deepEqual(getStandardXiangqiLegalMovesFrom(state, 'e5'), []);
  assert.equal(isStandardXiangqiLegalMove(state, { from: 'e5', to: 'd7' }), false);

  // The general itself may still shuffle within the palace.
  assert.ok(getStandardXiangqiLegalMovesFrom(state, 'e1').length > 0);
});

test('checkmate ends the game with the mating side as winner', () => {
  // Red slides the chariot i5→i10: it checks the black general on d10 along
  // rank 10 (also covering the e10 flight square); the red soldier on d8 covers
  // the d9 flight square. No escape → checkmate.
  const state = playingState({
    e1: { color: 'red', role: 'general' },
    i5: { color: 'red', role: 'chariot' },
    d8: { color: 'red', role: 'soldier' },
    d10: { color: 'black', role: 'general' },
  });

  const next = applyStandardXiangqiMove(state, { from: 'i5', to: 'i10' });
  assert.deepEqual(next.status, { type: 'finished', winner: 'red', reason: 'checkmate' });
  // The general is never captured — the game ends on mate.
  assert.deepEqual(next.board.d10, { color: 'black', role: 'general' });
});

test('stalemate is a LOSS for the side with no legal move', () => {
  // Before the move the black general (e10) can still flee to e9. Red plays the
  // soldier e7→e8, which covers e9. Black's d10/f10 are already covered by the
  // red chariots; e10 is not attacked → black is stalemated, not in check.
  const state = playingState({
    e1: { color: 'red', role: 'general' },
    d1: { color: 'red', role: 'chariot' },
    f1: { color: 'red', role: 'chariot' },
    e7: { color: 'red', role: 'soldier' },
    e10: { color: 'black', role: 'general' },
  });

  const next = applyStandardXiangqiMove(state, { from: 'e7', to: 'e8' });
  // Xiangqi: no-move side loses. Winner is red, NOT a draw.
  assert.deepEqual(next.status, { type: 'finished', winner: 'red', reason: 'stalemate' });
});

test('a capture resets the progress clock', () => {
  const state = playingState(
    {
      e1: { color: 'red', role: 'general' },
      a1: { color: 'red', role: 'chariot' },
      a5: { color: 'black', role: 'horse' },
      f10: { color: 'black', role: 'general' },
    },
    { progressClock: 12 },
  );

  const captured = applyStandardXiangqiMove(state, { from: 'a1', to: 'a5' });
  assert.equal(captured.progressClock, 0);
  assert.equal(captured.board.a5?.color, 'red');

  // A quiet move increments instead of resetting.
  const quiet = applyStandardXiangqiMove(state, { from: 'a1', to: 'b1' });
  assert.equal(quiet.progressClock, 13);
});

test('the progress-clock limit ends the game in a draw', () => {
  const state = playingState(
    {
      e1: { color: 'red', role: 'general' },
      a1: { color: 'red', role: 'chariot' },
      i10: { color: 'black', role: 'chariot' },
      f10: { color: 'black', role: 'general' },
    },
    { progressClock: 1 },
  );

  const next = applyStandardXiangqiMove(state, { from: 'a1', to: 'a2' }, { progressClockLimit: 2 });
  assert.deepEqual(next.status, { type: 'finished', winner: null, reason: 'progress-clock' });
});

test('threefold repetition ends the game in a draw', () => {
  // Both sides shuffle a rook back and forth. The red-to-move start position
  // recurs until its count reaches three.
  let state = playingState({
    e1: { color: 'red', role: 'general' },
    a1: { color: 'red', role: 'chariot' },
    i10: { color: 'black', role: 'chariot' },
    f10: { color: 'black', role: 'general' },
  });
  // Seed the count for the starting position (mirrors createInitialXiangqiState).
  const startKey = positionRepetitionKey(state);
  state = { ...state, positionCounts: { [startKey]: 1 } };

  const cycle: XiangqiMove[] = [
    { from: 'a1', to: 'a2' },
    { from: 'i10', to: 'i9' },
    { from: 'a2', to: 'a1' },
    { from: 'i9', to: 'i10' },
  ];

  // Two full cycles bring the start position's count from 1 → 2 → 3.
  let terminalReason: string | undefined;
  for (let i = 0; i < cycle.length * 2; i += 1) {
    state = applyStandardXiangqiMove(state, cycle[i % cycle.length]);
    if (state.status.type === 'finished') {
      terminalReason = state.status.reason;
      break;
    }
  }

  assert.equal(terminalReason, 'repetition');
  assert.equal(state.status.type, 'finished');
  if (state.status.type === 'finished') assert.equal(state.status.winner, null);
});

// ── perpetual check (the chasing rule) ──────────────────────────────────────

test('a repetition manufactured by one side perpetually checking names that side the loser', () => {
  // Bare black general shuffling d10/e10 under a red chariot that follows it
  // between d5 and e5. Red's general sits on f1 so the flying-general rule never
  // interferes with the black general using the e-file.
  const start = playingState({
    d10: { color: 'black', role: 'general' },
    a5: { color: 'red', role: 'chariot' },
    f1: { color: 'red', role: 'general' },
  });

  const moves: XiangqiMove[] = [
    { from: 'a5', to: 'd5' }, // check
    { from: 'd10', to: 'e10' },
    { from: 'd5', to: 'e5' }, // check
    { from: 'e10', to: 'd10' },
    { from: 'e5', to: 'd5' }, // check
    { from: 'd10', to: 'e10' },
    { from: 'd5', to: 'e5' }, // check
    { from: 'e10', to: 'd10' },
    { from: 'e5', to: 'd5' }, // check — closes the three-fold
  ];

  let state = start;
  for (const move of moves) {
    if (state.status.type !== 'playing') break;
    state = applyStandardXiangqiMove(state, move);
  }

  // The kernel itself still reports a draw: it stays a pure sync function, and
  // the override lives in the tenant.
  assert.equal(state.status.type, 'finished');
  if (state.status.type === 'finished') {
    assert.equal(state.status.reason, 'repetition');
    assert.equal(state.status.winner, null);
  }

  // The adjudicator is what turns it into a loss for the checking side.
  assert.equal(xiangqiPerpetualCheckLoser(state.moveLog ?? [], start), 'red');
});

test('mutual perpetual check stays a draw', () => {
  // The documented mutual-perpetual position (en.wikipedia.org/wiki/Xiangqi,
  // "Rules"): 1.Hd7+ Hf4+ 2.Ae2+ Hh3+ 3.Af3+ Hf4+ 4.Ae2+ etc. Each side
  // discovers a cannon check along its own line by stepping a piece off the
  // screen square, so every ply in the cycle is a check, by both colours.
  const start = playingState({
    f10: { color: 'black', role: 'general' },
    f6: { color: 'red', role: 'horse' },
    e3: { color: 'red', role: 'general' },
    f3: { color: 'red', role: 'advisor' },
    h3: { color: 'black', role: 'horse' },
    i3: { color: 'black', role: 'cannon' },
    f1: { color: 'red', role: 'cannon' },
  });

  const moves: XiangqiMove[] = [
    { from: 'f6', to: 'd7' }, // 1. Hd7+
    { from: 'h3', to: 'f4' }, // 1... Hf4+
    { from: 'f3', to: 'e2' }, // 2. Ae2+
    { from: 'f4', to: 'h3' }, // 2... Hh3+
    { from: 'e2', to: 'f3' }, // 3. Af3+
    { from: 'h3', to: 'f4' }, // 3... Hf4+
    { from: 'f3', to: 'e2' }, // 4. Ae2+
    { from: 'f4', to: 'h3' },
    { from: 'e2', to: 'f3' },
  ];

  let state = start;
  for (const move of moves) {
    if (state.status.type !== 'playing') break;
    const mover = state.status.turn;
    assert.ok(
      isStandardXiangqiLegalMove(state, move),
      `${mover} ${move.from}->${move.to} should be legal`,
    );
    state = applyStandardXiangqiMove(state, move);
    if (state.status.type === 'playing') {
      assert.ok(
        isStandardXiangqiGeneralInCheck(state, mover === 'red' ? 'black' : 'red'),
        `${mover} ${move.from}->${move.to} should give check`,
      );
    }
  }

  assert.equal(state.status.type, 'finished');
  if (state.status.type === 'finished') assert.equal(state.status.reason, 'repetition');

  // Both sides check perpetually, so neither is the sole aggressor: draw stands.
  assert.equal(xiangqiPerpetualCheckLoser(state.moveLog ?? [], start), null);
});

test('perpetual check is judged over the whole repetition, not the last lap', () => {
  // The repeated position (black general f10, red chariot e8, red to move)
  // stands after plies 1, 5 and 9. Red checks on both of its moves in the last
  // lap but moved quietly in the first, so red did not check on every move of
  // the repetition and the draw stands (Pikafish rule_judge, Fairy-Stockfish).
  const start = playingState(
    {
      d1: { color: 'red', role: 'general' },
      e10: { color: 'black', role: 'general' },
      e8: { color: 'red', role: 'chariot' },
    },
    { turn: 'black' },
  );
  const moves: XiangqiMove[] = [
    { from: 'e10', to: 'f10' },
    { from: 'e8', to: 'e7' }, // quiet
    { from: 'f10', to: 'f9' },
    { from: 'e7', to: 'e8' }, // quiet
    { from: 'f9', to: 'f10' },
    { from: 'e8', to: 'f8' }, // check
    { from: 'f10', to: 'e10' },
    { from: 'f8', to: 'e8' }, // check
    { from: 'e10', to: 'f10' },
  ];

  let state = start;
  for (const move of moves) {
    assert.ok(isStandardXiangqiLegalMove(state, move), `${move.from}->${move.to} should be legal`);
    state = applyStandardXiangqiMove(state, move);
  }
  assert.equal(state.status.type, 'finished');
  if (state.status.type === 'finished') assert.equal(state.status.reason, 'repetition');
  assert.equal(xiangqiPerpetualCheckLoser(state.moveLog ?? [], start), null);
});

test('a check-free repetition is not adjudicated as perpetual check', () => {
  const start = playingState({
    e1: { color: 'red', role: 'general' },
    a1: { color: 'red', role: 'chariot' },
    i10: { color: 'black', role: 'chariot' },
    f10: { color: 'black', role: 'general' },
  });

  const cycle: XiangqiMove[] = [
    { from: 'a1', to: 'a2' },
    { from: 'i10', to: 'i9' },
    { from: 'a2', to: 'a1' },
    { from: 'i9', to: 'i10' },
  ];

  let state = start;
  for (let i = 0; i < cycle.length * 3; i += 1) {
    if (state.status.type !== 'playing') break;
    state = applyStandardXiangqiMove(state, cycle[i % cycle.length]);
  }

  assert.equal(state.status.type, 'finished');
  if (state.status.type === 'finished') assert.equal(state.status.reason, 'repetition');
  assert.equal(xiangqiPerpetualCheckLoser(state.moveLog ?? [], start), null);
});

test('perpetual-check adjudication refuses to score a desynced move list', () => {
  const start = playingState({
    d10: { color: 'black', role: 'general' },
    a5: { color: 'red', role: 'chariot' },
    f1: { color: 'red', role: 'general' },
  });
  // A chariot cannot hop from a5 to e7, so the list does not describe this game.
  assert.equal(xiangqiPerpetualCheckLoser([{ from: 'a5', to: 'e7' }], start), null);
});

// ── helpers ─────────────────────────────────────────────────────────────────

function playingState(
  board: XiangqiBoard,
  opts: { turn?: 'red' | 'black'; progressClock?: number } = {},
): XiangqiGameState {
  return {
    id: 'standard-test',
    board,
    status: { type: 'playing', turn: opts.turn ?? 'red' },
    moveNumber: 1,
    progressClock: opts.progressClock ?? 0,
    positionCounts: {},
  };
}
