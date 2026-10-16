// Board sweep: every launched variant's board, drawn by the site's own renderers
// (imported from apps/web/src, never copied), as one PNG per board plus a static
// index page, so a change to piece art, piece size or a board mark can be judged
// across the whole family in one look instead of one variant at a time.
//
//   npm run board:sweep -- <out dir> [--svg]
//
// `--svg` also writes each board's raw markup (as the renderer returned it) for
// grepping strokes and sizes.
//
// Coverage per variant comes from the ADAPTERS table below. The launched set is
// read from `scripts/variant-status.mjs --json` (the `npm run variants` source of
// truth), and a launched variant with no adapter fails the run by name, so a new
// launch cannot silently drop out of the sheet.
//
// Each board is a mid-game position from a seeded random playout (same seed,
// same boards), so a last move is on every tile. Hidden-information games get
// the seated player's view and an all-revealed sheet of the same position.
// Xiangqi-family boards cross each piece set with each layout.
//
// What the script adds to the renderers' markup, and nothing else:
// - a <style> block: the card lab's board colours (the live board takes them
//   from theme variables a standalone SVG cannot see) plus the real mark rules
//   lifted out of the site's stylesheets, with var() resolved;
// - piece art inlined as data URIs, and var() in attributes resolved, because
//   the rasteriser (resvg) cannot fetch /piece-sets/ or resolve custom properties.
// No geometry, colour or shape in the board itself is touched.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web/src');
const PUBLIC = path.join(ROOT, 'apps/web/public');

// The renderers' import graph reaches `import './x.css'`, which Vite resolves
// and Node does not. Colours come from the <style> block built below.
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css') || url.includes('.css?')) {
      return { format: 'module', shortCircuit: true, source: 'export default {};' };
    }
    const result = next(url, context);
    // Vite defines import.meta.env; under Node it is undefined. Every flag reads
    // as unset, which is the production default for the boards drawn here.
    if (url.startsWith('file:') && url.includes('/apps/web/src/') && result.source) {
      const source = String(result.source);
      if (source.includes('import.meta.env')) {
        return { ...result, source: `import.meta.env ??= {};\n${source}` };
      }
    }
    return result;
  },
});

// The renderers read appearance preferences off window at call time. The
// location is mutable: `?xqLayout=` and `?xqPieces=` are the site's own preview
// hooks, and they reach the boards that take no layout or piece-set option.
const store = new Map<string, string>();
const location = { search: '' };
(globalThis as Record<string, unknown>).window = {
  location,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
};
(globalThis as Record<string, unknown>).localStorage = (
  globalThis as unknown as { window: { localStorage: unknown } }
).window.localStorage;
(globalThis as Record<string, unknown>).document = {
  documentElement: {
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, contains: () => false },
    getAttribute: () => null,
  },
  head: { append() {} },
  createElement: () => ({ style: {}, setAttribute() {}, append() {} }),
  querySelector: () => null,
};

const out = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const writeSvg = process.argv.includes('--svg');
if (!out) {
  console.error('usage: npm run board:sweep -- <out dir> [--svg]');
  process.exit(2);
}

const G = await import('@mistboard/game');
const { xiangqiBoardSvg } = await import(path.join(WEB, 'xiangqi-board.ts'));
const { renderDarkXiangqiBoardSvg } = await import(path.join(WEB, 'live-dark-xiangqi.ts'));
const { renderJieqiBoardSvg } = await import(path.join(WEB, 'live-jieqi-render.ts'));
const { renderBanqiBoardSvg } = await import(path.join(WEB, 'live-banqi-render.ts'));
const { renderJungleBoardSvg } = await import(path.join(WEB, 'jungle-render.ts'));
const { renderJungleFlipBoardSvg } = await import(path.join(WEB, 'jungle-flip-render.ts'));
const { duckXiangqiBoardSvg } = await import(path.join(WEB, 'duck-xiangqi-board.ts'));
const { crazyhouseXiangqiBoardView, crazyhouseXiangqiLastDrop } = await import(
  path.join(WEB, 'crazyhouse-xiangqi-view.ts')
);
const { renderDarkChessBoardSvg } = await import(path.join(WEB, 'dark-chess-render.ts'));

// ── Coverage axes ───────────────────────────────────────────────────────────

const PIECE_SETS = ['international', 'animal-dobutsu', 'traditional'] as const;
const LAYOUTS = ['intersection', 'cell'] as const;
type PieceSet = (typeof PIECE_SETS)[number];
type Layout = (typeof LAYOUTS)[number];
type Tile = { name: string; label: string; svg: string };

