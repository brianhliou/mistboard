import { describe, expect, it } from 'vitest';
import { renderJungleFlipBoardSvg } from './jungle-flip-render.js';
import { renderJungleBoardSvg } from './jungle-render.js';

const SKIN = { boardSkin: 'bare', pieceSkin: 'animals' } as const;

// Jungle tiles are rounded squares filling nine tenths of the cell: a round
// capture ring sat behind the tile and was cut off at its corners, and a tint
// under the tile would be hidden. A capture target is its cell tinted in the
// move-hint green over the tile, multiplied so the animal reads through.
function expectCellTint(svg: string, squares: readonly string[], cell: number): void {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelectorAll('.mb-grid-target-ring')).toHaveLength(0);
  const fills = [...doc.querySelectorAll('.jungle-capture-target')];
  expect(fills).toHaveLength(squares.length);
  for (const fill of fills) {
    expect(Number(fill.getAttribute('width'))).toBe(cell);
    expect(Number(fill.getAttribute('height'))).toBe(cell);
  }
  // Over the tiles: every tint comes after the last piece slot.
  const lastPiece = svg.lastIndexOf('data-piece-square=');
  expect(lastPiece).toBeGreaterThan(-1);
  expect(svg.indexOf('jungle-capture-target"')).toBeGreaterThan(lastPiece);
  for (const fill of fills) {
    expect(fill.getAttribute('style')).toContain('mix-blend-mode: multiply');
  }
  // Empty targets keep their dot.
  expect(doc.querySelectorAll('.mb-grid-target-dot').length).toBeGreaterThan(0);
}

describe('Jungle capture targets', () => {
  it.each([false, true])('tints the cell on Flip Jungle (interactive %s)', (interactive) => {
    const svg = renderJungleFlipBoardSvg(
      {
        b2: { faceDown: false, color: 'red', role: 'lion' },
        b3: { faceDown: false, color: 'black', role: 'wolf' },
      },
      { ...SKIN, selected: 'b2', targets: ['b3', 'a2'], interactive },
    );
    expectCellTint(svg, ['b3'], 64);
  });

  it.each([false, true])('tints the cell on Jungle (interactive %s)', (interactive) => {
    const svg = renderJungleBoardSvg(
      {
        c3: { color: 'red', role: 'lion' },
        c4: { color: 'black', role: 'wolf' },
      },
      { ...SKIN, selected: 'c3', targets: ['c4', 'b3'], interactive, cueBadges: false },
    );
    expectCellTint(svg, ['c4'], 48);
  });
});
