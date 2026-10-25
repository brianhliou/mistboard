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

test('100 points ends play immediately with pieces still present, ahead of no-progress settlement', () => {
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
  assert.deepEqual(
    game.getThreeKingdomsBanqiResult({
      ...state,
      scores: { red: 100, black: 90 },
      noProgressClock: 40,
    }),
    { type: 'finished', winner: 'red', reason: 'score' },
  );
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

const key = (state: State) => game.threeKingdomsBanqiPositionKey(state);
const forbidden = (state: State) =>
  game
    .getThreeKingdomsBanqiForbiddenChaseMoves(state)
    .map((m) => `${m.from}${m.to}`)
    .sort();
/** The position `from`-`to` would reach, for presetting its repetition count. */
function keyAfter(state: State, from: Square, to: Square): string {
  const board = { ...state.board, [to]: state.board[from] };
  delete board[from];
  return key({ ...state, board, ply: state.ply + 1 });
}

// Red chariot a1 chases the black soldier b2 round a 2x2 block; the black general
// on i5 never moves, so red always has other moves and the cycle is real play.
function chaseCycle(): State {
  return playing(
    { a1: up('red', 'chariot'), b2: up('black', 'soldier'), i5: up('black', 'general') },
    { lastMove: move('c2', 'b2') },
  );
}
const CHASES: readonly (readonly [Square, Square])[] = [
  ['a1', 'b1'],
  ['b1', 'a1'],
];
const FLEES: readonly (readonly [Square, Square])[] = [
  ['b2', 'a2'],
  ['a2', 'b2'],
];

test('a cycling chase is refused when it would make its position appear a third time', () => {
  let state = chaseCycle();
  for (let lap = 0; lap < 2; lap += 1) {
    for (let i = 0; i < 2; i += 1) {
      const [from, to] = CHASES[i];
      assert.ok(dests(state, from).includes(to), `lap ${lap} chase ${from}${to} is legal`);
      state = play(state, from, to);
      assert.equal(state.chasedSquare, FLEES[i][0], 'the chase targets the soldier');
      assert.equal(state.repCounts[key(state)], lap + 1);
      state = play(state, FLEES[i][0], FLEES[i][1]);
      assert.equal(state.chasedSquare, undefined, 'a flee to a2/b2 threatens nothing');
    }
  }
  // Third time round: a1b1 would reach its position a third time.
  assert.equal(state.repCounts[keyAfter(state, 'a1', 'b1')], 2);
  assert.deepEqual(forbidden(state), ['a1b1']);
  assert.ok(!dests(state, 'a1').includes('b1'));
  assert.equal(game.applyThreeKingdomsBanqiMove(state, move('a1', 'b1')), state);
  // Red keeps every non-chasing move, and the game is still on (no repetition draw).
  assert.ok(dests(state, 'a1').includes('a3'));
  assert.deepEqual(state.status, { type: 'playing', turn: 'red' });
});

test('the chase restriction never limits the defender: a flee is legal at any count', () => {
  let state = play(chaseCycle(), 'a1', 'b1');
  // Even with the flee's position already seen twice, black may flee into it,
  // and the third occurrence does not end the game.
  state = { ...state, repCounts: { ...state.repCounts, [keyAfter(state, 'b2', 'a2')]: 2 } };
  assert.deepEqual(forbidden(state), []);
  assert.ok(dests(state, 'b2').includes('a2'));
  const fled = play(state, 'b2', 'a2');
  assert.equal(fled.repCounts[key(fled)], 3);
  assert.deepEqual(fled.status, { type: 'playing', turn: 'red' });
});

test('an ordinary repetition does not end the game; only the 40-ply count does', () => {
  // Two quiet pieces far apart shuffle back and forth: no move is a chase.
  let state = playing({ a1: up('red', 'soldier'), i5: up('black', 'soldier') });
  const cycle = [move('a1', 'b1'), move('i5', 'h5'), move('b1', 'a1'), move('h5', 'i5')];
  for (let ply = 0; ply < 39; ply += 1) {
    state = play(state, cycle[ply % 4].from, cycle[ply % 4].to);
    assert.equal(state.status.type, 'playing');
  }
  assert.equal(state.repCounts[key(state)], 10);
  state = play(state, cycle[39 % 4].from, cycle[39 % 4].to);
  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'no-progress' });
});

