import {
  applyDuckXiangqiTurn,
  applyJieqiMove,
  applyMove as applyXiangqiMove,
  createInitialDuckXiangqiState,
  createInitialJieqiState,
  createInitialXiangqiState,
  getDuckXiangqiPlayerView,
  getJieqiLegalMoves,
  getJieqiPlayerView,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  boardLastMoveCellMarksSvg,
  boardLastMoveMarkersSvg,
  boardLastMovePiece,
  CELL_LASTMOVE_AMBER,
  CELL_LASTMOVE_ORIGIN_OPACITY,
  CELL_LASTMOVE_RING_WIDTH,
} from './board-lastmove.js';
import { xiangqiPieceCellBox } from './board-metrics.js';
import { duckXiangqiBoardSvg } from './duck-xiangqi-board.js';
import { renderJungleBoardSvg } from './jungle-render.js';
import { renderJieqiBoardSvg } from './live-jieqi-render.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { renderXiangqiBoardSvg } from './xiangqi-board.js';
import { xiangqiPieceOuterRadius } from './xiangqi-piece-sets.js';

// Flat pieces unless a test asks for 3D: the board-wide 3D default
// (piece3dEnabled, 2026-10-28) reads the root, which these tests pin off.
beforeEach(() => {
  document.documentElement.dataset.banqiTile3d = 'off';
});
afterEach(() => {
  delete document.documentElement.dataset.banqiTile3d;
});

// The destination band (2026-10-15) hugs the OUTSIDE of the drawn piece and
// draws UNDER the piece layer with the origin wash: the piece covers none of it,
// and a neighbour one point away, whose disc reaches into the band, paints its
// own outline over it. From 2026-10-14 to 10-15 an r-28 halo drew over the
// pieces and crossed their dark edge; nothing of the intersection marks may
// sit above the pieces now. The square grid has its own marks (Brian,
// 2026-10-15): a solid amber origin cell under the pieces and an amber ring on
// the moved piece's outline over them.
const OVER_GROUP = '<g class="xq-live-lastmove-over" aria-hidden="true" pointer-events="none">';

function assertBandUnderPieces(svg: string, pieceMarker: string) {
  const ring = svg.indexOf('class="xq-live-lastmove-ring"');
  const origin = svg.indexOf('xq-live-lastmove-from');
  expect(ring).toBeGreaterThan(-1);
  expect(origin).toBeGreaterThan(-1);
  // Both before the first piece, the band after the wash, each drawn once...
  expect(ring).toBeLessThan(svg.indexOf(pieceMarker));
  expect(origin).toBeLessThan(ring);
  expect(svg.match(/xq-live-lastmove-ring/g)).toHaveLength(1);
  expect(svg.match(/xq-live-lastmove-from/g)).toHaveLength(1);
  // ...and the over group, kept for the square grid, is empty here.
  const over = svg.indexOf(OVER_GROUP);
  if (over > -1) expect(svg.slice(over + OVER_GROUP.length).startsWith('</g>')).toBe(true);
}

