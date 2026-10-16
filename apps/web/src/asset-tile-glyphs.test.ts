// The Xiangqi Mahjong tile layers of the five third-party piece sets are
// derived files (scripts/asset-tile-glyphs.mjs): each set's character alone,
// and its disc's surface for the tile face. Re-derive every one and compare,
// so a hand edit or a changed source fails here; then check each layer holds
// what its name says.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ASSET_TILE_GLYPH_COLORS,
  ASSET_TILE_GLYPH_ROLES,
  ASSET_TILE_GLYPH_SETS,
  piecesDir,
  tileLayerFiles,
} from '../scripts/asset-tile-glyphs.mjs';
import { XMJ32_RED_TILES } from './xiangqi-mahjong-32-rules-diagrams.js';
import { xmjTileRowSvg } from './xiangqi-mahjong-tile-svg.js';
import { renderXiangqiPieceMark, xiangqiTileFaceHref } from './xiangqi-piece-sets.js';

const dir = piecesDir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (set: string, name: string) => readFileSync(join(dir, set, name), 'utf8');
const parse = (text: string) =>
  new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
const serializer = new XMLSerializer();

// The set's character colour per side (ASSET_SETS ink in xiangqi-piece-sets).
const INK: Record<string, Record<string, string>> = {
  lacquer: { red: '#fff', black: '#fff' },
  wood: { red: '#ae1d04', black: '#1e1e1a' },
  book: { red: '#f00', black: '#000' },
  brush: { red: '#f00', black: '#050' },
  clerical: { red: '#ff0101', black: '#050' },
};

const norm = (color: string) => {
  const c = color.toLowerCase();
  return /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/.test(c) ? `#${c[1]}${c[3]}${c[5]}` : c;
};

function rgb(hex: string): number[] {
  const h = norm(hex).slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
}

function distance(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function fills(svg: Element): string[] {
  return [...svg.querySelectorAll('path, g')]
    .flatMap((el) => {
      const style = el.getAttribute('style') ?? '';
      const fromStyle = /fill:\s*([^;]+)/.exec(style)?.[1];
      return [el.getAttribute('fill'), fromStyle];
    })
    .filter((v): v is string => !!v && v !== 'none')
    .map(norm);
}

describe('asset tile layers', () => {
  it('every committed layer is what the script derives', () => {
    const parser = new DOMParser();
    const stale = tileLayerFiles()
      .filter(([set, name, from, build]) => {
        const derived = build(set, from, read(set, from), parser, serializer);
        return derived !== read(set, `tile/${name}`);
      })
      .map(([set, name]) => `${set}/tile/${name}`);
    expect(stale).toEqual([]);
    expect(tileLayerFiles()).toHaveLength(5 * 2 * 8);
  });

  for (const set of ASSET_TILE_GLYPH_SETS) {
    describe(set, () => {
      for (const color of ASSET_TILE_GLYPH_COLORS) {
        it(`${color}: characters keep no disc and are drawn in the set's ink`, () => {
          for (const role of ASSET_TILE_GLYPH_ROLES) {
            const svg = parse(read(set, `tile/${color}-${role}.svg`));
            expect(svg.querySelectorAll('circle, ellipse, rect')).toHaveLength(0);
            expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
            // The set's ink (the source files vary it a shade), and for wood a
            // white cut under it; nothing else, so no grain or ground survives.
            const ink = fills(svg).filter((fill) => !fill.startsWith('url('));
            const near = (fill: string, target: string) => distance(fill, target) < 60;
            expect(ink.some((fill) => near(fill, INK[set][color]))).toBe(true);
            expect(
              ink.filter((fill) => !near(fill, INK[set][color]) && !near(fill, '#fff')),
            ).toEqual([]);
          }
        });

        it(`${color}: the face is the disc with no character, cropped inside the rim`, () => {
          const face = parse(read(set, `tile/${color}-face.svg`));
          const general = parse(read(set, `tile/${color}-general.svg`));
          const glyphPaths = new Set(
            [...general.querySelectorAll('path')].map((p) => p.getAttribute('d')),
          );
          for (const path of face.querySelectorAll('path')) {
            expect(glyphPaths.has(path.getAttribute('d'))).toBe(false);
          }
          const [, , w, h] = (face.getAttribute('viewBox') ?? '').split(' ').map(Number);
          const [, , sw] = (parse(read(set, `${color}-general.svg`)).getAttribute('viewBox') ?? '')
            .split(/[\s,]+/)
            .map(Number);
          expect(w).toBe(h);
          // Inside the disc (radius 45 of the 100-unit box): at most 45 * sqrt(2).
          expect((w / sw) * 100).toBeLessThanOrEqual(63.7);
        });
      }
    });
  }

  it('the tile mark draws the set character layer, and only asset sets have a face', () => {
    for (const set of ASSET_TILE_GLYPH_SETS) {
      const mark = renderXiangqiPieceMark({ color: 'black', role: 'horse' }, set as 'wood');
      expect(mark).toContain(`/piece-sets/xiangqi/${set}/tile/black-horse.svg?v=`);
      expect(xiangqiTileFaceHref(set as 'wood', 'red')).toMatch(
        new RegExp(`^/piece-sets/xiangqi/${set}/tile/red-face\\.svg\\?v=\\d+$`),
      );
    }
    // The rules page's tiles follow: the set's surface, clipped to the tile.
    const row = xmjTileRowSvg([{ tiles: XMJ32_RED_TILES.slice(0, 2) }], 'row', 'wood');
    expect(row).toContain('/piece-sets/xiangqi/wood/tile/red-face.svg');
    expect(row).toContain('clip-path="url(#xmj-face-');
    // Each face is drawn square and clipped. Stretched to the tile with
    // `slice`, Chrome fit the square to the width and showed the disc rim
    // above and below it (Brian, 10-15: "the bottom of some of the rounded discs").
    for (const image of row.match(/<image href="[^"]*face\.svg[^>]*>/g) ?? []) {
      expect(image).not.toContain('preserveAspectRatio');
      const w = image.match(/ width="([\d.]+)"/)?.[1];
      expect(w).toBeDefined();
      expect(image.match(/ height="([\d.]+)"/)?.[1]).toBe(w);
    }
    expect(
      xmjTileRowSvg([{ tiles: XMJ32_RED_TILES.slice(0, 2) }], 'row', 'traditional'),
    ).not.toContain('face.svg');
    expect(xiangqiTileFaceHref('traditional', 'red')).toBeNull();
    expect(xiangqiTileFaceHref('international', 'black')).toBeNull();
  });
});
