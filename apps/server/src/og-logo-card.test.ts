import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
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
