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
//   npx tsx scripts/gen-benedict-diagrams.mts
//
// Every position here is DEFINED IN THIS FILE and CHECKED AGAINST THE KERNEL
// before it renders: each step names the move it plays, and the script asserts
// the move is legal and converts exactly the pieces the narrative claims. An
// earlier version read hand-composed positions out of a scratchpad JSON, which
// let two illegal frames ship (a soldier deleted rather than moved, and a
// soldier teleported across the board to make a conversion work) and then lost
// the source file when the scratchpad was cleaned up.

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
  isBenedictXiangqiLegalMove,
  benedictXiangqiResolveMove,
  applyBenedictXiangqiMove,
  benedictXiangqiPositionRepetitionKey,
} = await import('../packages/game/src/variants-benedict-xiangqi.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
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

mkdirSync(OUT, { recursive: true });
mkdirSync(INCLUDES, { recursive: true });

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
  writeFileSync(
    path.join(INCLUDES, 'benedict-xq-pie.html'),
    [
      '<!-- Generated by scripts/gen-benedict-diagrams.mts. Do not hand-edit. -->',
      '<div class="xq-quad">',
      cells.join('\n'),
      '</div>',
    ].join('\n') + '\n',
  );
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

writeFileSync(path.join(INCLUDES, 'benedict-xq-browser.html'), browser + '\n');
console.log(
  `  _includes/benedict-xq-browser.html (${games.games.length} games, ${Object.keys(sprites).length} sprites)`,
);
console.log('\ndone');

// ── The playable board ─────────────────────────────────────────────────────
//
// The rule is hard to feel from prose and static frames: you have to move a
// piece and watch two enemy pieces change colour. This emits the board shell
// and reuses the sprite sheet built above, then bundles the SAME kernel the
// diagrams are checked against, so the page cannot enforce different rules than
// the article describes. No second implementation, no engine, no opponent.

{
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
