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

// Rules-diagram arrows run edge to edge, so a leap's arrow never covers the
// lion it starts from or the wolf it lands on. The default (engine and review
// arrows) stays centre to centre and pins where the two centres are.
describe('Jungle arrows that clear the tiles', () => {
  const board = {
    b3: { color: 'red', role: 'lion' },
    b7: { color: 'black', role: 'wolf' },
  } as const;
  const TILE_HALF = 48 * 0.45;

  function arrow(clear: boolean) {
    const svg = renderJungleBoardSvg(board, {
      ...SKIN,
      cueBadges: false,
      arrows: [{ from: 'b3', to: 'b7', width: 9, clearFrom: clear, clearTo: clear }],
    });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const line = doc.querySelector('.jungle-board-arrows line');
    const tip = doc
      .querySelector('.jungle-board-arrows polygon')
      ?.getAttribute('points')
      ?.split(' ')[0];
    expect(line).not.toBeNull();
    expect(tip).toBeDefined();
    const [tipX, tipY] = (tip ?? '').split(',').map(Number);
    return {
      start: { x: Number(line?.getAttribute('x1')), y: Number(line?.getAttribute('y1')) },
      tip: { x: tipX, y: tipY },
      width: Number(line?.getAttribute('stroke-width')),
    };
  }

  it('starts outside the mover and stops outside the piece it lands on', () => {
    const centre = arrow(false);
    const target = centre.tip;
    const dir = Math.sign(target.y - centre.start.y);
    const source = { x: centre.start.x, y: centre.start.y - dir * 8 };
    const cleared = arrow(true);
    expect(cleared.start.x).toBe(source.x);
    expect(cleared.tip.x).toBe(target.x);
    // The shaft's round cap reaches half a width behind its start.
    expect(Math.abs(cleared.start.y - source.y) - cleared.width / 2).toBeGreaterThanOrEqual(
      TILE_HALF,
    );
    expect(Math.abs(cleared.tip.y - target.y)).toBeGreaterThanOrEqual(TILE_HALF);
    // Still pointing from the lion to the wolf.
    expect(Math.sign(cleared.tip.y - cleared.start.y)).toBe(dir);
  });
});
