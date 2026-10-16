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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const { createXiangqiRuleKernel, generalAttacked, isAttacked, legalMovesOn, parsePlacement } =
  await import('../packages/game/src/xiangqi-rule-kernel.js');
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
      return `<circle cx="${x}" cy="${y}" r="${r.heavy ? 12.5 : 11}" fill="none" stroke="${r.color}" stroke-width="${r.heavy ? 3 : 2.5}" opacity="0.95"/>`;
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

// ── 4b. The two start positions, side by side ──────────────────────────────

// Lichess Horde: white pawns fill ranks 1-4 and stand on b5 c5 f5 g5; Black
// is the standard army. Beside it, the design this post would hand a player:
// 36 veterans on ranks 2 to 5, the one array where the horde is the favourite.
type ChessPiece = Parameters<typeof renderBoardSvg>[0][number];
const HORDE_CHESS_PIECES: ChessPiece[] = [];
for (let rank = 0; rank < 4; rank += 1)
  for (let file = 0; file < 8; file += 1)
    HORDE_CHESS_PIECES.push({ file, rank, color: 'white', role: 'pawn' });
for (const file of [1, 2, 5, 6])
  HORDE_CHESS_PIECES.push({ file, rank: 4, color: 'white', role: 'pawn' });
for (let file = 0; file < 8; file += 1)
  HORDE_CHESS_PIECES.push({ file, rank: 6, color: 'black', role: 'pawn' });
const BACK_RANK = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
] as const;
BACK_RANK.forEach((role, file) => {
  HORDE_CHESS_PIECES.push({ file, rank: 7, color: 'black', role });
});
if (HORDE_CHESS_PIECES.filter((p) => p.color === 'white').length !== 36)
  throw new Error('horde chess is 36 pawns');
const startChess = renderBoardSvg(HORDE_CHESS_PIECES, [], 0, 28, CHESS_SIZE, 'white');
const startChessTitle = `<text x="${CHESS_SIZE / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">HORDE CHESS: 36 PAWNS, NO KING</text>`;
const startXq = veteranArt(
  xqBoardSvg({
    state: state('start-xq', fen(HORDE_FORMATIONS.forward36)),
    x: CHESS_SIZE + GAP,
    y: 0,
    label: 'HORDE XIANGQI: 36 VETERANS, NO GENERAL',
    perspective: 'red',
  }),
);
figure(
  'start',
  xqSvg(CHESS_SIZE + GAP + XQ_BOARD_W, FIGURE_H, [startChessTitle, startChess, startXq].join('')),
  'Left, the parent as Lichess plays it: 36 pawns against the full army. Right, the closest thing to a game we found: 36 veteran soldiers on ranks 2 to 5 (the crossed soldier’s move from the first step, shown with the promoted-soldier piece), against the full xiangqi army. The horde wins by checkmate, the army by taking the last soldier.',
  2,
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
  'The horde’s finish, from the million-node game on the array it wins four times in five (36 veterans on ranks 2 to 5). Both chariots fell late, the general is bare, and every point it could step to is covered by a soldier that does not check it. Xiangqi scores the side with no legal move as the loser; under the parent’s rule this is a draw, and about half of the horde’s wins against weak play go the same way.',
  1,
);

// ── 6, 7. The design grids: every array with its 1M result under it ─────────

