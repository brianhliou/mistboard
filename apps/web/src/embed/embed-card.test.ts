// The score sheet folds the stored analysis's marks into its entries: the glyph after the
// move, the advice under it, a study's own note kept ahead of the advice.
import { describe, expect, it } from 'vitest';
import { createMoveList } from '../review/move-list.js';
import { annotateEntries } from './embed-card.js';

describe('annotateEntries', () => {
  const entries = [
    { ply: 1, label: 'h3-e3' },
    { ply: 2, label: 'h8-e8', note: 'The usual reply.' },
    { ply: 3, label: 'b3-e3' },
  ];

  it('adds the glyph and the advice to the marked moves only', () => {
    const marked = annotateEntries(
      entries,
      new Map([
        [2, { suffix: '?', suffixClass: 'mistake', note: 'Mistake. b8-e8 was best.' }],
        [3, { suffix: '??', suffixClass: 'blunder', note: 'Blunder. h2-e2 was best.' }],
      ]),
    );
    expect(marked[0]).toEqual(entries[0]);
    expect(marked[1]).toEqual({
      ply: 2,
      label: 'h8-e8',
      suffix: '?',
      suffixClass: 'mistake',
      note: 'The usual reply. Mistake. b8-e8 was best.',
    });
    expect(marked[2]).toMatchObject({ suffix: '??', note: 'Blunder. h2-e2 was best.' });
  });

  it('renders on the sheet as a coloured glyph and a note under the row', () => {
    const list = createMoveList(
      annotateEntries(
        entries,
        new Map([[3, { suffix: '??', suffixClass: 'blunder', note: 'Blunder. h2-e2 was best.' }]]),
      ),
    );
    const glyph = list.el.querySelector('[data-ply="3"] .review-move-list__suffix');
    expect(glyph?.textContent).toBe(' ??');
    expect(glyph?.classList.contains('review-move--blunder')).toBe(true);
    const notes = [...list.el.querySelectorAll('.review-move-list__note')].map(
      (el) => el.textContent,
    );
    expect(notes).toContain('Blunder. h2-e2 was best.');
  });
});
