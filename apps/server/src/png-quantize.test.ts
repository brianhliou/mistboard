import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAsync } from '@resvg/resvg-js';
import { pngSize } from './og-raster.js';
import { encodePalettePng } from './png-quantize.js';

/** Decode `png` back to RGBA through resvg, drawn 1:1. */
async function decode(png: Buffer): Promise<Buffer> {
  const { width, height } = pngSize(png);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image href="data:image/png;base64,${png.toString('base64')}" width="${width}" height="${height}" image-rendering="optimizeSpeed"/></svg>`;
  return (await renderAsync(svg, { font: { loadSystemFonts: false } })).pixels;
}

function image(width: number, height: number, color: (x: number, y: number) => number[]): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgba.set([...color(x, y), 255], (y * width + x) * 4);
  }
  return rgba;
}

test('an image of 256 colours or fewer round-trips exactly', async () => {
  // 200 colours, so an 8-bit palette; widths that do not fill a byte at 4 bits
  // are covered by the 3-colour case below.
  const rgba = image(37, 11, (x, y) => {
    const i = (x + y * 37) % 200;
    return [i, (i * 7) % 256, 255 - i];
  });
  const png = encodePalettePng(rgba, 37, 11)!;
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 3, 'colour type: palette');
  assert.deepEqual(await decode(png), rgba);

  const few = image(
    13,
    5,
    (x) =>
      [
        [200, 0, 0],
        [0, 200, 0],
        [0, 0, 200],
      ][x % 3]!,
  );
  const small = encodePalettePng(few, 13, 5)!;
  assert.equal(small[24], 2, 'three colours pack at 2 bits');
  assert.deepEqual(await decode(small), few);
});

test('a many-coloured image is cut to the palette with small error', async () => {
  // A smooth gradient: 4096+ colours, the bucketed path.
  const rgba = image(256, 64, (x, y) => [x, (y * 4) % 256, (x + y * 3) % 256]);
  for (const colors of [256, 128]) {
    const png = encodePalettePng(rgba, 256, 64, colors)!;
    const plte = png.indexOf('PLTE');
    assert.ok(png.readUInt32BE(plte - 4) / 3 <= colors, `palette over ${colors}`);
    const back = await decode(png);
    let worst = 0;
    for (let i = 0; i < rgba.length; i += 1) worst = Math.max(worst, Math.abs(back[i]! - rgba[i]!));
    assert.ok(worst <= 48, `worst channel error ${worst} at ${colors} colours`);
    assert.ok(png.length < rgba.length / 4, `${png.length} bytes`);
  }
});

test('a pixel that is not fully opaque leaves the encode to the caller', () => {
  const rgba = image(4, 4, () => [10, 20, 30]);
  rgba[3] = 128;
  assert.equal(encodePalettePng(rgba, 4, 4), null);
});
