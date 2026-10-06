import type { XiangqiColor, XiangqiPlayerView, XiangqiSquare } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  XQ_BOARD_W,
  XQ_CELL,
  XQ_MARGIN,
  xqFogLayer,
  xqPoint,
  xqZoneHighlights,
} from './articles/diagrams.js';
import { squareCenter, VIDEO_BOARD_GEO } from './video/geometry.js';
import { type XiangqiBoardGeometry, xiangqiBoardPoint } from './xiangqi-board-geometry.js';
import { mountXiangqiReplay } from './xiangqi-replay.js';

// Black's view of a xiangqi board is a 180 degree rotation. Every exported
// point function has to agree with the shared xiangqiBoardPoint on the two
// corners, because the middle file cannot tell a rotation from a top-to-bottom
// mirror and the corners can. Three private copies flipped only the rank
// (the article replay, the video overlays, and the diagram fog/zone edges)
// after the shared helper was fixed on 2026-08-27.

const CORNERS: Array<{ square: XiangqiSquare; file: number; rank: number }> = [
  { square: 'a1' as XiangqiSquare, file: 0, rank: 1 },
  { square: 'i10' as XiangqiSquare, file: 8, rank: 10 },
];
const SIDES: XiangqiColor[] = ['red', 'black'];

describe('black-side conformance with xiangqiBoardPoint', () => {
  it('video squareCenter', () => {
    for (const side of SIDES) {
      for (const { square, file, rank } of CORNERS) {
        expect(squareCenter(square, side)).toEqual(
          xiangqiBoardPoint(file, rank, side, 'intersection', VIDEO_BOARD_GEO),
        );
      }
    }
    // The pin that would have caught it: a1 seen from black is top-right.
    expect(squareCenter('a1' as XiangqiSquare, 'black').x).toBe(
      VIDEO_BOARD_GEO.margin + 8 * VIDEO_BOARD_GEO.cell,
    );
  });

  it('article diagram xqPoint', () => {
    const geo: XiangqiBoardGeometry = {
      fileCount: 9,
      rankCount: 10,
      cell: XQ_CELL,
      margin: XQ_MARGIN,
      riverGap: 0,
    };
    for (const side of SIDES) {
      for (const { file, rank } of CORNERS) {
        expect(xqPoint(file, rank, side, 10, 20)).toEqual(
          xiangqiBoardPoint(file, rank, side, 'intersection', geo, 10, 20),
        );
      }
    }
  });

  it('the article replay draws its pieces there', () => {
    for (const side of SIDES) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const c = mountXiangqiReplay(host, {
        iccs: '',
        red: 'Red',
        black: 'Black',
        event: 'Conformance',
        resultText: '*',
        perspective: side,
      });
      const viewBox = host.querySelector('svg.xq-article-svg')?.getAttribute('viewBox') ?? '';
      const width = Number(viewBox.split(' ')[2]);
      const geo: XiangqiBoardGeometry = {
        fileCount: 9,
        rankCount: 10,
        cell: 31,
        margin: (width - 8 * 31) / 2,
        riverGap: 0,
      };
      for (const { square, file, rank } of CORNERS) {
        const piece = host.querySelector(`[data-piece-square="${square}"] svg`);
        const size = Number(piece?.getAttribute('width'));
        const drawn = {
          x: Number(piece?.getAttribute('x')) + size / 2,
          y: Number(piece?.getAttribute('y')) + size / 2,
        };
        expect(drawn).toEqual(xiangqiBoardPoint(file, rank, side, 'intersection', geo));
      }
      c.destroy();
      host.remove();
    }
  });
});

describe('article diagram edges follow the display column', () => {
  /** A fog view hiding exactly one square. */
  const fogOnly = (hidden: string, side: XiangqiColor): XiangqiPlayerView => {
    const visibleSquares: XiangqiSquare[] = [];
    for (const f of 'abcdefghi') {
      for (let r = 1; r <= 10; r += 1) {
        if (`${f}${r}` !== hidden) visibleSquares.push(`${f}${r}` as XiangqiSquare);
      }
    }
    return { perspective: side, visibleSquares } as unknown as XiangqiPlayerView;
  };
  const fogBox = (svg: string) => {
    const m = /d="M ([\d.-]+) ([\d.-]+) H ([\d.-]+) V ([\d.-]+) H/.exec(svg);
    if (!m) throw new Error('no fog path');
    const [left, top, right, bottom] = m.slice(1).map(Number) as [number, number, number, number];
    return { left, top, right, bottom };
  };

  it('a fogged edge-file square covers one cell, bleeding to its own edge', () => {
    for (const side of SIDES) {
      for (const sq of ['a5', 'i5']) {
        const box = fogBox(xqFogLayer(fogOnly(sq, side), 0, 0, side, 'clip'));
        const at = xqPoint(sq === 'a5' ? 0 : 8, 5, side, 0, 0);
        expect(box.left).toBeLessThan(at.x);
        expect(box.right).toBeGreaterThan(at.x);
        // One cell plus the bleed to the board edge, never the whole row.
        expect(box.right - box.left).toBeLessThan(2 * XQ_CELL);
        // The bleed goes to the side the square is drawn on.
        if (at.x < XQ_BOARD_W / 2) expect(box.left).toBe(0);
        else expect(box.right).toBe(XQ_BOARD_W);
      }
    }
  });

  it('the river band has the same positive width from either side', () => {
    const riverWidth = (side: XiangqiColor) => {
      const widths = [...xqZoneHighlights(0, 0, side).matchAll(/width="([\d.-]+)"/g)].map((m) =>
        Number(m[1]),
      );
      return widths[widths.length - 1]!;
    };
    expect(riverWidth('red')).toBeGreaterThan(0);
    expect(riverWidth('black')).toBe(riverWidth('red'));
  });
});