/** Set the site's preview hooks for one render, for boards with no option. */
function withLook<T>(pieceSet: PieceSet, layout: Layout | null, render: () => T): T {
  const q = new URLSearchParams({ xqPieces: pieceSet });
  if (layout) q.set('xqLayout', layout);
  location.search = `?${q}`;
  try {
    return render();
  } finally {
    location.search = '';
  }
}

function looks(): Array<{ pieceSet: PieceSet; layout: Layout }> {
  return PIECE_SETS.flatMap((pieceSet) => LAYOUTS.map((layout) => ({ pieceSet, layout })));
}

// ── Seeded playouts ─────────────────────────────────────────────────────────

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function playout<S, M>(
  state: S,
  plies: number,
  rng: () => number,
  legal: (s: S) => readonly M[],
  apply: (s: S, m: M) => S,
  prefer?: (m: M) => boolean,
): S {
  let s = state;
  for (let i = 0; i < plies; i++) {
    const moves = legal(s);
    if (moves.length === 0) break;
    // On the last ply, take a preferred move (a capture, a drop) when there is
    // one, so the final mark lands on something worth checking.
    const pool = i === plies - 1 && prefer ? moves.filter(prefer) : [];
    const from = pool.length > 0 ? pool : moves;
    s = apply(s, from[Math.floor(rng() * from.length)]);
  }
  return s;
}

const isCapture =
  (board: Record<string, unknown>) =>
  (m: { to: string }): boolean =>
    board[m.to] !== undefined;

// ── Adapters: one per launched variant ──────────────────────────────────────

