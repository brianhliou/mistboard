// Bake the homepage's JSON-LD images with the existing paper/green card and
// raster logo, framed for each aspect rather than cropped from og-image.png.
// The settled social card is generated separately by generate-default-og.ts.
// Run from the repo root:
// node --import tsx apps/server/src/scripts/generate-home-search-cards.ts

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadLogoMarkHref, renderDefaultOgAspectSvg, svgToPng } from '../og-image.js';

const webPublic = resolve(import.meta.dirname, '../../../web/public');
const logo = await loadLogoMarkHref(webPublic);
for (const aspect of ['1x1', '4x3', '16x9'] as const) {
  const path = resolve(webPublic, `home-card-${aspect}.png`);
  const png = await svgToPng(renderDefaultOgAspectSvg(logo, aspect));
  await writeFile(path, png);
  console.log(`wrote ${path} (${png.byteLength} bytes)`);
}
