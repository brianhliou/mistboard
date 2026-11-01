import assert from 'node:assert/strict';
import test from 'node:test';
import { ffqBanqiStateToFen } from './ffq-banqi-fen.js';
import {
  BANQI_PIECE_COUNTS,
  type BanqiColor,
  type BanqiPiece,
  type BanqiPieceRole,
} from './variants-banqi.js';
import {
  applyFFQBanqiMove,
  createFFQBanqiDeal,
  createFFQBanqiSetup,
  createFFQBanqiStateFromSetup,
  createInitialFFQBanqiState,
  FFQ_BANQI_DAMAGE,
  FFQ_BANQI_HEIGHT,
  FFQ_BANQI_RULES,
  FFQ_BANQI_WIDTH,
  type FFQBanqiBoard,
  type FFQBanqiState,
  getFFQBanqiLegalMoves,
  getFFQBanqiPlayerView,
  getFFQBanqiResult,
} from './variants-ffq-banqi.js';

const up = (color: BanqiColor, role: BanqiPieceRole): BanqiPiece => ({
  color,
  role,
  faceDown: false,
});
const down = (color: BanqiColor, role: BanqiPieceRole): BanqiPiece => ({
  color,
  role,
  faceDown: true,
});
function playing(
  pieces: Record<number, BanqiPiece>,
  overrides: Partial<FFQBanqiState> = {},
): FFQBanqiState {
  const board: FFQBanqiBoard = Array.from({ length: 32 }, (_, i) => pieces[i] ?? null);
  return { ...createInitialFFQBanqiState('test', 800), board, ...overrides };
}
function play(state: FFQBanqiState, from: number, to: number): FFQBanqiState {
  const next = applyFFQBanqiMove(state, { from, to });
  assert.notEqual(next, state, `${from}->${to} should be legal`);
  return next;
}
const dests = (state: FFQBanqiState, from: number) =>
  getFFQBanqiLegalMoves(state)
    .filter((m) => m.from === from)
    .map((m) => m.to)
    .sort((a, b) => a - b);

test('stored FFQ setup replays the exact deal and rejects missing or corrupt setup', () => {
  const setup = createFFQBanqiSetup(() => 0.25);
  const state = createFFQBanqiStateFromSetup('stored', setup);
  assert.deepEqual(
    state.board.map((piece) => ({ color: piece!.color, role: piece!.role })),
    setup.deal,
  );
  assert.deepEqual(
    state.board.flatMap((piece, i) => (piece && !piece.faceDown ? [i] : [])),
    [6, 15, 16, 25],
  );
  assert.deepEqual(
    createFFQBanqiStateFromSetup('stored', JSON.parse(JSON.stringify(setup))),
    state,
  );
  for (const bad of [
    undefined,
    null,
    {},
    { deal: [] },
    { deal: setup.deal.slice(1) },
    { deal: Array(32).fill(setup.deal[0]) },
  ]) {
    assert.throws(() => createFFQBanqiStateFromSetup('bad', bad));
  }
  state.board[0]!.faceDown = false;
  assert.ok(!('faceDown' in setup.deal[0]!), 'stored deal and board are independent');
});

test('runtime endings preserve their status and masked views without enabling moves', () => {
  const state = createInitialFFQBanqiState('ended', 800);
  const statuses: FFQBanqiState['status'][] = [
    ...(['timeout', 'resignation', 'abandonment', 'agreement'] as const).map((reason) => ({
      type: 'finished' as const,
      winner: null,
      reason,
    })),
    { type: 'aborted', reason: 'user-abort' },
  ];
  for (const status of statuses) {
    const ended = { ...state, status };
    assert.deepEqual(getFFQBanqiResult(ended), status);
    assert.equal(applyFFQBanqiMove(ended, { from: 0, to: 0 }), ended);
    for (const viewer of ['red', 'black', 'observer'] as const) {
      const view = JSON.parse(JSON.stringify(getFFQBanqiPlayerView(ended, viewer)));
      assert.deepEqual(view.status, status);
      assert.deepEqual(view.board[0], { faceDown: true });
      assert.deepEqual(view.legalMoves, []);
    }
  }
});

