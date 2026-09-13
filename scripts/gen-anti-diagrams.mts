// Render the Anti Xiangqi figures for the variant-lab write-up with
// MISTBOARD'S OWN diagram functions (the pattern of gen-duck-diagrams.mts and
// gen-atomic-diagrams.mts), so the boards match every other article.
//
//   npx tsx scripts/gen-anti-diagrams.mts [outDir] [--blog]
//
// Every position is computed through the lab's rule kernel at the stock point
// (mustCapture, non-royal general, lose everything). Every claim a caption
// makes (which replies are legal, which line the proof follows, how many
// defender replies a proof node covers) is read from the kernel, the exit
// sweep and the proof certificates in docs-private, and asserted here before
// a file is written.
//
// Output (default docs-private/variant-lab/anti-xiangqi/figures/):
//   <slug>.svg        standalone SVGs: styles inlined, piece art as data URIs
//   index.html        every figure with its caption, for reading the draft
// With --blog: _includes/anti-xq-<slug>.html in the blog repo, piece art
// under assets/posts/anti-xiangqi/pieces, and the two card images.

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const { createXiangqiRuleKernel } = await import('../packages/game/src/xiangqi-rule-kernel.js');
const { parseRuleArgs, resolveRules } = await import('./variant-lab/lab/rules.js');
const { antiXiangqiKernelConfig, antiXiangqiVariant } = await import(
  './variant-lab/lab/variants/anti-xiangqi.js'
);
type XiangqiBoard = import('@mistboard/game').XiangqiBoard;
type XiangqiSquare = import('@mistboard/game').XiangqiSquare;
type XiangqiPiece = import('@mistboard/game').XiangqiPiece;
type RuleState = import('../packages/game/src/xiangqi-rule-kernel.js').XiangqiRuleState;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = path.dirname(
  execSync('git rev-parse --path-format=absolute --git-common-dir', {
    cwd: HERE,
    encoding: 'utf8',
  }).trim(),
);
const DOCS = path.join(MAIN_ROOT, 'docs-private/variant-lab/anti-xiangqi');
const OUTDIR = path.join(MAIN_ROOT, 'docs-private/variant-lab/out/anti-xiangqi');
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const OUT = outArg ? path.resolve(outArg) : path.join(DOCS, 'figures');
const PUBLIC = path.join(HERE, '../apps/web/public');
const CSS = path.join(HERE, '../apps/web/src/articles.css');

// ── The kernel, at the stock point ─────────────────────────────────────────

const kernel = createXiangqiRuleKernel(
  antiXiangqiKernelConfig(resolveRules(antiXiangqiVariant.ruleSchema, parseRuleArgs([]))),
);
const ROLE_LETTER: Record<string, string> = {
  general: 'K',
  advisor: 'A',
  elephant: 'E',
  horse: 'H',
  chariot: 'R',
  cannon: 'C',
  soldier: 'P',
};

function replay(moves: readonly string[]): RuleState {
  let s = kernel.initial('fig');
  for (const m of moves) {
    const mv = kernel.fromUci(s, m);
    if (!mv) throw new Error(`bad move ${m} after ${moves.join(' ')}`);
    s = kernel.apply(s, mv);
  }
  return s;
}
function legalUci(s: RuleState): string[] {
  return kernel.legalMoves(s).map((m) => `${m.from}${m.to}`);
}
/** Chess-style short notation: piece letter, x on capture, destination; a file letter when another piece of the role could reach it. */
function san(s: RuleState, uci: string): string {
  const mv = kernel.fromUci(s, uci);
  if (!mv) throw new Error(`bad move ${uci}`);
  const piece = s.board[mv.from];
  if (!piece) throw new Error(`no piece on ${mv.from}`);
  const others = kernel
    .legalMoves(s)
    .filter((m) => m.to === mv.to && m.from !== mv.from && s.board[m.from]?.role === piece.role);
  const dis = others.length > 0 ? mv.from[0] : '';
  return `${ROLE_LETTER[piece.role]}${dis}${s.board[mv.to] ? 'x' : ''}${mv.to}`;
}
/** A line in short notation with move numbers, from the array. */
function sanLine(moves: readonly string[]): string {
  let s = kernel.initial('san');
  const out: string[] = [];
  moves.forEach((m, i) => {
    const label = san(s, m);
    out.push(i % 2 === 0 ? `${i / 2 + 1}. ${label}` : label);
    s = kernel.apply(s, kernel.fromUci(s, m)!);
  });
  return out.join(' ');
}
function pieceCount(s: RuleState, color: 'red' | 'black'): number {
  return Object.values(s.board).filter((p) => p?.color === color).length;
}
function board(s: RuleState): XiangqiBoard {
  return s.board as XiangqiBoard;
}
/** Split a UCI move into from/to (files a-i, ranks 1-10). */
function squares(uci: string): { from: XiangqiSquare; to: XiangqiSquare } {
  const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(uci);
  if (!m) throw new Error(`bad uci ${uci}`);
  return { from: m[1] as XiangqiSquare, to: m[2] as XiangqiSquare };
}

// ── Data: the sweep and the proofs ─────────────────────────────────────────

type Row = {
  leaf: number;
  exitPly: number;
  opening: string;
  winner: 'red' | 'black' | null;
  reason: string;
  afterExit: number;
};
type ProofTree = { move: string; replies?: ProofTree[] };
type Outcome = {
  leaf: number;
  opening: string;
  attacker: 'red' | 'black';
  result: string;
  proofSize?: number;
  line?: string[];
  proof?: { toMove: string; children: ProofTree[] };
};
const sweep = JSON.parse(readFileSync(path.join(OUTDIR, 'exits-100k-stock.json'), 'utf8')) as {
  nodes: number;
  rows: Row[];
};
const proofs = JSON.parse(readFileSync(path.join(OUTDIR, 'proofs-100k-stock.json'), 'utf8')) as {
  outcomes: Outcome[];
};
const DECISIVE = new Set([
  'extinction',
  'stalemate',
  'checkmate',
  'bare-general',
  'general-lost',
  'general-captured',
]);
const MIRROR: Record<string, string> = {
  a: 'i',
  b: 'h',
  c: 'g',
  d: 'f',
  e: 'e',
  f: 'd',
  g: 'c',
  h: 'b',
  i: 'a',
};
const mirror = (line: string) => line.replace(/[a-i]/g, (c) => MIRROR[c]!);
const exitValue = new Map<string, 'red' | 'black' | 'draw'>();
for (const r of sweep.rows)
  exitValue.set(r.opening, DECISIVE.has(r.reason) ? (r.winner as 'red' | 'black') : 'draw');
const valueOfLine = (line: string[]) =>
  exitValue.get(line.join(' ')) ?? exitValue.get(mirror(line.join(' '))) ?? 'draw';
const provenSet = new Set(
  proofs.outcomes.filter((o) => o.result === 'proven').map((o) => o.opening),
);
const isProven = (line: string[]) =>
  provenSet.has(line.join(' ')) || provenSet.has(mirror(line.join(' ')));

// ── SVG plumbing (as gen-atomic-diagrams.mts) ──────────────────────────────

