// Repetition keys must name every piece type distinctly. The xiangqi key used
// to label a piece by the first letter of its role, so the chariot and the
// cannon were both `c` (and in chess the king and the knight were both `k`).
// Two positions in which a same-coloured chariot and cannon had traded squares
// shared a key, and the threefold-repetition draw fired on positions that had
// not repeated.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialDuckXiangqiState,
  createInitialXiangqiState,
  darkChessVariant,
  duckXiangqiPositionRepetitionKey,
  type GameState,
  isStandardXiangqiLegalMove,
  legacyPositionRepetitionKey,
  type Move,
  positionRepetitionKey,
  type XiangqiGameState,
  type XiangqiMove,
} from './index.js';
import {
  benedictXiangqiPositionRepetitionKey,
  createInitialBenedictXiangqiState,
} from './variants-benedict-xiangqi.js';
import { applyMove as applyFogXiangqiMove } from './variants-xiangqi.js';

const m = (from: string, to: string) => ({ from, to }) as XiangqiMove;

// From the opening position, red walks the a1 chariot to b3 and the b3 cannon
// to a1 in five moves while black's a10 chariot goes round a five-move loop
// home. The result (S') is the opening position with red's left chariot and
// cannon swapped, red to move. Then one horse shuffle each brings S' back.
//
// True counts: opening position once, S' twice. No position has occurred
// three times, so the game must go on.
const SWAP_THEN_SHUFFLE: XiangqiMove[] = [
  m('b3', 'a3'), // cannon steps aside
  m('a10', 'a9'),
  m('a1', 'a2'), // chariot up
  m('a9', 'a10'),
  m('a2', 'b2'), // chariot across
  m('a10', 'a8'),
  m('b2', 'b3'), // chariot onto the cannon's old square
  m('a8', 'a9'),
  m('a3', 'a1'), // cannon onto the chariot's old square: S', black to move
  m('a9', 'a10'), // S', red to move
  m('h1', 'g3'),
  m('h10', 'g8'),
  m('g3', 'h1'),
  m('g8', 'h10'), // S' again, red to move
];

function play(
  start: XiangqiGameState,
  apply: (state: XiangqiGameState, move: XiangqiMove) => XiangqiGameState,
): XiangqiGameState {
  let state = start;
  for (const [i, move] of SWAP_THEN_SHUFFLE.entries()) {
    assert.equal(state.status.type, 'playing', `game ended before ply ${i + 1}`);
    state = apply(state, move);
  }
  return state;
}

test('xiangqi: a chariot and cannon swapping squares is not a repetition', () => {
  const start = createInitialXiangqiState('swap');
  const end = play(start, (state, move) => {
    assert.ok(isStandardXiangqiLegalMove(state, move), `${move.from}-${move.to} is legal`);
    return applyStandardXiangqiMove(state, move);
  });
  assert.deepEqual(end.status, { type: 'playing', turn: 'red' });

  // The two positions really are different, and the key says so.
  assert.equal(end.board.a1?.role, 'cannon');
  assert.equal(end.board.b3?.role, 'chariot');
  assert.equal(start.board.a1?.role, 'chariot');
  assert.equal(start.board.b3?.role, 'cannon');
  assert.notEqual(positionRepetitionKey(end), positionRepetitionKey(start));
  assert.equal(end.positionCounts[positionRepetitionKey(end)], 2);
  assert.equal(end.positionCounts[positionRepetitionKey(start)], 1);
});

test('xiangqi: the swapped position still draws when it truly occurs a third time', () => {
  let state = play(createInitialXiangqiState('swap-real'), applyStandardXiangqiMove);
  for (const move of [m('h1', 'g3'), m('h10', 'g8'), m('g3', 'h1'), m('g8', 'h10')]) {
    state = applyStandardXiangqiMove(state, move);
  }
  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'repetition' });
});

