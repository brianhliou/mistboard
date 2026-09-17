import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderXiangqiOgBoardSvg,
  XIANGQI_GLYPH_PATHS,
  type XiangqiOgPiece,
} from '@mistboard/board-render';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  formatXiangqiMoves,
  importXiangqiGame,
} from '@mistboard/game';
import { svgToPng } from '../og-image.js';

// CLI: tsx generate-xiangqi-hero.ts
//
// Renders the README hero: a real xiangqi position beside the same game's move
// list in WXF, plus an English key for the piece characters. The point of the
// image is the English-first claim, so every latin string on the canvas has to
// be readable without knowing the Chinese conventions.
//
// Two rules this file exists to respect:
//   1. The moves are not hand-authored. The line below is replayed through
//      packages/game; an illegal or ambiguous token fails the render rather
//      than shipping a board that the rules engine would not produce.
//   2. resvg loads Noto Sans and nothing else (see FONT_FILES in og-image.ts),
//      so no CJK character may go through <text>. The piece characters here are
//      baked paths from XIANGQI_GLYPH_PATHS; the Chinese relative notation is
//      deliberately absent because it would render as empty space.

const here = dirname(fileURLToPath(import.meta.url));
// Repo-root assets/, not apps/web/public/: only the GitHub README reads this
// file, and anything under public/ ships in the deployed web bundle.
const outPath = resolve(here, '..', '..', '..', '..', 'assets', 'readme-hero-xiangqi.png');

// Central Cannon vs Screen Horses, the most-played opening pair in xiangqi.
// Named, not invented: this is book, so the image makes no claim of its own.
const OPENING_NAME = 'Central Cannon vs Screen Horses';
const LINE = `1. C2.5 H8+7  2. H2+3 R9.8  3. R1.2 H2+3
4. P7+1 P7+1  5. R2+6 A6+5  6. H8+7 C8.9
7. R2.3 C2+2  8. P5+1 P7+1`;

// Sized so the left board margin and the right text margin match: the panel's
// two columns, not the canvas, decide the width.
const CANVAS_W = 1520;
const CANVAS_H = 880;
const CANVAS_BG = '#0f1115';
const WORDMARK_FILL = '#e5e7eb';
const HEADING_FILL = '#f3f4f6';
const LABEL_FILL = '#9ca3af';
const MUTED_FILL = '#5b6470';
const RED_INK = '#e06c6c';
const BLACK_INK = '#cbd5e1';
const FONT = "'Noto Sans', system-ui, -apple-system, Helvetica, Arial, sans-serif";
const MONO_TRACKING = '1.5';

const imported = importXiangqiGame(LINE);
if (imported.error || imported.moves.length === 0) {
  throw new Error(`opening line did not replay: ${imported.error ?? 'no moves'}`);
}
const moves = imported.moves;
const wxf = formatXiangqiMoves(moves, 'wxf');
// A coordinate fallback means the position could not be named uniquely, which
// would put a label on the card that the site itself would not show.
for (const [index, label] of wxf.entries()) {
  if (label.includes('-')) {
    throw new Error(`move ${index + 1} fell back to coordinate notation: ${label}`);
  }
}

let state = createInitialXiangqiState('readme-hero');
for (const move of moves) {
  state = applyStandardXiangqiMove(state, move);
}

const pieces: XiangqiOgPiece[] = Object.entries(state.board).flatMap(([square, piece]) =>
  piece
    ? [
        {
          file: square.charCodeAt(0) - 97,
          rank: Number(square.slice(1)),
          color: piece.color,
          role: piece.role,
        },
      ]
    : [],
);

// ── Layout ────────────────────────────────────────────────────────────────
// Board width derives from its height inside the renderer (9.16/11.16 for the
// 9x10 grid), so pin the height and mirror that ratio to place the text panel.
const BOARD_H = 660;
const BOARD_W = BOARD_H * (9.16 / 11.16);
const BOARD_X = 96;
const BOARD_Y = 150;
const PANEL_X = BOARD_X + BOARD_W + 110;

const board = renderXiangqiOgBoardSvg({
  files: 9,
  ranks: 10,
  pieces,
  riverBetweenRanks: [5, 6],
  palaces: [
    { fileLo: 3, fileHi: 5, rankLo: 1, rankHi: 3 },
    { fileLo: 3, fileHi: 5, rankLo: 8, rankHi: 10 },
  ],
  centerX: BOARD_X + BOARD_W / 2,
  y: BOARD_Y,
  // The hero displays around 850 CSS pixels wide, so a 1-unit grid line lands
  // near half a pixel. Thicken it so the grid reads as lines, not mush.
  lineWidth: 1.8,
  height: BOARD_H,
});

