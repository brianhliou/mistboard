// Regenerates assets/readme-hero.png: the live homepage at 4K (a 1920x1080
// window at 2x), cropped above the studies / forum / chat row so the board,
// the lobby, the puzzle of the day, the deep dives, the blog and the news
// stay in frame and visitors' forum posts stay out. Shoot it while a game is
// live (the homepage board then shows it mid-play, not a final position).
// Re-run after a homepage change and commit the PNG.
// Usage: node scripts/readme-hero.mjs [url]

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://mistboard.com/';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/readme-hero.png');
const width = 1920;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 1080 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
// The crop line: just under the puzzle's "Red to play" / "Black to play"
// caption, the lowest thing in the row; the next row's cards start ~2 px below.
const cut = await page.evaluate(() => {
  const caption = [...document.querySelectorAll('body *')].find(
    (e) => e.children.length === 0 && /^(red|black) to play$/i.test(e.textContent?.trim() ?? ''),
  );
  return caption ? caption.getBoundingClientRect().bottom : null;
});
if (cut === null)
  throw new Error('no puzzle caption on the page; the crop line needs a new anchor');
const height = Math.floor(cut) - 1; // the caption box has line-height to spare
await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
await browser.close();
// pngquant takes the 4K shot from ~1.4 MB to ~0.5 MB with no visible change
// (checked on the deep-dive photos); every regenerated PNG stays in git history.
try {
  execFileSync('pngquant', ['--quality', '85-98', '--speed', '1', '--force', '--ext', '.png', out]);
} catch {
  console.warn(
    'pngquant not found or failed; committing the unquantized PNG (brew install pngquant)',
  );
}
console.log(
  `wrote ${out} (${width}x${height} css px at 2x, ${Math.round(statSync(out).size / 1024)} KB)`,
);
