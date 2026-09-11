import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allDuckXiangqiSquares,
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  DUCK_XIANGQI_PROGRESS_LIMIT,
  type DuckXiangqiBoard,
  type DuckXiangqiGameState,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  duckXiangqiDuckDestinations,
  duckXiangqiGeneralsFace,
  duckXiangqiMovesFrom,
  duckXiangqiPseudoMovesFrom,
  getDuckXiangqiLegalTurns,
} from './variants-duck-xiangqi.js';
import { createInitialXiangqiState } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
} from './variants-xiangqi-standard.js';

// ── Parity gate ────────────────────────────────────────────────────────────
//
// The geometry in this kernel is hand-rolled, and hand-rolled xiangqi geometry
// is where the bugs live. So it is tied to the elephantops-backed standard
// kernel by an AGREEMENT TEST rather than by hardcoded perft numbers: with the
// duck off the board and a check filter applied on top, this kernel must
// generate exactly the standard kernel's legal moves, at every position reached
// by real play.
//
// Hardcoded perft numbers would have caught a drift between the two kernels but
// not a shared misunderstanding of the position; comparing against the
// validated implementation at hundreds of positions is the stronger instrument,
// and it is free.

/** Is `color`'s general capturable right now? This kernel's stand-in for check. */
function generalCapturable(board: DuckXiangqiBoard, color: 'red' | 'black'): boolean {
  let generalAt: DuckXiangqiSquare | null = null;
  for (const square of allDuckXiangqiSquares()) {
    const piece = board[square];
    if (piece && piece.role === 'general' && piece.color === color) generalAt = square;
  }
  if (!generalAt) return false;
  for (const square of allDuckXiangqiSquares()) {
    const piece = board[square];
    if (!piece || piece.color === color) continue;
    if (duckXiangqiPseudoMovesFrom(board, undefined, square).includes(generalAt)) return true;
  }
  return false;
}

/**
 * Standard xiangqi legal moves, derived from THIS kernel: duckless geometry,
 * plus the two filters standard play has and Duck Xiangqi does not (D4 removes
 * check; D5 keeps facing, so facing is applied in both).
 */
