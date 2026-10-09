// The banqi perpetual-chase (長捉) limit: kernel legality, resets, the only-move
// exception, and how chase positions interact with the repetition draw.
//
// Every scenario runs at the shipped BANQI_CHASE_LIMIT and at the other counts
// Brian may pick (3/5/10), set per state through `chaseLimit`, so changing the
// constant cannot silently break the rule.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBanqiMove,
  BANQI_CHASE_LIMIT,
  type BanqiBoard,
  type BanqiColor,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPiece,
  type BanqiPieceRole,
  type BanqiSquare,
  getBanqiForbiddenChaseMoves,
  getBanqiLegalMoves,
  getBanqiPlayerView,
  isBanqiLegalMove,
} from './variants-banqi.js';

const LIMITS = [...new Set([BANQI_CHASE_LIMIT, 3, 5, 7, 10])];

function up(color: BanqiColor, role: BanqiPieceRole): BanqiPiece {
  return { color, role, faceDown: false };
}

function down(color: BanqiColor, role: BanqiPieceRole): BanqiPiece {
  return { color, role, faceDown: true };
}

function mv(from: BanqiSquare, to: BanqiSquare): BanqiMove {
  return { from, to };
}

// Red seat owns red ink and is to move; black's `lastMove` just arrived.
function redToMove(board: BanqiBoard, lastMove: BanqiMove, chaseLimit: number | null) {
  const state: BanqiGameState = {
    id: 'chase',
    board,
    status: { type: 'playing', turn: 'red' },
    ply: 10,
    firstColor: 'red',
    moveNumber: 6,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
    lastMove,
    chaseLimit,
  };
  return state;
}

function play(state: BanqiGameState, move: BanqiMove): BanqiGameState {
  assert.ok(isBanqiLegalMove(state, move), `expected ${move.from}${move.to} to be legal`);
  const next = applyBanqiMove(state, move);
  assert.notEqual(next, state);
  return next;
}

function hasMove(moves: BanqiMove[], move: BanqiMove): boolean {
  return moves.some((m) => m.from === move.from && m.to === move.to);
}

// Open-board chase: a red advisor shuttles c3/c2 after a black chariot that
// shuttles d2/d3. Each red step lands next to the chariot (advisor > chariot);
// each black step lands diagonal to the advisor. A 4-ply cycle, so without the
// repetition carve-out it would be a threefold draw by the third chase.
const RED_CHASE = [mv('c3', 'c2'), mv('c2', 'c3')];
const BLACK_FLEE = [mv('d2', 'd3'), mv('d3', 'd2')];

function openBoard(extra: BanqiBoard = {}): BanqiBoard {
  return {
    c3: up('red', 'advisor'),
    d2: up('black', 'chariot'),
    h1: up('red', 'soldier'), // gives red other moves
    a4: up('black', 'soldier'), // gives black other moves
    ...extra,
  };
}

/** Play `n` chase moves (each followed by the flee); returns the state with red to move. */
function chaseTimes(state: BanqiGameState, n: number, startIndex = 0): BanqiGameState {
  let s = state;
  for (let i = 0; i < n; i += 1) {
    s = play(s, RED_CHASE[(startIndex + i) % 2]!);
    assert.equal(s.status.type, 'playing', `chase ${i + 1} ended the game`);
    s = play(s, BLACK_FLEE[(startIndex + i) % 2]!);
    assert.equal(s.status.type, 'playing', `flee ${i + 1} ended the game`);
  }
  return s;
}

