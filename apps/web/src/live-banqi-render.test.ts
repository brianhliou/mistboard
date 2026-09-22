import { describe, expect, it } from 'vitest';
import { BANQI_BOARD_CSS, renderBanqiBoardSvg } from './live-banqi-render.js';

describe('renderBanqiBoardSvg', () => {
  const view = {
    id: 'banqi-render',
    perspective: 'red',
    board: {
      a1: { color: 'red', role: 'chariot', faceDown: false },
      b1: { faceDown: true },
      c1: { color: 'black', role: 'horse', faceDown: false },
    },
    legalMoves: [
      { from: 'a1', to: 'b1' },
      { from: 'a1', to: 'c1' },
    ],
    captured: [],
    status: { type: 'playing', turn: 'red' },
    ply: 0,
    firstColor: 'red',
    moveNumber: 1,
  };

  it('renders target hover highlights inside the interactive hit layer', () => {
    const svg = renderBanqiBoardSvg(view as never, 'red', {
      interactive: true,
      selectedSquare: 'a1',
      legalMoves: view.legalMoves as never,
    });

    expect(svg).toContain('banqi-hit--target');
    expect(svg).toContain('banqi-target-hover');
    expect(svg).toContain('class="banqi-hint-capture"');
    expect(svg).toContain('class="banqi-hint"');
  });

  it('marks revealed and face-down dragged sources as origin shadows', () => {
    const revealed = renderBanqiBoardSvg(view as never, 'red', { draggingFrom: 'a1' });
    const hidden = renderBanqiBoardSvg(view as never, 'red', { draggingFrom: 'b1' });

    expect(revealed).toContain('banqi-piece banqi-drag-source');
    expect(hidden).toContain('banqi-back banqi-drag-source');
  });

  // Rect geometry of every last-move mark in render order.
  function lastMoveRects(svg: string) {
    return [
      ...svg.matchAll(
        /<rect class="(banqi-lastmove[^"]*)" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g,
      ),
    ].map((m) => ({
      cls: m[1],
      x: Number(m[2]),
      y: Number(m[3]),
      w: Number(m[4]),
      h: Number(m[5]),
    }));
  }

  it('tints the origin and destination cells for a board move', () => {
    const svg = renderBanqiBoardSvg(
      { ...view, ply: 5, lastMove: { from: 'a1', to: 'c1' } } as never,
      'red',
    );
    const rects = lastMoveRects(svg);

    expect(rects.map((r) => r.cls)).toEqual([
      expect.stringContaining('banqi-lastmove-from'),
      expect.stringContaining('banqi-lastmove-to'),
    ]);
    // The shared circular marks are gone, not renamed alongside.
    expect(svg).not.toContain('xq-live-lastmove');
    expect(svg).not.toContain('banqi-last-reveal');
  });

  it('keeps a one-step move\u2019s two marks from overlapping', () => {
    // The bug this treatment exists for: the shared circle geometry ends at half
    // a cell, so on a cell-centre board the origin and destination marks met on
    // the grid line and read as one blob. Asserted against the marks themselves
    // rather than a tuned radius, so it holds at any CELL.
    for (const move of [
      { from: 'a1', to: 'b1' }, // horizontal step
      { from: 'a1', to: 'a2' }, // vertical step
    ]) {
      const rects = lastMoveRects(
        renderBanqiBoardSvg({ ...view, ply: 5, lastMove: move } as never, 'red'),
      );
      expect(rects).toHaveLength(2);
      const [from, to] = rects;
      const overlapX = Math.min(from.x + from.w, to.x + to.w) - Math.max(from.x, to.x);
      const overlapY = Math.min(from.y + from.h, to.y + to.h) - Math.max(from.y, to.y);
      expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0);
    }
  });

  it('marks a flip as a single bordered cell', () => {
    const svg = renderBanqiBoardSvg(
      { ...view, ply: 5, lastMove: { from: 'a1', to: 'a1' } } as never,
      'red',
    );
    const rects = lastMoveRects(svg);

    // A flip is a self-move: one cell, and never an origin wash to go with it.
    expect(rects).toHaveLength(1);
    expect(rects[0]?.cls).toContain('banqi-lastmove-flip');
    expect(svg).not.toContain('banqi-lastmove-from');

    // A move's tint fills its cell edge to edge, but the flip's rect must be
    // strictly smaller: its border straddles the rect edge, so an un-inset flip
    // would paint the outer half of that stroke into the neighbouring cell.
    const [from, to] = lastMoveRects(
      renderBanqiBoardSvg({ ...view, ply: 5, lastMove: { from: 'a1', to: 'b1' } } as never, 'red'),
    );
    const cell = (to?.x ?? 0) - (from?.x ?? 0); // one-step move => centres one cell apart
    expect(cell).toBeGreaterThan(0);
    expect(rects[0]?.w).toBeLessThan(cell);
  });

  it('colours the mark with the mover\u2019s ink, not the ink a flip revealed', () => {
    // Black flips up a RED piece. The mark must say black -- a flip reveals a
    // random tile, so the revealed colour says nothing about who acted, and this
    // is precisely the ply where the board offers no other clue.
    const svg = renderBanqiBoardSvg(
      {
        ...view,
        board: { ...view.board, a1: { color: 'red', role: 'chariot', faceDown: false } },
        firstColor: 'red', // red SEAT plays red ink, so the black seat plays black
        ply: 6, // ply 5 was the black seat's (red acts on even ply)
        lastMove: { from: 'a1', to: 'a1' },
      } as never,
      'red',
    );

    expect(svg).toContain('banqi-lastmove--black');
    expect(svg).not.toContain('banqi-lastmove--red');
  });

  it('falls back to the neutral highlight before an ink is bound', () => {
    const svg = renderBanqiBoardSvg(
      { ...view, firstColor: null, ply: 1, lastMove: { from: 'a1', to: 'a1' } } as never,
      'red',
    );

    expect(lastMoveRects(svg)).toHaveLength(1);
    expect(svg).not.toContain('banqi-lastmove--');
  });

  it('carries last-move alpha in the colour, never in opacity', () => {
    // drawMarkerOnArrival fades the destination mark's element opacity 0 -> 1.
    // A mark whose resting opacity is 0.36 therefore ramps to fully solid and
    // snaps back down when the animation clears: a dark flash that settles
    // lighter. Shipped exactly that on 2026-08-30. live-xiangqi.css states the
    // same rule for the square-grid marks; this holds banqi to it.
    const rules = BANQI_BOARD_CSS.split('}')
      .map((chunk) => chunk.split('{'))
      .filter((parts) => parts.length === 2 && parts[0].includes('banqi-lastmove'));

    expect(rules.length).toBeGreaterThan(0);
    for (const [selector, body] of rules) {
      expect({ selector: selector.trim(), opacity: /(^|[^-])opacity\s*:/.test(body) }).toEqual({
        selector: selector.trim(),
        opacity: false,
      });
    }
  });
});

describe('the board stylesheet mirror', () => {
  it('live-banqi-board.css carries BANQI_BOARD_CSS exactly', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const file = readFileSync(resolve(__dirname, 'live-banqi-board.css'), 'utf-8');
    // Biome formats the .css; the string keeps its own indentation. Compare
    // the rules, not the whitespace.
    const norm = (s: string): string =>
      s
        .replace(/\s+/g, ' ')
        .replace(/\s*([{};:,])\s*/g, '$1')
        .trim();
    const body = file.replace(/^\/\*[\s\S]*?\*\/\n/, '');
    expect(norm(body)).toBe(norm(BANQI_BOARD_CSS));
  });
});
