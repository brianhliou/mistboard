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

const {
  DUCK_XIANGQI_ELEPHANT_PAIR,
  DUCK_XIANGQI_FACING_PIN,
  DUCK_XIANGQI_FLYING_FINISH,
  DUCK_XIANGQI_HORSE_PAIR,
  DUCK_XIANGQI_SHARED_SCREEN,
} = await import('../apps/web/src/duck-xiangqi-rules-diagrams.js');
const { XQ_BOARD_W, XQ_VIEWBOX_PAD } = await import('../apps/web/src/articles/diagrams.js');
const { duckPieceMarks, renderXiangqiPieceGlyphed } = await import(
  '../apps/web/src/xiangqi-piece-sets.js'
);
const {
  allDuckXiangqiSquares,
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  duckXiangqiGeneralsFace,
  getDuckXiangqiLegalTurns,
} = await import('@mistboard/game');
const { duckXiangqiPositionFigure } = await import(
  '../apps/web/src/duck-xiangqi-rules-diagrams.js'
);

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
  'eye',
  DUCK_XIANGQI_ELEPHANT_PAIR(),
  'The elephant&rsquo;s eye, the midpoint of its two-step diagonal. One duck, two of the four extra rules.',
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

figure(
  'flying',
  DUCK_XIANGQI_FLYING_FINISH(),
  'The finish of the sixth engine game, at ply 228 of 229. Red&rsquo;s general takes Black&rsquo;s down the open d file. Under the rule this variant first kept, that move did not exist.',
  true,
);

// ── The finish of engine game 6, frame by frame ───────────────────────────
//
// The post's argument ends in a real game, so the last full move of one is
// worth stepping through rather than describing. Every frame is REPLAYED
// through the kernel from the recorded move list: if a token stops being
// legal, this throws instead of drawing a position that never occurred.

/** The recorded game, read out of the study seeder so there is one copy. */
function loadGame6(): string[] {
  const seeder = readFileSync(
    path.join(HERE, '../apps/server/src/seed-duck-xiangqi-games-study.ts'),
    'utf8',
  );
  const block = seeder.slice(
    seeder.indexOf('const GAMES'),
    seeder.indexOf('\n];', seeder.indexOf('const GAMES')),
  );
  const games = [
    ...block.matchAll(/plies:\s*\d+,\s*\n\s*winner:\s*'[^']+',[\s\S]*?moves:\s*\n?\s*'([^']*)'/g),
  ];
  const sixth = games[5]?.[1];
  if (!sixth) throw new Error('could not read game 6 out of the study seeder');
  return sixth.split(/\s+/).filter(Boolean);
}

function stepper(slug: string, frames: { svg: string; caption: string }[]): void {
  const steps = frames.map(
    (f, i) =>
      `  <figure class="xq-step"${i === 0 ? '' : ' hidden'}>\n` +
      `    <div class="xq-figure-board" data-board="single">${STYLES}${localArt(cropToBoard(f.svg))}</div>\n` +
      `    <figcaption>${f.caption}</figcaption>\n` +
      '  </figure>',
  );
  const html = [
    '<!-- Generated by scripts/gen-duck-diagrams.mts in the mistboard repo.',
    '     Do not hand-edit: re-run the generator. -->',
    `<div class="xq-stepper" data-stepper="${slug}">`,
    steps.join('\n'),
    '  <div class="xq-step-nav">',
    '    <button type="button" data-dir="-1" aria-label="Previous position">&#8592;</button>',
    `    <span class="xq-step-count">1 / ${frames.length}</span>`,
    '    <button type="button" data-dir="1" aria-label="Next position">&#8594;</button>',
    '  </div>',
    '</div>',
  ].join('\n');
  writeFileSync(path.join(INCLUDES, `duck-xq-${slug}.html`), `${html}\n`);
  console.log(`  _includes/duck-xq-${slug}.html (${frames.length} frames, kernel-checked)`);
}

{
  const tokens = loadGame6();
  const FRAMES = 4; // the last two full moves, plus the finish
  let s = createInitialDuckXiangqiState('g6');
  const history: { board: unknown; duck?: string; token: string }[] = [];
  for (const token of tokens) {
    const turn = getDuckXiangqiLegalTurns(s).find(
      (t2) => (t2.duckTo ? `${t2.from}${t2.to}@${t2.duckTo}` : `${t2.from}${t2.to}`) === token,
    );
    if (!turn) throw new Error(`game 6 token is not legal at this position: ${token}`);
    history.push({ board: s.board, duck: s.duck, token });
    s = applyDuckXiangqiTurn(s, turn);
  }
  const captions = [
    'Black&rsquo;s chariot leaves the d file. Nothing stands between the generals now except the duck, and the duck is about to move.',
    'Black moves the duck to e1, off the d file, because it has to move somewhere.',
    'Red&rsquo;s general takes Black&rsquo;s, the length of the board. Under the rule this variant first kept, this move did not exist.',
  ];
  const tail = history.slice(-FRAMES + 1);
  const frames = tail.map((h, i) => ({
    svg: duckXiangqiPositionFigure({
      id: `g6-${i}`,
      board: h.board as never,
      ...(h.duck ? { duck: h.duck as never } : {}),
      label: `GAME 6, PLY ${tokens.length - tail.length + i + 1}`,
      ...(i === tail.length - 1 ? { captures: ['d9' as never] } : {}),
    }),
    caption: captions[i] ?? '',
  }));
  stepper('finish', frames);
}

// ── The thumbnail: the duck beside the red general ─────────────────────────

function pairCard(width: number, height: number, size: number): string {
  const gap = Math.round(size * 0.2);
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

renderPng(pairCard(160, 100, 72), 'thumbnail.png', 640);
renderPng(pairCard(120, 63, 40), 'social-card.png', 1200);

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
