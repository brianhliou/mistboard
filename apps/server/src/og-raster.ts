// Rasterising and serving OG cards: the resvg call with the bundled fonts, the
// bounded PNG cache, and the two response shapes (a PNG, or a redirect to the
// site card). Split from og-image.ts so og-position.ts and og-card-board.ts can
// use them without importing og-image, which draws its own cards through them.

import type { ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAsync } from '@resvg/resvg-js';

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
//
// Noto Sans SC Bold carries every other Chinese character a card prints: a
// player page's title ("Cao Yanlei 曹岩磊"), a study named in Chinese. With
// Noto Sans alone those rendered as empty boxes, on every player card from
// 2026-09-21 until 2026-09-25. One weight: titles are bold, and resvg falls
// back to the nearest weight for the rest.
const FONT_FILES = ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf', 'NotoSansSC-Bold.otf'].map(
  (file) => resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts', file),
);

/** The zoom every OG card is rasterised at (svgToPng's default). */
export const OG_CARD_ZOOM = 2;

// Render at 2x the SVG's nominal dimensions so the resulting PNG stays crisp
// on retina displays and survives scraper recompression.
/**
 * Rasterize an SVG. `zoom` multiplies the SVG's own dimensions: 2 is right for
 * OG cards (rendered at half their delivered size), 1 for a figure whose SVG is
 * already authored at twice its display width. Oversampling past ~2x the display
 * size is not free quality — it thins hairlines below a pixel on the way down.
 *
 * The raster runs on a libuv worker thread (`renderAsync`), never on the event
 * loop. A full-board card is ~750 KB of SVG with 32 inlined piece images and
 * takes ~1 s of CPU in the prod container; the synchronous `Resvg#render` this
 * used until 2026-09-16 stalled every WebSocket frame and every request for
 * that long, and a crawler walking the 470 chapter cards of the classical
 * manuals (each its own cache key) paged loop-lag warnings for a minute at a
 * time. Only the PNG encode (`asPng`, ~30 ms) still runs on the loop.
 */
export async function svgToPng(
  svg: string,
  background = '#0f1115',
  zoom = OG_CARD_ZOOM,
): Promise<Buffer> {
  const image = await renderAsync(svg, {
    background,
    fitTo: { mode: 'zoom', value: zoom },
    font: {
      loadSystemFonts: false,
      fontFiles: FONT_FILES,
      defaultFontFamily: 'Noto Sans',
    },
  });
  return image.asPng();
}

/** A PNG's pixel size, read from its IHDR chunk (bytes 16-23). */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Halve a PNG with resvg. resvg samples an embedded raster with a fixed
 * bicubic kernel and no mipmaps, so drawing a 1024 px piece at ~120 px skips
 * most source pixels and the strokes come out stair-stepped (a jieqi game card,
 * 2026-10-08). One 2x step at a time stays within what the kernel can average;
 * chained, the halvings are the mip levels a raster must be drawn from.
 */
export async function halvePng(png: Buffer): Promise<Buffer> {
  const { width, height } = pngSize(png);
  const w = Math.max(1, Math.round(width / 2));
  const h = Math.max(1, Math.round(height / 2));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><image href="data:image/png;base64,${png.toString('base64')}" width="${w}" height="${h}" preserveAspectRatio="none"/></svg>`;
  const image = await renderAsync(svg, { font: { loadSystemFonts: false } });
  return image.asPng();
}
