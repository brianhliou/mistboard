import assert from 'node:assert/strict';
import test from 'node:test';
import * as game from './index.js';

type State = game.ThreeKingdomsBanqiState;
type Board = game.ThreeKingdomsBanqiBoard;
type Square = game.ThreeKingdomsBanqiSquare;
const up = (color: game.BanqiColor, role: game.BanqiPieceRole): game.BanqiPiece => ({
  color,
  role,
  faceDown: false,
});
const down = (color: game.BanqiColor, role: game.BanqiPieceRole): game.BanqiPiece => ({
  color,
  role,
  faceDown: true,
});
function playing(board: Board, overrides: Partial<State> = {}): State {
  return {
    ...game.createInitialThreeKingdomsBanqiState('test', 628),
    board,
    firstColor: 'red',
    ...overrides,
  };
}
const move = (from: Square, to: Square) => ({ from, to });
const dests = (state: State, from: Square) =>
  game
    .getThreeKingdomsBanqiLegalMoves(state)
    .filter((m) => m.from === from)
    .map((m) => m.to)
    .sort();
function play(state: State, from: Square, to: Square): State {
  const next = game.applyThreeKingdomsBanqiMove(state, move(from, to));
  assert.notEqual(next, state, `${from}${to} should be legal`);
  return next;
}

test('Three Kingdoms banqi deals 32 pieces into the four corner blocks on a 9x5 board', () => {
  assert.equal(typeof game.createInitialThreeKingdomsBanqiState, 'function');
  const state = game.createInitialThreeKingdomsBanqiState('setup', 628);
  const squares = Object.keys(state.board).sort();
  const expected: string[] = [];
  for (const rank of [1, 2, 4, 5]) {
    for (const file of 'abcdfghi') expected.push(`${file}${rank}`);
  }
  assert.deepEqual(squares, expected.sort());
  assert.ok(Object.values(state.board).every((piece) => piece?.faceDown));
  assert.deepEqual(state, game.createInitialThreeKingdomsBanqiState('setup', 628));
  assert.notDeepEqual(state.board, game.createInitialThreeKingdomsBanqiState('setup', 629).board);
  const moves = game.getThreeKingdomsBanqiLegalMoves(state);
  assert.equal(moves.length, 32);
  assert.ok(moves.every((move) => move.from === move.to));
  for (const color of ['red', 'black'] as const) {
    const pieces = Object.values(state.board).filter((piece) => piece?.color === color);
    assert.equal(pieces.length, 16);
    assert.equal(
      pieces.reduce((sum, piece) => sum + game.THREE_KINGDOMS_BANQI_POINTS[piece!.role], 0),
      135,
    );
    for (const [role, count] of Object.entries(game.BANQI_PIECE_COUNTS)) {
      assert.equal(pieces.filter((piece) => piece?.role === role).length, count);
    }
  }
});

test('seeded deal accepts a supplied RNG and is not retained in the player payload', () => {
  assert.deepEqual(
    game.createThreeKingdomsBanqiDeal(() => 0.999),
    game.STANDARD_BANQI_DEAL,
  );
  const state = game.createInitialThreeKingdomsBanqiState('rng', () => 0.999);
  assert.equal(state.board.a1?.role, 'general');
  assert.equal(state.board.a1?.color, 'red');
  assert.ok(!('seed' in game.getThreeKingdomsBanqiPlayerView(state, 'red')));
});

for (const role of ['chariot', 'general'] as const) {
  test(`${role} slides orthogonally across the board without palace or royal constraints`, () => {
    const state = playing({ e3: up('red', role) });
    assert.deepEqual(dests(state, 'e3'), [
      'a3',
      'b3',
      'c3',
      'd3',
      'e1',
      'e2',
      'e4',
      'e5',
      'f3',
      'g3',
      'h3',
      'i3',
    ]);
    const blocked = playing({
      e3: up('red', role),
      g3: up('red', 'soldier'),
      c3: down('black', 'general'),
      e5: up('black', 'general'),
    });
    assert.deepEqual(dests(blocked, 'e3'), ['d3', 'e1', 'e2', 'e4', 'e5', 'f3']);
  });
}

