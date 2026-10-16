// Render a self-play game (misty-selfplay.ts output) to PNG frames for the public
// Misty engine repos' README hero animations.
//
//   npx tsx scripts/misty-hero-frames.ts \
//     --game tmp/hero/jungle.json --index 0 --out tmp/hero/frames/jungle --width 760
//
// The frames come from the PRODUCT's own board renderers at the site's DEFAULT
// appearance, so the README animation and the live board are the same picture:
//   jungle / jungle-flip  renderJungle{,Flip}BoardSvg with the default skins
//                         (bare board + animal pieces — jungle-skins.ts)
//   banqi                 renderBanqiBoardSvg with the default xiangqi piece set
//                         (international — xiangqi-piece-sets.ts)
// Nothing is pinned here. Change the default in the app and the next render follows.
//
// Two things a browser does for free and resvg does not, both handled below:
//   - the page stylesheet (banqi draws entirely through class names), inlined from
//     the renderer's own exported BANQI_BOARD_CSS;
//   - `var(--token, fallback)`, which resvg cannot resolve — collapsed to the fallback.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyBanqiMove,
  applyJungleFlipMove,
  applyJungleMove,
  type BanqiDeal,
  type BanqiSquare,
  createInitialBanqiState,
  createInitialJungleFlipState,
  createInitialJungleState,
  getBanqiPlayerView,
  getJungleFlipPlayerView,
  type JungleFlipDeal,
  type JungleFlipSquare,
  type JungleSquare,
  LEGACY_BANQI_RULES,
} from '@mistboard/game';
import {
  type JungleFlipRenderBoard,
  renderJungleFlipBoardSvg,
} from '../apps/web/src/jungle-flip-render.js';
import { renderJungleBoardSvg } from '../apps/web/src/jungle-render.js';
import { BANQI_BOARD_CSS, renderBanqiBoardSvg } from '../apps/web/src/live-banqi-render.js';
import { rasterizeSvg } from '../apps/web/src/video/raster.js';

type SelfPlayGame = {
  variant: 'jungle' | 'jungle-flip' | 'banqi';
  engine: string;
  nodes: number;
  seed: number;
  moves: string;
  plies: number;
  status: unknown;
  deal?: Array<{ color: string; role: string }>;
};

/** Split a game's move string into from/to pairs (both boards use 2-char squares). */
function moveTokens(moves: string): Array<{ from: string; to: string }> {
  return moves
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ({ from: token.slice(0, 2), to: token.slice(2, 4) }));
}

/**
 * resvg supports neither CSS custom properties nor a page stylesheet. Collapse
 * `var(--name, fallback)` to its fallback (every var in the board CSS carries one)
 * and hand the result to the SVG as an inline <style>.
 */
function staticCss(css: string): string {
  return css.replace(/var\(\s*--[\w-]+\s*,\s*([^)]+)\)/g, '$1');
}

function withInlineStyle(svg: string, css: string): string {
  return svg.replace(/(<svg\b[^>]*>)/, `$1<style>${staticCss(css)}</style>`);
}

// ── Per-variant frame sequences ─────────────────────────────────────────────

function jungleFrames(game: SelfPlayGame): string[] {
  let state = createInitialJungleState('hero');
  const frames = [renderJungleBoardSvg(state.board, { lastMove: null })];
  for (const token of moveTokens(game.moves)) {
    const move = { from: token.from as JungleSquare, to: token.to as JungleSquare };
    const next = applyJungleMove(state, move);
    if (next === state) throw new Error(`jungle: move ${token.from}${token.to} did not replay`);
    state = next;
    frames.push(renderJungleBoardSvg(state.board, { lastMove: move }));
  }
  return frames;
}

function jungleFlipFrames(game: SelfPlayGame): string[] {
  if (!game.deal) throw new Error('jungle-flip game is missing its deal');
  let state = createInitialJungleFlipState(`hero-${game.seed}`, game.deal as JungleFlipDeal);
  const render = (lastMove: { from: JungleFlipSquare; to: JungleFlipSquare } | null): string =>
    renderJungleFlipBoardSvg(getJungleFlipPlayerView(state, 'red').board as JungleFlipRenderBoard, {
      lastMove,
    });
  const frames = [render(null)];
  for (const token of moveTokens(game.moves)) {
    const move = { from: token.from as JungleFlipSquare, to: token.to as JungleFlipSquare };
    const next = applyJungleFlipMove(state, move);
    if (next === state) {
      throw new Error(`jungle-flip: move ${token.from}${token.to} did not replay`);
    }
    state = next;
    frames.push(render(move));
  }
  return frames;
}

function banqiFrames(game: SelfPlayGame): string[] {
  if (!game.deal) throw new Error('banqi game is missing its deal');
  // MistyBanqi plays without the 長捉 rule, so its self-play records do too.
  let state = createInitialBanqiState(
    `hero-${game.seed}`,
    game.deal as BanqiDeal,
    LEGACY_BANQI_RULES,
  );
  // Banqi is symmetric information, so either seat's view is the same picture; the
  // view carries the last-move marks the renderer draws.
  const render = (): string => renderBanqiBoardSvg(getBanqiPlayerView(state, 'red'), 'red');
  const frames = [render()];
  for (const token of moveTokens(game.moves)) {
    const move = { from: token.from as BanqiSquare, to: token.to as BanqiSquare };
    const next = applyBanqiMove(state, move);
    if (next === state) throw new Error(`banqi: move ${token.from}${token.to} did not replay`);
    state = next;
    frames.push(render());
  }
  return frames.map((svg) => withInlineStyle(svg, BANQI_BOARD_CSS));
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** The SVG's intrinsic width, so `--width` can be honoured as a zoom factor. */
function viewBoxWidth(svg: string): number {
  const match = /viewBox="([\d.\s-]+)"/.exec(svg);
  if (!match) throw new Error('board SVG has no viewBox');
  return Number(match[1].trim().split(/\s+/)[2]);
}

function main(): void {
  const gamePath = arg('--game');
  const outDir = arg('--out');
  if (!gamePath || !outDir) {
    console.error('usage: --game <selfplay.json> --out <dir> [--index N] [--width PX]');
    process.exit(1);
  }
  const index = Number(arg('--index') ?? 0);
  const targetWidth = Number(arg('--width') ?? 760);

  const parsed = JSON.parse(readFileSync(path.resolve(gamePath), 'utf8')) as {
    games: SelfPlayGame[];
  };
  const game = parsed.games[index];
  if (!game) throw new Error(`no game at index ${index} in ${gamePath}`);

  const svgs =
    game.variant === 'jungle'
      ? jungleFrames(game)
      : game.variant === 'jungle-flip'
        ? jungleFlipFrames(game)
        : banqiFrames(game);

  const dir = path.resolve(outDir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const scale = targetWidth / viewBoxWidth(svgs[0]);
  svgs.forEach((svg, i) => {
    writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.png`), rasterizeSvg(svg, scale));
  });
  process.stderr.write(`${game.variant}: ${svgs.length} frames at ${targetWidth}px -> ${outDir}\n`);
}

main();
