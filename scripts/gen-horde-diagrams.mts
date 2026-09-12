// Render the Horde Xiangqi figures for the variant-lab write-up, using
// Mistboard's own diagram functions (same plumbing as gen-atomic-diagrams.mts).
//
//   npx tsx scripts/gen-horde-diagrams.mts [outDir]
//
// Every position is computed through the lab's rule kernel: the game
// positions are replayed from the lab artifacts under docs-private, the
// covered points are the kernel's attack sets, and every claim a caption
// makes (the chariot's move is legal, the block loses N soldiers, the general
// is smothered and not in check) is asserted here before a file is written.
//
// Output (default docs-private/variant-lab/horde-xiangqi/figures/):
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

const { XQ_BOARD_H, XQ_BOARD_W, xqBoardSvg, xqCoord, xqPoint, xqSvg, xqVisionDemoState } =
  await import('../apps/web/src/articles/diagrams.js');
const { renderBoardSvg } = await import('../packages/board-render/src/board-svg.js');
const {
  createXiangqiRuleKernel,
  generalAttacked,
  isAttacked,
  legalMovesOn,
  parsePlacement,
} = await import('../packages/game/src/xiangqi-rule-kernel.js');
const { HORDE_FORMATIONS, hordeXiangqiVariant } = await import(
  './variant-lab/lab/variants/horde-xiangqi.js'
);
const { resolveRules } = await import('./variant-lab/lab/rules.js');
type XiangqiBoard = import('@mistboard/game').XiangqiBoard;
type XiangqiSquare = import('@mistboard/game').XiangqiSquare;
type XiangqiPiece = import('@mistboard/game').XiangqiPiece;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = path.dirname(
  execSync('git rev-parse --path-format=absolute --git-common-dir', {
    cwd: HERE,
    encoding: 'utf8',
  }).trim(),
);
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const OUT = outArg
  ? path.resolve(outArg)
  : path.join(MAIN_ROOT, 'docs-private/variant-lab/horde-xiangqi/figures');
const ARTIFACTS = path.join(MAIN_ROOT, 'docs-private/variant-lab/out/horde-xiangqi');
const PUBLIC = path.join(HERE, '../apps/web/public');
const CSS = path.join(HERE, '../apps/web/src/articles.css');

// ── Kernels and games ──────────────────────────────────────────────────────

const standard = createXiangqiRuleKernel({
  royal: { red: false, black: true },
  facing: 'off',
  extinction: { red: 'loses', black: 'none' },
});
const veteran = createXiangqiRuleKernel({
  royal: { red: false, black: true },
  facing: 'off',
  extinction: { red: 'loses', black: 'none' },
  veteranSoldiers: { red: true, black: false },
});

function fen(placement: string): XiangqiBoard {
  const board = parsePlacement(placement.split(/\s+/)[0] ?? '');
  if (!board) throw new Error(`bad placement ${placement}`);
  return board;
}
function soldiers(board: XiangqiBoard): number {
  return Object.values(board).filter((p) => p.color === 'red' && p.role === 'soldier').length;
}
/** Points the red pieces attack under `rules` (the kernel's own attack set). */
function attacked(
  board: XiangqiBoard,
  rules: typeof standard.rules,
  by: 'red' | 'black',
): XiangqiSquare[] {
  const out: XiangqiSquare[] = [];
  for (const file of 'abcdefghi') {
    for (let rank = 1; rank <= 10; rank += 1) {
      const sq = `${file}${rank}` as XiangqiSquare;
      if (isAttacked(board, by, sq, rules)) out.push(sq);
    }
  }
  return out;
}