test('rule 1: 4x8 indices, orthogonal edges never wrap rows', () => {
  assert.equal(FFQ_BANQI_WIDTH, 4);
  assert.equal(FFQ_BANQI_HEIGHT, 8);
  assert.deepEqual(dests(playing({ 3: up('red', 'horse') }), 3), [2, 7]);
  assert.deepEqual(dests(playing({ 28: up('red', 'horse') }), 28), [24, 29]);
  assert.deepEqual(dests(playing({ 17: up('red', 'horse') }), 17), [13, 16, 18, 21]);
  const state = playing({ 3: up('red', 'horse') });
  for (const move of [
    { from: -1, to: -1 },
    { from: 3, to: 32 },
    { from: 3, to: 4 },
    { from: 3.5, to: 3.5 },
  ]) {
    assert.equal(applyFFQBanqiMove(state, move), state);
  }
});

test('rule 2: seeded deals contain the standard 16 pieces per ink, worth 100 damage', () => {
  const deal = createFFQBanqiDeal(800);
  assert.deepEqual(deal, createFFQBanqiDeal(800));
  assert.notDeepEqual(deal, createFFQBanqiDeal(801));
  assert.equal(createFFQBanqiDeal(() => 0.999).length, 32);
  for (const color of ['red', 'black'] as const) {
    const pieces = deal.filter((piece) => piece.color === color);
    assert.equal(pieces.length, 16);
    assert.equal(
      pieces.reduce((sum, piece) => sum + FFQ_BANQI_DAMAGE[piece.role], 0),
      100,
    );
    for (const [role, count] of Object.entries(BANQI_PIECE_COUNTS)) {
      assert.equal(pieces.filter((piece) => piece.role === role).length, count);
    }
  }
});

test('rule 3: only squares 6, 15, 16, 25 open face up; pool and whole views hide the deal', () => {
  const state = createInitialFFQBanqiState('setup', 800);
  assert.equal(state.board.length, 32);
  assert.deepEqual(
    state.board.flatMap((piece, i) => (piece && !piece.faceDown ? [i] : [])),
    [6, 15, 16, 25],
  );
  const red = getFFQBanqiPlayerView(state, 'red');
  assert.equal(
    Object.values(red.pool.red).reduce((a, b) => a + b, 0) +
      Object.values(red.pool.black).reduce((a, b) => a + b, 0),
    28,
  );
  for (const perspective of ['red', 'black', 'observer'] as const) {
    const view = JSON.parse(JSON.stringify(getFFQBanqiPlayerView(state, perspective)));
    for (const [i, piece] of state.board.entries()) {
      if (piece?.faceDown) assert.deepEqual(view.board[i], { faceDown: true });
    }
    assert.equal(view.seed, undefined);
    assert.equal(view.deal, undefined);
    assert.equal(view.captures, undefined);
  }
});

test('rule 4: seats own red then black without an opening flip binding', () => {
  const state = playing({ 0: up('red', 'horse'), 31: down('black', 'general') });
  assert.ok(dests(state, 0).includes(1));
  assert.deepEqual(state.status, { type: 'playing', turn: 'red' });
  const flipped = play(state, 31, 31);
  assert.deepEqual(flipped.status, { type: 'playing', turn: 'black' });
  const black = play(flipped, 31, 30);
  assert.deepEqual(black.status, { type: 'playing', turn: 'red' });
  assert.ok(dests(black, 0).includes(1));
});

test('rule 5: 60 starting HP, damage table, clamping, zero HP and simultaneous-zero draw', () => {
  assert.deepEqual(createInitialFFQBanqiState('hp', 1).hp, { red: 60, black: 60 });
  assert.deepEqual(FFQ_BANQI_DAMAGE, {
    soldier: 2,
    cannon: 5,
    horse: 5,
    chariot: 5,
    elephant: 5,
    advisor: 10,
    general: 30,
  });
  for (const [role, damage] of Object.entries(FFQ_BANQI_DAMAGE)) {
    const state = playing({
      0: up('red', 'cannon'),
      4: down('red', 'soldier'),
      8: up('black', role as BanqiPieceRole),
    });
    assert.deepEqual(play(state, 0, 8).hp, { red: 60, black: 60 - damage });
    const dead = play({ ...state, hp: { red: 60, black: 1 } }, 0, 8);
    assert.deepEqual(dead.hp, { red: 60, black: 0 });
    assert.deepEqual(dead.status, { type: 'finished', reason: 'hp', winner: 'red' });
  }
  assert.deepEqual(
    getFFQBanqiResult(playing({}, { hp: { red: 0, black: 0 }, noProgressClock: 30 })),
    { type: 'finished', reason: 'hp', winner: null },
  );
  assert.deepEqual(
    getFFQBanqiResult(playing({}, { hp: { red: 0, black: 60 }, noProgressClock: 30 })),
    { type: 'finished', reason: 'hp', winner: 'black' },
  );
});

