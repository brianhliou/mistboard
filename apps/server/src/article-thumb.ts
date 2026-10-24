// /thumb/article/<slug>.png: a blog post's card art as a 16:10 PNG, for the
// feeds' <media:content> (brianhliou.com's home page tiles read it).
//
// The web prerender writes each live post's card as one self-contained SVG to
// dist/thumb/article/<slug>.svg (apps/web/src/articles/feed-thumbnail.ts: the
// site's card CSS and variables already baked in). This route inlines the
// public files that SVG points at (piece art, photos) and rasterises it with
// the OG cards' resvg. The SVG is vector board art, so it renders at the output
// size; only the embedded rasters are scaled, and each is drawn from the mip
// level nearest its drawn size, never shrunk 2x or more from a finished raster.
//
// No live game state is drawn: the art is static article content, so the
// hidden-information rule has nothing to redact here.

import { promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { loadCardArt } from './og-card-board.js';
import {
  createPngCache,
  halvePng,
  OG_FONT_OPTIONS,
  pngSize,
  svgToPng,
  writePng,
} from './og-raster.js';

/** The frame the web module draws (FEED_THUMB_WIDTH x FEED_THUMB_HEIGHT). */
export const ARTICLE_THUMB_WIDTH = 480;
export const ARTICLE_THUMB_HEIGHT = 300;
/** The dark card's --site-panel-soft, hsl(40, 5%, 19%), behind the art. */
const PANEL_SOFT = '#33312e';
/** 2x the frame, 960x600, unless that would upscale a photo (see thumbZoom). */
const MAX_ZOOM = 2;
const MIN_ART_PX = 64;
/** How deep the canvas may grow to cover art below the frame (coverBelowFrame). */
const MAX_CANVAS_HEIGHT = ARTICLE_THUMB_HEIGHT * 8;
/** Room under the measured art for stroke widths, which the bbox approximates. */
const BELOW_MARGIN = 16;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

const SLUG = /^[a-z0-9-]+$/;
const MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

let thumbCache = createPngCache(96);

export function isArticleThumbSlug(slug: string): boolean {
  return SLUG.test(slug);
}

// ── Embedded rasters ─────────────────────────────────────────────────────────

type Raster = {
  width: number;
  height: number;
  /** The file and its halvings, largest first: longer side and data URI. */
  levels: readonly { px: number; uri: string }[];
};

/** A JPEG's pixel size, from its first start-of-frame marker. */
export function jpegSize(jpeg: Buffer): { width: number; height: number } | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1]!;
    const length = jpeg.readUInt16BE(i + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return { height: jpeg.readUInt16BE(i + 5), width: jpeg.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return null;
}

const rasterByFile = new Map<string, Promise<Raster | null>>();

async function readRaster(file: string, mime: string): Promise<Raster | null> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) return null;
  let data: Buffer = await fs.readFile(file);
  if (mime === 'image/png') {
    const { width, height } = pngSize(data);
    const levels: { px: number; uri: string }[] = [];
    for (;;) {
      const size = pngSize(data);
      const px = Math.max(size.width, size.height);
      levels.push({ px, uri: `data:image/png;base64,${data.toString('base64')}` });
      if (px / 2 < MIN_ART_PX) break;
      data = await halvePng(data);
    }
    return { width, height, levels };
  }
  // A photo fills the frame and is never drawn above its own size (thumbZoom),
  // so the file itself is the only level it needs.
  const size = mime === 'image/jpeg' ? jpegSize(data) : null;
  if (!size) return null;
  const uri = `data:${mime};base64,${data.toString('base64')}`;
  return { ...size, levels: [{ px: Math.max(size.width, size.height), uri }] };
}

/** The raster behind a root-relative href, or null (outside the build, absent,
 *  not an image). Card piece art reuses the OG cards' loaded halvings. */
