// Rule probes ported from jqe's native rules and repetition tests
// (github.com/devinokeefe/jieqi, tests/native/rules_test.cpp and
// repetition_test.cpp, MIT, commit 331a6e61). Their squares are
// Pikafish's (ranks 0-9); ours count from 1, so every rank is shifted by one.
// Their 80-ply no-capture draw is our 120 (DEFAULT_NO_CAPTURE_PLY_LIMIT).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyJieqiMove,
  createInitialJieqiState,
  DEFAULT_NO_CAPTURE_PLY_LIMIT,
  getJieqiLegalMoves,
  isJieqiLegalMove,
  isJieqiSideToMoveInCheck,
  type JieqiBoard,
  type JieqiColor,
  type JieqiGameState,
  type JieqiPiece,
  type JieqiPieceRole,
  type JieqiSquare,
  jieqiPerpetualCheckLoser,
  jieqiPositionKey,
  jieqiStartingRole,
  STANDARD_JIEQI_DEAL,
} from './variants-jieqi.js';

const ROLES: Record<string, JieqiPieceRole> = {
  k: 'general',
  a: 'advisor',
  b: 'elephant',
  n: 'horse',
  r: 'chariot',
  c: 'cannon',
  p: 'soldier',
};

// Pikafish square ('e0') to ours ('e1').
function sq(point: string): JieqiSquare {
  return `${point[0]}${Number(point.slice(1)) + 1}` as JieqiSquare;
}

// jqe's piece codes: upper case red, lower case black, X/x face-down. A
// face-down piece moves as its home square's role; `hidden` sets its true one.
function piece(code: string, square: JieqiSquare, hidden?: JieqiPieceRole): JieqiPiece {
  const color: JieqiColor = code === code.toUpperCase() ? 'red' : 'black';
  if (code.toLowerCase() === 'x') {
    const role = hidden ?? jieqiStartingRole(square);
    assert.ok(role, `face-down piece off a home square: ${square}`);
    return { color, role, faceDown: true };
  }
  const role = ROLES[code.toLowerCase()];
  assert.ok(role, `unknown piece code ${code}`);
  return { color, role, faceDown: false };
}

// jqe's fixture(): red general e0, black general d9, plus extras ('.' clears).
function pos(
  extras: Record<string, string> = {},
  turn: JieqiColor = 'red',
  noCaptureClock = 0,
  hidden: Record<string, JieqiPieceRole> = {},
): JieqiGameState {
  const board: JieqiBoard = { [sq('e0')]: piece('K', sq('e0')), [sq('d9')]: piece('k', sq('d9')) };
  for (const [point, code] of Object.entries(extras)) {
    if (code === '.') delete board[sq(point)];
    else board[sq(point)] = piece(code, sq(point), hidden[point]);
  }
  return {
    id: 'jqe-fixture',
    board,
    status: { type: 'playing', turn },
    moveNumber: 1,
    noCaptureClock,
    captures: [],
  };
}

function legal(state: JieqiGameState, uci: string): boolean {
  return isJieqiLegalMove(state, { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)) });
}

function play(state: JieqiGameState, uci: string): JieqiGameState {
  const next = applyJieqiMove(state, { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)) });
  assert.notEqual(next, state, `move ${uci} was refused`);
  return next;
}

function inCheck(state: JieqiGameState, color: JieqiColor): boolean {
  return isJieqiSideToMoveInCheck({ ...state, status: { type: 'playing', turn: color } });
}

test('jqe: initial legal-move counts, face-down 44 and face-up 46', () => {
  assert.equal(getJieqiLegalMoves(createInitialJieqiState('jqe-dark')).length, 44);
  const bright = createInitialJieqiState('jqe-bright', STANDARD_JIEQI_DEAL);
  for (const p of Object.values(bright.board)) if (p) p.faceDown = false;
  // A revealed advisor leaves the palace, so c1 and g1 (our c2, g2) are added.
  assert.equal(getJieqiLegalMoves(bright).length, 46);
});

