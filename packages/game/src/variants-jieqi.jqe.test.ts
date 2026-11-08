// jqe native chase_test.cpp / repetition_test.cpp positions use ranks 0–9;
// Mistboard uses 1–10. Run with Vitest or the package's native node:test runner.
import assert from 'node:assert/strict';
import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiGameState,
  type JieqiInitialStateOptions,
} from './variants-jieqi.js';

const test: (name: string, fn: () => void | Promise<void>) => unknown = (
  process.env.VITEST ? await import('vitest') : await import('node:test')
).test;

test('only jqe-stamped games draw at 80 plies, including a noncapture reveal', () => {
  for (const stamped of [false, true]) {
    const options = { repetition: true, ...(stamped ? { adjudicationRule: 'jqe-v1' } : {}) };
    const base = createInitialJieqiState('clock', undefined, options as JieqiInitialStateOptions);
    const state = { ...base, noCaptureClock: 79 };
    const next = applyJieqiMove(state, { from: 'a4', to: 'a5' });
    assert.equal(next.noCaptureClock, 80);
    assert.equal(next.status.type, stamped ? 'finished' : 'playing');
    if (stamped)
      assert.deepEqual(next.status, { type: 'finished', winner: null, reason: 'no-capture-clock' });
  }
});

test('unknown adjudication stamps fail closed', () => {
  assert.throws(
    () =>
      createInitialJieqiState('unknown', undefined, {
        repetition: true,
        adjudicationRule: 'future-rule',
      } as unknown as JieqiInitialStateOptions),
    /adjudication/,
  );
});

import {
  createJieqiChasePosition,
  jieqiChaseResponsibility,
  jieqiChaseTargets,
} from './jieqi-chase.js';
import {
  getJieqiLegalMoves,
  isJieqiLegalMove,
  type JieqiBoard,
  type JieqiColor,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiSquare,
  jieqiRepeatedInterval,
  jieqiRepetitionPositionKey,
} from './variants-jieqi.js';

// All native positions/moves below are kept in their upstream spelling.
const sq = (s: string): JieqiSquare => `${s[0]}${Number(s.slice(1)) + 1}` as JieqiSquare;
const mv = (s: string): JieqiMove => ({ from: sq(s.slice(0, 2)), to: sq(s.slice(2)) });
const ROLE: Record<string, JieqiPieceRole> = {
  K: 'general',
  R: 'chariot',
  N: 'horse',
  B: 'elephant',
  A: 'advisor',
  C: 'cannon',
  P: 'soldier',
  X: 'soldier',
};
function position(
  pieces: Record<string, string>,
  turn: JieqiColor = 'red',
  idle = 0,
  stamped = true,
): JieqiGameState {
  const board: JieqiBoard = {};
  for (const [s, code] of Object.entries(pieces)) {
    board[sq(s)] = {
      color: code === code.toUpperCase() ? 'red' : 'black',
      role: ROLE[code.toUpperCase()]!,
      faceDown: code.toUpperCase() === 'X',
    };
  }
  const rule = stamped ? ('jqe-v1' as const) : undefined;
  const key = jieqiRepetitionPositionKey(board, turn, rule);
  return {
    id: 'jqe',
    board,
    status: { type: 'playing', turn },
    captures: [],
    moveNumber: 1,
    noCaptureClock: idle,
    ...(rule ? { adjudicationRule: rule } : {}),
    positionCounts: { [key]: 1 },
    repetitionLog: [{ key, ...(rule ? { chase: createJieqiChasePosition(board) } : {}) }],
  };
}
function play(state: JieqiGameState, moves: string[], limit?: number): JieqiGameState {
  for (const move of moves) {
    const next = applyJieqiMove(state, mv(move), { noCaptureClockLimit: limit });
    assert.notEqual(next, state, `rejected ${move}: ${JSON.stringify(state.status)}`);
    state = next;
  }
  return state;
}
const chaseCycle = ['a1b1', 'b3a5', 'b1a1', 'a5b3'];
const chaseBoard = { d0: 'K', e9: 'k', a1: 'R', b3: 'n', h7: 'n' };

test('jqe chase: all six protected-major minor-piece exceptions preserve the board', () => {
  for (const minor of ['A', 'B'])
    for (const target of ['r', 'n', 'c']) {
      const point = minor === 'A' ? 'c4' : 'd5';
      const state = position({
        d0: 'K',
        f9: 'k',
        b3: minor,
        [point]: target,
        [minor === 'A' ? 'i4' : 'i5']: 'r',
      });
      const before = JSON.stringify(state.board);
      assert.equal(jieqiChaseTargets(state.board, 'red').has(sq(point)), true);
      assert.equal(JSON.stringify(state.board), before);
    }
});

