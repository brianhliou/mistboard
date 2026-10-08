// Render Benedict Xiangqi diagram frames for the brianhliou.com write-up, using
// MISTBOARD'S OWN diagram primitives rather than a second board renderer.
//
// The jungle board art was once hand-ported into two blog files with nothing
// recording that mistboard was the reference, and it drifted. So this script
// imports xqBoardSvg/xqVisionDemoState directly, and lifts the .xq-diagram-*
// colour rules straight out of articles.css at build time, inlining them into
// each SVG so the file is self-contained on a site that does not load our CSS.
// Re-run it and the blog art follows mistboard's palette.
//
//   npx tsx scripts/gen-benedict-diagrams.mts          (the blog: writes brianhliou.com)
//   npx tsx scripts/gen-benedict-diagrams.mts --site   (mistboard's article only)
//
// --site writes nothing outside this repository: it runs every kernel check
// below, then emits apps/web/src/benedict-xiangqi-article-diagrams.ts and
// apps/web/src/benedict-xiangqi-games.ts for the /blog/benedict-xiangqi article.
//
// Every position here is DEFINED IN THIS FILE and CHECKED AGAINST THE KERNEL
// before it renders: each step names the move it plays, and the script asserts
// the move is legal and converts exactly the pieces the narrative claims. An
// earlier version read hand-composed positions out of a scratchpad JSON, which
// let two illegal frames ship (a soldier deleted rather than moved, and a
// soldier teleported across the board to make a conversion work) and then lost
// the source file when the scratchpad was cleaned up.

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { XiangqiPiece, XiangqiSquare } from '@mistboard/game';

// The diagram module's dependency graph reaches modules that `import './x.css'`,
// which Vite resolves and Node does not. Nothing here renders from a stylesheet
// (the colours are lifted out of articles.css as text, below), so a stylesheet
// import can safely become an empty module rather than stopping the run.
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) {
      return { format: 'module', shortCircuit: true, source: 'export default {};' };
    }
    return next(url, context);
  },
});

// The diagram modules read display preferences off localStorage at import time,
// because in the app they run in a browser. Minimal shim, set before the import
// so module-level constants can evaluate.
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
  xqBoardSvg,
  xqSvg,
  xqVisionDemoState,
  withXiangqiPieceSet,
  xqPoint,
  XQ_BOARD_W,
  XQ_BOARD_H,
  XQ_PIECE_SIZE,
  XQ_VIEWBOX_PAD,
} = await import('../apps/web/src/articles/diagrams.js');
const {
  createInitialBenedictXiangqiState,
  getBenedictXiangqiLegalMoves,
  isBenedictXiangqiLegalMove,
  benedictXiangqiResolveMove,
  applyBenedictXiangqiMove,
  benedictXiangqiPositionRepetitionKey,
} = await import('../packages/game/src/variants-benedict-xiangqi.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Mistboard's article only: run the checks, write nothing to the blog. */
const SITE = process.argv.includes('--site');
const CSS = path.join(HERE, '../apps/web/src/articles.css');
const GAMES = path.join(HERE, 'data/benedict-xiangqi-games.json');
const OUT = '/Users/brianliou/projects/brianhliou.com/assets/posts/benedict-xiangqi-balance';
const INCLUDES = '/Users/brianliou/projects/brianhliou.com/_includes';
// The international set draws pieces from PNGs. An SVG loaded through <img> is
// sandboxed and cannot fetch them, so the frames are emitted as INLINE svg in a
// Jekyll include instead, and the art is copied next to the post and shared by
// every frame rather than base64'd into each one.
const ART = '/assets/posts/benedict-xiangqi-balance/pieces';

/** Lift the diagram colour rules out of articles.css so the SVG stands alone. */
function diagramStyles(): string {
  const css = readFileSync(CSS, 'utf8');
  const rules: string[] = [];
  const re = /\.xq-article-svg (\.xq-diagram-[a-z-]+)\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    rules.push(`${m[1]}{${m[2].trim().replace(/\s+/g, ' ')}}`);
  }
  if (rules.length === 0) throw new Error('no .xq-diagram-* rules found in articles.css');
  return `<style>${rules.join('')}</style>`;
}
const STYLES = diagramStyles();

/** Point mistboard's own piece-art hrefs at the copies sitting next to the post. */
const localArt = (svg: string) =>
  svg.replace(
    /href="\/piece-sets\/xiangqi\/international\/([a-z-]+)\.png[^"]*"/g,
    (_, name) => `href="${ART}/${name}.png"`,
  );

// Cropping to Red's half plus the river and Black's soldier rank. The pieces on
// rank 7 have to stay in shot: one of the balanced first moves lands there and
// converts two of them, so a crop at the river would cut the point out.
const CROP_TOP_RANK = 7;
const CROP_Y = 46 + (10 - CROP_TOP_RANK) * 31 + XQ_VIEWBOX_PAD - XQ_PIECE_SIZE / 2 + 2;
const CROP_H = 28 + 315 + XQ_VIEWBOX_PAD - CROP_Y;

/** One board, wrapped so it renders standalone. */
function frame(
  board: Record<string, XiangqiPiece>,
  opts: {
    id: string;
    label: string;
    arrows?: Array<{ from: XiangqiSquare; to: XiangqiSquare }>;
    dots?: Array<{ square: XiangqiSquare }>;
    crop?: boolean;
  },
): string {
  const state = xqVisionDemoState(opts.id, board as Partial<Record<XiangqiSquare, XiangqiPiece>>);
  const body = withXiangqiPieceSet('international', () =>
    xqBoardSvg({
      state,
      x: 0,
      y: 0,
      label: opts.label,
      perspective: 'red',
      arrows: opts.arrows,
      dots: opts.dots,
    }),
  );
  const svg = xqSvg(XQ_BOARD_W, XQ_BOARD_H + 28, body).replace('>', `>${STYLES}`);
  if (!opts.crop) return localArt(svg);
  // The viewBox is the crop: everything above it is simply outside the frame.
  return localArt(
    svg.replace(/viewBox="0 0 (\d+) \d+"/, (_, w) => `viewBox="0 ${CROP_Y} ${w} ${CROP_H}"`),
  );
}