test('a mutual chase (一捉一) is an ordinary move and never restricted', () => {
  // Chariots on one rank attack each other. Each move steps along the rank,
  // fleeing the chariot that just moved and attacking it again.
  let state = playing(
    { a1: up('red', 'chariot'), i1: up('black', 'chariot'), e5: up('red', 'soldier') },
    { lastMove: move('i2', 'i1'), chasedSquare: 'a1' },
  );
  const cycle = [move('a1', 'b1'), move('i1', 'h1'), move('b1', 'a1'), move('h1', 'i1')];
  for (let ply = 0; ply < 16; ply += 1) {
    assert.deepEqual(forbidden(state), [], `ply ${ply}`);
    state = play(state, cycle[ply % 4].from, cycle[ply % 4].to);
    assert.ok(state.chasedSquare, 'every move also chases');
  }
  assert.equal(state.repCounts[key(state)], 4);
  assert.deepEqual(state.status, { type: 'playing', turn: 'red' });
});

test('a chase that herds its target onto new squares is never limited', () => {
  // The soldier runs along rank 5 and the chariot follows on rank 1: eight chases
  // in a row, past the old six-chase cap, and every position is new.
  let state = playing(
    { a1: up('red', 'chariot'), b5: up('black', 'soldier') },
    { lastMove: move('c5', 'b5') },
  );
  const files = 'abcdefghi';
  for (let i = 1; i < files.length; i += 1) {
    assert.deepEqual(forbidden(state), []);
    state = play(state, `${files[i - 1]}1` as Square, `${files[i]}1` as Square);
    assert.equal(state.chasedSquare, `${files[i]}5`, `chase ${i}`);
    assert.equal(state.repCounts[key(state)], 1);
    if (i + 1 < files.length)
      state = play(state, `${files[i]}5` as Square, `${files[i + 1]}5` as Square);
  }
  assert.equal(state.ply, 15);
});

test('the only-legal-move exception keeps a forbidden chase legal', () => {
  // Red's elephants are locked on their own lattice; the soldier on b1 has two
  // moves, c1 and b2, and both chase the black chariot that just reached c2.
  const board: Board = {
    a1: up('red', 'elephant'),
    c3: up('red', 'elephant'),
    e1: up('red', 'elephant'),
    e5: up('red', 'elephant'),
    g3: up('red', 'elephant'),
    i1: up('red', 'elephant'),
    i5: up('red', 'elephant'),
    a5: up('red', 'elephant'),
    b1: up('red', 'soldier'),
    c2: up('black', 'chariot'),
  };
  const base = playing(board, { lastMove: move('d2', 'c2') });
  assert.deepEqual(dests(base, 'b1'), ['b2', 'c1']);
  const one = { ...base, repCounts: { [keyAfter(base, 'b1', 'c1')]: 2 } };
  assert.deepEqual(forbidden(one), ['b1c1']);
  assert.deepEqual(dests(one, 'b1'), ['b2']);
  const both = {
    ...base,
    repCounts: { [keyAfter(base, 'b1', 'c1')]: 2, [keyAfter(base, 'b1', 'b2')]: 2 },
  };
  // Refusing both would leave red with no move; the rule limits, it never loses.
  assert.deepEqual(forbidden(both), []);
  assert.deepEqual(dests(both, 'b1'), ['b2', 'c1']);
  assert.equal(play(both, 'b1', 'c1').repCounts[keyAfter(base, 'b1', 'c1')], 3);
  // A face-down tile anywhere is a flip, which counts as another legal move.
  const tiled = playing({ ...board, h4: down('black', 'horse') }, { lastMove: move('d2', 'c2') });
  const withTile = {
    ...tiled,
    repCounts: { [keyAfter(tiled, 'b1', 'c1')]: 2, [keyAfter(tiled, 'b1', 'b2')]: 2 },
  };
  assert.deepEqual(forbidden(withTile), ['b1b2', 'b1c1']);
  assert.deepEqual(game.getThreeKingdomsBanqiLegalMoves(withTile), [move('h4', 'h4')]);
});