const ADAPTERS: Record<string, () => Tile[]> = {
  xiangqi() {
    const rng = seeded(11);
    let state = G.createInitialXiangqiState('sweep-xiangqi');
    state = playout(state, 23, rng, G.getStandardXiangqiLegalMoves, G.applyStandardXiangqiMove);
    const view = G.getStandardXiangqiPlayerView(state, 'red');
    return looks().map(({ pieceSet, layout }) => ({
      name: `xiangqi--${pieceSet}--${layout}`,
      label: `Xiangqi · ${pieceSet} · ${layout}`,
      svg: xiangqiBoardSvg(view, 'red', {
        interactive: false,
        selectedSquare: null,
        draggingFrom: null,
        layout,
        pieceSet,
      }),
    }));
  },

  'crazyhouse-xiangqi'() {
    const rng = seeded(13);
    let state = G.createInitialCrazyhouseXiangqiState('sweep-zh');
    state = playout(state, 30, rng, G.getCrazyhouseXiangqiLegalMoves, G.applyCrazyhouseXiangqiMove);
    // Play on until a side drops from its pocket, so the tile shows the drop mark
    // (its own code path) rather than an ordinary move.
    for (
      let i = 0;
      i < 40 && !(state.lastMove && G.isCrazyhouseXiangqiDropMove(state.lastMove));
      i++
    ) {
      const moves = G.getCrazyhouseXiangqiLegalMoves(state);
      if (moves.length === 0) break;
      const drops = moves.filter((m) => G.isCrazyhouseXiangqiDropMove(m));
      const pool = drops.length > 0 ? drops : moves;
      state = G.applyCrazyhouseXiangqiMove(state, pool[Math.floor(rng() * pool.length)]);
    }
    const view = G.getCrazyhouseXiangqiPlayerView(state, 'red');
    return looks().map(({ pieceSet, layout }) => ({
      name: `crazyhouse-xiangqi--${pieceSet}--${layout}`,
      label: `Crazyhouse xiangqi · ${pieceSet} · ${layout}`,
      svg: xiangqiBoardSvg(crazyhouseXiangqiBoardView(view), 'red', {
        interactive: false,
        selectedSquare: null,
        draggingFrom: null,
        layout,
        pieceSet,
        lastDropSquare: crazyhouseXiangqiLastDrop(view),
      }),
    }));
  },

  'duck-xiangqi'() {
    const rng = seeded(17);
    let state = G.createInitialDuckXiangqiState('sweep-duck');
    state = playout(state, 18, rng, G.getDuckXiangqiLegalTurns, G.applyDuckXiangqiTurn);
    const view = G.getDuckXiangqiPlayerView(state, 'red');
    return looks().map(({ pieceSet, layout }) => ({
      name: `duck-xiangqi--${pieceSet}--${layout}`,
      label: `Duck xiangqi · ${pieceSet} · ${layout}`,
      svg: duckXiangqiBoardSvg(view, 'red', {
        interactive: false,
        phase: { kind: 'piece', selected: null },
        targets: [],
        layout,
        pieceSet,
      }),
    }));
  },

  'dark-xiangqi'() {
    const rng = seeded(19);
    let state = G.createInitialXiangqiState('sweep-fog');
    state = playout(state, 20, rng, G.getLegalMoves, G.applyMove, isCapture(state.board));
    // The seat's view, redacted to the wire shape the room sends (a shrouded
    // entry keeps only its colour), as dark-xiangqi-tenant.ts does.
    const own = G.getPlayerView(state, 'red');
    const board: Record<string, unknown> = {};
    for (const [sq, e] of Object.entries(own.board)) {
      if (!e) continue;
      board[sq] = e.shrouded
        ? { color: e.piece.color, shrouded: true }
        : { piece: e.piece, shrouded: false };
    }
    const captures = { red: [], black: [] };
    const seat = { ...own, board, captures };
    const truth = {
      id: state.id,
      perspective: 'red',
      board: Object.fromEntries(
        Object.entries(state.board).map(([sq, piece]) => [sq, { piece, shrouded: false }]),
      ),
      visibleSquares: Object.keys(state.board),
      legalMoves: [],
      status: state.status,
      moveNumber: state.moveNumber,
      lastMove: state.lastMove,
      captures,
    };
    return looks().flatMap(({ pieceSet, layout }) => [
      {
        name: `dark-xiangqi--${pieceSet}--${layout}--player`,
        label: `Fog xiangqi · ${pieceSet} · ${layout} · red's view`,
        svg: withLook(pieceSet, layout, () => renderDarkXiangqiBoardSvg(seat, 'red')),
      },
      {
        name: `dark-xiangqi--${pieceSet}--${layout}--revealed`,
        label: `Fog xiangqi · ${pieceSet} · ${layout} · revealed`,
        svg: withLook(pieceSet, layout, () =>
          renderDarkXiangqiBoardSvg(truth, 'red', { showFog: false }),
        ),
      },
    ]);
  },

  jieqi() {
    const rng = seeded(7);
    let state = G.createInitialJieqiState('sweep-jieqi', G.createJieqiDeal(rng));
    state = playout(state, 16, rng, G.getJieqiLegalMoves, G.applyJieqiMove);
    const views = { player: G.getJieqiPlayerView(state, 'red'), revealed: G.jieqiTruthView(state) };
    return looks().flatMap(({ pieceSet, layout }) =>
      (['player', 'revealed'] as const).map((kind) => ({
        name: `jieqi--${pieceSet}--${layout}--${kind}`,
        label: `Jieqi · ${pieceSet} · ${layout} · ${kind === 'player' ? "red's view" : 'revealed'}`,
        svg: renderJieqiBoardSvg(views[kind], 'red', { pieceSet, layout, interactive: false }),
      })),
    );
  },

  banqi() {
    const rng = seeded(23);
    let state = G.createInitialBanqiState('sweep-banqi', G.createBanqiDeal(rng));
    state = playout(state, 26, rng, G.getBanqiLegalMoves, G.applyBanqiMove);
    const views = {
      player: G.getBanqiPlayerView(state, G.banqiSeatToMove(state)),
      revealed: G.banqiTruthView(state),
    };
    // Banqi has one layout: discs in the cells.
    return PIECE_SETS.flatMap((pieceSet) =>
      (['player', 'revealed'] as const).map((kind) => ({
        name: `banqi--${pieceSet}--${kind}`,
        label: `Banqi · ${pieceSet} · ${kind === 'player' ? 'seat view' : 'revealed'}`,
        svg: renderBanqiBoardSvg(views[kind], 'red', { pieceSet, interactive: false }),
      })),
    );
  },

  jungle() {
    const rng = seeded(29);
    let state = G.createInitialJungleState('sweep-jungle');
    state = playout(state, 20, rng, G.getJungleLegalMoves, G.applyJungleMove);
    // Jungle has its own skins, not the xiangqi piece sets.
    return (['animals', 'characters'] as const).map((pieceSkin) => ({
      name: `jungle--${pieceSkin}`,
      label: `Jungle · ${pieceSkin}`,
      svg: renderJungleBoardSvg(state.board, {
        perspective: 'red',
        interactive: false,
        pieceSkin,
        lastMove: state.lastMove ?? null,
      }),
    }));
  },

  'jungle-flip'() {
    const rng = seeded(31);
    let state = G.createInitialJungleFlipState('sweep-flip', G.createJungleFlipDeal(rng));
    state = playout(state, 24, rng, G.getJungleFlipLegalMoves, G.applyJungleFlipMove);
    const player = G.getJungleFlipPlayerView(state, 'red').board;
    const revealed = Object.fromEntries(
      Object.entries(state.board).map(([sq, p]) => {
        const piece = p as { color: string; role: string };
        return [sq, { faceDown: false, color: piece.color, role: piece.role }];
      }),
    );
    const boards = { player, revealed };
    return (['animals', 'characters'] as const).flatMap((pieceSkin) =>
      (['player', 'revealed'] as const).map((kind) => ({
        name: `jungle-flip--${pieceSkin}--${kind}`,
        label: `Flip jungle · ${pieceSkin} · ${kind === 'player' ? "red's view" : 'revealed'}`,
        svg: renderJungleFlipBoardSvg(boards[kind], {
          interactive: false,
          pieceSkin,
          lastMove: state.lastMove ?? null,
          lastMoveInk: G.jungleFlipLastMoverInk(state),
        }),
      })),
    );
  },

  'dark-chess'() {
    const rng = seeded(37);
    const v = G.darkChessVariant;
    let state = v.createInitialState('sweep-dark-chess');
    // An odd ply count: White moved last, so White's own view shows the mark.
    state = playout(
      state,
      21,
      rng,
      (s) => v.getLegalMoves(s, s.status.type === 'playing' ? s.status.turn : 'white'),
      v.applyMove,
    );
    const player = v.getPlayerView(state, 'white');
    return [
      {
        name: 'dark-chess--player',
        label: "Dark chess · white's view",
        svg: renderDarkChessBoardSvg(player, { perspective: 'white' }),
      },
      {
        name: 'dark-chess--revealed',
        label: 'Dark chess · revealed',
        svg: renderDarkChessBoardSvg(
          { board: state.board, visibleSquares: [], lastMove: state.lastMove },
          { perspective: 'white', showFog: false },
        ),
      },
    ];
  },
};

