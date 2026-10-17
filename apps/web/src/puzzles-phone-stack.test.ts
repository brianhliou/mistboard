// The puzzle page's phone stack: board, arrows, a short move strip, then the
// feedback card (mobile pass #576; the review boards' order from e4823b2b).
// puzzles.css orders the rows; keepActivePuzzleMoveInView keeps the scrubbed-to
// ply visible inside the strip. These pin both.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { keepActivePuzzleMoveInView } from './puzzles/move-list.js';

// Whitespace collapsed: Biome wraps long selectors over several lines.
const css = readFileSync('src/puzzles.css', 'utf8').replace(/\s+/g, ' ');
const phone = css.slice(css.indexOf('@media (max-width: 980px)'));
const phoneBlock = phone.slice(0, phone.indexOf('@media', 10));
const desktop = css.slice(0, css.indexOf('@media (max-width: 980px)'));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('puzzle phone stack', () => {
  it('puts the arrows first in the side panel, right under the board', () => {
    expect(phoneBlock).toContain(
      '.puzzles-shell .puzzle-side-panel > .puzzle-actions { order: -1; }',
    );
    expect(phoneBlock).toMatch(/\.puzzle-board \{ order: 1; \}/);
    expect(phoneBlock).toMatch(/\.puzzle-side-panel \{ order: 2;/);
  });

  it('keeps the move strip short on the phone only', () => {
    expect(phoneBlock).toContain('.puzzles-shell .puzzle-move-list { max-height: 140px; }');
    expect(desktop).not.toContain('.puzzle-side-panel > .puzzle-actions');
  });

  it('scopes the stack to the page so the embed card keeps its own layout', () => {
    for (const rule of phoneBlock.matchAll(/([^{}]*\.puzzle-actions[^{}]*)\{/g)) {
      expect(rule[1]).toContain('.puzzles-shell');
    }
  });
});

describe('keepActivePuzzleMoveInView', () => {
  function strip(activeRow: number): { list: HTMLOListElement; root: HTMLElement } {
    const root = document.createElement('div');
    const list = document.createElement('ol');
    list.className = 'puzzle-move-list';
    for (let i = 0; i < 5; i += 1) {
      const row = document.createElement('li');
      row.className = 'puzzle-move-item';
      const cell = document.createElement('span');
      if (i === activeRow) cell.className = 'puzzle-move-cell--active';
      row.append(cell);
      // 38px rows laid out from the list's top, shifted by its scroll.
      row.getBoundingClientRect = () =>
        ({ top: i * 38 - list.scrollTop, bottom: (i + 1) * 38 - list.scrollTop }) as DOMRect;
      list.append(row);
    }
    list.getBoundingClientRect = () => ({ top: 0, bottom: 140 }) as DOMRect;
    root.append(list);
    document.body.append(root);
    return { list, root };
  }

  it('scrolls a ply below the strip into view', () => {
    const { list, root } = strip(4);
    keepActivePuzzleMoveInView(root);
    expect(list.scrollTop).toBe(5 * 38 - 140);
  });

  it('leaves the strip alone when the ply is already visible', () => {
    const { list, root } = strip(1);
    keepActivePuzzleMoveInView(root);
    expect(list.scrollTop).toBe(0);
  });
});