// ── The positions ──────────────────────────────────────────────────────────
//
// Each sequence is a start position plus the moves played from it. The rule
// diagrams are DEMO BOARDS: a handful of pieces on an empty board, because the
// rule is easier to see when only the pieces it acts on are present. They are
// still run through the kernel, so an illegal move or a wrong conversion count
// stops the build rather than shipping.

type Role = XiangqiPiece['role'];
const P = (color: 'red' | 'black', role: Role): XiangqiPiece => ({ color, role });

type Step = {
  /** The move played FROM this frame. The last frame has none. */
  move?: [string, string];
  label: string;
  narrative: string;
  /** Squares the previous move converted, marked on the board. */
  dots?: string[];
  /** Set on the frame reached by a move that ends the game. */
  wins?: boolean;
};
type Sequence = {
  slug: string;
  /** Play from the real starting array instead of a hand-placed demo board. */
  start?: true;
  turn?: 'red' | 'black';
  board?: Record<string, XiangqiPiece>;
  steps: Step[];
};

const SEQUENCES: Sequence[] = [
  {
    // The chariot starts on d1 attacking nothing at all, which is the point: a
    // standing attack is inert, so the conversion has to be created BY the
    // move. Landing on d4 puts both black soldiers on its rank at once.
    slug: 'rule',
    turn: 'red',
    board: {
      d1: P('red', 'chariot'),
      f1: P('red', 'general'),
      e10: P('black', 'general'),
      a4: P('black', 'soldier'),
      g4: P('black', 'soldier'),
    },
    steps: [
      {
        move: ['d1', 'd4'],
        label: 'Red to move',
        narrative:
          'The chariot on d1 attacks nothing at all. Two black soldiers stand on the fourth rank, which is where it is going.',
      },
      {
        label: 'After d1d4',
        dots: ['a4', 'g4'],
        narrative:
          'Both soldiers changed sides. Nothing was captured and nothing left the board, so Red is two pieces up and Black two down, from one move.',
      },
    ],
  },
  {
    // The opening threat, from the real array: four plies of engine moves. This
    // is the position the whole 78% comes down to.
    slug: 'threat',
    start: true,
    steps: [
      {
        move: ['b3', 'b5'],
        label: 'Start',
        narrative: 'Red lifts a cannon to the fifth rank.',
      },
      {
        move: ['h8', 'h5'],
        label: 'After b3b5',
        dots: ['b10'],
        narrative:
          "It fires up the b-file over Black's own cannon and turns the horse on b10. It also threatens b5e5, where Black's soldier on e7 is the screen and the general stands behind it. 32 of Black's 38 replies lose on the spot, all of them to that one move.",
      },
      {
        move: ['b5', 'e5'],
        label: 'After h8h5',
        dots: ['h1'],
        narrative:
          'Black answers in kind and takes the horse on h1. It is a reasonable-looking move and one of the 32 that lose.',
      },
      {
        label: 'b5e5 wins',
        wins: true,
        dots: ['e10'],
        narrative:
          'The cannon lands on e5, fires over the black soldier, and bears on the general. That ends the game.',
      },
    ],
  },
];

const oppositeOf = (c?: 'red' | 'black') =>
  c === undefined ? undefined : c === 'red' ? 'black' : 'red';

/** A state the kernel will accept, built around a hand-placed demo board. */
function demoState(board: Record<string, XiangqiPiece>, turn: 'red' | 'black') {
  const state = {
    id: 'demo',
    board: { ...board },
    status: { type: 'playing', turn },
    moveNumber: 1,
    positionCounts: {} as Record<string, number>,
    progressPlies: 0,
  };
  state.positionCounts[benedictXiangqiPositionRepetitionKey(state as never)] = 1;
  return state as never;
}

// ── Render ─────────────────────────────────────────────────────────────────

if (!SITE) {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(INCLUDES, { recursive: true });
}

/** Each sequence's kernel boards, one per frame, for the site module. */
const seqBoards: Record<string, Array<Record<string, XiangqiPiece>>> = {};

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