for (const limit of LIMITS) {
  test(`limit ${limit}: the move that would extend a full chase stretch is not legal`, () => {
    const start = redToMove(openBoard(), mv('e2', 'd2'), limit);
    const beforeLimit = chaseTimes(start, limit - 1);
    const next = RED_CHASE[(limit - 1) % 2]!;
    assert.ok(hasMove(getBanqiLegalMoves(beforeLimit), next), 'chase move legal below the limit');
    assert.deepEqual(getBanqiForbiddenChaseMoves(beforeLimit), []);

    const atLimit = chaseTimes(start, limit);
    assert.equal(atLimit.chases?.red?.count, limit);
    const forbidden = RED_CHASE[limit % 2]!;
    const legal = getBanqiLegalMoves(atLimit);
    assert.ok(!hasMove(legal, forbidden), 'extending chase omitted from legal moves');
    assert.equal(isBanqiLegalMove(atLimit, forbidden), false);
    // Validation refuses it: applying returns the state unchanged.
    assert.equal(applyBanqiMove(atLimit, forbidden), atLimit);
    // The other square next to the target is an extension too, also refused.
    const sideways = limit % 2 === 0 ? mv('c3', 'd3') : mv('c2', 'd2');
    assert.ok(hasMove(getBanqiForbiddenChaseMoves(atLimit), sideways));
    assert.equal(isBanqiLegalMove(atLimit, sideways), false);
    // The client sees the same list: its view's legalMoves omit both.
    const view = getBanqiPlayerView(atLimit, 'red');
    assert.ok(!hasMove(view.legalMoves, forbidden));
    assert.ok(!hasMove(view.legalMoves, sideways));
    // Moving the chaser elsewhere, or another piece, stays legal.
    assert.ok(hasMove(legal, { from: 'h1', to: 'g1' }));
  });

  test(`limit ${limit}: a chase stretch does not reach the repetition draw`, () => {
    const atLimit = chaseTimes(redToMove(openBoard(), mv('e2', 'd2'), limit), limit);
    assert.equal(atLimit.status.type, 'playing');
    assert.equal(atLimit.chases?.red?.count, limit);
  });

  test(`limit ${limit}: a flip, a capture or another move resets the stretch`, () => {
    // Leave the advisor on c2 and the chariot on d3 (an odd number of chases).
    // Three, not `limit`: two full stretches would run into the 40-ply clock.
    const k = 3;
    for (const reset of [mv('f4', 'f4'), mv('h1', 'g1')]) {
      const board = openBoard({ f4: down('red', 'horse') });
      let s = chaseTimes(redToMove(board, mv('e2', 'd2'), limit), k);
      assert.equal(s.chases?.red?.count, k);
      s = play(s, reset); // a flip, or another piece's move, instead of chasing
      assert.equal(s.chases?.red, undefined);
      s = play(s, mv('d3', 'e3'));
      s = play(s, reset.from === 'h1' ? mv('g1', 'h1') : mv('h1', 'g1'));
      s = play(s, mv('e3', 'd3')); // back, not next to the advisor on c2
      s = play(s, mv('c2', 'c3')); // a chase again: a NEW stretch
      assert.equal(s.chases?.red?.count, 1);
      s = play(s, BLACK_FLEE[1]!);
      s = chaseTimes(s, limit - 1);
      assert.equal(s.chases?.red?.count, limit, 'a full fresh stretch is allowed');
      assert.ok(getBanqiForbiddenChaseMoves(s).length > 0);
    }

    // Capture: the chariot flees by taking a red soldier; the stretch ends, and
    // the next threat starts a new one.
    let s = chaseTimes(
      redToMove(openBoard({ e2: up('red', 'soldier') }), mv('d1', 'd2'), limit),
      2,
    );
    s = play(s, RED_CHASE[0]!);
    assert.equal(s.chases?.red?.count, 3);
    s = play(s, mv('d2', 'e2')); // chariot takes the soldier
    assert.deepEqual(s.chases, {});
    s = play(s, mv('c2', 'd2'));
    assert.equal(s.chases?.red?.count, 1);

    // The target not fleeing (black moves another piece) ends the stretch too.
    s = chaseTimes(redToMove(openBoard(), mv('e2', 'd2'), limit), 1);
    s = play(s, RED_CHASE[1]!);
    assert.equal(s.chases?.red?.count, 2);
    s = play(s, mv('a4', 'a3'));
    assert.equal(s.chases?.red, undefined);
  });

  test(`limit ${limit}: the extension stays legal when it is the chaser's only move`, () => {
    // Red's lone advisor in the corner chases a chariot shuttling b1/b2. With the
    // advisor on a1 and the chariot on b2, both a2 and b1 extend the chase and red
    // has nothing else, so both stay legal (no loss by rule edge).
    const oddStart = limit % 2 === 1;
    const board: BanqiBoard = oddStart
      ? { a2: up('red', 'advisor'), b1: up('black', 'chariot') }
      : { a1: up('red', 'advisor'), b2: up('black', 'chariot') };
    let s = redToMove(board, oddStart ? mv('c1', 'b1') : mv('c2', 'b2'), limit);
    const redSteps = [mv('a2', 'a1'), mv('a1', 'a2')];
    const blackSteps = [mv('b1', 'b2'), mv('b2', 'b1')];
    const offset = oddStart ? 0 : 1;
    for (let i = 0; i < limit; i += 1) {
      s = play(s, redSteps[(i + offset) % 2]!);
      s = play(s, blackSteps[(i + offset) % 2]!);
    }
    assert.equal(s.board.a1?.role, 'advisor');
    assert.equal(s.board.b2?.role, 'chariot');
    assert.equal(s.chases?.red?.count, limit);
    const legal = getBanqiLegalMoves(s);
    assert.ok(hasMove(legal, mv('a1', 'a2')));
    assert.ok(hasMove(legal, mv('a1', 'b1')));
    assert.deepEqual(getBanqiForbiddenChaseMoves(s), []);
    assert.ok(isBanqiLegalMove(s, mv('a1', 'a2')));
  });

  test(`limit ${limit}: a protected target still counts`, () => {
    // Black's general guards d2 and an advisor guards d3: taking the chariot would
    // cost the advisor, but threatening it is still a chase.
    const board = openBoard({ e2: up('black', 'general'), e3: up('black', 'advisor') });
    const atLimit = chaseTimes(redToMove(board, mv('d1', 'd2'), limit), limit);
    assert.equal(atLimit.chases?.red?.count, limit);
    assert.equal(isBanqiLegalMove(atLimit, RED_CHASE[limit % 2]!), false);
  });

  test(`limit ${limit}: a cannon chasing over a screen is limited too`, () => {
    // Face-down tiles on b2 and b3 are screens. The red cannon shuttles c2/c3 and
    // threatens the black horse on a2/a3 by jumping the tile between them.
    const board: BanqiBoard = {
      c2: up('red', 'cannon'),
      a3: up('black', 'horse'),
      b2: down('black', 'soldier'),
      b3: down('red', 'soldier'),
      h4: up('black', 'soldier'),
    };
    let s = redToMove(board, mv('a4', 'a3'), limit);
    const redSteps = [mv('c2', 'c3'), mv('c3', 'c2')];
    const blackSteps = [mv('a3', 'a2'), mv('a2', 'a3')];
    for (let i = 0; i < limit; i += 1) {
      s = play(s, redSteps[i % 2]!);
      assert.equal(s.chases?.red?.count, i + 1);
      s = play(s, blackSteps[i % 2]!);
      assert.equal(s.status.type, 'playing');
    }
    const next = redSteps[limit % 2]!;
    assert.equal(isBanqiLegalMove(s, next), false);
    assert.ok(!hasMove(getBanqiLegalMoves(s), next));
    // The flips stay available.
    assert.ok(hasMove(getBanqiLegalMoves(s), mv('b2', 'b2')));
  });
}

