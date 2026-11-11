import { describe, expect, it } from 'vitest';
import { fillCapturedPoolWith } from './captured-pool.js';

// The ONE captured-material renderer behind banqi, jieqi, flip jungle, dark
// xiangqi and mini xiangqi. Before 2026-09-02 banqi and jieqi each carried a
// private copy that disagreed with this one on grouping (jieqi drew one glyph per
// capture) and on the unknown-identity case (only jieqi had one). Pinned here:
// owner filter, first-capture grouping order, count badge, and the null role.

type Color = 'red' | 'black';
type Role = 'chariot' | 'soldier' | 'cannon';
type Captured = { owner: Color; role: Role | null };

const glyph = (entry: { color: Color; role: Role }): string =>
  `<svg data-piece="${entry.color}-${entry.role}"></svg>`;
const hidden = (color: Color): string => `<svg data-piece="${color}-hidden"></svg>`;

function host(): HTMLDivElement {
  return document.createElement('div');
}

function pieces(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('.review-capture-piece')];
}

describe('fillCapturedPoolWith', () => {
  it('renders nothing and clears has-captures for an empty pool', () => {
    const el = host();
    el.classList.add('has-captures'); // stale from a prior render
    fillCapturedPoolWith(el, [], 'red', glyph);
    expect(el.classList.contains('has-captures')).toBe(false);
    expect(pieces(el)).toHaveLength(0);
  });

  it('only renders pieces belonging to the named owner, through the caller renderer', () => {
    const el = host();
    const captured: Captured[] = [
      { owner: 'red', role: 'soldier' },
      { owner: 'black', role: 'cannon' },
      { owner: 'red', role: 'chariot' },
    ];
    fillCapturedPoolWith(el, captured, 'red', glyph);
    expect(el.classList.contains('has-captures')).toBe(true);
    expect(pieces(el).map((span) => span.getAttribute('aria-label'))).toEqual([
      'red soldier',
      'red chariot',
    ]);
    expect(el.querySelector('[data-piece="red-chariot"]')).not.toBeNull();
    expect(el.querySelector('[data-piece="black-cannon"]')).toBeNull();
  });

  it('stacks repeats of a role into one glyph with a count badge, in first-capture order', () => {
    const el = host();
    const captured: Captured[] = [
      { owner: 'red', role: 'soldier' },
      { owner: 'red', role: 'cannon' },
      { owner: 'red', role: 'soldier' },
      { owner: 'red', role: 'soldier' },
    ];
    fillCapturedPoolWith(el, captured, 'red', glyph);
    const glyphs = pieces(el);
    expect(glyphs.map((span) => span.getAttribute('aria-label'))).toEqual([
      'red soldier x3',
      'red cannon',
    ]);
    expect(glyphs[0]!.classList.contains('has-count')).toBe(true);
    expect(glyphs[0]!.querySelector('.captures-count-badge')?.textContent).toBe('3');
    expect(glyphs[1]!.querySelector('.captures-count-badge')).toBeNull();
  });

  it('groups unknown-identity captures and draws them through renderHidden', () => {
    const el = host();
    const captured: Captured[] = [
      { owner: 'black', role: null },
      { owner: 'black', role: 'chariot' },
      { owner: 'black', role: null },
    ];
    fillCapturedPoolWith(el, captured, 'black', glyph, hidden);
    const glyphs = pieces(el);
    expect(glyphs.map((span) => span.getAttribute('aria-label'))).toEqual([
      'black hidden piece x2',
      'black chariot',
    ]);
    expect(el.querySelectorAll('[data-piece="black-hidden"]')).toHaveLength(1);
  });

  it('shades a named piece taken face-down, as its own tile beside the plain one', () => {
    const el = host();
    fillCapturedPoolWith(
      el,
      [
        { owner: 'black', role: 'cannon', takenFaceDown: true },
        { owner: 'black', role: 'chariot' },
        { owner: 'black', role: 'cannon' },
        { owner: 'black', role: 'cannon', takenFaceDown: true },
        { owner: 'black', role: null },
      ],
      'black',
      glyph,
      hidden,
    );
    const glyphs = pieces(el);
    expect(glyphs.map((span) => span.getAttribute('aria-label'))).toEqual([
      'black cannon',
      'black cannon, captured face-down x2',
      'black chariot',
      'black hidden piece',
    ]);
    expect(glyphs.map((span) => span.classList.contains('is-taken-face-down'))).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it('skips unknown-identity captures when the caller has no hidden renderer', () => {
    // A variant with no "?" case (banqi, flip jungle) never passes renderHidden;
    // a null it is somehow handed must not throw or draw a wrong glyph.
    const el = host();
    fillCapturedPoolWith(el, [{ owner: 'red', role: null }], 'red', glyph);
    expect(pieces(el)).toHaveLength(0);
    expect(el.classList.contains('has-captures')).toBe(false);
  });
});
