import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialXiangqiState } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
} from './variants-xiangqi-standard.js';
import {
  boardFrom,
  createXiangqiRuleKernel,
  type XiangqiRuleKernel,
  type XiangqiRuleState,
} from './xiangqi-rule-kernel.js';

// ── Parity gate ────────────────────────────────────────────────────────────
//
// The standard configuration must generate exactly the elephantops-backed
// kernel's legal moves at every position reached by real play. Every variant
// built by configuring this module inherits this gate for its geometry.

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

function keys(kernel: XiangqiRuleKernel, state: XiangqiRuleState): string[] {
  return kernel
    .legalMoves(state)
    .map((m) => kernel.moveKey(m))
    .sort();
}

test('standard configuration agrees with the elephantops-backed standard kernel', () => {
  const kernel = createXiangqiRuleKernel();
  const rng = mulberry32(20260911);
  let compared = 0;
  for (let game = 0; game < 12; game += 1) {
    let reference = createInitialXiangqiState(`parity-${game}`);
    for (let ply = 0; ply < 60; ply += 1) {
      if (reference.status.type !== 'playing') break;
      const expected = getStandardXiangqiLegalMoves(reference)
        .map((m) => `${m.from}${m.to}`)
        .sort();
      const mine: XiangqiRuleState = {
        ...kernel.initial('mine'),
        board: reference.board,
        status: { type: 'playing', turn: reference.status.turn },
      };
      assert.deepEqual(
        keys(kernel, mine),
        expected,
        `ply ${ply} of game ${game}: ${kernel.fen(mine)}`,
      );
      compared += 1;
      if (expected.length === 0) break;
      const moves = getStandardXiangqiLegalMoves(reference);
      reference = applyStandardXiangqiMove(reference, moves[Math.floor(rng() * moves.length)]!);
    }
  }
  // A guard on the guard: a walk that dies early proves nothing.
  assert.ok(compared > 400, `only compared ${compared} positions`);
});

test('standard configuration: checkmate and stalemate end the game as xiangqi does', () => {
  const kernel = createXiangqiRuleKernel();
  // Rooks a9 and b9; a9-a10 covers rank 10, b9 covers rank 9: the general on e10 is mated.
  const mate = kernel.apply(kernel.parseFen('4k4/RR7/9/9/9/9/9/9/9/3K5 w - - 0 1', 'm')!, {
    from: 'a9',
    to: 'a10',
  });
  assert.deepEqual(mate.status, { type: 'finished', winner: 'red', reason: 'checkmate' });
  // Soldier d9 attacks d10 and e9, chariot f1 covers f10; the general is not attacked.
  // No legal move and not in check is a LOSS for the side to move, xiangqi's rule.
  const stale = kernel.apply(kernel.parseFen('4k4/9/3P5/9/9/9/9/9/9/3K1R3 w - - 0 1', 's')!, {
    from: 'd8',
    to: 'd9',
  });
  assert.deepEqual(stale.status, { type: 'finished', winner: 'red', reason: 'stalemate' });
});

test('lenient FEN: soldiers on the back rank and a general outside the palace round-trip', () => {
  const kernel = createXiangqiRuleKernel({ generalRegion: 'board' });
  for (const fen of [
    '4k4/9/9/9/9/9/9/9/9/PPPPPPPPP w - - 0 1',
    '9/9/9/9/4k4/9/9/9/9/K8 b - - 7 12',
  ]) {
    const state = kernel.parseFen(fen, 'f');
    assert.ok(state, fen);
    assert.equal(kernel.fen(state), fen);
  }
  assert.equal(kernel.parseFen('9/9/9 w', 'bad'), null);
});

// ── Rule hooks ─────────────────────────────────────────────────────────────

test('mustCapture: only captures when one exists; losing everything wins; the general is a piece', () => {
  const kernel = createXiangqiRuleKernel({
    mustCapture: true,
    royal: { red: false, black: false },
    check: 'none',
    facing: 'off',
    extinction: { red: 'wins', black: 'wins' },
    stalemate: 'win',
  });
  // Chariot a1 can take the soldier a6; every quiet move disappears.
  const state = kernel.parseFen('4k4/9/9/9/p8/9/9/9/9/R3K3R w - - 0 1', 'anti')!;
  assert.deepEqual(keys(kernel, state), ['a1a6']);
  // Black's last piece captured: black has nothing left, which in antichess is black's win.
  const last = kernel.parseFen('9/9/9/9/p8/9/9/9/9/R3K4 w - - 0 1', 'last')!;
  assert.deepEqual(kernel.apply(last, { from: 'a1', to: 'a6' }).status, {
    type: 'finished',
    winner: 'black',
    reason: 'extinction',
  });
  // A non-royal general is just a piece, still palace-bound: red may leave it attacked
  // by the rook on a1 (no capture is available, so quiet moves are legal), and black
  // taking it ends nothing.
  const exposed = kernel.parseFen('4k4/9/9/9/9/9/P8/9/9/r3K4 w - - 0 1', 'exp')!;
  assert.ok(keys(kernel, exposed).includes('a4a5'));
  assert.ok(keys(kernel, exposed).includes('e1e2'));
  const taken = kernel.apply(kernel.apply(exposed, { from: 'a4', to: 'a5' }), {
    from: 'a1',
    to: 'e1',
  });
  assert.equal(taken.status.type, 'playing');
  assert.equal(taken.board.e1?.color, 'black');
});