test('horse jumps over occupied leg points in all eight directions', () => {
  const state = playing({
    e3: up('red', 'horse'),
    e2: down('red', 'general'),
    e4: down('black', 'soldier'),
    d3: up('red', 'soldier'),
    f3: up('black', 'cannon'),
  });
  assert.deepEqual(dests(state, 'e3'), ['c2', 'c4', 'd1', 'd5', 'f1', 'f5', 'g2', 'g4']);
  assert.deepEqual(dests(playing({ a1: up('red', 'horse') }), 'a1'), ['b3', 'c2']);
});

test('elephant jumps two diagonally across occupied eyes and the middle row', () => {
  const state = playing({
    e3: up('red', 'elephant'),
    d2: down('red', 'general'),
    d4: up('red', 'cannon'),
    f2: up('black', 'soldier'),
    f4: down('black', 'chariot'),
  });
  assert.deepEqual(dests(state, 'e3'), ['c1', 'c5', 'g1', 'g5']);
  assert.deepEqual(dests(playing({ a1: up('red', 'elephant') }), 'a1'), ['c3']);
});

test('advisor steps diagonally anywhere and soldier steps orthogonally in all directions', () => {
  assert.deepEqual(dests(playing({ e3: up('red', 'advisor') }), 'e3'), ['d2', 'd4', 'f2', 'f4']);
  assert.deepEqual(dests(playing({ a1: up('red', 'advisor') }), 'a1'), ['b2']);
  assert.deepEqual(dests(playing({ e3: up('red', 'soldier') }), 'e3'), ['d3', 'e2', 'e4', 'f3']);
  assert.deepEqual(dests(playing({ i5: up('red', 'soldier') }), 'i5'), ['h5', 'i4']);
});

test('cannon slides to empty points and captures across exactly one occupied screen', () => {
  assert.deepEqual(dests(playing({ e3: up('red', 'cannon') }), 'e3'), [
    'a3',
    'b3',
    'c3',
    'd3',
    'e1',
    'e2',
    'e4',
    'e5',
    'f3',
    'g3',
    'h3',
    'i3',
  ]);
  const state = playing({
    e3: up('red', 'cannon'),
    e4: down('red', 'soldier'),
    e5: up('black', 'general'),
    g3: up('red', 'soldier'),
    i3: up('black', 'chariot'),
    c3: up('black', 'horse'),
    a3: up('red', 'advisor'),
    e2: up('black', 'advisor'),
    e1: down('black', 'soldier'),
  });
  assert.deepEqual(dests(state, 'e3'), ['d3', 'e5', 'f3', 'i3']);
  assert.ok(
    !dests(playing({ a1: up('red', 'cannon'), a5: up('black', 'general') }), 'a1').includes('a5'),
  );
  assert.ok(
    !dests(
      playing({
        a1: up('red', 'cannon'),
        a2: down('red', 'horse'),
        a3: up('red', 'soldier'),
        a5: up('black', 'general'),
      }),
      'a1',
    ).includes('a5'),
  );
});

test('every attacker can capture every revealed enemy role without rank or check', () => {
  const origins: Record<game.BanqiPieceRole, Square> = {
    general: 'a3',
    chariot: 'a3',
    cannon: 'a3',
    soldier: 'd3',
    horse: 'c2',
    elephant: 'c1',
    advisor: 'd2',
  };
  for (const [attacker, from] of Object.entries(origins) as [game.BanqiPieceRole, Square][]) {
    for (const victim of Object.keys(origins) as game.BanqiPieceRole[]) {
      const state = playing({
        [from]: up('red', attacker),
        e3: up('black', victim),
        ...(attacker === 'cannon' ? { c3: down('red', 'soldier') } : {}),
      });
      assert.ok(dests(state, from).includes('e3'), `${attacker} captures ${victim}`);
    }
  }
  // No check restriction: a general may remain on an enemy chariot's line.
  const exposed = playing({
    a1: up('red', 'general'),
    i1: up('black', 'chariot'),
    d3: up('red', 'soldier'),
  });
  assert.ok(dests(exposed, 'd3').includes('d4'));
});