type GridCell = { id: string; formation: keyof typeof HORDE_FORMATIONS; name: string };
// The games that open with a story and notes on the blog page (build-blog-games.mjs owns the text).
const ANNOTATED = new Set([
  'standard/solid36/1000000/60',
  'standard/across36/1000000/60',
  'veteran/forward36/1000000/120',
  'veteran/solid36/1000000/120',
  'veteran/lichess40/1000000/120',
]);
// Games that hit the harness's 1,000-ply cap were played on from the cap
// position with the 120-ply clock in force (docs-private extra rows); the
// grid prints where they actually ended.
const CONTINUED: Record<string, { plies: number; reason: string }> = {
  'veteran/solid36/1000000/120': { plies: 1058, reason: 'CLOCK' },
  'veteran/solid45/1000000/120': { plies: 1102, reason: 'CLOCK' },
  'veteran/lichess40/1000000/120': { plies: 1016, reason: 'CLOCK' },
};
// The four-game tally under each board: the same array played at four search
// budgets (150k, 200k, 300k, 500k nodes a move), every move the engine's
// first choice, one 120-ply clock. Written by docs-private sample.mts.
function sampleTally(formation: string, soldiersRule: string): { text: string; attr: string } {
  const f = path.join(ARTIFACTS, `sample-${soldiersRule}-${formation}.json`);
  if (!existsSync(f)) {
    console.warn(`no sample tally for ${soldiersRule}/${formation}`);
    return { text: '4 GAMES PENDING', attr: 'class="xq-diagram-outside-text"' };
  }
  const t = JSON.parse(readFileSync(f, 'utf8')).tally as {
    horde: number;
    army: number;
    draw: number;
    unfinished: number;
    distinct: number;
  };
  if (t.distinct !== 4)
    throw new Error(`${soldiersRule}/${formation}: ${t.distinct} distinct games of 4`);
  const n = t.horde + t.army + t.draw + t.unfinished;
  if (t.army === n) return { text: `ARMY ${n}-0`, attr: 'class="xq-diagram-title"' };
  if (t.horde === n) return { text: `HORDE ${n}-0`, attr: 'fill="#c30d0d"' };
  // Largest count first, so the line reads as a score.
  const parts = (
    [
      [t.horde, 'HORDE WIN', 'HORDE WINS'],
      [t.army, 'ARMY WIN', 'ARMY WINS'],
      [t.draw, 'DRAW', 'DRAWS'],
      [t.unfinished, 'UNFINISHED', 'UNFINISHED'],
    ] as const
  )
    .filter(([n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return {
    text: parts.join(', '),
    attr: t.horde ? 'fill="#c30d0d"' : 'class="xq-diagram-outside-text"',
  };
}
// The result line under each board. A horde win is red ink; everything else
// takes the page's heading or body colour through the site's diagram classes,
// so the labels survive a dark theme (a literal dark fill would vanish).
function resultLine(g: ReturnType<typeof labGame>, key = ''): { text: string; attr: string } {
  const plies = g.moves.length;
  const cont = CONTINUED[key];
  if (cont && g.reason === 'ply-cap')
    return {
      text: `DRAW BY ${cont.reason}, ${cont.plies.toLocaleString('en-US')}*`,
      attr: 'class="xq-diagram-outside-text"',
    };
  if (g.winner === 'red')
    return {
      text: `HORDE WINS BY ${g.reason === 'stalemate' ? 'SMOTHER' : 'MATE'}, ${plies}`,
      attr: 'fill="#c30d0d"',
    };
  if (g.winner === 'black')
    return { text: `ARMY WINS BY EXTINCTION, ${plies}`, attr: 'class="xq-diagram-title"' };
  if (g.reason === 'ply-cap')
    return {
      text: `UNFINISHED AT ${plies.toLocaleString('en-US')} PLIES`,
      attr: 'class="xq-diagram-outside-text"',
    };
  return {
    text: `DRAW BY ${g.reason === 'progress-clock' ? 'CLOCK' : 'REPETITION'}, ${plies}`,
    attr: 'class="xq-diagram-outside-text"',
  };
}
function grid(
  cells: GridCell[],
  soldiersRule: 'standard' | 'veteran',
  clock: number,
  perRow: number,
): string {
  const rowH = FIGURE_H + 66;
  const rows = Math.ceil(cells.length / perRow);
  const width = XQ_BOARD_W * perRow + GAP * (perRow - 1);
  const body = cells
    .map((c, i) => {
      const x = (i % perRow) * (XQ_BOARD_W + GAP);
      const y = Math.floor(i / perRow) * rowH;
      const g = labGame(c.formation, soldiersRule, clock, 1_000_000);
      const key = `${soldiersRule}/${c.formation}/1000000/${clock}`;
      const r = resultLine(g, key);
      const t = sampleTally(c.formation, soldiersRule);
      const tag = ANNOTATED.has(key)
        ? `<text x="${x + XQ_BOARD_W / 2}" y="${y + FIGURE_H + 42}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" class="xq-diagram-outside-text" text-anchor="middle">▶ ANNOTATED</text>`
        : '';
      // A "watch" pill on the river band, the one empty strip of every array,
      // so the board reads as something that opens rather than a picture.
      const riverY = y + 28 + XQ_BOARD_H / 2 - 4;
      const pill = `<g class="xq-play-hint" pointer-events="none"><rect x="${x + XQ_BOARD_W / 2 - 80}" y="${riverY - 11}" width="160" height="22" rx="11" fill="rgba(28, 22, 12, 0.82)" stroke="rgba(255,255,255,0.35)" stroke-width="1"/><text x="${x + XQ_BOARD_W / 2}" y="${riverY + 4}" font-family="system-ui, sans-serif" font-size="10.5" font-weight="700" fill="#fff" text-anchor="middle">▶ WATCH THE GAME</text></g>`;
      const board = xqBoardSvg({
        state: state(`${soldiersRule}-${c.id}`, fen(HORDE_FORMATIONS[c.formation])),
        x,
        y,
        label: c.name,
        perspective: 'red',
        overlay: `${pill}<text x="${x + XQ_BOARD_W / 2}" y="${y + FIGURE_H + 10}" font-family="system-ui, sans-serif" font-size="13" font-weight="700" ${t.attr} text-anchor="middle">${t.text}</text><text x="${x + XQ_BOARD_W / 2}" y="${y + FIGURE_H + 27}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" ${r.attr} text-anchor="middle">1M GAME: ${r.text}</text>${tag}`,
      });
      // Each board is a link: on the blog page a click opens the replay of the
      // exact game whose result is printed under it (build-blog-games.mjs).
      const linked = `<a href="#horde-games" class="xq-grid-link" data-game="${key}">${board}</a>`;
      return soldiersRule === 'veteran' ? veteranArt(linked) : linked;
    })
    .join('');
  return xqSvg(width, rowH * rows - 66 + 50, body);
}
const ROW_CELLS: GridCell[] = [
  { id: 'solid18', formation: 'solid18', name: '18, RANKS 1-2' },
  { id: 'forward18', formation: 'forward18', name: '18, RANKS 3-4' },
  { id: 'solid27', formation: 'solid27', name: '27, RANKS 1-3' },
  { id: 'forward27', formation: 'forward27', name: '27, RANKS 2-4' },
  { id: 'across27', formation: 'across27', name: '27, RANKS 4-6' },
  { id: 'solid36', formation: 'solid36', name: '36, RANKS 1-4' },
  { id: 'forward36', formation: 'forward36', name: '36, RANKS 2-5' },
  { id: 'across36', formation: 'across36', name: '36, RANKS 3-6' },
  { id: 'solid45', formation: 'solid45', name: '45, RANKS 1-5' },
  { id: 'array32', formation: 'array32', name: '32, XIANGQI’S FIVE POINTS' },
  { id: 'lichess31', formation: 'lichess31', name: '31, PARENT SHAPE' },
  { id: 'lichess40', formation: 'lichess40', name: '40, PARENT SHAPE' },
];
figure(
  'grid-standard',
  grid(ROW_CELLS, 'standard', 60, 2),
  'Every array with standard soldiers, played four times at four search budgets (150,000 to 500,000 nodes a move), with the engine’s million-node game under the tally. Nine arrays are army wins by extinction four times out of four. The two that start across the river begin in contact with the army’s soldiers, and the five-deep block of 45 sometimes crosses before the chariot is finished; those three cells split.',
  4,
);
figure(
  'grid-veteran',
  grid(ROW_CELLS, 'veteran', 120, 2),
  'The same twelve arrays with veteran soldiers (the crossed soldier’s move from the first step), four games at four budgets and the million-node game, 120-ply no-capture clock. 48 games: 37 draws, six horde wins, five army wins. The army wins only against 18 soldiers; from 27 up the game reaches the two-chariot ending and stops, and every horde win needed both chariots to fall. *Three million-node games ran into the harness’s 1,000-ply cap and were played on from that position with the clock in force; the ply shown is where the clock ended them.',
  4,
);

// ── Blog output (--blog): brianhliou.com includes and piece art ───────────

// `--site` runs the same pass but writes only the mistboard article's module
// (apps/web/src/horde-xiangqi-article-diagrams.ts), never the blog repo.
const BLOG_WRITE = process.argv.includes('--blog');
if (BLOG_WRITE || process.argv.includes('--site')) {
  const BLOG = '/Users/brianliou/projects/brianhliou.com';
  const BLOG_ASSETS = path.join(BLOG, 'assets/posts/horde-xiangqi');
  const BLOG_ART = '/assets/posts/horde-xiangqi/pieces';
  const INCLUDES = path.join(BLOG, '_includes');
  // The blog localises generated includes by deriving _includes/xq/<lang>/
  // from _includes/xq/en/ (localize_includes.py); a post includes the
  // dispatcher, which picks the copy for the active language.
  const XQ_EN = path.join(INCLUDES, 'xq', 'en');
  if (BLOG_WRITE) mkdirSync(XQ_EN, { recursive: true });
  const dispatcher = (name: string) => `{%- comment -%}
  Dispatcher. The generated figure lives in _includes/xq/en/${name}
  (from mistboard's gen-horde-diagrams.mts --blog; drop regenerated output there).
  Localized copies under _includes/xq/<lang>/ are derived by
  _i18n/tools/localize_includes.py from _i18n/includes/strings.<lang>.yml.
{%- endcomment -%}
{%- assign xq_path = "xq/" | append: site.active_lang | append: "/${name}" -%}
{%- include {{ xq_path }} -%}
`;
  if (BLOG_WRITE) mkdirSync(path.join(BLOG_ASSETS, 'pieces'), { recursive: true });
  const blogArt = new Set<string>();
  const blogArtHref = (svg: string) =>
    svg.replace(/href="\/piece-sets\/([^"?]+)\.png[^"]*"/g, (_, rel: string) => {
      blogArt.add(`${rel}.png`);
      return `href="${BLOG_ART}/${rel.replace(/\//g, '-')}.png"`;
    });
  const layout = (n: number) =>
    n === 1 ? 'single' : n === 2 ? 'pair' : n === 3 ? 'triple' : 'grid';
  for (const f of BLOG_WRITE ? figures : []) {
    const include = [
      '<!-- Generated by scripts/gen-horde-diagrams.mts in the mistboard repo.',
      '     Do not hand-edit: re-run the generator with --blog. -->',
      `<figure class="xq-figure" data-horde-figure="${f.slug}">`,
      `  <div class="xq-figure-board" data-board="${layout(f.boards)}">${BLOG_STYLES}${blogArtHref(f.svg)}</div>`,
      `  <figcaption>${f.caption}</figcaption>`,
      '</figure>',
    ].join('\n');
    const name = `horde-xq-${f.slug}.html`;
    writeFileSync(path.join(XQ_EN, name), `${include}\n`);
    writeFileSync(path.join(INCLUDES, name), dispatcher(name));
    console.log(`  _includes/xq/en/${name} (+ dispatcher)`);
  }

  // ── The mistboard article's diagrams, as a generated module ─────────────
  // The site renders diagrams at runtime so they follow the reader's piece
  // set, and the rule kernel is not a web dependency, so the positions are
  // replayed here through the kernel (and asserted above) and written out as
  // board literals; the module draws them with the shared diagram toolkit.
  // Regenerate, never hand-edit.
  {
    const SITE_MODULE = path.join(HERE, '../apps/web/src/horde-xiangqi-article-diagrams.ts');
    const boardLiteral = (board: XiangqiBoard) =>
      `{ ${Object.entries(board)
        .filter(([, p]) => p)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sq, p]) => `${sq}: { color: '${p!.color}', role: '${p!.role}' }`)
        .join(', ')} }`;
    // The article's playthrough: the whole forward36 veteran game as a record
    // the site replays through the kernel, with a note at the plies that matter.
    const NOTES: Record<number, string> = {
      0: 'The start: 36 veterans on ranks 2 to 5, no general, Red to move. Black is the whole army.',
      40: 'The block edges forward a rank at a time; four soldiers have gone for two of the army’s soldiers and a horse.',
      89: 'Seven soldiers are across the river and the army is down to eight pieces: both elephants, a horse and all five soldiers gone. The chariots cannot sit beside a veteran column.',
      160: 'Ten across. From here the two chariots and the general hold the palace and the block shuffles: this is the siege every veteran game above 27 soldiers reaches.',
      267: 'The first chariot falls, traded for soldiers the horde could afford to lose; nineteen are left.',
      350: 'Sixteen soldiers, nine across, against advisor, chariot and general. Most games stop here on the clock or by repetition.',
      431: 'The second chariot falls. The general is bare.',
      435: 'Every point the general could step to is covered by a soldier that does not check it: no move, no check.',
    };
    for (const ply of Object.keys(NOTES).map(Number))
      if (ply > GW.moves.length) throw new Error(`note ply ${ply} past the end`);
    // ── Kernel checks behind the article's notes and tables ───────────────
    const across = (b: XiangqiBoard) =>
      Object.entries(b).filter(
        ([sq, p]) => p.color === 'red' && p.role === 'soldier' && Number(sq.slice(1)) >= 6,
      ).length;
    const blackRoles = (b: XiangqiBoard) =>
      Object.values(b)
        .filter((p) => p.color === 'black')
        .map((p) => p.role)
        .sort()
        .join(',');
    const blackCount = (b: XiangqiBoard) =>
      Object.values(b).filter((p) => p.color === 'black').length;
    const expectAt = (ply: number, soldierN: number, acrossN: number, army: string) => {
      const b = replay(GW, ply).board;
      const got = `${soldiers(b)} soldiers, ${across(b)} across, ${blackRoles(b)}`;
      const want = `${soldierN} soldiers, ${acrossN} across, ${army}`;
      if (got !== want) throw new Error(`forward36 game at ply ${ply}: ${got}, note says ${want}`);
    };
    // Note 40: four soldiers traded for two of the army's soldiers and a horse.
    expectAt(
      40,
      32,
      4,
      'advisor,advisor,cannon,cannon,chariot,chariot,elephant,elephant,general,horse,soldier,soldier,soldier',
    );
    // Note 89: seven across (the blog's games viewer said eight), army of eight.
    expectAt(89, 29, 7, 'advisor,advisor,cannon,cannon,chariot,chariot,general,horse');
    expectAt(160, 28, 10, 'advisor,advisor,cannon,cannon,chariot,chariot,general,horse');
    expectAt(267, 19, 7, 'advisor,chariot,general');
    expectAt(350, 16, 9, 'advisor,chariot,general');
    expectAt(431, 14, 11, 'general');
    // 267 and 431 are the plies the chariots fall on, not just after.
    for (const ply of [267, 431]) {
      const chariots = (p: number) =>
        Object.values(replay(GW, p).board).filter(
          (x) => x.color === 'black' && x.role === 'chariot',
        ).length;
      if (chariots(ply - 1) !== chariots(ply) + 1)
        throw new Error(`a chariot should fall on ply ${ply}`);
    }

    // The chariot game (solid36, standard, 1M). Notes are keyed by 1-based
    // ply: the move at index PLY_F5F1 is ply PLY_F5F1 + 1 (the blog keyed it
    // one early, on Red's move before the drop).
    const DROP = PLY_F5F1 + 1;
    if (G1.winner !== 'black' || G1.reason !== 'extinction' || G1.moves.length !== 134)
      throw new Error(`chariot game: ${G1.winner} ${G1.reason} ${G1.moves.length}`);
    {
      const s = replay(G1, DROP + 1);
      const m = G1.kernel.fromUci(s, G1.moves[DROP + 1]!)!;
      if (m.from !== 'f1' || s.board[m.to]?.role !== 'soldier')
        throw new Error(`ply ${DROP + 2} should be the chariot taking a soldier from f1`);
    }
    // Fifteen moves after the drop: soldiers gone, and what the army paid.
    const fifteen = replay(G1, DROP + 30).board;
    const eatenBy15 = soldiers(before.board) - soldiers(fifteen);
    if (eatenBy15 !== 11) throw new Error(`soldiers gone by ply ${DROP + 30}: ${eatenBy15}`);
    if (
      blackRoles(before.board) !==
        'advisor,advisor,cannon,cannon,chariot,chariot,elephant,elephant,general,horse,soldier,soldier,soldier' ||
      blackRoles(fifteen) !==
        'advisor,advisor,cannon,cannon,chariot,chariot,elephant,elephant,general,soldier'
    )
      throw new Error('the army should pay a horse and two soldiers in those fifteen moves');
    if (
      blackRoles(replay(G1, G1.moves.length).board) !==
      'advisor,advisor,cannon,cannon,chariot,chariot,elephant,elephant,general,soldier'
    )
      throw new Error('the army should finish down four soldiers and two horses');
    const CHARIOT_NOTES: Record<number, string> = {
      0: 'The parent’s array: 36 standard soldiers on ranks 1 to 4, no general, Red to move. Black is the whole army.',
      [DROP]:
        'The chariot drops to the first rank through the f-file, which the horde emptied by advancing. No soldier attacks backward, so nothing can touch it there.',
      [DROP + 2]:
        `It takes a soldier from behind and goes on at about one a move: fifteen moves after the drop, ${eatenBy15} soldiers are gone for a horse and two of the army’s soldiers.`,
      [G1.moves.length]:
        'The last soldier falls. The whole horde cost the army four soldiers and two horses.',
    };

    // The tables: four sampled games per array and the million-node game,
    // straight from the artifacts.
    const START_CELL: Record<string, string> = {
      solid18: 'Ranks 1-2',
      forward18: 'Ranks 3-4',
      solid27: 'Ranks 1-3',
      forward27: 'Ranks 2-4',
      across27: 'Ranks 4-6',
      solid36: 'Ranks 1-4',
      forward36: 'Ranks 2-5',
      across36: 'Ranks 3-6',
      solid45: 'Ranks 1-5',
      array32: 'Xiangqi’s five points',
      lichess31: 'Parent shape',
      lichess40: 'Parent shape',
    };
    type Tally = {
      horde: number;
      army: number;
      draw: number;
      unfinished: number;
      distinct: number;
    };
    type SampleGame = { winner: string | null; reason: string; plies: number };
    const sample = (rule: string, formation: string) => {
      const s = JSON.parse(
        readFileSync(path.join(ARTIFACTS, `sample-${rule}-${formation}.json`), 'utf8'),
      ) as { tally: Tally; games: SampleGame[] };
      if (s.tally.distinct !== 4 || s.tally.unfinished !== 0 || s.games.length !== 4)
        throw new Error(`${rule}/${formation}: sample is not four finished distinct games`);
      return s;
    };
    const result1M = (g: ReturnType<typeof labGame>, key: string): [string, string] => {
      const n = g.moves.length;
      if (g.reason === 'ply-cap') {
        const cont = CONTINUED[key];
        if (!cont) throw new Error(`${key} hit the cap and has no continuation`);
        return ['Draw, clock', `${cont.plies.toLocaleString('en-US')}*`];
      }
      if (g.winner === 'black') {
        if (g.reason !== 'extinction') throw new Error(`${key}: army won by ${g.reason}`);
        return ['Army, extinction', String(n)];
      }
      if (g.winner === 'red')
        return [g.reason === 'stalemate' ? 'Horde, smother' : 'Horde, mate', String(n)];
      return [g.reason === 'progress-clock' ? 'Draw, clock' : 'Draw, repetition', String(n)];
    };
    const tableRows = (rule: 'standard' | 'veteran', clock: number) =>
      ROW_CELLS.map((c) => {
        const n = soldiers(fen(HORDE_FORMATIONS[c.formation]));
        if (`${n}` !== c.name.split(',')[0]) throw new Error(`${c.formation} has ${n} soldiers`);
        const t = sample(rule, c.formation).tally;
        const g = labGame(c.formation, rule, clock, 1_000_000);
        const row = [
          String(n),
          START_CELL[c.formation]!,
          String(t.army),
          String(t.horde),
          String(t.draw),
          ...result1M(g, `${rule}/${c.formation}/1000000/${clock}`),
        ];
        if (rule === 'veteran') row.push(String(16 - blackCount(replay(g, g.moves.length).board)));
        return row;
      });
    const STANDARD_ROWS = tableRows('standard', 60);
    const VETERAN_ROWS = tableRows('veteran', 120);
    // The claims the prose makes about the tables.
    const sum = (rows: string[][], col: number) => rows.reduce((a, r) => a + Number(r[col]), 0);
    if (`${sum(VETERAN_ROWS, 2)}/${sum(VETERAN_ROWS, 3)}/${sum(VETERAN_ROWS, 4)}` !== '5/6/37')
      throw new Error('veteran sample should be army 5, horde 6, draws 37');
    if (VETERAN_ROWS.some((r) => Number(r[2]) > 0 && r[0] !== '18'))
      throw new Error('the army should win veteran games only against 18 soldiers');
    const ownSide = [
      'solid18',
      'forward18',
      'solid27',
      'forward27',
      'solid36',
      'forward36',
      'array32',
      'lichess31',
      'lichess40',
    ];
    if (ROW_CELLS.some((c, i) => ownSide.includes(c.formation) && STANDARD_ROWS[i]![2] !== '4'))
      throw new Error('standard soldiers should lose every own-side start of 40 or fewer, 4 of 4');
    const drawReasons = (rule: string) => {
      const out: Record<string, number> = {};
      for (const c of ROW_CELLS)
        for (const g of sample(rule, c.formation).games)
          if (!g.winner) out[g.reason] = (out[g.reason] ?? 0) + 1;
      return Object.entries(out)
        .sort()
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
    };
    // The clock section: 30 of the 37 veteran draws are the clock, and with
    // standard soldiers the clock fired once in 48 games.
    if (drawReasons('veteran') !== 'progress-clock 30, repetition 7')
      throw new Error(`veteran draws ${drawReasons('veteran')}`);
    if (drawReasons('standard') !== 'progress-clock 1, repetition 1')
      throw new Error(`standard draws ${drawReasons('standard')}`);
    // Where the three capped games and the 703-ply repetition stood at the end.
    for (const [f, want] of [
      ['solid36', '9 vs chariot,chariot,general'],
      ['solid45', '10 vs chariot,chariot,elephant,general'],
      ['lichess40', '10 vs advisor,chariot,chariot,general'],
      ['across36', '8 vs chariot,chariot,general'],
    ] as const) {
      const g = labGame(f, 'veteran', 120, 1_000_000);
      const b = replay(g, g.moves.length).board;
      if (`${soldiers(b)} vs ${blackRoles(b)}` !== want)
        throw new Error(`${f} veteran 1M ends ${soldiers(b)} vs ${blackRoles(b)}`);
    }
    // The 5M column, which the standard table's caption carries.
    for (const [f, want] of [
      ['solid36', 'black/extinction/156'],
      ['forward36', 'black/extinction/146'],
      ['array32', 'black/extinction/106'],
      ['across36', 'null/repetition/104'],
    ] as const) {
      const g = labGame(f, 'standard', 60, 5_000_000);
      if (`${g.winner}/${g.reason}/${g.moves.length}` !== want)
        throw new Error(`${f} 5M: ${g.winner}/${g.reason}/${g.moves.length}`);
    }
    // The engine against a random army at 100,000 nodes (match-*.json).
    {
      const t = { standard: [0, 0, 0, 0], veteran: [0, 0, 0, 0] }; // games, engine wins, horde wins, smothers
      for (const f of readdirSync(ARTIFACTS).filter((x) => x.startsWith('match-'))) {
        const a = JSON.parse(readFileSync(path.join(ARTIFACTS, f), 'utf8'));
        const row = t[(a.rules.soldiers ?? 'standard') as 'standard' | 'veteran'];
        for (const g of a.result.games as Array<{
          winner: string | null;
          reason: string;
          engineSeat: string;
        }>) {
          row[0] += 1;
          if (g.winner === g.engineSeat) row[1] += 1;
          if (g.engineSeat === 'red' && g.winner === 'red') {
            row[2] += 1;
            if (g.reason === 'stalemate') row[3] += 1;
          }
        }
      }
      // The blog said 60-0 and "30 of 30, 19 by smother": that was three of the four standard matches.
      if (t.standard.join() !== '70,70,35,20' || t.veteran.join() !== '80,78,38,16')
        throw new Error(`random-army matches ${JSON.stringify(t)}`);
    }
    const rowsLiteral = (rows: string[][]) =>
      `[\n${rows.map((r) => `  [${r.map((c) => `'${c.replace(/'/g, "\\'")}'`).join(', ')}],`).join('\n')}\n]`;
    const chariotNotesLiteral = Object.entries(CHARIOT_NOTES)
      .map(([p, t]) => `    ${p}: '${t.replace(/'/g, "\\'")}',`)
      .join('\n');
    const arrayCells = ROW_CELLS.map(
      (c) =>
        `  { board: ${boardLiteral(fen(HORDE_FORMATIONS[c.formation]))}, label: '${c.name.replace(/'/g, "\\'")}' },`,
    ).join('\n');
    const notesLiteral = Object.entries(NOTES)
      .map(([p, t]) => `    ${p}: '${t.replace(/'/g, "\\'")}',`)
      .join('\n');
    const module = `// Generated by scripts/gen-horde-diagrams.mts in this repository (--site).
// Do not hand-edit: the positions are replayed through the horde-xiangqi rule
// kernel there (scripts/variant-lab/lab/variants/horde-xiangqi.ts on
// packages/game/src/xiangqi-rule-kernel.ts) and asserted before they are
// written out, so a rules change redraws these boards instead of leaving them
// quietly wrong. Drawn with the shared xiangqi diagram toolkit so they follow
// the reader's board and piece pickers like every other xiangqi figure.

import { renderBoardSvg } from '@mistboard/board-render';
import type { XiangqiPiece, XiangqiSquare } from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  XQ_CELL,
  xqBoardSvg,
  xqCoord,
  xqPoint,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import type { HordeXiangqiReplaySpec } from './horde-xiangqi-replay.js';

type Board = Partial<Record<XiangqiSquare, XiangqiPiece>>;

const PAIR_W = XQ_BOARD_W * 2 + 28;
const PAIR_GAP_X = XQ_BOARD_W + 28;
const FIGURE_H = XQ_BOARD_H + 34;
/** Green rings: the points a side protects (the kernel's attack set, computed by the generator). */
const COVER_GREEN = '#2f8f3a';
function coverRings(squares: readonly XiangqiSquare[]): string {
  return squares
    .map((sq) => {
      const { file, rank } = xqCoord(sq);
      const { x, y } = xqPoint(file, rank, 'red', 0, 28);
      return \`<circle cx="\${x}" cy="\${y}" r="11" fill="none" stroke="\${COVER_GREEN}" stroke-width="2.5" opacity="0.95"/>\`;
    })
    .join('');
}

/** The parent's array: 36 standard soldiers on ranks 1 to 4. */
export const HORDE_SOLID36: Board = ${boardLiteral(fen(HORDE_FORMATIONS.solid36))};
/** 36 veterans on ranks 2 to 5, the array the horde wins four times in five. */
export const HORDE_FORWARD36: Board = ${boardLiteral(fen(HORDE_FORMATIONS.forward36))};
/** Ply 754 of the lichess40 veteran game: twelve soldiers against general, advisor and two chariots. */
export const HORDE_FORTRESS_754: Board = ${boardLiteral(F.board)};
/** Ply 1,000 of the same game, the harness's cap: two more soldiers gone, at 822 and 896. */
export const HORDE_FORTRESS_1000: Board = ${boardLiteral(END40.board)};
/** The cover position: soldiers d4 f4 and the one that just stepped to e5; a chariot on e7. */
export const HORDE_COVER: Board = ${boardLiteral(XQ_AFTER)};
/** Ply 435 of the forward36 veteran game: the bare general has no move and is not in check. */
export const HORDE_SMOTHER: Board = ${boardLiteral(END_W.board)};

export const HORDE_XIANGQI_START = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    [
      xqBoardSvg({
        state: xqVisionDemoState('horde-solid36', HORDE_SOLID36),
        x: 0,
        y: 0,
        label: '36 STANDARD SOLDIERS, RANKS 1-4',
        perspective: 'red',
      }),
      xqBoardSvg({
        state: xqVisionDemoState('horde-forward36', HORDE_FORWARD36),
        x: PAIR_GAP_X,
        y: 0,
        label: '36 VETERANS, RANKS 2-5',
        perspective: 'red',
        veteranSoldiers: true,
      }),
    ].join(''),
  );

/** The twelve start arrays, three to a row, in the order of the tables. */
const HORDE_ARRAY_CELLS: Array<{ board: Board; label: string }> = [
${arrayCells}
];

export const HORDE_XIANGQI_ARRAYS = () =>
  xqSvg(
    XQ_BOARD_W * 3 + 56,
    FIGURE_H * 4 + 36,
    HORDE_ARRAY_CELLS.map((c, i) =>
      xqBoardSvg({
        state: xqVisionDemoState(\`horde-array-\${i}\`, c.board),
        x: (i % 3) * PAIR_GAP_X,
        y: Math.floor(i / 3) * (FIGURE_H + 12),
        label: c.label,
        perspective: 'red',
      }),
    ).join(''),
  );

/** Standard soldiers: four sampled games per array, then the million-node game (60-ply clock). */
export const HORDE_XIANGQI_STANDARD_ROWS: string[][] = ${rowsLiteral(STANDARD_ROWS)};

/** Veteran soldiers: the same, 120-ply clock, with the army's pieces lost in the million-node game. */
export const HORDE_XIANGQI_VETERAN_ROWS: string[][] = ${rowsLiteral(VETERAN_ROWS)};

/** The million-node solid36 game with standard soldiers: the chariot behind the wall. */
export const HORDE_XIANGQI_CHARIOT_GAME: HordeXiangqiReplaySpec = {
  placement: '${HORDE_FORMATIONS.solid36}',
  moves: '${G1.moves.join(' ')}',
  veteran: false,
  progressClock: 60,
  red: 'Horde, 36 soldiers',
  black: 'The army',
  event: 'Fairy-Stockfish against itself, a million nodes a move, 60-ply clock',
  resultText: 'Black wins: the last soldier is gone.',
  notes: {
${chariotNotesLiteral}
  },
};

export const HORDE_XIANGQI_FORTRESS = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    [
      xqBoardSvg({
        state: xqVisionDemoState('horde-fortress-754', HORDE_FORTRESS_754),
        x: 0,
        y: 0,
        label: 'PLY 754: ${fortressSoldiers} SOLDIERS',
        perspective: 'red',
        veteranSoldiers: true,
      }),
      xqBoardSvg({
        state: xqVisionDemoState('horde-fortress-1000', HORDE_FORTRESS_1000),
        x: PAIR_GAP_X,
        y: 0,
        label: 'PLY 1,000: ${soldiers(END40.board)} SOLDIERS',
        perspective: 'red',
        veteranSoldiers: true,
      }),
    ].join(''),
  );

const COVER_CHESS: Parameters<typeof renderBoardSvg>[0] = ${JSON.stringify(CHESS_PIECES)};
const COVER_CHESS_RINGS: Array<[number, number]> = ${JSON.stringify([
      [1, 3],
      [3, 3],
      [2, 4],
      [4, 4],
      [3, 5],
      [5, 5],
    ])};
const COVER_STANDARD: XiangqiSquare[] = ${JSON.stringify(stdCover)};
const COVER_VETERAN: XiangqiSquare[] = ${JSON.stringify(vetCover)};

/** The cover figure, three boards that stack on a phone: chess, then soldiers, then veterans. */
export const HORDE_XIANGQI_COVER_CHESS = () => {
  const size = XQ_BOARD_H - 28;
  const sq = size / 8;
  const rings = COVER_CHESS_RINGS.map(
    ([f, r]) =>
      \`<circle cx="\${f * sq + sq / 2}" cy="\${28 + (7 - r) * sq + sq / 2}" r="\${sq * 0.38}" fill="none" stroke="\${COVER_GREEN}" stroke-width="3" opacity="0.95"/>\`,
  ).join('');
  const title = \`<text x="\${size / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">CHESS: AFTER e4-e5, d4 COVERS e5</text>\`;
  return xqSvg(size, FIGURE_H, title + renderBoardSvg(COVER_CHESS, [], 0, 28, size, 'white') + rings);
};
export const HORDE_XIANGQI_COVER_STANDARD = () =>
  xqSvg(
    XQ_BOARD_W,
    FIGURE_H,
    xqBoardSvg({
      state: xqVisionDemoState('horde-cover-std', HORDE_COVER),
      x: 0,
      y: 0,
      label: 'SOLDIERS: AFTER e4-e5, NOTHING COVERS e5',
      perspective: 'red',
      overlay: coverRings(COVER_STANDARD),
    }),
  );
export const HORDE_XIANGQI_COVER_VETERAN = () =>
  xqSvg(
    XQ_BOARD_W,
    FIGURE_H,
    xqBoardSvg({
      state: xqVisionDemoState('horde-cover-vet', HORDE_COVER),
      x: 0,
      y: 0,
      label: 'VETERANS: STILL NOTHING COVERS e5',
      perspective: 'red',
      veteranSoldiers: true,
      overlay: coverRings(COVER_VETERAN),
    }),
  );

export const HORDE_XIANGQI_SMOTHER = () =>
  xqSvg(
    PAIR_W,
    FIGURE_H,
    xqBoardSvg({
      state: xqVisionDemoState('horde-smother', HORDE_SMOTHER),
      x: PAIR_GAP_X / 2,
      y: 0,
      label: 'PLY ${GW.moves.length}: NO MOVE, NO CHECK, RED WINS',
      perspective: 'red',
      veteranSoldiers: true,
    }),
  );

/** The million-node forward36 veteran game, replayed on the page through the rule kernel. */
export const HORDE_XIANGQI_GAME: HordeXiangqiReplaySpec = {
  placement: '${HORDE_FORMATIONS.forward36}',
  moves: '${GW.moves.join(' ')}',
  veteran: true,
  progressClock: 120,
  red: 'Horde, 36 veterans',
  black: 'The army',
  event: 'Fairy-Stockfish against itself, a million nodes a move, 120-ply clock',
  resultText: 'Red wins. Xiangqi scores the side with no legal move as the loser; Lichess Horde would call it a draw.',
  notes: {
${notesLiteral}
  },
};

// The card: the forward36 array itself, cropped to the block and the army's
// front row, so the tile reads as a board at card size in any piece set (the
// blog's tile is the same array on its cream field).
const THUMB_ASPECT = 16 / 10;

export const HORDE_XIANGQI_THUMBNAIL = () => {
  const boardY = 28;
  const left = xqPoint(0, 1, 'red', 0, boardY).x - XQ_CELL * 0.6;
  const right = xqPoint(8, 1, 'red', 0, boardY).x + XQ_CELL * 0.6;
  const w = right - left;
  const h = w / THUMB_ASPECT;
  // Red's half only: the window sits just under the river's far shore (no
  // black line in the card) and runs down past rank 1; the board colour is
  // painted behind it so the overrun below the back rank is board, not card.
  const top = xqPoint(0, 6, 'red', 0, boardY).y + XQ_CELL * 0.12;
  const board = xqBoardSvg({
    state: xqVisionDemoState('horde-card', HORDE_FORWARD36),
    x: 0,
    y: 0,
    label: '',
    perspective: 'red',
    veteranSoldiers: true,
  });
  return \`<svg class="xq-article-svg" viewBox="\${left} \${top} \${w} \${h}" role="img" aria-label="Horde Xiangqi" xmlns="http://www.w3.org/2000/svg"><rect class="xq-diagram-bg" x="\${left}" y="\${top}" width="\${w}" height="\${h}"/>\${board}</svg>\`;
};
`;
    // ── The games viewer: every lab game the post let a reader open ─────────
    // The engine against itself on every array, standard and veteran, at
    // every budget, plus the two ladder games the post names (the set
    // build-blog-games.mjs gave the blog). Records go to a module the article
    // loads on demand (horde-xiangqi-games.ts): keys and arguments only. The
    // browser replays them with replayHordeXiangqiRecord, which resolves each
    // move against the kernel's legal moves; that exact function runs here on
    // every record, and its final board must match the lab kernel's.
    const { replayHordeXiangqiRecord } = await import('../apps/web/src/horde-xiangqi-replay.js');
    const NAME: Record<string, string> = {
      solid18: '18, ranks 1-2',
      forward18: '18, ranks 3-4',
      solid27: '27, ranks 1-3',
      forward27: '27, ranks 2-4',
      across27: '27, ranks 4-6',
      solid36: '36, ranks 1-4',
      forward36: '36, ranks 2-5',
      across36: '36, ranks 3-6',
      solid45: '45, ranks 1-5',
      array32: '32, xiangqi’s five points',
      lichess31: '31, parent shape',
      lichess40: '40, parent shape',
    };
    const SET_STR: Record<string, string> = {
      game: 'Game',
      'grp-standard': 'Standard soldiers, engine against itself',
      'grp-veteran': 'Veteran soldiers, engine against itself',
      'grp-ladder': 'Ladder: 100k against 10k nodes',
      'lab-game': '%1: %2 nodes, %3-ply clock. %4',
      'lab-ladder': 'Horde at %1, army at %2 nodes. %3',
      'res-game': '%1 after %2 plies. Both sides %3 nodes a move, %4-ply no-capture clock.',
      'res-ladder': '%1 after %2 plies. The horde searched %3 nodes a move, the army %4.',
      'res-capped':
        'Stopped by the harness at its 1,000-ply cap. Played on from there with the clock in force, it was drawn on the clock at ply %1. Both sides %2 nodes a move, %3-ply no-capture clock.',
      'res-unfinished':
        'Unfinished: the harness stopped it at its %1-ply cap. Both sides %2 nodes a move, %3-ply no-capture clock.',
      'v-capped': 'Unfinished at the ply cap',
      unfinished: 'Unfinished at %1 plies',
      'seat-fsf': 'Fairy-Stockfish, %1 nodes',
    };
    // A verdict is a whole sentence with no arguments, because the labels
    // and result lines take it as a ['k', key] argument, which the page
    // resolves without arguments of its own.
    const WINNER_TEXT: Record<string, string> = {
      horde: 'Horde wins by',
      army: 'Army wins by',
      draw: 'Draw by',
    };
    const REASON_TEXT: Record<string, string> = {
      stalemate: 'smother',
      checkmate: 'checkmate',
      extinction: 'extinction',
      'progress-clock': 'the clock',
      repetition: 'repetition',
    };
    for (const [w, wt] of Object.entries(WINNER_TEXT))
      for (const [r, rt] of Object.entries(REASON_TEXT)) SET_STR[`v-${w}-${r}`] = `${wt} ${rt}`;
    for (const [k, v] of Object.entries(NAME)) SET_STR[`name-${k}`] = v;
    const nodesText = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}k`);
    // Ply counts in the thousands print as the article prints them (1,058).
    const pl = (n: number) => (n >= 1000 ? n.toLocaleString('en-US') : n);
    type SetArg = number | string | ['k', string];
    type SetText = { k: string; a: SetArg[] };
    const verdictOf = (winner: string | null, reason: string, plies: number): SetText => {
      if (reason === 'ply-cap') {
        return { k: 'unfinished', a: [pl(plies)] };
      }
      const side = winner === 'red' ? 'horde' : winner === 'black' ? 'army' : 'draw';
      const k = `v-${side}-${reason}`;
      if (!SET_STR[k]) throw new Error(`games set: no template for ${side} by ${reason}`);
      return { k, a: [] };
    };
    type SetRec = {
      id: string;
      family: 'standard' | 'veteran' | 'ladder';
      formation: string;
      nodes: number;
      clock: number;
      veteran: boolean;
      rules: Record<string, unknown>;
      moves: string[];
      winner: string | null;
      reason: string;
      hiSeat?: string;
      lo?: number;
    };
    const found: SetRec[] = [];
    for (const f of readdirSync(ARTIFACTS).sort()) {
      if (!f.endsWith('.json')) continue;
      const a = JSON.parse(readFileSync(path.join(ARTIFACTS, f), 'utf8'));
      const formation = a.rules?.formation as string;
      if (a.command === 'bestplay') {
        const veteran = a.rules.soldiers === 'veteran';
        const clock = Number(a.rules.progressClock);
        for (const g of a.result.games) {
          const id = `${veteran ? 'veteran' : 'standard'}/${formation}/${g.nodes}/${clock}`;
          if (found.some((r) => r.id === id)) continue;
          found.push({
            id,
            family: veteran ? 'veteran' : 'standard',
            formation,
            nodes: g.nodes,
            clock,
            veteran,
            rules: a.rules,
            moves: g.moves,
            winner: g.winner,
            reason: g.reason,
          });
        }
      }
      // The two ladder games the post names: the horde's fastest win (151
      // plies) and the progress-clock draw, both on forward36.
      if (a.command === 'ladder' && formation === 'forward36') {
        a.result.games.forEach(
          (
            g: {
              moves: string[];
              plies: number;
              winner: string | null;
              reason: string;
              hiSeat: string;
            },
            i: number,
          ) => {
            const named =
              (g.winner === 'red' && g.plies === 151) ||
              (g.winner === null && g.reason === 'progress-clock');
            const id = `ladder/${formation}/${i}`;
            if (!named || found.some((r) => r.id === id)) return;
            found.push({
              id,
              family: 'ladder',
              formation,
              nodes: a.args.hi,
              lo: a.args.lo,
              clock: Number(a.rules.progressClock),
              veteran: a.rules.soldiers === 'veteran',
              rules: a.rules,
              moves: g.moves,
              winner: g.winner,
              reason: g.reason,
              hiSeat: g.hiSeat,
            });
          },
        );
      }
    }
    const FAMILY_ORDER = ['standard', 'veteran', 'ladder'];
    const FORMATION_ORDER = Object.keys(NAME);
    found.sort(
      (x, y) =>
        FAMILY_ORDER.indexOf(x.family) - FAMILY_ORDER.indexOf(y.family) ||
        FORMATION_ORDER.indexOf(x.formation) - FORMATION_ORDER.indexOf(y.formation) ||
        x.nodes - y.nodes ||
        x.clock - y.clock,
    );
    if (found.length !== 58)
      throw new Error(`games set: ${found.length} horde games; the post let readers open 58`);
    const setRecords = found.map((r) => {
      if (!FORMATION_ORDER.includes(r.formation))
        throw new Error(`games set: no name for formation ${r.formation}`);
      const placement = String(
        HORDE_FORMATIONS[r.formation as keyof typeof HORDE_FORMATIONS],
      ).split(/\s+/)[0]!;
      // The lab kernel under the artifact's own rules.
      const { kernel } = hordeXiangqiVariant.create(
        resolveRules(hordeXiangqiVariant.ruleSchema, r.rules),
      );
      let st = kernel.initial(`set-${r.id}`);
      for (const [i, u] of r.moves.entries()) {
        const m = kernel.fromUci(st, u);
        if (!m)
          throw new Error(`games set: ${r.id} ply ${i + 1} ${u} is illegal in the lab kernel`);
        st = kernel.apply(st, m);
      }
      // The browser's replay, the function the page runs.
      const { states } = replayHordeXiangqiRecord({
        placement,
        moves: r.moves.join(' '),
        veteran: r.veteran,
        progressClock: r.clock,
        red: '',
        black: '',
        event: '',
        resultText: '',
      });
      const key = (b: Record<string, { color: string; role: string } | undefined>) =>
        Object.entries(b)
          .filter(([, p]) => p)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([sq, p]) => `${sq}:${p!.color}${p!.role}`)
          .join(' ');
      if (key(states.at(-1)!.board as never) !== key(st.board as never))
        throw new Error(`games set: ${r.id} ends on a different board in the browser replay`);
      const plies = r.moves.length;
      const cont = r.reason === 'ply-cap' ? CONTINUED[r.id] : undefined;
      if (r.reason === 'ply-cap' && (r.family === 'ladder' || (cont && cont.reason !== 'CLOCK')))
        throw new Error(`games set: ${r.id} hit the cap in an unexpected way`);
      if (r.family === 'ladder' && (r.nodes !== 100000 || r.lo !== 10000))
        throw new Error(`games set: ${r.id} is not the 100k against 10k ladder`);
      if (cont && plies !== 1000)
        throw new Error(`games set: ${r.id} capped at ${plies}, not 1,000`);
      const verdict = verdictOf(r.winner, r.reason, plies);
      // The verdict as an argument of the label and result: arg-free.
      const short = r.reason === 'ply-cap' ? 'v-capped' : verdict.k;
      const name: ['k', string] = ['k', `name-${r.formation}`];
      const ladder = r.family === 'ladder';
      const hordeNodes = ladder ? (r.hiSeat === 'red' ? r.nodes : r.lo!) : r.nodes;
      const armyNodes = ladder ? (r.hiSeat === 'black' ? r.nodes : r.lo!) : r.nodes;
      return {
        id: r.id,
        group: { k: `grp-${r.family}`, a: [] },
        label: ladder
          ? {
              k: 'lab-ladder',
              a: [nodesText(hordeNodes), nodesText(armyNodes), ['k', short] as SetArg],
            }
          : {
              k: 'lab-game',
              a: [name, nodesText(r.nodes), r.clock, ['k', short] as SetArg],
            },
        result: ladder
          ? {
              k: 'res-ladder',
              a: [['k', short] as SetArg, pl(plies), nodesText(hordeNodes), nodesText(armyNodes)],
            }
          : cont
            ? { k: 'res-capped', a: [pl(cont.plies), nodesText(r.nodes), r.clock] }
            : r.reason === 'ply-cap'
              ? { k: 'res-unfinished', a: [pl(plies), nodesText(r.nodes), r.clock] }
              : {
                  k: 'res-game',
                  a: [['k', short] as SetArg, pl(plies), nodesText(r.nodes), r.clock],
                },
        verdict,
        red: { k: 'seat-fsf', a: [nodesText(hordeNodes)] },
        black: { k: 'seat-fsf', a: [nodesText(armyNodes)] },
        moves: r.moves.join(' '),
        veteran: r.veteran,
        start: placement,
        clock: r.clock,
      };
    });
    console.log(
      `  horde games: ${setRecords.length}; reasons ${[...new Set(found.map((r) => r.reason))].join(', ')}`,
    );
    const SET_MODULE = path.join(HERE, '../apps/web/src/horde-xiangqi-games.ts');
    const setModule = `// Generated by scripts/gen-horde-diagrams.mts in this repository (--site).
// Do not hand-edit. Every lab game the horde-xiangqi article lets a reader
// step through, loaded on demand by its games card. The page replays each
// record through the horde rule kernel (replayHordeXiangqiRecord); the
// generator ran that same replay on every record against the lab kernel.

import type { StepGameSet } from './article-game-set.js';
import { replayHordeXiangqiRecord } from './horde-xiangqi-replay.js';

export const GAME_SET: StepGameSet = {
  open: 'veteran/forward36/1000000/120',
  replay: (record) =>
    replayHordeXiangqiRecord({
      placement: record.start ?? '',
      moves: record.moves,
      veteran: record.veteran === true,
      progressClock: record.clock ?? 60,
      red: '',
      black: '',
      event: '',
      resultText: '',
    }).states.map((state) => state.board),
  records: [
${setRecords.map((r) => `    ${JSON.stringify(r)},`).join('\n')}
  ],
};
`;
    if (!setRecords.some((r) => r.id === 'veteran/forward36/1000000/120'))
      throw new Error('games set: the forward36 veteran game is missing');
    // Templates the records name, and only those.
    const setKeys = new Set<string>(['game']);
    const walk = (t: { k: string; a: SetArg[] }) => {
      setKeys.add(t.k);
      const holes = [...(SET_STR[t.k] ?? '').matchAll(/%(\d)/g)].map((m) => Number(m[1]));
      if (holes.some((n) => n > t.a.length))
        throw new Error(`games set: ${t.k} has more holes than arguments`);
      for (const a of t.a) {
        if (!Array.isArray(a)) continue;
        // A ['k', key] argument is filled without arguments of its own.
        if (/%\d/.test(SET_STR[a[1]] ?? ''))
          throw new Error(`games set: ${a[1]} nested with holes`);
        setKeys.add(a[1]);
      }
    };
    for (const r of setRecords) {
      for (const t of [r.group, r.label, r.result, r.verdict, r.red, r.black]) walk(t as SetText);
    }
    for (const k of [...setKeys])
      if (SET_STR[k] === undefined) throw new Error(`games set: no template for ${k}`);
    const setStrings = Object.fromEntries(
      [...setKeys].sort().map((k) => [k, SET_STR[k]!] as const),
    );
    const moduleWithStrings = `${module}
/** The English templates the games card's records name (horde-xiangqi-games.ts). */
export const HORDE_GAME_SET_STRINGS: Record<string, string> = ${JSON.stringify(setStrings, null, 2)};
`;
    writeFileSync(SITE_MODULE, moduleWithStrings);
    writeFileSync(SET_MODULE, setModule);
    // The board literals come out on one line each; hand them to the repo's
    // formatter so the generated file passes the same gate as a written one.
    execSync(`npx biome check --write "${SITE_MODULE}" "${SET_MODULE}"`, {
      cwd: path.join(HERE, '..'),
      stdio: 'ignore',
    });
    console.log('  apps/web/src/horde-xiangqi-article-diagrams.ts');
    console.log(`  apps/web/src/horde-xiangqi-games.ts (${setModule.length} bytes)`);
  }
  // The replay on the page draws any piece a game can reach (a black soldier
  // across the river, say), not only what the figures show: copy the whole set.
  for (const color of ['red', 'black']) {
    for (const role of [
      'general',
      'advisor',
      'elephant',
      'horse',
      'chariot',
      'cannon',
      'soldier',
      'crossed-soldier',
    ]) {
      blogArt.add(`xiangqi/international/${color}-${role}.png`);
    }
  }
  for (const rel of BLOG_WRITE ? blogArt : []) {
    writeFileSync(
      path.join(BLOG_ASSETS, 'pieces', rel.replace(/\//g, '-')),
      readFileSync(path.join(PUBLIC, 'piece-sets', rel)),
    );
  }
  if (BLOG_WRITE) console.log(`  assets/posts/horde-xiangqi/pieces/ (${blogArt.size} files)`);

  // The feed thumbnail and the social card are built by the blog's own tool
  // (_private/tools/render_thumbnails.py, builders `horde` and `horde-card`):
  // the start array on the site's cream field, like every other board tile.
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