/** The lab artifact for one formation + soldier rule + clock, and the game at one budget. */
function labGame(
  formation: string,
  soldiersRule: 'standard' | 'veteran',
  clock: number,
  nodes: number,
) {
  const files = readdirSync(ARTIFACTS).filter((f) => f.startsWith('bestplay-'));
  for (const f of files) {
    const a = JSON.parse(readFileSync(path.join(ARTIFACTS, f), 'utf8'));
    if (a.rules.formation !== formation || (a.rules.soldiers ?? 'standard') !== soldiersRule)
      continue;
    if (Number(a.rules.progressClock) !== clock) continue;
    const g = a.result.games.find((x: { nodes: number }) => x.nodes === nodes);
    if (!g) continue;
    const { kernel } = hordeXiangqiVariant.create(
      resolveRules(hordeXiangqiVariant.ruleSchema, a.rules),
    );
    return { moves: g.moves as string[], winner: g.winner, reason: g.reason, kernel, file: f };
  }
  throw new Error(
    `no bestplay artifact for ${formation} ${soldiersRule} clock ${clock} at ${nodes}`,
  );
}
function replay(game: ReturnType<typeof labGame>, plies: number) {
  let s = game.kernel.initial('replay');
  for (let i = 0; i < plies; i += 1) {
    const m = game.kernel.fromUci(s, game.moves[i]!);
    if (!m) throw new Error(`bad move ${game.moves[i]} at ply ${i}`);
    s = game.kernel.apply(s, m);
  }
  return s;
}

// ── SVG plumbing ───────────────────────────────────────────────────────────

function diagramStyles(collapseVars: boolean): string {
  const css = readFileSync(CSS, 'utf8');
  const out: string[] = [];
  for (const m of css.matchAll(/\.xq-article-svg (\.xq-diagram-[a-z-]+)\s*\{([^}]*)\}/g)) {
    out.push(`${m[1]}{${m[2].trim().replace(/\s+/g, ' ')}}`);
  }
  if (out.length === 0) throw new Error('no .xq-diagram-* rules found in articles.css');
  let joined = out.join('');
  if (!collapseVars) return `<style>${joined}</style>`;
  // A standalone SVG has no page tokens (and resvg cannot read var()), so
  // every var(--x, fallback) collapses to its fallback, innermost first.
  for (let i = 0; i < 4; i += 1)
    joined = joined.replace(/var\(--[a-z0-9-]+,\s*([^()]*(?:\([^()]*\))?[^()]*)\)/g, '$1');
  return `<style>${joined}.xq-diagram-title{fill:#4b3c2a}</style>`;
}
const STYLES = diagramStyles(true);
// The blog page maps --site-heading / --site-text itself, so its copies keep the vars.
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
/** Veteran boards: every red soldier wears the crossed-soldier art, because that is its move. */
function veteranArt(svg: string): string {
  return svg.replace(
    /\/piece-sets\/xiangqi\/international\/red-soldier\.png/g,
    '/piece-sets/xiangqi/international/red-crossed-soldier.png',
  );
}

const GAP = 28;
const FIGURE_H = XQ_BOARD_H + 34;
function state(id: string, board: XiangqiBoard) {
  return xqVisionDemoState(id, board as Partial<Record<XiangqiSquare, XiangqiPiece>>);
}
type BoardSpec = {
  id: string;
  board: XiangqiBoard;
  label: string;
  arrows?: Array<{ from: XiangqiSquare; to: XiangqiSquare }>;
  dots?: Array<{ square: XiangqiSquare; blocked?: boolean; capture?: boolean }>;
  veteran?: boolean;
  /** Rings, drawn on top: e.g. the points a horde covers. */
  rings?: Array<{ square: XiangqiSquare; color: string; heavy?: boolean }>;
};
function ringOverlay(rings: BoardSpec['rings'], x0: number, y0: number): string {
  return (rings ?? [])
    .map((r) => {
      const { file, rank } = xqCoord(r.square);
      const { x, y } = xqPoint(file, rank, 'red', x0, y0 + 28);
      return `<circle cx="${x}" cy="${y}" r="${r.heavy ? 20 : 16}" fill="none" stroke="${r.color}" stroke-width="${r.heavy ? 4 : 3}" opacity="0.95"/>`;
    })
    .join('');
}
function boards(specs: BoardSpec[]): string {
  const width = XQ_BOARD_W * specs.length + GAP * (specs.length - 1);
  return xqSvg(
    width,
    FIGURE_H,
    specs
      .map((s, i) => {
        const x = i * (XQ_BOARD_W + GAP);
        const svg = xqBoardSvg({
          state: state(s.id, s.board),
          x,
          y: 0,
          label: s.label,
          perspective: 'red',
          arrows: s.arrows,
          dots: s.dots,
          overlay: ringOverlay(s.rings, x, 0),
        });
        return s.veteran ? veteranArt(svg) : svg;
      })
      .join(''),
  );
}