test('face-down pieces are flip-only; enemy pieces cannot move and hidden identities do not affect moves', () => {
  const state = playing({
    a1: up('red', 'chariot'),
    a2: down('black', 'general'),
    b1: up('black', 'horse'),
  });
  assert.deepEqual(dests(state, 'a2'), ['a2']);
  assert.deepEqual(dests(state, 'b1'), []);
  assert.ok(!dests(state, 'a1').includes('a2'));
  assert.ok(!dests(state, 'a1').includes('a3'));
  const otherDeal = { ...state, board: { ...state.board, a2: down('red', 'soldier') } };
  assert.deepEqual(
    game.getThreeKingdomsBanqiLegalMoves(state),
    game.getThreeKingdomsBanqiLegalMoves(otherDeal),
  );
});

test('first flip binds ink and flipping an opponent piece still passes the turn', () => {
  let state = game.createInitialThreeKingdomsBanqiState('ink', 628);
  const blackSquares = game.THREE_KINGDOMS_BANQI_SETUP_SQUARES.filter(
    (square) => state.board[square]?.color === 'black',
  );
  state = play(state, blackSquares[0], blackSquares[0]);
  assert.equal(state.firstColor, 'black');
  assert.equal(game.banqiInkForSeat(state, 'red'), 'black');
  assert.deepEqual(state.status, { type: 'playing', turn: 'black' });
  state = play(state, blackSquares[1], blackSquares[1]);
  assert.equal(state.firstColor, 'black');
  assert.deepEqual(state.status, { type: 'playing', turn: 'red' });
  assert.equal(state.ply, 2);
  assert.equal(state.moveNumber, 2);
});

for (const [role, points] of Object.entries({
  soldier: 5,
  advisor: 5,
  elephant: 5,
  cannon: 10,
  horse: 10,
  chariot: 15,
  general: 20,
}) as [game.BanqiPieceRole, number][]) {
  test(`capturing ${role} awards ${points} to the mover seat, independently of ink`, () => {
    const state = playing(
      { a1: up('black', 'chariot'), a2: up('red', role), i5: up('red', 'soldier') },
      { firstColor: 'black' },
    );
    const next = play(state, 'a1', 'a2');
    assert.deepEqual(next.scores, { red: points, black: 0 });
    assert.deepEqual(next.captures, [{ owner: 'red', role }]);
    assert.equal(next.status.type, 'playing'); // capturing the general is not royal
  });
}

test('100 points ends play immediately, including on the 40th ply with pieces still present', () => {
  const state = playing(
    { a1: up('red', 'soldier'), a2: up('black', 'general'), i5: up('black', 'soldier') },
    { scores: { red: 85, black: 90 }, noProgressClock: 39 },
  );
  const next = play(state, 'a1', 'a2');
  assert.equal(next.scores.red, 105);
  assert.deepEqual(next.status, { type: 'finished', winner: 'red', reason: 'score' });
  assert.ok(next.board.i5);
  assert.deepEqual(game.getThreeKingdomsBanqiLegalMoves(next), []);
  assert.equal(game.applyThreeKingdomsBanqiMove(next, move('i5', 'i4')), next);
  const black = playing(
    { a1: up('black', 'soldier'), a2: up('red', 'advisor'), i5: up('red', 'soldier') },
    { ply: 1, status: { type: 'playing', turn: 'black' }, scores: { red: 0, black: 95 } },
  );
  assert.deepEqual(play(black, 'a1', 'a2').status, {
    type: 'finished',
    winner: 'black',
    reason: 'score',
  });
});

test('a flip and a capture reset the no-progress clock, a quiet move increments it', () => {
  const state = playing(
    { a1: up('red', 'chariot'), a2: up('black', 'soldier'), i5: down('black', 'general') },
    { noProgressClock: 39 },
  );
  assert.equal(play(state, 'i5', 'i5').noProgressClock, 0);
  assert.equal(play(state, 'a1', 'a2').noProgressClock, 0);
  assert.equal(play({ ...state, noProgressClock: 38 }, 'a1', 'b1').noProgressClock, 39);
});

