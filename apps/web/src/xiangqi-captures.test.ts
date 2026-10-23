import { createInitialXiangqiState, getStandardXiangqiPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { xiangqiCapturedFromBoard } from './xiangqi-captures.js';

describe('xiangqiCapturedFromBoard', () => {
  const start = getStandardXiangqiPlayerView(createInitialXiangqiState('t'), 'red').board;

  it('reports nothing at the opening position', () => {
    expect(xiangqiCapturedFromBoard(start)).toEqual([]);
  });

  it('reports exactly the pieces missing from the board, strongest first', () => {
    const board = { ...start };
    const squares = Object.entries(board);
    const drop = (color: string, role: string) => {
      const hit = squares.find(([sq, p]) => p?.color === color && p.role === role && sq in board);
      if (!hit) throw new Error(`no ${color} ${role}`);
      delete board[hit[0] as keyof typeof board];
    };
    drop('black', 'soldier');
    drop('black', 'chariot');
    drop('black', 'soldier');
    drop('red', 'cannon');
    expect(xiangqiCapturedFromBoard(board)).toEqual([
      { owner: 'red', role: 'cannon' },
      { owner: 'black', role: 'chariot' },
      { owner: 'black', role: 'soldier' },
      { owner: 'black', role: 'soldier' },
    ]);
  });
});
