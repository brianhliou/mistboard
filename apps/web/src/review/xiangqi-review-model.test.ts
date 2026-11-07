import {
  createInitialStandardXiangqiState,
  createInitialXiangqiState,
  type XiangqiGameState,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  buildXiangqiReplayFromMoves,
  parseXiangqiCoordinateMoves,
  xiangqiReplayViewAtPly,
} from './xiangqi-review-model.js';

describe('parseXiangqiCoordinateMoves', () => {
  it('parses concat, dashed, and numbered coordinate tokens', () => {
    const { moves, error } = parseXiangqiCoordinateMoves('1. b3e3 h8-e8\n2. b1c3');
    expect(error).toBeUndefined();
    expect(moves).toEqual([
      { from: 'b3', to: 'e3' },
      { from: 'h8', to: 'e8' },
      { from: 'b1', to: 'c3' },
    ]);
  });

  it('handles rank-10 squares unambiguously', () => {
    const { moves, error } = parseXiangqiCoordinateMoves('a10a9');
    expect(error).toBeUndefined();
    expect(moves).toEqual([{ from: 'a10', to: 'a9' }]);
  });

  it('reports the first unparseable token and keeps the prefix', () => {
    const { moves, error } = parseXiangqiCoordinateMoves('b3e3 wat');
    expect(moves).toEqual([{ from: 'b3', to: 'e3' }]);
    expect(error).toMatch(/wat/);
  });
});

describe('buildXiangqiReplayFromMoves', () => {
  // A legal 3-ply opening: red central cannon, black central cannon, red horse.
  const opening = [
    { from: 'b3', to: 'e3' } as const,
    { from: 'h8', to: 'e8' } as const,
    { from: 'b1', to: 'c3' } as const,
  ];

  it('snapshots one truth view per ply, start inclusive', () => {
    const replay = buildXiangqiReplayFromMoves([...opening]);
    expect(replay.illegalAt).toBeUndefined();
    expect(replay.maxPly).toBe(3);
    expect(replay.views).toHaveLength(4); // plies 0..3
  });

  it('actually applies the moves on the truth board', () => {
    const replay = buildXiangqiReplayFromMoves([...opening]);
    expect(xiangqiReplayViewAtPly(replay, 0).board.b3).toEqual({ color: 'red', role: 'cannon' });
    const afterFirst = xiangqiReplayViewAtPly(replay, 1);
    expect(afterFirst.board.b3).toBeUndefined();
    expect(afterFirst.board.e3).toEqual({ color: 'red', role: 'cannon' });
    expect(xiangqiReplayViewAtPly(replay, 3).board.c3).toEqual({ color: 'red', role: 'horse' });
  });

  it('stops at the first illegal move and records where', () => {
    const replay = buildXiangqiReplayFromMoves([
      { from: 'b1', to: 'b2' }, // red horse cannot step one square straight
    ]);
    expect(replay.maxPly).toBe(0);
    expect(replay.views).toHaveLength(1);
    expect(replay.illegalAt).toEqual({ ply: 1, move: { from: 'b1', to: 'b2' } });
  });

  it('clamps out-of-range plies to the ends', () => {
    const replay = buildXiangqiReplayFromMoves([...opening]);
    expect(xiangqiReplayViewAtPly(replay, -5)).toBe(replay.views[0]);
    expect(xiangqiReplayViewAtPly(replay, 99)).toBe(replay.views[3]);
  });
});

describe('stored standard xiangqi progress rules', () => {
  it('keeps a new game playing at ply 60 and preserves its stamp in review', () => {
    const start = { ...createInitialStandardXiangqiState('new-review'), progressClock: 59 };
    const replay = buildXiangqiReplayFromMoves([{ from: 'a1', to: 'a2' }], start);
    expect(replay.views[1]?.status.type).toBe('playing');
    expect(replay.views[1]?.progressClockLimit).toBe(120);
    const boundary = buildXiangqiReplayFromMoves([{ from: 'a1', to: 'a2' }], {
      ...start,
      progressClock: 119,
    });
    expect(boundary.views[1]?.status).toEqual({
      type: 'finished',
      winner: null,
      reason: 'progress-clock',
    });
  });

  it('keeps an unstamped stored game on its 60-ply rule', () => {
    const start: XiangqiGameState = {
      ...createInitialXiangqiState('old-review'),
      progressClock: 59,
    };
    const replay = buildXiangqiReplayFromMoves([{ from: 'a1', to: 'a2' }], start);
    expect(replay.views[1]?.progressClockLimit).toBe(60);
    expect(replay.views[1]?.status).toEqual({
      type: 'finished',
      winner: null,
      reason: 'progress-clock',
    });
  });
});