async function rasterFor(staticDir: string, href: string): Promise<Raster | null> {
  let path: string;
  try {
    path = decodeURIComponent(href.split(/[?#]/)[0]!);
  } catch {
    return null;
  }
  const root = resolve(staticDir);
  const file = resolve(root, `.${path}`);
  if (!file.startsWith(root + sep)) return null;
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) return null;
  const relPath = file
    .slice(root.length + 1)
    .split(sep)
    .join('/');
  const card = (await loadCardArt(staticDir)).get(relPath);
  if (card?.length) {
    const head = Buffer.from(card[0]!.uri.slice('data:image/png;base64,'.length, 64), 'base64');
    return { ...pngSize(head), levels: card };
  }
  let pending = rasterByFile.get(file);
  if (!pending) {
    pending = readRaster(file, mime).catch(() => null);
    rasterByFile.set(file, pending);
  }
  return pending;
}

// ── Where each image lands ───────────────────────────────────────────────────

const num = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
};
const attr = (attrs: string, name: string): string | undefined =>
  new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

/** The linear scale a transform attribute applies (rotate and translate: 1). */
function transformScale(attrs: string): number {
  const transform = attr(attrs, 'transform');
  if (!transform) return 1;
  let scale = 1;
  for (const [, fn, args] of transform.matchAll(/(scale|matrix)\(([^)]*)\)/g)) {
    const v = args!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (fn === 'scale') scale *= Math.max(Math.abs(v[0] ?? 1), Math.abs(v[1] ?? v[0] ?? 1));
    else scale *= Math.sqrt(Math.abs((v[0] ?? 1) * (v[3] ?? 1) - (v[1] ?? 0) * (v[2] ?? 0)));
  }
  return scale;
}

/** The scale a nested <svg> viewport applies to its content. */
function viewportScale(attrs: string): number {
  const viewBox = attr(attrs, 'viewBox')
    ?.split(/[\s,]+/)
    .map(Number);
  const width = num(attr(attrs, 'width'));
  const height = num(attr(attrs, 'height'));
  if (viewBox?.length !== 4 || !viewBox[2] || !viewBox[3]) return 1;
  const sx = width !== null ? width / viewBox[2] : null;
  const sy = height !== null ? height / viewBox[3] : null;
  if (sx === null && sy === null) return 1;
  const slice = /\bslice\b/.test(attr(attrs, 'preserveAspectRatio') ?? '');
  if (sx === null || sy === null) return (sx ?? sy)!;
  return slice ? Math.max(sx, sy) : Math.min(sx, sy);
}

type Placed = {
  start: number;
  end: number;
  attrs: string;
  href: string;
  /** SVG units per source pixel, before zoom, for a raster `w` x `h`. */
  unitsPerPixel: (w: number, h: number) => number;
};

/** Every <image> with a root-relative href, and the scale it is drawn at. */
function placedImages(svg: string): Placed[] {
  const out: Placed[] = [];
  const stack: number[] = [1];
  for (const match of svg.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    const [whole, closing, name, attrs, selfClosing] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const own = transformScale(attrs!) * (name === 'svg' ? viewportScale(attrs!) : 1);
    const scale = stack[stack.length - 1]! * own;
    if (name === 'image') {
      const href = attr(attrs!, 'href') ?? attr(attrs!, 'xlink:href');
      if (href?.startsWith('/') && !href.startsWith('//')) {
        const boxW = num(attr(attrs!, 'width'));
        const boxH = num(attr(attrs!, 'height'));
        const fit = attr(attrs!, 'preserveAspectRatio') ?? 'xMidYMid meet';
        out.push({
          start: match.index,
          end: match.index + whole.length,
          attrs: attrs!,
          href,
          unitsPerPixel: (w, h) => {
            const sx = boxW !== null ? boxW / w : null;
            const sy = boxH !== null ? boxH / h : null;
            const fitted =
              sx === null || sy === null
                ? (sx ?? sy ?? 1)
                : fit.trim() === 'none' || /\bslice\b/.test(fit)
                  ? Math.max(sx, sy)
                  : Math.min(sx, sy);
            return fitted * scale;
          },
        });
      }
    }
    if (!selfClosing) stack.push(scale);
  }
  return out;
}

/**
 * The raster zoom: 2x the frame (960x600), lowered so no embedded raster is
 * drawn above its own pixels (a 600x382 face photo renders at 600x375), never
 * below 1x (480x300). Vector art has no such limit, and piece rasters (1024 px,
 * drawn at ~40) sit far below theirs.
 */
function thumbZoom(placed: readonly { unitsPerPixel: number }[]): number {
  let zoom = MAX_ZOOM;
  for (const image of placed) zoom = Math.min(zoom, 1 / image.unitsPerPixel);
  return Math.max(1, zoom);
}

/** `svg` with each root-relative image inlined as a data URI at the mip level
 *  its drawn size needs (an unreadable one is dropped), and the zoom to
 *  rasterise it at. */