test('fog xiangqi: a chariot and cannon swapping squares is not a repetition', () => {
  const end = play(createInitialXiangqiState('fog-swap'), (state, move) =>
    applyFogXiangqiMove(state, move),
  );
  assert.deepEqual(end.status, { type: 'playing', turn: 'red' });
});

test('xiangqi family keys give every role its own label', () => {
  const xq = createInitialXiangqiState('key');
  const xqSwapped: XiangqiGameState = {
    ...xq,
    board: { ...xq.board, a1: xq.board.b3, b3: xq.board.a1 },
  };
  assert.notEqual(positionRepetitionKey(xqSwapped), positionRepetitionKey(xq));

  const duck = createInitialDuckXiangqiState('key');
  const duckSwapped = { ...duck, board: { ...duck.board, a1: duck.board.b3, b3: duck.board.a1 } };
  assert.notEqual(
    duckXiangqiPositionRepetitionKey(duckSwapped),
    duckXiangqiPositionRepetitionKey(duck),
  );

  const benedict = createInitialBenedictXiangqiState('key');
  const benedictSwapped = {
    ...benedict,
    board: { ...benedict.board, a1: benedict.board.b3, b3: benedict.board.a1 },
  };
  assert.notEqual(
    benedictXiangqiPositionRepetitionKey(benedictSwapped),
    benedictXiangqiPositionRepetitionKey(benedict),
  );
});

// Fog chess: the king and the knight both started with `k`. White walks its
// king from e2 to g1 and its g1 knight round to e2 (they trade squares) while
// black's queen goes round a triangle and its g8 knight out and back. Then one
// b1 knight shuffle each repeats the swapped position once more.
test('fog chess: a king and knight swapping squares is not a repetition', () => {
  const moves: Array<[string, string]> = [
    ['e2', 'e4'],
    ['e7', 'e5'],
    ['f1', 'c4'],
    ['f8', 'c5'],
    ['e1', 'e2'],
    ['b8', 'c6'], // A: Ke2, Ng1, white to move
    ['g1', 'h3'],
    ['d8', 'e7'],
    ['h3', 'f4'],
    ['e7', 'f6'],
    ['e2', 'f1'],
    ['f6', 'd8'],
    ['f1', 'g1'],
    ['g8', 'f6'],
    ['f4', 'e2'],
    ['f6', 'g8'], // B: Kg1, Ne2, white to move
    ['b1', 'c3'],
    ['g8', 'h6'],
    ['c3', 'b1'],
    ['h6', 'g8'], // B again
  ];
  let state: GameState = darkChessVariant.createInitialState('fog-chess-swap');
  for (const [i, [from, to]] of moves.entries()) {
    assert.equal(state.status.type, 'playing', `game ended before ply ${i + 1}`);
    state = darkChessVariant.applyMove(state, { from, to } as Move);
    assert.equal(state.lastMove?.from, from, `ply ${i + 1} (${from}-${to}) was applied`);
  }
  assert.equal(state.board.g1?.role, 'king');
  assert.equal(state.board.e2?.role, 'knight');
  assert.deepEqual(state.status, { type: 'playing', turn: 'white' });
});

// Mined-puzzle candidates stored their key in the old spelling. The legacy
// form of a current key must equal what the old code produced, byte for byte.
test('legacyPositionRepetitionKey reproduces the pre-fix spelling', () => {
  const start = createInitialXiangqiState('legacy');
  const oldSpelling =
    'red|a1rc,a10bc,a4rs,a7bs,b1rh,b10bh,b3rc,b8bc,c1re,c10be,c4rs,c7bs,d1ra,d10ba,e1rg,e10bg,e4rs,e7bs,f1ra,f10ba,g1re,g10be,g4rs,g7bs,h1rh,h10bh,h3rc,h8bc,i1rc,i10bc,i4rs,i7bs';
  assert.equal(legacyPositionRepetitionKey(positionRepetitionKey(start)), oldSpelling);
  assert.equal(legacyPositionRepetitionKey(oldSpelling), oldSpelling);
});