describe('the destination band draws under the pieces', () => {
  const ends = { from: { x: 0, y: 0 }, to: { x: 60, y: 0 } };
  const piece = boardLastMovePiece(62, 'international');

  it('emits both intersection marks in the under layer and nothing over', () => {
    const under = boardLastMoveMarkersSvg(ends, 54, 'under', piece);
    expect(under).toContain('xq-live-lastmove-from');
    expect(under).toContain('xq-live-lastmove-ring');
    expect(boardLastMoveMarkersSvg(ends, 54, 'over', piece)).toBe('');
    expect(boardLastMoveMarkersSvg(ends, 54, 'both', piece)).toBe(under);
  });

  it('on the xiangqi board', () => {
    const state = applyXiangqiMove(createInitialXiangqiState('halo-over'), {
      from: 'b3',
      to: 'e3',
    });
    const svg = renderXiangqiBoardSvg(getStandardXiangqiPlayerView(state, 'red'));
    assertBandUnderPieces(svg, 'class="xq-piece-slot"');
  });

  it('on the duck xiangqi board', () => {
    const state = applyDuckXiangqiTurn(createInitialDuckXiangqiState('halo-over'), {
      from: 'b3',
      to: 'e3',
      duckTo: 'e6',
    });
    if (!state) throw new Error('b3-e3@e6 should be a legal opening turn');
    const svg = duckXiangqiBoardSvg(getDuckXiangqiPlayerView(state, 'red'), 'red', {
      interactive: false,
      phase: { kind: 'piece', selected: null },
      targets: [],
      layout: 'intersection',
    });
    assertBandUnderPieces(svg, 'class="xq-piece-slot"');
  });

  it('on the jieqi board, sized to its larger piece', () => {
    const start = createInitialJieqiState('halo-over');
    const state = applyJieqiMove(start, getJieqiLegalMoves(start)[0]);
    const svg = renderJieqiBoardSvg(getJieqiPlayerView(state, 'red'), 'red', {
      layout: 'intersection',
      interactive: false,
      pieceSet: 'international',
    });
    assertBandUnderPieces(svg, 'class="jieqi-piece-slot"');
    // Cell 72 draws its piece in a 74.5 box: band 35.31 to 38.32, centre 36.82.
    expect(svg).toMatch(
      /<circle class="xq-live-lastmove-ring" cx="[\d.]+" cy="[\d.]+" r="36.82" stroke-width="3"\/>/,
    );
  });

  it('keeps the intersection layout on the wash and band', () => {
    const state = applyXiangqiMove(createInitialXiangqiState('halo-int'), {
      from: 'b3',
      to: 'e3',
    });
    const svg = renderXiangqiBoardSvg(getStandardXiangqiPlayerView(state, 'red'), 'red', {
      layout: 'intersection',
    });
    expect(svg).toContain('<circle class="xq-live-lastmove-cell xq-live-lastmove-from"');
    expect(svg).not.toContain('xq-live-lastmove-origin');
    expect(svg).not.toContain('xq-live-lastmove-piece-ring');
    expect(svg).not.toContain('xq-live-lastmove-square');
  });
});