test('rule 6: any hidden tile may flip; only own face-up non-cannons quietly step', () => {
  const state = playing({
    0: down('red', 'general'),
    1: down('black', 'soldier'),
    10: up('red', 'chariot'),
    31: up('black', 'horse'),
  });
  assert.deepEqual(dests(state, 0), [0]);
  assert.deepEqual(dests(state, 1), [1]);
  assert.deepEqual(dests(state, 10), [6, 9, 11, 14]);
  assert.deepEqual(dests(state, 31), []);
  assert.equal(play(state, 1, 1).board[1]?.faceDown, false);
  assert.equal(applyFFQBanqiMove(state, { from: 10, to: 10 }), state);
});

test('rule 6: exhaustive non-cannon capture ladder, soldier/general cycle and covered/friendly targets', () => {
  const roles: BanqiPieceRole[] = [
    'soldier',
    'cannon',
    'horse',
    'chariot',
    'elephant',
    'advisor',
    'general',
  ];
  for (const attacker of roles.filter((r) => r !== 'cannon')) {
    for (const target of roles) {
      const allowed =
        attacker === 'soldier'
          ? target === 'soldier' || target === 'general'
          : attacker === 'general' && target === 'soldier'
            ? false
            : roles.indexOf(attacker) >= roles.indexOf(target);
      assert.equal(
        dests(playing({ 0: up('red', attacker), 1: up('black', target) }), 0).includes(1),
        allowed,
        `${attacker} takes ${target}`,
      );
      assert.ok(
        !dests(playing({ 0: up('red', attacker), 1: down('black', target) }), 0).includes(1),
      );
      assert.ok(!dests(playing({ 0: up('red', attacker), 1: up('red', target) }), 0).includes(1));
    }
  }
});

test('rule 6: cannon has NO quiet move (mutation sentinel)', () => {
  assert.deepEqual(dests(playing({ 9: up('red', 'cannon') }), 9), []);
});

test('rule 6: cannon jumps exactly one screen, stops at first victim, all directions and distances', () => {
  assert.deepEqual(
    dests(
      playing({
        0: up('red', 'cannon'),
        1: down('red', 'horse'),
        3: up('black', 'general'),
        4: up('red', 'soldier'),
        12: down('red', 'advisor'),
        16: up('black', 'general'),
      }),
      0,
    ),
    [3, 12],
  );
  assert.deepEqual(
    dests(
      playing({ 3: up('red', 'cannon'), 2: up('black', 'soldier'), 0: up('black', 'horse') }),
      3,
    ),
    [0],
  );
  assert.deepEqual(
    dests(
      playing({ 28: up('red', 'cannon'), 16: down('black', 'horse'), 0: up('black', 'general') }),
      28,
    ),
    [0],
  );
  for (const role of Object.keys(BANQI_PIECE_COUNTS) as BanqiPieceRole[]) {
    assert.ok(
      dests(
        playing({ 0: up('red', 'cannon'), 4: down('black', 'soldier'), 8: up('black', role) }),
        0,
      ).includes(8),
    );
  }
  assert.deepEqual(dests(playing({ 0: up('red', 'cannon'), 3: up('black', 'general') }), 0), []);
  assert.deepEqual(
    dests(
      playing({
        0: up('red', 'cannon'),
        4: down('red', 'horse'),
        8: up('red', 'general'),
        12: up('black', 'horse'),
      }),
      0,
    ),
    [],
  );
});

