import { describe, expect, it } from 'vitest';
import { renderHiddenPoolPanel } from './hidden-pool-panel.js';

type Color = 'red' | 'black';
type Role = 'chariot' | 'horse' | 'soldier';

const glyph = (entry: { color: Color; role: Role }): string =>
  `<svg data-piece="${entry.color}-${entry.role}"></svg>`;

function host(): HTMLDivElement {
  return document.createElement('div');
}

describe('renderHiddenPoolPanel', () => {
  it('draws one row per ink, in the order given, with grouped glyphs and count badges', () => {
    const el = host();
    renderHiddenPoolPanel(
      el,
      [
        {
          color: 'black',
          label: 'Black',
          side: {
            entries: [
              { role: 'chariot', count: 2 },
              { role: 'soldier', count: 1 },
            ],
            total: 3,
            unknownCaptured: 0,
          },
        },
        {
          color: 'red',
          label: 'Red',
          side: { entries: [{ role: 'horse', count: 1 }], total: 1, unknownCaptured: 0 },
        },
      ],
      glyph,
    );
    expect(el.querySelector('.hidden-pool__caption')?.textContent).toBe('Still face-down');
    const rows = [...el.querySelectorAll<HTMLElement>('.hidden-pool__row')];
    expect(rows.map((row) => row.dataset.ink)).toEqual(['black', 'red']);
    expect(rows.map((row) => row.querySelector('.hidden-pool__label')?.textContent)).toEqual([
      'Black',
      'Red',
    ]);
    const blackGlyphs = [...rows[0]!.querySelectorAll<HTMLElement>('.review-capture-piece')];
    expect(blackGlyphs.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Black chariot x2',
      'Black soldier',
    ]);
    expect(blackGlyphs[0]!.querySelector('.captures-count-badge')?.textContent).toBe('2');
    expect(blackGlyphs[1]!.querySelector('.captures-count-badge')).toBeNull();
    expect(el.querySelectorAll('.hidden-pool__note')).toHaveLength(0);
  });

  it('writes the unseen-capture note on a row that carries them (jieqi, your own ink)', () => {
    const el = host();
    renderHiddenPoolPanel(
      el,
      [
        {
          color: 'red',
          label: 'Red',
          side: { entries: [{ role: 'soldier', count: 3 }], total: 3, unknownCaptured: 2 },
        },
      ],
      glyph,
    );
    expect(el.querySelector('.hidden-pool__note')?.textContent).toBe(
      '2 of these already taken, unknown which',
    );
  });

  it('marks an exhausted ink as all revealed, and keeps the panel when both are', () => {
    const el = host();
    const empty = { entries: [], total: 0, unknownCaptured: 0 };
    renderHiddenPoolPanel(
      el,
      [
        { color: 'black', label: 'Black', side: empty },
        {
          color: 'red',
          label: 'Red',
          side: { entries: [{ role: 'horse', count: 1 }], total: 1, unknownCaptured: 0 },
        },
      ],
      glyph,
    );
    expect(el.querySelector('[data-ink="black"] .hidden-pool__none')?.textContent).toBe(
      'all revealed',
    );
    renderHiddenPoolPanel(
      el,
      [
        { color: 'black', label: 'Black', side: empty },
        { color: 'red', label: 'Red', side: empty },
      ],
      glyph,
    );
    // The last flip must not remove the panel: its height would leave the rail.
    expect(el.querySelector('.hidden-pool__caption')?.textContent).toBe('Still face-down');
    expect([...el.querySelectorAll('.hidden-pool__none')].map((none) => none.textContent)).toEqual([
      'all revealed',
      'all revealed',
    ]);
    renderHiddenPoolPanel(el, [], glyph);
    expect(el.childElementCount).toBe(0);
  });
});