// ── Launched variants, and the gate ─────────────────────────────────────────

const status = JSON.parse(
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/variant-status.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  }),
) as { rows: Array<{ id: string; status: string }> };
const launched = status.rows
  .filter((row) => row.status === 'flag-gated' || row.status === 'chess-stack')
  .map((row) => row.id);
const missing = launched.filter((id) => !(id in ADAPTERS));
if (missing.length > 0) {
  console.error(`board-sweep: no renderer adapter for launched variant(s): ${missing.join(', ')}`);
  process.exit(1);
}

// ── Styles: lab board colours plus the site's real mark rules ───────────────

// Custom properties at their default (:root) values, from the real stylesheets.
const VARS = new Map<string, string>();
for (const file of ['app-base.css']) {
  const css = stripComments(readFileSync(path.join(WEB, file), 'utf8'));
  const root = css.match(/:root\s*\{([^}]*)\}/);
  for (const m of root?.[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g) ?? []) {
    if (!VARS.has(m[1])) VARS.set(m[1], m[2].trim());
  }
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function resolveVars(text: string): string {
  let prev = '';
  let next = text;
  for (let i = 0; i < 6 && prev !== next; i++) {
    prev = next;
    next = next.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g,
      (_m, name: string, fallback?: string) => VARS.get(name) ?? fallback?.trim() ?? 'none',
    );
  }
  return next;
}

/** Top-level rules from a real stylesheet whose selector names one of `classes`. */
function realRules(file: string, classes: readonly string[]): string {
  const css = stripComments(readFileSync(path.join(WEB, file), 'utf8'));
  const rules: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    const plain =
      !selector.startsWith('@') && !selector.includes(':root[') && !/:(hover|focus)/.test(selector);
    if (plain && classes.some((c) => selector.includes(c))) rules.push(`${selector}{${body}}`);
    i = j;
  }
  return resolveVars(rules.join('\n'));
}

const BOARD_CSS = [
  // Xiangqi-family surfaces: the card lab's colours (lab.mts BOARD_CSS).
  `.jieqi-board-bg,.xq-live-bg{fill:#f5dca8}
   .xq-live-line,.xq-live-palace line{stroke:#5a3a14;stroke-width:1.2}
   .xq-live-palace-band{fill:#7c4d72;fill-opacity:.16}
   .xq-live-start-mark{fill:none;stroke:#5a3a14;stroke-width:1.2;stroke-linecap:square}
   .xq-live-river-label,.xq-live-river-brand,.jieqi-piece-unknown-mark{display:none}
   .xq-live-coord{fill:#5a3a14;fill-opacity:.8;font-weight:700}
   .xq-live-cell--light{fill:#f5dca8}
   .xq-live-cell--dark{fill:#dcc290}
   .xq-live-cell-line{stroke:#5a3a14;stroke-opacity:.42;stroke-width:1}
   .xq-live-cell-river{fill:#73a9bf}
   .xq-surface--cell .xq-live-palace-band{fill:#7c4d72;fill-opacity:.24}
   .banqi-board-bg{fill:#f0d6a4}
   .banqi-grid line{stroke:#5b4a32;stroke-width:1.5;stroke-linecap:round}
   .banqi-back > circle,.banqi-back > rect{fill:#2f8f6b;stroke:#184a38;stroke-width:2}
   .banqi-coord{fill:#5b4a32;fill-opacity:.72;font-weight:700}`,
  // The marks, from the site's own stylesheets.
  realRules('board-lastmove.css', ['xq-live-lastmove']),
  realRules('live-xiangqi.css', ['xq-live-lastmove', 'xq-live-fog-mask']),
  realRules('live-banqi-board.css', ['banqi-lastmove']),
  realRules('dark-chess-render.css', ['dark-chess-fog-square', 'dark-chess-drag-source']),
].join('\n');

