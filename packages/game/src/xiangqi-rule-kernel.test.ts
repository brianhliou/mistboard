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

test('veteran soldiers step sideways before the river, per side, and never backward', () => {
  const fen = '4k4/9/9/4p4/9/9/9/9/4P4/4K4 w - - 0 1';
  const soldier = (kernel: XiangqiRuleKernel, state: XiangqiRuleState, from: string) =>
    keys(kernel, state).filter((k) => k.startsWith(from));
  const standard = createXiangqiRuleKernel();
  assert.deepEqual(soldier(standard, standard.parseFen(fen, 's')!, 'e2'), ['e2e3']);
  const veterans = createXiangqiRuleKernel({ veteranSoldiers: { red: true, black: false } });
  assert.deepEqual(soldier(veterans, veterans.parseFen(fen, 'v')!, 'e2'), ['e2d2', 'e2e3', 'e2f2']);
  // The black soldier on e7 is still xiangqi's: forward only on its own side.
  const black = veterans.parseFen('4k4/9/9/4p4/9/9/9/9/4P4/4K4 b - - 0 1', 'b')!;
  assert.deepEqual(soldier(veterans, black, 'e7'), ['e7e6']);
  // On the last rank a veteran still only slides sideways.
  const last = veterans.parseFen('P2k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1', 'l')!;
  assert.deepEqual(soldier(veterans, last, 'a10'), ['a10b10']);
});

test('stall: fewer pieces wins a stalled game, and a dead position ends it at once', () => {
  // Red general and advisor against black general, two advisors, elephant: no
  // chariot, horse, cannon or soldier, so nothing can ever capture again.
  const dead = '4ka3/4a4/4b4/9/9/9/9/9/4A4/4K4 b - - 0 1';
  const off = createXiangqiRuleKernel({
    mustCapture: true,
    royal: { red: false, black: false },
    check: 'none',
    facing: 'off',
  });
  let state = off.parseFen(dead, 'o')!;
  state = off.apply(state, { from: 'e10', to: 'e9' });
  assert.equal(state.status.type, 'playing', 'off: the dead position plays on');

  const count = createXiangqiRuleKernel({
    mustCapture: true,
    royal: { red: false, black: false },
    check: 'none',
    facing: 'off',
    stall: 'fewerPieces',
    deadPosition: true,
  });
  state = count.parseFen(dead, 'c')!;
  state = count.apply(state, { from: 'e10', to: 'e9' });
  assert.deepEqual(state.status, { type: 'finished', winner: 'red', reason: 'dead-position' });

  // A chariot keeps the position alive; the progress clock then goes on count.
  const clock = createXiangqiRuleKernel({
    stall: 'fewerPieces',
    deadPosition: true,
    progressClock: 2,
  });
  state = clock.parseFen('4k4/9/9/9/9/9/9/9/9/R3KA3 w - - 0 1', 'p')!;
  state = clock.apply(state, { from: 'a1', to: 'a2' });
  state = clock.apply(state, { from: 'e10', to: 'e9' });
  assert.deepEqual(state.status, { type: 'finished', winner: 'black', reason: 'progress-clock' });

  // Equal counts stay a draw.
  const equal = createXiangqiRuleKernel({
    stall: 'fewerPieces',
    deadPosition: true,
    progressClock: 2,
  });
  state = equal.parseFen('r3k4/9/9/9/9/9/9/9/9/R3K4 w - - 0 1', 'q')!;
  state = equal.apply(state, { from: 'a1', to: 'a2' });
  state = equal.apply(state, { from: 'a10', to: 'a9' });
  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'progress-clock' });
});

test('losers and codrus: a mated royal general wins, a bare general wins, a lost general wins', () => {
  // Losers: royal general, check as xiangqi, being mated or reduced to the bare general wins.
  const losers = createXiangqiRuleKernel({
    mustCapture: true,
    checkmate: 'win',
    bareGeneral: 'wins',
    extinction: { red: 'wins', black: 'wins' },
    stalemate: 'win',
  });
  // Black to move captures Red's last non-general piece: Red is bare and has won.
  let state = losers.parseFen('4k4/9/9/9/9/9/9/9/3r5/3RK4 b - - 0 1', 'b')!;
  state = losers.apply(state, { from: 'd2', to: 'd1' });
  assert.deepEqual(state.status, { type: 'finished', winner: 'red', reason: 'bare-general' });
  // A mate, and the mated side wins: Ra1-a10 checks along the rank; d10 and
  // f10 are attacked, e9 is the advisor, and every advisor move opens the
  // file to a facing position, so Black has no legal move.
  state = losers.parseFen('4k4/4a4/9/9/9/9/9/9/9/R3K4 w - - 0 1', 'm')!;
  state = losers.apply(state, { from: 'a1', to: 'a10' });
  assert.deepEqual(state.status, { type: 'finished', winner: 'black', reason: 'checkmate' });
  // Codrus: non-royal general, losing it wins.
  const codrus = createXiangqiRuleKernel({
    mustCapture: true,
    royal: { red: false, black: false },
    check: 'none',
    facing: 'off',
    generalLost: 'wins',
    extinction: { red: 'wins', black: 'wins' },
    stalemate: 'win',
  });
  state = codrus.parseFen('R3k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1', 'c')!;
  state = codrus.apply(state, { from: 'a10', to: 'e10' });
  assert.deepEqual(state.status, { type: 'finished', winner: 'black', reason: 'general-lost' });
});

