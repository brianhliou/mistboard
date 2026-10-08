import { createInitialJieqiState, getJieqiPlayerView, type JieqiColor } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { jieqiRevealOdds, type RevealOddsSide } from './jieqi-reveal-odds.js';
import {
  chanceText,
  liveRevealOddsVariantFrom,
  mountRevealOdds,
  oddsToShow,
  type PieceGlyph,
  type RevealOddsInput,
  renderArmyBlock,
  renderOddsTable,
  renderPoolRow,
  renderPopover,
} from './live-jieqi-reveal-odds.js';

// Locks what each reveal-odds variant draws from a side's odds. The counting
// itself is jieqi-reveal-odds.test.ts; here: chips, labels, the taken-unseen
// note only where it applies, and that nothing renders once there is nothing
// left to reveal.

const glyph: PieceGlyph = ({ color, role, faceDown }) =>
  `<svg data-glyph="${color}-${faceDown ? 'back' : role}"></svg>`;

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

describe('reveal odds pool row (a, b)', () => {
  it('a labels the row and prints every percentage, with no tap needed', () => {
    const host = document.createElement('div');
    renderPoolRow(host, redUncertain, { percent: true, glyph });
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
    expect(host.textContent).not.toContain('\u2014');
  });

  it('a leaves the exact side without a note and badges only counts above one', () => {
    const host = document.createElement('div');
    renderPoolRow(host, blackExact, { percent: true, glyph });
    const [horse, soldier] = host.querySelectorAll<HTMLElement>('.reveal-odds-chip');
    expect(horse.querySelector('.reveal-odds-chip__pct')?.textContent).toBe('33%');
    expect(horse.querySelector('.captures-count-badge')).toBeNull();
    expect(soldier.querySelector('.reveal-odds-chip__pct')?.textContent).toBe('67%');
    expect(host.querySelector('.reveal-odds-row__note')).toBeNull();
  });

  it('b draws a slim row with no percentages, and an empty side clears the row', () => {
    const host = document.createElement('div');
    renderPoolRow(host, blackExact, { percent: false, glyph });
    expect(host.querySelectorAll('.reveal-odds-chip')).toHaveLength(2);
    expect(host.querySelector('.reveal-odds-chip__pct')).toBeNull();
    expect(host.querySelector('.reveal-odds-row__head')).toBeNull();
    expect(host.querySelector('.reveal-odds-row__lead')?.textContent).toBe('3 face-down');
    renderPoolRow(
      host,
      { ...blackExact, entries: [], unseen: 0, faceDown: 0 },
      { percent: false, glyph },
    );
    expect(host.childElementCount).toBe(0);
    expect(host.hasAttribute('aria-label')).toBe(false);
    renderPoolRow(host, null, { percent: true, glyph });
    expect(host.childElementCount).toBe(0);
  });
});

describe('reveal odds popover (b)', () => {
  it('titles the side and lists percent and count per role, with the note when uncertain', () => {
    const host = document.createElement('div');
    renderPopover(host, redUncertain, glyph);
    expect(host.querySelector('.reveal-odds-pop__title')?.textContent).toBe(
      'Any face-down Red piece',
    );
    const soldier = host.querySelector<HTMLElement>('.reveal-odds-pop__cell[data-role="soldier"]');
    expect(soldier?.querySelector('.reveal-odds-pop__pct')?.textContent).toBe('33%');
    expect(soldier?.querySelector('.reveal-odds-pop__count')?.textContent).toBe('5/15');
    expect(host.querySelector('.reveal-odds-pop__note')?.textContent).toBe('2 taken unseen');
    renderPopover(host, blackExact, glyph);
    expect(host.querySelectorAll('.reveal-odds-pop__cell')).toHaveLength(2);
    expect(host.querySelector('.reveal-odds-pop__note')).toBeNull();
  });
});