for (const [red, black, winner] of [
  [20, 15, 'red'],
  [10, 25, 'black'],
  [20, 20, null],
] as const) {
  test(`40 quiet plies settle scores ${red}:${black} to ${winner ?? 'draw'}`, () => {
    let state = playing(
      { a1: up('red', 'soldier'), i5: up('black', 'soldier') },
      { scores: { red, black } },
    );
    for (let ply = 0; ply < 40; ply += 1) {
      const cycle = [move('a1', 'b1'), move('i5', 'h5'), move('b1', 'a1'), move('h5', 'i5')];
      state = play(state, cycle[ply % 4].from, cycle[ply % 4].to);
      if (ply < 39) assert.equal(state.status.type, 'playing');
    }
    assert.equal(state.noProgressClock, 40);
    assert.deepEqual(state.status, { type: 'finished', winner, reason: 'no-progress' });
  });
}

function sixChases(): State {
  let state = playing(
    { a1: up('red', 'chariot'), b2: up('black', 'soldier') },
    { lastMove: move('c2', 'b2') },
  );
  for (let chase = 1; chase <= 6; chase += 1) {
    state = chase % 2 === 1 ? play(state, 'a1', 'b1') : play(state, 'b1', 'a1');
    assert.equal(state.chases.red?.count, chase);
    assert.equal(state.status.type, 'playing');
    state = chase % 2 === 1 ? play(state, 'b2', 'a2') : play(state, 'a2', 'b2');
  }
  return state;
}

test('the seventh chase of the same fleeing piece is absent and applying it is a no-op', () => {
  const state = sixChases();
  assert.equal(state.chases.red?.target, 'b2');
  assert.ok(!dests(state, 'a1').includes('b1'));
  assert.equal(game.applyThreeKingdomsBanqiMove(state, move('a1', 'b1')), state);
  assert.ok(dests(state, 'a1').includes('a4')); // a non-chasing alternative
});

test('a non-chase, flip, capture or different fleeing target breaks a chase streak', () => {
  const state = sixChases();
  assert.equal(play(state, 'a1', 'a4').chases.red, undefined);
  const withTile = { ...state, board: { ...state.board, i5: down('black', 'general') } };
  assert.deepEqual(play(withTile, 'i5', 'i5').chases, {});
  const withCapture = { ...state, board: { ...state.board, a3: up('black', 'advisor') } };
  assert.deepEqual(play(withCapture, 'a1', 'a3').chases, {});
  const different = {
    ...state,
    board: { ...state.board, c4: up('black', 'soldier') },
    lastMove: move('d4', 'c4'),
  };
  assert.equal(play(different, 'a1', 'c1').chases.red?.count, 1);
});

test('chase detection uses cannon screens and applies equally to the second seat', () => {
  const state = playing(
    { a1: up('black', 'cannon'), b2: down('red', 'general'), b3: up('red', 'soldier') },
    { ply: 1, status: { type: 'playing', turn: 'black' }, lastMove: move('c3', 'b3') },
  );
  assert.equal(play(state, 'a1', 'b1').chases.black?.count, 1);
  const capped = { ...state, chases: { black: { target: 'b3' as const, count: 6 } } };
  assert.ok(!dests(capped, 'a1').includes('b1'));
});

test('no legal move loses, and flips keep a blocked player able to act', () => {
  const blocked: Board = {
    a1: up('red', 'elephant'),
    c3: up('red', 'elephant'),
    e1: up('red', 'elephant'),
    e5: up('red', 'elephant'),
    g3: up('red', 'elephant'),
    i1: up('red', 'elephant'),
    i5: up('red', 'elephant'),
    a5: up('red', 'elephant'),
    i2: up('black', 'soldier'),
  };
  const state = playing(blocked);
  assert.deepEqual(game.getThreeKingdomsBanqiLegalMoves(state), []);
  assert.deepEqual(game.getThreeKingdomsBanqiResult(state), {
    type: 'finished',
    winner: 'black',
    reason: 'no-legal-move',
  });
  assert.equal(
    game.getThreeKingdomsBanqiResult({
      ...state,
      board: { ...blocked, h4: down('black', 'general') },
    }).type,
    'playing',
  );
  // The same loss is adjudicated after the other seat's preceding move.
  const before = playing(
    { ...blocked, i2: undefined, h2: up('black', 'soldier') },
    { ply: 1, status: { type: 'playing', turn: 'black' } },
  );
  assert.deepEqual(play(before, 'h2', 'i2').status, {
    type: 'finished',
    winner: 'black',
    reason: 'no-legal-move',
  });
});

