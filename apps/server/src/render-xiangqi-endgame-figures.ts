/**
 * Renders the board figures for the basic-endgame write-up.
 *
 * International piece art, because the point of that piece set is a reader who
 * cannot read 俥/傌/仕 — the same reader the endgame write-up is for.
 *
 * Captions live in the prose, not in the image: a baked-in caption is unreadable
 * once the PNG is downscaled to a content column, cannot be selected or read by
 * a screen reader, and needs a re-render to fix a typo.
 *
 * The board grid still comes from board-render so the geometry matches the site,
 * but pieces are overlaid here because the international set is PNG art living in
 * apps/web, while board-render only carries the Hanzi glyph paths.
 *
 * Geometry is copied from renderXiangqiOgBoardSvg rather than re-derived:
 *   cell = height / (ranks - 1 + 2 * 0.58);  margin = 0.58 * cell
 *   width = 2 * margin + (files - 1) * cell   ->  width = 0.9016 * height
 * The nested board <svg> is offset by (centerX - width/2, y), so piece centres
 * computed in board space need that offset added to land in canvas space.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderXiangqiOgBoardSvg, type XiangqiOgPiece } from '@mistboard/board-render';
import {
  endgameEntryState,
  XIANGQI_ENDGAME_CORPUS,
  type XiangqiBoard,
  type XiangqiGameState,
} from '@mistboard/game';
import { svgToPng } from './og-image.js';

const FONT = 'Helvetica, Arial, sans-serif';
const ART = 'apps/web/public/piece-sets/xiangqi/international';
const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const ROLE: Record<string, string> = {
  k: 'general',
  a: 'advisor',
  b: 'elephant',
  n: 'horse',
  r: 'chariot',
  c: 'cannon',
  p: 'soldier',
};

const FILES = 9;
const RANKS = 10;
/** width / height for a 9x10 board, from the renderer's own ratios. */
const ASPECT = (2 * 0.58 + (FILES - 1)) / (RANKS - 1 + 2 * 0.58);

const ART_CANVAS = 1024;

/**
 * Where the drawing actually is inside each 1024px art file: [x, y, w, h] of the
 * non-transparent pixels, measured from the files themselves. Red and black share
 * artwork, so this keys on role.
 *
 * It matters because the art is mostly empty. A chariot's ink is 390x487 in a
 * 1024x1024 canvas, so mapping the whole canvas into the piece box (what the
 * per-role frame table used to do) spends 60% of the box on transparent padding
 * and leaves the glyph at under half the disc's width. In the article that came
 * out at ~13 CSS pixels of actual drawing, which reads as blur at any resolution:
 * the problem was never pixel count, it was that the piece was tiny.
 */
const INK: Record<string, [number, number, number, number]> = {
  general: [263, 220, 498, 560],
  advisor: [318, 234, 386, 554],
  elephant: [180, 250, 670, 624],
  horse: [289, 239, 463, 522],
  chariot: [315, 256, 390, 487],
  cannon: [246, 363, 553, 342],
  soldier: [349, 186, 326, 604],
};

/** The ink's long side as a fraction of the disc diameter. */
const GLYPH_FILL = 0.72;

const artCache = new Map<string, string>();
function pieceDataUri(color: string, role: string): string {
  const key = `${color}-${role}`;
  const hit = artCache.get(key);
  if (hit) return hit;
  const buf = readFileSync(resolve(REPO_ROOT, ART, `${key}.png`));
  const uri = `data:image/png;base64,${buf.toString('base64')}`;
  artCache.set(key, uri);
  return uri;
}

function stateFromTokens(tokens: string[]): XiangqiGameState {
  const board: Record<string, { color: string; role: string }> = {};
  for (const t of tokens) {
    const letter = t.slice(0, 1);
    board[t.slice(1)] = {
      color: letter === letter.toUpperCase() ? 'red' : 'black',
      role: ROLE[letter.toLowerCase()] as string,
    };
  }
  return {
    id: 'fig',
    board: board as unknown as XiangqiBoard,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  } as XiangqiGameState;
}

function piecesOf(state: XiangqiGameState): XiangqiOgPiece[] {
  return Object.entries(state.board).flatMap(([square, piece]) =>
    piece
      ? [
          {
            file: square.charCodeAt(0) - 97,
            rank: Number(square.slice(1)),
            color: piece.color,
            role: piece.role as XiangqiOgPiece['role'],
          },
        ]
      : [],
  );
}

function fromCorpus(id: string): XiangqiOgPiece[] {
  const entry = XIANGQI_ENDGAME_CORPUS.find((e) => e.id === id);
  if (!entry) throw new Error(`no entry ${id}`);
  return piecesOf(endgameEntryState(entry));
}

