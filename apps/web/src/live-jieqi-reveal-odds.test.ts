import { createInitialJieqiState, getJieqiPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { jieqiRevealOdds, type RevealOddsSide } from './jieqi-reveal-odds.js';
import {
  chanceText,
  mountRevealOdds,
  oddsToShow,
  type PieceGlyph,
  renderPoolRow,
} from './live-jieqi-reveal-odds.js';

// Locks what the reveal-odds row draws from a side's odds. The counting itself
// is jieqi-reveal-odds.test.ts; here: chips, labels, the taken-unseen note only
// where it applies, and that nothing renders once there is nothing left to
// reveal.

const glyph: PieceGlyph = ({ color, role }) => `<svg data-glyph="${color}-${role}"></svg>`;

// Red as red sees it after black took two of red's face-down pieces unseen:
// 13 face-down on the board, 15 identities still unseen.
const redUncertain: RevealOddsSide = {
  color: 'red',
  entries: [
    { role: 'chariot', count: 2, probability: 2 / 15 },
    { role: 'cannon', count: 2, probability: 2 / 15 },
    { role: 'horse', count: 2, probability: 2 / 15 },
    { role: 'elephant', count: 2, probability: 2 / 15 },
    { role: 'advisor', count: 2, probability: 2 / 15 },
    { role: 'soldier', count: 5, probability: 5 / 15 },
  ],
  unseen: 15,
  takenUnseen: 2,
  faceDown: 13,
};

const blackExact: RevealOddsSide = {
  color: 'black',
  entries: [
    { role: 'horse', count: 1, probability: 1 / 3 },
    { role: 'soldier', count: 2, probability: 2 / 3 },
  ],
  unseen: 3,
  takenUnseen: 0,
  faceDown: 3,
};

const startView = () => getJieqiPlayerView(createInitialJieqiState('ui'), 'red');

describe('reveal odds pool row', () => {
  it('labels the row and prints every percentage, with no tap needed', () => {
    const host = document.createElement('div');
    renderPoolRow(host, redUncertain, glyph);
    const chips = [...host.querySelectorAll<HTMLElement>('.reveal-odds-chip')];
    expect(chips.map((c) => c.dataset.role)).toEqual([
      'chariot',
      'cannon',
      'horse',
      'elephant',
      'advisor',
      'soldier',
    ]);
    expect(host.querySelector('button')).toBeNull();
    expect(chips.map((c) => c.querySelector('.reveal-odds-chip__pct')?.textContent)).toEqual([
      '13%',
      '13%',
      '13%',
      '13%',
      '13%',
      '33%',
    ]);
    expect(chips[5].getAttribute('role')).toBe('img');
    expect(chips[5].getAttribute('aria-label')).toBe('Soldier: 5 in 15, 33%');
    expect(chips[5].querySelector('[data-glyph="red-soldier"]')).not.toBeNull();
    expect(
      chips[5].querySelector('.reveal-odds-chip__piece .captures-count-badge')?.textContent,
    ).toBe('5');
    const head = host.querySelector('.reveal-odds-row__head');
    expect(head?.querySelector('.reveal-odds-row__lead')?.textContent).toBe(
      '13 face-down could be:',
    );
    expect(head?.querySelector('.reveal-odds-row__note')?.textContent).toBe('2 taken unseen');
    expect(host.getAttribute('aria-label')).toBe('Face-down odds: Red, 13 face-down');
    expect(host.textContent).not.toContain('—');
  });

  it('leaves the exact side without a note and badges only counts above one', () => {
    const host = document.createElement('div');
    renderPoolRow(host, blackExact, glyph);
    const [horse, soldier] = host.querySelectorAll<HTMLElement>('.reveal-odds-chip');
    expect(horse.querySelector('.reveal-odds-chip__pct')?.textContent).toBe('33%');
    expect(horse.querySelector('.captures-count-badge')).toBeNull();
    expect(soldier.querySelector('.reveal-odds-chip__pct')?.textContent).toBe('67%');
    expect(host.querySelector('.reveal-odds-row__note')).toBeNull();
  });

  it('an empty side clears the row', () => {
    const host = document.createElement('div');
    renderPoolRow(host, blackExact, glyph);
    renderPoolRow(host, { ...blackExact, entries: [], unseen: 0, faceDown: 0 }, glyph);
    expect(host.childElementCount).toBe(0);
    expect(host.hasAttribute('aria-label')).toBe(false);
    expect(host.dataset.ink).toBeUndefined();
    renderPoolRow(host, null, glyph);
    expect(host.childElementCount).toBe(0);
  });
});

describe('reveal odds visibility', () => {
  it('shows odds only while playing with a face-down piece on the board', () => {
    const view = startView();
    expect(oddsToShow(null)).toBeNull();
    expect(oddsToShow(view)).toEqual(jieqiRevealOdds(view));
    expect(oddsToShow({ ...view, status: { type: 'finished' } })).toBeNull();
    const faceUpOnly = Object.fromEntries(
      Object.entries(view.board).filter(([, piece]) => !piece?.faceDown),
    );
    expect(oddsToShow({ ...view, board: faceUpOnly })).toBeNull();
  });

  it('chanceText reads a role the side has none of as 0 in N', () => {
    expect(chanceText(blackExact, 'chariot')).toBe('Chariot: 0 in 3, 0%');
  });

  function layout() {
    const console = document.createElement('div');
    const capturesTop = document.createElement('div');
    const capturesBottom = document.createElement('div');
    console.append(capturesTop, capturesBottom);
    document.body.append(console);
    return { console, slots: { capturesTop, capturesBottom } };
  }

  it('mounts a reserved row on each side of the trays, filled from the view', () => {
    const { console, slots } = layout();
    const mount = mountRevealOdds(slots, () => glyph);
    const [top, , , bottom] = [...console.children] as HTMLElement[];
    expect(top.dataset.revealOdds).toBe('top');
    expect(bottom.dataset.revealOdds).toBe('bottom');
    expect(top.childElementCount).toBe(0);
    mount.render({ view: startView(), orientation: 'red' });
    expect(top.dataset.ink).toBe('black');
    expect(bottom.dataset.ink).toBe('red');
    expect(bottom.querySelectorAll('.reveal-odds-chip__pct')).toHaveLength(6);
    // A spectator flipped to black: black's row at the bottom, red's on top.
    mount.render({ view: startView(), orientation: 'black' });
    expect(top.dataset.ink).toBe('red');
    expect(bottom.dataset.ink).toBe('black');
    // After the game the rows empty but stay mounted (reserved bands).
    mount.render({ view: { ...startView(), status: { type: 'finished' } }, orientation: 'red' });
    expect(console.querySelectorAll('.reveal-odds-chip')).toHaveLength(0);
    expect(console.querySelectorAll('[data-reveal-odds]')).toHaveLength(2);
    // A remount (a room re-entry) replaces the rows rather than stacking them.
    mountRevealOdds(slots, () => glyph);
    expect(console.querySelectorAll('[data-reveal-odds]')).toHaveLength(2);
  });
});
