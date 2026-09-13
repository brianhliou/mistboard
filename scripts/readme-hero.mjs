// Regenerates assets/readme-hero.png: the live homepage's top band (nav, the
// featured game, the lobby, the tagline and Play button), cropped at the
// lobby's bottom edge so the forum and chat stay out of frame. Re-run after a
// homepage change and commit the PNG. Usage: node scripts/readme-hero.mjs [url]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://mistboard.com/';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/readme-hero.png');
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const lobbyBottom = await page.evaluate(() => {
  const els = [...document.querySelectorAll('[class*="lobby"]')];
  return Math.max(0, ...els.map((e) => e.getBoundingClientRect().bottom));
});
const height = Math.min(900, Math.ceil(lobbyBottom) + 24);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1440, height } });
await browser.close();
console.log(`wrote ${out} (1440x${height} css px at 2x)`);