const figures: Array<{ slug: string; caption: string; file: string; svg: string; boards: number }> =
  [];
function figure(slug: string, svg: string, caption: string, boardCount = 2): void {
  // xqSvg already declares xmlns; a second declaration is a hard XML error for rsvg/resvg.
  const withNs = svg.includes('xmlns=')
    ? svg
    : svg.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" `);
  const out = `<!-- Generated by scripts/gen-horde-diagrams.mts in the mistboard repo. Do not hand-edit. -->\n${localArt(withNs).replace('>', `>${STYLES}`)}`;
  writeFileSync(path.join(OUT, `${slug}.svg`), `${out}\n`);
  figures.push({ slug, caption, file: `${slug}.svg`, svg, boards: boardCount });
  console.log(`  figures/${slug}.svg`);
}

mkdirSync(OUT, { recursive: true });

// ── 1. The arrays ──────────────────────────────────────────────────────────

for (const id of ['solid36', 'forward36', 'array32'] as const) {
  if (soldiers(fen(HORDE_FORMATIONS[id])) !== Number(id.replace(/\D/g, '')))
    throw new Error(`${id} count`);
}
figure(
  'arrays',
  boards([
    { id: 'arr-solid36', board: fen(HORDE_FORMATIONS.solid36), label: '36 SOLDIERS, RANKS 1-4' },
    {
      id: 'arr-forward36',
      board: fen(HORDE_FORMATIONS.forward36),
      label: '36 SOLDIERS, RANKS 2-5',
    },
    {
      id: 'arr-array32',
      board: fen(HORDE_FORMATIONS.array32),
      label: '32, WITH XIANGQI’S FIVE POINTS',
    },
  ]),
  'Three of the start arrays. Red is the horde: soldiers only, no general, first move. Black is the standard army. The horde wins by checkmate, the army by taking the last soldier. The left array is the parent’s count on the parent’s four ranks; the middle one starts a rank closer, so its front rank crosses the river on its first move; the right one puts the front five on xiangqi’s own soldier points.',
  3,
);

// ── 2. The chariot behind the wall ─────────────────────────────────────────

// The solid36 1M game (standard soldiers, 60-ply clock). Black's 25th move is
// f5f1: the chariot drops to the first rank through the emptied f-file.
const G1 = labGame('solid36', 'standard', 60, 1_000_000);
const PLY_F5F1 = G1.moves.indexOf('f5f1');
if (PLY_F5F1 < 0 || PLY_F5F1 % 2 !== 1)
  throw new Error(`f5f1 should be a black move in the solid36 game, index ${PLY_F5F1}`);
const before = replay(G1, PLY_F5F1);
const afterDrop = replay(G1, PLY_F5F1 + 1);
if (
  !legalMovesOn(before.board, 'black', standard.rules).some((m) => m.from === 'f5' && m.to === 'f1')
)
  throw new Error('f5f1 must be legal');
if (afterDrop.board.f1?.role !== 'chariot') throw new Error('the chariot should stand on f1');
// Nothing red attacks the chariot on f1: the horde has no backward attack.
if (isAttacked(afterDrop.board, 'red', 'f1', standard.rules))
  throw new Error('f1 should be unattackable by the horde');
