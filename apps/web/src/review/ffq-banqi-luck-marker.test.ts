import type { BanqiMove } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { ffqBanqiSquare } from '../ffq-banqi-board.js';
import { ffqBanqiLuckMarker } from './ffq-banqi-review.js';
import type { FFQBanqiReviewSnapshot } from './ffq-banqi-tree-adapter.js';

// The marker reads only the masked board, so a fixture needs nothing else.
type Cell = { faceDown: true } | { faceDown: false; color: 'red' | 'black'; role: string } | null;
function snapshot(cells: Record<number, Cell>): FFQBanqiReviewSnapshot {
  const board = Array.from({ length: 32 }, (_, i) => cells[i] ?? null);
  return {
    ply: 0,
    fen: '',
    damage: { red: 0, black: 0 },
    view: { board },
  } as unknown as FFQBanqiReviewSnapshot;
}
const move = (from: number, to: number) =>
  ({ from: ffqBanqiSquare(from), to: ffqBanqiSquare(to) }) as BanqiMove;

describe('Fanfanqi review luck die on the board', () => {
  it('marks a flip on the flipped square', () => {
    expect(
      ffqBanqiLuckMarker(move(6, 6), { luck: 12.5, before: snapshot({ 6: { faceDown: true } }) }),
    ).toEqual({ square: ffqBanqiSquare(6), kind: 'luck', luck: { luck: 12.5 } });
  });

  it('marks a capture of a covered piece on the square it lands on', () => {
    const view = snapshot({
      5: { faceDown: false, color: 'red', role: 'chariot' },
      6: { faceDown: true },
    });
    expect(ffqBanqiLuckMarker(move(5, 6), { luck: -8, before: view })).toEqual({
      square: ffqBanqiSquare(6),
      kind: 'luck',
      luck: { luck: -8 },
    });
  });

  it('never marks a move that drew nothing, even with a stale score', () => {
    const view = snapshot({
      5: { faceDown: false, color: 'red', role: 'chariot' },
      6: { faceDown: false, color: 'black', role: 'horse' },
    });
    expect(ffqBanqiLuckMarker(move(5, 6), { luck: 4, before: view })).toBeNull();
    expect(ffqBanqiLuckMarker(move(5, 9), { luck: 4, before: view })).toBeNull();
  });
});