for (const seq of SEQUENCES) {
  // Walk the sequence through the kernel, collecting a board per frame. Every
  // move is checked for legality, and every frame's claim - the squares it
  // marks as converted, and whether it says the game ended - is checked against
  // what the rules actually produce. A wrong diagram fails the build.
  let state = seq.start
    ? (createInitialBenedictXiangqiState(seq.slug) as never)
    : demoState(seq.board as Record<string, XiangqiPiece>, seq.turn as 'red' | 'black');
  const boards: Array<Record<string, XiangqiPiece>> = [];
  for (const [i, step] of seq.steps.entries()) {
    boards.push({ ...(state as { board: Record<string, XiangqiPiece> }).board });
    if (!step.move) {
      if (i !== seq.steps.length - 1)
        throw new Error(`${seq.slug}: only the last frame may omit a move`);
      break;
    }
    const move = { from: step.move[0], to: step.move[1] } as never;
    const name = step.move.join('');
    if (!isBenedictXiangqiLegalMove(state, move)) {
      throw new Error(`${seq.slug}: ${name} is not a legal move here`);
    }
    const { flipped, wins } = benedictXiangqiResolveMove(
      (state as { board: unknown }).board as never,
      move,
    );
    const next = seq.steps[i + 1];
    if (!next) throw new Error(`${seq.slug}: ${name} has no frame after it`);
    if (Boolean(next.wins) !== wins) {
      throw new Error(`${seq.slug}: ${name} wins=${wins}, frame claims wins=${Boolean(next.wins)}`);
    }
    // A winning move ends the game before conversions apply, so its frame marks
    // the general it attacks rather than a conversion list.
    if (!wins) {
      const got = [...flipped].sort().join(',');
      const claimed = [...(next.dots ?? [])].sort().join(',');
      if (got !== claimed) {
        throw new Error(`${seq.slug}: ${name} converts [${got}], frame claims [${claimed}]`);
      }
    }
    state = applyBenedictXiangqiMove(state, move) as never;
  }
  seqBoards[seq.slug] = boards;
  if (SITE) continue;

  const steps = seq.steps.map((step, i) => {
    const board = { ...boards[i] };
    if (step.wins) {
      const loser = seq.steps[i - 1]?.move
        ? oppositeOf(board[seq.steps[i - 1]!.move![1]]?.color)
        : undefined;
      if (loser) {
        for (const [sq, piece] of Object.entries(board)) {
          if (piece.role === 'general' && piece.color === loser) {
            board[sq] = { color: oppositeOf(loser)!, role: 'general' };
          }
        }
      }
    }
    const svg = frame(board, {
      id: `${seq.slug}-${i}`,
      label: step.label,
      arrows: step.move
        ? [{ from: step.move[0] as XiangqiSquare, to: step.move[1] as XiangqiSquare }]
        : undefined,
      dots: step.dots?.map((sq) => ({ square: sq as XiangqiSquare })),
    });
    // The narrative is NOT rendered. It stays here as the record of what each
    // frame is meant to show, and as what the kernel assertions are checked
    // against, but the boards carry their own labels and the prose around them
    // carries the argument. A caption under every board restated the prose, and
    // restating is where the inaccuracies crept in.
    return [
      `  <figure class="xq-step" data-step="${i}"${i === 0 ? '' : ' hidden'}>`,
      `    <div class="xq-step-board">${svg}</div>`,
      '  </figure>',
    ].join('\n');
  });
  const html = [
    `<!-- Generated by scripts/gen-benedict-diagrams.mts in the mistboard repo.`,
    `     Do not hand-edit: re-run the generator. -->`,
    `<div class="xq-stepper" data-stepper="${seq.slug}">`,
    steps.join('\n'),
    '  <div class="xq-step-nav">',
    '    <button type="button" data-dir="-1" aria-label="Previous position">&#8592;</button>',
    `    <span class="xq-step-count">1 / ${seq.steps.length}</span>`,
    '    <button type="button" data-dir="1" aria-label="Next position">&#8594;</button>',
    '  </div>',
    '</div>',
  ].join('\n');
  writeFileSync(path.join(INCLUDES, `benedict-xq-${seq.slug}.html`), html + '\n');
  console.log(
    `  _includes/benedict-xq-${seq.slug}.html (${seq.steps.length} frames, kernel-checked)`,
  );
}

// ── The four balanced openings ─────────────────────────────────────────────
//
// Under a pie rule Red is pushed onto whichever first move is closest to even,
// so these four are the ones that matter, and coordinates alone do not show
// what they are. Each is the real starting array with the move drawn on it,
// cropped to Red's half plus the river and Black's soldier rank.

const PIE: Array<{ move: [string, string]; what: string; score: string }> = [
  {
    move: ['b3', 'b4'],
    what: 'The cannon steps up one, well short of the fifth rank that does the damage.',
    score: '45.8%',
  },
  {
    move: ['b3', 'b7'],
    what: 'The cannon goes all the way in, converting now and giving up the standing threat.',
    score: '50.0%',
  },
  {
    move: ['d1', 'e2'],
    what: "An advisor develops, and vacates d1. The generals' file is in play from move one.",
    score: '54.2%',
  },
  {
    move: ['e4', 'e5'],
    what: 'The central soldier: the one quiet developing move that is not a blunder.',
    score: '54.2%',
  },
];

{
  const start = createInitialBenedictXiangqiState('pie');
  const cells = PIE.map(({ move, what, score }) => {
    const m = { from: move[0], to: move[1] } as never;
    if (!isBenedictXiangqiLegalMove(start as never, m)) {
      throw new Error(`pie: ${move.join('')} is not a legal first move`);
    }
    const svg = frame((start as { board: Record<string, XiangqiPiece> }).board, {
      id: `pie-${move.join('')}`,
      label: '',
      arrows: [{ from: move[0] as XiangqiSquare, to: move[1] as XiangqiSquare }],
      crop: true,
    });
    return [
      '  <figure class="xq-quad-cell">',
      `    <div class="xq-quad-board">${svg}</div>`,
      `    <figcaption><b>${move.join('')}</b> <span class="xq-quad-score">${score}</span><br>${esc(what)}</figcaption>`,
      '  </figure>',
    ].join('\n');
  });
  if (!SITE)
    writeFileSync(
      path.join(INCLUDES, 'benedict-xq-pie.html'),
      [
        '<!-- Generated by scripts/gen-benedict-diagrams.mts. Do not hand-edit. -->',
        '<div class="xq-quad">',
        cells.join('\n'),
        '</div>',
      ].join('\n') + '\n',
    );
  if (!SITE)
    console.log(`  _includes/benedict-xq-pie.html (${PIE.length} cropped boards, kernel-checked)`);
}