const later = replay(G1, PLY_F5F1 + 31);
const eaten = soldiers(before.board) - soldiers(later.board);
if (eaten < 8) throw new Error(`expected at least 8 soldiers gone in 30 plies, got ${eaten}`);
figure(
  'chariot-behind',
  boards([
    {
      id: 'chariot-before',
      board: before.board,
      label: `MOVE ${Math.ceil((PLY_F5F1 + 1) / 2)}: THE f-FILE IS OPEN`,
      arrows: [{ from: 'f5', to: 'f1' }],
    },
    {
      id: 'chariot-after',
      board: later.board,
      label: `15 MOVES LATER: ${eaten} SOLDIERS GONE`,
    },
  ]),
  `From the million-node game on the parent’s array. Black’s chariot drops through the f-file, which the horde had emptied by advancing, to the first rank. No red soldier attacks backward, so nothing can touch it, and it takes a soldier a move from behind. Fifteen moves later ${eaten} soldiers are gone and the army has lost nothing for them. Every standard-soldier game ends this way.`,
);

// ── 3. Cover: what a pawn does that a soldier cannot ───────────────────────

// All three boards show the position AFTER the middle piece has stepped
// forward. Green rings: points the white pawns / red soldiers protect, i.e.
// where a capture would be answered. The question is whether the piece that
// just moved is among them.
const CHESS_PIECES = [
  { file: 2, rank: 2, color: 'white', role: 'pawn' },
  { file: 3, rank: 3, color: 'white', role: 'pawn' },
  { file: 4, rank: 4, color: 'white', role: 'pawn' },
  { file: 4, rank: 6, color: 'black', role: 'rook' },
] as const;
// Xiangqi after e4-e5: soldiers d4, e5, f4; a black chariot on e7 eyes e5.
const XQ_AFTER = fen('4k4/9/9/4r4/9/4P4/3P1P3/9/9/9 b - - 0 1');
const stdCover = attacked(XQ_AFTER, standard.rules, 'red');
if (stdCover.sort().join() !== ['d5', 'e6', 'f5'].join())
  throw new Error(`standard cover ${stdCover.join(',')}`);
if (isAttacked(XQ_AFTER, 'red', 'e5', standard.rules))
  throw new Error('e5 should be uncovered after the step (standard)');
const vetCover = attacked(XQ_AFTER, veteran.rules, 'red');
if (vetCover.sort().join() !== ['c4', 'd5', 'e4', 'e6', 'f5', 'g4'].sort().join())
  throw new Error(`veteran cover ${vetCover.join(',')}`);
if (isAttacked(XQ_AFTER, 'red', 'e5', veteran.rules))
  throw new Error('e5 should be uncovered after the step (veteran)');
// And the chariot really can take the stepped soldier for nothing in both cases.
for (const k of [standard, veteran]) {
  if (!legalMovesOn(XQ_AFTER, 'black', k.rules).some((m) => m.from === 'e7' && m.to === 'e5'))
    throw new Error('Rxe5 should be legal');
  const taken = { ...XQ_AFTER } as XiangqiBoard;
  delete taken.e7;
  taken.e5 = { color: 'black', role: 'chariot' };
  if (isAttacked(taken, 'red', 'e5', k.rules)) throw new Error('the chariot on e5 should be safe');
}
// Veterans cover each other where they stand: an enemy on e4 could be retaken; standard soldiers could not.
const XQ_RECAPTURE = fen('4k4/9/9/9/9/9/3PrP3/9/9/9 w - - 0 1');
if (
  !isAttacked(XQ_RECAPTURE, 'red', 'e4', veteran.rules) ||
  isAttacked(XQ_RECAPTURE, 'red', 'e4', standard.rules)
)
  throw new Error('veterans should cover their neighbours; standard soldiers should not');

