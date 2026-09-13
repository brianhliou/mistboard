// Render the Duck Xiangqi figures for the brianhliou.com write-up, using
// MISTBOARD'S OWN diagram functions rather than a second board renderer.
//
// Same reasoning as gen-benedict-diagrams.mts, which this follows: the jungle
// board art was once hand-ported into two blog files with nothing recording
// that mistboard was the reference, and it drifted. So this imports the
// DUCK_XIANGQI_* thunks the rules page itself renders, and lifts the
// .xq-diagram-* colour rules out of articles.css at build time so each SVG
// stands alone on a site that does not load our CSS.
//
//   npx tsx scripts/gen-duck-diagrams.mts
//
// What it asserts before writing anything: the number the post cites. The post
// claims the duck has exactly 8 placements that keep two lone generals apart,
// out of 88 empty points. If the kernel ever disagrees, this throws rather
// than shipping a figure that contradicts the prose beside it.
//
// Output:
//   _includes/duck-xq-block.html    horse leg + elephant eye
//   _includes/duck-xq-screen.html   one duck, two cannons
//   _includes/duck-xq-facing.html   the generals facing, and the 8 points
//   assets/posts/duck-xiangqi/pieces/*.png   art shared by every frame
//   assets/posts/duck-xiangqi/thumbnail.png  the duck beside the red general
//   assets/posts/duck-xiangqi/social-card.png

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

// The diagram module's dependency graph reaches modules that `import './x.css'`,
// which Vite resolves and Node does not. Nothing here renders from a stylesheet
// (the colours are lifted out of articles.css as text, below).
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) {
      return { format: 'module', shortCircuit: true, source: 'export default {};' };
    }
    return next(url, context);
  },
});

// The diagram modules read display preferences off localStorage at import time,
// because in the app they run in a browser. Minimal shim, set before the import.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
(globalThis as Record<string, unknown>).document = {
  documentElement: {
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {} },
  },
};
(globalThis as Record<string, unknown>).localStorage = (
  globalThis as { window: { localStorage: unknown } }
).window.localStorage;

const { DUCK_XIANGQI_FACING_PIN, DUCK_XIANGQI_HORSE_PAIR, DUCK_XIANGQI_SHARED_SCREEN } =
  await import('../apps/web/src/duck-xiangqi-rules-diagrams.js');
const { XQ_BOARD_W, XQ_VIEWBOX_PAD } = await import('../apps/web/src/articles/diagrams.js');
const { duckPieceMarks, renderXiangqiPieceGlyphed } = await import(
  '../apps/web/src/xiangqi-piece-sets.js'
);
const { allDuckXiangqiSquares, duckXiangqiGeneralsFace } = await import('@mistboard/game');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLOG = '/Users/brianliou/projects/brianhliou.github.io';
const OUT = path.join(BLOG, 'assets/posts/duck-xiangqi');
const INCLUDES = path.join(BLOG, '_includes');
const PUBLIC = path.join(HERE, '../apps/web/public');
const CSS = path.join(HERE, '../apps/web/src/articles.css');
const ART = '/assets/posts/duck-xiangqi/pieces';

// ── The claim the prose makes, checked against the kernel ──────────────────

const board = {
  e1: { role: 'general', color: 'red' },
  e10: { role: 'general', color: 'black' },
} as Parameters<typeof duckXiangqiGeneralsFace>[0];
const emptyPoints = allDuckXiangqiSquares().filter((sq) => board[sq] === undefined);
const blocking = emptyPoints.filter((sq) => !duckXiangqiGeneralsFace(board, sq));
if (emptyPoints.length !== 88 || blocking.length !== 8) {
  throw new Error(
    `the post says 8 of 88; the kernel says ${blocking.length} of ${emptyPoints.length}. ` +
      'Fix the prose or the claim, do not ship the figure.',
  );
}

// ── SVG plumbing ───────────────────────────────────────────────────────────

function diagramStyles(): string {
  const css = readFileSync(CSS, 'utf8');
  const rules: string[] = [];
  for (const m of css.matchAll(/\.xq-article-svg (\.xq-diagram-[a-z-]+)\s*\{([^}]*)\}/g)) {
    rules.push(`${m[1]}{${m[2].trim().replace(/\s+/g, ' ')}}`);
  }
  if (rules.length === 0) throw new Error('no .xq-diagram-* rules found in articles.css');
  return `<style>${rules.join('')}</style>`;
}
const STYLES = diagramStyles();

const ART_FILES = new Set<string>();
function localArt(svg: string): string {
  return svg.replace(/href="\/piece-sets\/([^"?]+)\.png[^"]*"/g, (_, rel: string) => {
    ART_FILES.add(`${rel}.png`);
    return `href="${ART}/${rel.replace(/\//g, '-')}.png"`;
  });
}

/** Re-cut the canvas around ONE board.
 *
 *  The diagram thunks render onto a PAIR-width canvas even when they draw a
 *  single board, because on the rules page a single board is centred in the
 *  two-board column. Off that page that is 160 units of dead margin on the
 *  left and a board pushed out of frame.
 *
 *  Derived from the layout constants, NOT measured off the string: an earlier
 *  version scanned coordinate attributes, missed the pieces (translated groups)
 *  and the labels (text), and produced a viewBox that clipped the right edge
 *  while keeping the empty left. getBBox in a browser is the only way to
 *  measure this reliably, and this script has no browser.
 */
function cropToBoard(svg: string): string {
  const left = XQ_VIEWBOX_PAD + (XQ_BOARD_W + 28) / 2 - XQ_VIEWBOX_PAD;
  const width = XQ_BOARD_W + XQ_VIEWBOX_PAD * 2;
  return svg.replace(
    /viewBox="0 0 [\d.]+ ([\d.]+)"/,
    (_, h: string) => `viewBox="${left} 0 ${width} ${h}"`,
  );
}