/** Bare grid plus international piece art, positioned in canvas coordinates. */
function board(pieces: XiangqiOgPiece[], centerX: number, y: number, height: number): string {
  const grid = renderXiangqiOgBoardSvg({
    files: FILES,
    ranks: RANKS,
    pieces: [],
    lineWidth: GRID_LINE,
    riverBetweenRanks: [5, 6],
    palaces: [
      { fileLo: 3, fileHi: 5, rankLo: 1, rankHi: 3 },
      { fileLo: 3, fileHi: 5, rankLo: 8, rankHi: 10 },
    ],
    centerX,
    y,
    height,
  });

  const cell = height / (RANKS - 1 + 2 * 0.58);
  const margin = 0.58 * cell;
  const width = 2 * margin + (FILES - 1) * cell;
  const ox = centerX - width / 2;
  // Mirrors apps/web/src/xiangqi-piece-sets.ts: a cream disc with a coloured rim,
  // then the art on top, framed per role inside a 100x100 box. Without the disc
  // the outline art washes out against the board and grid lines show through it.
  const size = 0.92 * cell;
  const art = pieces.map((p) => {
    const cx = ox + margin + p.file * cell;
    const cy = y + margin + (RANKS - p.rank) * cell;
    const u = size / 100; // 100x100 piece box -> board units
    const rim = p.color === 'red' ? '#c30d0d' : '#202427';
    const discDiameter = 92 * u;
    // Scale the art so its INK fills the disc, then offset so the ink's centre
    // (not the canvas centre) lands on the point. Fitting the long side keeps a
    // wide piece like the cannon and a tall one like the soldier inside the same
    // circle, and gives every role the same visual weight.
    const [ix, iy, iw, ih] = INK[p.role] ?? INK.soldier;
    const perPx = (GLYPH_FILL * discDiameter) / Math.max(iw, ih);
    const drawn = ART_CANVAS * perPx;
    return [
      `<circle cx="${cx}" cy="${cy}" r="${46 * u}" fill="#fef0d7" stroke="${rim}" stroke-width="${4.2 * u}"/>`,
      `<image image-rendering="optimizeQuality" href="${pieceDataUri(p.color, p.role)}" x="${cx - (ix + iw / 2) * perPx}" y="${cy - (iy + ih / 2) * perPx}" width="${drawn}" height="${drawn}"/>`,
    ].join('');
  });
  return grid + art.join('');
}

type Panel = { pieces: XiangqiOgPiece[]; title: string; verdict: string; win: boolean };

const TITLE_Y = 52;
const BOARD_Y = 78;

// Two different sharpness problems live here, and they have opposite fixes.
//
// VECTOR detail (the grid) is defined in board units. A pair figure is ~1386
// units wide and displays at ~680 CSS px, so one unit is half a CSS pixel at
// reading size NO MATTER how many device pixels the PNG has. Adding resolution
// cannot save a hairline; only a thicker line can. 2.4 units puts the grid just
// over a CSS pixel, which is what fixed the grey-mush grid.
//
// RASTER detail (the piece art) is the opposite: it needs the pixels. A piece is
// drawn ~72 units wide, so it displays at ~35 CSS px, which is ~70 device pixels
// on a 2x screen. At zoom 1 the file holds exactly 72 — no headroom, and every
// resampling step downstream shows. At zoom 2 it holds 144 and the browser has
// something to downscale from.
//
// So: thick lines AND a generous raster. Lowering the zoom to fix the grid was a
// misdiagnosis that starved the glyphs.
const GRID_LINE = 2.4;
const FIGURE_ZOOM = Number(process.env.MISTBOARD_FIGURE_ZOOM ?? 2);

async function pair(panels: [Panel, Panel], out: string): Promise<void> {
  const BOARD_H = 700;
  const boardW = BOARD_H * ASPECT;
  const gap = 56;
  const pad = 34;
  const W = Math.round(2 * boardW + gap + 2 * pad);
  const verdictY = BOARD_Y + BOARD_H + 52;
  const H = Math.round(verdictY + 28);

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#0f1115"/>`,
  ];
  panels.forEach((panel, i) => {
    const cx = i === 0 ? pad + boardW / 2 : W - pad - boardW / 2;
    parts.push(board(panel.pieces, cx, BOARD_Y, BOARD_H));
    parts.push(
      `<text x="${cx}" y="${TITLE_Y}" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="700" fill="#f3f4f6">${panel.title}</text>`,
      `<text x="${cx}" y="${verdictY}" text-anchor="middle" font-family="${FONT}" font-size="31" font-weight="700" fill="${panel.win ? '#e0b341' : '#9ca3af'}">${panel.verdict}</text>`,
    );
  });
  parts.push(`</svg>`);
  writeFileSync(out, await svgToPng(parts.join(''), '#0f1115', FIGURE_ZOOM));
  console.log(`wrote ${out} (${W}x${H}, board ${Math.round(boardW)}x${BOARD_H})`);
}