// ── Game browser ───────────────────────────────────────────────────────────
//
// One empty board plus every recorded game, rendered client-side. The pieces
// are not re-drawn by hand: mistboard's own glyph renderer emits one sprite per
// (colour, role, crossed) here, and the page stamps those. Before this the
// browser drew bare PNGs with no disc and no ring, so it read as a different
// and cruder board than the static frames three sections above it.

const games = JSON.parse(readFileSync(GAMES, 'utf8')) as {
  games: Array<{
    result: string;
    firstMover: string;
    plies: Array<{
      side: string;
      before: string;
      move: string;
      flipped: string[];
      legal: number;
      losing: number;
      winning: number;
      after?: string;
    }>;
  }>;
};

// Coordinate table for all 90 points, straight from the renderer's own geometry.
const points: Record<string, { x: number; y: number }> = {};
for (let f = 0; f < 9; f++) {
  for (let r = 1; r <= 10; r++) {
    const { x, y } = xqPoint(f, r, 'red', 0, 28);
    points[`${'abcdefghi'[f]}${r}`] = {
      x: +(x - XQ_PIECE_SIZE / 2).toFixed(2),
      y: +(y - XQ_PIECE_SIZE / 2).toFixed(2),
    };
  }
}

// One sprite per piece kind. These are CUT OUT OF A RENDERED BOARD rather than
// re-drawn: put one of every kind on a board, render it with the same primitive
// the static frames use, then lift each piece's <svg> out by the square it
// landed on. Nothing about disc, ring, inset or crossed-soldier art is restated
// here, so the browser cannot drift away from the frames above it.
const ROLES: Role[] = ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon'];
const spriteBoard: Record<string, XiangqiPiece> = {};
const spriteSquare: Record<string, string> = {};
for (const [i, role] of ROLES.entries()) {
  const file = 'abcdefghi'[i];
  spriteBoard[`${file}1`] = P('red', role);
  spriteSquare[`red-${role}`] = `${file}1`;
  spriteBoard[`${file}10`] = P('black', role);
  spriteSquare[`black-${role}`] = `${file}10`;
}
// A soldier's art depends on whether it has crossed the river, and the renderer
// derives that from the rank rather than from a flag, so each soldier needs a
// square on each side of its own river: red counts as crossed from rank 6 up,
// black from rank 5 down.
for (const [key, square] of Object.entries({
  'red-soldier': 'a5',
  'red-soldier-crossed': 'a6',
  'black-soldier': 'c6',
  'black-soldier-crossed': 'c5',
})) {
  spriteBoard[square] = P(key.startsWith('red') ? 'red' : 'black', 'soldier');
  spriteSquare[key] = square;
}

const spriteSheet = withXiangqiPieceSet('international', () =>
  xqBoardSvg({
    state: xqVisionDemoState('sprites', spriteBoard as never),
    x: 0,
    y: 0,
    label: '',
    perspective: 'red',
  }),
);
const sprites: Record<string, string> = {};
for (const [key, square] of Object.entries(spriteSquare)) {
  const { x, y } = points[square];
  const at = `<svg x="${x}" y="${y}"`;
  const from = spriteSheet.indexOf(at);
  if (from === -1) throw new Error(`sprite ${key}: nothing rendered at ${square}`);
  // Strip the outer element's own placement; the page supplies x and y.
  sprites[key] = localArt(
    spriteSheet.slice(spriteSheet.indexOf('>', from) + 1, spriteSheet.indexOf('</svg>', from)),
  );
}

const emptyGrid = withXiangqiPieceSet('international', () =>
  xqBoardSvg({
    state: xqVisionDemoState('browser', {}),
    x: 0,
    y: 0,
    label: '',
    perspective: 'red',
  }),
);
const shell = xqSvg(XQ_BOARD_W, XQ_BOARD_H + 28, emptyGrid).replace('>', `>${STYLES}`);

const browser = [
  '<!-- Generated by scripts/gen-benedict-diagrams.mts. Do not hand-edit. -->',
  '<div class="xq-browser">',
  '  <div class="xq-browser-head">',
  '    <label>Game <select class="xq-browser-pick"></select></label>',
  '    <span class="xq-browser-meta"></span>',
  '  </div>',
  // The board grid is drawn inside a translate by the viewBox pad; the pieces
  // are positioned in the same coordinate space, so they need the same one.
  // Appending them outside it shifted the whole army up and to the left.
  `  <div class="xq-browser-board">${shell.replace('</svg>', `<g class="xq-browser-pieces" transform="translate(${XQ_VIEWBOX_PAD} ${XQ_VIEWBOX_PAD})"></g></svg>`)}</div>`,
  '  <div class="xq-browser-nav">',
  '    <button type="button" data-jump="start" aria-label="First position">&#124;&#9664;</button>',
  '    <button type="button" data-step="-1" aria-label="Back one move">&#9664;</button>',
  '    <span class="xq-browser-ply">0</span>',
  '    <button type="button" data-step="1" aria-label="Forward one move">&#9654;</button>',
  '    <button type="button" data-jump="end" aria-label="Last position">&#9654;&#124;</button>',
  '  </div>',
  `  <script type="application/json" class="xq-browser-data">${JSON.stringify({ points, size: XQ_PIECE_SIZE, sprites, games: games.games })}</script>`,
  '</div>',
].join('\n');

if (!SITE) writeFileSync(path.join(INCLUDES, 'benedict-xq-browser.html'), browser + '\n');
if (!SITE)
  console.log(
    `  _includes/benedict-xq-browser.html (${games.games.length} games, ${Object.keys(sprites).length} sprites)`,
  );
if (!SITE) console.log('\ndone');

// ── The playable board ─────────────────────────────────────────────────────
//
// The rule is hard to feel from prose and static frames: you have to move a
// piece and watch two enemy pieces change colour. This emits the board shell
// and reuses the sprite sheet built above, then bundles the SAME kernel the
// diagrams are checked against, so the page cannot enforce different rules than
// the article describes. No second implementation, no engine, no opponent.

