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
  });

  it('lists an exact opponent pool and an own pool that carries the unseen capture', () => {
    const s = slots();
    renderJieqiMaterial(s, asRed, 'red');
    const rows = [...s.hiddenPool.querySelectorAll<HTMLElement>('.hidden-pool__row')];
    expect(rows.map((row) => row.dataset.ink)).toEqual(['black', 'red']);
    // Black: 15 dark pieces minus the revealed cannon minus the captured horse;
    // the general is never in the pool.
    expect(labels(rows[0]!)).toEqual([
      'Black chariot x2',
      'Black cannon',
      'Black horse',
      'Black elephant x2',
      'Black advisor x2',
      'Black soldier x5',
    ]);
    expect(rows[0]!.querySelector('.hidden-pool__note')).toBeNull();
    // Red: 15 minus the chariot red saw taken. The dark piece black took is
    // still listed (red cannot subtract it) and the note says so.
    expect(labels(rows[1]!)).toEqual([
      'Red chariot',
      'Red cannon x2',
      'Red horse x2',
      'Red elephant x2',
      'Red advisor x2',
      'Red soldier x5',
    ]);
    expect(rows[1]!.querySelector('.hidden-pool__note')?.textContent).toBe(
      '1 of these already taken, unknown which',
    );
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