// A single board gets the same 2x treatment as a pair, but a pair fills the
// column and a lone board should not: the post displays these at 380px via an
// explicit width, so the file is authored at ~760 and halves on the page.
async function single(panel: Panel, out: string): Promise<void> {
  const BOARD_H = 750;
  const boardW = BOARD_H * ASPECT;
  const pad = 40;
  const W = Math.round(boardW + 2 * pad);
  const verdictY = BOARD_Y + BOARD_H + 52;
  const H = Math.round(verdictY + 26);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#0f1115"/>`,
    board(panel.pieces, W / 2, BOARD_Y, BOARD_H),
    `<text x="${W / 2}" y="${TITLE_Y}" text-anchor="middle" font-family="${FONT}" font-size="33" font-weight="700" fill="#f3f4f6">${panel.title}</text>`,
    `<text x="${W / 2}" y="${verdictY}" text-anchor="middle" font-family="${FONT}" font-size="31" font-weight="700" fill="#9ca3af">${panel.verdict}</text>`,
    `</svg>`,
  ];
  writeFileSync(out, await svgToPng(parts.join(''), '#0f1115', FIGURE_ZOOM));
  console.log(`wrote ${out} (${W}x${H}, board ${Math.round(boardW)}x${BOARD_H})`);
}

const dir = process.argv[2] ?? '.';
const DEFENCE = ['ke10', 'ae9', 'af10', 'be8', 'bc10'];

// The opening figure only. This script deliberately does NOT emit thumbnail.png
// or social-card.png any more: a feed thumbnail is a tall crop shown in a fixed
// box, a share card is landscape at a fixed size, and an in-body figure is
// downscaled into the content column. They want different crops at different
// sizes, and pointing all three at one file meant whichever pipeline ran last
// decided how the other two looked. Those two are produced by the site's own
// image pass, in the blog repo.
await pair(
  [
    {
      pieces: fromCorpus('chariot-vs-full-defence'),
      title: 'Chariot',
      verdict: 'Draw',
      win: false,
    },
    {
      pieces: fromCorpus('three-soldiers-vs-full-defence'),
      title: 'Three soldiers',
      verdict: 'Mate in 15',
      win: true,
    },
  ],
  `${dir}/chariot-vs-soldiers.png`,
);

await pair(
  [
    {
      pieces: fromCorpus('chariot-vs-horse-two-elephants-fortress'),
      title: 'Elephant on g6',
      verdict: 'Draw',
      win: false,
    },
    {
      pieces: fromCorpus('chariot-vs-horse-two-elephants-broken'),
      title: 'Elephant on g10',
      verdict: 'Red wins',
      win: true,
    },
  ],
  `${dir}/fortress-pair.png`,
);

await pair(
  [
    {
      pieces: fromCorpus('three-soldiers-vs-full-defence'),
      title: 'Soldiers on the 7th',
      verdict: 'Mate in 15',
      win: true,
    },
    {
      pieces: piecesOf(stateFromTokens(['Ke1', 'Pc6', 'Pe6', 'Pg6', ...DEFENCE])),
      title: 'Soldiers on the 6th',
      // Not a tempo verdict: c6 and g6 are two of the seven points a black
      // elephant can ever stand on, so a soldier there is simply hanging.
      verdict: 'Black takes one',
      win: false,
    },
  ],
  `${dir}/soldier-rank-pair.png`,
);

await pair(
  [
    {
      pieces: piecesOf(stateFromTokens(['Ke1', 'Ra5', 'kf9', 'cf10', 'nd7'])),
      title: 'Cannon behind the general',
      verdict: 'Draw',
      win: false,
    },
    {
      pieces: piecesOf(stateFromTokens(['Ke1', 'Ra5', 'kf9', 'ce10', 'nd7'])),
      title: 'Cannon one point across',
      verdict: 'Mate in 12',
      win: true,
    },
  ],
  `${dir}/cannon-behind-general.png`,
);

await pair(
  [
    {
      pieces: piecesOf(stateFromTokens(['Kd1', 'Ra5', 'Cc5', 'kf10', 're5'])),
      title: 'Defender on the 5th',
      verdict: 'Draw (0.00)',
      win: false,
    },
    {
      pieces: piecesOf(stateFromTokens(['Kd1', 'Ra5', 'Cc5', 'kf10', 're6'])),
      title: 'Defender on the 6th',
      verdict: 'Red wins (+6.65)',
      win: true,
    },
  ],
  `${dir}/middle-file-pair.png`,
);

await single(
  {
    pieces: fromCorpus('soldiers-five-on-last-rank'),
    title: 'Five soldiers against a bare general',
    verdict: 'Draw',
    win: false,
  },
  `${dir}/five-soldiers.png`,
);