test('jqe chase: reciprocal horses are exempt unless the reverse leg is blocked', () => {
  const pieces = { d0: 'K', f9: 'k', b3: 'N', c5: 'n' };
  assert.equal(jieqiChaseTargets(position(pieces).board, 'red').has(sq('c5')), false);
  assert.equal(
    jieqiChaseTargets(position({ ...pieces, c4: 'P' }).board, 'red').has(sq('c5')),
    true,
  );
});

test('jqe chase: dark advisor hypothetical scope differs from its ordinary legal move', () => {
  const state = position({ d0: 'X', e0: 'K', f9: 'k', c1: 'r' });
  assert.equal(isJieqiLegalMove(state, mv('d0c1')), false);
  assert.equal(jieqiChaseTargets(state.board, 'red').has(sq('c1')), true);
});

test('jqe chase: pinned defenders cannot protect; pinned attackers cannot chase', () => {
  const defender = position({ d0: 'K', f9: 'k', a3: 'R', b3: 'n', b9: 'r', a9: 'R' });
  assert.equal(jieqiChaseTargets(defender.board, 'red').has(sq('b3')), true);
  const attacker = position({ d0: 'K', f9: 'k', d3: 'N', d8: 'r', e5: 'p' });
  assert.equal(jieqiChaseTargets(attacker.board, 'red').has(sq('e5')), false);
  assert.throws(() => jieqiChaseTargets(attacker.board, 'invalid' as JieqiColor), /actor/);
});

test('jqe strict terminal: actual chase loses on the third occurrence and cannot advance', () => {
  const first = play(position(chaseBoard), chaseCycle);
  assert.equal(first.status.type, 'playing');
  const end = play(first, chaseCycle);
  assert.deepEqual(end.status, { type: 'finished', winner: 'black', reason: 'perpetual-chase' });
  const before = JSON.stringify(end);
  assert.equal(applyJieqiMove(end, mv('a1b1')), end);
  assert.equal(JSON.stringify(end), before);
  // Check/chase adjudication precedes the clock at exactly 80 plies.
  assert.deepEqual(
    play(position(chaseBoard, 'red', 72), [...chaseCycle, ...chaseCycle]).status,
    end.status,
  );
});

test('jqe no-legal-move loss precedes 80-ply draw; terminal games cannot advance', () => {
  // Upstream terminal position: e0 K, d9 k, d1 r, f1 r. Reach it by d2d1.
  const state = position({ e0: 'K', d9: 'k', d2: 'r', f1: 'r' }, 'black', 79);
  const end = play(state, ['d2d1']);
  assert.deepEqual(end.status, { type: 'finished', winner: 'black', reason: 'stalemate' });
  assert.equal(end.noCaptureClock, 80);
  assert.equal(getJieqiLegalMoves(end).length, 0);
  assert.equal(applyJieqiMove(end, mv('e0f0')), end);
  assert.throws(
    () => applyJieqiMove(position({ e0: 'K', d9: 'k' }), mv('e0f0'), { noCaptureClockLimit: 0 }),
    /positive/,
  );
});

test('jqe repetition: twofold is ongoing; quiet third occurrence uses the complete interval', () => {
  const cycle = ['e0f0', 'd9d8', 'f0e0', 'd8d9'];
  const twofold = play(position({ e0: 'K', d9: 'k' }), cycle);
  assert.equal(twofold.status.type, 'playing');
  assert.deepEqual(jieqiRepeatedInterval(twofold), []);
  const end = play(twofold, cycle);
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'repetition' });
  const interval = jieqiRepeatedInterval(end);
  assert.equal(interval.length, 9); // upstream begin=0, end=8
  const empty = Array.from({ length: 8 }, () => new Set<JieqiSquare>());
  assert.equal(jieqiChaseResponsibility(interval, empty), null);
  assert.throws(() => jieqiChaseResponsibility(interval, empty.slice(0, 4)), /complete/);
});

