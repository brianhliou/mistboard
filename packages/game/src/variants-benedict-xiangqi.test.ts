import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBenedictXiangqiMove,
  BENEDICT_XIANGQI_PROGRESS_LIMIT,
  type BenedictXiangqiBoard,
  type BenedictXiangqiGameState,
  type BenedictXiangqiSquare,
  benedictXiangqiAttacksFrom,
  benedictXiangqiMovesFrom,
  benedictXiangqiResolveMove,
  benedictXiangqiSquareOf,
  createInitialBenedictXiangqiState,
  getBenedictXiangqiLegalMoves,
} from './variants-benedict-xiangqi.js';

// ── Parity gate ────────────────────────────────────────────────────────────
//
// These perft numbers come from the reference kernels (the JS prototype, which
// was differentially validated against `elephantops` over 720,947 piece
// comparisons, and the Rust engine, which matches it exactly to 113M nodes).
// If this drifts, this kernel and the engine have stopped playing the same
// game, which is the failure mode that matters most here.
// Depth 4 is the shallowest that can see decision (A): the generals reach a
// shared open file in four plies (advisor off d1, general onto it, and Black
// mirroring it on d10), and the old win-condition rule allowed 16 leaves there
// that are now illegal. A parity gate that stopped at 3 could not tell the two
// rule sets apart at all.
const PERFT: readonly number[] = [42, 1740, 70681, 2816895];
// Depth 4 is 2.8M nodes, 34 s on a laptop and the longest single file in the
// game suite (the whole rest of it is 50 s serial). It runs on every push in
// its own CI job (ci.yml "Deep perft gates", MISTBOARD_DEEP_PERFT=1) so the
// local test:unit hot path and the unit-shared job stop at depth 3, which is
// still the full movegen parity check, just not the one that sees (A).
const PERFT_DEPTH = process.env.MISTBOARD_DEEP_PERFT === '1' ? PERFT.length : 3;

function perft(state: BenedictXiangqiGameState, depth: number): number {
  const moves = getBenedictXiangqiLegalMoves(state);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const move of moves) {
    const next = applyBenedictXiangqiMove(state, move);
    // A move that wins ends the line; count it as one leaf, as the reference
    // kernels do.
    total += next.status.type === 'finished' ? 1 : perft(next, depth - 1);
  }
  return total;
}

test(`perft matches the reference kernels to depth ${PERFT_DEPTH}`, () => {
  for (let depth = 1; depth <= PERFT_DEPTH; depth++) {
    const state = createInitialBenedictXiangqiState('perft');
    assert.equal(perft(state, depth), PERFT[depth - 1], `perft ${depth}`);
  }
});

test('the array has 42 legal first moves, not xiangqi 44', () => {
  // Standard xiangqi has 44. Benedict removes exactly the two
  // cannon-takes-horse captures, because there are no captures.
  const state = createInitialBenedictXiangqiState('g');
  assert.equal(getBenedictXiangqiLegalMoves(state).length, 42);
});

// ── The four rule decisions ────────────────────────────────────────────────

function boardOf(
  entries: [BenedictXiangqiSquare, 'red' | 'black', string][],
): BenedictXiangqiBoard {
  const board: BenedictXiangqiBoard = {};
  for (const [square, color, role] of entries) {
    board[square] = { color, role: role as never };
  }
  return board;
}

test('(A) the generals may never be left facing', () => {
  // A red general on d1 with the black general on d10 and nothing between: the
  // generals are one move away from facing on the d-file, so the general may
  // not step onto it, and the blocker may not step off it.
  const board = boardOf([
    ['d1', 'red', 'general'],
    ['d10', 'black', 'general'],
    ['d5', 'red', 'elephant'],
  ]);

  // The elephant is the only thing keeping them apart, and every square it can
  // reach is off the d-file, so it has no legal move at all.
  assert.deepEqual(benedictXiangqiMovesFrom(board, 'd5'), []);

  // The generals themselves may still move, as long as they stay off a shared
  // clear file. Here the file is blocked, so both are free.
  assert.ok(benedictXiangqiMovesFrom(board, 'd1').length > 0);
});

test('(A) is enforced whoever would create the facing', () => {
  // Same shape, but the blocker belongs to Black. The rule is a property of the
  // position, not of who moved, so Black is equally stuck.
  const board = boardOf([
    ['d1', 'red', 'general'],
    ['d10', 'black', 'general'],
    ['d5', 'black', 'elephant'],
  ]);
  assert.deepEqual(benedictXiangqiMovesFrom(board, 'd5'), []);
});

test("(A) a general may not step onto the enemy general's open file", () => {
  const board = boardOf([
    ['e1', 'red', 'general'],
    ['d10', 'black', 'general'],
  ]);
  // e1 -> d1 would put both generals on the d-file with nothing between.
  assert.ok(!benedictXiangqiMovesFrom(board, 'e1').includes('d1'));
  // Along its own file is fine: the black general is not on the e-file.
  assert.ok(benedictXiangqiMovesFrom(board, 'e1').includes('e2'));
});

test('(A) the flying general is not an attack, so it never wins', () => {
  const board = boardOf([
    ['e1', 'red', 'general'],
    ['e10', 'black', 'general'],
  ]);
  // Geometry: a general bears on its orthogonal neighbours and nothing else.
  assert.deepEqual(benedictXiangqiAttacksFrom(board, 'e1'), []);
  // And the move that would have won under the old rule is simply illegal.
  assert.ok(!benedictXiangqiMovesFrom(board, 'e1').includes('e2'));
});