const CHESS_SIZE = XQ_BOARD_H - 28;
const chessX = 0;
const chessBoard = renderBoardSvg([...CHESS_PIECES], [], chessX, 28, CHESS_SIZE, 'white');
const csq = CHESS_SIZE / 8;
const cpt = (file: number, rank: number) => ({
  x: chessX + file * csq + csq / 2,
  y: 28 + (7 - rank) * csq + csq / 2,
});
// Pawn protection after e4-e5: c3 protects b4 d4; d4 protects c5 e5; e5 protects d6 f6.
const chessRings = [cpt(1, 3), cpt(3, 3), cpt(2, 4), cpt(4, 4), cpt(3, 5), cpt(5, 5)]
  .map(
    (p) =>
      `<circle cx="${p.x}" cy="${p.y}" r="${csq * 0.38}" fill="none" stroke="#2f8f3a" stroke-width="3" opacity="0.95"/>`,
  )
  .join('');
const chessTitle = `<text x="${chessX + CHESS_SIZE / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">CHESS: AFTER e4-e5, d4 COVERS e5</text>`;
const xqX1 = CHESS_SIZE + GAP;
const xqX2 = xqX1 + XQ_BOARD_W + GAP;
const coverSvg = xqSvg(
  xqX2 + XQ_BOARD_W,
  FIGURE_H,
  [
    chessTitle,
    chessBoard,
    chessRings,
    xqBoardSvg({
      state: state('cover-std', XQ_AFTER),
      x: xqX1,
      y: 0,
      label: 'SOLDIERS: AFTER e4-e5, NOTHING COVERS e5',
      perspective: 'red',
      overlay: ringOverlay(
        stdCover.map((square) => ({ square, color: '#2f8f3a' })),
        xqX1,
        0,
      ),
    }),
    veteranArt(
      xqBoardSvg({
        state: state('cover-vet', XQ_AFTER),
        x: xqX2,
        y: 0,
        label: 'VETERANS: STILL NOTHING COVERS e5',
        perspective: 'red',
        overlay: ringOverlay(
          vetCover.map((square) => ({ square, color: '#2f8f3a' })),
          xqX2,
          0,
        ),
      }),
    ),
  ].join(''),
);
figure(
  'cover',
  coverSvg,
  'The same step on three boards: the middle piece has just moved one point forward, and the green rings are the points its side now protects. A chess pawn captures diagonally, so the pawn on d4 covers e5 and the pawn that arrived there is safe from the rook: pawns advance as chains. A xiangqi soldier captures the way it moves, straight ahead, so d4 and f4 cover d5 and f5 and nothing covers e5; the chariot takes the soldier for free. Veteran soldiers (right) attack sideways too, which makes the block guard itself where it stands, and still nothing covers the point a soldier steps to. The horde can hold its ground and cannot leave it.',
  3,
);

// ── 4. The fortress ────────────────────────────────────────────────────────

// The 40-soldier veteran game, 120-ply clock: the last capture is at ply 754.
const G40 = labGame('lichess40', 'veteran', 120, 1_000_000);
const F = replay(G40, 754);
const fortressSoldiers = soldiers(F.board);
if (fortressSoldiers !== 12)
  throw new Error(`expected 12 soldiers at ply 754, got ${fortressSoldiers}`);
const armyAt754 = Object.values(F.board)
  .filter((p) => p.color === 'black')
  .map((p) => p.role)
  .sort()
  .join(',');
if (armyAt754 !== 'advisor,chariot,chariot,general') throw new Error(`army at 754 is ${armyAt754}`);
const END40 = replay(G40, G40.moves.length);
if (G40.moves.length !== 1000 || G40.reason !== 'ply-cap')
  throw new Error('the 40-soldier game should hit the 1,000-ply cap');