test('blast: the lines shape follows the drawn lines, so the palace diagonals count and nothing else does', () => {
  const lines = createXiangqiRuleKernel({ blast: { shape: 'lines', immune: [] } });
  // Rxd2 beside the general on e1: d2-e1 is not a drawn line, so the general survives...
  const edge = lines.parseFen('3k5/9/9/9/9/3r5/9/9/3N5/4K4 b - - 0 1', 'edge')!;
  const afterEdge = lines.apply(edge, { from: 'd5', to: 'd2' });
  assert.deepEqual(afterEdge.board.e1, { color: 'red', role: 'general' });
  assert.equal(afterEdge.status.type, 'playing');
  // ...while Rxd1 with the general on the palace centre e2 kills it along the drawn diagonal.
  const centre = lines.parseFen('5k3/9/9/3r5/9/9/9/9/4K4/3A5 b - - 0 1', 'centre')!;
  assert.equal(lines.apply(centre, { from: 'd7', to: 'd1' }).status.type, 'finished');
  // Outside the palace no diagonal is drawn: a capture on d4 spares c5 and e5 but takes d5.
  const open = lines.parseFen('4k4/9/9/9/9/2ppp4/3P5/9/9/4K4 b - - 0 1', 'open')!;
  const afterOpen = lines.apply(open, { from: 'd5', to: 'd4' });
  assert.equal(afterOpen.board.d5, undefined);
  assert.deepEqual(afterOpen.board.c5, { color: 'black', role: 'soldier' });
  assert.deepEqual(afterOpen.board.e5, { color: 'black', role: 'soldier' });
  // The same capture under eight takes all three.
  const eight = createXiangqiRuleKernel({ blast: { shape: 'eight', immune: [] } });
  const afterEight = eight.apply(eight.parseFen('4k4/9/9/9/9/2ppp4/3P5/9/9/4K4 b - - 0 1', 'e8')!, {
    from: 'd5',
    to: 'd4',
  });
  assert.equal(afterEight.board.c5, undefined);
  assert.equal(afterEight.board.e5, undefined);
});

test('blast: the palace shelter spares every piece on a palace point, so a general is mated and never blown up', () => {
  const shelter = createXiangqiRuleKernel({
    blast: { shape: 'orthogonal', immune: ['soldier'], shelter: 'palace' },
  });
  // Rxd1 beside the general: the chariot and the advisor go, the general on e1 stays,
  // the elephant on c1 (outside the palace) still dies.
  const s = shelter.parseFen('3k5/9/9/9/9/3r5/9/9/9/2BAK4 b - - 0 1', 'shelter')!;
  const after = shelter.apply(s, { from: 'd5', to: 'd1' });
  assert.equal(after.status.type, 'playing');
  assert.deepEqual(after.board.e1, { color: 'red', role: 'general' });
  assert.equal(after.board.d1, undefined);
  assert.equal(after.board.c1, undefined);
  // The threat is therefore not lethal, so a chariot on the advisor file is no check.
  assert.equal(
    shelter.legalMoves(s).some((m) => m.to === 'd1'),
    true,
  );
  // Without the shelter the same capture ends the game.
  const plain = createXiangqiRuleKernel({ blast: { shape: 'orthogonal', immune: ['soldier'] } });
  assert.equal(
    plain.apply(plain.parseFen('3k5/9/9/9/9/3r5/9/9/9/2BAK4 b - - 0 1', 'p')!, {
      from: 'd5',
      to: 'd1',
    }).status.type,
    'finished',
  );
});

