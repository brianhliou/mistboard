import {
  createInitialJieqiState,
  createInitialXiangqiState,
  getJieqiPlayerView,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('temporary capture target comparison', () => {
  it('reads the query once and ignores later URL changes', async () => {
    const search = vi.fn(() => '?captureTargetStyle=corners');
    vi.stubGlobal('location', {
      get search() {
        return search();
      },
    });
    vi.resetModules();
    const { captureTargetStyle } = await import('./board-capture-target.js');
    expect(captureTargetStyle('cell')).toBe('corners');
    search.mockReturnValue('?captureTargetStyle=fill');
    expect(captureTargetStyle('intersection')).toBe('corners');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, { search: '?captureTargetStyle=unknown' }])(
    'uses layout defaults with missing location or an unknown value (%s)',
    async (location) => {
      vi.stubGlobal('location', location);
      vi.resetModules();
      const { captureTargetStyle } = await import('./board-capture-target.js');
      expect(captureTargetStyle('cell')).toBe('fill');
      expect(captureTargetStyle('intersection')).toBe('ring');
    },
  );

  for (const style of ['ring', 'fill', 'corners', 'legacy'] as const) {
    it.each(['cell', 'intersection'] as const)(
      `compares ${style} on both flat boards while preserving raised marks (%s)`,
      async (layout) => {
        vi.stubGlobal('location', { search: `?captureTargetStyle=${style}` });
        vi.resetModules();
        const { renderJieqiBoardSvg } = await import('./live-jieqi-render.js');
        const { xiangqiBoardSvg } = await import('./xiangqi-board.js');
        const jieqi = getJieqiPlayerView(createInitialJieqiState('compare'), 'red');
        const xiangqi = getStandardXiangqiPlayerView(createInitialXiangqiState('compare'), 'red');
        for (const tile3d of [false, true]) {
          const options = {
            layout,
            tile3d,
            pieceSet: 'traditional' as const,
            interactive: true,
            selectedSquare: 'b3' as const,
          };
          const boards = [
            {
              svg: renderJieqiBoardSvg(jieqi, 'red', {
                ...options,
                legalMoves: jieqi.legalMoves.filter((move) => move.from === 'b3'),
              }),
              prefix: 'jieqi',
              radius: 38.25,
              legacy: 33.5,
              cell: 72,
              layer: '<g class="jieqi-piece-slot',
            },
            {
              svg: xiangqiBoardSvg(xiangqi, 'red', { ...options, draggingFrom: null }),
              prefix: 'xq-live',
              radius: 32,
              legacy: 28,
              cell: 60,
              layer: '<g class="xq-live-pieces">',
            },
          ];
          for (const { svg, prefix, radius, legacy, cell, layer } of boards) {
            const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
            const marks = [...doc.querySelectorAll(`[class*="${prefix}-hint-capture"]`)];
            if (tile3d) {
              expect(marks).toHaveLength(0);
              expect(doc.querySelectorAll('.board-select3d-face')).toHaveLength(1);
              continue;
            }
            expect(marks).toHaveLength(1);
            const mark = marks[0]!;
            if (style === 'ring' || style === 'legacy') {
              expect(mark.tagName).toBe('circle');
              expect(Number(mark.getAttribute('r'))).toBe(style === 'ring' ? radius : legacy);
              if (style === 'legacy') {
                expect(mark.getAttribute('style')).toContain(
                  'stroke: rgba(31, 111, 91, 0.48); stroke-width: 3',
                );
                expect(mark.parentElement?.getAttribute('data-square')).toBe('b10');
                expect(svg.indexOf(`class="${prefix}-hint-capture `)).toBeGreaterThan(
                  svg.indexOf(layer),
                );
                continue;
              }
            } else {
              expect(mark.getAttribute('style')).toContain('var(--board-move-hint,');
              if (style === 'fill') {
                expect(mark.tagName).toBe('rect');
                expect(Number(mark.getAttribute('width'))).toBe(cell);
                expect(Number(mark.getAttribute('height'))).toBe(cell);
                expect(mark.getAttribute('style')).toContain('opacity: 0.36');
              } else {
                const triangles = [...mark.querySelectorAll('polygon')];
                expect(triangles).toHaveLength(4);
                const hit = doc.querySelector(`[data-square="b10"] > rect`)!;
                const half = prefix === 'jieqi' ? 31 : 26;
                const x = Number(hit.getAttribute('x')) + half;
                const y = Number(hit.getAttribute('y')) + half;
                for (const triangle of triangles) {
                  const points = triangle.getAttribute('points')!.split(' ');
                  expect(points).toHaveLength(3);
                  for (const point of points) {
                    const [px, py] = point.split(',').map(Number);
                    expect(Math.abs(px! - x)).toBeLessThanOrEqual(cell / 2);
                    expect(Math.abs(py! - y)).toBeLessThanOrEqual(cell / 2);
                  }
                }
              }
            }
            expect(svg.indexOf(`class="${mark.getAttribute('class')}"`)).toBeLessThan(
              svg.indexOf(layer),
            );
          }
        }
      },
    );
  }
});
