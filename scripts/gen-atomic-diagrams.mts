// Render the Atomic Xiangqi figures for the variant-lab write-up, using
// MISTBOARD'S OWN diagram functions rather than a second board renderer
// (same reasoning as gen-duck-diagrams.mts, which this follows).
//
//   npx tsx scripts/gen-atomic-diagrams.mts [outDir]
//
// Every position is computed through the lab's rule kernel at the stock point
// (xiangqi-rule-kernel.ts with the blast hook): the squares a blast removes
// are a diff of the board before and after `boardAfter`, never hand-listed,
// and every claim the captions make (the kill zone has five points, the
// parry is mate in one, the standoff repeats) is asserted here before a file
// is written. A rules change that touches the blast redraws these figures
// instead of leaving them quietly wrong.
//
// Output (default docs-private/variant-lab/atomic-xiangqi/figures/):
//   <slug>.svg        standalone SVGs: styles inlined, piece art as data URIs
//   index.html        every figure with its caption, for reading the draft

import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) {
      return { format: 'module', shortCircuit: true, source: 'export default {};' };
    }
    return next(url, context);
  },
});
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
  XQ_BOARD_H,
  XQ_BOARD_W,
  XQ_VIEWBOX_PAD,
  xqBoardSvg,
  xqCoord,
  xqPoint,
  xqSvg,
  xqVisionDemoState,
} = await import('../apps/web/src/articles/diagrams.js');
const {
  boardAfter,
  createXiangqiRuleKernel,
  generalAttacked,
  legalMovesOn,
  parsePlacement,
  placementOf,
} = await import('../packages/game/src/xiangqi-rule-kernel.js');
type XiangqiBoard = import('@mistboard/game').XiangqiBoard;
type XiangqiSquare = import('@mistboard/game').XiangqiSquare;
type XiangqiPiece = import('@mistboard/game').XiangqiPiece;

const HERE = path.dirname(fileURLToPath(import.meta.url));
// docs-private lives in the MAIN worktree only (it is its own repo, gitignored
// here), so a task worktree resolves it through the common git dir.
const MAIN_ROOT = path.dirname(
  execSync('git rev-parse --path-format=absolute --git-common-dir', {
    cwd: HERE,
    encoding: 'utf8',
  }).trim(),
);
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const OUT = outArg
  ? path.resolve(outArg)
  : path.join(MAIN_ROOT, 'docs-private/variant-lab/atomic-xiangqi/figures');
const PUBLIC = path.join(HERE, '../apps/web/public');
const CSS = path.join(HERE, '../apps/web/src/articles.css');

// ── The kernel, at the stock point ─────────────────────────────────────────

// The design rules (the adapter's defaults): four-point blast, soldiers
// immune, facing rule on, perpetual check loses. The stock-point kernel for
// the first-pass figure is built where that figure is.
const kernel = createXiangqiRuleKernel({
  facing: 'file',
  stalemate: 'loss',
  progressClock: 60,
  repetition: 'perpetualCheckLoses',
  blast: { shape: 'orthogonal', immune: ['soldier'], palaceContained: false },
});
const rules = kernel.rules;
// The shipped rules (variants-atomic-xiangqi.ts), for the figures that show
// what the four-point design lacks: the cannon shot that takes only its
// target. Everything the two kernels agree on is drawn with the design kernel.
const { ATOMIC_XIANGQI_RULES } = await import('../packages/game/src/variants-atomic-xiangqi.js');
const shipped = createXiangqiRuleKernel(ATOMIC_XIANGQI_RULES).rules;

function fen(placement: string): XiangqiBoard {
  const board = parsePlacement(placement.split(/\s+/)[0] ?? '');
  if (!board) throw new Error(`bad placement ${placement}`);
  return board;
}
function after(board: XiangqiBoard, from: XiangqiSquare, to: XiangqiSquare, under = rules) {
  return boardAfter(board, { from, to }, under).board;
}
/** Squares a move empties besides its origin: the blast, as the kernel applies it. */
function removedBy(
  board: XiangqiBoard,
  from: XiangqiSquare,
  to: XiangqiSquare,
  under = rules,
): XiangqiSquare[] {
  const next = after(board, from, to, under);
  return (Object.keys(board) as XiangqiSquare[]).filter(
    (sq) => sq !== from && next[sq] === undefined,
  );
}
function legal(
  board: XiangqiBoard,
  mover: 'red' | 'black',
  from: XiangqiSquare,
  to: XiangqiSquare,
  under = rules,
): boolean {
  return legalMovesOn(board, mover, under).some((m) => m.from === from && m.to === to);
}

// ── SVG plumbing ───────────────────────────────────────────────────────────

function diagramStyles(collapseVars: boolean): string {
  const css = readFileSync(CSS, 'utf8');
  const out: string[] = [];
  for (const m of css.matchAll(/\.xq-article-svg (\.xq-diagram-[a-z-]+)\s*\{([^}]*)\}/g)) {
    out.push(`${m[1]}{${m[2].trim().replace(/\s+/g, ' ')}}`);
  }
  if (out.length === 0) throw new Error('no .xq-diagram-* rules found in articles.css');
  // The title colour on the site is a CSS variable; give it a value here.
  // A standalone SVG has no page tokens (and resvg cannot read var()), so
  // every var(--x, fallback) collapses to its fallback, innermost first.
  let joined = out.join('');
  if (!collapseVars) return `<style>${joined}</style>`;
  for (let i = 0; i < 4; i += 1)
    joined = joined.replace(/var\(--[a-z0-9-]+,\s*([^()]*(?:\([^()]*\))?[^()]*)\)/g, '$1');
  return `<style>${joined}.xq-diagram-title{fill:#4b3c2a}</style>`;
}
const STYLES = diagramStyles(true);
// The blog page maps --site-heading / --site-text itself (see the post's style block), so its copies keep the vars.
const BLOG_STYLES = diagramStyles(false);
/** Piece art as data URIs, so each SVG stands alone (no page, no asset dir). */
const ART_CACHE = new Map<string, string>();
function localArt(svg: string): string {
  return svg.replace(/href="\/piece-sets\/([^"?]+)\.png[^"]*"/g, (_, rel: string) => {
    let uri = ART_CACHE.get(rel);
    if (!uri) {
      uri = `data:image/png;base64,${readFileSync(path.join(PUBLIC, 'piece-sets', `${rel}.png`)).toString('base64')}`;
      ART_CACHE.set(rel, uri);
    }
    return `href="${uri}"`;
  });
}

const BOARD_Y = 28;
const GAP = 28;
const FIGURE_H = XQ_BOARD_H + 34;
function state(id: string, board: XiangqiBoard) {
  return xqVisionDemoState(id, board as Partial<Record<XiangqiSquare, XiangqiPiece>>);
}
/** Amber rings on the points a blast removes; a heavier ring on the capture point. */
function blastOverlay(
  squares: readonly XiangqiSquare[],
  capture: XiangqiSquare,
  x0: number,
  y0: number,
): string {
  return squares
    .map((sq) => {
      const { file, rank } = xqCoord(sq);
      const { x, y } = xqPoint(file, rank, 'red', x0, y0 + BOARD_Y);
      const main = sq === capture;
      return `<circle cx="${x}" cy="${y}" r="${main ? 21 : 17}" fill="none" stroke="#e08a1e" stroke-width="${main ? 4 : 3}" opacity="0.95"/>`;
    })
    .join('');
}
type BoardSpec = {
  id: string;
  board: XiangqiBoard;
  label: string;
  arrows?: Array<{ from: XiangqiSquare; to: XiangqiSquare }>;
  dots?: Array<{ square: XiangqiSquare; blocked?: boolean; capture?: boolean }>;
  blast?: { squares: readonly XiangqiSquare[]; capture: XiangqiSquare };
};
function boards(specs: BoardSpec[]): string {
  const width = XQ_BOARD_W * specs.length + GAP * (specs.length - 1);
  return xqSvg(
    width,
    FIGURE_H,
    specs
      .map((s, i) => {
        const x = i * (XQ_BOARD_W + GAP);
        return xqBoardSvg({
          state: state(s.id, s.board),
          x,
          y: 0,
          label: s.label,
          perspective: 'red',
          arrows: s.arrows,
          dots: s.dots,
          overlay: s.blast ? blastOverlay(s.blast.squares, s.blast.capture, x, 0) : undefined,
        });
      })
      .join(''),
  );
}

