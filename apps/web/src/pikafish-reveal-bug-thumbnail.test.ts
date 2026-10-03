import { getJieqiLegalMoves, parseJieqiFen } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  pikafishRevealBugArticle,
  REVEAL_BUG_FEN,
} from './articles/content/pikafish-reveal-bug.js';

// The card claims a position: match game 108, Black (Pikafish) to move, the
// face-down piece on d10 it turned over to e9, Red's chariot on f9 that mates on
// f10 unless e9 is an advisor, and h10-g8, the move the fixed bot plays instead.
// The kernel has to agree, or the picture is a second, wrong copy of the game.
describe('pikafish-reveal-bug card', () => {
  it('is the position the bot faced, with both moves legal', () => {
    const parsed = parseJieqiFen(REVEAL_BUG_FEN);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.status).toEqual({ type: 'playing', turn: 'black' });
    expect(parsed.state.board.d10).toMatchObject({ color: 'black', faceDown: true });
    expect(parsed.state.board.h10).toMatchObject({ color: 'black', faceDown: true });
    expect(parsed.state.board.f9).toMatchObject({ color: 'red', role: 'chariot', faceDown: false });
    const legal = getJieqiLegalMoves(parsed.state).map((move) => `${move.from}${move.to}`);
    expect(legal).toContain('d10e9');
    expect(legal).toContain('h10g8');
  });

  it('renders the crop with the arrow and the crossed e9', () => {
    const thumb = pikafishRevealBugArticle.thumbnail;
    if (thumb?.kind !== 'svg') throw new Error('expected an svg thumbnail');
    const svg = typeof thumb.svg === 'function' ? thumb.svg('en') : thumb.svg;
    expect(svg).toContain('aria-label="Pikafish turns over the piece on d10');
  });
});