const lateCaptures: number[] = [];
for (let i = 754; i < 1000; i += 1) {
  const s = replay(G40, i);
  const m = G40.kernel.fromUci(s, G40.moves[i]!)!;
  const v = s.board[m.to];
  if (v) {
    if (v.color !== 'red' || v.role !== 'soldier')
      throw new Error(`a non-soldier capture at ply ${i + 1}`);
    lateCaptures.push(i + 1);
  }
}
if (lateCaptures.join() !== '822,896')
  throw new Error(`late captures at ${lateCaptures.join(',')}`);
if (soldiers(END40.board) !== 10)
  throw new Error(`expected 10 soldiers at the cap, got ${soldiers(END40.board)}`);
figure(
  'fortress',
  boards([
    {
      id: 'fortress-754',
      board: F.board,
      label: 'PLY 754: TWELVE SOLDIERS, K + A + 2R',
      veteran: true,
    },
    {
      id: 'fortress-1000',
      board: END40.board,
      label: 'PLY 1,000: TWO MORE SOLDIERS GONE',
      veteran: true,
    },
  ]),
  'The ending every veteran game above 27 soldiers reaches, here from the 40-soldier array at a million nodes a move. Twelve soldiers against a general, an advisor and two chariots. The soldiers cannot force a way past the chariots, and the chariots take a soldier only when one steps out of the block: two in the next 246 plies, at 822 and 896. Played on from the left position at five million nodes a side for 200 more plies: one capture. At that rate the army needs another thousand plies to finish.',
);

// ── 5. The smother ─────────────────────────────────────────────────────────

// The one equal-strength horde win: 36 soldiers on ranks 2-5, veterans, 120-ply clock.
const GW = labGame('forward36', 'veteran', 120, 1_000_000);
if (GW.winner !== 'red' || GW.reason !== 'stalemate')
  throw new Error(`expected a red win by stalemate, got ${GW.winner} ${GW.reason}`);
const END_W = replay(GW, GW.moves.length);
if (legalMovesOn(END_W.board, 'black', veteran.rules).length !== 0)
  throw new Error('black should have no move');
if (generalAttacked(END_W.board, 'black', veteran.rules))
  throw new Error('the smother must not be a check');