test('rule 6: covered captures are public to both seats and observers, including HP-ending friendly captures', () => {
  for (const mover of ['red', 'black'] as const) {
    for (const owner of ['red', 'black'] as const) {
      for (const role of Object.keys(BANQI_PIECE_COUNTS) as BanqiPieceRole[]) {
        for (const fatal of [false, true]) {
          const state = playing(
            {
              0: up(mover, 'cannon'),
              4: down('black', 'soldier'),
              8: down(owner, role),
              31: down('black', 'general'),
            },
            {
              ply: mover === 'red' ? 0 : 1,
              status: { type: 'playing', turn: mover },
              hp: { red: 60, black: 60, ...(fatal ? { [owner]: 1 } : {}) },
            },
          );
          const next = play(state, 0, 8);
          assert.equal(next.hp[owner], fatal ? 0 : 60 - FFQ_BANQI_DAMAGE[role]);
          assert.equal(next.status.type, fatal ? 'finished' : 'playing');
          if (fatal)
            assert.deepEqual(next.status, {
              type: 'finished',
              reason: 'hp',
              winner: owner === 'red' ? 'black' : 'red',
            });
          assert.equal(next.board[8]?.role, 'cannon');
          assert.equal(next.board[0], null);
          const expectedPool = { red: { ...BANQI_PIECE_COUNTS }, black: { ...BANQI_PIECE_COUNTS } };
          expectedPool[mover].cannon -= 1;
          expectedPool[owner][role] -= 1;
          for (const perspective of ['red', 'black', 'observer'] as const) {
            const view = JSON.parse(JSON.stringify(getFFQBanqiPlayerView(next, perspective)));
            assert.deepEqual(view.captured, [
              { owner, role, capturedBy: mover, wasFaceDown: true },
            ]);
            assert.deepEqual(view.pool, expectedPool);
            assert.deepEqual(view.unknownCaptured, { red: 0, black: 0 });
            assert.deepEqual(view.board[4], { faceDown: true });
            assert.deepEqual(view.board[31], { faceDown: true });
          }
        }
      }
    }
  }
  assert.equal(FFQ_BANQI_RULES.coveredCaptureDisclosure, 'public');
});

test('rule 7: the 30th quiet ply draws, 29 does not; draw precedes no-legal-move', () => {
  const state = playing(
    { 0: up('red', 'horse'), 31: up('black', 'horse') },
    { noProgressClock: 28 },
  );
  const next = play(state, 0, 1);
  assert.equal(next.status.type, 'playing');
  const drawn = play(next, 31, 30);
  assert.deepEqual(drawn.status, { type: 'finished', winner: null, reason: 'no-progress' });
  assert.deepEqual(getFFQBanqiLegalMoves(drawn), []);
  assert.equal(applyFFQBanqiMove(drawn, { from: 1, to: 0 }), drawn);
  assert.deepEqual(getFFQBanqiResult(playing({}, { noProgressClock: 30 })), {
    type: 'finished',
    winner: null,
    reason: 'no-progress',
  });
});

test('flip_reset: any flip resets the 30-ply clock and BOTH chase counters', () => {
  for (const ply of [0, 1]) {
    const state = playing(
      { 0: down('black', 'horse'), 31: down('red', 'horse') },
      { ply, noProgressClock: 29, chaseCounts: { red: 4, black: 3 } },
    );
    const next = play(state, 0, 0);
    assert.equal(next.noProgressClock, 0);
    assert.deepEqual(next.chaseCounts, { red: 0, black: 0 });
    assert.equal(next.status.type, 'playing');
  }
});

test('rule 7/8: public, enemy-covered and own-covered captures reset both chase counters and clock', () => {
  for (const victim of [up('black', 'horse'), down('black', 'horse'), down('red', 'horse')]) {
    const state = playing(
      { 0: up('red', 'cannon'), 4: up('red', 'soldier'), 8: victim, 31: down('black', 'general') },
      { noProgressClock: 29, chaseCounts: { red: 4, black: 4 } },
    );
    const next = play(state, 0, 8);
    assert.equal(next.noProgressClock, 0);
    assert.deepEqual(next.chaseCounts, { red: 0, black: 0 });
  }
});