function figure(slug: string, svg: string, caption: string, single = false): void {
  const html = [
    '<!-- Generated by scripts/gen-duck-diagrams.mts in the mistboard repo.',
    '     Do not hand-edit: re-run the generator. -->',
    `<figure class="xq-figure" data-duck-figure="${slug}">`,
    `  <div class="xq-figure-board" data-board="${single ? 'single' : 'pair'}">${STYLES}${localArt(single ? cropToBoard(svg) : svg)}</div>`,
    `  <figcaption>${caption}</figcaption>`,
    '</figure>',
  ].join('\n');
  writeFileSync(path.join(INCLUDES, `duck-xq-${slug}.html`), `${html}\n`);
  console.log(`  _includes/duck-xq-${slug}.html`);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, 'pieces'), { recursive: true });

// One pair per figure. Concatenating the horse and elephant pairs put FOUR
// boards in a single figure, which is unreadable at post width.
figure(
  'block',
  DUCK_XIANGQI_HORSE_PAIR(),
  'The horse&rsquo;s leg. Green marks where it can still go; the duck takes the rest away from a square the horse was never going to stand on.',
);

figure(
  'screen',
  DUCK_XIANGQI_SHARED_SCREEN(),
  'One duck, two cannons. Each can fire over it, and only the side to move collects. You place the duck at the end of your turn, so that side is never you.',
  true,
);

figure(
  'facing',
  DUCK_XIANGQI_FACING_PIN(),
  `The generals share a file. Of the ${emptyPoints.length} empty points, the ${blocking.length} green ones are the only placements that would have been legal under the rule I removed.`,
  true,
);

// ── The thumbnail: the duck beside the red general ─────────────────────────

function pairCard(width: number, height: number, size: number): string {
  // Tight: the two discs read as a pair, not as two separate marks.
  const gap = Math.round(size * 0.06);
  const x0 = (width - (size * 2 + gap)) / 2;
  const y = (height - size) / 2;
  return [
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"`,
    ' role="img" aria-label="Duck Xiangqi">',
    `<rect width="${width}" height="${height}" fill="#f4f1ea"/>`,
    renderXiangqiPieceGlyphed({ role: 'general', color: 'red' }, 'international', {
      x: x0,
      y,
      size,
    }),
    `<svg x="${x0 + size + gap}" y="${y}" width="${size}" height="${size}" viewBox="0 0 100 100">`,
    duckPieceMarks('international'),
    '</svg>',
    '</svg>',
  ].join('');
}

// pngquant, when it is on PATH. The art is flat colour: 5,526 colours collapse
// to 38 with a worst-case per-pixel delta of 29 on anti-aliased edges and no
// visible change, which is what makes the 2x raster below cheaper than the 1x
// one was. Optional on purpose: a missing pngquant should cost file size, not
// fail the generator, and the PNG it writes is correct either way.
function quantize(file: string): void {
  const target = path.join(OUT, file);
  const result = spawnSync('pngquant', [
    '--force',
    '--skip-if-larger',
    '--quality',
    '70-95',
    '--output',
    target,
    target,
  ]);
  if (result.error) console.log(`  (pngquant not found; ${file} left unquantized)`);
}

function renderPng(svg: string, file: string, width: number): void {
  // resvg cannot fetch, so the art is inlined as data URIs for the raster.
  const inlined = svg.replace(/href="\/piece-sets\/([^"?]+)\.png[^"]*"/g, (_, rel: string) => {
    const bytes = readFileSync(path.join(PUBLIC, 'piece-sets', `${rel}.png`));
    return `href="data:image/png;base64,${bytes.toString('base64')}"`;
  });
  const png = new Resvg(inlined, { fitTo: { mode: 'width', value: width } }).render().asPng();
  writeFileSync(path.join(OUT, file), png);
  console.log(`  assets/posts/duck-xiangqi/${file} (${(png.length / 1024).toFixed(0)} kB)`);
}

// The feed thumbnail is 3:2, the ratio every other card on that site is drawn
// to (_private/tools/render_thumbnails.py). This one was 8:5 at 640x400 until
// 2026-09-12 and it showed twice over: the card box is a true 3:2, so
// object-fit: cover shaved the sides off a 1.6 drawing, and 640px of source in
// a 271px box is soft on any 2x display while every neighbour in the grid had
// 960. The discs sit at 64 of 100 so the pair keeps nine units of air each side.
//
// 1920 DELIBERATELY EXCEEDS the 960 cap in optimize_thumbnails.sh, and that
// script will resize this back down if it is ever run over the repo. The cap is
// right about the display context (a 271px card wants 960 at most) and the
// reason to break it is that quantized 2x is CHEAPER than unquantized 1x here:
// 55 kB against 67 kB. So the cap buys nothing on this file and costs the only
// context where the art gets looked at closely, which is opening it directly.
// If that script grows a per-file exception list, this belongs on it.
renderPng(pairCard(150, 100, 64), 'thumbnail.png', 1920);
quantize('thumbnail.png');
renderPng(pairCard(120, 63, 40), 'social-card.png', 1200);
quantize('social-card.png');

for (const rel of ART_FILES) {
  copyFileSync(
    path.join(PUBLIC, 'piece-sets', rel),
    path.join(OUT, 'pieces', rel.replace(/\//g, '-')),
  );
}
console.log(`  assets/posts/duck-xiangqi/pieces/ (${ART_FILES.size} files)`);
console.log(
  `\nkernel check: ${blocking.length} of ${emptyPoints.length} placements keep the generals apart`,
);