function pieceKeyGlyph(glyph: string, cx: number, cy: number, size: number, ink: string): string {
  const path = XIANGQI_GLYPH_PATHS[glyph];
  if (!path) throw new Error(`no baked glyph path for ${glyph}`);
  const scale = size / 100;
  return [
    `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${scale})">`,
    `<circle cx="50" cy="50" r="46" fill="#f3e6c4" stroke="${ink}" stroke-width="2.5"/>`,
    `<path d="${path}" fill="${ink}"/>`,
    `</g>`,
  ].join('');
}

// Red's characters, in the order a chess player meets them: the piece that
// moves like something familiar first, the two with no chess analogue last.
const PIECE_KEY: Array<[string, string]> = [
  ['俥', 'Chariot'],
  ['傌', 'Horse'],
  ['炮', 'Cannon'],
  ['兵', 'Soldier'],
  ['相', 'Elephant'],
  ['仕', 'Advisor'],
  ['帥', 'General'],
];

const parts: string[] = [];
parts.push(`<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="${CANVAS_BG}"/>`);
parts.push(
  `<text x="${BOARD_X}" y="72" font-family="${FONT}" font-size="30" font-weight="700" letter-spacing="4" fill="${WORDMARK_FILL}">MISTBOARD</text>`,
);
parts.push(board);

// Move list: one row per full move, Red and Black in WXF side by side.
parts.push(
  `<text x="${PANEL_X}" y="${BOARD_Y + 4}" font-family="${FONT}" font-size="34" font-weight="700" fill="${HEADING_FILL}">${OPENING_NAME}</text>`,
);
const COL_NUM = PANEL_X;
const COL_RED = PANEL_X + 84;
const COL_BLACK = PANEL_X + 254;
const ROW_TOP = BOARD_Y + 76;
const ROW_H = 54;
parts.push(
  `<text x="${COL_RED}" y="${ROW_TOP}" font-family="${FONT}" font-size="20" font-weight="700" letter-spacing="2" fill="${MUTED_FILL}">RED</text>`,
  `<text x="${COL_BLACK}" y="${ROW_TOP}" font-family="${FONT}" font-size="20" font-weight="700" letter-spacing="2" fill="${MUTED_FILL}">BLACK</text>`,
);
for (let index = 0; index * 2 < wxf.length; index += 1) {
  const y = ROW_TOP + 46 + index * ROW_H;
  const red = wxf[index * 2];
  const black = wxf[index * 2 + 1];
  parts.push(
    `<text x="${COL_NUM}" y="${y}" font-family="${FONT}" font-size="28" fill="${MUTED_FILL}">${index + 1}.</text>`,
  );
  if (red) {
    parts.push(
      `<text x="${COL_RED}" y="${y}" font-family="${FONT}" font-size="28" font-weight="700" letter-spacing="${MONO_TRACKING}" fill="${RED_INK}">${red}</text>`,
    );
  }
  if (black) {
    parts.push(
      `<text x="${COL_BLACK}" y="${y}" font-family="${FONT}" font-size="28" font-weight="700" letter-spacing="${MONO_TRACKING}" fill="${BLACK_INK}">${black}</text>`,
    );
  }
}

// Piece key: the characters on the board, named in English.
const KEY_X = PANEL_X + 474;
const KEY_TOP = ROW_TOP;
parts.push(
  `<text x="${KEY_X}" y="${KEY_TOP}" font-family="${FONT}" font-size="20" font-weight="700" letter-spacing="2" fill="${MUTED_FILL}">PIECES</text>`,
);
const KEY_ROW_H = 70;
for (const [index, [glyph, name]] of PIECE_KEY.entries()) {
  const y = KEY_TOP + 46 + index * KEY_ROW_H;
  parts.push(pieceKeyGlyph(glyph, KEY_X + 22, y, 46, '#b91c1c'));
  parts.push(
    `<text x="${KEY_X + 62}" y="${y + 10}" font-family="${FONT}" font-size="27" fill="${LABEL_FILL}">${name}</text>`,
  );
}

parts.push(
  `<text x="${PANEL_X}" y="${CANVAS_H - 78}" font-family="${FONT}" font-size="26" fill="${LABEL_FILL}">WXF notation, English piece names, server-enforced rules.</text>`,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">${parts.join('')}</svg>`;
// The README renders this around 850 CSS pixels wide. Zoom 2 would put the PNG
// at 3.6x its display size, which costs bytes without adding detail and thins
// the board's hairlines on the way back down; 1.5 lands at a retina-safe 2.7x.
await fs.writeFile(outPath, await svgToPng(svg, CANVAS_BG, 1.5));
console.log(`wrote ${outPath} (${wxf.length} plies, ${imported.format})`);
