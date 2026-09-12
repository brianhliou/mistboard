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
const sweep = JSON.parse(
  readFileSync(path.join(OUTDIR, 'exits-100k-stall-fewerPieces.json'), 'utf8'),
) as { nodes: number; rows: Row[] };
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
figure(
  'survivor',
  boards([{ id: 'survivor', board: board(survivor), label: `AFTER ${sanLine(QUIET)}` }]),
  `Four plies in. ${pieceCount(survivor, 'red')} pieces each, Red to move, no capture on the board. The cascade is over and nobody has lost yet. From here the engine, playing both sides at one, two and five million nodes a move, drew every game.`,
  true,
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
  for (const f of figures) {
    if (f.wide) {
      // Data figures are plain SVG files, referenced by the post as images.
      writeFileSync(path.join(BLOG_ASSETS, `${f.slug}.svg`), `${f.svg}\n`);
      console.log(`  assets/posts/anti-xiangqi/${f.slug}.svg`);
      continue;
    }
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
  for (const rel of blogArt) {
    writeFileSync(
      path.join(BLOG_ASSETS, 'pieces', rel.replace(/\//g, '-')),
      readFileSync(path.join(PUBLIC, 'piece-sets', rel)),
    );
  }
  console.log(`  assets/posts/anti-xiangqi/pieces/ (${blogArt.size} files)`);
  const { renderXiangqiPieceGlyphed } = await import('../apps/web/src/xiangqi-piece-sets.js');
  // The cards: a black chariot beside a red general it must take.
  const card = (width: number, height: number, size: number) => {
    const gap = Math.round(size * 0.18);
    const x0 = (width - (size * 2 + gap)) / 2;
    const y = (height - size) / 2;
    return [
      `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Anti Xiangqi">`,
      `<rect width="${width}" height="${height}" fill="#d9bd82"/>`,
      renderXiangqiPieceGlyphed({ role: 'chariot', color: 'black' }, 'international', {
        x: x0,
        y,
        size,
      }),
      `<circle cx="${x0 + size + gap + size / 2}" cy="${y + size / 2}" r="${size * 0.62}" fill="none" stroke="#e08a1e" stroke-width="${Math.max(3, size * 0.07)}"/>`,
      renderXiangqiPieceGlyphed({ role: 'general', color: 'red' }, 'international', {
        x: x0 + size + gap,
        y,
        size,
      }),
      '</svg>',
    ].join('');
  };
  const renderPng = (svg: string, file: string, width: number) => {
    const png = new Resvg(localArt(svg), { fitTo: { mode: 'width', value: width } })
      .render()
      .asPng();
    writeFileSync(path.join(BLOG_ASSETS, file), png);
    console.log(`  assets/posts/anti-xiangqi/${file} (${(png.length / 1024).toFixed(0)} kB)`);
  };
  renderPng(card(160, 100, 60), 'thumbnail.png', 640);
  renderPng(card(120, 63, 36), 'social-card.png', 1200);

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
      2: 'Black declines the chariot recapture, a proven loss, and fires the other cannon down the b-file with Red’s b3 cannon as the screen. The only move that holds.',
      3: 'The chariot takes the cannon. Continuing with 2. Cxd10 would also hold.',
      4: 'Black’s only legal move. The forced part is over: fifteen pieces each, Red to move, no capture on the board.',
      5: 'The first free move of the game. Red puts its last cannon on h3, where it screens Black’s h8 cannon onto the h1 horse: an offer Black cannot refuse.',
      6: 'Only legal move.',
      7: 'The same exchange on the other wing: chariot takes cannon, and Rxh3 will be forced in reply.',
      9: 'Both chariots are now loose on the back ranks with nothing but captures available. For the next fourteen plies each chariot has only captures to make, and the two sides shed material in step.',
      23: 'The last capture of the feast. Five pieces each: general, two advisors, an elephant, one chariot.',
      27: 'Red pulls the lever. The elephant steps to a3, on Black’s chariot’s file, where Black has no other capture: Rxa3 is compelled.',
      31: 'The chariot itself: Ra2, and Black must take it. Red now has nothing that can leave the palace.',
      33: 'The advisor steps into the chariot’s path. Black must take, and Red’s other advisor must take back.',
      35: 'Red: general and one advisor. Black: general, two advisors, an elephant. Nothing on the board can ever capture anything again.',
      44: 'Third occurrence of the position: draw by repetition. Red has fewer pieces and no way to lose them; Black has no way to make Red take anything.',
    },
    'best-5000000': {
      4: 'The same four forced plies as every game.',
      11: 'The chariots take each other’s cannons and Red’s chariot is taken in turn: eleven pieces each, and the game becomes a soldier war.',
      17: 'A soldier offered, a soldier compelled to take, and the chariot compelled to take that: the shedding is symmetrical for the next hundred plies.',
      120: 'Red walks its general into the soldier’s path and Black must take it. Under these rules that is progress for Red.',
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
    records.push({
      id: `best-${nodes}`,
      group: 'Best play, engine against itself',
      label: `${nodes / 1e6}M nodes a move, ${g.plies} plies`,
      moves: g.moves,
      result: `${g.winner ? `${g.winner} wins` : 'Draw'} by ${g.reason} after ${g.plies} plies, ${nodes / 1e6} million nodes a move for both sides.`,
    });
  }
  const sweepGames = JSON.parse(
    readFileSync(path.join(OUTDIR, 'exits-100k-stall-fewerPieces.json'), 'utf8'),
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
  type Instance = { id: string; records: typeof encoded; picker: boolean; caption?: string };
  const widgetHtml = (inst: Instance) => {
    const data = JSON.stringify(inst.records).replace(/</g, '\\u003c');
    const picker = inst.picker
      ? `<div class="anxq-pick"><div class="anxq-tabs" role="tablist" id="${inst.id}-tabs"></div><label class="anxq-more">More games <select id="${inst.id}-more"></select></label></div>`
      : '';
    return `<!-- Generated by scripts/gen-anti-diagrams.mts in the mistboard repo (--blog). Do not hand-edit.
     Every record was played under the rule kernel as referee; the page applies moves and draws. -->
<div id="${inst.id}" class="anxq" tabindex="0" data-anxq>
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
    <div class="anxq-caption" id="${inst.id}-caption"></div>
  </div>
  <div class="anxq-rail">
    <div class="anxq-rail-inner">
      <div class="anxq-moves" id="${inst.id}-moves"></div>
      <div class="anxq-result" id="${inst.id}-result"></div>
    </div>
  </div>
</div>
${inst.caption ? `<div class="anxq-credit">${inst.caption}</div>` : ''}
<script type="application/json" id="${inst.id}-data">${data}</script>
</div>
`;
  };
  const WIDGET_CSS = `<style>
.anxq { --anxq-border: var(--line-strong, #d9d9d4); --anxq-panel: var(--surface, #fff); --anxq-muted: var(--text-3, #6a6a70); --anxq-heading: var(--text, #1c1c1e); --anxq-hover: var(--surface-2, #f4f4f2); --anxq-accent: hsl(165, 56%, 28%); --anxq-on-accent: #fff; margin: 1.5rem 0 2rem; outline: none; font-size: 15px; }
.anxq-pick { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-bottom: 8px; }
.anxq-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.anxq-tab { border: 1px solid var(--anxq-border); background: transparent; color: var(--anxq-heading); border-radius: 999px; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 14px; }
.anxq-tab small { color: var(--anxq-muted); font-size: 12px; margin-left: 4px; }
.anxq-tab[aria-selected="true"] { background: var(--anxq-heading); color: var(--anxq-panel); border-color: var(--anxq-heading); }
.anxq-tab[aria-selected="true"] small { color: inherit; opacity: .75; }
.anxq-more { font-size: 13px; color: var(--anxq-muted); }
.anxq-more select { font: inherit; font-size: 14px; color: var(--anxq-heading); background: transparent; border: 1px solid var(--anxq-border); border-radius: 8px; padding: 4px 8px; max-width: 100%; margin-left: 6px; }
.anxq-header { font-size: 14px; font-weight: 600; color: var(--anxq-muted); text-align: center; margin-bottom: 6px; }
.anxq-card { display: flex; border: 1px solid var(--anxq-border); border-radius: 10px; background: var(--anxq-panel); overflow: hidden; }
.anxq-board-col { display: flex; flex: 0 0 auto; flex-direction: column; width: min(100%, 356px); min-width: 0; }
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
.anxq-caption { min-height: 3.2em; border-top: 1px solid var(--anxq-border); padding: 8px 14px 10px; font-size: 14px; line-height: 1.45; color: var(--anxq-heading); }
.anxq-caption .san { font-family: ui-monospace, Menlo, monospace; font-weight: 600; }
.anxq-caption .who { color: var(--anxq-muted); font-size: 13px; }
.anxq-caption p { margin: 4px 0 0; }
.anxq-rail { position: relative; flex: 1; min-width: 0; border-left: 1px solid var(--anxq-border); }
.anxq-rail-inner { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.anxq-moves { flex: 1; min-height: 0; overflow: auto; padding: 6px 4px; display: grid; grid-template-columns: 24px minmax(0, 1fr) minmax(0, 1fr); gap: 1px 2px; align-content: start; align-items: baseline; }
.anxq-moves .n { padding-left: 0; font-size: 13.5px; color: var(--anxq-muted); font-variant-numeric: tabular-nums; }
.anxq-moves .n::after { content: "."; }
.anxq-moves button { font: inherit; text-align: left; background: none; border: 0; padding: 3px 5px; border-radius: 4px; color: var(--anxq-heading); cursor: pointer; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.anxq-moves button.forced::after { content: "!"; color: var(--anxq-muted); font-weight: 400; }
.anxq-moves button:hover { background: var(--anxq-hover); }
.anxq-moves button.cur, .anxq-moves button.cur:hover { background: var(--anxq-accent); color: var(--anxq-on-accent); }
.anxq-moves button.cur.forced::after { color: var(--anxq-on-accent); opacity: .8; }
.anxq-result { flex: none; display: flex; align-items: center; justify-content: center; min-height: 39px; padding: 4px 8px; border-top: 1px solid var(--anxq-border); background: var(--anxq-panel); color: var(--anxq-muted); font-size: 12px; font-weight: 600; text-align: center; line-height: 1.3; }
.anxq-credit { margin-top: 6px; font-size: 12px; color: var(--anxq-muted); text-align: center; }
@media (max-width: 640px) { .anxq-card { flex-direction: column; } .anxq-board-col { width: 100%; } .anxq-rail { border-left: 0; border-top: 1px solid var(--anxq-border); min-height: 220px; } }
</style>`;
  const WIDGET_JS = `<script>
(() => {
  const ROLE = { k: 'general', a: 'advisor', b: 'elephant', n: 'horse', r: 'chariot', c: 'cannon', p: 'soldier' };
  const ART = '/assets/posts/anti-xiangqi/pieces/xiangqi-international-';
  const FRAME = { general: { x: -7, y: -7, w: 114 }, advisor: { x: -7, y: -7, w: 114 }, elephant: { x: -5, y: -5, w: 110 }, horse: { x: -7, y: -7, w: 114 }, chariot: { x: -5.5, y: -7, w: 111 }, cannon: { x: -11, y: -11, w: 122 }, soldier: { x: 0, y: 0, w: 100 } };
  const M = 18, C = 31, PIECE = 28;
  const xOf = (f) => M + f * C, yOf = (r) => M + (10 - r) * C;
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
  function boardsOf(game) {
    const out = [parsePlacement(game.start)];
    let b = out[0];
    for (const mv of game.moves) { const { from, to } = sq(mv.u); b = { ...b }; b[to] = b[from]; delete b[from]; out.push(b); }
    return out;
  }
  const L = (x1, y1, x2, y2) => '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#4b3c2a" stroke-width="1"/>';
  function grid() {
    const g = ['<rect x="0" y="0" width="284" height="315" rx="8" fill="#d9bd82"/>'];
    for (let r = 0; r < 10; r++) g.push(L(M, M + r * C, M + 8 * C, M + r * C));
    for (let f = 0; f < 9; f++) {
      if (f === 0 || f === 8) g.push(L(M + f * C, M, M + f * C, M + 9 * C));
      else { g.push(L(M + f * C, M, M + f * C, M + 4 * C)); g.push(L(M + f * C, M + 5 * C, M + f * C, M + 9 * C)); }
    }
    for (const y0 of [0, 7]) { g.push(L(M + 3 * C, M + y0 * C, M + 5 * C, M + (y0 + 2) * C)); g.push(L(M + 5 * C, M + y0 * C, M + 3 * C, M + (y0 + 2) * C)); }
    return g.join('');
  }
  const GRID = grid();
  function render(svg, board, mv) {
    const parts = [GRID];
    if (mv) {
      const { from, to } = sq(mv.u);
      const fx = xOf(from.charCodeAt(0) - 97), fy = yOf(Number(from.slice(1))), tx = xOf(to.charCodeAt(0) - 97), ty = yOf(Number(to.slice(1)));
      parts.push('<circle cx="' + fx + '" cy="' + fy + '" r="5" fill="#3a63c7" opacity=".9"/>');
      parts.push('<circle cx="' + tx + '" cy="' + ty + '" r="16" fill="none" stroke="#3a63c7" stroke-width="2.5"/>');
    }
    for (const s in board) {
      const p = board[s], cx = xOf(s.charCodeAt(0) - 97), cy = yOf(Number(s.slice(1))), k = PIECE / 100, fr = FRAME[p.role], x = cx - PIECE / 2, y = cy - PIECE / 2;
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (46 * k) + '" fill="#fef0d7" stroke="' + (p.color === 'red' ? '#c30d0d' : '#202427') + '" stroke-width="' + (2.8 * k) + '"/>');
      parts.push('<image href="' + ART + p.color + '-' + p.role + '.png" x="' + (x + fr.x * k) + '" y="' + (y + fr.y * k) + '" width="' + (fr.w * k) + '" height="' + (fr.w * k) + '" preserveAspectRatio="xMidYMid meet"/>');
    }
    svg.innerHTML = parts.join('');
  }
  function mount(root) {
    const id = root.id;
    const $ = (suffix) => root.querySelector('#' + id + '-' + suffix);
    const GAMES = JSON.parse($('data').textContent);
    const svg = $('board');
    let gi = 0, at = 0, boards = [];
    function show() {
      const game = GAMES[gi], mv = at > 0 ? game.moves[at - 1] : null, board = boards[at];
      render(svg, board, mv);
      let red = 0, black = 0;
      for (const s in board) { if (board[s].color === 'red') red++; else black++; }
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
    function select(i) {
      gi = i; at = 0;
      const game = GAMES[gi];
      boards = boardsOf(game);
      root.querySelectorAll('.anxq-tab').forEach((t) => t.setAttribute('aria-selected', Number(t.dataset.index) === i ? 'true' : 'false'));
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
    const tabs = $('tabs');
    if (tabs) GAMES.forEach((g, i) => {
      if (!g.tab) return;
      const b = document.createElement('button'); b.className = 'anxq-tab'; b.setAttribute('role', 'tab'); b.dataset.index = String(i); b.innerHTML = g.tab; b.addEventListener('click', () => select(i)); tabs.appendChild(b);
    });
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
  const recaptureRec = withSeats.find((g) => g.id === 'proof-82');
  if (!recaptureRec) throw new Error('no proof line for the chariot recapture (leaf 82)');
  const recaptureInstance = {
    ...recaptureRec,
    label: '1...Rxb10: the proven loss, main line',
    red: 'Red (the proof)',
    black: 'Black (any reply)',
    result:
      'Red wins by extinction after 34 plies. Every Black move here is one the certificate answers; the moves marked ! were the only legal ones.',
    moves: recaptureRec.moves.map((m, i) => ({ ...m, n: recaptureNotes[i + 1] ?? undefined })),
    tab: undefined,
  };
  const instances: Instance[] = [
    { id: 'anti-games', records: withSeats, picker: true },
    {
      id: 'anti-line-recapture',
      records: [recaptureInstance],
      picker: false,
      caption:
        'The main line of the certificate for 1...Rxb10. Step through it: at every Black move, either it was the only legal move or the certificate holds a reply to each alternative.',
    },
  ];
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
}