test('chase4_forbid5: count starts at first chase, fourth allowed, fifth illegal without an exception', () => {
  let state = playing({
    0: up('red', 'chariot'),
    5: up('black', 'horse'),
    31: up('red', 'soldier'),
  });
  for (let count = 1; count <= 4; count += 1) {
    state = play(state, count % 2 ? 0 : 1, count % 2 ? 1 : 0);
    assert.equal(state.chaseCounts.red, count);
    state = play(state, count % 2 ? 5 : 4, count % 2 ? 4 : 5);
    assert.equal(state.chaseCounts.red, count, 'opponent quiet move preserves the count');
  }
  assert.ok(!dests(state, 0).includes(1));
  assert.equal(applyFFQBanqiMove(state, { from: 0, to: 1 }), state);
  assert.ok(dests(state, 31).includes(30), 'non-chase remains legal');
  const forced = { ...state, board: [...state.board] };
  forced.board[31] = null;
  assert.deepEqual(getFFQBanqiResult(forced), {
    type: 'finished',
    winner: 'black',
    reason: 'no-legal-move',
  });
});

test('rule 8: chase means capturable adjacent revealed enemy after the step; non-chase resets only mover', () => {
  const targets = [
    up('black', 'horse'),
    up('black', 'general'),
    down('black', 'horse'),
    up('red', 'horse'),
  ];
  for (const [i, target] of targets.entries()) {
    const next = play(
      playing({ 0: up('red', 'chariot'), 2: target }, { chaseCounts: { red: 2, black: 3 } }),
      0,
      1,
    );
    assert.deepEqual(next.chaseCounts, { red: i === 0 ? 3 : 0, black: 3 });
  }
  const multiple = play(
    playing({ 0: up('red', 'chariot'), 2: up('black', 'horse'), 5: up('black', 'soldier') }),
    0,
    1,
  );
  assert.equal(multiple.chaseCounts.red, 1, 'multiple targets count as one chase');
  const black = play(
    playing(
      { 31: up('black', 'chariot'), 29: up('red', 'horse') },
      { ply: 1, chaseCounts: { red: 3, black: 2 } },
    ),
    31,
    30,
  );
  assert.deepEqual(black.chaseCounts, { red: 3, black: 3 });
});

test('rule 9: no legal move loses, including an immobile lone cannon', () => {
  for (const ply of [0, 1]) {
    const state = playing({}, { ply });
    assert.deepEqual(getFFQBanqiResult(state), {
      type: 'finished',
      reason: 'no-legal-move',
      winner: ply === 0 ? 'black' : 'red',
    });
  }
  assert.deepEqual(getFFQBanqiResult(playing({ 0: up('red', 'cannon') })), {
    type: 'finished',
    reason: 'no-legal-move',
    winner: 'black',
  });
  assert.equal(getFFQBanqiResult(playing({ 0: down('black', 'horse') })).type, 'playing');
});

test('hidden permutations preserve complete player/observer payloads and legality, even after game end', () => {
  const initial = createInitialFFQBanqiState('privacy', 800);
  // Make a legal covered capture from a full multiset, then permute only backs
  // still on the board. Public capture knowledge must not weaken this boundary.
  const cannon = initial.board.findIndex((p) => p?.color === 'red' && p.role === 'cannon');
  [initial.board[0], initial.board[cannon]] = [initial.board[cannon], initial.board[0]];
  initial.board[0] = { ...initial.board[0]!, faceDown: false };
  const state = play(initial, 0, 8);
  const permuted = { ...state, board: state.board.map((p) => (p ? { ...p } : null)) };
  const hidden = state.board.flatMap((piece, square) => (piece?.faceDown ? [square] : []));
  hidden.forEach((square, i) => {
    permuted.board[square] = state.board[hidden[hidden.length - 1 - i]];
  });
  for (const status of [
    state.status,
    { type: 'finished', reason: 'hp', winner: 'red' },
    { type: 'finished', reason: 'no-progress', winner: null },
    { type: 'finished', reason: 'no-legal-move', winner: 'black' },
  ] as FFQBanqiState['status'][]) {
    for (const perspective of ['red', 'black', 'observer'] as const) {
      const view = JSON.parse(
        JSON.stringify(getFFQBanqiPlayerView({ ...state, status }, perspective)),
      );
      for (const square of hidden) assert.deepEqual(view.board[square], { faceDown: true });
      assert.deepEqual(view.captured, state.captures);
      assert.equal(
        JSON.stringify(getFFQBanqiPlayerView({ ...state, status }, perspective)),
        JSON.stringify(getFFQBanqiPlayerView({ ...permuted, status }, perspective)),
      );
    }
    assert.equal(
      ffqBanqiStateToFen({ ...state, status }),
      ffqBanqiStateToFen({ ...permuted, status }),
    );
  }
  const before = JSON.stringify(state);
  const view = getFFQBanqiPlayerView(state, 'red');
  view.hp.red = 0;
  view.chaseCounts.red = 4;
  view.pool.red.general = 99;
  view.captured[0].role = 'general';
  const revealed = view.board.find((p) => p && !p.faceDown);
  if (revealed && !revealed.faceDown) revealed.role = 'general';
  assert.equal(JSON.stringify(state), before);
});