export async function inlineThumbImages(
  svg: string,
  staticDir: string,
): Promise<{ svg: string; zoom: number }> {
  const placed = placedImages(svg);
  const resolved = await Promise.all(
    placed.map(async (image) => {
      const raster = await rasterFor(staticDir, image.href);
      return raster
        ? { image, raster, unitsPerPixel: image.unitsPerPixel(raster.width, raster.height) }
        : { image, raster: null, unitsPerPixel: 0 };
    }),
  );
  const zoom = thumbZoom(resolved.filter((r) => r.raster));
  let out = '';
  let cursor = 0;
  for (const { image, raster, unitsPerPixel } of resolved) {
    out += svg.slice(cursor, image.start);
    cursor = image.end;
    if (!raster) continue;
    const need = Math.max(raster.width, raster.height) * unitsPerPixel * zoom;
    let pick = raster.levels[0]!;
    for (const level of raster.levels) if (level.px >= need) pick = level;
    const attrs = image.attrs.replace(/\s(?:xlink:)?href="[^"]*"/g, '');
    out += `<image href="${pick.uri}"${attrs}/>`;
  }
  return { svg: out + svg.slice(cursor), zoom };
}

// ── Below the frame ──────────────────────────────────────────────────────────

/**
 * `svg` on a canvas tall enough to hold all of its art, or null when that would
 * pass MAX_CANVAS_HEIGHT (or the SVG does not parse).
 *
 * resvg 2.6 aborts the whole process (a Rust panic in geom.rs:27 that no JS
 * handler catches, renderAsync included) when a layer (opacity, clip-path,
 * mask, filter, a nested <svg>) lies wholly below the canvas. Art above, left
 * or right of it is fine. Half-board cards crop their diagram with the viewBox,
 * so faded arrows and piece viewports routinely sit below the 300-unit frame:
 * Atomic Xiangqi's card did, and would have taken every live game down with
 * it. Growing the canvas down to the art's measured bottom (getBBox parses but
 * does not render) leaves no layer below it; the render is then cropped back
 * to the frame, so the delivered pixels are the same.
 */
export function coverBelowFrame(svg: string): string | null {
  const root = /^<svg\b[^>]*>/.exec(svg)?.[0];
  const frame = `height="${ARTICLE_THUMB_HEIGHT}" viewBox="0 0 ${ARTICLE_THUMB_WIDTH} ${ARTICLE_THUMB_HEIGHT}"`;
  if (!root?.includes(frame)) return null;
  let artBottom: number;
  try {
    const box = new Resvg(svg, { font: OG_FONT_OPTIONS, logLevel: 'off' }).getBBox();
    artBottom = box ? Math.ceil(box.y + box.height) : 0;
  } catch {
    return null;
  }
  if (!Number.isFinite(artBottom)) return null;
  if (artBottom <= ARTICLE_THUMB_HEIGHT) return svg;
  const bottom = artBottom + BELOW_MARGIN;
  if (bottom > MAX_CANVAS_HEIGHT) return null;
  const tall = `height="${bottom}" viewBox="0 0 ${ARTICLE_THUMB_WIDTH} ${bottom}"`;
  return root.replace(frame, tall) + svg.slice(root.length);
}

/** A thumbnail SVG from the build as its PNG: images inlined, the canvas grown
 *  to cover its art, cropped back to 16:10. Null when it cannot be drawn safely. */
export async function renderArticleThumbnail(
  source: string,
  staticDir: string,
): Promise<Buffer | null> {
  const { svg, zoom } = await inlineThumbImages(source, staticDir);
  const covered = coverBelowFrame(svg);
  if (!covered) return null;
  return svgToPng(covered, PANEL_SOFT, zoom, {
    right: Math.round(ARTICLE_THUMB_WIDTH * zoom),
    bottom: Math.round(ARTICLE_THUMB_HEIGHT * zoom),
  });
}

// ── The route ────────────────────────────────────────────────────────────────

/** Render a post's feed thumbnail, or 302 to its OG card when the build has no
 *  thumbnail for the slug (no card art, a rules page, an unknown slug) or its
 *  art reaches too far below the frame to draw safely. */
export async function serveArticleThumbnail({
  slug,
  response,
  staticDir,
}: {
  slug: string;
  response: ServerResponse;
  staticDir: string;
}): Promise<void> {
  if (!isArticleThumbSlug(slug)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('no such article');
    return;
  }
  const key = `${staticDir}\0${slug}`;
  const hit = thumbCache.get(key);
  if (hit) {
    writePng(response, hit, 'HIT');
    return;
  }
  let png: Buffer | null = null;
  try {
    const source = await fs.readFile(resolve(staticDir, 'thumb', 'article', `${slug}.svg`), 'utf8');
    png = await renderArticleThumbnail(source, staticDir);
  } catch {
    png = null;
  }
  if (!png) {
    response.writeHead(302, { location: `/og/article/${slug}.png` });
    response.end();
    return;
  }
  thumbCache.set(key, png);
  writePng(response, png, 'MISS');
}

/** Forget rendered thumbnails and loaded rasters (tests). */
export function resetArticleThumbs(): void {
  rasterByFile.clear();
  thumbCache = createPngCache(96);
}