test('jqe: chariot, cannon, horse, elephant and advisor movement', () => {
  const rook = pos({ a4: 'R', a6: 'P', a2: 'c' });
  assert.ok(legal(rook, 'a4a5') && legal(rook, 'a4a2'));
  for (const m of ['a4a6', 'a4a7', 'a4a1', 'a4b5']) assert.ok(!legal(rook, m), m);

  const cannon = pos({ a4: 'C', a5: 'P', a7: 'n', b4: 'p' });
  assert.ok(legal(cannon, 'a4a7') && legal(cannon, 'a4a3'));
  assert.ok(!legal(cannon, 'a4a6') && !legal(cannon, 'a4b4'));
  assert.ok(!legal(pos({ a4: 'C', a5: 'P', a6: 'p', a7: 'n' }), 'a4a7'), 'two screens');

  const horse = pos({ c4: 'N', d4: 'P' });
  assert.ok(!legal(horse, 'c4e5') && !legal(horse, 'c4e3'), 'horse leg');
  assert.ok(legal(horse, 'c4b6') && !legal(horse, 'c4d5'));
  assert.ok(!legal(pos({ c4: 'N', c5: 'p' }), 'c4b6'), 'enemy piece blocks the leg');

  assert.ok(legal(pos({ c4: 'B' }), 'c4e6'), 'revealed elephant crosses the river');
  assert.ok(!legal(pos({ c4: 'B', d5: 'P' }), 'c4e6'), 'elephant eye');
  assert.ok(legal(pos({ a4: 'A' }), 'a4b5'), 'revealed advisor outside the palace');
  assert.ok(!legal(pos({ a4: 'A' }), 'a4c6'), 'advisor steps one point');

  const advisor = pos({ d0: 'X' });
  assert.ok(
    legal(advisor, 'd0e1') && !legal(advisor, 'd0c1'),
    'face-down advisor stays in the palace',
  );
  assert.ok(legal(pos({ c0: 'X' }), 'c0e2'), 'face-down elephant');
  assert.ok(!legal(pos({ c0: 'X', d1: 'P' }), 'c0e2'), 'face-down elephant eye');
  assert.ok(legal(pos({ b0: 'X' }), 'b0c2'), 'face-down horse');
  assert.ok(!legal(pos({ b0: 'X', b1: 'P' }), 'b0c2'), 'face-down horse leg');
});

test('jqe: soldiers on every rank band, both colours', () => {
  assert.ok(
    legal(pos({ b0: 'P' }), 'b0b1') && !legal(pos({ b0: 'P' }), 'b0a0'),
    'red on its own back rank',
  );
  assert.ok(
    legal(pos({ b4: 'P' }), 'b4b5') && !legal(pos({ b4: 'P' }), 'b4a4'),
    'red before the river',
  );
  const crossed = pos({ b5: 'P' });
  assert.ok(legal(crossed, 'b5a5') && legal(crossed, 'b5c5') && legal(crossed, 'b5b6'));
  assert.ok(!legal(crossed, 'b5b4'), 'never backwards');
  assert.ok(legal(pos({ b9: 'P' }), 'b9a9'), 'red on the far back rank moves sideways');
  const black = (point: string) => pos({ [point]: 'p' }, 'black');
  assert.ok(
    legal(black('b9'), 'b9b8') && !legal(black('b9'), 'b9a9'),
    'black on its own back rank',
  );
  assert.ok(legal(black('b5'), 'b5b4') && !legal(black('b5'), 'b5a5'), 'black before the river');
  assert.ok(
    legal(black('b4'), 'b4a4') && legal(black('b4'), 'b4b3') && !legal(black('b4'), 'b4b5'),
  );
  assert.ok(legal(black('b0'), 'b0a0'), 'black on the far back rank moves sideways');
});

test('jqe: generals, flying general, cannon screens, check after a reveal', () => {
  const kings = pos();
  assert.ok(legal(kings, 'e0f0') && legal(kings, 'e0e1'));
  for (const m of ['e0g0', 'e0f1', 'e0d0']) assert.ok(!legal(kings, m), m);

  const pinned = pos({ d9: '.', e9: 'k', e4: 'R' });
  assert.ok(!legal(pinned, 'e4f4') && legal(pinned, 'e4e5'), 'flying-general pin');
  // jqe also forbids e4e9, capturing the general. Our kernel allows it and
  // scores it a win; the position (side to move already giving check) is
  // unreachable from legal play, so the difference never decides a game.
  assert.ok(legal(pinned, 'e4e9'));

  assert.ok(inCheck(pos({ e7: 'c', e3: 'P' }), 'red'), 'cannon checks over one screen');
  assert.ok(!inCheck(pos({ e7: 'c' }), 'red'), 'no screen, no check');
  assert.ok(!inCheck(pos({ e7: 'c', e3: 'P', e2: 'P' }), 'red'), 'two screens, no check');

  // A face-down cannon (home b2) moves as a cannon; whether it then gives check
  // depends on what it turns out to be.
  assert.ok(legal(pos({ b2: 'X' }), 'b2d2'));
  const asRook = play(pos({ b2: 'X' }, 'red', 0, { b2: 'chariot' }), 'b2d2');
  const asHorse = play(pos({ b2: 'X' }, 'red', 0, { b2: 'horse' }), 'b2d2');
  assert.ok(
    isJieqiSideToMoveInCheck(asRook) && !isJieqiSideToMoveInCheck(asHorse),
    'check after the reveal',
  );
  assert.equal(asRook.board[sq('d2')]?.faceDown, false, 'the moved piece is face up');

  assert.ok(!legal(pos({ e4: 'r', a0: 'R' }), 'a0a1'), 'a move that ignores check is illegal');
});