const figures: Array<{ slug: string; caption: string; svg: string; single: boolean }> = [];
function figure(slug: string, svg: string, caption: string, single = false): void {
  const out = `<!-- Generated by scripts/gen-atomic-diagrams.mts in the mistboard repo. Do not hand-edit. -->\n${localArt(svg).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" `).replace('>', `>${STYLES}`)}`;
  writeFileSync(path.join(OUT, `${slug}.svg`), `${out}\n`);
  figures.push({ slug, caption, svg, single });
  console.log(`  figures/${slug}.svg`);
}

mkdirSync(OUT, { recursive: true });

// ── 1. The blast ───────────────────────────────────────────────────────────

// Chariot on i5 takes the cannon on e5. The blast reaches the four orthogonal
// neighbours: the horse on d5 and the cannon on e6 go, the soldier on e4 is on
// a line too but survives by immunity. The chariot on d6 and the elephant on
// f4 are diagonal and untouched.
const B1 = fen('4k4/9/9/9/3rc4/3nc3R/4pb3/9/9/4K4 w - - 0 1');
const B1_GONE = removedBy(B1, 'i5', 'e5');
if (!legal(B1, 'red', 'i5', 'e5')) throw new Error('Rxe5 should be legal');
if (B1_GONE.sort().join() !== ['d5', 'e5', 'e6'].sort().join())
  throw new Error(`blast removed ${B1_GONE.join(',')}`);
if (after(B1, 'i5', 'e5').e4 === undefined) throw new Error('the soldier on e4 should survive');
figure(
  'blast',
  boards([
    {
      id: 'blast-before',
      board: B1,
      label: 'CHARIOT TAKES THE CANNON ON e5',
      arrows: [{ from: 'i5', to: 'e5' }],
      blast: { squares: B1_GONE, capture: 'e5' },
    },
    { id: 'blast-after', board: after(B1, 'i5', 'e5'), label: 'AFTER THE BLAST' },
  ]),
  'Every capture explodes onto the four adjacent points. The cannon on e5 and the chariot that took it go, and so do the horse on d5 and the cannon on e6. The soldier on e4 is adjacent too and stays, because soldiers survive a blast. The chariot on d6 and the elephant on f4 are diagonal to e5 and are not touched.',
);

// ── 1b. The cannon shot ────────────────────────────────────────────────────

// Same position as the rules page's shot figure: the cannon on e2 jumps the
// soldier on e4 and takes the horse on e7. Only the two of them go; the chariot
// on d7 and the cannon on f7 beside the target stay, and so does the screen.
const SHOT = fen('4k4/9/9/3rnc3/9/9/4P4/9/4C4/4K4 w - - 0 1');
const SHOT_GONE = removedBy(SHOT, 'e2', 'e7', shipped);
if (!legal(SHOT, 'red', 'e2', 'e7', shipped)) throw new Error('Cxe7 should be legal');
if (SHOT_GONE.join() !== 'e7')
  throw new Error(`the shot removed ${SHOT_GONE.join(',')}; it should take e7 only`);
if (after(SHOT, 'e2', 'e7', shipped).e2 !== undefined) throw new Error('the cannon should go too');
figure(
  'shot',
  boards([
    {
      id: 'shot-before',
      board: SHOT,
      label: 'CANNON TAKES THE HORSE ON e7',
      arrows: [{ from: 'e2', to: 'e7' }],
      blast: { squares: SHOT_GONE, capture: 'e7' },
    },
    { id: 'shot-after', board: after(SHOT, 'e2', 'e7', shipped), label: 'ONLY THE TWO OF THEM' },
  ]),
  'A cannon’s capture is the one that does not explode. The cannon on e2 jumps the soldier on e4 and takes the horse on e7; the chariot on d7 and the cannon on f7 beside the target are untouched, and so is the soldier it jumped.',
);

// ── 2. The kill zone ───────────────────────────────────────────────────────

// Every point of the board, tried as a capture point with the general on e1:
// the kill zone is where the blast reaches e1. Geometry only.
function killZoneOf(general: XiangqiSquare): XiangqiSquare[] {
  const zone: XiangqiSquare[] = [];
  for (const file of 'abcdefghi') {
    for (let rank = 1; rank <= 10; rank += 1) {
      const sq = `${file}${rank}` as XiangqiSquare;
      if (sq === general || sq === 'a10') continue;
      const board: XiangqiBoard = {
        [general]: { color: 'red', role: 'general' },
        [sq]: { color: 'red', role: 'horse' },
        a10: { color: 'black', role: 'chariot' },
      };
      if (after(board, 'a10', sq)[general] === undefined) zone.push(sq);
    }
  }
  return zone.sort();
}
const zone = killZoneOf('e1');
if (zone.join() !== ['d1', 'e2', 'f1'].join())
  throw new Error(`kill zone is ${zone.join(',')}; the prose says d1 e2 f1`);
if (killZoneOf('e2').length !== 4) throw new Error('the palace centre should have four');
figure(
  'kill-zone',
  boards([
    {
      id: 'kill-zone-e1',
      board: fen('3k5/9/9/9/9/9/9/9/9/3AKA3 w - - 0 1'),
      label: 'THREE POINTS KILL THE GENERAL',
      dots: zone.map((square) => ({ square, capture: true })),
    },
  ]),
  'Where a capture kills the general on e1: d1, f1 and e2, and two of the three are occupied by the general’s own advisors from move one. A chess king starts with eight neighbours and no target among them.',
  true,
);

// ── 3. The parry ───────────────────────────────────────────────────────────

// After 1. Ra2 Cd8 2. Rd2: the chariot is Black's screen. d1 is orthogonally
// beside e1, so the parry does not depend on the blast shape.
const PARRY = fen('rnbakabnr/9/3c3c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/3R5/1NBAKABNR b - - 0 2');
if (!legal(PARRY, 'black', 'd8', 'd1')) throw new Error('Cxd1 should be legal');
const parryGone = removedBy(PARRY, 'd8', 'd1');
if (!parryGone.includes('e1')) throw new Error('Cxd1 should remove the general on e1');
if (!parryGone.includes('d2')) throw new Error('Cxd1 should remove the chariot on d2');
figure(
  'parry',
  boards([
    {
      id: 'parry-threat',
      board: PARRY,
      label: '2. Rd2 THREATENS Rxd10',
      arrows: [{ from: 'd2', to: 'd10' }],
    },
    {
      id: 'parry-shot',
      board: PARRY,
      label: '2...Cxd1 COMES FIRST: MATE',
      arrows: [{ from: 'd8', to: 'd1' }],
      blast: { squares: parryGone, capture: 'd1' },
    },
  ]),
  'The three-move rush and why it fails. Red’s chariot on d2 is about to take the black advisor on d10 and explode the general. But a cannon captures by jumping exactly one piece, and the chariot on d2 is the one piece between the cannon on d8 and Red’s own advisor on d1. Black shoots first: advisor, chariot and the general on e1 all go.',
);

// ── 4. The opening exchange ────────────────────────────────────────────────

// Every four-point best-play game opens 1. Cxb10 Cxh1: each cannon jumps the
// enemy cannon, takes the horse, and explodes with the chariot and elephant
// beside it.
const START = kernel.initial('open').board;
const openGone1 = removedBy(START, 'b3', 'b10');
if (openGone1.sort().join() !== ['a10', 'b10', 'c10'].join())
  throw new Error(`Cxb10 removes ${openGone1.join(',')}`);
const AFTER1 = after(START, 'b3', 'b10');
const openGone2 = removedBy(AFTER1, 'h8', 'h1');
if (openGone2.sort().join() !== ['g1', 'h1', 'i1'].join())
  throw new Error(`Cxh1 removes ${openGone2.join(',')}`);
figure(
  'opening',
  boards([
    {
      id: 'open-1',
      board: START,
      label: '1. Cxb10, OVER BLACK’S CANNON',
      arrows: [{ from: 'b3', to: 'b10' }],
      blast: { squares: openGone1, capture: 'b10' },
    },
    {
      id: 'open-2',
      board: AFTER1,
      label: '1...Cxh1, THE SAME BACK',
      arrows: [{ from: 'h8', to: 'h1' }],
      blast: { squares: openGone2, capture: 'h1' },
    },
  ]),
  'How every game opens. Each cannon jumps the enemy cannon, lands on the horse and explodes it with the chariot and elephant beside it; the cannon dies too. Three pieces for one on each wing, and the position is level.',
);

// ── 5. The first pass: the only-move standoff of the eight-point blast ─────

// The stock point (eight-point blast, soldiers explode, no facing rule) is a
// different game, and its five-million-node standoff was a line of only-moves.
// Kept as the "first pass" figure; computed with a stock-point kernel.
const stock = createXiangqiRuleKernel({
  facing: 'off',
  stalemate: 'loss',
  progressClock: 60,
  repetition: 'draw',
  blast: { shape: 'eight', immune: [], palaceContained: false },
});
let t = stock.initial('stock-standoff');
const stockSeq: XiangqiBoard[] = [];
for (const uci of [
  'i1i3',
  'b8b1',
  'h3h7',
  'a10a8',
  'i3d3',
  'h8d8',
  'd3f3',
  'd8f8',
  'f3d3',
  'f8d8',
  'd3f3',
  'd8f8',
  'f3d3',
  'f8d8',
]) {
  const mv = stock.fromUci(t, uci);
  if (!mv || !stock.isLegal(t, mv)) throw new Error(`illegal ${uci} in the stock standoff line`);
  t = stock.apply(t, mv);
  stockSeq.push(t.board);
}
if (t.status.type !== 'finished' || t.status.reason !== 'repetition')
  throw new Error(
    `the stock standoff line should end by repetition, got ${JSON.stringify(t.status)}`,
  );
const stockAfterRd3 = stockSeq[4]!;
const stockAfterCd8 = stockSeq[5]!;
if (boardAfter(stockAfterRd3, { from: 'd3', to: 'd10' }, stock.rules).board.e10 !== undefined)
  throw new Error('Rxd10 should explode e10 (stock)');
if (boardAfter(stockAfterCd8, { from: 'd8', to: 'd1' }, stock.rules).board.e1 !== undefined)
  throw new Error('Cxd1 should explode e1 (stock)');
figure(
  'standoff-stock',
  boards([
    {
      id: 'stock-standoff-1',
      board: stockAfterRd3,
      label: '3. Rd3 THREATENS Rxd10',
      arrows: [{ from: 'd3', to: 'd10' }],
    },
    {
      id: 'stock-standoff-2',
      board: stockAfterCd8,
      label: '3...Cd8 THREATENS Cxd1',
      arrows: [{ from: 'd8', to: 'd1' }],
    },
  ]),
  'The first pass, at atomic chess’s own eight-point blast with soldiers exploding. Red’s chariot threatens the advisor; Black’s cannon blocks the file and, over that chariot, threatens the other advisor. Every other move for either side loses on the spot or two pawns, so the loop is forced from move three.',
);

// ── Preview page for docs-private ─────────────────────────────────────────

const html = [
  '<!doctype html><meta charset="utf-8"><title>Atomic Xiangqi figures</title>',
  '<style>body{font:16px/1.5 system-ui;max-width:900px;margin:32px auto;padding:0 16px;color:#222;background:#f6f4ef}figure{margin:0 0 40px}figcaption{margin-top:8px;color:#444}img,svg{max-width:100%;height:auto}</style>',
  '<h1>Atomic Xiangqi: figures</h1><p>Generated by scripts/gen-atomic-diagrams.mts through the lab rule kernel. Amber rings: what a blast removes. Arrows: the threat.</p>',
  ...figures.map(
    (f) =>
      `<figure><img src="${f.slug}.svg" alt="${f.slug}"><figcaption>${f.caption}</figcaption></figure>`,
  ),
].join('\n');
writeFileSync(path.join(OUT, 'index.html'), `${html}\n`);
console.log(`  figures/index.html (${figures.length} figures)`);

// ── Blog output (--blog): brianhliou.com includes, art, thumbnail, card ────
//
// Same shape as gen-duck-diagrams.mts: one _includes/atomic-xq-<slug>.html per
// figure with the site's .xq-figure markup, art copied under assets/posts, and
// the two card images rendered with resvg.

if (process.argv.includes('--blog')) {
  const { Resvg } = await import('@resvg/resvg-js');
  const BLOG = '/Users/brianliou/projects/brianhliou.github.io';
  const BLOG_ASSETS = path.join(BLOG, 'assets/posts/atomic-xiangqi');
  const BLOG_ART = '/assets/posts/atomic-xiangqi/pieces';
  const INCLUDES = path.join(BLOG, '_includes');
  mkdirSync(path.join(BLOG_ASSETS, 'pieces'), { recursive: true });
  const blogArt = new Set<string>();
  const blogArtHref = (svg: string) =>
    svg.replace(/href="\/piece-sets\/([^"?]+)\.png[^"]*"/g, (_, rel: string) => {
      blogArt.add(`${rel}.png`);
      return `href="${BLOG_ART}/${rel.replace(/\//g, '-')}.png"`;
    });
  // A single board renders on the pair-width canvas; re-cut the viewBox around it (see gen-duck-diagrams).
  const cropToBoard = (svg: string) =>
    svg.replace(
      /viewBox="0 0 [\d.]+ ([\d.]+)"/,
      (_, h: string) => `viewBox="0 0 ${XQ_BOARD_W + XQ_VIEWBOX_PAD * 2} ${h}"`,
    );
  // ── Writing the includes: generated copies under xq/en, dispatchers on top ─
  // Same arrangement as gen-anti-diagrams.mts: the blog localises generated
  // includes by deriving _includes/xq/<lang>/ from _includes/xq/en/, and a
  // post includes the dispatcher, which picks the copy for the active language.
  const XQ_EN = path.join(INCLUDES, 'xq', 'en');
  mkdirSync(XQ_EN, { recursive: true });
  const dispatcher = (name: string) => `{%- comment -%}
  Dispatcher. The generated widget lives in _includes/xq/en/${name}
  (from mistboard's gen-atomic-diagrams.mts --blog; drop regenerated output there).
  Localized copies under _includes/xq/<lang>/ are derived by
  _i18n/tools/localize_includes.py from _i18n/includes/strings.<lang>.yml.
{%- endcomment -%}
{%- assign xq_path = "xq/" | append: site.active_lang | append: "/${name}" -%}
{%- include {{ xq_path }} -%}
`;
  const emit = (name: string, html: string) => {
    writeFileSync(path.join(XQ_EN, name), html);
    writeFileSync(path.join(INCLUDES, name), dispatcher(name));
    console.log(`  _includes/xq/en/${name} (+ dispatcher)`);
  };
  for (const f of figures) {
    const body = blogArtHref(f.single ? cropToBoard(f.svg) : f.svg);
    const include = [
      '<!-- Generated by scripts/gen-atomic-diagrams.mts in the mistboard repo.',
      '     Do not hand-edit: re-run the generator with --blog. -->',
      `<figure class="xq-figure" data-atomic-figure="${f.slug}">`,
      `  <div class="xq-figure-board" data-board="${f.single ? 'single' : 'pair'}">${BLOG_STYLES}${body}</div>`,
      `  <figcaption>${f.caption}</figcaption>`,
      '</figure>',
    ].join('\n');
    emit(`atomic-xq-${f.slug}.html`, `${include}\n`);
  }

  // ── The games widget: the engine's games on the house board ──────────────
  // The same card as the anti post's widget (seat rows, board on a mat, a
  // control bar, a move rail, the per-ply caption), with one difference the
  // rules force: a blast removes pieces the move never touched, so every ply
  // carries the placement after it and the points the blast emptied, and the
  // page draws from those instead of applying moves. Every record was played
  // under the kernel as referee; notes are hand-written here.
  const OUTDIR = path.join(MAIN_ROOT, 'docs-private/variant-lab/out/atomic-xiangqi');
  const FP = '7e372bf3cf1a'; // the four-point design against the patched engine
  const artifact = (prefix: string) => {
    const files = readdirSync(OUTDIR)
      .filter((f) => f.startsWith(prefix))
      .sort();
    const f = files[files.length - 1];
    if (!f) throw new Error(`no artifact ${prefix}`);
    return JSON.parse(readFileSync(path.join(OUTDIR, f), 'utf8'));
  };
  // Every string a reader sees, in one table (the blog's localiser extracts
  // text nodes and masks <script> bodies; see gen-anti-diagrams.mts).
  const STR: Record<string, string> = {
    red: 'Red',
    black: 'Black',
    'red-wins': 'Red wins',
    'black-wins': 'Black wins',
    draw: 'Draw',
    pieces: '%1 pieces',
    game: 'Game',
    board: 'Xiangqi board',
    'ctl-start': 'Start',
    'ctl-back': 'Back one ply',
    'ctl-fwd': 'Forward one ply',
    'ctl-end': 'End',
    'by-general-captured': 'by explosion',
    'by-checkmate': 'by checkmate',
    'by-stalemate': 'by stalemate',
    'by-progress-clock': 'by the progress clock',
    'by-repetition': 'by repetition',
    'taking-general': ', taking the general',
    'taking-advisor': ', taking the advisor',
    'taking-elephant': ', taking the elephant',
    'taking-horse': ', taking the horse',
    'taking-chariot': ', taking the chariot',
    'taking-cannon': ', taking the cannon',
    'taking-soldier': ', taking the soldier',
    'blast-gone': '; the blast removes %1',
    'blast-none': '; nothing else in the blast',
    check: ', check',
    'cap-start': 'The start. Red to move.',
    'grp-best-shot':
      'Best play, cannon-shot rules: a cannon\u2019s shot removes only what it hits; a threat to blow up the general counts as check',
    'grp-top-shot': 'Cannon-shot rules, 10M against 1M nodes from one random ply (12)',
    'res-best-shot':
      '%1 %2 after %3 plies, %4 million nodes a move for both sides. Cannon-shot rules: four adjacent points explode and soldiers survive, a cannon\u2019s capture removes only the cannon and its target, and perpetual check loses with a threat to blow up the general counting as check.',
    'res-top-shot':
      '%1 %2 after %3 plies. The first ply was random; 10M nodes played %4, 1M the other side. Cannon-shot rules.',
    'grp-grind-shot':
      'Cannon-shot rules: the draws that were ground out (equal 200k from two random plies, and the two clock draws at 10M against 1M)',
    'lab-grind': '%1 in %2 plies, %3',
    'res-grind-equal':
      '%1 %2 after %3 plies. The first two plies were random; 200k nodes a move for both sides. Cannon-shot rules.',
    'grp-notes': 'Annotated, four-point rules: the drawing resource, and four wins',
    'lab-note-escape': 'The escape: a chariot down and holding, 13 plies',
    'lab-note-dance': 'The dance at the top rung, 17 plies',
    'lab-note-squeeze': 'Win 1: the slow squeeze, 127 plies',
    'lab-note-blast': 'Win 2: soldier march and an explosion, 77 plies',
    'lab-note-invade': 'Win 3: a cannon on the second rank, 102 plies',
    'lab-note-blunder': 'Win 4: level for 70 plies, one capture too many, 84 plies',
    'res-note-escape':
      'Draw by repetition after 13 plies. 100k nodes played Black, 10k Red. Black is a chariot down from move 2 and holds.',
    'res-note-dance':
      'Draw by repetition after 17 plies. 10M nodes played Black, 1M Red. Level material; the stronger engine took the draw.',
    'res-note-squeeze': 'Red wins by checkmate after 127 plies. 10M nodes played Red, 1M Black.',
    'res-note-blast': 'Red wins by explosion after 77 plies. 10M nodes played Red, 1M Black.',
    'res-note-invade': 'Black wins by checkmate after 102 plies. 10M nodes played Black, 1M Red.',
    'res-note-blunder': 'Black wins by checkmate after 84 plies. 10M nodes played Black, 1M Red.',
    'grp-best': 'Best play, engine against itself (four-point rules)',
    'grp-best-shelter':
      'Best play under the shelter: palace immune to blasts, cannons unloaded at the start',
    'res-best-shelter':
      '%1 %2 after %3 plies, %4 million nodes a move for both sides. Shelter rules: a blast never removes a piece on a palace point, and a cannon may not capture from its starting point.',
    'grp-equal': 'Equal strength: 200k nodes a side from two random plies (15)',
    'grp-top': 'Strongest games: 10M against 1M nodes from one random ply (12)',
    'grp-mid': 'Ladder: 1M against 100k nodes from one random ply (20)',
    'grp-ladder': 'Ladder: 100k against 10k nodes from one random ply (20)',
    'grp-decline-equal': 'Declined draws, equal strength: 2M a side (8)',
    'grp-decline-gap': 'Declined draws against a weaker side: 2M against 200k (8)',
    'lab-decline': '%1-ply draw, %2 declines at %3: %4 in %5',
    'res-decline':
      '%1 %2 after %3 plies. A %4-ply engine draw replayed from its last cycle: at ply %5 %6 refused the repetition (%7 for its best other move) and kept refusing while the cost stayed under a pawn; %8 nodes a move for the decliner, %9 for the other side.',
    'seat-fsf-2m': 'Fairy-Stockfish, 2M nodes',
    'lab-best': '%1M nodes a move, %2 plies',
    'lab-equal': 'pair %1: %2 in %3',
    'lab-ladder': 'pair %1, 100k as %2: %3 in %4',
    'lab-top': 'pair %1, 10M as %2: %3 in %4',
    'lab-mid': 'pair %1, 1M as %2: %3 in %4',
    'res-best': '%1 %2 after %3 plies, %4 million nodes a move for both sides.',
    'res-equal':
      '%1 %2 after %3 plies. The first two plies were random; 200k nodes a move for both sides.',
    'res-ladder':
      '%1 %2 after %3 plies. The first ply was random; 100k nodes played %4, 10k the other side.',
    'res-top':
      '%1 %2 after %3 plies. The first ply was random; 10M nodes played %4, 1M the other side.',
    'res-mid':
      '%1 %2 after %3 plies. The first ply was random; 1M nodes played %4, 100k the other side.',
    'seat-fsf-m': 'Fairy-Stockfish, %1M nodes',
    'seat-fsf-200k': 'Fairy-Stockfish, 200k nodes',
    'seat-fsf-100k': 'Fairy-Stockfish, 100k nodes',
    'seat-fsf-10k': 'Fairy-Stockfish, 10k nodes',
    'seat-fsf-1m': 'Fairy-Stockfish, 1M nodes',
    'seat-fsf-10m': 'Fairy-Stockfish, 10M nodes',
  };
  const NOTES: Record<string, Record<number, string>> = {
    'note-escape': {
      3: 'Red’s cannon jumps the h8 cannon and takes the h10 horse; the blast takes the i10 chariot and the g10 elephant. Black played Ra9 instead of the mirror shot, so there is no exchange back: Black is a chariot, a horse and an elephant down for a cannon.',
      4: 'The escape. The chariot lands on f9 and threatens Rxf1: take the advisor, and the blast reaches the general on e1. Nothing else Black has matters.',
      5: 'The only parry. The cannon blocks the f-file. Every other Red move is mate in one (probed at 3M nodes: Ae2, Ra2, Ra3, Ri2 all lose to Rxf1; Ke2 is mated a few moves later). But the cannon now has its own shot: with the chariot on f9 as its screen, Cxf10 would blast e10.',
      6: 'So the chariot steps to d9, same threat on the other advisor. Its alternatives, every one of them off the palace file (h9, g9, c9, a9), score -3.2 to -4.0: leave the file and Red’s extra chariot starts to count.',
      7: 'And the cannon follows. Again every other move is mate in one.',
      13: 'Third occurrence. A chariot down, Black holds, and neither side ever had a second choice.',
    },
    'note-dance': {
      3: 'The double exchange, one wing each: level material, twelve pieces a side.',
      8: 'Black’s remaining chariot walks a10-a8-a9-f9 and lands on the advisor file: Rxf1 and the blast reaches e1.',
      9: 'The parry from behind: the cannon comes to f8, directly under the chariot. It blocks the file, and over the chariot as screen it threatens Cxf10, blasting e10.',
      10: 'The chariot hops to d9. This is the move a human would think about: at 3M nodes the alternatives score -0.6 to -0.7 (c9, b9, g9, e9, a9), all playable, none better than repeating. The 10M engine took the repetition. Played on at 2M against 2M this game ran 142 plies at 0.00 to the progress clock; against 200k it ran 145 plies to the same draw.',
      11: 'Red follows with the cannon. Alternatives: Ke2 scores -12; Ae2, Ca8, Ri1 are mate in one.',
      17: 'Third occurrence. Level material, best play on both sides, and the stronger engine could find nothing it preferred.',
    },
    'note-squeeze': {
      8: 'The 1M engine’s first slip: the cannon leaves its file for h4, and Red is +1.4.',
      25: 'Red gives the cannon for Black’s chariot on d9; the blast takes the advisor on e9 with it.',
      29: 'Chariot for chariot. From here Red is about +2 and spends seventy plies improving every piece while Black shuffles.',
      104: 'Black takes on c5 and Red’s horse takes the horse on a9: the last piece that could defend the palace. +7.9.',
      106: 'Cd6 walks into a mate in eleven. Red’s chariot and cannon enter the palace together.',
      127: 'The chariot steps beside the general. The general cannot take it (a capturer dies in its own blast) and has no square. Checkmate, no explosion needed.',
    },
    'note-blast': {
      26: 'Hi8 gives Red +2.1: the horse retreats to the edge and the h-file opens.',
      27: 'The soldier starts walking: h6, h7, h8. Soldiers are immune to blasts, so nothing Black captures nearby can shake it, and every step is a tempo Black must answer.',
      46: 'Ph4 costs Black a pawn and a half of eval; Red is +5.',
      63: 'The chariot lands on h8 behind the soldier: mate in seven.',
      69: 'The soldier takes the advisor on e9; the blast takes the elephant on e8. The general’s cover is gone.',
      77: 'Rxd8: the chariot takes the advisor, and the four-point blast reaches the general on d9. The explosion win.',
    },
    'note-invade': {
      2: 'The double exchange, with Black shooting first this time.',
      27: 'Ec1 retreats the elephant and lets the cannon in: -2.6.',
      28: 'Cb2. The cannon sits on Red’s second rank, aimed along the palace floor; every Red piece that steps between it and the general becomes a screen. -4.6.',
      59: 'Red’s elephant takes on e3 and the blast removes both of Red’s own advisors: the palace is empty.',
      81: 'Hd10, and the 1M engine is lost: Black has a forced mate and the soldiers start walking.',
      102: 'Rd1. The chariot beside the general on d2, no square, no capture. Checkmate.',
    },
    'note-blunder': {
      3: 'The double exchange.',
      22: 'Level for seventy plies: the evaluation never leaves -1.7 to 0.0.',
      61: 'Red’s chariot takes the cannon on d9 and the blast takes the advisors on d10 and e9 with it: Black’s palace is open, and still the position is level.',
      73: 'Exc5: the elephant takes a soldier. The capturer dies, so it is an elephant for a soldier, and it was the last piece covering the palace. Mate in six.',
      84: 'Re2, beside the general on e1. Checkmate.',
    },
    'best-1000000': {
      1: 'Red’s cannon jumps the black cannon on b8 and takes the b10 horse. The blast takes the a10 chariot and the c10 elephant with it, and the cannon itself.',
      2: 'The same exchange back on the other wing. Three pieces for one on each side, and the position is level.',
      46: 'Third occurrence: the chariots on the h and i files step back and forth. Draw by repetition after a real middlegame.',
    },
    'best-2000000': {
      2: 'The double exchange.',
      127: 'Sixty plies without a capture: a draw by the clock, the only game of the five that never repeated.',
    },
    'best-5000000': {
      2: 'The double exchange.',
      83: 'Third occurrence, elephant and advisor stepping in the palace. Draw by repetition.',
    },
    'best-10000000': {
      2: 'The double exchange.',
      94: 'Third occurrence, an advisor shuffle. Draw by repetition.',
    },
    'best-20000000': {
      2: 'The double exchange.',
      64: 'Third occurrence: Red’s advisor and Black’s general stepping back and forth. Draw by repetition.',
    },
  };
  const chunks = (text: string): string[] => {
    const out: string[] = [];
    let cur = '';
    for (const sentence of text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text]) {
      if ((cur + sentence).trim().length > 200 && cur) {
        out.push(cur.trim());
        cur = '';
      }
      cur += sentence;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const i18nBlock = (noteGames: readonly string[]) => {
    const spans: string[] = [];
    for (const k of Object.keys(STR)) spans.push(`<span data-k="${k}">${esc(STR[k]!)}</span>`);
    for (const g of noteGames)
      for (const [ply, text] of Object.entries(NOTES[g] ?? {}))
        chunks(text).forEach((c, i) => {
          spans.push(`<span data-k="n:${g}:${ply}:${i}">${esc(c)}</span>`);
        });
    return `<div class="anxq-i18n" hidden>${spans.join('')}</div>`;
  };

  type Arg = number | string | ['k', string];
  type Spec = { k: string; a: Arg[] };
  type Rec = {
    id: string;
    /** Which rules the record was played under; the widget replays it with that kernel. */
    ruleset?: 'shelter' | 'shot';
    group: Spec;
    label: Spec;
    result: Spec;
    red: Spec;
    black: Spec;
    moves: readonly string[];
  };
  const verdictOf = (g: { winner: string | null }): Arg => [
    'k',
    g.winner ? `${g.winner}-wins` : 'draw',
  ];
  const by = (reason: string): Arg => ['k', `by-${reason}`];
  const side = (c: string): Arg => ['k', c];
  const records: Rec[] = [];
  const SHOT = '045a5cf08c06';
  for (const g of artifact(`bestplay-${SHOT}-`).result.games) {
    const m = g.nodes / 1_000_000;
    records.push({
      id: `best-shot-${g.nodes}`,
      ruleset: 'shot',
      group: { k: 'grp-best-shot', a: [] },
      label: { k: 'lab-best', a: [m, g.plies] },
      result: { k: 'res-best-shot', a: [verdictOf(g), by(g.reason), g.plies, m] },
      red: { k: 'seat-fsf-m', a: [m] },
      black: { k: 'seat-fsf-m', a: [m] },
      moves: g.moves,
    });
  }
  // The grinds: every draw from the two-ply equal run (deduplicated) and the top rung's draws.
  const grindSeen = new Set<string>();
  let grind = 0;
  for (const g of artifact(`ladder-${SHOT}-4-`).result.games) {
    if (g.winner) continue;
    const key = g.moves.join(' ');
    if (grindSeen.has(key)) continue;
    grindSeen.add(key);
    grind += 1;
    records.push({
      id: `grind-shot-${grind}`,
      ruleset: 'shot',
      group: { k: 'grp-grind-shot', a: [] },
      label: { k: 'lab-grind', a: [['k', 'draw'], g.plies, ['k', 'seat-fsf-200k']] },
      result: { k: 'res-grind-equal', a: [verdictOf(g), by(g.reason), g.plies] },
      red: { k: 'seat-fsf-200k', a: [] },
      black: { k: 'seat-fsf-200k', a: [] },
      moves: g.moves,
    });
  }
  for (const seed of ['12', '14', '15']) {
    for (const g of artifact(`ladder-${SHOT}-${seed}-`).result.games) {
      if (g.winner) continue;
      grind += 1;
      records.push({
        id: `grind-shot-${grind}`,
        ruleset: 'shot',
        group: { k: 'grp-grind-shot', a: [] },
        label: { k: 'lab-grind', a: [['k', 'draw'], g.plies, ['k', 'seat-fsf-10m']] },
        result: { k: 'res-top-shot', a: [verdictOf(g), by(g.reason), g.plies, side(g.hiSeat)] },
        red: { k: g.hiSeat === 'red' ? 'seat-fsf-10m' : 'seat-fsf-1m', a: [] },
        black: { k: g.hiSeat === 'black' ? 'seat-fsf-10m' : 'seat-fsf-1m', a: [] },
        moves: g.moves,
      });
    }
  }
  let shotTop = 0;
  for (const seed of ['12', '14', '15']) {
    for (const g of artifact(`ladder-${SHOT}-${seed}-`).result.games) {
      shotTop += 1;
      records.push({
        id: `top-shot-${shotTop}`,
        ruleset: 'shot',
        group: { k: 'grp-top-shot', a: [] },
        label: { k: 'lab-top', a: [Math.ceil(shotTop / 2), side(g.hiSeat), verdictOf(g), g.plies] },
        result: { k: 'res-top-shot', a: [verdictOf(g), by(g.reason), g.plies, side(g.hiSeat)] },
        red: { k: g.hiSeat === 'red' ? 'seat-fsf-10m' : 'seat-fsf-1m', a: [] },
        black: { k: g.hiSeat === 'black' ? 'seat-fsf-10m' : 'seat-fsf-1m', a: [] },
        moves: g.moves,
      });
    }
  }
  const noteGame = (id: string, art: string, index: number, hi: string, lo: string) => {
    const g = artifact(art).result.games[index - 1];
    records.push({
      id,
      group: { k: 'grp-notes', a: [] },
      label: { k: `lab-${id}`, a: [] },
      result: { k: `res-${id}`, a: [] },
      red: { k: g.hiSeat === 'red' ? hi : lo, a: [] },
      black: { k: g.hiSeat === 'black' ? hi : lo, a: [] },
      moves: g.moves,
    });
  };
  noteGame('note-escape', `ladder-${FP}-1-`, 10, 'seat-fsf-100k', 'seat-fsf-10k');
  noteGame('note-dance', `ladder-${FP}-12-`, 2, 'seat-fsf-10m', 'seat-fsf-1m');
  noteGame('note-squeeze', `ladder-${FP}-12-`, 1, 'seat-fsf-10m', 'seat-fsf-1m');
  noteGame('note-blast', `ladder-${FP}-12-`, 7, 'seat-fsf-10m', 'seat-fsf-1m');
  noteGame('note-invade', `ladder-${FP}-12-`, 10, 'seat-fsf-10m', 'seat-fsf-1m');
  noteGame('note-blunder', `ladder-${FP}-12-`, 4, 'seat-fsf-10m', 'seat-fsf-1m');
  const best = artifact(`bestplay-${FP}-`);
  for (const g of best.result.games) {
    const m = g.nodes / 1_000_000;
    records.push({
      id: `best-${g.nodes}`,
      group: { k: 'grp-best', a: [] },
      label: { k: 'lab-best', a: [m, g.plies] },
      result: { k: 'res-best', a: [verdictOf(g), by(g.reason), g.plies, m] },
      red: { k: 'seat-fsf-m', a: [m] },
      black: { k: 'seat-fsf-m', a: [m] },
      moves: g.moves,
    });
  }
  // Two artifacts share the sequence number (the run was split 1M-5M / 10M-20M): read both.
  const bestShelter = readdirSync(OUTDIR)
    .filter((f) => f.startsWith('bestplay-033287920bd5-'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(path.join(OUTDIR, f), 'utf8')).result.games);
  for (const g of bestShelter) {
    const m = g.nodes / 1_000_000;
    records.push({
      id: `best-shelter-${g.nodes}`,
      ruleset: 'shelter',
      group: { k: 'grp-best-shelter', a: [] },
      label: { k: 'lab-best', a: [m, g.plies] },
      result: { k: 'res-best-shelter', a: [verdictOf(g), by(g.reason), g.plies, m] },
      red: { k: 'seat-fsf-m', a: [m] },
      black: { k: 'seat-fsf-m', a: [m] },
      moves: g.moves,
    });
  }
  const rung = (
    seedTag: string,
    group: string,
    lab: string,
    res: string,
    hiSeat: string,
    loSeat: string,
  ) => {
    const art = artifact(`ladder-${FP}-${seedTag}-`);
    art.result.games.forEach(
      (
        g: {
          hiSeat: string;
          winner: string | null;
          reason: string;
          plies: number;
          moves: string[];
        },
        i: number,
      ) => {
        records.push({
          id: `${group}-${i + 1}`,
          group: { k: `grp-${group}`, a: [] },
          label: { k: lab, a: [Math.floor(i / 2) + 1, side(g.hiSeat), verdictOf(g), g.plies] },
          result: { k: res, a: [verdictOf(g), by(g.reason), g.plies, side(g.hiSeat)] },
          red: { k: g.hiSeat === 'red' ? hiSeat : loSeat, a: [] },
          black: { k: g.hiSeat === 'black' ? hiSeat : loSeat, a: [] },
          moves: g.moves,
        });
      },
    );
  };
  rung('12', 'top', 'lab-top', 'res-top', 'seat-fsf-10m', 'seat-fsf-1m');
  rung('11', 'mid', 'lab-mid', 'res-mid', 'seat-fsf-1m', 'seat-fsf-100k');
  const equal = artifact(`ladder-${FP}-3-`);
  const seenEqual = new Set<string>();
  let pair = 0;
  for (const g of equal.result.games) {
    const key = g.moves.join(' ');
    if (seenEqual.has(key)) continue; // equal budgets make the swapped-seat game identical
    seenEqual.add(key);
    pair += 1;
    records.push({
      id: `equal-${pair}`,
      group: { k: 'grp-equal', a: [] },
      label: { k: 'lab-equal', a: [pair, verdictOf(g), g.plies] },
      result: { k: 'res-equal', a: [verdictOf(g), by(g.reason), g.plies] },
      red: { k: 'seat-fsf-200k', a: [] },
      black: { k: 'seat-fsf-200k', a: [] },
      moves: g.moves,
    });
  }
  const ladder = artifact(`ladder-${FP}-1-`);
  ladder.result.games.forEach(
    (
      g: { hiSeat: string; winner: string | null; reason: string; plies: number; moves: string[] },
      i: number,
    ) => {
      records.push({
        id: `ladder-${i + 1}`,
        group: { k: 'grp-ladder', a: [] },
        label: {
          k: 'lab-ladder',
          a: [Math.floor(i / 2) + 1, side(g.hiSeat), verdictOf(g), g.plies],
        },
        result: { k: 'res-ladder', a: [verdictOf(g), by(g.reason), g.plies, side(g.hiSeat)] },
        red: { k: g.hiSeat === 'red' ? 'seat-fsf-100k' : 'seat-fsf-10k', a: [] },
        black: { k: g.hiSeat === 'black' ? 'seat-fsf-100k' : 'seat-fsf-10k', a: [] },
        moves: g.moves,
      });
    },
  );
  const decline = artifact(`decline-${FP}-`);
  decline.result.games.forEach(
    (
      g: {
        decliner: string;
        declineAtPly: number;
        declineScore: string;
        otherNodes: number;
        sourcePlies: number;
        winner: string | null;
        reason: string;
        plies: number;
        moves: string[];
        repeatsAvoided: number;
      },
      i: number,
    ) => {
      if (g.repeatsAvoided === 0) return; // looked at the alternative and took the draw: the game is the source game
      const gap = g.otherNodes !== 2_000_000;
      const otherSeat = gap ? 'seat-fsf-200k' : 'seat-fsf-2m';
      records.push({
        id: `decline-${gap ? 'gap' : 'equal'}-${(i % 12) + 1}`,
        group: { k: gap ? 'grp-decline-gap' : 'grp-decline-equal', a: [] },
        label: {
          k: 'lab-decline',
          a: [g.sourcePlies, side(g.decliner), g.declineScore, verdictOf(g), g.plies],
        },
        result: {
          k: 'res-decline',
          a: [
            verdictOf(g),
            by(g.reason),
            g.plies,
            g.sourcePlies,
            g.declineAtPly,
            side(g.decliner),
            g.declineScore,
            '2M',
            gap ? '200k' : '2M',
          ],
        },
        red: { k: g.decliner === 'red' ? 'seat-fsf-2m' : otherSeat, a: [] },
        black: { k: g.decliner === 'black' ? 'seat-fsf-2m' : otherSeat, a: [] },
        moves: g.moves,
      });
    },
  );
  // Replay every record through the kernel: san, the placement after each
  // ply, what the blast removed, whether the move gave check.
  const LETTER: Record<string, string> = {
    general: 'K',
    advisor: 'A',
    elephant: 'E',
    horse: 'H',
    chariot: 'R',
    cannon: 'C',
    soldier: 'P',
  };
  const baseKernel = kernel;
  const shotKernel = createXiangqiRuleKernel({
    ...kernel.rules,
    repetitionCheck: 'lethal',
    blast: { ...kernel.rules.blast!, cannonShotBlasts: false },
  });
  const shelterKernel = createXiangqiRuleKernel({
    ...kernel.rules,
    cannonUnloaded: true,
    blast: { ...kernel.rules.blast!, shelter: 'palace' },
  });
  const encoded = records.map((r) => {
    const kernel =
      r.ruleset === 'shelter' ? shelterKernel : r.ruleset === 'shot' ? shotKernel : baseKernel;
    const rules = kernel.rules;
    let st = kernel.initial(`w-${r.id}`);
    const start = placementOf(st.board);
    const moves = r.moves.map((u) => {
      const m = kernel.fromUci(st, u);
      if (!m || !kernel.isLegal(st, m)) throw new Error(`bad move ${u} in ${r.id}`);
      const before = st.board;
      const piece = before[m.from]!;
      const captured = before[m.to]?.role ?? null;
      st = kernel.apply(st, m);
      const gone = (Object.keys(before) as XiangqiSquare[]).filter(
        (sq) => sq !== m.from && sq !== m.to && st.board[sq] === undefined,
      );
      const enemy = piece.color === 'red' ? 'black' : 'red';
      const check = st.status.type === 'playing' && generalAttacked(st.board, enemy, rules);
      return {
        u,
        s: `${LETTER[piece.role]}${captured ? 'x' : ''}${m.to}${check ? '+' : ''}`,
        m: piece.color === 'red' ? 'r' : 'b',
        c: captured,
        g: gone.map((sq) => `${LETTER[before[sq]!.role]}${sq}`),
        p: placementOf(st.board),
        k: check ? 1 : 0,
      };
    });
    const { moves: _m, ...rest } = r;
    return { ...rest, start, moves };
  });
  const CTL = (id: string, suffix: string, key: string, icon: string) =>
    `<button class="anxq-control" id="${id}-${suffix}" aria-label="${STR[key]}"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">${icon}</svg></button>`;
  const ICON = {
    first: '<rect x="3.4" y="4" width="1.7" height="8" rx="0.7"/><path d="M12.6 4.3v7.4L6.5 8z"/>',
    prev: '<path d="M11 4.3v7.4L4.9 8z"/>',
    next: '<path d="M5 4.3v7.4L11.1 8z"/>',
    last: '<rect x="10.9" y="4" width="1.7" height="8" rx="0.7"/><path d="M3.4 4.3v7.4L9.5 8z"/>',
  };
  const WID = 'atomic-games';
  const data = JSON.stringify(encoded).replace(/</g, '\\u003c');
  const widgetHtml = `<!-- Generated by scripts/gen-atomic-diagrams.mts in the mistboard repo (--blog). Do not hand-edit.
     Every record was played under the rule kernel as referee; the page draws the placements the kernel produced. -->
${i18nBlock(Object.keys(NOTES))}
<div id="${WID}" class="anxq" tabindex="0" data-anxq data-start="2">
<div class="anxq-pick"><label class="anxq-more" for="${WID}-more">${STR.game}</label><select id="${WID}-more" class="anxq-select"></select></div><div class="anxq-header" id="${WID}-header"></div>
<div class="anxq-card">
  <div class="anxq-board-col">
    <div class="anxq-seat"><span class="anxq-disc anxq-disc--black"></span><span class="anxq-seat-name" id="${WID}-seat-black">${STR.black}</span><span class="anxq-seat-clock" id="${WID}-count-black"></span></div>
    <div class="anxq-mat"><svg id="${WID}-board" viewBox="0 0 284 315" aria-label="${STR.board}"></svg></div>
    <div class="anxq-seat"><span class="anxq-disc anxq-disc--red"></span><span class="anxq-seat-name" id="${WID}-seat-red">${STR.red}</span><span class="anxq-seat-clock" id="${WID}-count-red"></span></div>
    <div class="anxq-controls">
      ${CTL(WID, 'first', 'ctl-start', ICON.first)}
      ${CTL(WID, 'prev', 'ctl-back', ICON.prev)}
      <span class="anxq-status" id="${WID}-pos"></span>
      ${CTL(WID, 'next', 'ctl-fwd', ICON.next)}
      ${CTL(WID, 'last', 'ctl-end', ICON.last)}
    </div>
  </div>
  <div class="anxq-rail">
    <div class="anxq-rail-inner">
      <div class="anxq-moves" id="${WID}-moves"></div>
      <div class="anxq-result" id="${WID}-result"></div>
    </div>
  </div>
</div>
<div class="anxq-caption" id="${WID}-caption"></div>
<script type="application/json" id="${WID}-data">${data}</script>
</div>
`;
  const WIDGET_CSS = `<style>
.anxq { --anxq-border: var(--line-strong, #d9d9d4); --anxq-panel: var(--surface, #fff); --anxq-muted: var(--text-3, #6a6a70); --anxq-heading: var(--text, #1c1c1e); --anxq-hover: var(--surface-2, #f4f4f2); --anxq-accent: hsl(165, 56%, 28%); --anxq-on-accent: #fff; margin: 1.5rem 0 2rem; outline: none; font-size: 15px; }
.anxq-pick { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
.anxq-more { flex: none; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--anxq-muted); }
.anxq-select { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 15px; font-weight: 600; color: var(--anxq-heading); background: var(--anxq-panel); border: 1px solid var(--anxq-border); border-radius: 8px; padding: 8px 10px; }
.anxq-header { font-size: 14px; font-weight: 600; color: var(--anxq-muted); text-align: center; margin-bottom: 6px; }
.anxq-card { display: flex; border: 1px solid var(--anxq-border); border-radius: 10px 10px 0 0; background: var(--anxq-panel); overflow: hidden; }
.anxq-board-col { display: flex; flex: 0 0 auto; flex-direction: column; width: min(100%, 470px); min-width: 0; }
.anxq-seat { display: flex; align-items: center; gap: 9px; min-height: 39px; padding: 9px 14px; box-sizing: border-box; font-size: 15px; font-weight: 600; line-height: 21px; color: var(--anxq-heading); }
.anxq-seat-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.anxq-seat-clock { flex: none; font-weight: 500; color: var(--anxq-muted); font-variant-numeric: tabular-nums; }
.anxq-disc { flex: none; width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--anxq-border); }
.anxq-disc--red { background: #c0392b; border-color: #c0392b; }
.anxq-disc--black { background: #2b2b2b; border-color: #2b2b2b; }
.anxq-mat { padding-inline: 8px; }
.anxq-mat svg { display: block; width: 100%; height: auto; border-radius: 8px; }
.anxq-controls { display: grid; grid-template-columns: 1fr 1fr auto 1fr 1fr; align-items: stretch; border-top: 1px solid var(--anxq-border); }
.anxq-control { display: flex; align-items: center; justify-content: center; min-height: 38px; margin: 0; padding: 0; border: none; border-radius: 0; background: none; color: var(--anxq-muted); cursor: pointer; }
.anxq-control:hover { background: var(--anxq-hover); color: var(--anxq-heading); }
.anxq-control:disabled { opacity: .35; cursor: default; background: none; }
.anxq-status { display: flex; align-items: center; justify-content: center; min-width: 52px; padding: 0 10px; color: var(--anxq-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.anxq-caption { box-sizing: border-box; min-height: 3.1em; border: 1px solid var(--anxq-border); border-top: 0; border-radius: 0 0 10px 10px; background: var(--anxq-panel); padding: 8px 14px 10px; font-size: 14px; line-height: 1.45; color: var(--anxq-heading); }
.anxq-caption .san { font-family: ui-monospace, Menlo, monospace; font-weight: 600; }
.anxq-caption .who { color: var(--anxq-muted); font-size: 13px; }
.anxq-caption p { margin: 4px 0 0; }
.anxq-rail { position: relative; flex: 1 1 0; min-width: 160px; max-width: 230px; border-left: 1px solid var(--anxq-border); }
.anxq-rail-inner { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.anxq-moves { flex: 1; min-height: 0; overflow: auto; padding: 6px 4px; display: grid; grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr); gap: 1px 2px; align-content: start; align-items: baseline; }
.anxq-moves .n { padding-left: 0; font-size: 13.5px; color: var(--anxq-muted); font-variant-numeric: tabular-nums; }
.anxq-moves .n::after { content: "."; }
.anxq-moves button { font: inherit; text-align: left; background: none; border: 0; padding: 3px 4px; border-radius: 4px; color: var(--anxq-heading); cursor: pointer; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.anxq-moves button.blast::after { content: "*"; color: #e08a1e; font-weight: 700; }
.anxq-moves button:hover { background: var(--anxq-hover); }
.anxq-moves button.cur, .anxq-moves button.cur:hover { background: var(--anxq-accent); color: var(--anxq-on-accent); }
.anxq-result { flex: none; box-sizing: border-box; min-height: 39px; padding: 6px 8px; border-top: 1px solid var(--anxq-border); background: var(--anxq-panel); color: var(--anxq-muted); font-size: 12px; font-weight: 600; text-align: center; line-height: 1.3; }
@media (max-width: 640px) { .anxq-card { flex-direction: column; } .anxq-board-col { width: 100%; } .anxq-rail { border-left: 0; border-top: 1px solid var(--anxq-border); min-height: 220px; max-width: none; } }
</style>`;
  // The board drawing, as in the anti widget, plus the blast: an amber ring on
  // every point the capture emptied, and a heavier one on the capture point.
  const WIDGET_JS = `<script>
(() => {
  const ROLE = { k: 'general', a: 'advisor', b: 'elephant', n: 'horse', r: 'chariot', c: 'cannon', p: 'soldier' };
  const ART = '${BLOG_ART}/xiangqi-international-';
  const FRAME = { general: { x: -7, y: -7, w: 114 }, advisor: { x: -7, y: -7, w: 114 }, elephant: { x: -5, y: -5, w: 110 }, horse: { x: -7, y: -7, w: 114 }, chariot: { x: -5.5, y: -7, w: 111 }, cannon: { x: -11, y: -11, w: 122 }, soldier: { x: 0, y: 0, w: 100 } };
  const M = 18, C = 31, PIECE = 28;
  const STRS = {};
  const T = (k, ...a) => {
    let s = STRS[k];
    if (s === undefined) { const e = document.querySelector('.anxq-i18n [data-k="' + k + '"]'); s = e ? e.textContent : k; STRS[k] = s; }
    a.forEach((v, i) => { s = s.split('%' + (i + 1)).join(Array.isArray(v) ? T(v[1]) : String(v)); });
    return s;
  };
  const F = (spec) => T(spec.k, ...spec.a);
  const N = (game, ply) => { const seen = new Set(), out = []; for (const e of document.querySelectorAll('.anxq-i18n [data-k^="n:' + game + ':' + ply + ':"]')) { if (seen.has(e.dataset.k)) continue; seen.add(e.dataset.k); out.push(e.textContent); } return out.join(' '); };
  const xOf = (f) => M + f * C, yOf = (r) => M + (10 - r) * C;
  const pt = (s) => ({ x: xOf(s.charCodeAt(0) - 97), y: yOf(Number(s.slice(1))) });
  function parsePlacement(p) {
    const board = {};
    p.split('/').forEach((row, i) => {
      const rank = 10 - i; let file = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '9') { file += Number(ch); continue; }
        board[String.fromCharCode(97 + file) + rank] = { color: ch === ch.toUpperCase() ? 'red' : 'black', role: ROLE[ch.toLowerCase()] };
        file += 1;
      }
    });
    return board;
  }
  const sq = (u) => { const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(u); return { from: m[1], to: m[2] }; };
  const L = (x1, y1, x2, y2) => '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#4b3c2a" stroke-width="1"/>';
  const GRID = (() => {
    const g = ['<rect x="0" y="0" width="284" height="315" rx="8" fill="#d9bd82"/>'];
    for (let r = 0; r < 10; r++) g.push(L(M, M + r * C, M + 8 * C, M + r * C));
    for (let f = 0; f < 9; f++) {
      if (f === 0 || f === 8) g.push(L(M + f * C, M, M + f * C, M + 9 * C));
      else { g.push(L(M + f * C, M, M + f * C, M + 4 * C)); g.push(L(M + f * C, M + 5 * C, M + f * C, M + 9 * C)); }
    }
    for (const y0 of [0, 7]) { g.push(L(M + 3 * C, M + y0 * C, M + 5 * C, M + (y0 + 2) * C)); g.push(L(M + 5 * C, M + y0 * C, M + 3 * C, M + (y0 + 2) * C)); }
    return g.join('');
  })();
  function render(svg, board, mv) {
    const parts = [GRID];
    if (mv) {
      const { from, to } = sq(mv.u), f = pt(from), t = pt(to);
      parts.push('<circle cx="' + f.x + '" cy="' + f.y + '" r="13.4" fill="rgba(250,204,21,0.22)" stroke="rgba(180,83,9,0.55)" stroke-width="1.05"/>');
      if (mv.c) {
        parts.push('<circle cx="' + t.x + '" cy="' + t.y + '" r="14.5" fill="rgba(224,138,30,0.18)" stroke="#e08a1e" stroke-width="2.6"/>');
        for (const g of mv.g) { const c = pt(g.slice(1)); parts.push('<circle cx="' + c.x + '" cy="' + c.y + '" r="12.5" fill="none" stroke="#e08a1e" stroke-width="2" opacity=".9"/>'); }
      } else {
        parts.push('<circle cx="' + t.x + '" cy="' + t.y + '" r="14.5" fill="none" stroke="#d6af4e" stroke-width="2.05" style="filter:drop-shadow(0 0 1px rgba(70,45,8,0.5))"/>');
      }
    }
    for (const s in board) {
      const p = board[s], c = pt(s), k = PIECE / 100, fr = FRAME[p.role], x = c.x - PIECE / 2, y = c.y - PIECE / 2;
      const rank = Number(s.slice(1)), crossed = p.role === 'soldier' && (p.color === 'red' ? rank >= 6 : rank <= 5);
      parts.push('<circle cx="' + c.x + '" cy="' + c.y + '" r="' + (46 * k) + '" fill="#fef0d7" stroke="' + (p.color === 'red' ? '#c30d0d' : '#202427') + '" stroke-width="' + (2.8 * k) + '"/>');
      parts.push('<image href="' + ART + p.color + '-' + (crossed ? 'crossed-soldier' : p.role) + '.png" x="' + (x + fr.x * k) + '" y="' + (y + fr.y * k) + '" width="' + (fr.w * k) + '" height="' + (fr.w * k) + '" preserveAspectRatio="xMidYMid meet"/>');
    }
    svg.innerHTML = parts.join('');
  }
  function countPieces(board) { let red = 0, black = 0; for (const s in board) { if (board[s].color === 'red') red++; else black++; } return { red, black }; }
  const numbered = (ply, s) => (Math.floor((ply - 1) / 2) + 1) + (ply % 2 === 1 ? '. ' : '... ') + s;
  const NAME = { K: 'general', A: 'advisor', E: 'elephant', H: 'horse', R: 'chariot', C: 'cannon', P: 'soldier' };
  function mount(root) {
    const id = root.id;
    const $ = (suffix) => root.querySelector('#' + id + '-' + suffix);
    const GAMES = JSON.parse($('data').textContent);
    const svg = $('board');
    let gi = 0, at = 0;
    function show() {
      const game = GAMES[gi], mv = at > 0 ? game.moves[at - 1] : null, board = parsePlacement(at > 0 ? mv.p : game.start);
      render(svg, board, mv);
      const { red, black } = countPieces(board);
      $('count-red').textContent = T('pieces', red); $('count-black').textContent = T('pieces', black);
      $('pos').textContent = at + ' / ' + game.moves.length;
      const cap = $('caption');
      if (!mv) cap.innerHTML = '<span class="who">' + T('cap-start') + '</span>';
      else {
        const note = N(game.id, at);
        let who = T(mv.m === 'r' ? 'red' : 'black') + (mv.c ? T('taking-' + mv.c) : '');
        if (mv.c) who += mv.g.length ? T('blast-gone', mv.g.map((g) => NAME[g[0]] + ' ' + g.slice(1)).join(', ')) : T('blast-none');
        if (mv.k) who += T('check');
        cap.innerHTML = '<span class="san">' + numbered(at, mv.s) + '</span> <span class="who">' + who + '.</span>' + (note ? '<p>' + note + '</p>' : '');
      }
      root.querySelectorAll('.anxq-moves button').forEach((b) => b.classList.toggle('cur', Number(b.dataset.ply) === at));
      const cur = root.querySelector('.anxq-moves button.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
      $('prev').disabled = at === 0; $('first').disabled = at === 0;
      $('next').disabled = at === game.moves.length; $('last').disabled = at === game.moves.length;
    }
    const startAt = Number(root.dataset.start || 0);
    function select(i) {
      gi = i;
      const game = GAMES[gi];
      at = Math.min(startAt, game.moves.length);
      const more = $('more'); if (more) more.value = String(i);
      $('header').textContent = F(game.label);
      $('seat-red').textContent = F(game.red); $('seat-black').textContent = F(game.black);
      const list = $('moves'); list.innerHTML = '';
      game.moves.forEach((m, k) => {
        if (k % 2 === 0) { const n = document.createElement('span'); n.className = 'n'; n.textContent = String(k / 2 + 1); list.appendChild(n); }
        const b = document.createElement('button'); b.textContent = m.s; b.dataset.ply = k + 1; b.className = m.c ? 'blast' : ''; b.addEventListener('click', () => { at = k + 1; show(); }); list.appendChild(b);
      });
      $('result').textContent = F(game.result);
      show();
    }
    const more = $('more');
    let og = null, group = null;
    GAMES.forEach((g, i) => {
      const gk = F(g.group);
      if (gk !== group) { group = gk; og = document.createElement('optgroup'); og.label = group; more.appendChild(og); }
      const o = document.createElement('option'); o.value = String(i); o.textContent = F(g.label); og.appendChild(o);
    });
    more.addEventListener('change', (e) => select(Number(e.target.value)));
    $('first').addEventListener('click', () => { at = 0; show(); });
    $('prev').addEventListener('click', () => { if (at > 0) { at--; show(); } });
    $('next').addEventListener('click', () => { if (at < GAMES[gi].moves.length) { at++; show(); } });
    $('last').addEventListener('click', () => { at = GAMES[gi].moves.length; show(); });
    root.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT') return;
      if (e.key === 'ArrowRight') { if (at < GAMES[gi].moves.length) { at++; show(); } e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { if (at > 0) { at--; show(); } e.preventDefault(); }
    });
    select(0);
  }
  document.querySelectorAll('[data-anxq]').forEach((root) => { if (root.dataset.mounted) return; root.dataset.mounted = '1'; mount(root); });
})();
</script>`;
  emit('atomic-xq-games.html', `${WIDGET_CSS}\n${widgetHtml}${WIDGET_JS}\n`);
  blogArt.add('xiangqi/international/red-crossed-soldier.png');
  blogArt.add('xiangqi/international/black-crossed-soldier.png');
  for (const role of ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier'])
    for (const color of ['red', 'black']) blogArt.add(`xiangqi/international/${color}-${role}.png`);

  for (const rel of blogArt) {
    const bytes = readFileSync(path.join(PUBLIC, 'piece-sets', rel));
    writeFileSync(path.join(BLOG_ASSETS, 'pieces', rel.replace(/\//g, '-')), bytes);
  }
  console.log(`  assets/posts/atomic-xiangqi/pieces/ (${blogArt.size} files)`);

  // The cards: the red general in a blast ring, the black cannon that fired.
  const { renderXiangqiPieceGlyphed } = await import('../apps/web/src/xiangqi-piece-sets.js');
  const card = (width: number, height: number, size: number) => {
    const gap = Math.round(size * 0.18);
    const x0 = (width - (size * 2 + gap)) / 2;
    const y = (height - size) / 2;
    return [
      `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Atomic Xiangqi">`,
      `<rect width="${width}" height="${height}" fill="#d9bd82"/>`,
      `<circle cx="${x0 + size / 2}" cy="${y + size / 2}" r="${size * 0.62}" fill="none" stroke="#e08a1e" stroke-width="${Math.max(3, size * 0.07)}"/>`,
      renderXiangqiPieceGlyphed({ role: 'general', color: 'red' }, 'international', {
        x: x0,
        y,
        size,
      }),
      renderXiangqiPieceGlyphed({ role: 'cannon', color: 'black' }, 'international', {
        x: x0 + size + gap,
        y,
        size,
      }),
      '</svg>',
    ].join('');
  };
  const renderPng = (svg: string, file: string, width: number) => {
    const inlined = localArt(svg); // data URIs; resvg cannot fetch
    const png = new Resvg(inlined, { fitTo: { mode: 'width', value: width } }).render().asPng();
    writeFileSync(path.join(BLOG_ASSETS, file), png);
    console.log(`  assets/posts/atomic-xiangqi/${file} (${(png.length / 1024).toFixed(0)} kB)`);
  };
  renderPng(card(160, 100, 60), 'thumbnail.png', 640);
  renderPng(card(120, 63, 36), 'social-card.png', 1200);
}
