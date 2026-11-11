// An opaque RGBA image as a palette PNG of at most 256 colours. The feed
// thumbnails (article-thumb.ts) are mostly flat board art, which a palette
// keeps exact or near it at a fraction of resvg's 32-bit PNG; the photo cards
// lose a little colour depth, which reads as nothing at the ~240 px the
// thumbnails are shown at.
//
// Median cut over the image's distinct colours (weighted by pixel count), one
// k-means pass to pull each entry onto the colours it stands for, then each
// distinct colour maps to its nearest entry. No dithering: dither noise is what
// a deflated palette PNG compresses worst. An image with no more distinct
// colours than the palette holds is encoded losslessly.

import { deflateSync } from 'node:zlib';

const MAX_COLORS = 256;
/** Channel weights for the colour distance (eyes see green error most). */
const WR = 3;
const WG = 4;
const WB = 2;
/** Past this many distinct colours the palette is built over 5-bit buckets. */
const BUCKET_ABOVE = 4096;

type Colors = { r: Uint8Array; g: Uint8Array; b: Uint8Array; w: Float64Array; n: number };

/** The distinct colours of `rgba` and, per pixel, the index of its colour.
 *  Null when any pixel is not fully opaque. */
function distinctColors(
  rgba: Uint8Array,
  pixels: number,
): { colors: Colors; ofPixel: Uint32Array } | null {
  const index = new Map<number, number>();
  const ofPixel = new Uint32Array(pixels);
  const counts: number[] = [];
  const keys: number[] = [];
  for (let p = 0; p < pixels; p += 1) {
    const o = p * 4;
    if (rgba[o + 3] !== 255) return null;
    const key = (rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]!;
    let i = index.get(key);
    if (i === undefined) {
      i = keys.length;
      index.set(key, i);
      keys.push(key);
      counts.push(0);
    }
    counts[i]! += 1;
    ofPixel[p] = i;
  }
  const n = keys.length;
  const colors: Colors = {
    r: new Uint8Array(n),
    g: new Uint8Array(n),
    b: new Uint8Array(n),
    w: Float64Array.from(counts),
    n,
  };
  for (let i = 0; i < n; i += 1) {
    colors.r[i] = keys[i]! >> 16;
    colors.g[i] = (keys[i]! >> 8) & 0xff;
    colors.b[i] = keys[i]! & 0xff;
  }
  return { colors, ofPixel };
}

type Box = { start: number; end: number; sse: number; axis: 0 | 1 | 2 };

/** A box's weighted error and the channel it spreads most along. */
function measure(c: Colors, order: Uint32Array, start: number, end: number): Box {
  let w = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let qr = 0;
  let qg = 0;
  let qb = 0;
  for (let k = start; k < end; k += 1) {
    const i = order[k]!;
    const wi = c.w[i]!;
    const r = c.r[i]!;
    const g = c.g[i]!;
    const b = c.b[i]!;
    w += wi;
    sr += wi * r;
    sg += wi * g;
    sb += wi * b;
    qr += wi * r * r;
    qg += wi * g * g;
    qb += wi * b * b;
  }
  const vr = WR * (qr - (sr * sr) / w);
  const vg = WG * (qg - (sg * sg) / w);
  const vb = WB * (qb - (sb * sb) / w);
  const axis = vg >= vr && vg >= vb ? 1 : vr >= vb ? 0 : 2;
  return { start, end, sse: end - start > 1 ? vr + vg + vb : 0, axis };
}

/** Median-cut boxes over `c`, as a palette of weighted means. */
function medianCut(c: Colors, maxColors: number): number[][] {
  const order = new Uint32Array(c.n);
  for (let i = 0; i < c.n; i += 1) order[i] = i;
  const boxes: Box[] = [measure(c, order, 0, c.n)];
  while (boxes.length < maxColors) {
    let worst = 0;
    for (let k = 1; k < boxes.length; k += 1) if (boxes[k]!.sse > boxes[worst]!.sse) worst = k;
    const box = boxes[worst]!;
    if (box.sse <= 0) break;
    const channel = box.axis === 0 ? c.r : box.axis === 1 ? c.g : c.b;
    order.subarray(box.start, box.end).sort((a, b) => channel[a]! - channel[b]!);
    let half = 0;
    for (let k = box.start; k < box.end; k += 1) half += c.w[order[k]!]!;
    half /= 2;
    let split = box.start + 1;
    for (let acc = 0, k = box.start; k < box.end - 1; k += 1) {
      acc += c.w[order[k]!]!;
      split = k + 1;
      if (acc >= half) break;
    }
    boxes.splice(worst, 1, measure(c, order, box.start, split), measure(c, order, split, box.end));
  }
  return boxes.map(({ start, end }) => {
    let w = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = start; k < end; k += 1) {
      const i = order[k]!;
      const wi = c.w[i]!;
      w += wi;
      r += wi * c.r[i]!;
      g += wi * c.g[i]!;
      b += wi * c.b[i]!;
    }
    return [r / w, g / w, b / w];
  });
}