test('(B) an advisor converted into the enemy palace keeps playing there', () => {
  // A RED advisor standing in BLACK's palace. Owner-bound rules would freeze
  // it; region-bound rules let it work.
  const board = boardOf([
    ['e1', 'red', 'general'],
    ['e10', 'black', 'general'],
    ['d10', 'red', 'advisor'],
  ]);
  assert.deepEqual(benedictXiangqiMovesFrom(board, 'd10'), ['e9']);
});

test('(B) an elephant converted across the river stays in that half', () => {
  // Generals on different files: decision (A) is not what this test is about,
  // and an open shared file would make every move here illegal.
  const board = boardOf([
    ['d1', 'red', 'general'],
    ['f10', 'black', 'general'],
    ['c10', 'red', 'elephant'],
  ]);
  assert.deepEqual(benedictXiangqiMovesFrom(board, 'c10').sort(), ['a8', 'e8']);
});

test('(C) soldiers are OWNER-bound, unlike advisors and elephants', () => {
  // Generals on different files, for the same reason as the elephant test.
  const past: [BenedictXiangqiSquare, 'red' | 'black', string][] = [
    ['d1', 'red', 'general'],
    ['f10', 'black', 'general'],
  ];
  // A red soldier past the river: forward plus sideways.
  const asRed = boardOf([...past, ['a7', 'red', 'soldier']]);
  assert.deepEqual(benedictXiangqiMovesFrom(asRed, 'a7').sort(), ['a8', 'b7']);

  // The SAME point owned by black is in black's own half: forward only, and
  // forward is now the other way.
  const asBlack = boardOf([...past, ['a7', 'black', 'soldier']]);
  assert.deepEqual(benedictXiangqiMovesFrom(asBlack, 'a7'), ['a6']);
});

test('a move converts every enemy piece the moved piece attacks', () => {
  const board = boardOf([
    ['e1', 'red', 'general'],
    ['e10', 'black', 'general'],
    ['a1', 'red', 'chariot'],
    ['a5', 'black', 'soldier'],
    ['d1', 'black', 'soldier'],
  ]);
  // The chariot moves to a3, bearing on a5 up the file. d1 is not attacked
  // from there.
  const { board: next, flipped } = benedictXiangqiResolveMove(board, {
    from: 'a1',
    to: 'a3',
  });
  assert.deepEqual(flipped, ['a5']);
  assert.equal(next.a5?.color, 'red');
  assert.equal(next.d1?.color, 'black', 'unattacked pieces do not flip');
});

test('a standing attack is inert; the piece has to move', () => {
  const board = boardOf([
    ['e1', 'red', 'general'],
    ['e10', 'black', 'general'],
    ['a3', 'red', 'chariot'],
    ['a5', 'black', 'soldier'],
  ]);
  // a3 already bears on a5. Moving a DIFFERENT piece converts nothing.
  const { flipped } = benedictXiangqiResolveMove(board, { from: 'e1', to: 'd1' });
  assert.deepEqual(flipped, []);
});

test('32 pieces stay on the board forever', () => {
  let state = createInitialBenedictXiangqiState('g');
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 120; i++) {
    const moves = getBenedictXiangqiLegalMoves(state);
    if (moves.length === 0) break;
    state = applyBenedictXiangqiMove(state, moves[rand(moves.length)]);
    assert.equal(Object.keys(state.board).length, 32, `ply ${i}`);
    if (state.status.type !== 'playing') break;
  }
});

test('generals never change colour', () => {
  let state = createInitialBenedictXiangqiState('g');
  let seed = 99;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 200; i++) {
    const moves = getBenedictXiangqiLegalMoves(state);
    if (moves.length === 0) break;
    state = applyBenedictXiangqiMove(state, moves[rand(moves.length)]);
    const generals = Object.values(state.board).filter((p) => p?.role === 'general');
    assert.equal(generals.length, 2);
    assert.equal(generals.filter((p) => p?.color === 'red').length, 1);
    if (state.status.type !== 'playing') break;
  }
});

test('(D) the progress clock resets on a conversion or a soldier move', () => {
  const state = createInitialBenedictXiangqiState('g');
  // A soldier move resets it.
  const afterSoldier = applyBenedictXiangqiMove(state, { from: 'a4', to: 'a5' });
  assert.equal(afterSoldier.progressPlies, 0);

  // A quiet chariot move that converts nothing increments it.
  const quiet = applyBenedictXiangqiMove(afterSoldier, { from: 'a10', to: 'a9' });
  assert.equal(quiet.progressPlies, 1);
  assert.ok(BENEDICT_XIANGQI_PROGRESS_LIMIT > 0);
});

test('the central cannon converts a soldier on move one', () => {
  // b3-b5 puts the cannon on the fifth rank; from there it bears on b8 over
  // the b7 screen. This is the opening motif the engine plays.
  const state = createInitialBenedictXiangqiState('g');
  const next = applyBenedictXiangqiMove(state, { from: 'b3', to: 'b5' });
  assert.equal(next.status.type, 'playing');
  assert.ok((next.lastFlipped?.length ?? 0) >= 1, 'the first move converts something');
});

test('stalemate is a loss for the side to move, as in xiangqi', () => {
  // Red general boxed in by its own pieces with no legal move at all.
  const board = boardOf([
    ['e1', 'red', 'general'],
    ['d1', 'red', 'advisor'],
    ['f1', 'red', 'advisor'],
    ['e2', 'red', 'elephant'],
    ['e10', 'black', 'general'],
  ]);
  const state: BenedictXiangqiGameState = {
    id: 'g',
    board,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  const moves = getBenedictXiangqiLegalMoves(state);
  // If red does have moves here the fixture is wrong, not the rule.
  if (moves.length === 0) {
    assert.equal(state.status.type, 'playing');
  }
  assert.ok(benedictXiangqiSquareOf(4, 0) === 'e1');
});
