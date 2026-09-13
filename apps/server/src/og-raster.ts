// Rasterising and serving OG cards: the resvg call with the bundled fonts, the
// bounded PNG cache, and the two response shapes (a PNG, or a redirect to the
// site card). Split from og-image.ts so og-position.ts and og-card-board.ts can
// use them without importing og-image, which draws its own cards through them.

import type { ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export type PngCache = {
  get(key: string): Buffer | undefined;
  set(key: string, png: Buffer): void;
  readonly size: number;
};

/** A bounded LRU of rendered PNGs (the cache described above). Shared by the
 *  card families so each gets the same eviction behaviour under its own cap. */
export function createPngCache(maxEntries: number): PngCache {
  const cache = new Map<string, Buffer>();
  return {
    get(key) {
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key);
        cache.set(key, hit); // move to most-recently-used end
      }
      return hit;
    },
    set(key, png) {
      cache.set(key, png);
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    },
    get size() {
      return cache.size;
    },
  };
}

export function writePng(response: ServerResponse, png: Buffer, cacheStatus: 'HIT' | 'MISS'): void {
  response.writeHead(200, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-og-cache': cacheStatus,
  });
  response.end(png);
}

export function redirectToDefault(response: ServerResponse): void {
  response.writeHead(302, { location: '/og-image.png' });
  response.end();
}

// resvg renders <text> with whatever fonts it can load, and the prod
// container has NONE — text silently vanishes (shipped textless cards until
// 2026-06-10). Bundle Noto Sans with the server and load ONLY it, so a local
// render is byte-identical to prod and a missing font can never ship quietly
// again. OFL attribution: apps/web/public/fonts/CREDITS.md. CJK piece
// characters are baked paths and never go through font resolution.
const FONT_FILES = ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'].map((file) =>
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts', file),
);

// Render at 2x the SVG's nominal dimensions so the resulting PNG stays crisp
// on retina displays and survives scraper recompression.
/**
 * Rasterize an SVG. `zoom` multiplies the SVG's own dimensions: 2 is right for
 * OG cards (rendered at half their delivered size), 1 for a figure whose SVG is
 * already authored at twice its display width. Oversampling past ~2x the display
 * size is not free quality — it thins hairlines below a pixel on the way down.
 */
export function svgToPng(svg: string, background = '#0f1115', zoom = 2): Buffer {
  return new Resvg(svg, {
    background,
    fitTo: { mode: 'zoom', value: zoom },
    font: {
      loadSystemFonts: false,
      fontFiles: FONT_FILES,
      defaultFontFamily: 'Noto Sans',
    },
  })
    .render()
    .asPng();
}
