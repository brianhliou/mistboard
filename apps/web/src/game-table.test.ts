import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { centeredScrollOffsets, createGameTable, scrollMoveListToEnd } from './game-table.js';

describe('createGameTable', () => {
  it('provides the shared room and watch right-column contract', () => {
    const table = createGameTable();

    expect(table.el.classList.contains('game-console')).toBe(true);
    expect(table.el.querySelectorAll('.round-table__box')).toHaveLength(1);
    expect(table.refs.replayControls).toHaveLength(4);
    expect(table.refs.movesRoot.contains(table.refs.moveList)).toBe(true);
    expect(table.refs.playerTop.classList.contains('round-table__player--top')).toBe(true);
    expect(table.refs.playerBottom.classList.contains('round-table__player--bottom')).toBe(true);
  });
});

describe('centeredScrollOffsets', () => {
  const box = { scrollTop: 0, scrollLeft: 0, clientHeight: 100, clientWidth: 300 };

  it('centres the active move sideways in the phone strip', () => {
    // A 40px button 500px into a 300px-wide strip scrolled 100px.
    const offsets = centeredScrollOffsets(
      { ...box, scrollLeft: 100 },
      { top: 0, left: 0 },
      { top: 30, left: 400, height: 40, width: 40 },
    );
    expect(offsets.left).toBe(100 + 400 - (300 - 40) / 2);
    expect(offsets.top).toBe(0);
  });

  it('centres the active move vertically in the column list', () => {
    const offsets = centeredScrollOffsets(
      { ...box, scrollTop: 50 },
      { top: 200, left: 0 },
      { top: 420, left: 10, height: 20, width: 80 },
    );
    expect(offsets.top).toBe(50 + 220 - (100 - 20) / 2);
    expect(offsets.left).toBe(0);
  });

  it('never returns a negative offset', () => {
    const offsets = centeredScrollOffsets(
      box,
      { top: 0, left: 0 },
      { top: 0, left: 0, height: 10, width: 10 },
    );
    expect(offsets).toEqual({ top: 0, left: 0 });
  });
});

describe('scrollMoveListToEnd', () => {
  it('follows the latest move on both axes', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 900 });
    Object.defineProperty(el, 'scrollWidth', { value: 1200 });
    let top = 0;
    let left = 0;
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    Object.defineProperty(el, 'scrollLeft', {
      get: () => left,
      set: (v: number) => {
        left = v;
      },
    });
    scrollMoveListToEnd(el);
    expect(top).toBe(900);
    expect(left).toBe(1200);
  });
});

describe('phone room stylesheet (600px and under)', () => {
  const css = readFileSync('src/live-review.css', 'utf8');
  const start = css.indexOf('@media (max-width: 600px)');
  const phone = css.slice(start);

  it('has a phone block', () => {
    expect(start).toBeGreaterThan(0);
  });

  it('turns the move window into a one-line sideways strip that cannot widen the page', () => {
    const strip = phone.slice(phone.indexOf('.live-review__cluster .game-table-moves {'));
    const body = strip.slice(0, strip.indexOf('}'));
    expect(body).toContain('overflow-x: auto');
    // Without this a long game's min-content width pushed the page past 320px.
    expect(body).toContain('contain: inline-size');
    expect(phone).toMatch(/\.game-table-moves > \.move-list \{[^}]*flex-wrap: nowrap/);
  });
});
