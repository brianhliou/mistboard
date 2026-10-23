import {
  getStandardXiangqiLegalMoves,
  isStandardXiangqiGeneralInCheck,
  type XiangqiGameState,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  BLACK_STALEMATE_ICCS,
  replayStalemate,
  shortestStalemateXiangqiArticle,
} from './content/shortest-stalemate-xiangqi.js';

// The article's claims about both final positions, re-read from the kernel:
// the length, who is stalemated, and the piece counts the prose states.
const count = (state: XiangqiGameState, color: 'red' | 'black') =>
  Object.values(state.board).filter((piece) => piece?.color === color).length;

describe('shortest stalemate article', () => {
  it('Black is stalemated after 21 plies with eight pieces left', () => {
    const state = replayStalemate(BLACK_STALEMATE_ICCS);
    expect(BLACK_STALEMATE_ICCS.split(' ')).toHaveLength(21);
    expect(state.status).toMatchObject({ type: 'finished', winner: 'red', reason: 'stalemate' });
    expect(isStandardXiangqiGeneralInCheck(state, 'black')).toBe(false);
    expect(count(state, 'black')).toBe(8);
    expect(count(state, 'red')).toBe(15);
  });


  it('a line that stops one ply early is still playable (the stalemate is the last move)', () => {
    const black = replayStalemate(BLACK_STALEMATE_ICCS.split(' ').slice(0, -1).join(' '));
    expect(black.status.type).toBe('playing');
    expect(getStandardXiangqiLegalMoves(black).length).toBeGreaterThan(0);
  });

  it('ends on the CTA buttons', () => {
    const blocks = (shortestStalemateXiangqiArticle.sections ?? []).flatMap((s) => s.blocks ?? []);
    expect(blocks[blocks.length - 1]?.kind).toBe('cta');
  });
});
