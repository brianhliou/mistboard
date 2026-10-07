import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSubjectColor } from './check-subject.js';
import {
  atomicXiangqiCheckedGeneral,
  atomicXiangqiStateFromFen,
} from './variants-atomic-xiangqi.js';
import {
  type FortressXiangqiBoard,
  fortressXiangqiCheckedGeneral,
} from './variants-fortress-xiangqi.js';
import {
  applyJieqiMove,
  getJieqiPlayerView,
  type JieqiBoard,
  type JieqiGameState,
  jieqiCheckedGeneral,
  jieqiMoveLabel,
} from './variants-jieqi.js';
import type { XiangqiBoard } from './variants-xiangqi.js';
import { standardXiangqiCheckedGeneral } from './variants-xiangqi-standard.js';

// The board's check glow names the general of the side facing the move, by
// each variant's own rule, from nothing but a board a client already holds.

test('the check subject is the side to move, then the loser; nobody after a draw', () => {
  assert.equal(checkSubjectColor({ type: 'playing', turn: 'black' }), 'black');
  assert.equal(checkSubjectColor({ type: 'finished', winner: 'red' }), 'black');
  assert.equal(checkSubjectColor({ type: 'finished', winner: null }), null);
  assert.equal(checkSubjectColor({ type: 'aborted' }), null);
});

const xiangqiCheck: XiangqiBoard = {
  e10: { color: 'black', role: 'general' },
  e5: { color: 'red', role: 'chariot' },
  d1: { color: 'red', role: 'general' },
};

test('xiangqi: the side to move in check, and the mated general after the game', () => {
  assert.equal(
    standardXiangqiCheckedGeneral(xiangqiCheck, { type: 'playing', turn: 'black' }),
    'e10',
  );
  assert.equal(standardXiangqiCheckedGeneral(xiangqiCheck, { type: 'playing', turn: 'red' }), null);
  assert.equal(
    standardXiangqiCheckedGeneral(xiangqiCheck, {
      type: 'finished',
      winner: 'red',
      reason: 'checkmate',
    }),
    'e10',
  );
  assert.equal(
    standardXiangqiCheckedGeneral(xiangqiCheck, {
      type: 'finished',
      winner: null,
      reason: 'repetition',
    }),
    null,
  );
});

test("atomic: a blast beside the general is check by atomic's rule, not the standard one", () => {
  const state = atomicXiangqiStateFromFen('3ak4/3R5/9/9/9/9/9/9/9/5K3 b - - 0 1', 't');
  assert.ok(state);
  assert.equal(atomicXiangqiCheckedGeneral(state.board, state.status), 'e10');
  assert.equal(
    standardXiangqiCheckedGeneral(state.board, { type: 'playing', turn: 'black' }),
    null,
  );
});

test('fortress: an attacked general on its own board', () => {
  const board: FortressXiangqiBoard = {
    b1: { color: 'red', role: 'general' },
    f8: { color: 'black', role: 'general' },
    f3: { color: 'red', role: 'chariot' },
  };
  assert.equal(fortressXiangqiCheckedGeneral(board, { type: 'playing', turn: 'black' }), 'f8');
  assert.equal(fortressXiangqiCheckedGeneral(board, { type: 'playing', turn: 'red' }), null);
});

test('jieqi: check reads the same from the masked board as from the truth', () => {
  // A face-down red piece on the b3 cannon square checks as a cannon over the
  // b5 screen, whatever it really is.
  const board: JieqiBoard = {
    e1: { color: 'red', role: 'general', faceDown: false },
    b3: { color: 'red', role: 'soldier', faceDown: true },
    b5: { color: 'black', role: 'soldier', faceDown: false },
    b10: { color: 'black', role: 'general', faceDown: false },
  };
  const status = { type: 'playing', turn: 'black' } as const;
  assert.equal(jieqiCheckedGeneral(board, status), 'b10');
  const masked = getJieqiPlayerView(
    { id: 't', board, status, moveNumber: 1, noCaptureClock: 0, captures: [] },
    'red',
  ).board;
  assert.equal(jieqiCheckedGeneral(masked, status), 'b10');
  assert.equal(jieqiCheckedGeneral(masked, { type: 'playing', turn: 'red' }), null);
});

test('jieqi move labels carry + for check and # for mate', () => {
  const position = (board: JieqiBoard): JieqiGameState => ({
    id: 't',
    board,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    noCaptureClock: 0,
    captures: [],
  });
  const up = (color: 'red' | 'black', role: 'general' | 'chariot') => ({
    color,
    role,
    faceDown: false,
  });
  const check = position({
    d1: up('red', 'general'),
    f10: up('black', 'general'),
    a1: up('red', 'chariot'),
  });
  const checking = { from: 'a1', to: 'a10' } as const;
  assert.equal(jieqiMoveLabel(checking, applyJieqiMove(check, checking)), 'a1-a10+');
  const quiet = { from: 'a1', to: 'a2' } as const;
  assert.equal(jieqiMoveLabel(quiet, applyJieqiMove(check, quiet)), 'a1-a2');

  const mate = position({
    e10: up('black', 'general'),
    e3: up('red', 'chariot'),
    a10: up('red', 'chariot'),
    g5: up('red', 'chariot'),
    f2: up('red', 'general'),
  });
  const mating = { from: 'g5', to: 'g10' } as const;
  assert.equal(jieqiMoveLabel(mating, applyJieqiMove(mate, mating)), 'g5-g10#');
});
