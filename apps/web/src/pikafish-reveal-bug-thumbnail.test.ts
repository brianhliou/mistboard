import { getJieqiLegalMoves, parseJieqiFen } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  pikafishRevealBugArticle,
  REVEAL_BUG_FEN,
} from './articles/content/pikafish-reveal-bug.js';

// The card claims a position: match game 108 just after Pikafish (Black) moved the
// face-down piece on d10 up to e9 and turned over a chariot, where it needed an
// advisor, and Red's chariot on f9 can mate on f10. The kernel has to agree, or
// the picture is a second, wrong copy of the game.
describe('pikafish-reveal-bug card', () => {
  it('is the position after the reveal, with the mate on f10 legal', () => {
    const parsed = parseJieqiFen(REVEAL_BUG_FEN);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.status).toEqual({ type: 'playing', turn: 'red' });
    expect(parsed.state.board.d10).toBeUndefined();
    expect(parsed.state.board.e9).toMatchObject({
      color: 'black',
      role: 'chariot',
      faceDown: false,
    });
    expect(parsed.state.board.f9).toMatchObject({ color: 'red', role: 'chariot', faceDown: false });
    expect(parsed.state.board.e10).toMatchObject({ color: 'black', role: 'general' });
    const legal = getJieqiLegalMoves(parsed.state).map((move) => `${move.from}${move.to}`);
    expect(legal).toContain('f9f10');
  });

  it('renders the crop with both arrows', () => {
    const thumb = pikafishRevealBugArticle.thumbnail;
    if (thumb?.kind !== 'svg') throw new Error('expected an svg thumbnail');
    const svg = typeof thumb.svg === 'function' ? thumb.svg('en') : thumb.svg;
    expect(svg).toContain('aria-label="Pikafish moves the face-down piece on d10 up to e9');
  });
});
