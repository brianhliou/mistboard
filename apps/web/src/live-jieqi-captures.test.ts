import { describe, expect, it } from 'vitest';
import { type JieqiWireView, renderJieqiMaterial } from './live-jieqi.js';

// Locks the material picture the jieqi room builds. Jieqi positions are public
// but identities are hidden, so a captured piece is either revealed (the captor
// learns its role) or still "?" to this viewer (an opponent took a dark piece,
// so its role arrives as null). The face-down pool inherits that asymmetry: the
// opponent's pool is exact, the viewer's own pool still lists the dark pieces
// the opponent took and says so.

function slots() {
  return {
    capturesTop: document.createElement('div'),
    capturesBottom: document.createElement('div'),
    hiddenPool: document.createElement('div'),
  };
}

function labels(el: HTMLElement): (string | null)[] {
  return [...el.querySelectorAll<HTMLElement>('.review-capture-piece')].map((span) =>
    span.getAttribute('aria-label'),
  );
}

// As RED sees it: black took red's chariot while it was face-up (public), then
// took one of red's dark pieces (role null to red); red took black's horse.
const asRed: JieqiWireView = {
  id: 'jieqi-material',
  perspective: 'red',
  board: {
    e1: { color: 'red', role: 'general', faceDown: false },
    e10: { color: 'black', role: 'general', faceDown: false },
    a1: { color: 'red', faceDown: true },
    a10: { color: 'black', faceDown: true },
    e5: { color: 'black', role: 'cannon', faceDown: false },
  },
  legalMoves: [],
  captured: [
    { owner: 'red', role: 'chariot' },
    { owner: 'red', role: null },
    { owner: 'black', role: 'horse' },
  ],
  inCheck: false,
  status: { type: 'playing', turn: 'red' },
  moveNumber: 9,
};

describe('renderJieqiMaterial', () => {
  it('draws the viewer losses on top with a shrouded tile for the unknown one', () => {
    const s = slots();
    renderJieqiMaterial(s, asRed, 'red');
    expect(labels(s.capturesTop)).toEqual(['red chariot', 'red hidden piece']);
    expect(labels(s.capturesBottom)).toEqual(['black horse']);
    // The unknown tile is the board's face-down disc, not a "?" glyph.
    const hidden = s.capturesTop.querySelector('[aria-label="red hidden piece"]');
    expect(hidden?.querySelector('.xq-piece-back-mark')).not.toBeNull();
    expect(hidden?.textContent).not.toContain('?');
  });

  it('renders no face-down pool: the own side cannot be computed under capturer-only reveal', () => {
    const s = slots();
    renderJieqiMaterial(s, asRed, 'red');
    expect(s.hiddenPool.childElementCount).toBe(0);
  });

  it('shows nothing for an empty board: no information is not a full pool', () => {
    const s = slots();
    renderJieqiMaterial(s, { ...asRed, board: {}, captured: [] }, 'red');
    expect(s.hiddenPool.childElementCount).toBe(0);
  });

  it('clears every slot when there is no view', () => {
    const s = slots();
    renderJieqiMaterial(s, asRed, 'red');
    renderJieqiMaterial(s, null, 'red');
    expect(s.capturesTop.childElementCount).toBe(0);
    expect(s.capturesBottom.childElementCount).toBe(0);
    expect(s.hiddenPool.childElementCount).toBe(0);
  });
});