test('jqe: mate and stalemate outrank the no-capture draw; reveals do not reset it', () => {
  const limit = DEFAULT_NO_CAPTURE_PLY_LIMIT;
  // jqe builds the terminal position directly; our kernel scores a position
  // when the move into it is played, so each one is reached by a last move.
  // Black chariots d1/f1 stalemate the red general on e0 (kernel ranks d2/f2).
  const stalemate = play(pos({ d1: 'r', f2: 'r' }, 'black', limit - 1), 'f2f1');
  assert.deepEqual(stalemate.status, { type: 'finished', winner: 'black', reason: 'stalemate' });
  const mate = play(pos({ d1: 'r', f1: 'r', h2: 'r' }, 'black', limit - 1), 'h2e2');
  assert.deepEqual(mate.status, { type: 'finished', winner: 'black', reason: 'checkmate' });

  const quiet = play(pos({ a4: 'R' }, 'red', limit - 2), 'a4a5');
  assert.deepEqual(quiet.status, { type: 'playing', turn: 'black' }, 'one ply short of the limit');
  const reveal = play(pos({ a3: 'X' }, 'red', limit - 1, { a3: 'soldier' }), 'a3a4');
  assert.equal(reveal.noCaptureClock, limit, 'a reveal and a soldier step do not reset the clock');
  assert.deepEqual(reveal.status, { type: 'finished', winner: null, reason: 'no-capture-clock' });

  const capture = play(pos({ a4: 'R', a5: 'p' }, 'red', limit - 1), 'a4a5');
  assert.equal(capture.noCaptureClock, 0, 'a capture resets the clock');
  assert.deepEqual(capture.status, { type: 'playing', turn: 'black' });

  assert.deepEqual(
    play(pos(), 'e0e1').status,
    { type: 'playing', turn: 'black' },
    'bare generals play on',
  );
});

test('jqe: generals-only tree is 1, 2, 3 at depths 0 to 2', () => {
  const kings = pos();
  const first = getJieqiLegalMoves(kings);
  assert.equal(first.length, 2);
  const second = first.flatMap((m) => getJieqiLegalMoves(applyJieqiMove(kings, m)));
  assert.equal(second.length, 3);
});

// Threefold tracking on, as live games since 2026-10 run it.
function tracked(state: JieqiGameState): JieqiGameState {
  const turn = state.status.type === 'playing' ? state.status.turn : 'red';
  const key = jieqiPositionKey(state.board, turn);
  return { ...state, positionCounts: { [key]: 1 }, repetitionLog: [{ key }] };
}

function playAll(state: JieqiGameState, moves: string[]): JieqiGameState {
  return moves.reduce(play, state);
}

test('jqe: a twofold plays on, a threefold of quiet moves draws', () => {
  const cycle = ['e0f0', 'd9d8', 'f0e0', 'd8d9'];
  const twice = playAll(tracked(pos()), cycle);
  assert.equal(twice.status.type, 'playing');
  const thrice = playAll(twice, cycle);
  assert.deepEqual(thrice.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.equal(jieqiPerpetualCheckLoser(thrice), null);
});

test('jqe: perpetual check loses, and outranks the no-capture clock', () => {
  const limit = DEFAULT_NO_CAPTURE_PLY_LIMIT;
  const start = tracked(pos({ e0: '.', d0: 'K', d9: '.', e9: 'k', e7: 'R' }, 'black', limit - 8));
  const cycle = ['e9f9', 'e7f7', 'f9e9', 'f7e7'];
  const end = playAll(start, [...cycle, ...cycle]);
  assert.equal(end.noCaptureClock, limit);
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.equal(jieqiPerpetualCheckLoser(end), 'red');
});

// The repeated position stands at plies 1, 5 and 9. Red checks on both of its
// moves in 5..9 but moved quietly in 1..5. jqe (after Pikafish's rule_judge)
// judges the whole stretch from the first occurrence and draws. Our kernel
// judges only the last cycle, so red loses; xiangqiPerpetualCheckLoser
// (variants-xiangqi-standard.ts) does the same. Pinned as current behaviour.
test('jqe: uneven cycles, red checks only in the last one', () => {
  const start = tracked(pos({ e0: '.', d0: 'K', d9: '.', e9: 'k', e7: 'R' }, 'black'));
  const end = playAll(start, [
    'e9f9',
    'e7e6',
    'f9f8',
    'e6e7',
    'f8f9',
    'e7f7',
    'f9e9',
    'f7e7',
    'e9f9',
  ]);
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.equal(jieqiPerpetualCheckLoser(end), 'red', 'jqe would draw this');
});