test('blast: a cannon shot spares the neighbours when cannonShotBlasts is off, and the hopping chariot then loses the perpetual', () => {
  const k = createXiangqiRuleKernel({
    repetition: 'perpetualCheckLoses',
    repetitionCheck: 'lethal',
    blast: { shape: 'orthogonal', immune: ['soldier'], cannonShotBlasts: false },
  });
  // Cxd10 over the chariot: advisor and cannon go, the general on e10 stays.
  const shot = k.parseFen('3ak4/3r5/9/9/9/9/9/3C5/9/4K4 w - - 0 1', 'shot')!;
  const after = k.apply(shot, { from: 'd3', to: 'd10' });
  assert.equal(after.status.type, 'playing');
  assert.deepEqual(after.board.e10, { color: 'black', role: 'general' });
  assert.equal(after.board.d3, undefined);
  // A chariot's capture still blasts the general.
  const chariot = createXiangqiRuleKernel({
    blast: { shape: 'orthogonal', immune: ['soldier'], cannonShotBlasts: false },
  });
  assert.equal(
    chariot.apply(chariot.parseFen('3ak4/9/9/9/9/9/9/3R5/9/4K4 w - - 0 1', 'r')!, {
      from: 'd3',
      to: 'd10',
    }).status.type,
    'finished',
  );
  // The dance: the chariot on d9 threatens Rxd1 (lethal, so check); the cannon blocks on d3
  // and, with cannon shots not blasting, threatens nothing. The chariot hops, the cannon
  // follows. Third occurrence: one side checked every move, the chariot side loses.
  let s = k.parseFen('4k4/3r5/9/9/9/9/4P4/5C3/9/3AKA3 w - - 0 1', 'dance')!;
  const moves = ['f3d3', 'd9f9', 'd3f3', 'f9d9', 'f3d3', 'd9f9', 'd3f3', 'f9d9'];
  for (const u of moves) {
    const m = k.fromUci(s, u)!;
    assert.ok(k.isLegal(s, m), `${u} legal`);
    s = k.apply(s, m);
    if (s.status.type === 'finished') break;
  }
  assert.equal(s.status.type, 'finished');
  assert.equal(s.status.reason, 'repetition');
  assert.equal(s.status.winner, 'red');
});

test('cannonUnloaded: a cannon on a starting point cannot capture until it has moved', () => {
  const k = createXiangqiRuleKernel({ cannonUnloaded: true });
  const start = k.initial('u');
  // No day-one shot: Cxb10 over the b8 cannon is not offered from b3.
  assert.equal(
    k.legalMoves(start).some((m) => m.from === 'b3' && m.to === 'b10'),
    false,
  );
  // Quiet cannon moves are unchanged.
  assert.equal(
    k.legalMoves(start).some((m) => m.from === 'b3' && m.to === 'b5'),
    true,
  );
  // Once moved, the cannon captures as usual.
  const s1 = k.apply(start, { from: 'b3', to: 'b4' });
  const s2 = k.apply(s1, { from: 'a7', to: 'a6' });
  assert.equal(
    k.legalMoves(s2).some((m) => m.from === 'b4' && m.to === 'b10'),
    true,
  );
  // The rule is off by default.
  assert.equal(
    createXiangqiRuleKernel()
      .legalMoves(start)
      .some((m) => m.from === 'b3' && m.to === 'b10'),
    true,
  );
});

test('repetition: perpetual check loses for the checker, a plain cycle still draws', () => {
  // 1. Ra10+ Ke9 2. Ra9+ Ke10 3. Ra10+ Ke9 4. Ra9+ Ke10 5. Ra10+ is the third occurrence.
  const perpetual = [
    { from: 'a1', to: 'a10' },
    { from: 'e10', to: 'e9' },
    { from: 'a10', to: 'a9' },
    { from: 'e9', to: 'e10' },
    { from: 'a9', to: 'a10' },
    { from: 'e10', to: 'e9' },
    { from: 'a10', to: 'a9' },
    { from: 'e9', to: 'e10' },
    { from: 'a9', to: 'a10' },
  ] as const;
  const fen = '4k4/9/9/9/9/9/9/9/9/R2K5 w - - 0 1';
  const law = createXiangqiRuleKernel({ repetition: 'perpetualCheckLoses' });
  let state = law.parseFen(fen, 'law')!;
  for (const move of perpetual) state = law.apply(state, move);
  assert.deepEqual(state.status, { type: 'finished', winner: 'black', reason: 'repetition' });

  const plain = createXiangqiRuleKernel({ repetition: 'draw' });
  state = plain.parseFen(fen, 'plain')!;
  for (const move of perpetual) state = plain.apply(state, move);
  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'repetition' });

  // A cycle with no checks in it draws under the law too.
  const shuffle = [
    { from: 'a1', to: 'a2' },
    { from: 'e10', to: 'e9' },
    { from: 'a2', to: 'a1' },
    { from: 'e9', to: 'e10' },
  ] as const;
  state = law.parseFen('4k4/9/9/9/9/9/9/9/9/R3K4 w - - 0 1', 'quiet')!;
  for (let i = 0; i < 2; i += 1) for (const move of shuffle) state = law.apply(state, move);
  assert.deepEqual(state.status, { type: 'finished', winner: null, reason: 'repetition' });
});
