import { describe, expect, it } from 'vitest';
import { type BanqiWireView, renderBanqiMaterial } from './live-banqi.js';

// Locks the material picture the banqi room builds: which strip holds whose
// losses, and the face-down pool under them. Banqi captures only ever remove
// REVEALED pieces, so every captured piece has a known identity (no "?" case,
// the contrast with jieqi) and the pool is exact for both seats.

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

const midgame: BanqiWireView = {
  id: 'banqi-material',
  perspective: 'red',
  board: {
    a1: { color: 'red', role: 'chariot', faceDown: false },
    b1: { color: 'black', role: 'horse', faceDown: false },
    c1: { faceDown: true },
    d1: { faceDown: true },
  },
  legalMoves: [],
  captured: [
    { owner: 'black', role: 'soldier' },
    { owner: 'red', role: 'cannon' },
    { owner: 'black', role: 'soldier' },
  ],
  status: { type: 'playing', turn: 'red' },
  ply: 6,
  firstColor: 'red',
  moveNumber: 4,
};

describe('renderBanqiMaterial', () => {
  it('puts the viewer losses on top, the opponent losses below, and the pool under both', () => {
    const s = slots();
    renderBanqiMaterial(s, midgame, 'red');
    expect(labels(s.capturesTop)).toEqual(['red cannon']);
    expect(labels(s.capturesBottom)).toEqual(['black soldier x2']);
    const rows = [...s.hiddenPool.querySelectorAll<HTMLElement>('.hidden-pool__row')];
    expect(rows.map((row) => row.dataset.ink)).toEqual(['black', 'red']);
    // Black: 16 minus the revealed horse minus two captured soldiers.
    expect(labels(rows[0]!)).toEqual([
      'Black general',
      'Black advisor x2',
      'Black elephant x2',
      'Black chariot x2',
      'Black horse',
      'Black cannon x2',
      'Black soldier x3',
    ]);
    // Red: 16 minus the revealed chariot minus the captured cannon.
    expect(labels(rows[1]!)).toEqual([
      'Red general',
      'Red advisor x2',
      'Red elephant x2',
      'Red chariot',
      'Red horse x2',
      'Red cannon',
      'Red soldier x5',
    ]);
    expect(s.hiddenPool.querySelectorAll('.hidden-pool__note')).toHaveLength(0);
  });

  it('flips the strips and the row order for the other seat', () => {
    const s = slots();
    renderBanqiMaterial(s, midgame, 'black');
    expect(labels(s.capturesTop)).toEqual(['black soldier x2']);
    expect(labels(s.capturesBottom)).toEqual(['red cannon']);
    const rows = [...s.hiddenPool.querySelectorAll<HTMLElement>('.hidden-pool__row')];
    expect(rows.map((row) => row.dataset.ink)).toEqual(['red', 'black']);
  });

  it('before the opening flip binds an ink, the strips stay empty and the full pool shows', () => {
    const s = slots();
    const opening: BanqiWireView = {
      ...midgame,
      board: { a1: { faceDown: true } },
      captured: [],
      ply: 0,
      firstColor: null,
    };
    renderBanqiMaterial(s, opening, null);
    expect(s.capturesTop.childElementCount).toBe(0);
    expect(s.capturesBottom.childElementCount).toBe(0);
    const rows = [...s.hiddenPool.querySelectorAll<HTMLElement>('.hidden-pool__row')];
    expect(rows.map((row) => row.dataset.ink)).toEqual(['red', 'black']);
    expect(labels(rows[0]!)).toHaveLength(7);
  });

  it('shows nothing for an empty board: no information is not a full pool', () => {
    const s = slots();
    renderBanqiMaterial(s, { ...midgame, board: {}, captured: [] }, null);
    expect(s.hiddenPool.childElementCount).toBe(0);
  });

  it('clears every slot when there is no view', () => {
    const s = slots();
    renderBanqiMaterial(s, midgame, 'red');
    renderBanqiMaterial(s, null, null);
    expect(s.capturesTop.childElementCount).toBe(0);
    expect(s.capturesBottom.childElementCount).toBe(0);
    expect(s.hiddenPool.childElementCount).toBe(0);
  });
});