test('a soldier chasing the general counts (soldier takes general)', () => {
  const board: BanqiBoard = {
    c3: up('red', 'soldier'),
    d2: up('black', 'general'),
    h1: up('red', 'soldier'),
    a4: up('black', 'soldier'),
  };
  const s = chaseTimes(redToMove(board, mv('e2', 'd2'), BANQI_CHASE_LIMIT), BANQI_CHASE_LIMIT);
  assert.equal(s.chases?.red?.count, BANQI_CHASE_LIMIT);
  assert.equal(isBanqiLegalMove(s, RED_CHASE[BANQI_CHASE_LIMIT % 2]!), false);
});

test('a move next to a piece it cannot take is not a chase', () => {
  // A chariot cannot take an advisor, so shuttling next to it never counts.
  const board: BanqiBoard = {
    c3: up('red', 'chariot'),
    d2: up('black', 'advisor'),
    h1: up('red', 'soldier'),
    a4: up('black', 'soldier'),
  };
  const s = play(redToMove(board, mv('e2', 'd2'), BANQI_CHASE_LIMIT), mv('c3', 'c2'));
  assert.equal(s.chases?.red, undefined);
});

test('without the limit the same chase shuttle is a threefold draw', () => {
  // Control for the carve-out: with the limit off, chase positions count and the
  // shuttle draws on the ninth ply, before even five chases.
  let s = redToMove(openBoard(), mv('e2', 'd2'), null);
  let plies = 0;
  while (s.status.type === 'playing' && plies < 40) {
    const i = Math.floor(plies / 2) % 2;
    s = applyBanqiMove(s, plies % 2 === 0 ? RED_CHASE[i]! : BLACK_FLEE[i]!);
    plies += 1;
  }
  assert.equal(s.status.type === 'finished' && s.status.reason, 'repetition');
  assert.equal(plies, 9);
});

test('a non-chase shuffle still draws by threefold repetition', () => {
  // The advisor steps next to the chariot (a one-move chase), the chariot steps
  // away, the advisor steps back (not a chase), the chariot returns. The
  // positions after the last two steps count, so the cycle draws as before.
  const board: BanqiBoard = {
    b2: up('red', 'advisor'),
    d2: up('black', 'chariot'),
    h1: up('red', 'soldier'),
    a4: up('black', 'soldier'),
  };
  let s = redToMove(board, mv('d1', 'd2'), BANQI_CHASE_LIMIT);
  const cycle = [mv('b2', 'c2'), mv('d2', 'e2'), mv('c2', 'b2'), mv('e2', 'd2')];
  let i = 0;
  while (s.status.type === 'playing' && i < 40) {
    s = applyBanqiMove(s, cycle[i % 4]!);
    i += 1;
  }
  assert.equal(s.status.type === 'finished' && s.status.reason, 'repetition');
  assert.ok(i < 40);
});

test('the limit default comes from BANQI_CHASE_LIMIT when a state does not set one', () => {
  const start: BanqiGameState = { ...redToMove(openBoard(), mv('e2', 'd2'), null) };
  delete start.chaseLimit;
  const atLimit = chaseTimes(start, BANQI_CHASE_LIMIT);
  assert.equal(isBanqiLegalMove(atLimit, RED_CHASE[BANQI_CHASE_LIMIT % 2]!), false);
});
