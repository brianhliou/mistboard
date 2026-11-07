import {
  createInitialFFQBanqiState,
  type FFQBanqiPlayerView,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  ffqBanqiBoardView,
  ffqBanqiClickResult,
  ffqBanqiIndex,
  ffqBanqiSquare,
} from './ffq-banqi-board.js';

function view(): FFQBanqiPlayerView {
  return getFFQBanqiPlayerView(createInitialFFQBanqiState('ffqb_test', 7), 'red');
}

describe('FFQ banqi board adapter', () => {
  it('rotates the 4 by 8 indices bijectively onto the standard banqi board', () => {
    const squares = Array.from({ length: 32 }, (_, index) => ffqBanqiSquare(index));
    expect(new Set(squares).size).toBe(32);
    expect(squares.map(ffqBanqiIndex)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect([ffqBanqiSquare(0), ffqBanqiSquare(3), ffqBanqiSquare(4), ffqBanqiSquare(31)]).toEqual([
      'a1',
      'a4',
      'b1',
      'h4',
    ]);
    expect(() => ffqBanqiSquare(32)).toThrow();
    expect(() => ffqBanqiIndex('i1')).toThrow();
  });

  it('keeps the entire projected view masked, including at game end', () => {
    const source = view();
    source.status = { type: 'finished', winner: 'red', reason: 'hp' };
    const projected = ffqBanqiBoardView(source);
    for (const [index, entry] of source.board.entries()) {
      if (entry?.faceDown)
        expect(projected.board[ffqBanqiSquare(index)]).toEqual({ faceDown: true });
    }
    expect(projected.firstColor).toBe('red');
    expect(JSON.parse(JSON.stringify(projected)).board).toEqual(projected.board);
  });

  it('uses fixed red ink, selects moves, clears selection and flips directly', () => {
    const source = view();
    source.board[0] = { color: 'red', role: 'chariot', faceDown: false };
    source.board[1] = null;
    source.legalMoves = [
      { from: 0, to: 1 },
      { from: 4, to: 4 },
    ];
    expect(ffqBanqiClickResult(source, 'red', null, 'a1')).toEqual({
      kind: 'select',
      square: 'a1',
    });
    expect(ffqBanqiClickResult(source, 'red', 'a1', 'a2')).toEqual({
      kind: 'move',
      move: { from: 'a1', to: 'a2' },
    });
    expect(ffqBanqiClickResult(source, 'red', 'a1', 'a1')).toEqual({ kind: 'clear' });
    expect(ffqBanqiClickResult(source, 'red', null, 'b1')).toEqual({
      kind: 'move',
      move: { from: 'b1', to: 'b1' },
    });
    for (const seat of ['black', 'spectator']) {
      expect(ffqBanqiClickResult(source, seat, 'a1', 'a2')).toEqual({ kind: 'noop' });
    }
  });

  it('projects forbidden numeric moves and selects a piece whose only move is forbidden', () => {
    const source = view();
    source.board[0] = { color: 'red', role: 'chariot', faceDown: false };
    source.board[1] = null;
    source.legalMoves = [];
    source.forbiddenMoves = [{ from: 0, to: 1 }];
    expect(ffqBanqiBoardView(source).forbiddenMoves).toEqual([{ from: 'a1', to: 'a2' }]);
    expect(ffqBanqiClickResult(source, 'red', null, 'a1')).toEqual({
      kind: 'select',
      square: 'a1',
    });
    expect(ffqBanqiClickResult(source, 'red', 'a1', 'a2')).toEqual({
      kind: 'forbidden',
      move: { from: 'a1', to: 'a2' },
    });
  });

  it('gives a selected cannon capture priority over flipping its covered target', () => {
    const source = view();
    source.board[0] = { color: 'red', role: 'cannon', faceDown: false };
    source.board[2] = { faceDown: true };
    source.legalMoves = [
      { from: 0, to: 2 },
      { from: 2, to: 2 },
    ];
    expect(ffqBanqiClickResult(source, 'red', 'a1', 'a3')).toEqual({
      kind: 'move',
      move: { from: 'a1', to: 'a3' },
    });
    expect(ffqBanqiClickResult(source, 'red', null, 'a3')).toEqual({
      kind: 'move',
      move: { from: 'a3', to: 'a3' },
    });
    expect(ffqBanqiClickResult(source, 'black', 'a1', 'a3')).toEqual({ kind: 'noop' });
    source.status = { type: 'finished', winner: 'black', reason: 'hp' };
    expect(ffqBanqiClickResult(source, 'red', 'a1', 'a3')).toEqual({ kind: 'noop' });
  });
});
