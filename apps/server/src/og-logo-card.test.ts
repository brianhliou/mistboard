import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { loadLogoMarkHref, renderDefaultOgAspectSvg, renderDefaultOgSvg } from './og-image.js';

const WEB_PUBLIC = resolve(import.meta.dirname, '../../web/public');

// Brian, 2026-10-11, on the pikafish square card: "this one is still using the
// crap SVG cloud ... every so often this SVG slop comes out." The cards drew
// the mark from logo.svg, a hand-drawn copy (a cloud of three circles), while
// the header and favicon draw logo-mark.png. A brand card embeds that raster,
// byte for byte, and draws no shape of its own for the mark.
test('the site cards embed logo-mark.png, not a vector redraw of the mark', async () => {
  const href = await loadLogoMarkHref(WEB_PUBLIC);
  const raster = await readFile(resolve(WEB_PUBLIC, 'logo-mark.png'));
  assert.equal(href, `data:image/png;base64,${raster.toString('base64')}`);
  const cards = [
    renderDefaultOgSvg(href),
    ...(['16x9', '4x3', '1x1'] as const).map((a) => renderDefaultOgAspectSvg(href, a)),
  ];
  for (const svg of cards) {
    assert.ok(svg.includes(`<image href="${href}"`), 'the raster mark is on the card');
    assert.ok(
      !/<circle\b|<clipPath\b|<svg [^>]*viewBox="0 0 1024 1024"/.test(svg),
      'no redrawn mark',
    );
  }
});

// The vector copies are gone so no new card, page or script can pick one up.
// A vector mark comes back only as one derived from logo-mark.png's source art.
test('no hand-drawn vector copy of the mark ships in public/', async () => {
  for (const name of ['logo.svg', 'favicon.svg']) {
    await assert.rejects(access(resolve(WEB_PUBLIC, name)), `${name} is back`);
  }
});

// Brian, 2026-10-11: "a fuzzy whitish outline ... a bit too grey and not
// enough pop." The raster's edge is clean since 2026-10-14 and carries a
// deliberate light rim, so the card must not erode it; it darkens the greys
// and glows behind the mark.
test('the logo cards keep the mark edge, darken its greys and glow behind it', async () => {
  const href = await loadLogoMarkHref(WEB_PUBLIC);
  for (const svg of [renderDefaultOgSvg(href), renderDefaultOgAspectSvg(href, '1x1')]) {
    assert.doesNotMatch(svg, /feMorphology/);
    assert.match(svg, /<feFuncR type="gamma" exponent="1\.28"\/>/);
    assert.match(svg, /<image href="[^"]+"[^>]* filter="url\(#logo-mark\)"\/>/);
    assert.match(svg, /fill="url\(#logo-glow\)"/);
  }
});

// A raster cut out of one background keeps that background in its edge: the
// mark was cut from white, and its antialiased edge read as a fuzzy pale ring
// on every dark surface (fixed on the card 2026-10-11, in the asset 10-14).
// No semi-transparent edge pixel may be much lighter than the solid pixels
// beside it. The deliberate light rim is solid, so it passes.
test('the mark has no light matte fringe on its edge', async () => {
  const { width, height, rgba } = decodeRgbaPng(
    await readFile(resolve(WEB_PUBLIC, 'logo-mark.png')),
  );
  const lum = (i: number) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  const fringe: string[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      if (a === 0 || a === 255) continue;
      let solid = -1;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = ((y + dy) * width + x + dx) * 4;
        if (rgba[j + 3] === 255) solid = Math.max(solid, lum(j));
      }
      if (solid >= 0 && lum(i) - solid > 24) fringe.push(`${x},${y}`);
    }
  }
  assert.deepEqual(
    fringe.slice(0, 5),
    [],
    `${fringe.length} edge pixels lighter than the frame beside them`,
  );
});

/** Decode an 8-bit RGBA, non-interlaced PNG (the only shape the mark is saved in). */
function decodeRgbaPng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.deepEqual(
        [data[8], data[9], data[12]],
        [8, 6, 0],
        'logo-mark.png must be 8-bit RGBA, non-interlaced',
      );
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      let pred = 0;
      if (filter === 1) pred = left;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      rgba[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return { width, height, rgba };
}
