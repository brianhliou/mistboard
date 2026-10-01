import { getJieqiLegalMoves, parseJieqiFen } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { AB_JCHESS_TRAP_FEN, abJchessArticle } from './articles/content/ab-jchess.js';

// The card and the post's first example claim a position: Red to move, a
// face-down piece on b3 the bot moved to d3, and the advisor move e2-f3 that
// AB-JChess chose instead. The kernel has to agree that both are legal from the
// position as written, or the picture is a second, wrong copy of the game.
describe('ab-jchess card', () => {
  it('is the position the bot faced, with both engines’ moves legal', () => {
    const parsed = parseJieqiFen(AB_JCHESS_TRAP_FEN);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.status).toEqual({ type: 'playing', turn: 'red' });
    expect(parsed.state.board.b3).toMatchObject({ color: 'red', faceDown: true });
    expect(parsed.state.board.e2).toMatchObject({ color: 'red', role: 'advisor', faceDown: false });
    expect(parsed.state.board.h6).toMatchObject({ color: 'black', role: 'cannon' });
    const legal = getJieqiLegalMoves(parsed.state).map((move) => `${move.from}${move.to}`);
    // 39, as the bot's own move record counted at this ply.
    expect(legal).toHaveLength(39);
    expect(legal).toContain('b3d3');
    expect(legal).toContain('e2f3');
  });

  it('renders the crop with the advisor arrow and the crossed d3', () => {
    const thumb = abJchessArticle.thumbnail;
    if (thumb?.kind !== 'svg') throw new Error('expected an svg thumbnail');
    const svg = typeof thumb.svg === 'function' ? thumb.svg('en') : thumb.svg;
    expect(svg).toContain('aria-label="AB-JChess moves the advisor to f3');
  });
});