test('chase detection uses cannon screens and applies equally to the second seat', () => {
  const state = playing(
    { a1: up('black', 'cannon'), b2: down('red', 'general'), b3: up('red', 'soldier') },
    { ply: 1, status: { type: 'playing', turn: 'black' }, lastMove: move('c3', 'b3') },
  );
  assert.equal(play(state, 'a1', 'b1').chasedSquare, 'b3');
  const seen = { ...state, repCounts: { [keyAfter(state, 'a1', 'b1')]: 2 } };
  assert.deepEqual(forbidden(seen), ['a1b1']);
});

test('a flip or capture restarts the repetition count and clears the chase', () => {
  let state = chaseCycle();
  state = play(state, 'a1', 'b1');
  assert.equal(state.chasedSquare, 'b2');
  const withTile = { ...state, board: { ...state.board, h4: down('black', 'horse') } };
  const flipped = play(withTile, 'h4', 'h4');
  assert.equal(flipped.chasedSquare, undefined);
  assert.deepEqual(flipped.repCounts, { [key(flipped)]: 1 });
  const captured = play({ ...state, ply: 1 }, 'b2', 'b1');
  assert.deepEqual(captured.repCounts, { [key(captured)]: 1 });
  assert.equal(captured.chasedSquare, undefined);
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

test('wipe-out cannot happen: capturing a side always reaches 100 before its last piece', () => {
  const values = Object.entries(game.BANQI_PIECE_COUNTS)
    .flatMap(([role, count]) =>
      Array<number>(count).fill(game.THREE_KINGDOMS_BANQI_POINTS[role as game.BanqiPieceRole]),
    )
    .sort((a, b) => a - b);
  assert.equal(values.length, 16);
  assert.equal(
    values.reduce((sum, value) => sum + value, 0),
    135,
  );
  // The slowest route to 100 takes the cheapest pieces first. Even then the
  // fourteenth capture reaches it, so a side's sixteenth piece is never taken.
  let sum = 0;
  let crossing = 0;
  for (const [i, value] of values.entries()) {
    sum += value;
    if (sum >= game.THREE_KINGDOMS_BANQI_SCORE_TARGET) {
      crossing = i + 1;
      break;
    }
  }
  assert.equal(crossing, 14);
  assert.ok(crossing < values.length);
  // Played out: red has taken black's thirteen cheapest pieces (85 points) and
  // takes a chariot; the game ends on score with black's chariot and general left.
  const state = playing(
    {
      a1: up('red', 'chariot'),
      a3: up('black', 'chariot'),
      i3: up('black', 'chariot'),
      i5: up('black', 'general'),
    },
    {
      scores: { red: 85, black: 0 },
      captures: values.slice(0, 13).map((value) => ({
        owner: 'black' as const,
        role: (Object.keys(game.THREE_KINGDOMS_BANQI_POINTS) as game.BanqiPieceRole[]).find(
          (role) => game.THREE_KINGDOMS_BANQI_POINTS[role] === value,
        )!,
      })),
    },
  );
  const next = play(state, 'a1', 'a3');
  assert.deepEqual(next.status, { type: 'finished', winner: 'red', reason: 'score' });
  assert.ok(next.board.i3 && next.board.i5);
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
      for (const field of ['repCounts', 'chasedSquare', 'seed', 'deal', 'hidden'])
        assert.ok(!(field in JSON.parse(payload)));
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