/** Each colour's nearest palette entry. */
function nearest(c: Colors, palette: readonly number[][]): Uint16Array {
  const pr = palette.map((p) => p[0]!);
  const pg = palette.map((p) => p[1]!);
  const pb = palette.map((p) => p[2]!);
  const out = new Uint16Array(c.n);
  for (let i = 0; i < c.n; i += 1) {
    const r = c.r[i]!;
    const g = c.g[i]!;
    const b = c.b[i]!;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let k = 0; k < pr.length; k += 1) {
      const dr = r - pr[k]!;
      const dg = g - pg[k]!;
      const db = b - pb[k]!;
      const d = WR * dr * dr + WG * dg * dg + WB * db * db;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    out[i] = best;
  }
  return out;
}

/** `c` merged into 5-bit-per-channel buckets (weighted means), and each
 *  colour's bucket. */
function bucketColors(c: Colors): { buckets: Colors; bucketOf: Uint32Array } {
  const index = new Map<number, number>();
  const bucketOf = new Uint32Array(c.n);
  const sums: number[][] = [];
  for (let i = 0; i < c.n; i += 1) {
    const key = ((c.r[i]! >> 3) << 10) | ((c.g[i]! >> 3) << 5) | (c.b[i]! >> 3);
    let k = index.get(key);
    if (k === undefined) {
      k = sums.length;
      index.set(key, k);
      sums.push([0, 0, 0, 0]);
    }
    const s = sums[k]!;
    const wi = c.w[i]!;
    s[0]! += wi * c.r[i]!;
    s[1]! += wi * c.g[i]!;
    s[2]! += wi * c.b[i]!;
    s[3]! += wi;
    bucketOf[i] = k;
  }
  const n = sums.length;
  const buckets: Colors = {
    r: Uint8Array.from(sums, (s) => Math.round(s[0]! / s[3]!)),
    g: Uint8Array.from(sums, (s) => Math.round(s[1]! / s[3]!)),
    b: Uint8Array.from(sums, (s) => Math.round(s[2]! / s[3]!)),
    w: Float64Array.from(sums, (s) => s[3]!),
    n,
  };
  return { buckets, bucketOf };
}

/** The palette (RGB bytes) and each colour's entry in it. */
function buildPalette(
  c: Colors,
  maxColors: number,
  bucket = true,
): { palette: Uint8Array; entryOf: Uint16Array } {
  if (c.n <= maxColors) {
    const palette = new Uint8Array(c.n * 3);
    const entryOf = new Uint16Array(c.n);
    for (let i = 0; i < c.n; i += 1) {
      palette.set([c.r[i]!, c.g[i]!, c.b[i]!], i * 3);
      entryOf[i] = i;
    }
    return { palette, entryOf };
  }
  if (bucket && c.n > BUCKET_ABOVE) {
    // A photo's tens of thousands of colours, cut to 5 bits a channel first:
    // the search below is colours x entries, and it runs on the event loop.
    const { buckets, bucketOf } = bucketColors(c);
    const coarse = buildPalette(buckets, maxColors, false);
    return {
      palette: coarse.palette,
      entryOf: Uint16Array.from(bucketOf, (k) => coarse.entryOf[k]!),
    };
  }
  let means = medianCut(c, maxColors);
  // One k-means pass: move each entry to the mean of the colours nearest it.
  const first = nearest(c, means);
  const sums = means.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < c.n; i += 1) {
    const s = sums[first[i]!]!;
    const wi = c.w[i]!;
    s[0]! += wi * c.r[i]!;
    s[1]! += wi * c.g[i]!;
    s[2]! += wi * c.b[i]!;
    s[3]! += wi;
  }
  means = sums.map((s, k) =>
    s[3]! > 0 ? [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!] : means[k]!,
  );
  const rounded = means.map((m) => m.map((v) => Math.min(255, Math.max(0, Math.round(v)))));
  const entryOf = nearest(c, rounded);
  return { palette: Uint8Array.from(rounded.flat()), entryOf };
}

// ── PNG encoding ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `rgba` (width x height, opaque) as a PNG of at most `maxColors` (2-256)
 *  colours; null when a pixel is not fully opaque (the caller keeps its own). */
export function encodePalettePng(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors = MAX_COLORS,
): Buffer | null {
  const found = distinctColors(rgba, width * height);
  if (!found) return null;
  const { palette, entryOf } = buildPalette(
    found.colors,
    Math.min(MAX_COLORS, Math.max(2, Math.floor(maxColors))),
  );
  const entries = palette.length / 3;
  const depth = entries <= 2 ? 1 : entries <= 4 ? 2 : entries <= 16 ? 4 : 8;
  const perByte = 8 / depth;
  const stride = Math.ceil(width / perByte);
  // Filter 0 (none) on every row: the PNG spec's advice for palette images,
  // and smaller than the adaptive filters on these cards.
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < width; x += 1) {
      const entry = entryOf[found.ofPixel[y * width + x]!]!;
      const at = row + Math.floor(x / perByte);
      raw[at] = raw[at]! | (entry << (8 - depth * ((x % perByte) + 1)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = 3; // palette
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', palette),
    chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