test('blast: neighbours removed per shape, immune roles survive, palaces contain', () => {
  const orth = createXiangqiRuleKernel({ blast: { shape: 'orthogonal', immune: ['soldier'] } });
  // Chariot e1 takes the horse e5: the chariot explodes, so do d5 (rook) and e6 (elephant);
  // the soldier on f5 is immune; the general on d1 is nowhere near.
  const state = orth.parseFen('4k4/9/9/9/4b4/3rnp3/9/9/9/3KR4 w - - 0 1', 'b')!;
  const after = orth.apply(state, { from: 'e1', to: 'e5' });
  assert.equal(after.board.e5, undefined, 'the capturing chariot explodes too');
  assert.equal(after.board.d5, undefined, 'orthogonal neighbour d5 removed');
  assert.equal(after.board.e6, undefined, 'orthogonal neighbour e6 removed');
  assert.deepEqual(after.board.f5, { color: 'black', role: 'soldier' }, 'immune');
  assert.equal(after.status.type, 'playing');

  const eight = createXiangqiRuleKernel({ blast: { shape: 'eight', immune: [] } });
  const diag = eight.apply(eight.parseFen('4k4/9/9/9/3b1b3/4n4/9/9/9/3KR4 w - - 0 1', 'd')!, {
    from: 'e1',
    to: 'e5',
  });
  assert.equal(diag.board.d6, undefined, 'diagonal neighbour d6 removed');
  assert.equal(diag.board.f6, undefined, 'diagonal neighbour f6 removed');

  // Chariot a4 takes the horse f4, outside the palace; the advisor on f3, inside it, is
  // spared when the blast is palace-contained and removed when it is not.
  const capture = { from: 'a4', to: 'f4' } as const;
  const fen = '4k4/9/9/9/9/9/R4n3/5A3/9/3K5 w - - 0 1';
  const contained = createXiangqiRuleKernel({
    blast: { shape: 'orthogonal', immune: [], palaceContained: true },
  });
  assert.deepEqual(contained.apply(contained.parseFen(fen, 'c')!, capture).board.f3, {
    color: 'red',
    role: 'advisor',
  });
  const open = createXiangqiRuleKernel({ blast: { shape: 'orthogonal', immune: [] } });
  assert.equal(open.apply(open.parseFen(fen, 'o')!, capture).board.f3, undefined);

  // A capture that would blast the mover's own general is illegal; one that blasts the
  // enemy general wins on the spot, and outranks being in check.
  const royal = createXiangqiRuleKernel({ blast: { shape: 'orthogonal', immune: [] } });
  const selfBlast = royal.parseFen('4k4/9/9/9/9/9/9/9/4n4/4K4 w - - 0 1', 'sb')!;
  assert.ok(!keys(royal, selfBlast).includes('e1e2'), 'the general would explode itself');
  // Black rook a1 gives check along rank 1; chariot e2 takes the soldier e9 anyway and the
  // blast removes the general on e10.
  const check = royal.parseFen('4k4/4p4/9/9/9/9/9/9/4R4/r3K4 w - - 0 1', 'w')!;
  assert.ok(keys(royal, check).includes('e2e9'));
  assert.deepEqual(royal.apply(check, { from: 'e2', to: 'e9' }).status, {
    type: 'finished',
    winner: 'red',
    reason: 'general-captured',
  });
});

test('freed general, facing on the rook line, and a hill win', () => {
  const koth = createXiangqiRuleKernel({
    generalRegion: 'board',
    facing: 'rookline',
    flag: { red: ['e5', 'e6'], black: ['e5', 'e6'], timing: 'immediate' },
  });
  const state = koth.parseFen('4k4/9/9/9/9/9/9/9/9/K8 w - - 0 1', 'k')!;
  assert.ok(keys(koth, state).includes('a1a2'), 'the general leaves the palace');
  // Rook-line facing: a9-a10 would face the black general along the open rank 10.
  const rank = koth.parseFen('4k4/K8/9/9/9/9/9/9/9/9 w - - 0 1', 'r')!;
  assert.ok(!keys(koth, rank).includes('a9a10'));
  const hill = koth.apply(koth.parseFen('4k4/9/9/9/9/9/4K4/9/9/9 w - - 0 1', 'h')!, {
    from: 'e4',
    to: 'e5',
  });
  assert.deepEqual(hill.status, { type: 'finished', winner: 'red', reason: 'flag' });
});