test('losing the last piece loses, but unrevealed material prevents premature elimination', () => {
  const state = playing({ a1: up('red', 'soldier'), a2: up('black', 'soldier') });
  assert.deepEqual(play(state, 'a1', 'a2').status, {
    type: 'finished',
    winner: 'red',
    reason: 'no-pieces',
  });
  const hidden = { ...state, board: { ...state.board, i5: down('red', 'general') } };
  assert.equal(play(hidden, 'a1', 'a2').status.type, 'playing');
});

test('illegal moves do not mutate state and legal apply preserves previous states', () => {
  const state = playing({ a1: up('red', 'soldier'), i5: up('black', 'soldier') });
  const serialized = JSON.stringify(state);
  assert.equal(game.applyThreeKingdomsBanqiMove(state, move('a1', 'c1')), state);
  const next = play(state, 'a1', 'b1');
  next.board.b1!.role = 'general';
  next.scores.red = 50;
  assert.equal(JSON.stringify(state), serialized);
});

test('whole player views and public serialization never expose hidden identity before, after flips or at game end', () => {
  let state = game.createInitialThreeKingdomsBanqiState('secret', 628);
  for (let step = 0; step < 3; step += 1) {
    if (step === 1) state = play(state, 'a1', 'a1');
    if (step === 2)
      state = {
        ...state,
        status: { type: 'finished', winner: 'red', reason: 'score' },
        scores: { red: 100, black: 0 },
      };
    // Swap every remaining identity, keeping revealed information unchanged.
    const swapped: State = { ...state, board: { ...state.board } };
    const hidden = game.ALL_THREE_KINGDOMS_BANQI_SQUARES.filter(
      (square) => state.board[square]?.faceDown,
    );
    hidden.forEach((square, i) => {
      swapped.board[square] = { ...state.board[hidden[(i + 1) % hidden.length]]! };
    });
    for (const seat of ['red', 'black'] as const) {
      const view = game.getThreeKingdomsBanqiPlayerView(state, seat);
      const payload = JSON.stringify(view);
      assert.equal(payload, JSON.stringify(game.getThreeKingdomsBanqiPlayerView(swapped, seat)));
      for (const square of hidden)
        assert.deepEqual(JSON.parse(payload).board[square], { faceDown: true });
      for (const forbidden of ['chases', 'seed', 'deal', 'hidden'])
        assert.ok(!(forbidden in JSON.parse(payload)));
      assert.ok(
        view.legalMoves.every((entry) => Object.keys(entry).sort().join(',') === 'from,to'),
      );
      if (step === 0) {
        assert.ok(!payload.includes('"role"'));
        assert.ok(!payload.includes('"color"'));
      }
      if (step === 1)
        assert.equal(
          Object.values(view.board).filter((entry) => entry && 'role' in entry).length,
          1,
        );
    }
    assert.equal(
      game.threeKingdomsBanqiStateToFen(state),
      game.threeKingdomsBanqiStateToFen(swapped),
    );
  }
});

test('public FEN-like snapshot masks tiles and records binding, seat scores and clock', () => {
  const state = game.createInitialThreeKingdomsBanqiState('fen', 628);
  assert.equal(
    game.threeKingdomsBanqiStateToFen(state),
    'XXXX1XXXX/XXXX1XXXX/9/XXXX1XXXX/XXXX1XXXX r - 0 0 0 1',
  );
  const view = game.getThreeKingdomsBanqiPlayerView(state, 'red');
  view.board.a1 = up('red', 'general') as game.BanqiVisibleBoardEntry;
  assert.equal(state.board.a1?.faceDown, true);
  const exposed = playing(
    { a1: up('red', 'general'), i5: up('black', 'chariot'), b2: down('black', 'horse') },
    { firstColor: 'black', ply: 1, scores: { red: 20, black: 15 }, noProgressClock: 12 },
  );
  assert.equal(game.threeKingdomsBanqiStateToFen(exposed), '8r/9/9/1X7/G8 b b 20 15 12 1');
});
