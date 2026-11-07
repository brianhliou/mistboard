// Every analysis-capable board must be able to draw the move-judgment badge, not
// just xiangqi (which had the only implementation until 2026-08-22). These assert
// the shared badge contract per renderer: a filled disc plus the glyph text,
// carrying the tone class the move list uses, offset up-and-right of the square's
// centre so it sits in the corner rather than over the piece.
import type { GridGeometry } from '@mistboard/board-render';
import { describe, expect, it } from 'vitest';
import { fortressXiangqiMarkerSvg } from './fortress-xiangqi-render.js';
import { jungleFlipMarkerSvg } from './jungle-flip-render.js';
import { jungleMarkerSvg } from './jungle-render.js';
import { banqiMarkerSvg } from './live-banqi-render.js';
import { jieqiMarkerSvg } from './live-jieqi-render.js';
import { xiangqiMarkerSvg } from './xiangqi-board.js';

const GEOM: GridGeometry = {
  cell: 60,
  topLeft: (file: number, rank: number) => ({ x: file * 60, y: rank * 60 }),
  center: (file: number, rank: number) => ({ x: file * 60 + 30, y: rank * 60 + 30 }),
};

/** Centre of the disc in the emitted <circle>, for the corner-offset assertions. */
function discCenter(svg: string): { cx: number; cy: number } {
  const cx = svg.match(/<circle[^>]*\scx="([-\d.]+)"/)?.[1];
  const cy = svg.match(/<circle[^>]*\scy="([-\d.]+)"/)?.[1];
  expect(cx, `no disc cx in ${svg}`).toBeDefined();
  expect(cy, `no disc cy in ${svg}`).toBeDefined();
  return { cx: Number(cx), cy: Number(cy) };
}

const CASES: Array<{
  name: string;
  glyph: () => string;
  ring: () => string;
  empty: () => string;
}> = [
  {
    name: 'banqi',
    glyph: () =>
      banqiMarkerSvg({ square: 'c2', kind: 'glyph', text: '??', className: 'xq-marker--blunder' }),
    ring: () => banqiMarkerSvg({ square: 'c2', kind: 'circle' }),
    empty: () => banqiMarkerSvg({ square: 'c2', kind: 'glyph' }),
  },
  {
    name: 'jieqi',
    glyph: () =>
      jieqiMarkerSvg(
        { square: 'e4', kind: 'glyph', text: '?', className: 'xq-marker--mistake' },
        'red',
      ),
    ring: () => jieqiMarkerSvg({ square: 'e4', kind: 'circle' }, 'red'),
    empty: () => jieqiMarkerSvg({ square: 'e4', kind: 'glyph', text: '' }, 'red'),
  },
  {
    name: 'jungle',
    glyph: () =>
      jungleMarkerSvg(
        { square: 'c3', kind: 'glyph', text: '?!', className: 'xq-marker--inaccuracy' },
        GEOM,
      ),
    ring: () => jungleMarkerSvg({ square: 'c3', kind: 'circle' }, GEOM),
    empty: () => jungleMarkerSvg({ square: 'c3', kind: 'glyph' }, GEOM),
  },
  {
    name: 'jungle-flip',
    glyph: () =>
      jungleFlipMarkerSvg({
        square: 'c3',
        kind: 'glyph',
        text: '??',
        className: 'xq-marker--blunder',
      }),
    ring: () => jungleFlipMarkerSvg({ square: 'c3', kind: 'circle' }),
    empty: () => jungleFlipMarkerSvg({ square: 'c3', kind: 'glyph', text: '' }),
  },
  {
    name: 'fortress',
    glyph: () =>
      fortressXiangqiMarkerSvg(
        { square: 'e3', kind: 'glyph', text: '?', className: 'xq-marker--mistake' },
        'red',
      ),
    ring: () => fortressXiangqiMarkerSvg({ square: 'e3', kind: 'circle' }, 'red'),
    empty: () => fortressXiangqiMarkerSvg({ square: 'e3', kind: 'glyph' }, 'red'),
  },
  {
    name: 'xiangqi',
    glyph: () =>
      xiangqiMarkerSvg(
        { square: 'e3', kind: 'glyph', text: '?', className: 'xq-marker--mistake' },
        'red',
      ),
    ring: () => xiangqiMarkerSvg({ square: 'e3', kind: 'circle' }, 'red'),
    empty: () => xiangqiMarkerSvg({ square: 'e3', kind: 'glyph' }, 'red'),
  },
];

describe('board judgment badge', () => {
  for (const { name, glyph, ring, empty } of CASES) {
    it(`${name} draws a toned disc with the glyph text`, () => {
      const svg = glyph();
      expect(svg).toContain('xq-marker--glyph');
      expect(svg).toContain('xq-marker__disc');
      expect(svg).toContain('xq-marker__label');
      // The tone class is what colours the disc; without it the badge renders
      // unfilled and the verdict is invisible.
      expect(svg).toMatch(/xq-marker--(blunder|mistake|inaccuracy)/);
    });

    it(`${name} offsets the badge up and to the right of the square centre`, () => {
      const badge = discCenter(glyph());
      const centre = discCenter(ring());
      expect(badge.cx).toBeGreaterThan(centre.cx);
      expect(badge.cy).toBeLessThan(centre.cy);
    });

    it(`${name} draws nothing for an empty glyph rather than a bare disc`, () => {
      // A coloured dot with no symbol would read as a target hint, which is a
      // different vocabulary on these boards.
      expect(empty()).toBe('');
    });
  }

  // Puzzles mark a found move ✓ and a miss ✗ (lichess): an icon in the disc
  // instead of glyph text, so it reads the same at every board size and font.
  it.each([
    [
      'xiangqi',
      (icon: 'check' | 'cross') =>
        xiangqiMarkerSvg(
          { square: 'e4', kind: 'glyph', icon, className: 'xq-marker--good' },
          'red',
        ),
    ],
    [
      'jungle',
      (icon: 'check' | 'cross') =>
        jungleMarkerSvg({ square: 'c3', kind: 'glyph', icon, className: 'xq-marker--good' }, GEOM),
    ],
  ])('%s draws a check or cross icon in the badge disc', (_name, render) => {
    for (const icon of ['check', 'cross'] as const) {
      const svg = render(icon);
      expect(svg).toContain('xq-marker--glyph');
      expect(svg).toContain('class="xq-marker__disc"');
      expect(svg).toMatch(/<path class="xq-marker__icon" d="[^"]+"/);
      expect(svg).not.toContain('xq-marker__label');
    }
    expect(render('check')).not.toBe(render('cross'));
  });
});