if (!SITE) {
  const kernelOut = path.join(OUT, 'benedict-kernel.js');
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [path.join(HERE, '../packages/game/src/variants-benedict-xiangqi.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'BenedictXQ',
    target: 'es2020',
    minify: true,
    outfile: kernelOut,
    logLevel: 'silent',
  });
  const bytes = readFileSync(kernelOut).byteLength;

  const playShell = xqSvg(
    XQ_BOARD_W,
    XQ_BOARD_H + 28,
    withXiangqiPieceSet('international', () =>
      xqBoardSvg({
        state: xqVisionDemoState('play', {}),
        x: 0,
        y: 0,
        label: '',
        perspective: 'red',
      }),
    ),
  ).replace('>', `>${STYLES}`);
  const layers =
    `<g class="xq-play-dots" transform="translate(${XQ_VIEWBOX_PAD} ${XQ_VIEWBOX_PAD})"></g>` +
    `<g class="xq-play-pieces" transform="translate(${XQ_VIEWBOX_PAD} ${XQ_VIEWBOX_PAD})"></g></svg>`;

  const play = [
    '<!-- Generated by scripts/gen-benedict-diagrams.mts. Do not hand-edit. -->',
    '<div class="xq-play">',
    '  <p class="xq-play-turn"></p>',
    `  <div class="xq-play-board">${playShell.replace('</svg>', layers)}</div>`,
    '  <div class="xq-play-nav">',
    '    <button type="button" data-play="undo">Undo</button>',
    '    <button type="button" data-play="reset">Reset</button>',
    '  </div>',
    '  <p class="xq-play-note"></p>',
    `  <script type="application/json" class="xq-play-data">${JSON.stringify({ points, size: XQ_PIECE_SIZE, sprites })}</script>`,
    '</div>',
  ].join('\n');
  writeFileSync(path.join(INCLUDES, 'benedict-xq-play.html'), play + '\n');
  console.log(
    `  _includes/benedict-xq-play.html + benedict-kernel.js (${(bytes / 1024).toFixed(1)} kB, bundled from the kernel)`,
  );
}

// ── The mistboard article (--site) ─────────────────────────────────────────
//
// The site draws its diagrams at runtime so they follow the reader's board and
// piece pickers, and the kernel is deliberately not a web dependency. So the
// kernel-checked boards above are written out as literals into a generated
// module, drawn there with the shared xiangqi diagram toolkit; the 54 games go
// to a module the article loads on demand, with the squares each move
// converted. That module's own replay is imported back here and compared with
// the kernel at every ply of every game before the run succeeds.

/** Red's 42 first moves and what Red then scored, 300k nodes a move, 24 games
 *  each (evidence repo data/openings-42.txt), lowest first. The kernel must
 *  agree these are exactly the legal first moves. */
const OPENINGS: Array<[string, string]> = [
  ['c1a3', '0.0%'],
  ['e1e2', '0.0%'],
  ['g1i3', '0.0%'],
  ['b3a3', '4.2%'],
  ['b3c3', '8.3%'],
  ['h1i3', '12.5%'],
  ['h3f3', '16.7%'],
  ['b3g3', '18.8%'],
  ['h3c3', '20.8%'],
  ['i1i2', '20.8%'],
  ['h3g3', '22.9%'],
  ['i1i3', '25.0%'],
  ['h3i3', '25.0%'],
  ['g1e3', '25.0%'],
  ['h1g3', '25.0%'],
  ['a1a3', '27.1%'],
  ['b3b2', '27.1%'],
  ['h3h2', '29.2%'],
  ['b3d3', '29.2%'],
  ['i4i5', '29.2%'],
  ['b3f3', '33.3%'],
  ['b1a3', '35.4%'],
  ['c1e3', '35.4%'],
  ['b3e3', '35.4%'],
  ['c4c5', '35.4%'],
  ['h3e3', '37.5%'],
  ['h3d3', '39.6%'],
  ['b1c3', '41.7%'],
  ['a4a5', '41.7%'],
  ['g4g5', '43.8%'],
  ['b3b4', '45.8%'],
  ['b3b7', '50.0%'],
  ['d1e2', '54.2%'],
  ['e4e5', '54.2%'],
  ['a1a2', '58.3%'],
  ['h3h7', '60.4%'],
  ['h3h4', '60.4%'],
  ['b3b6', '70.8%'],
  ['f1e2', '72.9%'],
  ['h3h5', '79.2%'],
  ['b3b5', '87.5%'],
  ['h3h6', '91.7%'],
];