test('2,000 seeded random playouts: legal endings, nonnegative HP, whole-payload secrecy and seat symmetry', () => {
  let rngState = 0x800;
  const random = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 0x100000000;
  };
  for (let seed = 0; seed < 2_000; seed += 1) {
    let state = createInitialFFQBanqiState('property', seed);
    let plies = 0;
    while (state.status.type === 'playing') {
      assert.ok(plies++ < 1_800, `seed ${seed} exceeded irreversible-move/30-ply bound`);
      const legal = getFFQBanqiLegalMoves(state);
      assert.ok(legal.length > 0);
      const move = legal[Math.floor(random() * legal.length)];
      const next = applyFFQBanqiMove(state, move);
      assert.notEqual(next, state);
      assert.equal(next.ply, state.ply + 1);
      assert.equal(next.moveNumber, Math.floor(next.ply / 2) + 1);
      const hiddenPool = {
        red: Object.fromEntries(Object.keys(BANQI_PIECE_COUNTS).map((role) => [role, 0])),
        black: Object.fromEntries(Object.keys(BANQI_PIECE_COUNTS).map((role) => [role, 0])),
      };
      for (const piece of next.board) if (piece?.faceDown) hiddenPool[piece.color][piece.role] += 1;
      for (const color of ['red', 'black'] as const) {
        assert.ok(next.hp[color] >= 0 && next.hp[color] <= 60);
        assert.ok(next.chaseCounts[color] >= 0 && next.chaseCounts[color] <= 4);
      }
      for (const perspective of ['red', 'black', 'observer'] as const) {
        const view = JSON.parse(JSON.stringify(getFFQBanqiPlayerView(next, perspective)));
        for (const [i, piece] of next.board.entries()) {
          if (piece?.faceDown) assert.deepEqual(view.board[i], { faceDown: true });
        }
        assert.deepEqual(view.captured, next.captures);
        assert.deepEqual(view.pool, hiddenPool);
        assert.deepEqual(view.unknownCaptured, { red: 0, black: 0 });
        assert.equal(view.deal, undefined);
        assert.equal(view.seed, undefined);
        assert.equal(view.captures, undefined);
      }
      // Symmetric mask: every seat and the observer get the same payload apart
      // from the perspective label and the legal moves (a turn fact, computed
      // from public state), which is what lets the server serve a live board
      // (server-policy SYMMETRIC_HIDDEN_IDENTITY_SPEC_IDS).
      const { perspective: _r, legalMoves: _rl, ...redView } = getFFQBanqiPlayerView(next, 'red');
      for (const perspective of ['black', 'observer'] as const) {
        const {
          perspective: _p,
          legalMoves: _l,
          ...other
        } = getFFQBanqiPlayerView(next, perspective);
        assert.deepEqual(other, redView);
      }
      state = next;
    }
    assert.equal(state.status.type, 'finished');
    assert.deepEqual(
      state.status,
      getFFQBanqiResult({
        ...state,
        status: { type: 'playing', turn: state.ply % 2 ? 'black' : 'red' },
      }),
    );
    assert.deepEqual(getFFQBanqiLegalMoves(state), []);
  }
});
