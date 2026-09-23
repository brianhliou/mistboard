// A played record replays past the draws an arbiter decides. The 2026 men's
// league round 6 board 7 hit the kernel's threefold at ply 199 and Red won at
// ply 211; the review cut it at 199 and called it a truncated import.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  type XiangqiGameState,
  type XiangqiMove,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { createGameTree } from './game-tree.js';
import { buildXiangqiReplayFromMoves } from './xiangqi-review-model.js';
import {
  resumeAdjudicatedDraw,
  xiangqiRecordTreeAdapter,
  xiangqiTreeAdapter,
} from './xiangqi-tree-adapter.js';

const m = (from: string, to: string) => ({ from, to }) as XiangqiMove;

// Both horses out and back twice: the start position comes round a third time
// at ply 8, which the kernel scores as a repetition draw. Then the game goes on.
const SHUFFLE = [m('h1', 'g3'), m('h10', 'g8'), m('g3', 'h1'), m('g8', 'h10')];
const RECORD = [...SHUFFLE, ...SHUFFLE, m('b3', 'e3'), m('b8', 'e8')];

function stateAfter(moves: readonly XiangqiMove[]): XiangqiGameState {
  return moves.reduce(
    (state, move) => applyStandardXiangqiMove(resumeAdjudicatedDraw(state), move),
    createInitialXiangqiState('t'),
  );
}

describe('played-record replay', () => {
  it('the kernel calls the shuffle a repetition draw', () => {
    const tree = createGameTree(xiangqiTreeAdapter, RECORD);
    expect(tree.mainlinePath().length).toBe(8);
    const drawn = stateAfter(RECORD.slice(0, 8));
    expect(drawn.status).toMatchObject({ type: 'finished', reason: 'repetition' });
  });

  it('the record adapter plays on past it, with the right side to move', () => {
    const tree = createGameTree(xiangqiRecordTreeAdapter, RECORD);
    expect(tree.mainlinePath().length).toBe(RECORD.length);
    expect(resumeAdjudicatedDraw(stateAfter(RECORD.slice(0, 8))).status).toEqual({
      type: 'playing',
      turn: 'red',
    });
    const replay = buildXiangqiReplayFromMoves(RECORD, undefined, { record: true });
    expect(replay.maxPly).toBe(RECORD.length);
    expect(replay.illegalAt).toBeUndefined();
    expect(buildXiangqiReplayFromMoves(RECORD).maxPly).toBe(8);
  });

  it('checkmate stays terminal', () => {
    const mated: XiangqiGameState = {
      ...createInitialXiangqiState('t'),
      status: { type: 'finished', winner: 'red', reason: 'checkmate' },
      lastMove: m('h1', 'g3'),
    } as XiangqiGameState;
    expect(resumeAdjudicatedDraw(mated)).toBe(mated);
  });
});
