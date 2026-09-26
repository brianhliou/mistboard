// The extraction guard. These pin the shared surface functions to the exact
// strings the standard board's own layers produced before they were extracted,
// so a refactor that changes a coordinate, a class name, or the order of parts
// fails here rather than silently redrawing every xiangqi board on the site.
//
// The expected values are the pre-extraction output, captured by rendering the
// live board at CELL 60 / MARGIN 36 and copying what it emitted.

import { afterEach, describe, expect, it } from 'vitest';
import {
  type XiangqiSurfaceConfig,
  xiangqiSurfaceGrid,
  xiangqiSurfacePalace,
  xiangqiSurfacePalaceBands,
  xiangqiSurfaceRiver,
} from './xiangqi-board-surface.js';

const STANDARD: XiangqiSurfaceConfig = {
  geo: { fileCount: 9, rankCount: 10, cell: 60, margin: 36, riverGap: 12 },
  palaces: [
    { fileMin: 3, fileMax: 5, rankMin: 1, rankMax: 3 },
    { fileMin: 3, fileMax: 5, rankMin: 8, rankMax: 10 },
  ],
  riverAfterRank: 5,
  riverLabel: '楚 河   漢 界',
};

describe('xiangqi board surface, intersection layout', () => {
  it('draws every rank line edge to edge', () => {
    const svg = xiangqiSurfaceGrid(STANDARD, 'intersection');
    // 10 ranks, spanning file a (x=36) to file i (x=516).
    expect(svg.match(/x1="36" y1="\d+" x2="516"/g)).toHaveLength(10);
    expect(svg).toContain('<line class="xq-live-line" x1="36" y1="36" x2="516" y2="36"/>');
    expect(svg).toContain('<line class="xq-live-line" x1="36" y1="576" x2="516" y2="576"/>');
  });

  it('breaks the interior files at the river but runs the outer two through', () => {
    const svg = xiangqiSurfaceGrid(STANDARD, 'intersection');
    // River sits between ranks 5 and 6: y 276..336 with rank 1 at the bottom.
    expect(svg).toContain('<line class="xq-live-line" x1="36" y1="36" x2="36" y2="576"/>');
    expect(svg).toContain('<line class="xq-live-line" x1="516" y1="36" x2="516" y2="576"/>');
    expect(svg).toContain('<line class="xq-live-line" x1="96" y1="36" x2="96" y2="276"/>');
    expect(svg).toContain('<line class="xq-live-line" x1="96" y1="336" x2="96" y2="576"/>');
  });

  it('centres the river caption on the middle file', () => {
    const svg = xiangqiSurfaceRiver(STANDARD, 'red', 'intersection');
    // Middle of 9 files is index 4 -> x = 36 + 4*60 = 276; caption baseline y+1.
    expect(svg).toContain('x="276"');
    expect(svg).toContain('楚 河   漢 界');
  });

  it('draws two crossed diagonals per palace', () => {
    const svg = xiangqiSurfacePalace(STANDARD, 'red', 'intersection');
    expect(svg.match(/<line /g)).toHaveLength(4);
  });
});

describe('xiangqi board surface, square grid layout', () => {
  it('paints one rect per point and alternates the two shades', () => {
    const svg = xiangqiSurfaceGrid(STANDARD, 'cell');
    expect(svg.match(/<rect class="xq-live-cell /g)).toHaveLength(90);
    expect(svg).toContain('xq-live-cell--light" x="6" y="6"');
    expect(svg).toContain('xq-live-cell--dark" x="66" y="6"');
  });

  it('drops the palace diagonals, keeping the tinted cells as the cue', () => {
    expect(xiangqiSurfacePalace(STANDARD, 'red', 'cell')).toBe('');
    expect(xiangqiSurfacePalaceBands(STANDARD, 'red', 'cell')).toContain('xq-live-palace-band');
  });

  it('renders the river as a band, not a caption', () => {
    const svg = xiangqiSurfaceRiver(STANDARD, 'red', 'cell');
    expect(svg).toContain('xq-live-cell-river');
    expect(svg).toContain('height="12"');
    expect(svg).not.toContain('楚');
  });
});

describe('board-specific config, not xiangqi constants', () => {
  // Fortress is 7x8 and does not share xiangqi's palace coordinates or river.
  const FORTRESS: XiangqiSurfaceConfig = {
    geo: { fileCount: 7, rankCount: 8, cell: 72, margin: 42, riverGap: 12 },
    palaces: [],
    riverAfterRank: null,
  };

  it('runs every file edge to edge when the board has no river', () => {
    const svg = xiangqiSurfaceGrid(FORTRESS, 'intersection');
    // 7 files, all unbroken: one <line> each, plus 8 rank lines.
    const verticals = svg.match(/y1="42" x2="\d+" y2="546"/g);
    expect(verticals).toHaveLength(7);
  });

  it('draws nothing for a board with no palaces or river', () => {
    expect(xiangqiSurfacePalace(FORTRESS, 'red', 'intersection')).toBe('');
    expect(xiangqiSurfacePalaceBands(FORTRESS, 'red', 'intersection')).toBe('');
    expect(xiangqiSurfaceRiver(FORTRESS, 'red', 'intersection')).toBe('');
  });
});

// The children's board (2026-09-25): under the Jungle theme the square grid adds a
// cream rug to each palace and paints
// the river with the Jungle game's water tile. Other themes and the intersection
// layout draw exactly what they drew before.
describe('jungle theme art', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-xiangqi-board-theme');
  });

  it('lays a plain cream rug on each palace, with 3x3 seams', () => {
    document.documentElement.dataset.xiangqiBoardTheme = 'jungle';
    const svg = xiangqiSurfacePalaceBands(STANDARD, 'red', 'cell');
    // Red's palace (ranks 1-3) is at the bottom from red's side: y 438..618.
    expect(svg).toContain(
      '<rect class="xq-live-palace-rug" x="186" y="438" width="180" height="180"/>',
    );
    expect(svg).toContain(
      '<rect class="xq-live-palace-rug" x="186" y="6" width="180" height="180"/>',
    );
    expect(svg.match(/xq-live-palace-seam/g)).toHaveLength(8);
  });

  it('paints the river strip with water and banks', () => {
    document.documentElement.dataset.xiangqiBoardTheme = 'jungle';
    const svg = xiangqiSurfaceRiver(STANDARD, 'red', 'cell');
    expect(svg).toContain('<svg class="xq-live-river-art" x="6" y="306" width="540" height="12"');
    expect(svg).toContain('/piece-sets/jungle/dobutsu/board/water.png');
    expect(svg.match(/xq-live-river-bank/g)).toHaveLength(2);
  });

  it('draws nothing extra on other themes or on the intersection layout', () => {
    expect(xiangqiSurfacePalaceBands(STANDARD, 'red', 'cell')).not.toContain('palace-rug');
    document.documentElement.dataset.xiangqiBoardTheme = 'jungle';
    expect(xiangqiSurfacePalaceBands(STANDARD, 'red', 'intersection')).not.toContain('palace-rug');
    expect(xiangqiSurfaceRiver(STANDARD, 'red', 'intersection')).not.toContain('water.png');
  });
});
