import { describe, expect, it } from 'vitest';
import {
  BOARD_LASTMOVE_BAND_WIDTH,
  boardLastMoveBand,
  boardLastMoveMarkersSvg,
  boardLastMoveOuterRadius,
  boardLastMovePiece,
} from './board-lastmove.js';
import { tokenPieceSize, xiangqiPieceDrawSize } from './board-metrics.js';
import {
  XIANGQI_PIECE_SETS,
  type XiangqiPieceSet,
  xiangqiPieceOuterRadius,
} from './xiangqi-piece-sets.js';

// A move between adjacent intersections puts the origin wash one cell from the
// destination band. The two used to need 63 units where a cell gives 60, so the
// pair visibly collided on every one-step move on every token board. Sizing both
// to half a cell fixed the collision and left them exactly tangent, which reads
// as one merged lozenge rather than two marks -- so the origin stops at the
// piece radius and the daylight is asserted, not just the absence of overlap.
describe('the shared last-move marks', () => {
  const attrOf = (svg: string, cls: string, attr: string) => {
    const m = svg.match(new RegExp(`class="[^"]*${cls}[^"]*"[^>]*\\b${attr}="([\\d.]+)"`));
    return m ? Number(m[1]) : Number.NaN;
  };
  // Stroke is centred on the circle, so each mark reaches half a stroke past its
  // radius. The origin's stroke scales with the piece (boardLastMoveStyleAttr);
  // the band carries its own stroke-width.
  const marks = (cell: number, set: XiangqiPieceSet = 'international') => {
    const pieceSize = tokenPieceSize(cell);
    const scale = pieceSize / tokenPieceSize(60);
    const box = xiangqiPieceDrawSize(cell);
    const svg = boardLastMoveMarkersSvg(
      { from: { x: 0, y: 0 }, to: { x: cell, y: 0 } },
      pieceSize,
      'under',
      boardLastMovePiece(box, set),
    );
    const r = attrOf(svg, 'xq-live-lastmove-ring', 'r');
    const width = attrOf(svg, 'xq-live-lastmove-ring', 'stroke-width');
    return {
      pieceSize,
      scale,
      box,
      origin: attrOf(svg, 'xq-live-lastmove-from', 'r') + (2 * scale) / 2,
      bandInner: r - width / 2,
      bandOuter: r + width / 2,
      width,
    };
  };

  for (const cell of [72, 60, 44, 31]) {
    it(`leaves daylight on a one-step move at cell ${cell}`, () => {
      // Touching is not clearing: assert a real gap, in canonical units so the
      // claim means the same thing on every board size we ship. The band sits
      // outside the 98% piece, so the gap is about one unit, less where
      // tokenPieceSize rounds the piece UP (cell 44); the widest rim (a
      // face-down jieqi back, 47.5) is the tightest case.
      for (const set of ['international', 'traditional', 'wood'] as const) {
        const { origin, bandOuter, scale } = marks(cell, set);
        expect((cell - origin - bandOuter) / scale).toBeGreaterThanOrEqual(0.7);
      }
      const back = boardLastMoveBand({
        box: xiangqiPieceDrawSize(cell),
        outer: xiangqiPieceOuterRadius('international', { shrouded: true, shroudedStyle: 'back' }),
      });
      const { origin, scale } = marks(cell);
      expect((cell - origin - back.outer) / scale).toBeGreaterThanOrEqual(0.7);
    });

    it(`stops the origin wash at the piece that left, at cell ${cell}`, () => {
      const { origin, pieceSize, scale } = marks(cell);
      expect(origin).toBeCloseTo(pieceSize / 2, Math.abs(scale - 1) < 0.01 ? 5 : 0);
    });

    it(`puts the band's inner edge on the drawn disc's outer edge at cell ${cell}`, () => {
      // The band hugs the piece from outside: its inner edge exactly where the
      // outline (stroke included) ends, for every set, so the piece covers none
      // of it and it never crosses the piece's own dark edge.
      for (const { id } of XIANGQI_PIECE_SETS) {
        const { bandInner, box } = marks(cell, id);
        expect(bandInner).toBeCloseTo((box * xiangqiPieceOuterRadius(id)) / 100, 1);
      }
    });

    it(`scales the band width with the drawn piece at cell ${cell}`, () => {
      const { width, box } = marks(cell);
      expect(width).toBeCloseTo((BOARD_LASTMOVE_BAND_WIDTH * box) / xiangqiPieceDrawSize(60), 2);
    });
  }

  it('matches the prototype on the standard board: 29.39 to 31.89, centre 30.64', () => {
    const band = boardLastMoveBand(boardLastMovePiece(xiangqiPieceDrawSize(60), 'international'));
    expect(band).toEqual({ inner: 29.39, outer: 31.89, r: 30.64, width: 2.5 });
    expect(
      boardLastMoveMarkersSvg(
        { to: { x: 0, y: 0 } },
        54,
        'under',
        boardLastMovePiece(62, 'international'),
      ),
    ).toBe('<circle class="xq-live-lastmove-ring" cx="0" cy="0" r="30.64" stroke-width="2.5"/>');
  });

  it('reports the band as the outermost mark', () => {
    const piece = boardLastMovePiece(xiangqiPieceDrawSize(60), 'international');
    expect(boardLastMoveOuterRadius(tokenPieceSize(60), piece)).toBe(31.89);
  });
});