test('racing: checks forbidden, and black gets one reply to reach the far rank', () => {
  const racing = createXiangqiRuleKernel({
    generalRegion: 'board',
    facing: 'off',
    check: 'forbidden',
    flag: { red: ['a10', 'i10'], black: ['a10', 'i10'], timing: 'blackReply' },
  });
  // Red reaches a10; black on i9 can reach i10 on the reply.
  const race = racing.parseFen('9/K7k/9/9/9/9/9/9/9/9 w - - 0 1', 'race')!;
  const pending = racing.apply(race, { from: 'a9', to: 'a10' });
  assert.equal(pending.status.type, 'playing');
  assert.deepEqual(racing.apply(pending, { from: 'i9', to: 'i10' }).status, {
    type: 'finished',
    winner: null,
    reason: 'flag',
  });
  assert.deepEqual(racing.apply(pending, { from: 'i9', to: 'h9' }).status, {
    type: 'finished',
    winner: 'red',
    reason: 'flag',
  });
  // Black on i8 cannot reach in one move: red wins immediately.
  const far = racing.parseFen('9/K8/8k/9/9/9/9/9/9/9 w - - 0 1', 'far')!;
  assert.deepEqual(racing.apply(far, { from: 'a9', to: 'a10' }).status, {
    type: 'finished',
    winner: 'red',
    reason: 'flag',
  });
  // Checks forbidden: a1-a10 would attack the general on e10 along rank 10.
  const noCheck = racing.parseFen('4k4/9/9/9/9/9/9/9/9/R3K4 w - - 0 1', 'nc')!;
  assert.ok(!keys(racing, noCheck).includes('a1a10'));
  assert.ok(keys(racing, noCheck).includes('a1a9'));
});

test('facing as a capture: the general flies down the open file and takes', () => {
  const kernel = createXiangqiRuleKernel({ facing: 'capture', check: 'none' });
  const state = kernel.parseFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1', 'fly')!;
  assert.ok(keys(kernel, state).includes('e1e10'));
  assert.deepEqual(kernel.apply(state, { from: 'e1', to: 'e10' }).status, {
    type: 'finished',
    winner: 'red',
    reason: 'general-captured',
  });
});

test('horde: a side with no general is not royal, and its extinction loses', () => {
  const horde = createXiangqiRuleKernel({
    startBoard: boardFrom({
      e10: { color: 'black', role: 'general' },
      a1: { color: 'red', role: 'soldier' },
      b1: { color: 'red', role: 'soldier' },
    }),
    royal: { red: false, black: true },
    facing: 'off',
    extinction: { red: 'loses', black: 'none' },
  });
  assert.deepEqual(keys(horde, horde.initial('h')), ['a1a2', 'b1b2']);
  // Black takes the last soldier: red is extinct and loses.
  const last = horde.parseFen('4k4/9/9/9/9/9/9/9/r8/P8 b - - 0 1', 'l')!;
  assert.deepEqual(horde.apply(last, { from: 'a2', to: 'a1' }).status, {
    type: 'finished',
    winner: 'black',
    reason: 'extinction',
  });
  // Black's general is still royal: it may not step to e9, which the soldier on f9
  // attacks sideways past the river.
  const nearly = horde.parseFen('4k4/5P3/9/9/9/9/9/9/9/9 b - - 0 1', 'n')!;
  assert.ok(!keys(horde, nearly).includes('e10e9'));
  assert.ok(keys(horde, nearly).includes('e10d10'));
});

test('progress clock and repetition draw the game', () => {
  const kernel = createXiangqiRuleKernel({ progressClock: 4 });
  let state = kernel.parseFen('4k4/9/9/9/9/9/9/9/9/R3K4 w - - 0 1', 'p')!;
  const shuffle = [
    { from: 'a1', to: 'a2' },
    { from: 'e10', to: 'e9' },
    { from: 'a2', to: 'a1' },
    { from: 'e9', to: 'e10' },
  ] as const;
  for (const move of shuffle) state = kernel.apply(state, move);
  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'progress-clock' });

  const rep = createXiangqiRuleKernel({ progressClock: 1000 });
  state = rep.parseFen('4k4/9/9/9/9/9/9/9/9/R3K4 w - - 0 1', 'r')!;
  for (let i = 0; i < 2; i += 1) for (const move of shuffle) state = rep.apply(state, move);
  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'repetition' });
});
