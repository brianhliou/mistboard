import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPlayerView,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPlayerView,
  jieqiMoveLabel,
} from './variants-jieqi.js';
import type { XiangqiNotationStyle } from './xiangqi-notation-format.js';

const STYLES: XiangqiNotationStyle[] = [
  'coordinate',
  'iccs',
  'algebraic',
  'wxf',
  'chinese-simplified',
  'chinese-traditional',
];

function position(board: JieqiGameState['board'], turn: 'red' | 'black' = 'red') {
  return {
    ...createInitialJieqiState('notation'),
    board: {
      e1: { color: 'red', role: 'general', faceDown: false },
      f10: { color: 'black', role: 'general', faceDown: false },
      ...board,
    },
    status: { type: 'playing', turn },
  } satisfies JieqiGameState;
}

function label(
  before: JieqiPlayerView,
  move: JieqiMove,
  after: JieqiPlayerView,
  style: XiangqiNotationStyle,
): string {
  return jieqiMoveLabel(move, after, { before, style });
}

function labels(state: JieqiGameState, move: JieqiMove) {
  assert.equal(state.status.type, 'playing');
  const side = state.status.type === 'playing' ? state.status.turn : 'red';
  const before = getJieqiPlayerView(state, side);
  const afterState = applyJieqiMove(state, move);
  assert.notEqual(afterState, state, 'fixture move must be legal');
  const after = getJieqiPlayerView(afterState, side);
  return STYLES.map((style) => label(before, move, after, style));
}

test('revealed pieces honor every notation style, including captures', () => {
  const state = position({
    e3: { color: 'red', role: 'cannon', faceDown: false },
    e5: { color: 'red', role: 'soldier', faceDown: false },
    e7: { color: 'black', role: 'horse', faceDown: false },
  });
  assert.deepEqual(labels(state, { from: 'e3', to: 'e7' }), [
    'e3-e7',
    'e2e6',
    'Cxe7',
    'C5+4',
    '炮五进四',
    '炮五進四',
  ]);
});

test('black file direction and Chinese script follow the selected style', () => {
  const state = position({ h8: { color: 'black', role: 'horse', faceDown: false } }, 'black');
  assert.deepEqual(labels(state, { from: 'h8', to: 'g6' }), [
    'h8-g6',
    'h7g5',
    'Hg6',
    'H8+7',
    '马8进7',
    '馬8進7',
  ]);
});

test('face-down movers keep coordinates even when the move reveals them', () => {
  for (const role of ['horse', 'chariot', 'soldier'] as const) {
    const state = position({ h3: { color: 'red', role, faceDown: true } });
    assert.deepEqual(labels(state, { from: 'h3', to: 'e3' }), [
      'h3-e3',
      'h2e2',
      'h3-e3',
      'h3-e3',
      'h3-e3',
      'h3-e3',
    ]);
  }
});

test('hidden targets and same-color hidden pieces never affect the serialized labels', () => {
  const results = [];
  for (const role of ['horse', 'chariot', 'cannon', 'soldier'] as const) {
    const state = position({
      a5: { color: 'red', role: 'chariot', faceDown: false },
      a10: { color: 'black', role, faceDown: true },
      a1: { color: 'red', role, faceDown: true },
    });
    results.push(JSON.stringify(labels(state, { from: 'a5', to: 'a10' })));
    const moved = applyJieqiMove(state, { from: 'a5', to: 'a10' });
    const before = getJieqiPlayerView(state, 'red');
    const capturer = getJieqiPlayerView(moved, 'red');
    const victim = getJieqiPlayerView(moved, 'black');
    assert.notEqual(capturer.captured[0]?.role, victim.captured[0]?.role);
    for (const style of STYLES) {
      assert.equal(
        label(before, { from: 'a5', to: 'a10' }, capturer, style),
        label(before, { from: 'a5', to: 'a10' }, victim, style),
      );
    }
  }
  assert.equal(new Set(results).size, 1);
  assert.equal(JSON.parse(results[0]!)[2], 'Rxa10+');
});