// The square-grid pick of 2026-10-15 (C3 origin fill + D2 ring from the
// board-sweep option tiles).
describe('the square grid marks the last move with an amber origin cell and a piece ring', () => {
  const ORIGIN_RECT =
    /<rect class="xq-live-lastmove-origin xq-live-lastmove-from" fill="#f59e0b" fill-opacity="0\.65" pointer-events="none" x="([\d.-]+)" y="([\d.-]+)" width="(\d+)" height="(\d+)"\/>/;

  function assertCellMarks(svg: string, pieceMarker: string, cell: number, pieceSize: number) {
    // Origin: the whole cell, edge to edge, solid amber at 0.65, under the pieces.
    const origin = svg.match(ORIGIN_RECT);
    expect(origin?.slice(3)).toEqual([String(cell), String(cell)]);
    expect(svg.indexOf('xq-live-lastmove-origin')).toBeLessThan(svg.indexOf(pieceMarker));
    // The destination tint stays under the piece too.
    expect(svg.lastIndexOf('xq-live-lastmove-to')).toBeLessThan(svg.indexOf(pieceMarker));
    // Ring: just outside the piece's own rounded-square outline (rect 4..96, rx
    // 14 at the stroke's centre, in the 100-unit box its art fills), 4.2 box
    // units wide, concentric with it and still inside the square, in the over
    // group after every piece (Brian, 2026-10-29: "draw the ring a little
    // outside the black line").
    const over = svg.indexOf(OVER_GROUP);
    const ring = svg.indexOf('class="xq-live-lastmove-piece-ring"');
    expect(over).toBeGreaterThan(svg.lastIndexOf(pieceMarker));
    expect(ring).toBeGreaterThan(over);
    expect(svg.slice(over, ring)).not.toContain('</g>');
    const k = xiangqiPieceCellBox(pieceSize) / 100;
    const outer = xiangqiPieceOuterRadius(readStoredXiangqiPieceSet());
    const tag = svg.slice(svg.lastIndexOf('<rect', ring), svg.indexOf('/>', ring));
    const width = Number(tag.match(/ width="([\d.]+)"/)?.[1]);
    expect(width).toBeCloseTo(2 * (outer + 2.1) * k, 1);
    expect(width + 4.2 * k).toBeLessThan(cell);
    expect(Number(tag.match(/ rx="([\d.]+)"/)?.[1])).toBeCloseTo((14 + outer - 46 + 2.1) * k, 1);
    expect(tag).toContain('stroke="#f59e0b"');
    expect(Number(tag.match(/stroke-width="([\d.]+)"/)?.[1])).toBeCloseTo(4.2 * k, 1);
    expect(svg.match(/xq-live-lastmove-piece-ring/g)).toHaveLength(1);
    // The intersection marks are not drawn alongside.
    expect(svg).not.toContain('xq-live-lastmove-ring');
    expect(svg).not.toContain('xq-live-lastmove-cell');
  }

  it('names the picked colour, opacity and width once', () => {
    expect(CELL_LASTMOVE_AMBER).toBe('#f59e0b');
    expect(CELL_LASTMOVE_ORIGIN_OPACITY).toBe(0.65);
    expect(CELL_LASTMOVE_RING_WIDTH).toBe(4.2);
  });

  it('splits into an under layer (cells) and an over layer (ring)', () => {
    const ends = { from: { x: 30, y: 30 }, to: { x: 90, y: 30 } };
    const piece = { size: 100, set: 'traditional' as const };
    const under = boardLastMoveCellMarksSvg(ends, 60, 'under', piece);
    const over = boardLastMoveCellMarksSvg(ends, 60, 'over', piece);
    expect(under).toContain('xq-live-lastmove-origin');
    expect(under).not.toContain('piece-ring');
    expect(over).toBe(
      '<rect class="xq-live-lastmove-piece-ring" fill="none" stroke="#f59e0b" stroke-width="4.2" data-cx="90" data-cy="30" x="40.65" y="-19.35" width="98.7" height="98.7" rx="17.35"/>',
    );
    expect(boardLastMoveCellMarksSvg(ends, 60, 'both', piece)).toBe(under + over);
    // A disc-drawn set gets a circle on its disc instead.
    expect(boardLastMoveCellMarksSvg(ends, 60, 'over', { size: 100, set: 'wood' })).toMatch(
      /^<circle class="xq-live-lastmove-piece-ring" [^>]*r="47.1"\/>$/,
    );
    // A drop (no origin) still rings the piece; nothing at all with no endpoints.
    expect(boardLastMoveCellMarksSvg({ to: ends.to }, 60, 'under', piece)).not.toContain(
      'lastmove-origin',
    );
    expect(boardLastMoveCellMarksSvg({}, 60, 'both', piece)).toBe('');
  });

  it('on the xiangqi board', () => {
    const state = applyXiangqiMove(createInitialXiangqiState('halo-cell'), {
      from: 'b3',
      to: 'e3',
    });
    const svg = renderXiangqiBoardSvg(getStandardXiangqiPlayerView(state, 'red'), 'red', {
      layout: 'cell',
    });
    assertCellMarks(svg, 'class="xq-piece-slot"', 60, 62);
  });

  // Jieqi offered the square grid from 2026-08-27 but kept drawing the
  // intersection disc and halo on it until 2026-10-15.
  it('on the jieqi board', () => {
    const start = createInitialJieqiState('halo-cell');
    const state = applyJieqiMove(start, getJieqiLegalMoves(start)[0]);
    const svg = renderJieqiBoardSvg(getJieqiPlayerView(state, 'red'), 'red', {
      layout: 'cell',
      interactive: false,
    });
    assertCellMarks(svg, 'class="jieqi-piece-slot"', 72, 74.5);
  });

  it('on the duck xiangqi board', () => {
    const state = applyDuckXiangqiTurn(createInitialDuckXiangqiState('halo-cell'), {
      from: 'b3',
      to: 'e3',
      duckTo: 'e6',
    });
    if (!state) throw new Error('b3-e3@e6 should be a legal opening turn');
    const svg = duckXiangqiBoardSvg(getDuckXiangqiPlayerView(state, 'red'), 'red', {
      interactive: false,
      phase: { kind: 'piece', selected: null },
      targets: [],
      layout: 'cell',
    });
    assertCellMarks(svg, 'class="xq-piece-slot"', 60, 62);
  });

  it('leaves Jungle on its own cell tints', () => {
    const svg = renderJungleBoardSvg(
      { a4: { color: 'red', role: 'rat' } },
      { lastMove: { from: 'a3', to: 'a4' }, shadow: false },
    );
    expect(svg).toContain('jungle-last-move-from');
    expect(svg).not.toContain('xq-live-lastmove');
  });
});