if (SITE) {
  type Plain = Record<string, { color: string; role: string } | undefined>;
  const plainKey = (b: Plain) =>
    Object.entries(b)
      .filter(([, p]) => p)
      .sort(([a], [z]) => a.localeCompare(z))
      .map(([sq, p]) => `${sq}:${p!.color}${p!.role}`)
      .join(' ');
  const boardLiteral = (b: Plain) =>
    `{ ${Object.entries(b)
      .filter(([, p]) => p)
      .sort(([a], [z]) => a.localeCompare(z))
      .map(([sq, p]) => `${sq}: { color: '${p!.color}', role: '${p!.role}' }`)
      .join(', ')} }`;
  const boardOf = (s: unknown) => (s as { board: Plain }).board;
  type Mv = { from: string; to: string };

  // The openings table: the 42 moves must be exactly the kernel's legal first
  // moves, and the rows read down each column, lowest score first.
  const initial = createInitialBenedictXiangqiState('site-openings');
  const legalFirst = (getBenedictXiangqiLegalMoves(initial as never) as Mv[])
    .map((m) => `${m.from}${m.to}`)
    .sort();
  const tableMoves = OPENINGS.map(([m]) => m).sort();
  if (legalFirst.join() !== tableMoves.join())
    throw new Error(
      `openings: table moves differ from the kernel's ${legalFirst.length} legal first moves`,
    );
  const scores = OPENINGS.map(([, s]) => Number.parseFloat(s));
  if (scores.some((s, i) => i > 0 && s < scores[i - 1]!)) throw new Error('openings: not sorted');
  const openingRows: string[][] = [];
  for (let r = 0; r < 14; r++) {
    openingRows.push(
      [0, 1, 2].flatMap((c) => {
        const [m, s] = OPENINGS[c * 14 + r]!;
        return [m, s];
      }),
    );
  }

  // The threat: after b3b5, how many of Black's replies lose at once, and to what.
  {
    let s = createInitialBenedictXiangqiState('site-threat') as never;
    s = applyBenedictXiangqiMove(s, { from: 'b3', to: 'b5' } as never) as never;
    const replies = getBenedictXiangqiLegalMoves(s) as Mv[];
    // A reply loses at once when Red then has a winning move; every such reply
    // must lose to b5e5 (some lose to a second move as well).
    let losing = 0;
    let toB5e5 = 0;
    for (const r of replies) {
      const t = applyBenedictXiangqiMove(s, r as never);
      const winning = (getBenedictXiangqiLegalMoves(t as never) as Mv[])
        .filter((m) => benedictXiangqiResolveMove(boardOf(t) as never, m as never).wins)
        .map((m) => `${m.from}${m.to}`);
      if (winning.length > 0) losing += 1;
      if (winning.includes('b5e5')) toB5e5 += 1;
    }
    if (replies.length !== 38 || losing !== 32 || toB5e5 !== 32)
      throw new Error(
        `threat: ${replies.length} replies, ${losing} lose, ${toB5e5} to b5e5; the article says 38, 32, 32`,
      );
  }

  // The steppers' frames: the kernel boards kept above, an arrow on the move
  // that led to each and a ring on every square it converted (on the winning
  // move, the general it bears on).
  type Frame = { board: string; from?: string; to?: string; marks: string[] };
  const framesOf = (slug: string): Frame[] => {
    const seq = SEQUENCES.find((x) => x.slug === slug)!;
    return seqBoards[slug]!.map((b, i) => {
      const prev = seq.steps[i - 1];
      return {
        board: boardLiteral(b as Plain),
        ...(prev?.move ? { from: prev.move[0], to: prev.move[1] } : {}),
        marks: seq.steps[i]!.dots ?? [],
      };
    });
  };
  const framesLiteral = (frames: Frame[]) =>
    `[\n${frames
      .map(
        (f) =>
          `  { board: ${f.board}, ${f.from ? `from: '${f.from}', to: '${f.to}', ` : ''}marks: [${f.marks.map((m) => `'${m}'`).join(', ')}] },`,
      )
      .join('\n')}\n]`;
  const startBoard = boardLiteral(boardOf(createInitialBenedictXiangqiState('site-start')));

  const pieFrames = PIE.map(({ move }) => `['${move[0]}', '${move[1]}']`).join(', ');
  const pieScores = PIE.map(({ move, score }) => {
    const row = OPENINGS.find(([m]) => m === move.join(''));
    if (row?.[1] !== score)
      throw new Error(`pie: ${move.join('')} scores ${row?.[1]} in the table`);
    return score;
  });

  // ── The games ──
  const STR: Record<string, string> = {
    game: 'Game',
    red: 'Red',
    black: 'Black',
    'group-won': 'First mover won (%1)',
    'group-lost': 'First mover lost (%1)',
    label: 'Game %1: %2 first, %3 plies',
    'result-won': '%1 moved first and won in %2 plies.',
    'result-lost': '%1 moved first and lost in %2 plies.',
    'red-wins': 'Red wins',
    'black-wins': 'Black wins',
    'seat-engine': 'Engine, 2M nodes',
  };
  const kernelBoards: Record<string, string[]> = {};
  const flips: Record<string, string> = {};
  const wins: Record<string, string> = {};
  type SetRecord = Record<string, unknown> & { id: string; won: boolean };
  const records: SetRecord[] = games.games.map((g, gi) => {
    const id = `g${gi + 1}`;
    const first = g.firstMover as 'red' | 'black';
    let st = createInitialBenedictXiangqiState(`set-${id}`) as never as {
      board: Plain;
      status: { type: string; turn?: string; winner?: string };
    };
    if (first === 'black') st = { ...st, status: { type: 'playing', turn: 'black' } };
    const keys = [plainKey(st.board)];
    const perPly: string[] = [];
    g.plies.forEach((p, i) => {
      const { from, to } = p as unknown as { from: string; to: string };
      if (`${from}${to}` !== p.move) throw new Error(`${id}: ply ${i + 1} is ${p.move}`);
      const move = { from, to };
      if (!isBenedictXiangqiLegalMove(st as never, move as never))
        throw new Error(`${id}: ${p.move} illegal at ply ${i + 1}`);
      const r = benedictXiangqiResolveMove(st.board as never, move as never);
      const last = i === g.plies.length - 1;
      if (r.wins !== last) throw new Error(`${id}: ply ${i + 1} wins=${r.wins}`);
      if (!r.wins && [...r.flipped].sort().join() !== [...p.flipped].sort().join())
        throw new Error(
          `${id}: ply ${i + 1} converts ${r.flipped.join()}, record says ${p.flipped.join()}`,
        );
      perPly.push([...r.flipped].sort().join(','));
      st = applyBenedictXiangqiMove(st as never, move as never) as never;
      keys.push(plainKey(st.board));
    });
    if (st.status.type !== 'finished' || st.status.winner !== g.result)
      throw new Error(`${id}: kernel ends ${JSON.stringify(st.status)}, record says ${g.result}`);
    const loser = g.result === 'red' ? 'black' : 'red';
    const general = Object.entries(st.board).find(
      ([, p]) => p?.role === 'general' && p.color === loser,
    )?.[0];
    if (!general) throw new Error(`${id}: no ${loser} general on the final board`);
    kernelBoards[id] = keys;
    flips[id] = perPly.join(';');
    wins[id] = general;
    const won = g.result === first;
    const n = g.plies.length;
    const moves = g.plies.map((p) => p.move).join(' ');
    return {
      id,
      won,
      group: { k: won ? 'group-won' : 'group-lost', a: [] as unknown[] },
      label: { k: 'label', a: [gi + 1, ['k', first], n] },
      result: { k: won ? 'result-won' : 'result-lost', a: [['k', first], n] },
      verdict: { k: g.result === 'red' ? 'red-wins' : 'black-wins', a: [] },
      red: { k: 'seat-engine', a: [] },
      black: { k: 'seat-engine', a: [] },
      moves,
      san: moves,
      ...(first === 'black' ? { firstMover: 'black' } : {}),
    };
  });
  const wonCount = records.filter((r) => r.won).length;
  const lostCount = records.length - wonCount;
  const plies = Object.values(kernelBoards).reduce((a, k) => a + k.length - 1, 0);
  const redFirst = games.games.filter((g) => g.firstMover === 'red');
  const blackFirst = games.games.filter((g) => g.firstMover === 'black');
  const tally = [
    records.length,
    wonCount,
    plies,
    redFirst.length,
    redFirst.filter((g) => g.result === 'red').length,
    blackFirst.length,
    blackFirst.filter((g) => g.result === 'black').length,
  ].join();
  if (tally !== '54,46,1696,36,33,18,13')
    throw new Error(
      `games: ${tally}; the article says 54 games, 46 won, 1,696 plies, 36 (33) and 18 (13)`,
    );
  // Won games first, then the upsets; each group in game order.
  const ordered = [...records.filter((r) => r.won), ...records.filter((r) => !r.won)].map(
    ({ won, ...r }) => ({
      ...r,
      group: { k: (r.group as { k: string }).k, a: [won ? wonCount : lostCount] },
    }),
  );
  const open = 'g2';

  const SITE_MODULE = path.join(HERE, '../apps/web/src/benedict-xiangqi-article-diagrams.ts');
  const SET_MODULE = path.join(HERE, '../apps/web/src/benedict-xiangqi-games.ts');
  const siteModule = `// Generated by scripts/gen-benedict-diagrams.mts in this repository (--site).
// Do not hand-edit: every position is played through the Benedict Xiangqi rule
// kernel (packages/game/src/variants-benedict-xiangqi.ts) and asserted there
// before it is written out, so a rules change redraws these boards instead of
// leaving them quietly wrong. Drawn with the shared xiangqi diagram toolkit so
// they follow the reader's board and piece pickers like every other figure.

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
/** A frame: the kernel's board, the move that led to it, the squares it converted. */
type Frame = { board: Board; from?: string; to?: string; marks: string[] };

/** The starting array. */
export const BENEDICT_START: Board = ${startBoard};

/** The rule on a demo board: d1d4 converts both soldiers on the fourth rank. */
export const BENEDICT_RULE: Frame[] = ${framesLiteral(framesOf('rule'))};

/** From the array: b3b5, h8h5, b5e5 wins (the ring on the general it bears on). */
export const BENEDICT_THREAT: Frame[] = ${framesLiteral(framesOf('threat'))};

function benedictFrame(id: string, frame: Frame): () => string {
  return () =>
    xqSvg(
      XQ_BOARD_W,
      XQ_BOARD_H + 8,
      xqBoardSvg({
        state: xqVisionDemoState(id, frame.board),
        x: 0,
        y: -24,
        label: '',
        perspective: 'red',
        arrows:
          frame.from && frame.to
            ? [{ from: frame.from as XiangqiSquare, to: frame.to as XiangqiSquare }]
            : undefined,
        dots: frame.marks.map((square) => ({ square: square as XiangqiSquare, capture: true })),
      }),
    );
}

/** Stepper steps: the move that led to each frame names its row of the score
 *  sheet, and notes[i] is the note under it (notes[0] describes the start). */
export function benedictSteps(
  id: string,
  frames: Frame[],
  notes: ReadonlyArray<string | undefined>,
): Array<{ svg: () => string; narrative?: string; move?: string }> {
  return frames.map((frame, i) => ({
    svg: benedictFrame(\`\${id}-\${i}\`, frame),
    ...(notes[i] ? { narrative: notes[i] } : {}),
    ...(frame.from && frame.to ? { move: \`\${frame.from}\${frame.to}\` } : {}),
  }));
}

/** The four first moves closest to even (${pieScores.join(', ')}), cropped to
 *  Red's half, the river and Black's soldier rank. */
export const BENEDICT_PIE_FRAMES: Array<() => string> = [${pieFrames}].map(
  ([from, to], i) => () =>
    xqSvg(
      XQ_BOARD_W,
      XQ_BOARD_H + 28,
      xqBoardSvg({
        state: xqVisionDemoState(\`benedict-pie-\${i}\`, BENEDICT_START),
        x: 0,
        y: 0,
        label: '',
        perspective: 'red',
        arrows: [{ from: from as XiangqiSquare, to: to as XiangqiSquare }],
      }),
    ).replace(/viewBox="0 0 ([\\d.]+) [\\d.]+"/, (_, w) => \`viewBox="0 ${CROP_Y} \${w} ${CROP_H}"\`),
);

/** Red's 42 first moves and Red's score after each, three move/score pairs a
 *  row, reading down each pair of columns from the lowest score. */
export const BENEDICT_OPENING_ROWS: string[][] = ${JSON.stringify(openingRows)};

// The card: a black horse and the red horse it becomes.
const THUMB_W = 160;
const THUMB_H = 100;
const THUMB_SIZE = 62;

export const BENEDICT_XIANGQI_THUMBNAIL = () => {
  const gap = 28;
  const x0 = (THUMB_W - (THUMB_SIZE * 2 + gap)) / 2;
  const y = (THUMB_H - THUMB_SIZE) / 2;
  const mid = THUMB_H / 2;
  const ax = x0 + THUMB_SIZE + 6;
  const bx = x0 + THUMB_SIZE + gap - 6;
  return [
    \`<svg class="xq-article-svg" viewBox="0 0 \${THUMB_W} \${THUMB_H}" role="img" aria-label="Benedict Xiangqi" xmlns="http://www.w3.org/2000/svg">\`,
    renderXiangqiPieceGlyphed({ role: 'horse', color: 'black' }, activeXiangqiPieceSet, { x: x0, y, size: THUMB_SIZE }),
    \`<path d="M\${ax} \${mid}H\${bx}M\${bx - 6} \${mid - 6}L\${bx} \${mid}L\${bx - 6} \${mid + 6}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>\`,
    renderXiangqiPieceGlyphed({ role: 'horse', color: 'red' }, activeXiangqiPieceSet, { x: x0 + THUMB_SIZE + gap, y, size: THUMB_SIZE }),
    '</svg>',
  ].join('');
};

/** The English templates the games card's records name (benedict-xiangqi-games.ts). */
export const BENEDICT_GAME_SET_STRINGS: Record<string, string> = ${JSON.stringify(STR, null, 2)};
`;
  const setModule = `// Generated by scripts/gen-benedict-diagrams.mts in this repository (--site).
// Do not hand-edit. The 54 engine games the Benedict Xiangqi article lets a
// reader step through, loaded on demand by its games card. A move here can
// change the colour of pieces it never touches, so each record carries the
// squares every ply converted, and the replay below recolours them; the
// generator compared that replay with the rule kernel at every ply.

import type { XiangqiSquare } from '@mistboard/game';
import { type GameSetBoard, type StepGameSet, splitGameSetMove } from './article-game-set.js';
import { BENEDICT_START } from './benedict-xiangqi-article-diagrams.js';

/** Per record, the squares each ply converted: plies split by ';', squares by ','. */
const FLIPS: Record<string, string> = ${JSON.stringify(flips)};
/** Per record, the general the winning move bears on. */
const WINS: Record<string, string> = ${JSON.stringify(wins)};

const flipsOf = (id: string): string[][] =>
  (FLIPS[id] ?? '').split(';').map((s) => (s ? s.split(',') : []));

export const GAME_SET: StepGameSet = {
  open: '${open}',
  records: [
${ordered.map((r) => `    ${JSON.stringify(r)},`).join('\n')}
  ],
  replay(record) {
    const flips = flipsOf(record.id);
    let board: GameSetBoard = { ...BENEDICT_START };
    const boards = [board];
    record.moves.split(' ').forEach((token, i) => {
      const { from, to } = splitGameSetMove(token);
      const piece = board[from];
      if (!piece) throw new Error(\`benedict games: no piece on \${from}\`);
      const next: GameSetBoard = { ...board, [to]: piece };
      delete next[from];
      for (const square of flips[i] ?? []) {
        const turned = next[square as XiangqiSquare];
        if (turned) next[square as XiangqiSquare] = { color: piece.color, role: turned.role };
      }
      board = next;
      boards.push(board);
    });
    return boards;
  },
  marks(record, index) {
    if (index === 0) return [];
    const plies = record.moves.split(' ').length;
    const win = WINS[record.id];
    if (index === plies && win) return [win as XiangqiSquare];
    return (flipsOf(record.id)[index - 1] ?? []) as XiangqiSquare[];
  },
};
`;
  writeFileSync(SITE_MODULE, siteModule);
  writeFileSync(SET_MODULE, setModule);
  execSync(`npx biome format --write "${SITE_MODULE}" "${SET_MODULE}"`, {
    cwd: path.join(HERE, '..'),
    stdio: 'ignore',
  });

  // The shipped replay, imported back and held to the kernel at every ply.
  const { GAME_SET } = (await import(SET_MODULE)) as {
    GAME_SET: {
      records: Array<{ id: string; moves: string }>;
      replay: (r: unknown) => Plain[];
      marks: (r: unknown, i: number) => string[];
    };
  };
  for (const record of GAME_SET.records) {
    const got = GAME_SET.replay(record).map(plainKey);
    const want = kernelBoards[record.id]!;
    if (got.length !== want.length) throw new Error(`games: ${record.id} replay length`);
    got.forEach((k, i) => {
      if (k !== want[i])
        throw new Error(`games: ${record.id} replay drifts from the kernel at ply ${i}`);
    });
    const final = GAME_SET.marks(record, want.length - 1);
    if (final.length !== 1 || final[0] !== wins[record.id])
      throw new Error(`games: ${record.id} final mark ${final.join()}`);
  }
  console.log(
    '  apps/web/src/benedict-xiangqi-article-diagrams.ts (rule, threat, pie, 42 openings)',
  );
  console.log(
    `  apps/web/src/benedict-xiangqi-games.ts (${GAME_SET.records.length} games, ${plies} plies, replay matches the kernel)`,
  );
}
