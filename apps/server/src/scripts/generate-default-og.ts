// Bakes the site card, apps/web/public/og-image.png: what every page without a
// card of its own shows when its link is shared (the homepage, articles with
// no board, Mahjong). Logo, wordmark, and the positioning line cut for a card;
// no board, on purpose (2026-09-12): the brand card should not compete with
// the game cards, which are the ones that carry a position.
//
// Re-run `npm run og:default --workspace @mistboard/server` after changing the
// copy or the renderer, then bump the ?v= on the og:image and twitter:image
// metas in apps/web/index.html so scrapers refetch.

import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDefaultOgSvg, svgToPng } from '../og-image.js';

const here = dirname(fileURLToPath(import.meta.url));
const webPublic = resolve(here, '..', '..', '..', 'web', 'public');
const outPath = resolve(webPublic, 'og-image.png');

const logoSvg = await fs.readFile(resolve(webPublic, 'logo.svg'), 'utf-8');
const svg = renderDefaultOgSvg(logoSvg);
const png = svgToPng(svg);
await fs.writeFile(outPath, png);
console.log(`wrote ${outPath} (${png.byteLength} bytes)`);