function diagramStyles(collapseVars: boolean): string {
  const css = readFileSync(CSS, 'utf8');
  const out: string[] = [];
  for (const m of css.matchAll(/\.xq-article-svg (\.xq-diagram-[a-z-]+)\s*\{([^}]*)\}/g)) {
    out.push(`${m[1]}{${m[2].trim().replace(/\s+/g, ' ')}}`);
  }
  if (out.length === 0) throw new Error('no .xq-diagram-* rules found in articles.css');
  let joined = out.join('');
  if (!collapseVars) return `<style>${joined}</style>`;
  for (let i = 0; i < 4; i += 1)
    joined = joined.replace(/var\(--[a-z0-9-]+,\s*([^()]*(?:\([^()]*\))?[^()]*)\)/g, '$1');
  return `<style>${joined}.xq-diagram-title{fill:#4b3c2a}</style>`;
}
const STYLES = diagramStyles(true);
const BLOG_STYLES = diagramStyles(false);
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
function demoState(id: string, b: XiangqiBoard) {
  return xqVisionDemoState(id, b as Partial<Record<XiangqiSquare, XiangqiPiece>>);
}
/** An amber ring on a point: "the move that loses" or "the piece that will be taken". */
function ring(square: XiangqiSquare, x0: number, y0: number, color = '#e08a1e', r = 19): string {
  const { file, rank } = xqCoord(square);
  const { x, y } = xqPoint(file, rank, 'red', x0, y0 + BOARD_Y);
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="3.5" opacity="0.95"/>`;
}
type BoardSpec = {
  id: string;
  board: XiangqiBoard;
  label: string;
  arrows?: Array<{ from: XiangqiSquare; to: XiangqiSquare }>;
  dots?: Array<{ square: XiangqiSquare; blocked?: boolean; capture?: boolean }>;
  rings?: Array<{ square: XiangqiSquare; color?: string }>;
  zones?: boolean;
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
          state: demoState(s.id, s.board),
          x,
          y: 0,
          label: s.label,
          perspective: 'red',
          arrows: s.arrows,
          dots: s.dots,
          zones: s.zones,
          overlay: s.rings?.map((r) => ring(r.square, x, 0, r.color)).join(''),
        });
      })
      .join(''),
  );
}
const figures: Array<{
  slug: string;
  caption: string;
  svg: string;
  single: boolean;
  wide?: boolean;
}> = [];
function figure(slug: string, svg: string, caption: string, single = false): void {
  const out = `<!-- Generated by scripts/gen-anti-diagrams.mts in the mistboard repo. Do not hand-edit. -->\n${localArt(svg).replace('<g transform', `${STYLES}<g transform`)}`;
  writeFileSync(path.join(OUT, `${slug}.svg`), `${out}\n`);
  figures.push({ slug, caption, svg, single });
  console.log(`  figures/${slug}.svg`);
}
mkdirSync(OUT, { recursive: true });

// ── 1. Black's first decision ──────────────────────────────────────────────

const AFTER_1 = replay(['b3b10']);
const black1 = legalUci(AFTER_1).sort();
if (black1.join() !== ['a10b10', 'h8h1'].join())
  throw new Error(`Black's replies to 1. Cxb10 are ${black1.join(',')}`);
const RECAPTURE = ['b3b10', 'a10b10', 'h3h10', 'i10h10'];
if (valueOfLine(RECAPTURE) !== 'red' || !isProven(RECAPTURE))
  throw new Error('the chariot recapture should be a proven Red win');
const HOLDS_1 = ['b3b10', 'h8h1'];
figure(
  'decision-1',
  boards([
    {
      id: 'd1-before',
      board: board(AFTER_1),
      label: `1. Cxb10: BLACK HAS TWO CAPTURES`,
      arrows: [
        { from: 'a10', to: 'b10' },
        { from: 'h8', to: 'h1' },
      ],
      rings: [
        { square: 'b10', color: '#d4351c' },
        { square: 'h1', color: '#15781B' },
      ],
    },
    {
      id: 'd1-after',
      board: board(replay(HOLDS_1)),
      label: `1...Cxh1 HOLDS`,
    },
  ]),
  'Black must capture, and has two ways. Taking the cannon back with the chariot (red ring) loses by force in 34 plies, and that loss is proven below. Firing the other cannon into Red’s back rank (green ring) starts a chain of captures and is the only move that holds.',
);

// ── 2. Red's reply, and Black's second decision ────────────────────────────

const red2 = legalUci(replay(HOLDS_1)).sort();
if (red2.join() !== ['b10d10', 'i1h1'].join())
  throw new Error(`Red's replies are ${red2.join(',')}`);
const QUIET = [...HOLDS_1, 'i1h1', 'a10b10'];
const CONTINUE = [...HOLDS_1, 'b10d10'];
const black2 = legalUci(replay(CONTINUE)).sort();
if (black2.join() !== ['e10d10', 'h1f1'].join())
  throw new Error(`Black's replies to 2. Cxd10 are ${black2.join(',')}`);
if (valueOfLine(QUIET) !== 'draw') throw new Error('2. Rxh1 Rxb10 should be a drawn exit');
if (valueOfLine([...CONTINUE, 'e10d10', 'i1h1']) !== 'draw')
  throw new Error('2...Kxd10 3. Rxh1 should be a drawn exit');
// 2...Cxf1 loses: every Red continuation the sweep valued from there.
const greedy = [...CONTINUE, 'h1f1'];
const greedyReplies = legalUci(replay(greedy));
if (
  !greedyReplies.some(
    (r) => valueOfLine([...greedy, r]) === 'red' || legalUci(replay([...greedy, r])).length > 0,
  )
)
  throw new Error('2...Cxf1 should give Red something');
figure(
  'decision-2',
  boards([
    {
      id: 'd2-quiet',
      board: board(replay(QUIET)),
      label: `2. Rxh1 Rxb10: THE EXCHANGE ENDS`,
    },
    {
      id: 'd2-continue',
      board: board(replay(CONTINUE)),
      label: `2. Cxd10: BLACK DECIDES AGAIN`,
      arrows: [
        { from: 'e10', to: 'd10' },
        { from: 'h1', to: 'f1' },
      ],
      rings: [
        { square: 'd10', color: '#15781B' },
        { square: 'f1', color: '#d4351c' },
      ],
    },
  ]),
  'Red has two replies and both hold. The quiet recapture 2. Rxh1 (left, after Black’s forced 2...Rxb10) ends the exchange with equal material. Continuing with 2. Cxd10 (right) sets Black a second trap: taking the cannon with the general, 2...Kxd10, holds and 3. Rxh1 ends the exchange; the greedy 2...Cxf1 loses.',
);

// ── 3. The position both sides reach ───────────────────────────────────────

const survivor = replay(QUIET);
if (pieceCount(survivor, 'red') !== pieceCount(survivor, 'black'))
  throw new Error('the surviving exit should have equal material');
const COUSIN = [...CONTINUE, 'e10d10', 'i1h1'];
const cousin = replay(COUSIN);
if (kernel.legalMoves(cousin).some((m) => cousin.board[m.to] !== undefined))
  throw new Error('the cousin ending should have no capture available');
if ((cousin.status as { turn: string }).turn !== 'black')
  throw new Error('the cousin ending should have Black to move');
figure(
  'survivor',
  boards([
    { id: 'survivor', board: board(survivor), label: `AFTER ${sanLine(QUIET)}` },
    { id: 'cousin', board: board(cousin), label: `AFTER ${sanLine(COUSIN)}` },
  ]),
  `The two endings that survive the chain. Left: four plies in, Red to move. Right: five plies in, Black to move, the general having taken a cannon on d10 instead of the chariot taking it on h1. ${pieceCount(survivor, 'red')} pieces each in both, no capture on the board, nobody has lost yet. From the left one the engine, playing both sides at one, two and five million nodes a move, drew every game.`,
);

// ── 4. How a forced loss works ─────────────────────────────────────────────

const P = proofs.outcomes.find((o) => o.opening === RECAPTURE.join(' '));
if (!P?.line || !P.proof) throw new Error('no proof for the chariot recapture');
const pline = P.line;
// Walk the certificate along the principal line to count the replies covered at each defender node.
const covered: number[] = [];
let children = P.proof.children;
for (let i = 0; i < pline.length && children.length > 0; i += 2) {
  const atk = children.find((c) => c.move === pline[i]);
  if (!atk) throw new Error(`certificate lacks ${pline[i]} at step ${i}`);
  covered.push((atk.replies ?? []).length);
  const rep = (atk.replies ?? []).find((c) => c.move === pline[i + 1]);
  children = rep?.replies ?? [];
}
if (covered[0] !== 42 || covered[1] !== 1 || covered[2] !== 1 || covered[3] !== 1)
  throw new Error(
    `proof coverage along the line is ${covered.slice(0, 4).join(',')}; the caption says 42, 1, 1, 1`,
  );
const s4 = replay(RECAPTURE);
const s6 = replay([...RECAPTURE, ...pline.slice(0, 4)]);
if (legalUci(replay([...RECAPTURE, ...pline.slice(0, 3)])).join() !== 'b8b1')
  throw new Error('after 4. Rb2 Black should have exactly one legal move, Cxb1');
const dumpSan = (n: number) => san(replay([...RECAPTURE, ...pline.slice(0, n)]), pline[n]!);
figure(
  'dump-mechanism-1',
  boards([
    {
      id: 'dump-1',
      board: board(s4),
      label: `3. ${dumpSan(0)}: 42 FREE REPLIES`,
      arrows: [squares(pline[0]!)],
    },
    {
      id: 'dump-2',
      board: board(replay([...RECAPTURE, ...pline.slice(0, 2)])),
      label: `4. ${dumpSan(2)}: ONLY Cxb1`,
      arrows: [squares(pline[2]!), squares('b8b1')],
      rings: [{ square: 'b1', color: '#e08a1e' }],
    },
  ]),
  `After ${sanLine(RECAPTURE)}. Each board shows the moves about to be played. Red\u2019s first move, 3. Ra2, is quiet, so Black may play anything: 42 legal replies, and the certificate answers every one. Along the main line, 4. Rb2 then leaves Black exactly one legal move, the cannon taking the horse on b1.`,
);
figure(
  'dump-mechanism-2',
  boards([
    {
      id: 'dump-3',
      board: board(s6),
      label: `5. ${dumpSan(4)} ${san(replay([...RECAPTURE, ...pline.slice(0, 5)]), pline[5]!)}: BOTH FORCED`,
      arrows: [squares(pline[4]!), squares(pline[5]!)],
    },
    {
      id: 'dump-4',
      board: board(replay([...RECAPTURE, ...pline.slice(0, 6)])),
      label: `6. ${dumpSan(6)}: ONLY Rxc1`,
      arrows: [squares(pline[6]!), squares(pline[7]!)],
      rings: [{ square: 'c1', color: '#e08a1e' }],
    },
  ]),
  `5. Rxb1 Rxb1 are both compelled. Then 6. Ke2, another quiet move, leaves Black\u2019s chariot exactly one capture again, the elephant on c1. Red feeds its pieces to that chariot one at a time, on Red\u2019s schedule, until Red has none: 30 plies, ${P.proofSize} positions in the certificate.`,
);

// ── 5. The dead position ───────────────────────────────────────────────────

const DEAD = kernel.parseFen('4ka3/4a4/4b4/9/9/9/9/9/4A4/4K4 w - - 0 1', 'dead');
if (!DEAD) throw new Error('dead position unparseable');
if (legalUci(DEAD).some((u) => DEAD.board[squares(u).to] !== undefined))
  throw new Error('the dead position should have no capture');
figure(
  'dead',
  boards([
    {
      id: 'dead',
      board: board(DEAD),
      label: 'THE DEAD BOARD',
      zones: true,
    },
  ]),
  'Reached by the engine at ply 35 of a game from the array. Generals and advisors never leave the palace; elephants never cross the river. No piece on this board can ever reach another, so under the rules as written the game runs to a repetition draw.',
  true,
);

// ── 6. The whole cascade, and exits by depth (data figures) ────────────────

const INK = '#4b3c2a';
const RED = '#c8402f';
const BLACK = '#2a2724';
const GOLD = '#c9931f';
const MUTED = '#8a7a63';
const FONT = 'system-ui, sans-serif';
function dataSvg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" font-family="${FONT}"><rect width="${width}" height="${height}" fill="#faf6ee"/>${body}</svg>`;
}
function text(
  x: number,
  y: number,
  t: string,
  o: { size?: number; anchor?: string; fill?: string; weight?: number } = {},
): string {
  return `<text x="${x}" y="${y}" text-anchor="${o.anchor ?? 'start'}" font-size="${o.size ?? 13}" fill="${o.fill ?? INK}" font-weight="${o.weight ?? 400}">${t}</text>`;
}
{
  type TNode = { line: string[]; depth: number; children: TNode[]; x: number; leaf: boolean };
  const build = (s: RuleState, line: string[]): TNode => {
    const captures = kernel.legalMoves(s).filter((m) => s.board[m.to] !== undefined);
    const node: TNode = {
      line,
      depth: line.length,
      children: [],
      x: 0,
      leaf: captures.length === 0,
    };
    for (const m of captures)
      node.children.push(build(kernel.apply(s, m), [...line, `${m.from}${m.to}`]));
    return node;
  };
  const root = build(kernel.initial('tree'), []);
  let next = 0;
  const place = (n: TNode) => {
    if (n.children.length === 0) {
      n.x = next;
      next += 1;
      return;
    }
    for (const c of n.children) place(c);
    n.x = n.children.reduce((a, c) => a + c.x, 0) / n.children.length;
  };
  place(root);
  if (next !== 166) throw new Error(`tree has ${next} exits`);
  const W = 1200;
  const H = 580;
  const left = 30;
  const right = 250;
  const top = 44;
  const sx = (W - left - right) / (next - 1);
  const sy = (H - top - 70) / 18;
  const px = (n: TNode) => left + n.x * sx;
  const py = (n: TNode) => top + n.depth * sy;
  const surviving = [QUIET.join(' '), [...CONTINUE, 'e10d10', 'i1h1'].join(' ')];
  const onRoad = (n: TNode) => {
    const key = n.line.join(' ');
    return surviving.some(
      (s) =>
        s === key ||
        s.startsWith(`${key} `) ||
        mirror(s) === key ||
        mirror(s).startsWith(`${key} `),
    );
  };
  const edges: string[] = [];
  const dots: string[] = [];
  const walk = (n: TNode) => {
    for (const c of n.children) {
      const road = onRoad(c) && onRoad(n);
      edges.push(
        `<line x1="${px(n)}" y1="${py(n)}" x2="${px(c)}" y2="${py(c)}" stroke="${road ? GOLD : '#d8ccb4'}" stroke-width="${road ? 3 : 1}"/>`,
      );
      walk(c);
    }
    if (n.leaf) {
      const v = valueOfLine(n.line);
      const fill = v === 'red' ? RED : v === 'black' ? BLACK : GOLD;
      const proven = isProven(n.line);
      dots.push(
        `<circle cx="${px(n)}" cy="${py(n)}" r="${proven ? 4.5 : 3}" fill="${fill}"${proven ? '' : ' opacity="0.5"'}/>`,
      );
    } else if (n.line.length > 0) {
      dots.push(`<circle cx="${px(n)}" cy="${py(n)}" r="1.6" fill="${MUTED}"/>`);
    }
  };
  walk(root);
  // Labels along the road on the b3b10 half (the left edge).
  const find = (line: string[]): TNode | null => {
    let n: TNode | null = root;
    for (const m of line) {
      n = n?.children.find((c) => c.line[c.line.length - 1] === m) ?? null;
      if (!n) return null;
    }
    return n;
  };
  const roadLabels: string[] = [];
  const labelAt = (line: string[], label: string, dx: number) => {
    const n = find(line);
    if (!n) throw new Error(`no node for ${line.join(' ')}`);
    roadLabels.push(text(px(n) + dx, py(n) + 4, label, { size: 11, weight: 600, fill: GOLD }));
  };
  labelAt(['b3b10'], '1. Cxb10', 8);
  labelAt(['b3b10', 'h8h1'], '1...Cxh1', 8);
  labelAt(['b3b10', 'h8h1', 'i1h1'], '2. Rxh1', 8);
  labelAt(['b3b10', 'h8h1', 'i1h1', 'a10b10'], '2...Rxb10: holds', 8);
  labelAt(['b3b10', 'a10b10', 'h3h10', 'i10h10'], '1...Rxb10: loses', 8);
  const rootLabel = text(px(root), py(root) - 8, 'start', {
    anchor: 'middle',
    size: 11,
    fill: MUTED,
  });
  const rowNote = text(
    W - right + 6,
    top + 14 * sy + 4,
    'ply 14: 72 endings, Red to move, all Red wins',
    { size: 10, fill: RED },
  );
  const legend = [
    `<circle cx="${left + 6}" cy="${H - 34}" r="4.5" fill="${RED}"/>`,
    text(left + 16, H - 30, 'Red wins from here', { size: 11, fill: MUTED }),
    `<circle cx="${left + 156}" cy="${H - 34}" r="4.5" fill="${BLACK}"/>`,
    text(left + 166, H - 30, 'Black wins', { size: 11, fill: MUTED }),
    `<circle cx="${left + 256}" cy="${H - 34}" r="4.5" fill="${GOLD}"/>`,
    text(left + 266, H - 30, 'stall (a draw)', { size: 11, fill: MUTED }),
    `<circle cx="${left + 366}" cy="${H - 34}" r="4.5" fill="${RED}"/><circle cx="${left + 380}" cy="${H - 34}" r="3" fill="${RED}" opacity="0.5"/>`,
    text(left + 390, H - 30, 'large: proven; small: engine verdict', { size: 11, fill: MUTED }),
    `<line x1="${left + 600}" y1="${H - 34}" x2="${left + 630}" y2="${H - 34}" stroke="${GOLD}" stroke-width="3"/>`,
    text(left + 638, H - 30, 'the two lines that hold', { size: 11, fill: MUTED }),
  ].join('');
  const body = [
    ...edges,
    ...dots,
    ...[4, 6, 8, 10, 12, 16, 18].map((d) =>
      text(W - right + 6, top + d * sy + 4, `ply ${d}`, { size: 10, fill: MUTED }),
    ),
    rowNote,
    rootLabel,
    ...roadLabels,
    text(
      left,
      20,
      'The opening chain. One ply per row, every ply a capture; a line branches where a player chose between captures and stops where captures ran out.',
      { size: 13, weight: 600 },
    ),
    legend,
  ].join('');
  const svg = dataSvg(W, H, body);
  writeFileSync(path.join(OUT, 'cascade-tree.svg'), `${svg}\n`);
  figures.push({
    slug: 'cascade-tree',
    caption:
      'The whole cascade: 166 endings, each coloured by who wins from it. Large dots are proven; the gold paths are the two lines that hold.',
    svg,
    single: false,
    wide: true,
  });
  console.log('  figures/cascade-tree.svg');
}
{
  const byDepth = new Map<number, { red: number; black: number; draw: number }>();
  for (const r of sweep.rows) {
    const d = byDepth.get(r.exitPly) ?? { red: 0, black: 0, draw: 0 };
    d[exitValue.get(r.opening)!] += 1;
    byDepth.set(r.exitPly, d);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const W = 720;
  const H = 330;
  const left = 50;
  const bottom = H - 56;
  const maxN = Math.max(
    ...depths.map((d) => {
      const v = byDepth.get(d)!;
      return v.red + v.black + v.draw;
    }),
  );
  const scaleY = (bottom - 44) / maxN;
  const bw = (W - left - 24) / depths.length;
  const b: string[] = [];
  for (let n = 0; n <= maxN; n += 6) {
    const y = bottom - n * scaleY;
    b.push(
      `<line x1="${left}" y1="${y}" x2="${W - 16}" y2="${y}" stroke="#e6dcc8" stroke-width="1"/>`,
    );
    b.push(text(left - 8, y + 4, String(n), { anchor: 'end', size: 11, fill: MUTED }));
  }
  depths.forEach((d, i) => {
    const v = byDepth.get(d)!;
    const x = left + i * bw + bw * 0.15;
    let y = bottom;
    for (const [k, color] of [
      ['red', RED],
      ['black', BLACK],
      ['draw', GOLD],
    ] as const) {
      const h = v[k] * scaleY;
      if (h > 0)
        b.push(`<rect x="${x}" y="${y - h}" width="${bw * 0.7}" height="${h}" fill="${color}"/>`);
      y -= h;
    }
    b.push(text(x + bw * 0.35, bottom + 16, String(d), { anchor: 'middle', size: 12 }));
    b.push(
      text(x + bw * 0.35, bottom + 31, d % 2 === 0 ? 'Red' : 'Black', {
        anchor: 'middle',
        size: 10,
        fill: MUTED,
      }),
    );
  });
  b.push(
    text(left, 22, 'The 83 distinct endings by depth, coloured by who wins from there', {
      size: 13,
      weight: 600,
    }),
  );
  b.push(
    text(
      left,
      H - 8,
      'Under each depth: who has the first free move there. Red bars, Red wins; black, Black wins; gold, a stall.',
      { size: 11, fill: MUTED },
    ),
  );
  const svg = dataSvg(W, H, b.join(''));
  writeFileSync(path.join(OUT, 'exits-by-depth.svg'), `${svg}\n`);
  figures.push({
    slug: 'exits-by-depth',
    caption:
      'Endings by depth. Whoever has the first free move at an ending wins from it: every ply-14 ending is a Red win, every ply-17 ending a Black win.',
    svg,
    single: false,
    wide: true,
  });
  console.log('  figures/exits-by-depth.svg');
}

// ── 7. The tree as data (for the explorer) and as a poster with mini boards ─

type XNode = {
  i: number;
  p: number;
  u: string;
  s: string;
  m: 'r' | 'b' | '';
  d: number;
  leaf: boolean;
  v: 'r' | 'b' | 'd';
  n: number;
  pv: number;
  pr: boolean;
  g: string;
  mirror: boolean;
  line: string[];
  x: number;
  children: number[];
  state: RuleState;
};
const xnodes: XNode[] = [];
{
  const leafIdByLine = new Map<string, number>();
  for (const r of sweep.rows) leafIdByLine.set(r.opening, r.leaf);
  const add = (
    st: RuleState,
    line: string[],
    parent: number,
    u: string,
    sanLabel: string,
    mover: 'r' | 'b' | '',
  ): number => {
    const captures = kernel.legalMoves(st).filter((mv) => st.board[mv.to] !== undefined);
    const key = line.join(' ');
    const mirrored = !leafIdByLine.has(key) && leafIdByLine.has(mirror(key));
    const node: XNode = {
      i: xnodes.length,
      p: parent,
      u,
      s: sanLabel,
      m: mover,
      d: line.length,
      leaf: captures.length === 0,
      v: 'd',
      n: 0,
      pv: 0,
      pr: false,
      g: '',
      mirror: mirrored,
      line,
      x: 0,
      children: [],
      state: st,
    };
    xnodes.push(node);
    if (node.leaf) {
      node.v = valueOfLine(line) === 'red' ? 'r' : valueOfLine(line) === 'black' ? 'b' : 'd';
      node.pr = isProven(line);
      const id = leafIdByLine.get(key) ?? leafIdByLine.get(mirror(key));
      node.g = id === undefined ? '' : `exit-${id}`;
      node.n = 1;
      node.pv = node.pr ? 1 : 0;
      return node.i;
    }
    for (const mv of captures) {
      const child = add(
        kernel.apply(st, mv),
        [...line, `${mv.from}${mv.to}`],
        node.i,
        `${mv.from}${mv.to}`,
        san(st, `${mv.from}${mv.to}`),
        (st.status as { turn: 'red' | 'black' }).turn === 'red' ? 'r' : 'b',
      );
      node.children.push(child);
    }
    const toMove = (st.status as { turn: 'red' | 'black' }).turn;
    const score = (v: 'r' | 'b' | 'd') =>
      v === (toMove === 'red' ? 'r' : 'b') ? 2 : v === 'd' ? 1 : 0;
    let best: 'r' | 'b' | 'd' = xnodes[node.children[0]!]!.v;
    for (const c of node.children) {
      const cv = xnodes[c]!.v;
      if (score(cv) > score(best)) best = cv;
      node.n += xnodes[c]!.n;
      node.pv += xnodes[c]!.pv;
    }
    node.v = best;
    return node.i;
  };
  add(kernel.initial('xtree'), [], -1, '', '', '');
  if (xnodes.filter((n) => n.leaf).length !== 166)
    throw new Error('explorer tree should have 166 leaves');
  if (xnodes[0]!.v !== 'd')
    throw new Error(`the root should be a draw under stock scoring, got ${xnodes[0]!.v}`);
  // Leaf order for the poster.
  let nextX = 0;
  const place = (i: number) => {
    const n = xnodes[i]!;
    if (n.leaf) {
      n.x = nextX;
      nextX += 1;
      return;
    }
    for (const c of n.children) place(c);
    n.x = n.children.reduce((a, c) => a + xnodes[c]!.x, 0) / n.children.length;
  };
  place(0);
}

{
  // The poster: the whole tree at a size where every ending is a dot you can
  // point at, mini boards on eight key nodes, and the story in the margins.
  const W = 2000;
  const H = 1560;
  const left = 110;
  const right = 330;
  const top = 120;
  const treeBottom = 1010;
  const sx = (W - left - right) / 165;
  const sy = (treeBottom - top) / 18;
  const px = (n: XNode) => left + n.x * sx;
  const py = (n: XNode) => top + n.d * sy;
  const roadKeys = new Set([
    '',
    'b3b10',
    'b3b10 h8h1',
    'b3b10 h8h1 i1h1',
    'b3b10 h8h1 i1h1 a10b10',
    'b3b10 h8h1 b10d10',
    'b3b10 h8h1 b10d10 e10d10',
    'b3b10 h8h1 b10d10 e10d10 i1h1',
  ]);
  const onRoad = (n: XNode) => {
    const k = n.line.join(' ');
    return roadKeys.has(k) || roadKeys.has(mirror(k));
  };
  const edges: string[] = [];
  const dots: string[] = [];
  for (const n of xnodes) {
    if (n.p >= 0) {
      const parent = xnodes[n.p]!;
      const road = onRoad(n) && onRoad(parent);
      edges.push(
        `<line x1="${px(parent)}" y1="${py(parent)}" x2="${px(n)}" y2="${py(n)}" stroke="${road ? GOLD : '#d8ccb4'}" stroke-width="${road ? 4 : 1.2}"/>`,
      );
    }
    if (n.leaf) {
      const fill = n.v === 'r' ? RED : n.v === 'b' ? BLACK : GOLD;
      dots.push(
        `<circle cx="${px(n)}" cy="${py(n)}" r="${n.pr ? 6 : 4}" fill="${fill}"${n.pr ? '' : ' opacity="0.5"'}/>`,
      );
    } else if (n.d > 0) {
      dots.push(`<circle cx="${px(n)}" cy="${py(n)}" r="2.4" fill="${MUTED}"/>`);
    }
  }
  // Mini boards: a 9x10 dot map of the position, 12px cells.
  const mini = (
    st: RuleState,
    x0: number,
    y0: number,
    title: string[],
    verdict: string,
    verdictColor: string,
  ): string => {
    const cell = 12;
    const w = 8 * cell;
    const h = 9 * cell;
    const parts: string[] = [];
    parts.push(
      `<rect x="${x0 - 8}" y="${y0 - 8}" width="${w + 16}" height="${h + 16}" rx="6" fill="#e7cc9f" stroke="#b89a68"/>`,
    );
    for (let r = 0; r < 10; r += 1)
      parts.push(
        `<line x1="${x0}" y1="${y0 + r * cell}" x2="${x0 + w}" y2="${y0 + r * cell}" stroke="#a88a5c" stroke-width="0.6"/>`,
      );
    for (let f = 0; f < 9; f += 1)
      parts.push(
        `<line x1="${x0 + f * cell}" y1="${y0}" x2="${x0 + f * cell}" y2="${y0 + h}" stroke="#a88a5c" stroke-width="0.6"/>`,
      );
    parts.push(
      `<rect x="${x0}" y="${y0 + 4 * cell}" width="${w}" height="${cell}" fill="#e7cc9f"/>`,
    );
    for (const [square, piece] of Object.entries(st.board)) {
      if (!piece) continue;
      const f = 'abcdefghi'.indexOf(square[0]!);
      const r = Number(square.slice(1));
      const cx = x0 + f * cell;
      const cy = y0 + (10 - r) * cell;
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="4.6" fill="${piece.color === 'red' ? RED : BLACK}"/>`,
      );
      if (piece.role === 'general')
        parts.push(`<circle cx="${cx}" cy="${cy}" r="1.6" fill="#fff"/>`);
    }
    title.forEach((t, i) => {
      parts.push(
        text(x0 + w / 2, y0 + h + 30 + i * 16, t, {
          anchor: 'middle',
          size: 12,
          weight: i === 0 ? 600 : 400,
          fill: i === 0 ? INK : MUTED,
        }),
      );
    });
    parts.push(
      text(x0 + w / 2, y0 + h + 30 + title.length * 16 + 2, verdict, {
        anchor: 'middle',
        size: 12,
        weight: 600,
        fill: verdictColor,
      }),
    );
    return parts.join('');
  };
  const byLine = (line: string[]) => {
    const key = line.join(' ');
    const n = xnodes.find((x) => x.line.join(' ') === key);
    if (!n) throw new Error(`poster: no node for ${key}`);
    return n;
  };
  const deepest = xnodes.filter((n) => n.leaf && n.d === 18)[0]!;
  const ply14 = xnodes.filter((n) => n.leaf && n.d === 14 && n.line[0] === 'b3b10')[0]!;
  const ply17 = xnodes.filter((n) => n.leaf && n.d === 17 && n.line[0] === 'b3b10')[0]!;
  const keys: Array<{ node: XNode; title: string[]; verdict: string; color: string }> = [
    {
      node: xnodes[0]!,
      title: ['The array', 'Red to move: two captures'],
      verdict: 'the game',
      color: MUTED,
    },
    {
      node: byLine(['b3b10']),
      title: ['1. Cxb10', 'Black: two captures'],
      verdict: 'draw with best play',
      color: GOLD,
    },
    {
      node: byLine(['b3b10', 'a10b10', 'h3h10', 'i10h10']),
      title: ['1...Rxb10 2. Cxh10 Rxh10', 'the natural recapture'],
      verdict: 'Red wins in 34, proven',
      color: RED,
    },
    {
      node: byLine(['b3b10', 'h8h1', 'i1h1', 'a10b10']),
      title: ['1...Cxh1 2. Rxh1 Rxb10', 'the exchange ends'],
      verdict: 'holds: a draw',
      color: GOLD,
    },
    {
      node: byLine(['b3b10', 'h8h1', 'b10d10', 'e10d10', 'i1h1']),
      title: ['2. Cxd10 Kxd10 3. Rxh1', 'the cousin line'],
      verdict: 'holds: a draw',
      color: GOLD,
    },
    {
      node: ply14,
      title: ['a ply-14 ending', `${sanLine(ply14.line).split(' ').slice(-3).join(' ')}`],
      verdict: 'Red to move: Red wins',
      color: RED,
    },
    {
      node: ply17,
      title: ['a ply-17 ending', `${sanLine(ply17.line).split(' ').slice(-3).join(' ')}`],
      verdict: 'Black to move: Black wins',
      color: BLACK,
    },
    {
      node: deepest,
      title: ['the deepest ending, ply 18', 'both generals gone'],
      verdict:
        deepest.v === 'd' ? 'a stall: a draw' : `${deepest.v === 'r' ? 'Red' : 'Black'} wins`,
      color: deepest.v === 'r' ? RED : deepest.v === 'b' ? BLACK : GOLD,
    },
  ];
  const boardsRow: string[] = [];
  const leaders: string[] = [];
  const slotW = (W - 160) / keys.length;
  keys.forEach((k, i) => {
    const bx = 80 + i * slotW + (slotW - 96) / 2;
    const by = 1160;
    boardsRow.push(mini(k.node.state, bx, by, k.title, k.verdict, k.color));
    const nx = px(k.node);
    const ny = py(k.node);
    leaders.push(
      `<path d="M ${bx + 48} ${by - 10} C ${bx + 48} ${by - 80}, ${nx} ${ny + 90}, ${nx} ${ny + 8}" fill="none" stroke="${k.color === MUTED ? '#b8a88c' : k.color}" stroke-width="1.6" stroke-dasharray="${k.color === GOLD ? '' : '5 4'}" opacity="0.85"/>`,
    );
    leaders.push(
      `<circle cx="${nx}" cy="${ny}" r="9" fill="none" stroke="${k.color === MUTED ? '#b8a88c' : k.color}" stroke-width="2"/>`,
    );
  });
  const rowNotes = [
    [4, 'ply 4: the two exits at either edge are the game'],
    [14, 'ply 14: 72 endings, Red to move, all Red wins'],
    [17, 'ply 17: 12 endings, Black to move, all Black wins'],
    [18, 'ply 18: 8 endings, the longest chains, mostly stalls'],
  ] as const;
  const rows = [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18].map((d) => {
    const note = rowNotes.find((r) => r[0] === d);
    return text(W - right + 14, top + d * sy + 5, note ? note[1] : `ply ${d}`, {
      size: 12,
      fill: note ? INK : MUTED,
      weight: note ? 600 : 400,
    });
  });
  const legend = [
    `<circle cx="${left + 8}" cy="${H - 40}" r="6" fill="${RED}"/>`,
    text(left + 20, H - 35, 'Red wins from this ending', { size: 14, fill: INK }),
    `<circle cx="${left + 260}" cy="${H - 40}" r="6" fill="${BLACK}"/>`,
    text(left + 272, H - 35, 'Black wins', { size: 14, fill: INK }),
    `<circle cx="${left + 400}" cy="${H - 40}" r="6" fill="${GOLD}"/>`,
    text(left + 412, H - 35, 'a stall: a draw as the rules stand', { size: 14, fill: INK }),
    `<circle cx="${left + 720}" cy="${H - 40}" r="6" fill="${RED}"/><circle cx="${left + 740}" cy="${H - 40}" r="4" fill="${RED}" opacity="0.5"/>`,
    text(left + 752, H - 35, 'large: proven; small: the engine’s verdict at 100k nodes', {
      size: 14,
      fill: INK,
    }),
    `<line x1="${left + 1180}" y1="${H - 40}" x2="${left + 1220}" y2="${H - 40}" stroke="${GOLD}" stroke-width="4"/>`,
    text(left + 1230, H - 35, 'the lines that hold', { size: 14, fill: INK }),
  ].join('');
  const body = [
    ...edges,
    ...dots,
    ...rows,
    ...leaders,
    ...boardsRow,
    text(left, 44, 'Anti xiangqi: the whole opening', { size: 30, weight: 700 }),
    text(
      left,
      76,
      'One ply per row, every ply a capture. A line forks where the player to move chose between captures and stops, with a dot, where captures ran out and the game became free. 166 endings; the two halves are mirror images.',
      { size: 15, fill: MUTED },
    ),
    text(px(xnodes[0]!), py(xnodes[0]!) - 16, 'start', { anchor: 'middle', size: 13, fill: MUTED }),
    legend,
  ].join('');
  const svg = dataSvg(W, H, body);
  writeFileSync(path.join(OUT, 'cascade-poster.svg'), `${svg}\n`);
  figures.push({
    slug: 'cascade-poster',
    caption:
      'The whole opening as a poster: every ending a dot, the lines that hold in gold, and eight positions drawn where they sit in the tree.',
    svg,
    single: false,
    wide: true,
  });
  console.log('  figures/cascade-poster.svg');
}

// ── Preview page ───────────────────────────────────────────────────────────

const html = [
  '<!doctype html><meta charset="utf-8"><title>Anti Xiangqi figures</title>',
  '<style>body{font:16px/1.5 system-ui;max-width:960px;margin:32px auto;padding:0 16px;color:#222;background:#f6f4ef}figure{margin:0 0 40px}figcaption{margin-top:8px;color:#555}img{max-width:100%;height:auto;display:block}</style>',
  '<h1>Anti Xiangqi: figures</h1><p>Generated by scripts/gen-anti-diagrams.mts through the lab rule kernel. Green ring: the move that holds. Red ring: the move that loses. Amber ring: the piece about to be taken.</p>',
  ...figures.map(
    (f) =>
      `<figure><img src="${f.slug}.svg" alt="${f.slug}"><figcaption>${f.caption}</figcaption></figure>`,
  ),
].join('\n');
writeFileSync(path.join(OUT, 'index.html'), `${html}\n`);
console.log(`  figures/index.html (${figures.length} figures)`);

// ── Blog output (--blog) ───────────────────────────────────────────────────

if (process.argv.includes('--blog')) {
  const { Resvg } = await import('@resvg/resvg-js');
  const BLOG = '/Users/brianliou/projects/brianhliou.github.io';
  const BLOG_ASSETS = path.join(BLOG, 'assets/posts/anti-xiangqi');
  const BLOG_ART = '/assets/posts/anti-xiangqi/pieces';
  const INCLUDES = path.join(BLOG, '_includes');
  mkdirSync(path.join(BLOG_ASSETS, 'pieces'), { recursive: true });
  const blogArt = new Set<string>();
  const blogArtHref = (svg: string) =>
    svg.replace(/href="\/piece-sets\/([^"?]+)\.png[^"]*"/g, (_, rel: string) => {
      blogArt.add(`${rel}.png`);
      return `href="${BLOG_ART}/${rel.replace(/\//g, '-')}.png"`;
    });
  const cropToBoard = (svg: string) =>
    svg.replace(
      /viewBox="0 0 [\d.]+ ([\d.]+)"/,
      (_, h: string) => `viewBox="0 0 ${XQ_BOARD_W + XQ_VIEWBOX_PAD * 2} ${h}"`,
    );
  // Only the figures the post still uses become includes. The decision boards
  // gave way to the explorer, the dump-mechanism pair to the proof widget and
  // the data figures (tree, depth chart, poster) to the table; all stay in
  // docs-private for the paper.
  const BLOG_FIGURES = new Set(['survivor', 'dead']);
  for (const f of figures) {
    if (f.wide || !BLOG_FIGURES.has(f.slug)) continue;
    const body = blogArtHref(f.single ? cropToBoard(f.svg) : f.svg);
    const include = [
      '<!-- Generated by scripts/gen-anti-diagrams.mts in the mistboard repo.',
      '     Do not hand-edit: re-run the generator with --blog. -->',
      `<figure class="xq-figure" data-anti-figure="${f.slug}">`,
      `  <div class="xq-figure-board" data-board="${f.single ? 'single' : 'pair'}">${BLOG_STYLES}${body}</div>`,
      `  <figcaption>${f.caption}</figcaption>`,
      '</figure>',
    ].join('\n');
    writeFileSync(path.join(INCLUDES, `anti-xq-${f.slug}.html`), `${include}\n`);
    console.log(`  _includes/anti-xq-${f.slug}.html`);
  }
  // The widgets draw a soldier past the river with the promoted art; the
  // diagrams never show one, so add it to the art set by hand.
  blogArt.add('xiangqi/international/red-crossed-soldier.png');
  blogArt.add('xiangqi/international/black-crossed-soldier.png');
  for (const rel of blogArt) {
    writeFileSync(
      path.join(BLOG_ASSETS, 'pieces', rel.replace(/\//g, '-')),
      readFileSync(path.join(PUBLIC, 'piece-sets', rel)),
    );
  }
  console.log(`  assets/posts/anti-xiangqi/pieces/ (${blogArt.size} files)`);
  // The cards: the two generals, in their discs, upside down. Same grammar as
  // the Duck tile (a tight pair of discs on the site's cream field, 3:2), the
  // rotation being the whole joke: in this game the generals are ordinary
  // pieces and everyone is trying to lose.
  // The house general art is a 1024px raster whose strokes are soft at any
  // size, so the tile draws the crown as paths traced from it (base bar,
  // pillar, two lobes, cross; 2.9-unit strokes in the 100-unit disc frame)
  // and stays sharp at 1920.
  const crown = (color: string) => {
    const st = `fill="none" stroke="${color}" stroke-width="2.9" stroke-linejoin="round" stroke-linecap="round"`;
    return [
      `<rect x="31.5" y="68.6" width="37" height="6.2" rx="2.2" ${st}/>`,
      `<path d="M45.1 68.6 V44.2 A5 5 0 0 1 55.2 44.2 V68.6" ${st}/>`,
      `<path d="M32.6 68.6 C22.8 55 23.8 39.4 36 39.4 C40.6 39.4 43.6 41.4 45.1 45.4" ${st}/>`,
      `<path d="M67.7 68.6 C77.5 55 76.5 39.4 64.3 39.4 C59.7 39.4 56.7 41.4 55.2 45.4" ${st}/>`,
      `<path d="M46.4 39.4 V34 H41.6 A1.8 1.8 0 0 1 39.8 32.2 V28.4 A1.8 1.8 0 0 1 41.6 26.6 H46.4 V23 A1.8 1.8 0 0 1 48.2 21.2 H52.1 A1.8 1.8 0 0 1 53.9 23 V26.6 H58.7 A1.8 1.8 0 0 1 60.5 28.4 V32.2 A1.8 1.8 0 0 1 58.7 34 H53.9 V39.4" ${st}/>`,
    ].join('');
  };
  const card = (width: number, height: number, size: number) => {
    const gap = Math.round(size * 0.06);
    const x0 = (width - (size * 2 + gap)) / 2;
    const y = (height - size) / 2;
    const disc = (color: 'red' | 'black', x: number) => {
      const ink = color === 'red' ? '#c30d0d' : '#202427';
      return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 100 100"><g transform="rotate(180 50 50)"><circle cx="50" cy="50" r="46" fill="#fef0d7" stroke="${ink}" stroke-width="2.8"/>${crown(ink)}</g></svg>`;
    };
    return [
      `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Anti Xiangqi">`,
      `<rect width="${width}" height="${height}" fill="#f2ede3"/>`,
      disc('red', x0),
      disc('black', x0 + size + gap),
      '</svg>',
    ].join('');
  };
  const renderPng = (svg: string, file: string, width: number) => {
    const png = new Resvg(localArt(svg), { fitTo: { mode: 'width', value: width } })
      .render()
      .asPng();
    const target = path.join(BLOG_ASSETS, file);
    writeFileSync(target, png);
    // Flat colour quantizes to nothing visible and halves the file; optional.
    try {
      execSync(
        `pngquant --force --skip-if-larger --quality 70-95 --output "${target}" "${target}"`,
        {
          stdio: 'ignore',
        },
      );
    } catch {
      /* pngquant missing or declined: the unquantized PNG stands */
    }
    console.log(
      `  assets/posts/anti-xiangqi/${file} (${(readFileSync(target).length / 1024).toFixed(0)} kB)`,
    );
  };
  // 3:2 like every tile on the site; 1920 wide because quantized 2x is cheaper
  // than unquantized 1x on flat art (the Duck tile's note has the numbers).
  renderPng(card(150, 100, 64), 'thumbnail.png', 1920);
  renderPng(card(120, 63, 40), 'social-card.png', 1200);

  // ── The games widget: the engine's games on the house board ───────────────
  // Every record was played under the kernel as referee; the page only applies
  // moves (from, to, captured) and draws. Notes are hand-written here.
  const { readdirSync } = await import('node:fs');
  const artifact = (prefix: string, pick: 'first' | 'last' = 'first') => {
    const files = readdirSync(OUTDIR)
      .filter((f) => f.startsWith(prefix))
      .sort();
    const f = pick === 'first' ? files[0] : files[files.length - 1];
    if (!f) throw new Error(`no artifact ${prefix}`);
    return JSON.parse(readFileSync(path.join(OUTDIR, f), 'utf8'));
  };
  const NOTES: Record<string, Record<number, string>> = {
    'best-2000000': {
      1: 'Cannon takes the horse over Black’s cannon. Red’s only two legal moves are this and its mirror image.',
      2: 'Black declines the chariot recapture, a proven loss, and fires the other cannon down the h-file with Red’s h3 cannon as the screen. The only move that holds.',
      3: 'The chariot takes the cannon. Continuing with 2. Cxd10, the other cannon capture, would also hold.',
      4: 'Black’s only legal move. The forced part is over: fourteen pieces each, Red to move, no capture on the board.',
      5: 'The first free move of the game. Red puts its last cannon on b3, where it screens Black’s b8 cannon onto the b1 horse: an offer Black cannot refuse.',
      6: 'Only legal move.',
      7: 'The same exchange on the other wing: chariot takes cannon, and Rxb3 will be forced in reply.',
      9: 'Both chariots are now loose on the back ranks with nothing but captures available. For the next fourteen plies each chariot has only captures to make, and the two sides shed material in step.',
      23: 'The last capture of the feast. Five pieces each: general, two advisors, an elephant, one chariot.',
      27: 'Red pulls the lever. The elephant steps to i3, on Black’s chariot’s file, where Black has no other capture: Rxi3 is compelled.',
      31: 'The chariot itself: Ri2, and Black must take it. Red now has nothing that can leave the palace.',
      33: 'The advisor steps into the chariot’s path. Black must take, and Red’s other advisor must take back.',
      35: 'Red: general and one advisor. Black: general, two advisors, an elephant. Nothing on the board can ever capture anything again.',
      44: 'Third occurrence of the position: draw by repetition. Red has fewer pieces and no way to lose them; Black has no way to make Red take anything.',
    },
    'best-5000000': {
      4: 'The same four forced plies as every game.',
      11: 'The chariots take each other’s cannons and Red’s chariot is taken in turn: eleven pieces each, and the game becomes a soldier war.',
      15: 'Red offers a soldier on i5. Black answers with a soldier on i6: now Red’s soldier must take it, and Black’s chariot must take back.',
      18: 'Two soldiers off in two compelled captures. This is the trade the rest of the game is made of: a soldier steps into another’s path, the capture is compelled, and the capturer is taken in turn.',
      38: 'A soldier taken by a soldier, then a soldier taken by an elephant. Material keeps coming off in pairs, and every capture is one the taker could not refuse.',
      89: 'Black stepped an elephant into the path of Red’s last soldier, giving it up so the soldier lands on e8, where the chariot must take it. Red has no soldiers left.',
      120: 'Red walks its general into the soldier’s path and Black must take it. Under these rules that is progress for Red; the elephant takes the soldier back, and no soldiers remain.',
      122: 'From here nothing can be forced. Black’s chariot sits on the c-file behind its own elephant, on lines none of Red’s remaining pieces can reach; Red’s advisors and elephants cannot leave their half; and either chariot could be thrown away at will. Five pieces each, and the board is as dead as the palace-only one.',
      131: 'Third occurrence of the position: draw by repetition, five pieces each, both sides shuffling an elephant and a chariot.',
    },
    'best-1000000': {
      4: 'The same four forced plies as every game.',
      127: 'Third occurrence of the position: draw by repetition. Both sides kept a chariot and neither could make the other take it.',
    },
  };
  type Rec = { id: string; group: string; label: string; moves: string[]; result: string };
  const records: Rec[] = [];
  const bestplay = artifact('bestplay-f26924937b96-') as {
    result: {
      games: Array<{
        nodes: number;
        plies: number;
        winner: string | null;
        reason: string;
        moves: string[];
      }>;
    };
  };
  for (const nodes of [2000000, 5000000, 1000000]) {
    const g = bestplay.result.games.find((x) => x.nodes === nodes);
    if (!g) throw new Error(`no ${nodes} game`);
    // The engine opens on the h-side (1. Cxh10) at every budget; the post's
    // boards are all in the 1. Cxb10 frame, so these are shown mirrored (a
    // mirror image is the same game) and say so.
    const mirrored = g.moves[0] === 'h3h10';
    records.push({
      id: `best-${nodes}`,
      group: 'Best play, engine against itself',
      label: `${nodes / 1e6}M nodes a move, ${g.plies} plies`,
      moves: mirrored ? g.moves.map((m) => mirror(m)) : g.moves,
      result: `${g.winner ? `${g.winner} wins` : 'Draw'} by ${g.reason} after ${g.plies} plies, ${nodes / 1e6} million nodes a move for both sides.${mirrored ? ' The engine opened 1. Cxh10; shown as its mirror image so the files match the boards in the post.' : ''}`,
    });
  }
  const sweepGames = JSON.parse(
    readFileSync(path.join(OUTDIR, 'exits-100k-stock.json'), 'utf8'),
  ) as { rows: Array<Row & { moves?: string[] }> };
  const withMoves = sweepGames.rows.filter((r) => r.moves && r.moves.length > 0);
  for (const r of [...withMoves].sort((a, b) => a.exitPly - b.exitPly || a.leaf - b.leaf)) {
    const v = DECISIVE.has(r.reason)
      ? `${r.winner} wins in ${r.moves!.length}`
      : `stall, ${r.reason} at ${r.moves!.length}`;
    const proven = provenSet.has(r.opening) ? ', proven' : '';
    records.push({
      id: `exit-${r.leaf}`,
      group: `Every ending of the opening chain (${withMoves.length}), engine at 100k`,
      label: `ending at ply ${r.exitPly} #${r.leaf}: ${v}${proven}`,
      moves: r.moves!,
      result: `${DECISIVE.has(r.reason) ? `${r.winner} wins by ${r.reason}` : `Draw by ${r.reason}`} after ${r.moves!.length} plies. The chain ended at ply ${r.exitPly}${proven ? '; the loss from there is proven' : ''}.`,
    });
  }
  const ladder = artifact('ladder-f26924937b96-', 'last') as {
    args: { openingPlies: number };
    result: {
      games: Array<{
        hiSeat: string;
        plies: number;
        winner: string | null;
        reason: string;
        moves: string[];
      }>;
    };
  };
  if (ladder.args.openingPlies !== 8)
    throw new Error('expected the eight-ply ladder to be the latest stock ladder artifact');
  ladder.result.games.forEach((g, i) => {
    const pair = Math.floor(i / 2) + 1;
    records.push({
      id: `ladder-${i}`,
      group: 'Ladder: 100k against 10k nodes from eight random plies (20)',
      label: `pair ${pair}, 100k as ${g.hiSeat}: ${g.winner ? `${g.winner} wins` : 'draw'} in ${g.plies}`,
      moves: g.moves,
      result: `${g.winner ? `${g.winner} wins` : 'Draw'} by ${g.reason} after ${g.plies} plies. The first eight plies were random; 100k nodes played ${g.hiSeat}, 10k the other side.`,
    });
  });
  const proofLines = proofs.outcomes.filter(
    (o) => o.result === 'proven' && o.line && o.line.length > 0,
  );
  for (const o of proofLines) {
    const row = sweepGames.rows.find((r) => r.opening === o.opening);
    records.push({
      id: `proof-${o.leaf}`,
      group: `Proof lines: the certificate’s main line (${proofLines.length})`,
      label: `ending at ply ${row?.exitPly ?? '?'} #${o.leaf}: ${o.attacker} wins, ${o.proofSize} positions`,
      moves: [...o.opening.split(' '), ...o.line!],
      result: `${o.attacker} wins by force from the ending at ply ${row?.exitPly ?? '?'}: the certificate covers ${o.proofSize} positions, and this is its main line, every defender reply here being one the certificate answers.`,
    });
  }
  // Replay every record through the kernel: san, forced flags, captured roles.
  const encoded = records.map((r) => {
    let st = kernel.initial(`w-${r.id}`);
    const start = kernel.fen(st).split(' ')[0]!;
    const moves = r.moves.map((u, i) => {
      const m = kernel.fromUci(st, u);
      if (!m) throw new Error(`bad move ${u} in ${r.id}`);
      const piece = st.board[m.from]!;
      const captured = st.board[m.to]?.role ?? null;
      const forced = kernel.legalMoves(st).length === 1;
      const label = san(st, u);
      st = kernel.apply(st, m);
      return {
        u,
        s: label,
        m: piece.color === 'red' ? 'r' : 'b',
        f: forced ? 1 : 0,
        c: captured,
        n: NOTES[r.id]?.[i + 1] ?? undefined,
      };
    });
    return { id: r.id, group: r.group, label: r.label, result: r.result, start, moves };
  });
  // ── The widget, in the grammar of mistboard's embed card (embed.css) ─────
  // A bordered card: seat rows above and below the board, the board on an
  // inset mat, a control bar under it, a move sheet in a rail on the right
  // with the result at its foot. Instances differ only in which records they
  // hold and which opens first; the notes ride on the records.
  type Instance = {
    id: string;
    records: typeof encoded;
    picker: 'select' | 'none';
    caption?: string;
    startAt?: number;
  };
  const widgetHtml = (inst: Instance) => {
    const data = JSON.stringify(inst.records).replace(/</g, '\\u003c');
    const picker =
      inst.picker === 'select'
        ? `<div class="anxq-pick"><label class="anxq-more" for="${inst.id}-more">Game</label><select id="${inst.id}-more" class="anxq-select"></select></div>`
        : '';
    return `<!-- Generated by scripts/gen-anti-diagrams.mts in the mistboard repo (--blog). Do not hand-edit.
     Every record was played under the rule kernel as referee; the page applies moves and draws. -->
<div id="${inst.id}" class="anxq" tabindex="0" data-anxq data-start="${inst.startAt ?? 0}">
${picker}<div class="anxq-header" id="${inst.id}-header"></div>
<div class="anxq-card">
  <div class="anxq-board-col">
    <div class="anxq-seat"><span class="anxq-disc anxq-disc--black"></span><span class="anxq-seat-name" id="${inst.id}-seat-black">Black</span><span class="anxq-seat-clock" id="${inst.id}-count-black"></span></div>
    <div class="anxq-mat"><svg id="${inst.id}-board" viewBox="0 0 284 315" aria-label="Xiangqi board"></svg></div>
    <div class="anxq-seat"><span class="anxq-disc anxq-disc--red"></span><span class="anxq-seat-name" id="${inst.id}-seat-red">Red</span><span class="anxq-seat-clock" id="${inst.id}-count-red"></span></div>
    <div class="anxq-controls">
      <button class="anxq-control" id="${inst.id}-first" aria-label="Start"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3.4" y="4" width="1.7" height="8" rx="0.7"/><path d="M12.6 4.3v7.4L6.5 8z"/></svg></button>
      <button class="anxq-control" id="${inst.id}-prev" aria-label="Back one ply"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M11 4.3v7.4L4.9 8z"/></svg></button>
      <span class="anxq-status" id="${inst.id}-pos"></span>
      <button class="anxq-control" id="${inst.id}-next" aria-label="Forward one ply"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M5 4.3v7.4L11.1 8z"/></svg></button>
      <button class="anxq-control" id="${inst.id}-last" aria-label="End"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="10.9" y="4" width="1.7" height="8" rx="0.7"/><path d="M3.4 4.3v7.4L9.5 8z"/></svg></button>
    </div>
  </div>
  <div class="anxq-rail">
    <div class="anxq-rail-inner">
      <div class="anxq-moves" id="${inst.id}-moves"></div>
      <div class="anxq-result" id="${inst.id}-result"></div>
    </div>
  </div>
</div>
<div class="anxq-caption" id="${inst.id}-caption"></div>
${inst.caption ? `<div class="anxq-credit">${inst.caption}</div>` : ''}
<script type="application/json" id="${inst.id}-data">${data}</script>
</div>
`;
  };
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
.anxq-moves button.forced::after { content: "!"; color: var(--anxq-muted); font-weight: 400; }
.anxq-moves button:hover { background: var(--anxq-hover); }
.anxq-moves button.cur, .anxq-moves button.cur:hover { background: var(--anxq-accent); color: var(--anxq-on-accent); }
.anxq-moves button.cur.forced::after { color: var(--anxq-on-accent); opacity: .8; }
.anxq-result { flex: none; box-sizing: border-box; min-height: 39px; padding: 6px 8px; border-top: 1px solid var(--anxq-border); background: var(--anxq-panel); color: var(--anxq-muted); font-size: 12px; font-weight: 600; text-align: center; line-height: 1.3; }
.anxq-credit { margin-top: 6px; font-size: 12px; color: var(--anxq-muted); text-align: center; }
@media (max-width: 640px) { .anxq-card { flex-direction: column; } .anxq-board-col { width: 100%; } .anxq-rail { border-left: 0; border-top: 1px solid var(--anxq-border); min-height: 220px; max-width: none; } }
</style>`;
  // The board drawing shared by every widget on the page: a 9x10 grid on the
  // house tan, pieces as the international set on a disc, and the last move in
  // mistboard's own grammar (board-lastmove.ts: a pale wash with an amber
  // outline where the piece left, a gold halo just outside the piece where it
  // landed; canonical cell 60 / piece 54, scaled to this cell of 31).
  const BOARD_JS = `
  const ROLE = { k: 'general', a: 'advisor', b: 'elephant', n: 'horse', r: 'chariot', c: 'cannon', p: 'soldier' };
  const ART = '/assets/posts/anti-xiangqi/pieces/xiangqi-international-';
  const FRAME = { general: { x: -7, y: -7, w: 114 }, advisor: { x: -7, y: -7, w: 114 }, elephant: { x: -5, y: -5, w: 110 }, horse: { x: -7, y: -7, w: 114 }, chariot: { x: -5.5, y: -7, w: 111 }, cannon: { x: -11, y: -11, w: 122 }, soldier: { x: 0, y: 0, w: 100 } };
  const M = 18, C = 31, PIECE = 28;
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
  // mv: the last move (uci) or null; targets: [{u, col}] capture options to hint on the board.
  function render(svg, board, mv, targets) {
    const parts = [GRID];
    if (mv) {
      const { from, to } = sq(mv), f = pt(from), t = pt(to);
      parts.push('<circle cx="' + f.x + '" cy="' + f.y + '" r="13.4" fill="rgba(250,204,21,0.22)" stroke="rgba(180,83,9,0.55)" stroke-width="1.05"/>');
      parts.push('<circle cx="' + t.x + '" cy="' + t.y + '" r="14.5" fill="none" stroke="#d6af4e" stroke-width="2.05" style="filter:drop-shadow(0 0 1px rgba(70,45,8,0.5))"/>');
    }
    for (const s in board) {
      const p = board[s], c = pt(s), k = PIECE / 100, fr = FRAME[p.role], x = c.x - PIECE / 2, y = c.y - PIECE / 2;
      const rank = Number(s.slice(1)), crossed = p.role === 'soldier' && (p.color === 'red' ? rank >= 6 : rank <= 5);
      parts.push('<circle cx="' + c.x + '" cy="' + c.y + '" r="' + (46 * k) + '" fill="#fef0d7" stroke="' + (p.color === 'red' ? '#c30d0d' : '#202427') + '" stroke-width="' + (2.8 * k) + '"/>');
      parts.push('<image href="' + ART + p.color + '-' + (crossed ? 'crossed-soldier' : p.role) + '.png" x="' + (x + fr.x * k) + '" y="' + (y + fr.y * k) + '" width="' + (fr.w * k) + '" height="' + (fr.w * k) + '" preserveAspectRatio="xMidYMid meet"/>');
    }
    // Capture hints: at rest a dot on each piece that can be taken; on hover
    // an arrow (the analysis-board grammar) from the capturing piece,
    // stopping at the target's disc so the last-move halo stays readable.
    for (const tg of targets || []) {
      const { from, to } = sq(tg.u), f = pt(from), t = pt(to);
      if (tg.kind === 'dot') { parts.push('<circle cx="' + t.x + '" cy="' + t.y + '" r="4.2" fill="' + tg.col + '" stroke="#fef0d7" stroke-width="1.2" opacity=".95"/>'); continue; }
      const dx = t.x - f.x, dy = t.y - f.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      const ex = t.x - ux * 15, ey = t.y - uy * 15, sx = f.x + ux * 6, sy = f.y + uy * 6;
      const hx = ex - ux * 9, hy = ey - uy * 9, px = -uy * 5.5, py = ux * 5.5;
      parts.push('<line x1="' + sx + '" y1="' + sy + '" x2="' + hx + '" y2="' + hy + '" stroke="' + tg.col + '" stroke-width="4" opacity=".7" stroke-linecap="round"/>');
      parts.push('<polygon points="' + ex + ',' + ey + ' ' + (hx + px) + ',' + (hy + py) + ' ' + (hx - px) + ',' + (hy - py) + '" fill="' + tg.col + '" opacity=".85"/>');
    }
    svg.innerHTML = parts.join('');
  }
  function applyMove(b, u) { const { from, to } = sq(u); const n = { ...b }; n[to] = n[from]; delete n[from]; return n; }
  function countPieces(board) { let red = 0, black = 0; for (const s in board) { if (board[s].color === 'red') red++; else black++; } return { red, black }; }
`;
  const WIDGET_JS = `<script>
(() => {${BOARD_JS}
  function boardsOf(game) {
    const out = [parsePlacement(game.start)];
    for (const mv of game.moves) out.push(applyMove(out[out.length - 1], mv.u));
    return out;
  }
  function mount(root) {
    const id = root.id;
    const $ = (suffix) => root.querySelector('#' + id + '-' + suffix);
    const GAMES = JSON.parse($('data').textContent);
    const svg = $('board');
    let gi = 0, at = 0, boards = [];
    function show() {
      const game = GAMES[gi], mv = at > 0 ? game.moves[at - 1] : null, board = boards[at];
      render(svg, board, mv ? mv.u : null, []);
      const { red, black } = countPieces(board);
      $('count-red').textContent = red + ' pieces'; $('count-black').textContent = black + ' pieces';
      $('pos').textContent = at + ' / ' + game.moves.length;
      const cap = $('caption');
      if (!mv) cap.innerHTML = '<span class="who">The start. Red to move; every legal move is a capture.</span>';
      else cap.innerHTML = '<span class="san">' + (Math.floor((at - 1) / 2) + 1) + (mv.m === 'r' ? '. ' : '... ') + mv.s + '</span> <span class="who">' + (mv.m === 'r' ? 'Red' : 'Black') + (mv.c ? ', taking the ' + mv.c : '') + (mv.f ? '. Only legal move.' : '.') + '</span>' + (mv.n ? '<p>' + mv.n + '</p>' : '');
      root.querySelectorAll('.anxq-moves button').forEach((b) => b.classList.toggle('cur', Number(b.dataset.ply) === at));
      const cur = root.querySelector('.anxq-moves button.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
      $('prev').disabled = at === 0; $('first').disabled = at === 0;
      $('next').disabled = at === game.moves.length; $('last').disabled = at === game.moves.length;
    }
    const startAt = Number(root.dataset.start || 0);
    function select(i) {
      gi = i;
      const game = GAMES[gi];
      boards = boardsOf(game);
      at = Math.min(startAt, game.moves.length);
      const more = $('more'); if (more) more.value = String(i);
      $('header').textContent = game.label;
      $('seat-red').textContent = game.red; $('seat-black').textContent = game.black;
      const list = $('moves'); list.innerHTML = '';
      game.moves.forEach((m, k) => {
        if (k % 2 === 0) { const n = document.createElement('span'); n.className = 'n'; n.textContent = String(k / 2 + 1); list.appendChild(n); }
        const b = document.createElement('button'); b.textContent = m.s; b.dataset.ply = k + 1; b.className = m.f ? 'forced' : ''; b.addEventListener('click', () => { at = k + 1; show(); }); list.appendChild(b);
      });
      $('result').textContent = game.result;
      show();
    }
    const more = $('more');
    if (more) {
      let og = null, group = null;
      GAMES.forEach((g, i) => {
        if (g.group !== group) { group = g.group; og = document.createElement('optgroup'); og.label = group; more.appendChild(og); }
        const o = document.createElement('option'); o.value = String(i); o.textContent = g.label; og.appendChild(o);
      });
      more.addEventListener('change', (e) => select(Number(e.target.value)));
    }
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
    if (id === 'anti-games') document.addEventListener('anti-games-select', (e) => { const i = GAMES.findIndex((g) => g.id === e.detail); if (i >= 0) { select(i); root.scrollIntoView({ block: 'start', behavior: 'smooth' }); root.focus(); } });
  }
  document.querySelectorAll('[data-anxq]').forEach((root) => { if (root.dataset.mounted) return; root.dataset.mounted = '1'; mount(root); });
})();
</script>`;
  // Seat names and tab labels per record.
  const seats = (r: { id: string; red?: string; black?: string }) => r;
  void seats;
  const withSeats = encoded.map((g) => {
    const rec = records.find((r) => r.id === g.id)!;
    let red = 'Fairy-Stockfish';
    let black = 'Fairy-Stockfish';
    let tab: string | undefined;
    if (g.id.startsWith('best-')) {
      const n = Number(g.id.slice(5)) / 1e6;
      red = `Fairy-Stockfish, ${n}M nodes`;
      black = `Fairy-Stockfish, ${n}M nodes`;
      tab = `${n}M nodes <small>${g.moves.length} plies</small>`;
    } else if (g.id.startsWith('exit-')) {
      red = 'Fairy-Stockfish, 100k nodes';
      black = 'Fairy-Stockfish, 100k nodes';
    } else if (g.id.startsWith('ladder-')) {
      const hi = /100k as (red|black)/.exec(rec.label)?.[1];
      red = hi === 'red' ? 'Fairy-Stockfish, 100k nodes' : 'Fairy-Stockfish, 10k nodes';
      black = hi === 'black' ? 'Fairy-Stockfish, 100k nodes' : 'Fairy-Stockfish, 10k nodes';
    } else if (g.id.startsWith('proof-')) {
      red = 'the proof';
      black = 'the proof';
    }
    return { ...g, red, black, tab };
  });
  // The recapture proof as a stepper of its own, annotated along the main line.
  const recaptureNotes: Record<number, string> = {
    2: 'The natural recapture. From here Red wins by force; the certificate covers 1,864 positions.',
    5: 'Red’s first free move is quiet: the chariot steps to a2. Black has 42 legal replies and the certificate answers each one. This is the main line.',
    7: 'The chariot to b2, with the b8 cannon now screened onto the b1 horse. Black has exactly one legal move.',
    9: 'Red must take the cannon.',
    10: 'Black must take the chariot: the whole b-file is open.',
    11: 'A quiet move that leaves Black’s chariot exactly one capture, the elephant on c1.',
    14: 'The elephant steps to i3, into the chariot’s reach; two replies, both covered.',
    34: 'Red has no pieces left and has won. Black could not decline a single capture along the way.',
  };
  const middlegame = withSeats
    .filter((g) => g.id === 'best-2000000' || g.id === 'best-5000000')
    .map((g) => ({
      ...g,
      label:
        g.id === 'best-2000000'
          ? 'The 2M game: the feast, then the lever, then a dead board (44 plies)'
          : 'The 5M game: a soldier war that goes nowhere (131 plies)',
    }));
  const instances: Instance[] = [
    { id: 'anti-games', records: withSeats, picker: 'select' },
    {
      id: 'anti-line-middlegame',
      records: middlegame,
      picker: 'select',
      startAt: 4,
      caption:
        'Two of the engine\u2019s own games, opened at ply 4, where the forced part ends. The notes are on the plies that matter.',
    },
  ];
  // ── The opening explorer: the cascade as a tablebase ─────────────────────
  // Every node of the cascade with its move, who wins from it under stock
  // scoring (backed up from the endings), how many endings lie below it and
  // how many of those are proven. Each ending carries its evidence: the
  // engine's verdict at 100k and at 1M nodes a move, and the proof where one
  // closed. The page applies moves to draw the board, and past an ending it
  // plays on through the proof's main line or the engine's game, both of
  // which it reads from the games viewer's records already on the page.
  const sweep1m = JSON.parse(
    readFileSync(path.join(OUTDIR, 'exits-1m-stall-fewerPieces.json'), 'utf8'),
  ) as { rows: Array<Row & { plies: number }> };
  const verdictAt = (rows: Array<Row & { plies?: number }>, line: string[]) => {
    const key = line.join(' ');
    const r = rows.find((x) => x.opening === key) ?? rows.find((x) => x.opening === mirror(key));
    if (!r) throw new Error(`no sweep row for ${key}`);
    return { w: DECISIVE.has(r.reason) ? r.winner : null, r: r.reason, p: r.plies ?? 0 };
  };
  const proofAt = (line: string[]) => {
    const key = line.join(' ');
    const o =
      proofs.outcomes.find((x) => x.opening === key) ??
      proofs.outcomes.find((x) => x.opening === mirror(key));
    if (!o) return null;
    return {
      result: o.result,
      size: o.proofSize ?? 0,
      line: o.line?.length ?? 0,
      id: o.result === 'proven' && o.line && o.line.length > 0 ? `proof-${o.leaf}` : '',
    };
  };
  const xdata = xnodes.map((n) => {
    const base = {
      i: n.i,
      p: n.p,
      u: n.u,
      s: n.s,
      m: n.m,
      d: n.d,
      l: n.leaf ? 1 : 0,
      v: n.v,
      n: n.n,
      pv: n.pv,
      pr: n.pr ? 1 : 0,
      g: n.g,
      mi: n.mirror ? 1 : 0,
      c: n.children,
    };
    if (!n.leaf) return base;
    const pf = proofAt(n.line);
    return {
      ...base,
      e: {
        k: verdictAt(sweep.rows as Array<Row & { plies?: number }>, n.line),
        m: verdictAt(sweep1m.rows, n.line),
      },
      ps: pf?.size ?? 0,
      pl: pf?.line ?? 0,
      pf: pf?.id ?? '',
      pu: pf ? pf.result : 'none',
    };
  });
  const xjson = JSON.stringify({
    start: kernel.fen(kernel.initial('x')).split(' ')[0],
    nodes: xdata,
  }).replace(/</g, '\\u003c');
  const EXPLORER_CSS = `<style>
.anxq-explorer .anxq-card { align-items: stretch; }
.anxq-explorer .anxq-x-rail { position: relative; flex: 1 1 0; min-width: 200px; border-left: 1px solid var(--anxq-border); }
.anxq-explorer .anxq-x-inner { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.anxq-explorer .anxq-x-path { flex: none; padding: 10px 12px 6px; font-family: ui-monospace, Menlo, monospace; font-size: 13.5px; font-weight: 600; line-height: 1.7; border-bottom: 1px solid var(--anxq-border); }
.anxq-explorer .anxq-x-path button { font: inherit; background: none; border: 0; padding: 0 3px; border-radius: 4px; color: var(--anxq-heading); cursor: pointer; }
.anxq-explorer .anxq-x-path button:hover { background: var(--anxq-hover); }
.anxq-explorer .anxq-x-path button.cur { background: var(--anxq-accent); color: var(--anxq-on-accent); }
.anxq-explorer .anxq-x-path button.ext { color: var(--anxq-muted); font-weight: 500; }
.anxq-explorer .anxq-x-path .num { color: var(--anxq-muted); font-weight: 400; }
.anxq-explorer .anxq-x-state { flex: none; padding: 8px 12px; font-size: 13px; line-height: 1.45; color: var(--anxq-muted); border-bottom: 1px solid var(--anxq-border); }
.anxq-explorer .anxq-x-state b { color: var(--anxq-heading); }
.anxq-explorer .anxq-x-body { flex: 1; min-height: 0; overflow: auto; }
.anxq-explorer .anxq-x-head { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 8px 12px 2px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--anxq-muted); }
.anxq-explorer .anxq-x-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "mv val" "sub sub"; gap: 1px 8px; align-items: center; width: 100%; padding: 6px 12px; border: 0; border-top: 1px solid var(--anxq-border); background: none; text-align: left; font: inherit; color: var(--anxq-heading); cursor: pointer; }
.anxq-explorer .anxq-x-row:hover { background: var(--anxq-hover); }
.anxq-explorer .anxq-x-row .mv { grid-area: mv; font-family: ui-monospace, Menlo, monospace; font-weight: 600; font-size: 15px; white-space: nowrap; }
.anxq-explorer .anxq-x-row .mv .best { margin-left: 8px; font-family: inherit; font-size: 11px; font-weight: 600; color: var(--anxq-accent); letter-spacing: .04em; text-transform: uppercase; }
.anxq-explorer .anxq-x-row .val { grid-area: val; justify-self: end; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; color: #fff; white-space: nowrap; }
.anxq-explorer .val.r { background: #c0392b; } .anxq-explorer .val.b { background: #2b2b2b; } .anxq-explorer .val.d { background: #8b8b90; }
.anxq-explorer .anxq-x-row .sub { grid-area: sub; font-size: 12px; line-height: 1.35; color: var(--anxq-muted); }
.anxq-explorer .anxq-x-row .dur { grid-area: val; justify-self: end; font-size: 12px; font-weight: 600; color: var(--anxq-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.anxq-explorer .anxq-x-leaf { padding: 10px 12px 8px; font-size: 13.5px; line-height: 1.5; color: var(--anxq-heading); border-bottom: 1px solid var(--anxq-border); }
.anxq-explorer .anxq-x-leaf p { margin: 6px 0 0; }
.anxq-explorer .anxq-x-leaf .val { display: inline-block; vertical-align: 1px; font-size: 12px; font-weight: 600; padding: 1px 9px; border-radius: 999px; color: #fff; }
.anxq-explorer .anxq-x-leaf .kicker { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--anxq-muted); }
.anxq-explorer .anxq-moves { padding: 6px 4px; }
.anxq-explorer .anxq-x-hint { flex: none; padding: 8px 12px; border-top: 1px solid var(--anxq-border); font-size: 12px; line-height: 1.4; color: var(--anxq-muted); }
.anxq-explorer .anxq-caption .kicker { display: block; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--anxq-muted); margin-bottom: 2px; }
@media (max-width: 640px) { .anxq-explorer .anxq-x-rail { border-left: 0; border-top: 1px solid var(--anxq-border); min-height: 300px; } }
</style>`;
  // One instance: the markup only. The Liquid parameters name it and root it
  // (\`start\` is a UCI line from the array; empty means the array itself).
  const explorerInstanceHtml = `<!-- Generated by scripts/gen-anti-diagrams.mts in the mistboard repo (--blog). Do not hand-edit.
     One tablebase instance: include it with id="..." and start="..." (a UCI line from the array) after the lib include. -->
<div id="{{ include.id }}" class="anxq anxq-explorer" tabindex="0" data-anxq-explorer data-start="{{ include.start }}">
<div class="anxq-header" id="{{ include.id }}-header"></div>
<div class="anxq-card">
  <div class="anxq-board-col">
    <div class="anxq-seat"><span class="anxq-disc anxq-disc--black"></span><span class="anxq-seat-name">Black</span><span class="anxq-seat-clock" id="{{ include.id }}-count-black"></span></div>
    <div class="anxq-mat"><svg id="{{ include.id }}-board" viewBox="0 0 284 315" aria-label="Xiangqi board"></svg></div>
    <div class="anxq-seat"><span class="anxq-disc anxq-disc--red"></span><span class="anxq-seat-name">Red</span><span class="anxq-seat-clock" id="{{ include.id }}-count-red"></span></div>
    <div class="anxq-controls">
      <button class="anxq-control" id="{{ include.id }}-first" aria-label="Back to this position"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3.4" y="4" width="1.7" height="8" rx="0.7"/><path d="M12.6 4.3v7.4L6.5 8z"/></svg></button>
      <button class="anxq-control" id="{{ include.id }}-prev" aria-label="Back one ply"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M11 4.3v7.4L4.9 8z"/></svg></button>
      <span class="anxq-status" id="{{ include.id }}-pos"></span>
      <button class="anxq-control" id="{{ include.id }}-next" aria-label="Forward one ply, best play"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M5 4.3v7.4L11.1 8z"/></svg></button>
      <button class="anxq-control" id="{{ include.id }}-last" aria-label="To the end of the line"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="10.9" y="4" width="1.7" height="8" rx="0.7"/><path d="M3.4 4.3v7.4L9.5 8z"/></svg></button>
    </div>
  </div>
  <div class="anxq-x-rail"><div class="anxq-x-inner">
    <div class="anxq-x-path" id="{{ include.id }}-path"></div>
    <div class="anxq-x-state" id="{{ include.id }}-state"></div>
    <div class="anxq-x-body" id="{{ include.id }}-body"></div>
    <div class="anxq-x-hint" id="{{ include.id }}-hint"></div>
  </div></div>
</div>
<div class="anxq-caption" id="{{ include.id }}-caption"></div>
</div>
`;
  const explorerLibHtml = `<!-- Generated by scripts/gen-anti-diagrams.mts in the mistboard repo (--blog). Do not hand-edit.
     The opening cascade as a tablebase: every node with its value backed up from the endings, every ending
     with its evidence (engine verdicts at 100k and 1M, the proof where one closed). Include once, before the
     first instance include. Past an ending the viewer plays on through
     the proof's main line or the engine's game, read from the games viewer's records on the same page. -->
${EXPLORER_CSS}
<script type="application/json" id="anti-explorer-data">${xjson}</script>
<script>
(() => {${BOARD_JS}
  const DATA = JSON.parse(document.getElementById('anti-explorer-data').textContent);
  const N = DATA.nodes;
  const MIRROR = { a: 'i', b: 'h', c: 'g', d: 'f', e: 'e', f: 'd', g: 'c', h: 'b', i: 'a' };
  const mirrorText = (t) => t.replace(/[a-i]/g, (c) => MIRROR[c]);
  let gamesCache = null;
  function games() { if (gamesCache) return gamesCache; const el = document.getElementById('anti-games-data'); if (!el) return []; gamesCache = JSON.parse(el.textContent); return gamesCache; }
  const who = (v) => v === 'r' ? 'Red wins' : v === 'b' ? 'Black wins' : 'Draw';
  const side = (v) => v === 'r' ? 'Red' : 'Black';
  const REASON = { extinction: 'extinction', stalemate: 'stalemate', 'progress-clock': 'the progress clock', repetition: 'repetition', 'dead-position': 'a dead board' };
  const COL = { r: '#c0392b', b: '#2b2b2b', d: '#8b8b90' };
  const fmt = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  function lineOf(i) { const out = []; let n = N[i]; while (n && n.p >= 0) { out.unshift(n); n = N[n.p]; } return out; }
  function nodeAt(uciLine) { let i = 0; for (const u of uciLine) { const c = N[i].c.map((k) => N[k]).find((k) => k.u === u); if (!c) throw new Error('no node for ' + u); i = c.i; } return i; }
  // The mover's preference: own win, then a draw, then the other side's win.
  const pref = (v, mover) => v === mover ? 2 : v === 'd' ? 1 : 0;
  function sortedKids(n) { const mover = n.d % 2 === 0 ? 'r' : 'b'; return n.c.map((c) => N[c]).sort((a, b) => pref(b.v, mover) - pref(a.v, mover) || a.n - b.n); }
  // What comes after an ending: the proof's main line where the loss is proven, else the engine's 100k game.
  function continuation(n) {
    const rec = games().find((g) => g.id === (n.pf || n.g));
    if (!rec) return { kind: n.pf ? 'proof' : 'engine', moves: [] };
    const moves = rec.moves.slice(n.d).map((m) => n.mi ? { u: mirrorText(m.u), s: mirrorText(m.s), m: m.m, f: m.f } : m);
    return { kind: n.pf ? 'proof' : 'engine', moves };
  }
  // The row's evidence line, and the ending's full account.
  function evidence(k) {
    if (!k.l) return fmt(k.n) + ' ending' + (k.n === 1 ? '' : 's') + ' below, ' + k.pv + ' proven';
    if (k.v === 'd') return k.e.m.w ? 'engine: stalls at 100k; at 1M ' + side(k.e.m.w[0]) + ' wins at ply ' + k.e.m.p + '; not proven' : 'engine: stalls at 100k and at 1M';
    if (k.pr) return 'proven: over at ply ' + (k.d + k.pl) + ', ' + fmt(k.ps) + ' positions';
    return 'engine: over at ply ' + k.e.k.p + ' (100k), 1M agrees; not proven';
  }
  function account(n) {
    const mover = n.d % 2 === 0 ? 'Red' : 'Black';
    let s = '<span class="kicker">The chain ends here</span> ' + mover + ' to move with no capture on the board. ';
    if (n.v === 'd') {
      s += '<p><span class="val d">Draw</span> The engine\\u2019s game from here stalls by ' + REASON[n.e.k.r] + ' at ply ' + n.e.k.p + ' with 100,000 nodes a move' + (n.e.m.w ? ', but with a million ' + side(n.e.m.w[0]) + ' wins by ' + REASON[n.e.m.r] + ' at ply ' + n.e.m.p + ': a verdict the prover could not close, so this ending is scored as the 100k sweep found it' : ', and by ' + REASON[n.e.m.r] + ' at ply ' + n.e.m.p + ' with a million') + '. Under the rules as written a stall is a draw. Below is the 100k game.</p>';
    } else if (n.pr) {
      s += '<p><span class="val ' + n.v + '">' + who(n.v) + '</span> Proven. The certificate holds ' + fmt(n.ps) + ' positions and its main line ends the game at ply ' + (n.d + n.pl) + '; a checker that knows only the rules has replayed it. Below is that main line: at every ' + (n.v === 'r' ? 'Black' : 'Red') + ' move, either it was the only legal move or the certificate answers each alternative.</p>';
    } else {
      s += '<p><span class="val ' + n.v + '">' + who(n.v) + '</span> The engine\\u2019s verdict, not a proof: ' + side(n.v) + ' wins by ' + REASON[n.e.k.r] + ' at ply ' + n.e.k.p + ' with 100,000 nodes a move, and at ply ' + n.e.m.p + ' with a million. The prover ran out of budget here. Below is the 100k game.</p>';
    }
    return s;
  }
  function mount(root) {
    const id = root.id;
    const $ = (suffix) => root.querySelector('#' + id + '-' + suffix);
    const startLine = (root.dataset.start || '').trim();
    const home = startLine ? nodeAt(startLine.split(/\\s+/)) : 0;
    const svg = $('board');
    let cur = home, ext = 0, cont = null, view = { board: null, last: null };
    function show(i, extAt) {
      cur = i; ext = extAt || 0;
      const n = N[i];
      cont = n.l ? continuation(n) : null;
      if (cont && ext > cont.moves.length) ext = cont.moves.length;
      const line = lineOf(i);
      let board = parsePlacement(DATA.start);
      for (const m of line) board = applyMove(board, m.u);
      for (let k = 0; k < ext; k++) board = applyMove(board, cont.moves[k].u);
      const kids = n.l ? [] : sortedKids(n);
      const last = ext > 0 ? cont.moves[ext - 1].u : (n.u || null);
      view = { board, last };
      render(svg, board, last, []);
      const { red, black } = countPieces(board);
      $('count-red').textContent = red + ' pieces'; $('count-black').textContent = black + ' pieces';
      $('pos').textContent = 'ply ' + (n.d + ext);
      // The path from the array, then the continuation in a lighter weight.
      const path = $('path'); path.innerHTML = '';
      const startBtn = document.createElement('button'); startBtn.textContent = 'start'; startBtn.className = i === 0 ? 'cur' : ''; startBtn.addEventListener('click', () => show(0)); path.appendChild(startBtn);
      const addMove = (k, label, cls, onClick) => { if (k % 2 === 0) { const num = document.createElement('span'); num.className = 'num'; num.textContent = ' ' + (k / 2 + 1) + '. '; path.appendChild(num); } else path.appendChild(document.createTextNode(' ')); const b = document.createElement('button'); b.textContent = label; b.className = cls; b.addEventListener('click', onClick); path.appendChild(b); };
      line.forEach((m, k) => addMove(k, m.s, m.i === i && ext === 0 ? 'cur' : '', () => show(m.i)));
      if (cont) cont.moves.slice(0, ext).forEach((m, k) => addMove(n.d + k, m.s, 'ext' + (k + 1 === ext ? ' cur' : ''), () => show(i, k + 1)));
      const mover = n.d % 2 === 0 ? 'Red' : 'Black';
      const state = $('state'), body = $('body'), hint = $('hint');
      body.innerHTML = '';
      if (!n.l) {
        state.innerHTML = '<b>' + mover + ' to move.</b> ' + kids.length + ' capture' + (kids.length === 1 ? '' : 's') + ', and only captures are legal. Backing up every ending below: <b>' + who(n.v).toLowerCase() + '</b>.';
        const head = document.createElement('div'); head.className = 'anxq-x-head'; head.innerHTML = '<span>' + mover + '\\u2019s captures, best first</span>'; body.appendChild(head);
        const moverV = n.d % 2 === 0 ? 'r' : 'b';
        const strictlyBest = kids.length > 1 && pref(kids[0].v, moverV) > pref(kids[1].v, moverV);
        kids.forEach((k, idx) => {
          const b = document.createElement('button'); b.className = 'anxq-x-row';
          const num = Math.floor((k.d - 1) / 2) + 1;
          b.innerHTML = '<span class="mv">' + num + (k.m === 'r' ? '. ' : '... ') + k.s + (idx === 0 && strictlyBest ? '<span class="best">best</span>' : '') + '</span><span class="val ' + k.v + '">' + who(k.v) + '</span><span class="sub">' + evidence(k) + '</span>';
          b.addEventListener('click', () => show(k.i));
          // Through view, so a leave event that lands after a click repaints
          // the position the click moved to, not the one the row belonged to.
          const lift = () => render(svg, view.board, view.last, [{ u: k.u, col: COL[k.v] }]);
          const drop = () => render(svg, view.board, view.last, []);
          b.addEventListener('mouseenter', lift); b.addEventListener('focus', lift);
          b.addEventListener('mouseleave', drop); b.addEventListener('blur', drop);
          body.appendChild(b);
        });
        hint.textContent = 'Chip: the value from there with best play on both sides. Small print: the evidence for it. Forward steps into the top row.';
      } else {
        state.innerHTML = '<b>' + mover + ' to move.</b> No capture, so the chain of forced captures is over and the game is open.';
        const leaf = document.createElement('div'); leaf.className = 'anxq-x-leaf'; leaf.innerHTML = account(n); body.appendChild(leaf);
        if (cont.moves.length > 0) {
          const list = document.createElement('div'); list.className = 'anxq-moves';
          if (n.d % 2 === 1) { const num = document.createElement('span'); num.className = 'n'; num.textContent = String((n.d - 1) / 2 + 1); list.appendChild(num); list.appendChild(document.createElement('span')); }
          cont.moves.forEach((m, k) => {
            const ply = n.d + k;
            if (ply % 2 === 0) { const num = document.createElement('span'); num.className = 'n'; num.textContent = String(ply / 2 + 1); list.appendChild(num); }
            const b = document.createElement('button'); b.textContent = m.s; b.className = (m.f ? 'forced' : '') + (k + 1 === ext ? ' cur' : ''); b.addEventListener('click', () => show(i, k + 1)); list.appendChild(b);
          });
          body.appendChild(list);
          const curBtn = list.querySelector('button.cur'); if (curBtn) curBtn.scrollIntoView({ block: 'nearest' });
        }
        hint.textContent = cont.kind === 'proof' ? 'The moves marked ! were the only legal move. Forward steps along the main line; the games viewer at the top holds the same line.' : 'Fairy-Stockfish against itself from this ending, 100,000 nodes a move, the kernel refereeing. Forward steps through it.';
      }
      const cap = $('caption');
      if (ext > 0) { const m = cont.moves[ext - 1]; cap.innerHTML = '<span class="kicker">' + (cont.kind === 'proof' ? 'Proof main line' : 'Engine game') + '</span><span class="san">' + (Math.floor((n.d + ext - 1) / 2) + 1) + (m.m === 'r' ? '. ' : '... ') + m.s + '</span> <span class="who">' + (m.m === 'r' ? 'Red' : 'Black') + (m.f ? '. Only legal move.' : '.') + '</span>'; }
      else if (n.d === 0) cap.innerHTML = '<span class="who">The array. Red\\u2019s two legal moves are both captures, and mirror images of each other.</span>';
      else cap.innerHTML = '<span class="san">' + (Math.floor((n.d - 1) / 2) + 1) + (n.m === 'r' ? '. ' : '... ') + n.s + '</span> <span class="who">' + (n.m === 'r' ? 'Red' : 'Black') + '. ' + (n.v === 'd' ? 'Holds: a draw with best play.' : who(n.v) + ' with best play' + (n.l && n.pr ? ', proven.' : '.')) + '</span>';
      $('first').disabled = i === home && ext === 0;
      $('prev').disabled = i === 0 && ext === 0;
      const atEnd = n.l && (!cont || ext === cont.moves.length);
      $('next').disabled = atEnd; $('last').disabled = atEnd;
      $('header').textContent = n.d === 0 ? 'The array' : 'After ' + line.map((m, k) => (k % 2 === 0 ? (k / 2 + 1) + '. ' : '') + m.s).join(' ');
    }
    function next() { const n = N[cur]; if (n.l) { if (cont && ext < cont.moves.length) show(cur, ext + 1); } else show(sortedKids(n)[0].i); }
    function prev() { if (ext > 0) show(cur, ext - 1); else if (N[cur].p >= 0) show(N[cur].p); }
    function last() { let i = cur; while (!N[i].l) i = sortedKids(N[i])[0].i; const c = continuation(N[i]); show(i, c.moves.length); }
    $('first').addEventListener('click', () => show(home));
    $('prev').addEventListener('click', prev);
    $('next').addEventListener('click', next);
    $('last').addEventListener('click', last);
    root.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { next(); e.preventDefault(); } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') { prev(); e.preventDefault(); } });
    show(home);
  }
  const mountAll = () => document.querySelectorAll('[data-anxq-explorer]').forEach((root) => { if (root.dataset.mounted) return; root.dataset.mounted = '1'; mount(root); });
  mountAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
})();
</script>
`;
  writeFileSync(path.join(INCLUDES, 'anti-xq-explorer-lib.html'), explorerLibHtml);
  writeFileSync(path.join(INCLUDES, 'anti-xq-explorer.html'), explorerInstanceHtml);
  console.log('  _includes/anti-xq-explorer-lib.html, anti-xq-explorer.html');
  for (const inst of instances) {
    const first = inst.id === 'anti-games';
    writeFileSync(
      path.join(INCLUDES, `anti-xq-${inst.id.replace(/^anti-/, '')}.html`),
      `${first ? WIDGET_CSS : ''}${widgetHtml(inst)}${first ? '' : ''}${WIDGET_JS}`,
    );
    console.log(
      `  _includes/anti-xq-${inst.id.replace(/^anti-/, '')}.html (${inst.records.length} games)`,
    );
  }
  // ── Play against the proof: the whole certificate for 1...Rxb10 ──────────
  // The stepper above shows one line; this holds every line. At each Black
  // move the reader picks any legal reply and the certificate answers with
  // Red's proving move, down to a position where Red has no pieces. The
  // certificate is flattened with the four opening plies as a linear prefix
  // so the path reads from the array. Rows carry how long the reply resists
  // and how many positions sit below it.
  const recaptureProof = proofs.outcomes.find((o) => o.leaf === 82);
  if (!recaptureProof?.proof || !recaptureProof.line)
    throw new Error('no certificate for the chariot recapture (leaf 82)');
  type PNode = {
    p: number;
    u: string;
    s: string;
    d: number;
    c: number[];
    n: number;
    dl: number;
    main: boolean;
    note?: string;
  };
  const pnodes: PNode[] = [];
  {
    const opening = recaptureProof.opening.split(' ');
    const mainLine = new Set<string>();
    {
      // Main-line nodes are keyed by the full line from the array.
      const acc: string[] = [];
      for (const m of [...opening, ...recaptureProof.line]) {
        acc.push(m);
        mainLine.add(acc.join(' '));
      }
    }
    const st = kernel.initial('pf');
    const add = (parent: number, line: string[], s: RuleState, children: ProofTree[]): number => {
      const i = pnodes.length;
      const u = line[line.length - 1] ?? '';
      const node: PNode = {
        p: parent,
        u,
        s: u ? san(parentState(parent), u) : '',
        d: line.length,
        c: [],
        n: 0,
        dl: 0,
        main: line.length === 0 || mainLine.has(line.join(' ')),
        note: recaptureNotes[line.length],
      };
      pnodes.push(node);
      states.push(s);
      if (children.length === 0) {
        if (s.status.type !== 'finished' || s.status.winner !== 'red')
          throw new Error(`certificate leaf after ${line.join(' ')} is not a Red win`);
        return i;
      }
      for (const ch of children) {
        const mv = kernel.fromUci(s, ch.move);
        if (!mv) throw new Error(`bad certificate move ${ch.move} after ${line.join(' ')}`);
        const ci = add(i, [...line, ch.move], kernel.apply(s, mv), ch.replies ?? []);
        node.c.push(ci);
        node.n += pnodes[ci]!.n + 1;
        node.dl = Math.max(node.dl, pnodes[ci]!.dl + 1);
      }
      return i;
    };
    const states: RuleState[] = [];
    const parentState = (p: number) => states[p]!;
    // The opening as a linear prefix, then the certificate from the ending.
    const prefixTree = (k: number): ProofTree[] =>
      k >= opening.length
        ? recaptureProof.proof!.children
        : [{ move: opening[k]!, replies: prefixTree(k + 1) }];
    add(-1, [], st, prefixTree(0));
    void st;
    if (pnodes.length !== 1 + opening.length + (recaptureProof.proofSize ?? 0) - 1)
      throw new Error(
        `certificate flattened to ${pnodes.length} nodes; expected ${opening.length + (recaptureProof.proofSize ?? 0)}`,
      );
  }
  const pjson = JSON.stringify({
    start: kernel.fen(kernel.initial('x')).split(' ')[0],
    open: 4,
    nodes: pnodes.map((n) => [n.p, n.u, n.s, n.c, n.n, n.dl, n.main ? 1 : 0, n.note ?? '']),
  }).replace(/</g, '\\u003c');
  const proofHtml = `<!-- Generated by scripts/gen-anti-diagrams.mts in the mistboard repo (--blog). Do not hand-edit.
     The whole certificate for 1...Rxb10 as a widget: pick any Black reply, the proof answers.
     Uses the explorer's CSS; include after anti-xq-explorer-lib.html. -->
<div id="anti-proof" class="anxq anxq-explorer" tabindex="0">
<div class="anxq-header" id="anti-proof-header">1...Rxb10: the whole proof</div>
<div class="anxq-card">
  <div class="anxq-board-col">
    <div class="anxq-seat"><span class="anxq-disc anxq-disc--black"></span><span class="anxq-seat-name">Black, any reply</span><span class="anxq-seat-clock" id="anti-proof-count-black"></span></div>
    <div class="anxq-mat"><svg id="anti-proof-board" viewBox="0 0 284 315" aria-label="Xiangqi board"></svg></div>
    <div class="anxq-seat"><span class="anxq-disc anxq-disc--red"></span><span class="anxq-seat-name">Red, the certificate</span><span class="anxq-seat-clock" id="anti-proof-count-red"></span></div>
    <div class="anxq-controls">
      <button class="anxq-control" id="anti-proof-first" aria-label="Back to the array"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3.4" y="4" width="1.7" height="8" rx="0.7"/><path d="M12.6 4.3v7.4L6.5 8z"/></svg></button>
      <button class="anxq-control" id="anti-proof-prev" aria-label="Back one ply"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M11 4.3v7.4L4.9 8z"/></svg></button>
      <span class="anxq-status" id="anti-proof-pos"></span>
      <button class="anxq-control" id="anti-proof-next" aria-label="Forward one ply along the main line"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M5 4.3v7.4L11.1 8z"/></svg></button>
      <button class="anxq-control" id="anti-proof-last" aria-label="To the end of the main line"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="10.9" y="4" width="1.7" height="8" rx="0.7"/><path d="M3.4 4.3v7.4L9.5 8z"/></svg></button>
    </div>
  </div>
  <div class="anxq-x-rail"><div class="anxq-x-inner">
    <div class="anxq-x-path" id="anti-proof-path"></div>
    <div class="anxq-x-state" id="anti-proof-state"></div>
    <div class="anxq-x-body" id="anti-proof-body"></div>
    <div class="anxq-x-hint" id="anti-proof-hint"></div>
  </div></div>
</div>
<div class="anxq-caption" id="anti-proof-caption"></div>
<script type="application/json" id="anti-proof-data">${pjson}</script>
<script>
(() => {${BOARD_JS}
  const root = document.getElementById('anti-proof');
  const DATA = JSON.parse(root.querySelector('#anti-proof-data').textContent);
  const N = DATA.nodes.map((a, i) => ({ i, p: a[0], u: a[1], s: a[2], c: a[3], n: a[4], dl: a[5], main: !!a[6], note: a[7], d: 0 }));
  for (const n of N) n.d = n.p < 0 ? 0 : N[n.p].d + 1;
  const $ = (suffix) => root.querySelector('#anti-proof-' + suffix);
  const svg = $('board');
  const fmt = (x) => String(x).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  const RED = '#c0392b';
  function lineOf(i) { const out = []; let n = N[i]; while (n && n.p >= 0) { out.unshift(n); n = N[n.p]; } return out; }
  function mainChild(n) { return n.c.map((c) => N[c]).find((k) => k.main) || N[n.c[0]]; }
  let cur = 0, view = { board: null, last: null };
  function show(i) {
    cur = i;
    const n = N[i];
    const line = lineOf(i);
    let board = parsePlacement(DATA.start);
    for (const m of line) board = applyMove(board, m.u);
    const redToMove = n.d % 2 === 0;
    const kids = n.c.map((c) => N[c]).sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0) || b.dl - a.dl);
    view = { board, last: n.u || null };
    render(svg, board, n.u || null, []);
    const { red, black } = countPieces(board);
    $('count-red').textContent = red + ' pieces'; $('count-black').textContent = black + ' pieces';
    $('pos').textContent = 'ply ' + n.d;
    const path = $('path'); path.innerHTML = '';
    const startBtn = document.createElement('button'); startBtn.textContent = 'start'; startBtn.className = i === 0 ? 'cur' : ''; startBtn.addEventListener('click', () => show(0)); path.appendChild(startBtn);
    line.forEach((m, k) => { if (k % 2 === 0) { const num = document.createElement('span'); num.className = 'num'; num.textContent = ' ' + (k / 2 + 1) + '. '; path.appendChild(num); } else path.appendChild(document.createTextNode(' ')); const b = document.createElement('button'); b.textContent = m.s; b.className = (m.i === i ? 'cur' : '') + (m.main ? '' : ' ext'); b.addEventListener('click', () => show(m.i)); path.appendChild(b); });
    const state = $('state'), body = $('body'), hint = $('hint');
    body.innerHTML = '';
    if (n.c.length === 0) {
      state.innerHTML = '<b>Red has no pieces left.</b> Extinction: Red wins. ' + (n.main ? 'This is the end of the main line.' : 'A line of the certificate, ' + n.d + ' plies from the array.');
      hint.textContent = 'Every line of the certificate ends like this. Back steps up; the first button returns to the array.';
    } else if (n.d < DATA.open) {
      const k = N[n.c[0]];
      state.innerHTML = '<b>' + (redToMove ? 'Red' : 'Black') + ' to move.</b> The opening: ' + (n.d === 1 ? 'Black takes back with the chariot, the move the certificate refutes.' : 'the only capture.');
      const b = document.createElement('button'); b.className = 'anxq-x-row';
      const sub = k.d === 1 ? 'one of two mirror-image first moves' : k.d === 2 ? 'the certificate refutes it: ' + fmt(k.n + 1) + ' positions' : 'the only legal capture';
      b.innerHTML = '<span class="mv">' + (Math.floor((k.d - 1) / 2) + 1) + (k.d % 2 === 1 ? '. ' : '... ') + k.s + '</span><span class="val ' + (k.d === 1 ? 'd' : 'r') + '">' + (k.d === 1 ? 'Draw' : 'Red wins') + '</span><span class="sub">' + sub + '</span>';
      b.addEventListener('click', () => show(k.i)); body.appendChild(b);
      hint.textContent = 'Forward steps through the four opening plies to the position the proof starts from.';
    } else if (redToMove) {
      const k = N[n.c[0]];
      state.innerHTML = '<b>Red to move.</b> The certificate holds one move here, and it wins against every reply.';
      const b = document.createElement('button'); b.className = 'anxq-x-row';
      b.innerHTML = '<span class="mv">' + (Math.floor((k.d - 1) / 2) + 1) + '. ' + k.s + '</span><span class="dur">\u2264' + k.dl + ' plies</span><span class="sub">' + (k.main ? 'main line · ' : '') + 'wins against every reply · ' + fmt(k.n + 1) + ' positions</span>';
      b.addEventListener('click', () => show(k.i));
      const lift = () => render(svg, view.board, view.last, [{ u: k.u, col: RED }]);
      const drop = () => render(svg, view.board, view.last, []);
      b.addEventListener('mouseenter', lift); b.addEventListener('focus', lift); b.addEventListener('mouseleave', drop); b.addEventListener('blur', drop);
      body.appendChild(b);
      hint.textContent = 'Forward plays it.';
    } else {
      state.innerHTML = '<b>Black to move.</b> ' + kids.length + ' legal ' + (kids.length === 1 ? 'move' : 'moves') + ', and the certificate answers each one. Pick any.';
      const head = document.createElement('div'); head.className = 'anxq-x-head'; head.innerHTML = '<span>Black\\u2019s replies, longest first</span><span>over within</span>'; body.appendChild(head);
      kids.forEach((k) => {
        const b = document.createElement('button'); b.className = 'anxq-x-row';
        b.innerHTML = '<span class="mv">' + (Math.floor((k.d - 1) / 2) + 1) + '... ' + k.s + '</span><span class="dur">\u2264' + k.dl + ' plies</span><span class="sub">' + (k.main ? 'main line · ' : '') + fmt(k.n + 1) + ' position' + (k.n === 0 ? '' : 's') + '</span>';
        b.addEventListener('click', () => show(k.i));
        const lift = () => render(svg, view.board, view.last, [{ u: k.u, col: RED }]);
        const drop = () => render(svg, view.board, view.last, []);
        b.addEventListener('mouseenter', lift); b.addEventListener('focus', lift); b.addEventListener('mouseleave', drop); b.addEventListener('blur', drop);
        body.appendChild(b);
      });
      hint.textContent = kids.length === 1 ? 'Only one legal move: Black must capture. Forward plays it.' : 'Every row is a legal Black move; there are no others. Forward follows the main line.';
    }
    const cap = $('caption');
    if (n.d === 0) cap.innerHTML = '<span class="who">The array. The proof refutes 1...Rxb10; step forward to reach it.</span>';
    else cap.innerHTML = '<span class="san">' + (Math.floor((n.d - 1) / 2) + 1) + (n.d % 2 === 1 ? '. ' : '... ') + n.s + '</span> <span class="who">' + (n.d % 2 === 1 ? 'Red' : 'Black') + (n.main ? '' : ', off the main line') + '.</span>' + (n.note ? '<p>' + n.note + '</p>' : '');
    $('first').disabled = i === 0; $('prev').disabled = i === 0;
    $('next').disabled = n.c.length === 0; $('last').disabled = n.c.length === 0;
    $('header').textContent = n.d === 0 ? '1...Rxb10: the whole proof' : 'After ' + line.map((m, k) => (k % 2 === 0 ? (k / 2 + 1) + '. ' : '') + m.s).join(' ');
  }
  const next = () => { const n = N[cur]; if (n.c.length) show(mainChild(n).i); };
  const prev = () => { if (N[cur].p >= 0) show(N[cur].p); };
  $('first').addEventListener('click', () => show(0));
  $('prev').addEventListener('click', prev);
  $('next').addEventListener('click', next);
  $('last').addEventListener('click', () => { let n = N[cur]; while (n.c.length) n = mainChild(n); show(n.i); });
  root.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { next(); e.preventDefault(); } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') { prev(); e.preventDefault(); } });
  show(DATA.open);
})();
</script>
</div>
`;
  writeFileSync(path.join(INCLUDES, 'anti-xq-proof-recapture.html'), proofHtml);
  console.log(`  _includes/anti-xq-proof-recapture.html (${pnodes.length} positions)`);
  // ── The mistboard article's diagrams, as a generated module ─────────────
  // The site renders diagrams at runtime so they follow the reader's piece
  // set, and the rule kernel is not a web dependency, so the positions are
  // replayed here through the kernel and written out as board literals; the
  // module draws them with the shared xiangqi diagram toolkit. Regenerate,
  // never hand-edit.
  {
    const SITE_MODULE = path.join(HERE, '../apps/web/src/anti-xiangqi-article-diagrams.ts');
    const boardLiteral = (s: RuleState) =>
      `{ ${Object.entries(s.board)
        .filter(([, p]) => p)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sq, p]) => `${sq}: { color: '${p!.color}', role: '${p!.role}' }`)
        .join(', ')} }`;
    const after1 = replay(['b3b10']);
    const black1 = kernel
      .legalMoves(after1)
      .map((m) => `${m.from}${m.to}`)
      .sort();
    if (black1.join() !== ['a10b10', 'h8h1'].join())
      throw new Error(`site module: Black's replies to 1. Cxb10 are ${black1.join(',')}`);
    const dead2m = (() => {
      const g = withSeats.find((x) => x.id === 'best-2000000')!;
      let st = kernel.initial('dead-2m');
      for (const m of g.moves.slice(0, 35)) st = kernel.apply(st, kernel.fromUci(st, m.u)!);
      const mobile = new Set(['chariot', 'horse', 'cannon', 'soldier']);
      if (Object.values(st.board).some((p) => p && mobile.has(p.role)))
        throw new Error('site module: the 2M game at ply 35 still has a mobile piece');
      return st;
    })();
    const module = `// Generated by scripts/gen-anti-diagrams.mts in this repository (--blog).
// Do not hand-edit: the positions are replayed through the anti-xiangqi rule
// kernel there (scripts/variant-lab/lab/variants/anti-xiangqi.ts on
// packages/game/src/xiangqi-rule-kernel.ts) and asserted before they are
// written out, so a rules change redraws these boards instead of leaving them
// quietly wrong. Drawn with the shared xiangqi diagram toolkit so they follow
// the reader's board and piece pickers like every other xiangqi figure.

import type { XiangqiPiece, XiangqiSquare } from '@mistboard/game';
import {
  activeXiangqiPieceSet,
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';

type Board = Partial<Record<XiangqiSquare, XiangqiPiece>>;

const PAIR_W = XQ_BOARD_W * 2 + 28;
const PAIR_GAP_X = XQ_BOARD_W + 28;
const FIGURE_H = XQ_BOARD_H + 34;

/** After 1. Cxb10: Black to move, and the kernel says these are the only two captures. */
export const ANTI_AFTER_1: Board = ${boardLiteral(after1)};
/** After 1. Cxb10 Cxh1 2. Rxh1 Rxb10: the ending both sides reach, Red to move. */
export const ANTI_SURVIVOR: Board = ${boardLiteral(survivor)};
/** After 1. Cxb10 Cxh1 2. Cxd10 Kxd10 3. Rxh1: its cousin, Black to move. */
export const ANTI_COUSIN: Board = ${boardLiteral(cousin)};
/** The 2M self-play game at ply 35: nothing left that can ever capture. */
export const ANTI_DEAD: Board = ${boardLiteral(dead2m)};

export const ANTI_XIANGQI_DECISION = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    xqBoardSvg({
      state: xqVisionDemoState('anti-after-1', ANTI_AFTER_1),
      x: PAIR_GAP_X / 2,
      y: 0,
      label: 'AFTER 1. Cxb10: BLACK MUST CAPTURE',
      perspective: 'red',
      arrows: [
        { from: 'a10' as XiangqiSquare, to: 'b10' as XiangqiSquare },
        { from: 'h8' as XiangqiSquare, to: 'h1' as XiangqiSquare },
      ],
    }),
  );

export const ANTI_XIANGQI_SURVIVORS = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    [
      xqBoardSvg({
        state: xqVisionDemoState('anti-survivor', ANTI_SURVIVOR),
        x: 0,
        y: 0,
        label: '2. Rxh1 Rxb10: RED TO MOVE',
        perspective: 'red',
      }),
      xqBoardSvg({
        state: xqVisionDemoState('anti-cousin', ANTI_COUSIN),
        x: PAIR_GAP_X,
        y: 0,
        label: '2. Cxd10 Kxd10 3. Rxh1: BLACK TO MOVE',
        perspective: 'red',
      }),
    ].join(''),
  );

export const ANTI_XIANGQI_DEAD = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    xqBoardSvg({
      state: xqVisionDemoState('anti-dead', ANTI_DEAD),
      x: PAIR_GAP_X / 2,
      y: 0,
      label: 'PLY 35 OF THE 2M GAME: A DEAD BOARD',
      perspective: 'red',
      zones: true,
    }),
  );

// The card: both generals in their discs, upside down. In this game they are
// ordinary pieces and everyone is trying to lose.
const THUMB_W = 160;
const THUMB_H = 100;
const THUMB_SIZE = 74;

export const ANTI_XIANGQI_THUMBNAIL = () => {
  const gap = Math.round(THUMB_SIZE * 0.06);
  const x0 = (THUMB_W - (THUMB_SIZE * 2 + gap)) / 2;
  const y = (THUMB_H - THUMB_SIZE) / 2;
  const disc = (color: 'red' | 'black', x: number) =>
    \`<g transform="rotate(180 \${x + THUMB_SIZE / 2} \${y + THUMB_SIZE / 2})">\${renderXiangqiPieceGlyphed({ role: 'general', color }, activeXiangqiPieceSet, { x, y, size: THUMB_SIZE })}</g>\`;
  return [
    \`<svg class="xq-article-svg" viewBox="0 0 \${THUMB_W} \${THUMB_H}" role="img" aria-label="Anti Xiangqi" xmlns="http://www.w3.org/2000/svg">\`,
    disc('red', x0),
    disc('black', x0 + THUMB_SIZE + gap),
    '</svg>',
  ].join('');
};
`;
    writeFileSync(SITE_MODULE, module);
    // The board literals come out on one line each; hand them to the repo's
    // formatter so the generated file passes the same gate as a written one.
    execSync(`npx biome format --write "${SITE_MODULE}"`, {
      cwd: path.join(HERE, '..'),
      stdio: 'ignore',
    });
    console.log('  apps/web/src/anti-xiangqi-article-diagrams.ts');
  }
  // ── The public repository's viewer: the same widgets on one page ─────────
  // `--repo` writes games/index.html into the anti-xiangqi evidence
  // repository: every game in the viewer and the whole opening table, with
  // the piece art beside it, so it opens from a folder with no server.
  if (process.argv.includes('--repo')) {
    const REPO = '/Users/brianliou/projects/anti-xiangqi';
    const GAMES = path.join(REPO, 'games');
    mkdirSync(path.join(GAMES, 'pieces'), { recursive: true });
    for (const rel of blogArt) {
      writeFileSync(
        path.join(GAMES, 'pieces', rel.replace(/\//g, '-')),
        readFileSync(path.join(PUBLIC, 'piece-sets', rel)),
      );
    }
    const local = (s: string) =>
      s.replace(
        "const ART = '/assets/posts/anti-xiangqi/pieces/xiangqi-international-';",
        "const ART = 'pieces/xiangqi-international-';",
      );
    const games = instances.find((i) => i.id === 'anti-games')!;
    const page = `<!doctype html>
<!-- Generated by scripts/gen-anti-diagrams.mts in the mistboard repository (--blog --repo). Do not hand-edit. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anti xiangqi: every engine game, and the opening table</title>
<style>
body { margin: 0; padding: 24px 16px 48px; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1c1e; background: #fafaf8; }
main { max-width: 900px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2.5rem 0 .5rem; }
p { max-width: 68ch; margin: .5rem 0 1rem; color: #3a3a40; }
</style>
${WIDGET_CSS}
</head>
<body>
<main>
<h1>Anti xiangqi: every engine game, and the opening table</h1>
<p>Every game behind the write-up, replayed by the rule kernel as referee, and the opening chain as a table. Arrow keys step a game once a widget has focus. Notation is chess-style: R chariot, H horse, E elephant, A advisor, K general, C cannon, P soldier; files a to i from Red's left, ranks 1 to 10 from Red's side. The three best-play games are shown as their mirror images (the engine opened 1. Cxh10) so their files match the rest.</p>
<h2>The games</h2>
${widgetHtml(games)}
<h2>The opening table</h2>
<p>Every position in the chain of forced captures, every capture the side to move can choose from it, and what each leads to. The chip is the value from there with best play on both sides; the small print is the evidence, a proof where one closed and the engine's verdict where none did. At an ending, the viewer plays on through the proof's main line or the engine's game.</p>
${explorerInstanceHtml.replace(/\{\{ include\.id \}\}/g, 'anti-explorer').replace(/\{\{ include\.start \}\}/g, '')}
${local(WIDGET_JS)}
${local(explorerLibHtml)}
</main>
</body>
</html>
`;
    writeFileSync(path.join(GAMES, 'index.html'), page);
    console.log(`  ${GAMES}/index.html (+ ${blogArt.size} piece images)`);
  }
}
