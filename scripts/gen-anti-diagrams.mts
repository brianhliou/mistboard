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
type XiangqiMove = import('@mistboard/game').XiangqiMove;
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
function mv(uci: string): { from: XiangqiSquare; to: XiangqiSquare } {
  return {
    from: uci.slice(
      0,
      uci.length === 4 ? 2 : uci.indexOf('1') > 0 && uci.length === 5 && uci[2] === '0' ? 3 : 2,
    ) as XiangqiSquare,
    to: '' as XiangqiSquare,
  } as never;
}
/** Split a UCI move into from/to (files a-i, ranks 1-10). */
function squares(uci: string): { from: XiangqiSquare; to: XiangqiSquare } {
  const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(uci);
  if (!m) throw new Error(`bad uci ${uci}`);
  return { from: m[1] as XiangqiSquare, to: m[2] as XiangqiSquare };
}
void mv;

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
  boards([{ id: 'survivor', board: board(survivor), label: `${sanLine(QUIET)}, RED TO MOVE` }]),
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
  'dump-mechanism',
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
  `After ${sanLine(RECAPTURE)} the proof runs 30 plies and covers ${P.proofSize} positions. Each board shows the moves about to be played. Red\u2019s first move, 3. Ra2, is quiet, so Black may play anything: 42 legal replies, and the certificate answers every one. Along the main line the door then shuts. 4. Rb2 leaves Black exactly one legal move, Cxb1; 5. Rxb1 Rxb1 are both compelled; 6. Ke2 leaves Black one legal move again, the chariot taking the elephant on c1. Red feeds its pieces to Black\u2019s chariot one at a time, on Red\u2019s schedule, until Red has none.`,
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
      label: 'NOTHING HERE CAN EVER CAPTURE ANYTHING',
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" font-family="${FONT}"><rect width="${width}" height="${height}" fill="#faf6ee"/>${body}</svg>`;
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
  const H = 560;
  const left = 30;
  const right = 80;
  const top = 44;
  const sx = (W - left - right) / (next - 1);
  const sy = (H - top - 60) / 18;
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
  const body = [
    ...edges,
    ...dots,
    ...[4, 6, 8, 10, 12, 14, 16, 18].map((d) =>
      text(W - 10, top + d * sy + 4, `ply ${d}`, { anchor: 'end', size: 11, fill: MUTED }),
    ),
    text(
      left,
      20,
      'The opening cascade: one ply per row, every ply a capture. A line branches where the mover chose between captures and stops where captures ran out.',
      { size: 13, weight: 600 },
    ),
    text(
      left,
      H - 14,
      'Ending dots: red, Red wins from there; black, Black wins; gold, a stall. Large dots are proven. The gold paths at either edge are the two lines that hold.',
      { size: 12, fill: MUTED },
    ),
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
}
