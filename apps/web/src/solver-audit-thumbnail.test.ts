import { applyStandardXiangqiMove, importXiangqiGame } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { RECORD_011, RECORD_011_KEY, solverAuditArticle } from './articles/content/solver-audit.js';

// The card claims a position and a move: 適情雅趣 第011局 at its diagram, and the
// book's key, the chariot from c8 to c10. The kernel has to agree, or the picture
// is a second, wrong copy of the composition.
describe('solver-audit card', () => {
  it('draws the book key, and the book line replays to Red mating', () => {
    const imported = importXiangqiGame(RECORD_011);
    expect(imported.error).toBeUndefined();
    expect(imported.initialState?.board.c8).toEqual({ color: 'red', role: 'chariot' });
    expect(imported.initialState?.board.d10).toEqual({ color: 'black', role: 'general' });
    expect(imported.moves[0]).toMatchObject(RECORD_011_KEY);

    let state = imported.initialState!;
    for (const move of imported.moves) state = applyStandardXiangqiMove(state, move);
    expect(imported.moves).toHaveLength(13);
    expect(state.status).toMatchObject({ type: 'finished', winner: 'red' });
  });

  it('renders the crop with its key arrow', () => {
    const thumb = solverAuditArticle.thumbnail;
    if (thumb?.kind !== 'svg') throw new Error('expected an svg thumbnail');
    const svg = typeof thumb.svg === 'function' ? thumb.svg('en') : thumb.svg;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('marker id="xq-arrow-c8-c10-0"');
  });
});