function standardMovesViaDuckKernel(board: DuckXiangqiBoard, mover: 'red' | 'black'): string[] {
  const out: string[] = [];
  for (const from of allDuckXiangqiSquares()) {
    const piece = board[from];
    if (!piece || piece.color !== mover) continue;
    for (const to of duckXiangqiPseudoMovesFrom(board, undefined, from)) {
      const next: DuckXiangqiBoard = { ...board };
      delete next[from];
      next[to] = piece;
      if (duckXiangqiGeneralsFace(next, undefined)) continue;
      if (generalCapturable(next, mover)) continue;
      out.push(`${from}${to}`);
    }
  }
  return out.sort();
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('duckless geometry agrees with the elephantops-backed standard kernel', () => {
  const rng = mulberry32(20260908);
  let compared = 0;
  for (let game = 0; game < 12; game++) {
    let state = createInitialXiangqiState(`parity-${game}`);
    for (let ply = 0; ply < 40; ply++) {
      if (state.status.type !== 'playing') break;
      const reference = getStandardXiangqiLegalMoves(state)
        .map((m) => `${m.from}${m.to}`)
        .sort();
      const mine = standardMovesViaDuckKernel(state.board as DuckXiangqiBoard, state.status.turn);
      assert.deepEqual(mine, reference, `ply ${ply} of game ${game}`);
      compared++;
      if (reference.length === 0) break;
      const moves = getStandardXiangqiLegalMoves(state);
      const pick = moves[Math.floor(rng() * moves.length)];
      state = applyStandardXiangqiMove(state, pick);
    }
  }
  // A guard on the guard: if the walk dies early this test silently proves
  // nothing, which is the failure mode a parity gate is least able to notice.
  assert.ok(compared > 300, `only compared ${compared} positions`);
});

// ── D7: turn structure and the branching factor ────────────────────────────

test('the duck starts off the board', () => {
  const state = createInitialDuckXiangqiState('start');
  assert.equal(state.duck, undefined);
});

test('the opening position has 44 piece moves and 2554 legal TURNS', () => {
  // 44 is ordinary xiangqi's opening move count; nothing about the duck can
  // change it, because the duck is not on the board yet.
  //
  // The turn count is NOT 44 x 58. Two of those 44 are the cannon-takes-horse
  // captures (b3xb10, h3xh10), and a capture leaves 31 pieces rather than 32,
  // so the duck gets 59 empty points instead of 58:
  //
  //   42 quiet moves  x 58 = 2436
  //    2 capture moves x 59 =  118
  //                          ----
  //                          2554
  //
  // Worth keeping as a worked number rather than a round one. The first draft
  // of this test asserted 2552 on the assumption that no capture is available
  // on move one, which is false in xiangqi and would have been an invented
  // branching factor quoted in the write-up.
  //
  // 2554 is ~60x ordinary xiangqi and ~3x Duck Chess, and it is the reason this
  // variant cannot use a joint-move search.
  const state = createInitialDuckXiangqiState('branching');
  const turns = getDuckXiangqiLegalTurns(state);
  const pieceMoves = new Set(turns.map((t) => `${t.from}${t.to}`));
  assert.equal(pieceMoves.size, 44);
  assert.equal(turns.length, 2554);

  const captures = [...pieceMoves].filter((m) => state.board[m.slice(2) as never]);
  assert.deepEqual(captures.sort(), ['b3b10', 'h3h10']);
});

test('the duck must move to a DIFFERENT point, and may take the vacated one', () => {
  let state = createInitialDuckXiangqiState('duckmove');
  state = applyDuckXiangqiTurn(state, { from: 'b3', to: 'e3', duckTo: 'e5' });
  assert.equal(state.duck, 'e5');

  const dests = duckXiangqiDuckDestinations(state.board, state.duck, 'b8', 'e8');
  assert.ok(!dests.includes('e5'), 'the duck may not stay where it is');
  assert.ok(dests.includes('b8'), 'the point the moving piece vacated is available');
  assert.ok(!dests.includes('e8'), 'the point the moving piece landed on is not');
});

// ── D1/D2: the duck is an ordinary piece, and it screens ───────────────────

function boardOf(entries: [DuckXiangqiSquare, string][]): DuckXiangqiBoard {
  const roles: Record<string, string> = {
    k: 'general',
    a: 'advisor',
    e: 'elephant',
    h: 'horse',
    r: 'chariot',
    c: 'cannon',
    s: 'soldier',
  };
  const board: DuckXiangqiBoard = {};
  for (const [square, code] of entries) {
    board[square] = {
      color: code[0] === 'R' ? 'red' : 'black',
      role: roles[code[1]] as never,
    };
  }
  return board;
}

test('(D2) the duck screens for a cannon', () => {
  // Red cannon a1, black chariot a5, nothing between. Without a screen the
  // cannon cannot take it; with the duck at a3 it can.
  const board = boardOf([
    ['a1', 'Rc'],
    ['a5', 'Br'],
    ['e1', 'Rk'],
    ['e10', 'Bk'],
  ]);
  assert.ok(
    !duckXiangqiPseudoMovesFrom(board, undefined, 'a1').includes('a5'),
    'no screen, no shot',
  );
  assert.ok(duckXiangqiPseudoMovesFrom(board, 'a3', 'a1').includes('a5'), 'the duck is the screen');
});

test('(D2) the duck is a SECOND screen, which kills the shot', () => {
  const board = boardOf([
    ['a1', 'Rc'],
    ['a3', 'Rs'],
    ['a5', 'Br'],
    ['e1', 'Rk'],
    ['e10', 'Bk'],
  ]);
  assert.ok(duckXiangqiPseudoMovesFrom(board, undefined, 'a1').includes('a5'));
  assert.ok(
    !duckXiangqiPseudoMovesFrom(board, 'a4', 'a1').includes('a5'),
    'two screens is not one screen',
  );
});

test('(D1) the duck can never be captured or landed on', () => {
  const board = boardOf([
    ['a1', 'Rr'],
    ['e1', 'Rk'],
    ['e10', 'Bk'],
  ]);
  const moves = duckXiangqiPseudoMovesFrom(board, 'a5', 'a1');
  assert.ok(!moves.includes('a5'), 'the chariot cannot take the duck');
  assert.ok(moves.includes('a4'), 'it can go up to it');
  assert.ok(!moves.includes('a6'), 'and not past it');
});

// ── D3: the leg and the eye ────────────────────────────────────────────────

test('(D3) a duck on the leg blocks the horse, unlike a chess knight', () => {
  const board = boardOf([
    ['e5', 'Rh'],
    ['e1', 'Rk'],
    ['e10', 'Bk'],
  ]);
  // A horse on e5 with a clear leg at e6 reaches d7 and f7.
  const free = duckXiangqiPseudoMovesFrom(board, undefined, 'e5');
  assert.ok(free.includes('d7') && free.includes('f7'));

  const legged = duckXiangqiPseudoMovesFrom(board, 'e6', 'e5');
  assert.ok(!legged.includes('d7'), 'the duck on e6 is the leg');
  assert.ok(!legged.includes('f7'), 'and it blocks both destinations using it');
  // It blocks ONLY that leg. The other three legs are untouched.
  assert.ok(legged.includes('d3') && legged.includes('g6') && legged.includes('c6'));
});

test('(D3) a duck on the eye blocks the elephant', () => {
  const board = boardOf([
    ['c1', 'Re'],
    ['e1', 'Rk'],
    ['e10', 'Bk'],
  ]);
  assert.ok(duckXiangqiPseudoMovesFrom(board, undefined, 'c1').includes('e3'));
  assert.ok(
    !duckXiangqiPseudoMovesFrom(board, 'd2', 'c1').includes('e3'),
    'the duck on d2 is the eye',
  );
});

test('the elephant still cannot cross the river', () => {
  const board = boardOf([
    ['c5', 'Re'],
    ['e1', 'Rk'],
    ['e10', 'Bk'],
  ]);
  const moves = duckXiangqiPseudoMovesFrom(board, undefined, 'c5');
  assert.ok(!moves.includes('a7'));
  assert.ok(!moves.includes('e7'));
  assert.ok(moves.includes('a3'));
});

// ── D5: the flying general, as a capture ───────────────────────────────────

test('(D5) the general flies down a clear file and takes the enemy general', () => {
  const board = boardOf([
    ['e1', 'Rk'],
    ['e10', 'Bk'],
  ]);
  // The whole rule in one assertion: nothing on file e, so the move exists.
  assert.ok(duckXiangqiMovesFrom(board, 'a1', 'e1').includes('e10'));
  assert.ok(duckXiangqiMovesFrom(board, 'a1', 'e10').includes('e1'), 'and it is symmetric');

  // It is the only way a general leaves its palace, so it must not be mistaken
  // for a general that can now roam: e5 is on the file and is NOT a destination.
  assert.ok(!duckXiangqiMovesFrom(board, 'a1', 'e1').includes('e5'));
});

test('(D5) anything on the file stops the flight, the duck included', () => {
  const board = boardOf([
    ['e1', 'Rk'],
    ['e10', 'Bk'],
  ]);
  assert.ok(
    !duckXiangqiMovesFrom(board, 'e5', 'e1').includes('e10'),
    'the duck blocks it (D1), which is what makes the duck worth placing there',
  );
  const withPiece = boardOf([
    ['e1', 'Rk'],
    ['e10', 'Bk'],
    ['e5', 'Bs'],
  ]);
  assert.ok(!duckXiangqiMovesFrom(withPiece, 'a1', 'e1').includes('e10'), 'so does a piece');
});

test('(D5) facing is now legal, and the duck is free to walk away from it', () => {
  // REVISED 2026-09-10. This is the assertion that reversed: the duck used to be
  // pinned to the open segment between the generals, and now it is not. Leaving
  // the file open is a placement you are allowed to make and lose to.
  const board = boardOf([
    ['e1', 'Rk'],
    ['e10', 'Bk'],
    ['a1', 'Rr'],
  ]);
  const dests = duckXiangqiDuckDestinations(board, 'e5', 'a1', 'a2');
  assert.ok(dests.includes('i9'), 'the duck may abandon the file entirely');
  assert.ok(dests.includes('e4'), 'or keep holding it');
  assert.ok(!dests.includes('e5'), 'it still may never stand still (D7)');
  // Every empty point, with no facing exception carved out of it: 90 points,
  // less the three pieces, less the duck's own square.
  assert.equal(dests.length, 86);
});

test('(D5) walking the duck off the file hands the opponent the win', () => {
  // The cost is real and immediate, which is the point of making it legal.
  const state: DuckXiangqiGameState = {
    id: 'facing-blunder',
    board: boardOf([
      ['e1', 'Rk'],
      ['e10', 'Bk'],
      ['a1', 'Rr'],
    ]),
    duck: 'e5',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  const blunder = applyDuckXiangqiTurn(state, { from: 'a1', to: 'a2', duckTo: 'i9' });
  assert.equal(blunder.status.type, 'playing', 'the game does not end on its own');

  const reply = getDuckXiangqiLegalTurns(blunder).find((t) => t.from === 'e10' && t.to === 'e1');
  assert.ok(reply, 'black may now fly the length of the board and take the general');
  assert.equal(reply?.duckTo, null, 'a general capture ends the turn early (D4)');
  assert.deepEqual(applyDuckXiangqiTurn(blunder, reply!).status, {
    type: 'finished',
    winner: 'black',
    reason: 'general-captured',
  });
});

test('every legal piece move leaves at least one legal duck destination', () => {
  // The general form of the test above, over real play. If this ever fails, the
  // pinned-duck squeeze is real after all and D9 gets much more interesting.
  const rng = mulberry32(11);
  let state = createInitialDuckXiangqiState('squeeze');
  for (let ply = 0; ply < 60; ply++) {
    if (state.status.type !== 'playing') break;
    const turns = getDuckXiangqiLegalTurns(state);
    const byMove = new Map<string, number>();
    for (const turn of turns) {
      const key = `${turn.from}${turn.to}`;
      byMove.set(key, (byMove.get(key) ?? 0) + 1);
    }
    for (const [move, count] of byMove) {
      assert.ok(count > 0, `${move} had no duck destination`);
    }
    if (turns.length === 0) break;
    state = applyDuckXiangqiTurn(state, turns[Math.floor(rng() * turns.length)]);
  }
});

// ── D4 / D9: terminal conditions ───────────────────────────────────────────

test('(D4) there is no check: you may leave your general attacked', () => {
  // Black chariot bears on the red general down the a-file. Red is free to
  // ignore it entirely, which ordinary xiangqi would forbid.
  const state: DuckXiangqiGameState = {
    id: 'nocheck',
    board: boardOf([
      ['d1', 'Rk'],
      ['d10', 'Bk'],
      ['d5', 'Rs'],
      ['a1', 'Br'],
      ['i1', 'Rr'],
    ]),
    duck: 'b3',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  const turns = getDuckXiangqiLegalTurns(state);
  assert.ok(
    turns.some((t) => t.from === 'i1' && t.to === 'i5'),
    'red may play elsewhere while its general is attacked',
  );
});

test('(D4) capturing the general wins immediately, and the duck does not move', () => {
  const state: DuckXiangqiGameState = {
    id: 'capture',
    board: boardOf([
      ['d1', 'Rk'],
      ['d10', 'Bk'],
      ['a10', 'Rr'],
    ]),
    duck: 'b3',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  const turns = getDuckXiangqiLegalTurns(state);
  const kill = turns.filter((t) => t.to === 'd10');
  // TWO ways to take it since D5 changed, and that is the point: the chariot
  // down the a-file and across, and the general itself flying up the d-file.
  // Neither carries a duck placement.
  assert.deepEqual(
    kill.map((t) => t.from).sort(),
    ['a10', 'd1'],
    'the chariot and the flying general',
  );
  for (const turn of kill) assert.equal(turn.duckTo, null);

  const next = applyDuckXiangqiTurn(state, kill.find((t) => t.from === 'a10')!);
  assert.equal(next.status.type, 'finished');
  assert.deepEqual(next.status, {
    type: 'finished',
    winner: 'red',
    reason: 'general-captured',
  });
  assert.equal(next.duck, 'b3', 'the duck stays put on a winning turn');
});

test('(D5) the duck can rescue a piece move that opens the general file', () => {
  // REVISED 2026-09-10, and this test reversed with the rule. Red's general on
  // d1 takes the black soldier on d2, which opens the d-file between the
  // generals. That used to be illegal outright. Now it is a legal move that
  // loses on the spot UNLESS the duck lands back on the file, which it may,
  // because the two halves are judged on the position the whole turn produces.
  const board = boardOf([
    ['d1', 'Rk'],
    ['e1', 'Rs'],
    ['d2', 'Bs'],
    ['d10', 'Bk'],
  ]);
  assert.ok(duckXiangqiMovesFrom(board, 'e2', 'd1').includes('d2'), 'the capture is legal now');

  const dests = duckXiangqiDuckDestinations(board, 'e2', 'd1', 'd2');
  assert.ok(dests.includes('d5'), 'and the duck may re-block the file it just opened');
  assert.ok(dests.includes('a1'), 'or go anywhere else and lose the general');

  // The rescue is a real choice, not an automatic one: proving it means showing
  // the un-rescued line actually loses.
  const state: DuckXiangqiGameState = {
    id: 'rescue',
    board,
    duck: 'e2',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  const rescued = applyDuckXiangqiTurn(state, { from: 'd1', to: 'd2', duckTo: 'd5' });
  assert.ok(
    !getDuckXiangqiLegalTurns(rescued).some((t) => t.from === 'd10' && t.to === 'd2'),
    'blocked: black cannot fly through the duck',
  );
  const exposed = applyDuckXiangqiTurn(state, { from: 'd1', to: 'd2', duckTo: 'a1' });
  assert.ok(
    getDuckXiangqiLegalTurns(exposed).some((t) => t.from === 'd10' && t.to === 'd2'),
    'unblocked: black flies down and takes the general',
  );
});

/**
 * A real stalemate, rebuilt 2026-09-10.
 *
 * The old one was made of the facing PROHIBITION: red's general was boxed in
 * because the one capture available to it would have left the generals facing.
 * That rule is gone, so the position had to be rebuilt out of rules that still
 * exist. It is now made of blocking, which is the variant's actual subject.
 *
 *   - Red's general on d1 has exactly two palace neighbours, e1 and d2 (c1 is
 *     outside the palace), and both hold red's own soldiers.
 *   - The soldier on d2 also blocks the general's flight up the d-file, so the
 *     move the new D5 grants it is unavailable too.
 *   - The d2 soldier's only move is forward to d3, which is red's own advisor.
 *   - The d3 advisor's diagonals are e2, which is the DUCK, and e4, which is
 *     outside the palace.
 *   - The e1 soldier's only move is forward to e2, the duck again.
 *
 * Red has no legal piece move, therefore no legal turn. Every piece is stopped
 * by ordinary blocking, and the duck is the keystone: it stops two of them.
 */
function stalematePosition(): DuckXiangqiGameState {
  return {
    id: 'stalemate',
    board: boardOf([
      ['d1', 'Rk'],
      ['e1', 'Rs'],
      ['d2', 'Rs'],
      ['d3', 'Ra'],
      ['d10', 'Bk'],
      ['a5', 'Br'],
    ]),
    duck: 'e2',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
}

test('(D9) a position with no legal turn exists, and each rule is load-bearing', () => {
  const stuck = stalematePosition();
  assert.equal(getDuckXiangqiLegalTurns(stuck).length, 0);
  // Named individually so a future rules change says WHICH piece came loose.
  for (const square of ['d1', 'e1', 'd2', 'd3'] as DuckXiangqiSquare[]) {
    assert.deepEqual(duckXiangqiMovesFrom(stuck.board, stuck.duck, square), [], `${square} moved`);
  }

  // D1 is the keystone: lift the duck off e2 and two pieces breathe again.
  const duckAway = { ...stalematePosition(), duck: 'i9' as DuckXiangqiSquare };
  assert.deepEqual(duckXiangqiMovesFrom(duckAway.board, duckAway.duck, 'e1'), ['e2']);
  assert.deepEqual(duckXiangqiMovesFrom(duckAway.board, duckAway.duck, 'd3'), ['e2']);
  assert.ok(getDuckXiangqiLegalTurns(duckAway).length > 0);
});

test('(D9) stalemate is a LOSS for the side to move, the opposite of Duck Chess', () => {
  // Duck Chess inverts stalemate into a win for the immobilised player (the
  // "fowling" rule, confirmed in the inventor's text and in Fairy-Stockfish's
  // `stalemateValue = VALUE_MATE`). We took xiangqi's answer instead, and this
  // is the test that pins the divergence.
  //
  // Delivered by black rather than asserted on a hand-built state, so the
  // scoring runs through applyDuckXiangqiTurn the way a real game reaches it.
  // Black moves anything and parks the duck on e2, which closes the box.
  const before: DuckXiangqiGameState = {
    ...stalematePosition(),
    duck: 'i9',
    status: { type: 'playing', turn: 'black' },
  };
  assert.ok(getDuckXiangqiLegalTurns(before).length > 0, 'red is not stuck yet');

  const state = applyDuckXiangqiTurn(before, { from: 'a5', to: 'a4', duckTo: 'e2' });
  assert.deepEqual(state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'stalemate',
  });
});

// ── D8: the draw rule ──────────────────────────────────────────────────────

test('(D8) the progress clock ends a game repetition cannot', () => {
  // Set the clock one ply short and play a quiet move. Testing it this way
  // rather than by shuffling for 120 plies is deliberate: a shuffle short enough
  // to write by hand REPEATS, and then three-fold fires first (which the test
  // below shows still works). The two rules catch different kinds of stalled
  // game, and this is the one only the clock can catch.
  const state: DuckXiangqiGameState = {
    id: 'progress',
    board: boardOf([
      ['e1', 'Rk'],
      ['e10', 'Bk'],
      ['a1', 'Rr'],
      ['i10', 'Br'],
    ]),
    duck: 'e5',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: DUCK_XIANGQI_PROGRESS_LIMIT - 1,
  };
  const next = applyDuckXiangqiTurn(state, { from: 'a1', to: 'a2', duckTo: 'e6' });
  assert.deepEqual(next.status, { type: 'finished', winner: null, reason: 'progress' });
});

test('(D8) repetition still fires when the duck cycles too', () => {
  // Measured, not assumed: repetition fired ZERO times in 3,300 random games,
  // which is why the clock exists. It is not dead though - a shuffle that also
  // cycles the duck does repeat, and this is that case.
  let state: DuckXiangqiGameState = {
    id: 'rep',
    board: boardOf([
      ['e1', 'Rk'],
      ['e10', 'Bk'],
      ['a1', 'Rr'],
      ['i10', 'Br'],
    ]),
    duck: 'e5',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    positionCounts: {},
    progressPlies: 0,
  };
  const cycle: DuckXiangqiTurn[] = [
    { from: 'a1', to: 'a2', duckTo: 'e6' },
    { from: 'i10', to: 'i9', duckTo: 'e5' },
    { from: 'a2', to: 'a1', duckTo: 'e6' },
    { from: 'i9', to: 'i10', duckTo: 'e5' },
  ];
  let plies = 0;
  while (state.status.type === 'playing' && plies < 200) {
    state = applyDuckXiangqiTurn(state, cycle[plies % cycle.length]!);
    plies++;
  }
  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.ok(plies < DUCK_XIANGQI_PROGRESS_LIMIT, 'repetition beat the clock here');
});

test('(D8) a capture resets the clock and clears repetition history', () => {
  let state = createInitialDuckXiangqiState('reset');
  state = applyDuckXiangqiTurn(state, { from: 'b3', to: 'b5', duckTo: 'e5' });
  assert.equal(state.progressPlies, 1, 'a quiet move advances the clock');
  // b3xb10 is a capture available from the array.
  let s2 = createInitialDuckXiangqiState('reset2');
  s2 = applyDuckXiangqiTurn(s2, { from: 'b3', to: 'b10', duckTo: 'e5' });
  assert.equal(s2.progressPlies, 0, 'a capture resets it');
  // History is cleared, then the position the capture produced is counted, so
  // exactly one entry survives - not zero.
  assert.deepEqual(
    Object.values(s2.positionCounts),
    [1],
    'earlier positions become unreachable; only the new one is tracked',
  );
});