test('jqe repetition: perpetual check at clock 80 loses; unequal intervals prevent a false checking loss', () => {
  const pieces = { d0: 'K', e9: 'k', e7: 'R' };
  const cycle = ['e9f9', 'e7f7', 'f9e9', 'f7e7'];
  const checking = play(position(pieces, 'black', 72), [...cycle, ...cycle]);
  assert.deepEqual(checking.status, { type: 'finished', winner: 'black', reason: 'chasing' });
  assert.equal(checking.noCaptureClock, 80);
  assert.throws(
    () =>
      jieqiChaseResponsibility(
        jieqiRepeatedInterval(checking),
        Array.from({ length: 8 }, () => new Set()),
      ),
    /unchecked/,
  );
  const unequal = play(position(pieces, 'black'), [
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
  assert.deepEqual(unequal.status, { type: 'finished', winner: null, reason: 'repetition' });
  const interval = jieqiRepeatedInterval(unequal);
  assert.equal(interval.length, 9); // upstream begin=1, end=9
  assert.equal(unequal.repetitionLog?.indexOf(interval[0]!), 1);
  assert.equal(
    interval.slice(1).some((entry) => entry.gaveCheck),
    true,
  );
});

test('jqe physical IDs: exchanging identical chariots preserves board occurrence, not identity', () => {
  const cycle = ['a1a2', 'd9d8', 'b2b1', 'd8d9', 'a2b2', 'd9d8', 'b1a1', 'd8d9'];
  const first = play(position({ e0: 'K', d9: 'k', a1: 'R', b2: 'R' }), cycle);
  assert.equal(first.repetitionLog?.at(-1)?.chase?.ids[sq('a1')], sq('b2'));
  assert.equal(first.repetitionLog?.at(-1)?.chase?.ids[sq('b2')], sq('a1'));
  assert.equal(first.status.type, 'playing');
  const second = play(first, cycle);
  assert.equal(jieqiRepeatedInterval(second).length, 17);
  assert.equal(second.repetitionLog?.at(-1)?.chase?.ids[sq('a1')], sq('a1'));
});

test('jqe physical target reduction: fixed, alternating, mutual, black-only and invalid IDs', () => {
  const end = play(position(chaseBoard), [...chaseCycle, ...chaseCycle]);
  const interval = jieqiRepeatedInterval(end);
  const evidence = Array.from(
    { length: 8 },
    (_, i) => new Set<JieqiSquare>(i % 2 === 0 ? [sq('b3')] : []),
  );
  assert.equal(jieqiChaseResponsibility(interval, evidence), 'red');
  evidence[2] = new Set([sq('h7')]);
  assert.equal(jieqiChaseResponsibility(interval, evidence), null);
  evidence[2] = evidence[0]!;
  for (let i = 1; i < 8; i += 2) evidence[i] = new Set([sq('a1')]);
  assert.equal(jieqiChaseResponsibility(interval, evidence), null);
  for (let i = 0; i < 8; i += 2) evidence[i] = new Set();
  assert.equal(jieqiChaseResponsibility(interval, evidence), 'black');
  for (const invalid of ['d0', 'e9', 'c4', 'a1']) {
    evidence[0] = new Set([sq(invalid)]);
    assert.throws(
      () => jieqiChaseResponsibility(interval, evidence),
      /absent, friendly or general/,
    );
  }
});

test('jqe monotonic boundaries: reveal resets repetition only; capture resets clock too', () => {
  const start = position({ e0: 'K', d9: 'k', a3: 'X' }, 'red', 79);
  const before = JSON.stringify(start);
  assert.equal(applyJieqiMove(start, mv('a3a7')), start);
  assert.equal(JSON.stringify(start), before);
  assert.equal(start.repetitionLog?.length, 1);
  const reveal = play(start, ['a3a4']);
  assert.equal(reveal.noCaptureClock, 80);
  assert.equal(reveal.repetitionLog?.length, 1);
  assert.equal(reveal.repetitionLog?.[0]?.chase?.ids[sq('a4')], sq('a3'));
  assert.deepEqual(reveal.status, { type: 'finished', winner: null, reason: 'no-capture-clock' });
  assert.equal(applyJieqiMove(reveal, mv('d9d8')), reveal);
  const capture = play(position({ e0: 'K', d9: 'k', a1: 'R', a2: 'p' }, 'red', 79), ['a1a2']);
  assert.equal(capture.noCaptureClock, 0);
  assert.equal(capture.repetitionLog?.length, 1);
  assert.equal(capture.repetitionLog?.[0]?.chase?.ids[sq('a2')], sq('a1'));
  assert.equal(capture.repetitionLog?.[0]?.chase?.ids[sq('a1')], undefined);
});

test('hidden true-role swaps preserve the whole public chase history and terminal verdict', () => {
  const a = position({ ...chaseBoard, c0: 'X', g0: 'X' });
  a.board[sq('c0')]!.role = 'horse';
  a.board[sq('g0')]!.role = 'cannon';
  const b = structuredClone(a);
  [b.board[sq('c0')]!.role, b.board[sq('g0')]!.role] = [
    a.board[sq('g0')]!.role,
    a.board[sq('c0')]!.role,
  ];
  for (const actor of ['red', 'black'] as const) {
    assert.deepEqual(jieqiChaseTargets(a.board, actor), jieqiChaseTargets(b.board, actor));
  }
  assert.equal(
    jieqiRepetitionPositionKey(a.board, 'red', 'jqe-v1'),
    jieqiRepetitionPositionKey(b.board, 'red', 'jqe-v1'),
  );
  const first = play(a, [...chaseCycle, ...chaseCycle]);
  const second = play(b, [...chaseCycle, ...chaseCycle]);
  assert.deepEqual(first.status, { type: 'finished', winner: 'black', reason: 'perpetual-chase' });
  assert.deepEqual(first.status, second.status);
  assert.equal(JSON.stringify(first.repetitionLog), JSON.stringify(second.repetitionLog));
});

test('jqe strict clock fixture: a dark soldier-point reveals a horse at 80 and the game stays terminal', () => {
  const state = position({ e0: 'K', d9: 'k', a3: 'X' }, 'red', 79);
  state.board[sq('a3')]!.role = 'horse';
  const end = play(state, ['a3a4']);
  assert.equal(end.board[sq('a4')]!.role, 'horse');
  assert.deepEqual(end.status, { type: 'finished', winner: null, reason: 'no-capture-clock' });
  assert.equal(applyJieqiMove(end, mv('d9d8')), end);
});

test('jqe quiet-general query has no targets; an illegal replay leaves its input untouched', () => {
  const state = position({ e0: 'K', d9: 'k' });
  assert.deepEqual(jieqiChaseTargets(state.board, 'red'), new Set());
  const before = JSON.stringify(state);
  assert.equal(applyJieqiMove(state, mv('e0a5')), state);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(jieqiRepeatedInterval(state), []);
});

test('jqe target filters: generals and soldiers do not chase, and uncrossed soldiers are exempt', () => {
  const general = position({ e0: 'K', d9: 'k', f0: 'n' });
  assert.deepEqual(jieqiChaseTargets(general.board, 'red'), new Set());
  const soldier = position({ d0: 'K', f9: 'k', a5: 'P', b5: 'n' });
  assert.deepEqual(jieqiChaseTargets(soldier.board, 'red'), new Set());
  const uncrossed = position({ d0: 'K', f9: 'k', a5: 'R', a6: 'p' });
  assert.equal(jieqiChaseTargets(uncrossed.board, 'red').has(sq('a6')), false);
  const crossed = position({ d0: 'K', f9: 'k', a5: 'R', a4: 'p' });
  assert.equal(jieqiChaseTargets(crossed.board, 'red').has(sq('a4')), true);
  const protectedTarget = position({ d0: 'K', f9: 'k', a3: 'R', b3: 'n', b9: 'r' });
  assert.equal(jieqiChaseTargets(protectedTarget.board, 'red').has(sq('b3')), false);
});

test('an unstamped check-only repetition draws where the stamped chase loses', () => {
  const old = play(position(chaseBoard, 'red', 0, false), [...chaseCycle, ...chaseCycle]);
  assert.deepEqual(old.status, { type: 'finished', winner: null, reason: 'repetition' });
  assert.deepEqual(play(position(chaseBoard), [...chaseCycle, ...chaseCycle]).status, {
    type: 'finished',
    winner: 'black',
    reason: 'perpetual-chase',
  });
});

test('hidden role swaps cannot change a dark advisor threat even when its true geometry would', () => {
  const a = position({ e0: 'K', f9: 'k', d0: 'X', a3: 'X', c1: 'r' });
  a.board[sq('d0')]!.role = 'cannon';
  a.board[sq('a3')]!.role = 'advisor';
  const b = structuredClone(a);
  [b.board[sq('d0')]!.role, b.board[sq('a3')]!.role] = [
    b.board[sq('a3')]!.role,
    b.board[sq('d0')]!.role,
  ];
  const first = jieqiChaseTargets(a.board, 'red');
  assert.equal(first.has(sq('c1')), true);
  assert.deepEqual(first, jieqiChaseTargets(b.board, 'red'));
  // The same boundary also discards an unknown placeholder, not just known deals.
  b.board[sq('d0')]!.unknown = true;
  assert.deepEqual(first, jieqiChaseTargets(b.board, 'red'));
});

test('analysis retains its explicit infinite clock override', () => {
  const state = { ...createInitialJieqiState('analysis'), noCaptureClock: 120 };
  assert.equal(
    applyJieqiMove(
      state,
      { from: 'a4', to: 'a5' },
      {
        noCaptureClockLimit: Number.POSITIVE_INFINITY,
      },
    ).status.type,
    'playing',
  );
});