describe('reveal odds table (c)', () => {
  const odds = { red: redUncertain, black: blackExact };

  it('puts the opponent first, labels the viewer, and zeroes roles a side has used up', () => {
    const host = document.createElement('div');
    renderOddsTable(host, odds, { orientation: 'red', seat: 'red' }, glyph);
    const heads = [...host.querySelectorAll('thead th[data-ink]')].map(
      (th) => th.querySelector('.reveal-odds-table__ink')?.textContent,
    );
    expect(heads).toEqual(['Black', 'Red (You)']);
    const chariot = host.querySelector('tr[data-role="chariot"]');
    expect(chariot?.querySelector('td[data-ink="black"]')?.textContent).toBe('0');
    expect(chariot?.querySelector('td[data-ink="red"]')?.getAttribute('aria-label')).toBe(
      'Chariot: 2 in 15, 13%',
    );
    const foot = host.querySelector('tfoot');
    expect(foot?.querySelector('td[data-ink="red"]')?.textContent).toBe('2 taken unseen');
    expect(foot?.querySelector('td[data-ink="black"]')?.textContent).toBe('');
  });

  it('a spectator gets no "You", and no footer when nothing was taken unseen', () => {
    const host = document.createElement('div');
    renderOddsTable(
      host,
      { red: { ...redUncertain, takenUnseen: 0 }, black: blackExact },
      { orientation: 'black', seat: null },
      glyph,
    );
    const heads = [...host.querySelectorAll('thead .reveal-odds-table__ink')].map(
      (s) => s.textContent,
    );
    expect(heads).toEqual(['Red', 'Black']);
    expect(host.querySelector('tfoot')).toBeNull();
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
    const stage = document.createElement('div');
    const board = document.createElement('div');
    stage.append(board);
    const rail = document.createElement('div');
    const section = document.createElement('section');
    section.className = 'panel-section';
    const gameInfo = document.createElement('div');
    section.append(gameInfo);
    rail.append(section);
    document.body.append(console, stage, rail);
    return { console, slots: { capturesTop, capturesBottom, board, gameInfo }, rail, stage };
  }

  const input = (seat: JieqiColor | null): RevealOddsInput => ({
    view: startView(),
    orientation: 'red',
    seat,
  });

  it('a mounts a reserved row on each side of the trays, filled from the view', () => {
    const { console, slots } = layout();
    const mount = mountRevealOdds(slots, 'a', () => glyph);
    const [top, , , bottom] = [...console.children] as HTMLElement[];
    expect(top.dataset.revealOdds).toBe('top');
    expect(bottom.dataset.revealOdds).toBe('bottom');
    expect(top.childElementCount).toBe(0);
    mount.render(input('red'));
    expect(top.dataset.ink).toBe('black');
    expect(bottom.dataset.ink).toBe('red');
    expect(bottom.querySelectorAll('.reveal-odds-chip__pct')).toHaveLength(6);
    // A remount (a room re-entry) replaces the rows rather than stacking them.
    mountRevealOdds(slots, 'a', () => glyph);
    expect(console.querySelectorAll('[data-reveal-odds]')).toHaveLength(2);
  });

  it('b adds a hidden popover over the board; c adds a table after the game info', () => {
    const b = layout();
    mountRevealOdds(b.slots, 'b', () => glyph).render(input('black'));
    const pop = b.stage.querySelector<HTMLElement>('.reveal-odds-pop');
    expect(pop?.hidden).toBe(true);
    expect(b.console.querySelectorAll('.reveal-odds-row--b')).toHaveLength(2);

    const c = layout();
    const mount = mountRevealOdds(c.slots, 'c', () => glyph);
    const table = c.rail.querySelector<HTMLElement>('[data-reveal-odds="table"]');
    expect(table?.hidden).toBe(true);
    mount.render(input(null));
    expect(table?.hidden).toBe(false);
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(6);
    mount.render({ ...input(null), view: { ...startView(), status: { type: 'finished' } } });
    expect(table?.hidden).toBe(true);
  });
});

describe('reveal odds by army (d)', () => {
  // Red's losses as red sees them: a horse taken face-up (known), two taken
  // face-down by black (unseen); black lost a soldier to red.
  const captured = [
    { owner: 'red' as const, role: null },
    { owner: 'black' as const, role: 'soldier' as const },
    { owner: 'red' as const, role: 'horse' as const },
    { owner: 'red' as const, role: null },
  ];

  it('reads ?revealOdds=army (or d) and leaves a|b|c to the counting module', () => {
    expect(liveRevealOddsVariantFrom('?revealOdds=army')).toBe('d');
    expect(liveRevealOddsVariantFrom('?revealOdds=d')).toBe('d');
    expect(liveRevealOddsVariantFrom('?revealOdds=b')).toBe('b');
    expect(liveRevealOddsVariantFrom('?revealOdds=zzz')).toBe('a');
    expect(liveRevealOddsVariantFrom('')).toBe('a');
  });

  it('puts one ink in a block: its could-be row, then only its own losses, unseen ones last', () => {
    const host = document.createElement('div');
    renderArmyBlock(host, 'red', redUncertain, captured, glyph);
    expect(host.dataset.ink).toBe('red');
    const [pool, lost] = [...host.children] as HTMLElement[];
    expect(pool.classList.contains('reveal-odds-army__pool')).toBe(true);
    expect(pool.querySelectorAll('.reveal-odds-chip__pct')).toHaveLength(6);
    // The pill is gone: the unseen losses live on the lost line instead.
    expect(host.querySelector('.reveal-odds-row__note')).toBeNull();
    expect(lost.querySelector('.reveal-odds-army__label')?.textContent).toBe('Lost');
    const pieces = [...lost.querySelectorAll<HTMLElement>('.reveal-odds-army__piece')];
    expect(pieces.map((p) => [p.dataset.role, p.dataset.count])).toEqual([
      ['horse', '1'],
      ['unseen', '2'],
    ]);
    expect(pieces[0].innerHTML).toContain('data-glyph="red-horse"');
    expect(pieces[1].innerHTML).toContain('data-glyph="red-back"');
    expect(pieces[1].querySelector('.captures-count-badge')?.textContent).toBe('2');
    expect(lost.querySelector('.reveal-odds-army__unseen')?.textContent).toBe('2 unseen');
    expect(lost.getAttribute('aria-label')).toBe('Lost: Horse, 2 unseen');
    expect(host.innerHTML).not.toContain('black-');
  });

  it("the opponent's block lists what the viewer took, face-up, with no unseen note", () => {
    const host = document.createElement('div');
    renderArmyBlock(host, 'black', blackExact, captured, glyph);
    const lost = host.querySelector<HTMLElement>('.reveal-odds-army__lost');
    expect(lost?.getAttribute('aria-label')).toBe('Lost: Soldier');
    expect(lost?.querySelector('.reveal-odds-army__unseen')).toBeNull();
    expect(host.querySelector<HTMLElement>('.reveal-odds-chip')?.dataset.ink).toBe('black');
  });

  it('keeps both bands but draws nothing when a side has no odds and no losses', () => {
    const host = document.createElement('div');
    renderArmyBlock(host, 'black', null, [], glyph);
    const [pool, lost] = [...host.children] as HTMLElement[];
    expect(pool.childElementCount).toBe(0);
    expect(lost.childElementCount).toBe(0);
  });

  function layout() {
    const console = document.createElement('div');
    const capturesTop = document.createElement('div');
    const capturesBottom = document.createElement('div');
    console.append(capturesTop, capturesBottom);
    const board = document.createElement('div');
    const gameInfo = document.createElement('div');
    document.body.append(console, board, gameInfo);
    return { console, slots: { capturesTop, capturesBottom, board, gameInfo } };
  }

  it('mounts one block per side, hides the seat trays, and gives them back on a remount', () => {
    const { console, slots } = layout();
    const mount = mountRevealOdds(slots, 'd', () => glyph);
    expect(mount.variant).toBe('d');
    expect(slots.capturesTop.dataset.revealOddsArmy).toBe('hidden');
    expect(slots.capturesBottom.dataset.revealOddsArmy).toBe('hidden');
    const [top, , , bottom] = [...console.children] as HTMLElement[];
    expect(top.className).toContain('reveal-odds-row--d');
    const view = { ...startView(), captured };
    mount.render({ view, orientation: 'red', seat: 'red' });
    expect(top.dataset.ink).toBe('black');
    expect(bottom.dataset.ink).toBe('red');
    expect(top.querySelector('.reveal-odds-army__lost')?.getAttribute('aria-label')).toBe(
      'Lost: Soldier',
    );
    expect(bottom.querySelector('.reveal-odds-army__unseen')?.textContent).toBe('2 unseen');
    // After the game the odds go, the losses stay (the trays they replace did).
    mount.render({
      view: { ...view, status: { type: 'finished' } },
      orientation: 'red',
      seat: 'red',
    });
    expect(console.querySelectorAll('.reveal-odds-chip')).toHaveLength(0);
    expect(console.querySelectorAll('.reveal-odds-army__piece')).toHaveLength(3);
    // A spectator flipped to black: black's block at the bottom, red's on top.
    mount.render({ view, orientation: 'black', seat: null });
    expect(top.dataset.ink).toBe('red');
    expect(bottom.dataset.ink).toBe('black');

    mountRevealOdds(slots, 'a', () => glyph);
    expect(slots.capturesTop.dataset.revealOddsArmy).toBeUndefined();
    expect(console.querySelectorAll('[data-reveal-odds]')).toHaveLength(2);
  });
});