test('a masked rival is never assigned its hidden identity for disambiguation', () => {
  const move: JieqiMove = { from: 'b3', to: 'e3' };
  for (const role of ['cannon', 'horse'] as const) {
    const state = position({
      b3: { color: 'red', role: 'cannon', faceDown: false },
      h3: { color: 'red', role, faceDown: true },
    });
    const before = getJieqiPlayerView(state, 'red');
    const after = getJieqiPlayerView(applyJieqiMove(state, move), 'red');
    // Even accidental truth fields must not be read on a face-down entry.
    Object.defineProperty(before.board.h3!, 'role', {
      get: () => {
        throw new Error('read hidden identity');
      },
    });
    assert.equal(label(before, move, after, 'algebraic'), 'Ce3');
    assert.equal(label(before, move, after, 'wxf'), 'C8.5');
  }
});

test('a revealed piece uses its new identity only on subsequent moves', () => {
  const state = position({ h3: { color: 'red', role: 'horse', faceDown: true } });
  const first: JieqiMove = { from: 'h3', to: 'e3' };
  const revealed = applyJieqiMove(state, first);
  const next = applyJieqiMove(revealed, { from: 'f10', to: 'f9' });
  assert.notEqual(next, revealed);
  assert.equal(labels(state, first)[2], 'h3-e3');
  assert.deepEqual(labels(next, { from: 'e3', to: 'g4' }), [
    'e3-g4',
    'e2g3',
    'Hg4',
    'H5+3',
    '马五进三',
    '馬五進三',
  ]);
});

test('algebraic disambiguation and relative tandem selectors use revealed pieces', () => {
  const state = position({
    h3: { color: 'red', role: 'chariot', faceDown: false },
    h5: { color: 'red', role: 'chariot', faceDown: false },
  });
  assert.deepEqual(labels(state, { from: 'h3', to: 'h4' }), [
    'h3-h4',
    'h2h3',
    'R3h4',
    '-R+1',
    '后车进一',
    '後車進一',
  ]);
});

test('revealed advisors and elephants use Jieqi legal moves beyond standard confinement', () => {
  const advisor = position({ d5: { color: 'red', role: 'advisor', faceDown: false } });
  assert.deepEqual(labels(advisor, { from: 'd5', to: 'e6' }), [
    'd5-e6',
    'd4e5',
    'Ae6',
    'A6+5',
    '仕六进五',
    '仕六進五',
  ]);
  const elephant = position({ c5: { color: 'red', role: 'elephant', faceDown: false } });
  assert.deepEqual(labels(elephant, { from: 'c5', to: 'e7' }), [
    'c5-e7',
    'c4e6',
    'Ee7',
    'E7+5',
    '相七进五',
    '相七進五',
  ]);
});

test('public check and mate marks survive without deriving a hidden identity', () => {
  const state = position({ a5: { color: 'red', role: 'chariot', faceDown: false } });
  const move: JieqiMove = { from: 'a5', to: 'a10' };
  const before = getJieqiPlayerView(state, 'red');
  const after = getJieqiPlayerView(applyJieqiMove(state, move), 'red');
  assert.equal(label(before, move, after, 'algebraic'), 'Ra10+');
  assert.equal(label(before, move, after, 'wxf'), 'R9+5');
  assert.equal(jieqiMoveLabel(move, after), 'a5-a10+');
  const mate: JieqiPlayerView = {
    ...after,
    status: { type: 'finished', reason: 'checkmate', winner: 'red' },
  };
  assert.equal(label(before, move, mate, 'algebraic'), 'Ra10#');
});

test('missing or mismatched pre-move context falls back to coordinates', () => {
  const state = position({ a5: { color: 'red', role: 'chariot', faceDown: false } });
  const move: JieqiMove = { from: 'a5', to: 'a6' };
  const before = getJieqiPlayerView(state, 'red');
  const after = getJieqiPlayerView(applyJieqiMove(state, move), 'red');
  assert.equal(label({ ...before, legalMoves: [] }, move, after, 'algebraic'), 'a5-a6');
  assert.equal(label(after, move, after, 'wxf'), 'a5-a6');
  assert.equal(
    label({ ...before, status: { type: 'playing', turn: 'black' } }, move, after, 'wxf'),
    'a5-a6',
  );
});
