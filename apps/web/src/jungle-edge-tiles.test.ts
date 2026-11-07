import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JUNGLE_FLIP_BOARD_VIEW,
  JUNGLE_FLIP_TOKEN_REACH,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';
import { JUNGLE_BOARD_VIEW, renderJungleBoardSvg } from './jungle-render.js';

// Flat pieces unless a test asks for 3D: the board-wide 3D default
// (piece3dEnabled, 2026-10-28) reads the root, which these tests pin off.
beforeEach(() => {
  document.documentElement.dataset.banqiTile3d = 'off';
});
afterEach(() => {
  delete document.documentElement.dataset.banqiTile3d;
});

// Both boards draw grid lines on interior cell boundaries only, never a perimeter.
// Between two cells the 1-unit line covers any gap under a tile's edge; at the board
// edge nothing does, so a tile short of its cell left a strip of land against the
// frame (2026-10-15). A Jungle tile in an edge cell must reach the board edge, and
// two neighbours must meet on their shared boundary. Flip Jungle's smaller tiles
// (2026-10-28) leave an even margin in every cell instead.

type Box = { left: number; right: number; top: number; bottom: number };

/** Each piece slot's outer box: its rects' extent, half the stroke included. */
function tileBoxes(svg: string): Map<string, Box> {
  const host = document.createElement('div');
  host.innerHTML = svg;
  const boxes = new Map<string, Box>();
  for (const slot of host.querySelectorAll('[data-piece-square]')) {
    const box: Box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const rect of slot.querySelectorAll('rect')) {
      const n = (name: string) => Number(rect.getAttribute(name) ?? 0);
      const half = n('stroke-width') / 2;
      box.left = Math.min(box.left, n('x') - half);
      box.right = Math.max(box.right, n('x') + n('width') + half);
      box.top = Math.min(box.top, n('y') - half);
      box.bottom = Math.max(box.bottom, n('y') + n('height') + half);
    }
    boxes.set(slot.getAttribute('data-piece-square') ?? '', box);
  }
  return boxes;
}

function expectFlushEdges(
  boxes: Map<string, Box>,
  view: { cell: number; files: number; ranks: number },
) {
  const all = [...boxes.values()];
  expect(all.length).toBeGreaterThanOrEqual(4);
  // Within the renderers' rounding (quarter-unit token box, 3-decimal attributes).
  const near = 0.05;
  expect(Math.min(...all.map((b) => b.left))).toBeCloseTo(0, 1);
  expect(Math.min(...all.map((b) => b.top))).toBeCloseTo(0, 1);
  expect(Math.abs(Math.max(...all.map((b) => b.right)) - view.files * view.cell)).toBeLessThan(
    near,
  );
  expect(Math.abs(Math.max(...all.map((b) => b.bottom)) - view.ranks * view.cell)).toBeLessThan(
    near,
  );
  // No tile spills past the board either.
  for (const b of all) {
    expect(b.left).toBeGreaterThan(-near);
    expect(b.top).toBeGreaterThan(-near);
    expect(b.right).toBeLessThan(view.files * view.cell + near);
    expect(b.bottom).toBeLessThan(view.ranks * view.cell + near);
  }
}

describe('jungle edge tiles meet the board edge', () => {
  const corners = {
    a1: { color: 'red', role: 'rat' },
    b1: { color: 'red', role: 'cat' },
    g1: { color: 'red', role: 'dog' },
    a9: { color: 'black', role: 'lion' },
    g9: { color: 'black', role: 'tiger' },
  } as const;

  for (const pieceSkin of ['animals', 'characters'] as const) {
    it(`Jungle, ${pieceSkin} tokens`, () => {
      const boxes = tileBoxes(
        renderJungleBoardSvg(corners, { boardSkin: 'bare', pieceSkin, cueBadges: false }),
      );
      expectFlushEdges(boxes, JUNGLE_BOARD_VIEW);
      // Orthogonal neighbours meet on their shared boundary, neither short nor overlapping.
      const a1 = boxes.get('a1');
      const b1 = boxes.get('b1');
      expect(Math.abs((a1?.right ?? 0) - JUNGLE_BOARD_VIEW.cell)).toBeLessThan(0.05);
      expect(Math.abs((b1?.left ?? 0) - JUNGLE_BOARD_VIEW.cell)).toBeLessThan(0.05);
    });
  }

  it('Flip Jungle, face-down and revealed tiles: centred at JUNGLE_FLIP_TOKEN_REACH', () => {
    // Flip Jungle's tiles span 80% of the cell (Brian, 2026-10-28), so every tile
    // has the same margin of land, edge cells included, and face-down and
    // revealed tiles keep one size.
    const board = {
      a1: { faceDown: true },
      b1: { faceDown: true },
      d1: { color: 'red', role: 'lion', faceDown: false },
      a4: { color: 'black', role: 'cat', faceDown: false },
      d4: { faceDown: true },
    } as const;
    const boxes = tileBoxes(
      renderJungleFlipBoardSvg(board, { boardSkin: 'bare', pieceSkin: 'animals' }),
    );
    const { cell } = JUNGLE_FLIP_BOARD_VIEW;
    const inset = (cell * (1 - JUNGLE_FLIP_TOKEN_REACH)) / 2;
    for (const square of Object.keys(board)) {
      const box = boxes.get(square);
      const x0 = 'abcd'.indexOf(square[0] ?? '') * cell;
      const y0 = (4 - Number(square[1])) * cell;
      // Within the quarter-unit token box.
      expect(Math.abs((box?.left ?? 0) - (x0 + inset))).toBeLessThan(0.3);
      expect(Math.abs((box?.right ?? 0) - (x0 + cell - inset))).toBeLessThan(0.3);
      expect(Math.abs((box?.top ?? 0) - (y0 + inset))).toBeLessThan(0.3);
      expect(Math.abs((box?.bottom ?? 0) - (y0 + cell - inset))).toBeLessThan(0.3);
    }
  });
});
