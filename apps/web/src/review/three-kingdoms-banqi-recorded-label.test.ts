import type { ThreeKingdomsBanqiPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { recordedThreeKingdomsBanqiMoveLabel } from './three-kingdoms-banqi-review.js';

function view(board: ThreeKingdomsBanqiPlayerView['board']): ThreeKingdomsBanqiPlayerView {
  return { board } as ThreeKingdomsBanqiPlayerView;
}

describe('recorded Three Kingdoms banqi move labels', () => {
  it('names a flip by the piece it turned up, as the live room does', () => {
    const views = new Map([
      [0, view({ a1: { faceDown: true } })],
      [1, view({ a1: { faceDown: false, color: 'red', role: 'cannon' } })],
    ]);
    expect(recordedThreeKingdomsBanqiMoveLabel(views, { from: 'a1', to: 'a1' }, 0)).toBe('a1(C)');
  });

  it('keeps "(?)" when the view after the move is missing or still covered', () => {
    const covered = new Map([[0, view({ a1: { faceDown: true } })]]);
    expect(recordedThreeKingdomsBanqiMoveLabel(covered, { from: 'a1', to: 'a1' }, 0)).toBe('a1(?)');
  });

  it('labels a board move from-to', () => {
    const views = new Map([
      [0, view({})],
      [1, view({})],
    ]);
    expect(recordedThreeKingdomsBanqiMoveLabel(views, { from: 'a1', to: 'a2' }, 0)).toBe('a1-a2');
  });
});