const generalSq = (Object.entries(END_W.board).find(
  ([, p]) => p.color === 'black' && p.role === 'general',
) ?? [])[0] as XiangqiSquare;
const blackPieces = Object.values(END_W.board).filter((p) => p.color === 'black').length;
if (blackPieces !== 1) throw new Error(`expected a bare general, got ${blackPieces} black pieces`);
// The general's palace neighbours that the horde covers.
const gc = xqCoord(generalSq);
const smotherRings: XiangqiSquare[] = [];
for (const [df, dr] of [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const) {
  const f = gc.file + df;
  const r = gc.rank + dr;
  if (f < 3 || f > 5 || r < 8 || r > 10) continue;
  const sq = `${'abcdefghi'[f]}${r}` as XiangqiSquare;
  if (isAttacked(END_W.board, 'red', sq, veteran.rules)) smotherRings.push(sq);
}
figure(
  'smother',
  boards([
    {
      id: 'smother',
      board: END_W.board,
      label: `PLY ${GW.moves.length}: NO MOVE, NO CHECK, RED WINS`,
      veteran: true,
      rings: smotherRings.map((square) => ({ square, color: '#e08a1e', heavy: true })),
    },
  ]),
  'The horde’s finish, from its one win at equal strength (36 veterans on ranks 2 to 5). Both chariots fell late, the general is bare, and every point it could step to is covered by a soldier that does not check it. Xiangqi scores the side with no legal move as the loser; under the parent’s rule this is a draw, and about half of the horde’s wins against weak play go the same way.',
  1,
);

// ── Blog output (--blog): brianhliou.com includes, art, thumbnail, card ────

if (process.argv.includes('--blog')) {
  const { Resvg } = await import('@resvg/resvg-js');
  const BLOG = '/Users/brianliou/projects/brianhliou.github.io';
  const BLOG_ASSETS = path.join(BLOG, 'assets/posts/horde-xiangqi');
  const BLOG_ART = '/assets/posts/horde-xiangqi/pieces';
  const INCLUDES = path.join(BLOG, '_includes');
  mkdirSync(path.join(BLOG_ASSETS, 'pieces'), { recursive: true });
  const blogArt = new Set<string>();
  const blogArtHref = (svg: string) =>
    svg.replace(/href="\/piece-sets\/([^"?]+)\.png[^"]*"/g, (_, rel: string) => {
      blogArt.add(`${rel}.png`);
      return `href="${BLOG_ART}/${rel.replace(/\//g, '-')}.png"`;
    });
  const layout = (n: number) => (n === 1 ? 'single' : n === 2 ? 'pair' : 'triple');
  for (const f of figures) {
    const include = [
      '<!-- Generated by scripts/gen-horde-diagrams.mts in the mistboard repo.',
      '     Do not hand-edit: re-run the generator with --blog. -->',
      `<figure class="xq-figure" data-horde-figure="${f.slug}">`,
      `  <div class="xq-figure-board" data-board="${layout(f.boards)}">${BLOG_STYLES}${blogArtHref(f.svg)}</div>`,
      `  <figcaption>${f.caption}</figcaption>`,
      '</figure>',
    ].join('\n');
    writeFileSync(path.join(INCLUDES, `horde-xq-${f.slug}.html`), `${include}\n`);
    console.log(`  _includes/horde-xq-${f.slug}.html`);
  }
  for (const rel of blogArt) {
    writeFileSync(
      path.join(BLOG_ASSETS, 'pieces', rel.replace(/\//g, '-')),
      readFileSync(path.join(PUBLIC, 'piece-sets', rel)),
    );
  }
  console.log(`  assets/posts/horde-xiangqi/pieces/ (${blogArt.size} files)`);

  // The cards: a red crossed soldier beside a black chariot, the two pieces the post is about.
  const { renderXiangqiPieceGlyphed } = await import('../apps/web/src/xiangqi-piece-sets.js');
  const card = (width: number, height: number, size: number) => {
    const gap = Math.round(size * 0.18);
    const x0 = (width - (size * 2 + gap)) / 2;
    const y = (height - size) / 2;
    return [
      `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Horde Xiangqi">`,
      `<rect width="${width}" height="${height}" fill="#d9bd82"/>`,
      renderXiangqiPieceGlyphed({ role: 'soldier', color: 'red' }, 'international', {
        x: x0,
        y,
        size,
        crossed: true,
      }),
      renderXiangqiPieceGlyphed({ role: 'chariot', color: 'black' }, 'international', {
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
    console.log(`  assets/posts/horde-xiangqi/${file} (${(png.length / 1024).toFixed(0)} kB)`);
  };
  renderPng(card(160, 100, 60), 'thumbnail.png', 640);
  renderPng(card(120, 63, 36), 'social-card.png', 1200);
}

// ── Preview ────────────────────────────────────────────────────────────────

const html = [
  '<!doctype html><meta charset="utf-8"><title>Horde Xiangqi figures</title>',
  '<style>body{font:16px/1.5 system-ui;max-width:960px;margin:32px auto;padding:0 16px;color:#222;background:#f6f4ef}figure{margin:0 0 40px}figcaption{margin-top:8px;color:#444}img,svg{max-width:100%;height:auto}</style>',
  '<h1>Horde Xiangqi: figures</h1><p>Generated by scripts/gen-horde-diagrams.mts through the lab rule kernel and the lab artifacts. Green rings: points attacked. Amber rings: the smother. Veteran soldiers wear the promoted-soldier piece.</p>',
  ...figures.map(
    (f) =>
      `<figure><img src="${f.file}" alt="${f.slug}"><figcaption>${f.caption}</figcaption></figure>`,
  ),
].join('\n');
writeFileSync(path.join(OUT, 'index.html'), `${html}\n`);
console.log(`  figures/index.html (${figures.length} figures)`);