// ── Rasterise ───────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};
const dataUris = new Map<string, string>();
function inlineArt(svg: string): string {
  return svg.replace(/href="(\/[^"?#]+)(?:\?[^"]*)?"/g, (whole, rel: string) => {
    const file = path.join(PUBLIC, rel);
    if (!existsSync(file)) return whole;
    let uri = dataUris.get(file);
    if (!uri) {
      const mime = MIME[path.extname(file)] ?? 'application/octet-stream';
      uri = `data:${mime};base64,${readFileSync(file).toString('base64')}`;
      dataUris.set(file, uri);
    }
    return `href="${uri}"`;
  });
}

function standalone(svg: string): string {
  const styled = svg.replace(/(<svg[^>]*>)/, `$1<style>${BOARD_CSS}</style>`);
  // resvg rejects a bare boolean attribute (valid HTML, invalid XML).
  return resolveVars(inlineArt(styled)).replace(/ (data-[\w-]+)(?=[ >])/g, ' $1=""');
}

mkdirSync(out, { recursive: true });
const tiles: Array<Tile & { variant: string }> = [];
for (const variant of launched) {
  for (const tile of ADAPTERS[variant]()) tiles.push({ ...tile, variant });
}
for (const tile of tiles) {
  const png = new Resvg(standalone(tile.svg), { fitTo: { mode: 'width', value: 900 } })
    .render()
    .asPng();
  writeFileSync(path.join(out, `${tile.name}.png`), png);
  if (writeSvg) writeFileSync(path.join(out, `${tile.name}.svg`), tile.svg);
}

// The page draws each board as inline SVG with the art fetched from /piece-sets/, so the browser
// scales the piece art exactly as the site does; the PNGs (resvg's own downsampling) are for
// agents and cards, not for judging edges.
// Many inline SVGs share one document, so an id two boards both define (the fog
// mask, the jungle clip) resolves to whichever comes first and the second board
// draws with the first one's geometry. Each tile's ids get its own prefix here.
const scopeIds = (svg: string, scope: string) => {
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  let scoped = svg;
  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    scoped = scoped
      .replace(new RegExp(`(\\sid=")${safe}"`, 'g'), `$1${scope}-${id}"`)
      .replace(new RegExp(`url\\(#${safe}\\)`, 'g'), `url(#${scope}-${id})`)
      .replace(new RegExp(`href="#${safe}"`, 'g'), `href="#${scope}-${id}"`);
  }
  return scoped;
};
const pageSvg = (svg: string, scope: string) =>
  scopeIds(
    resolveVars(svg.replace(/(<svg[^>]*>)/, `$1<style>${BOARD_CSS}</style>`)),
    scope,
  ).replace(/^\s*<svg/, '<svg width="100%"');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sections = launched
  .map((variant) => {
    const figs = tiles
      .filter((t) => t.variant === variant)
      .map(
        (t) =>
          `<figure>${pageSvg(t.svg, t.name)}<figcaption><a href="${t.name}.png">png</a> · ${esc(t.label)}<br><code>${t.name}</code></figcaption></figure>`,
      )
      .join('');
    return `<h2>${esc(variant)}</h2><div class="grid">${figs}</div>`;
  })
  .join('\n');
writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Board sweep</title>
<style>body{background:#151515;color:#ddd;font:14px system-ui;margin:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:16px}
figure{margin:0}figure>svg{display:block;height:auto}a{color:#9cf}code{color:#999;font-size:12px}
h2{margin:28px 0 10px;color:#f5dca8}</style>
<h1>Board sweep</h1><p>${tiles.length} boards, ${launched.length} launched variants, generated ${new Date().toISOString()}.</p>
${sections}`,
);
console.log(`board-sweep: ${tiles.length} boards for ${launched.length} variants -> ${out}`);
