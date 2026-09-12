import './variant-mini-boards.css';
import { PIECE_SVGS } from '@mistboard/board-render';
import {
  ALL_JUNGLE_FLIP_SQUARES,
  createInitialJungleState,
  createInitialXiangqiState,
  getPlayerView as getXiangqiPlayerView,
  type ShogiPiece,
  type ShogiPieceRole,
  type XiangqiColor,
  type XiangqiPieceRole,
} from '@mistboard/game';
import {
  JUNGLE_FLIP_BOARD_VIEW,
  type JungleFlipRenderBoard,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';
import { JUNGLE_BOARD_VIEW, renderJungleBoardSvg } from './jungle-render.js';
import { shogiKomaSvg } from './shogi-render.js';
import {
  boardAppearanceChangedEvent,
  type PieceSet,
  readStoredPieceSet,
  xiangqiAppearanceChangedEvent,
} from './theme.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { drawsVeteranSoldier } from './xiangqi-crossed-soldier.js';
import {
  animalTreasureMarks,
  cjkGlyphMark,
  duckPieceMarks,
  internationalFlatTreasureMarks,
  internationalTreasureMarks,
  renderXiangqiPieceGlyphed,
  treasureSymbolMark,
  type XiangqiPieceSet,
} from './xiangqi-piece-sets.js';

// Small "mini board" tiles that represent each variant by a recognizable cropped
// board fragment. Reuses the real cburnett chess art and xiangqi character
// glyphs so the tiles read as the actual game at a glance. Pure SVG strings, no
// mounting, so they drop straight into any surface (homepage carousel, watch
// rail, profile, article cards, the variant lab).
//
// Board surface colours are emitted as CSS classes (variant-mini-boards.css),
// not baked hex, so the markers follow the board / xiangqi / fog pickers through
// the cascade with no re-render, exactly like the live boards and article
// diagrams. Piece ART (which set) is read from the stored appearance at render
// time and rebuilt on a piece-set change via refreshVariantMiniBoards(), because
// an inline-SVG <image> href or baked glyph can't be driven by CSS. Piece INK
// (the xiangqi cream disc + red/black marks) stays fixed by intent.

export type VariantMiniId =
  | 'chess'
  | 'dark-chess'
  | 'draft960'
  | 'xiangqi'
  | 'dark-xiangqi'
  | 'mini-xiangqi'
  | 'dark-mini-xiangqi'
  | 'drop-mini-xiangqi'
  | 'fortress-xiangqi'
  | 'duck-xiangqi'
  | 'jieqi'
  | 'banqi'
  | 'kriegspiel'
  | 'reveal-chess'
  | 'shogi'
  | 'dark-shogi'
  | 'crazyhouse'
  | 'dark-crazyhouse'
  | 'jungle'
  | 'jungle-flip';

export type VariantMiniFamily = 'chess' | 'xiangqi' | 'shogi' | 'jungle';

export interface VariantMiniDef {
  id: VariantMiniId;
  label: string;
  shortLabel: string;
  accent: string;
  blurb: string;
  // Which board family the tile belongs to, retained as marker metadata.
  family: VariantMiniFamily;
}

// The active piece sets a tile is drawn with. Read from stored appearance per
// render; overridable for tests / deterministic prerender.
interface MiniCtx {
  chessSet: PieceSet;
  xqSet: XiangqiPieceSet;
}

// board geometry inside the 100x100 viewBox (leaves room for the rounded frame)
const OX = 2;
const OY = 2;
const SIZE = 96;

// ---- low-level draw helpers ----------------------------------------------

// 'white:king' -> 'wK' etc. — the file naming under /pieces/<set>/.
const CHESS_CODE: Record<string, string> = {
  'white:king': 'wK',
  'white:queen': 'wQ',
  'white:rook': 'wR',
  'white:bishop': 'wB',
  'white:knight': 'wN',
  'white:pawn': 'wP',
  'black:king': 'bK',
  'black:queen': 'bQ',
  'black:rook': 'bR',
  'black:bishop': 'bB',
  'black:knight': 'bN',
  'black:pawn': 'bP',
};

function chessPieceAt(key: string, cx: number, cy: number, cell: number, set: PieceSet): string {
  const s = cell * 0.92;
  const x = cx - s / 2;
  const y = cy - s / 2;
  // cburnett ships as inline SVG art in board-render (no /pieces/cburnett file
  // set), so the default stays inline; every other set is a same-origin asset.
  if (set === 'cburnett') {
    const svg = PIECE_SVGS[key];
    if (!svg) return '';
    const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    return `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 45 45">${inner}</svg>`;
  }
  const code = CHESS_CODE[key];
  if (!code) return '';
  return `<image href="/pieces/${set}/${code}.svg" x="${x}" y="${y}" width="${s}" height="${s}"/>`;
}

// A face-down chess piece (Reveal Chess): a white hidden back, aligned with the
// Banqi face-down mark (single solid fill + thin outline, no inner ring).
// Identity-hiding only, so it does not vary with the chosen piece set.
function chessBackToken(cx: number, cy: number, cell: number): string {
  const r = cell * 0.4;
  return `<circle class="vm-chess-back-token" cx="${cx}" cy="${cy}" r="${r}" fill="#f4efe4" stroke="#3a342b" stroke-width="0.5"/>`;
}

function checker(cols: number, rows: number, cell: number): string {
  const out: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const light = (r + c) % 2 === 0;
      out.push(
        `<rect class="${light ? 'vm-sq-light' : 'vm-sq-dark'}" x="${OX + c * cell}" y="${OY + r * cell}" width="${cell}" height="${cell}"/>`,
      );
    }
  }
  return out.join('');
}

function fogCell(c: number, r: number, cell: number): string {
  // Matches the live 'solid' fog: a flat dark square with a 1px inset shadow.
  const x = OX + c * cell;
  const y = OY + r * cell;
  return [
    `<rect class="vm-chess-fog" x="${x}" y="${y}" width="${cell}" height="${cell}"/>`,
    `<rect class="vm-chess-fog-inset" x="${x + 0.5}" y="${y + 0.5}" width="${cell - 1}" height="${cell - 1}" fill="none" stroke-width="0.8"/>`,
  ].join('');
}

// ---- canonical xiangqi rendering (delegates to the live piece renderer) -----

// A piece disc with the active xiangqi set's mark (traditional/simplified/
// western/symbols), reusing the same renderer the live board + OG cards use so
// every surface renders one identical glyph. Ink (cream disc, red/black) is
// fixed inside that renderer by intent. `size` is the disc's bounding box.
// `veteran` marks a board whose soldiers get the sideways step unconditionally
// (the Mini Xiangqi family, Fortress Xiangqi), so their soldiers draw with the
// promoted art here the same way they do on the live board.
function xiangqiDisc(
  cx: number,
  cy: number,
  size: number,
  color: XiangqiColor,
  role: XiangqiPieceRole,
  set: XiangqiPieceSet,
  veteran = false,
): string {
  return renderXiangqiPieceGlyphed({ color, role }, set, {
    x: cx - size / 2,
    y: cy - size / 2,
    size,
    crossed: veteran && drawsVeteranSoldier({ role }),
  });
}

// A face-down piece back (the 'back' shrouded style): a flat colour disc. The
// back art is identity-agnostic, so the set is irrelevant; role is a filler.
function xiangqiBackDisc(
  cx: number,
  cy: number,
  size: number,
  color: XiangqiColor,
  set: XiangqiPieceSet,
): string {
  return renderXiangqiPieceGlyphed({ color, role: 'general' }, set, {
    x: cx - size / 2,
    y: cy - size / 2,
    size,
    shrouded: true,
    shroudedStyle: 'back',
  });
}

// ---- xiangqi intersection-grid geometry -----------------------------------

interface XqGeom {
  px: (c: number) => number;
  py: (r: number) => number;
  gx: number;
  gy: number;
  cols: number;
  rows: number;
}

function xqGeom(cols: number, rows: number, margin = 9): XqGeom {
  const gx = (SIZE - 2 * margin) / (cols - 1);
  const gy = (SIZE - 2 * margin) / (rows - 1);
  const left = OX + margin;
  const top = OY + margin;
  return { px: (c) => left + c * gx, py: (r) => top + r * gy, gx, gy, cols, rows };
}

// Bamboo board + grid lines; interior verticals break at the river gap, and an
// optional palace box gets corner-to-corner diagonals.
function xqBoard(
  g: XqGeom,
  opts: {
    riverGapAfterRow?: number;
    palace?: { cLo: number; cHi: number; rLo: number; rHi: number };
  } = {},
): string {
  const lines: string[] = [];
  for (let r = 0; r < g.rows; r += 1) {
    lines.push(`<line x1="${g.px(0)}" y1="${g.py(r)}" x2="${g.px(g.cols - 1)}" y2="${g.py(r)}"/>`);
  }
  for (let c = 0; c < g.cols; c += 1) {
    const edge = c === 0 || c === g.cols - 1;
    if (opts.riverGapAfterRow !== undefined && !edge) {
      const rg = opts.riverGapAfterRow;
      lines.push(`<line x1="${g.px(c)}" y1="${g.py(0)}" x2="${g.px(c)}" y2="${g.py(rg)}"/>`);
      lines.push(
        `<line x1="${g.px(c)}" y1="${g.py(rg + 1)}" x2="${g.px(c)}" y2="${g.py(g.rows - 1)}"/>`,
      );
    } else {
      lines.push(
        `<line x1="${g.px(c)}" y1="${g.py(0)}" x2="${g.px(c)}" y2="${g.py(g.rows - 1)}"/>`,
      );
    }
  }
  if (opts.palace) {
    const p = opts.palace;
    lines.push(
      `<line x1="${g.px(p.cLo)}" y1="${g.py(p.rLo)}" x2="${g.px(p.cHi)}" y2="${g.py(p.rHi)}"/>`,
    );
    lines.push(
      `<line x1="${g.px(p.cHi)}" y1="${g.py(p.rLo)}" x2="${g.px(p.cLo)}" y2="${g.py(p.rHi)}"/>`,
    );
  }
  return [
    `<rect class="vm-xq-bg" x="${OX}" y="${OY}" width="${SIZE}" height="${SIZE}"/>`,
    `<g class="vm-xq-line" stroke-width="1" stroke-linecap="round">${lines.join('')}</g>`,
  ].join('');
}

// ---- per-variant tile bodies ---------------------------------------------

// Shared 5x5 chess-family crop: white's back rank (caller-supplied files) under
// a rank of pawns. `fogRows` lists which of the three empty front ranks — rows
// 0-2, counted from the top — are shrouded: none for plain chess; just the top
// (rank 5) for the field-of-fire dark variants, since white sees ranks 1-4 in
// full (own pieces, every pawn's one/two-square advance and capture squares, and
// the knight jumps — verified against darkChessVariant.getPlayerView); all three
// for kriegspiel, where only your own army is ever visible.
function fiveWideChessBody(
  backRank: readonly string[],
  fogRows: readonly number[],
  ctx: MiniCtx,
): string {
  const cell = SIZE / 5;
  const center = (c: number, r: number) => ({ x: OX + (c + 0.5) * cell, y: OY + (r + 0.5) * cell });
  const pieces: string[] = [];
  for (let c = 0; c < 5; c += 1) {
    const pawn = center(c, 3);
    const piece = center(c, 4);
    pieces.push(chessPieceAt('white:pawn', pawn.x, pawn.y, cell, ctx.chessSet));
    pieces.push(chessPieceAt(backRank[c]!, piece.x, piece.y, cell, ctx.chessSet));
  }
  const fog: string[] = [];
  for (const r of fogRows) {
    for (let c = 0; c < 5; c += 1) fog.push(fogCell(c, r, cell));
  }
  return [checker(5, 5, cell), ...pieces, ...fog].join('');
}

// Files d..h on white's back rank: queen, king, bishop, knight, rook.
const KINGSIDE_FIVE = ['white:queen', 'white:king', 'white:bishop', 'white:knight', 'white:rook'];

// Plain board, nothing hidden.
function chessCornerBody(ctx: MiniCtx): string {
  return fiveWideChessBody(KINGSIDE_FIVE, [], ctx);
}

// Field-of-fire vision: white sees ranks 1-4, so only the 5th rank (top row) fogs.
function darkChessBody(ctx: MiniCtx): string {
  return fiveWideChessBody(KINGSIDE_FIVE, [0], ctx);
}

// A Chess960-style scramble — queen + king off their standard files so the
// arrangement reads as shuffled vs. dark chess. Same opening vision (pawns still
// on rank 2 → ranks 3-4 visible), so the fog still sits only on the top row.
function draft960Body(ctx: MiniCtx): string {
  return fiveWideChessBody(
    ['white:king', 'white:rook', 'white:queen', 'white:knight', 'white:bishop'],
    [0],
    ctx,
  );
}

// Red's accurate vision of the xiangqi opening: a square is visible iff a red
// piece can move to it (field of fire); everything else is fogged.
const XQ_RED_VISIBLE = new Set<string>(
  getXiangqiPlayerView(createInitialXiangqiState('xq-mini-tile'), 'red').visibleSquares,
);

function xiangqiCourtBody(showFog: boolean, ctx: MiniCtx): string {
  // Red's base on files a..e, ranks 1..5, mirrored horizontally (columns flipped
  // f -> 4-f; glyphs stay upright). The back-rank court (chariot, horse, elephant,
  // advisor, general), the cannon on b3 behind the rank-4 soldiers (a, c, e), and
  // (in Dark Xiangqi) real-vision fog — the advisor file (d) blind spot (d2, d4,
  // d5) plus c2 where the elephant screens the horse's leg. Standard xiangqi
  // leaves those same squares as plain intersections.
  // Inset the grid a touch more than the default so the points pull in from the
  // frame, leaving room for larger, more legible discs without edge clipping.
  const g = xqGeom(5, 5, 11);
  const disc = g.gx * 0.92;
  const px = (f: number) => g.px(4 - f); // mirror columns; keep pieces unflipped
  const fileCh = (f: number) => String.fromCharCode(97 + f);
  // Fog cells tile from midpoint to midpoint between grid points, clamped to the
  // board frame at the outer edges, and render as a SINGLE translucent path so
  // adjacent cells merge with no anti-aliased seams and the edge cells sit flush
  // against the border (drawing them as separate translucent rects leaves both).
  const fog: string[] = [];
  if (showFog) {
    const cells: string[] = [];
    for (let f = 0; f <= 4; f += 1) {
      for (let rank = 1; rank <= 5; rank += 1) {
        if (XQ_RED_VISIBLE.has(`${fileCh(f)}${rank}`)) continue;
        const dc = 4 - f; // display column (columns are mirrored)
        const dr = 5 - rank; // display row (rank 5 at the top)
        const x0 = dc === 0 ? OX : (g.px(dc - 1) + g.px(dc)) / 2;
        const x1 = dc === 4 ? OX + SIZE : (g.px(dc) + g.px(dc + 1)) / 2;
        const y0 = dr === 0 ? OY : (g.py(dr - 1) + g.py(dr)) / 2;
        const y1 = dr === 4 ? OY + SIZE : (g.py(dr) + g.py(dr + 1)) / 2;
        cells.push(`M${x0} ${y0}H${x1}V${y1}H${x0}Z`);
      }
    }
    if (cells.length) fog.push(`<path class="vm-xq-fog" d="${cells.join('')}"/>`);
  }
  const court: XiangqiPieceRole[] = ['chariot', 'horse', 'elephant', 'advisor', 'general'];
  const courtPieces = court.map((role, f) =>
    xiangqiDisc(px(f), g.py(4), disc, 'red', role, ctx.xqSet),
  );
  // The visible half of the palace: file f is off this crop, so draw the two
  // diagonals over the advisor (file d) and general (file e) files only.
  const halfPalace = `<g class="vm-xq-line" stroke-width="1" stroke-linecap="round"><line x1="${px(3)}" y1="${g.py(4)}" x2="${px(4)}" y2="${g.py(3)}"/><line x1="${px(3)}" y1="${g.py(2)}" x2="${px(4)}" y2="${g.py(3)}"/></g>`;
  const pieces = [
    ...courtPieces,
    xiangqiDisc(px(1), g.py(2), disc, 'red', 'cannon', ctx.xqSet),
    // soldiers sit on rank 4, two rows ahead of the cannon's rank
    ...[0, 2, 4].map((f) => xiangqiDisc(px(f), g.py(1), disc, 'red', 'soldier', ctx.xqSet)),
  ];
  return [xqBoard(g), halfPalace, fog.join(''), ...pieces].join('');
}

// The standard xiangqi court with the duck standing in it. The court crop is
// reused rather than redrawn: the whole variant IS xiangqi plus one token, and a
// mini that redrew the board would be claiming a difference that is not there.
//
// The duck is a plain gold disc, not the emoji the live board uses. At this size
// a glyph is a smudge, and the mini has to survive whatever font the reader has.
function duckXiangqiBody(ctx: MiniCtx): string {
  const g = xqGeom(5, 5, 11);
  const disc = g.gx * 0.92;
  const px = (f: number) => g.px(4 - f);
  // d3: an empty point in the opening array, clear of the cannon on b3 and of
  // the rank-4 soldiers, so the duck reads as a thing standing in open space.
  const cx = px(3);
  const cy = g.py(2);
  // The same duck the live board draws, in whatever frame the reader's set uses.
  const duck = `<g transform="translate(${cx - disc / 2},${cy - disc / 2}) scale(${disc / 100})">${duckPieceMarks(ctx.xqSet)}</g>`;
  return [xiangqiCourtBody(false, ctx), duck].join('');
}

function miniXiangqiCutBody(showFog: boolean, ctx: MiniCtx): string {
  // A 3x3-cell (4x4-point) cut of the real mini-xiangqi opening: files d..g,
  // ranks 1..4 (one file + one rank tighter than the full court, so the pieces
  // read larger). The general sits on the cropped left edge (file d), showing
  // the right half of its palace; horse and cannon fill the back rank and a
  // chariot anchors the right.
  // Wider margin than the default: with only 4 points across, the cells (and so
  // the discs) grow, and the outer-ring pieces would overflow the rounded frame
  // unless the grid is inset further from the edge.
  const g = xqGeom(4, 4, 13);
  const disc = g.gx * 0.9;
  // file d..g -> col 0..3 ; rank 1..4 -> row 3..0 (red on the near/bottom side)
  const at = (file: number, rank: number) => ({ x: g.px(file - 3), y: g.py(4 - rank) });
  const backRank: Array<[number, XiangqiPieceRole]> = [
    [3, 'general'],
    [4, 'horse'],
    [5, 'cannon'],
    [6, 'chariot'],
  ];
  const pieces = [
    ...backRank.map(([file, role]) => {
      const p = at(file, 1);
      return xiangqiDisc(p.x, p.y, disc, 'red', role, ctx.xqSet);
    }),
    // soldiers sit in front of files d, e, g (the cannon file f stays open)
    ...[3, 4, 6].map((file) => {
      const p = at(file, 2);
      return xiangqiDisc(p.x, p.y, disc, 'red', 'soldier', ctx.xqSet, true);
    }),
  ].join('');
  // The visible (right) half of the general's palace: its centre (d2) sits on
  // the cropped left edge, so draw the two diagonals fanning in toward file e.
  const halfPalace = `<g class="vm-xq-line" stroke-width="1" stroke-linecap="round"><line x1="${g.px(0)}" y1="${g.py(2)}" x2="${g.px(1)}" y2="${g.py(1)}"/><line x1="${g.px(0)}" y1="${g.py(2)}" x2="${g.px(1)}" y2="${g.py(3)}"/></g>`;
  // Dark variant: red sees ranks 1-3 in full; only the 4th rank (the top row) is
  // fogged, and even there the cannon file (f, col 2) stays open — its sightline
  // up the board is clear. Verified against getMiniXiangqiPlayerView. Standard
  // mini-xiangqi shows the same approach as plain board.
  let fog = '';
  if (showFog) {
    const fogYBottom = (g.py(0) + g.py(1)) / 2;
    const leftX1 = (g.px(1) + g.px(2)) / 2;
    const rightX0 = (g.px(2) + g.px(3)) / 2;
    fog = [
      `<rect class="vm-xq-fog" x="${OX}" y="${OY}" width="${leftX1 - OX}" height="${fogYBottom - OY}"/>`,
      `<rect class="vm-xq-fog" x="${rightX0}" y="${OY}" width="${OX + SIZE - rightX0}" height="${fogYBottom - OY}"/>`,
    ].join('');
  }
  return [xqBoard(g), halfPalace, pieces, fog].join('');
}

function dropMiniXiangqiBody(ctx: MiniCtx): string {
  // Open mini-xiangqi plus a reserve tray: the board stays visible, while the
  // bottom hand row signals the drop/crazyhouse axis without borrowing chess art.
  const boardH = 72;
  const trayY = OY + boardH;
  const trayH = SIZE - boardH;
  const marginX = 12;
  const marginY = 9;
  const left = OX + marginX;
  const top = OY + marginY;
  const gx = (SIZE - 2 * marginX) / 3;
  const gy = (boardH - 2 * marginY) / 2;
  const px = (c: number) => left + c * gx;
  const py = (r: number) => top + r * gy;
  const disc = Math.min(gx, gy) * 0.88;
  const lines: string[] = [];
  for (let r = 0; r < 3; r += 1) {
    lines.push(`<line x1="${px(0)}" y1="${py(r)}" x2="${px(3)}" y2="${py(r)}"/>`);
  }
  for (let c = 0; c < 4; c += 1) {
    lines.push(`<line x1="${px(c)}" y1="${py(0)}" x2="${px(c)}" y2="${py(2)}"/>`);
  }
  lines.push(`<line x1="${px(0)}" y1="${py(1)}" x2="${px(1)}" y2="${py(0)}"/>`);
  lines.push(`<line x1="${px(0)}" y1="${py(1)}" x2="${px(1)}" y2="${py(2)}"/>`);
  const boardPieces = [
    xiangqiDisc(px(0), py(2), disc, 'red', 'general', ctx.xqSet),
    xiangqiDisc(px(1), py(2), disc, 'red', 'horse', ctx.xqSet),
    xiangqiDisc(px(2), py(2), disc, 'red', 'cannon', ctx.xqSet),
    xiangqiDisc(px(1), py(1), disc, 'red', 'soldier', ctx.xqSet, true),
    xiangqiDisc(px(3), py(0), disc, 'black', 'soldier', ctx.xqSet, true),
  ];
  const handDisc = trayH * 0.78;
  const hand = [
    xiangqiDisc(OX + SIZE * 0.24, trayY + trayH / 2, handDisc, 'red', 'chariot', ctx.xqSet),
    xiangqiDisc(OX + SIZE * 0.5, trayY + trayH / 2, handDisc, 'red', 'horse', ctx.xqSet),
    xiangqiDisc(OX + SIZE * 0.76, trayY + trayH / 2, handDisc, 'red', 'cannon', ctx.xqSet),
  ];
  return [
    `<rect class="vm-xq-bg" x="${OX}" y="${OY}" width="${SIZE}" height="${boardH}"/>`,
    `<g class="vm-xq-line" stroke-width="1" stroke-linecap="round">${lines.join('')}</g>`,
    ...boardPieces,
    `<rect class="vm-hand-tray" x="${OX}" y="${trayY}" width="${SIZE}" height="${trayH}"/>`,
    `<line class="vm-hand-tray-edge" x1="${OX}" y1="${trayY}" x2="${OX + SIZE}" y2="${trayY}" stroke-width="1"/>`,
    ...hand,
  ].join('');
}

function fortressTreasureDisc(
  cx: number,
  cy: number,
  size: number,
  color: XiangqiColor,
  set: XiangqiPieceSet,
): string {
  const r = size / 2;
  // Every mark is authored in a 100-unit box (like the baked glyphs, symbols,
  // and animal discs), so scale it onto this disc.
  const place = (inner: string) =>
    `<g transform="translate(${cx - r} ${cy - r}) scale(${size / 100})">${inner}</g>`;
  // Animal set: the peacock disc, identical to the full board and the other
  // animal pieces (no hanzi disc base — it brings its own cream fill + ring).
  if (set === 'animal-dobutsu') {
    return place(animalTreasureMarks(color));
  }
  if (set === 'international') {
    return place(internationalTreasureMarks(color));
  }
  if (set === 'international-flat') {
    return place(internationalFlatTreasureMarks(color));
  }
  const ring = color === 'red' ? '#c2261e' : '#283a47';
  const ink = color === 'red' ? '#8a1a14' : '#283a47';
  // Using cjkGlyphMark keeps the Treasure hanzi on the same Noto Sans CJK SC
  // Bold outline as its neighbors instead of the viewer's system serif (matching
  // stroke weight); the Symbols set gets the faceted gem.
  const mark =
    set === 'symbols'
      ? treasureSymbolMark(ink)
      : cjkGlyphMark(set === 'simplified' ? '宝' : set === 'western' ? 'T' : '寶', ink);
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f3e6c4" stroke="${ring}" stroke-width="1"/>`,
    place(mark),
  ].join('');
}

function fortressXiangqiBody(ctx: MiniCtx): string {
  // Faithful crop of the RED fortress at the opening: the bottom-left 4x4 of the
  // real board (files a-d x ranks 1-4) straight from FORTRESS_XIANGQI_START_FEN
  // (...PP1P1PP/QKAECNR). The red palace (a1-c3) sits in the corner with its X,
  // and the Treasure — the piece unique to this variant — starts at a1, right in
  // the corner of the crop.
  const N = 4;
  const margin = 13;
  const cell = (SIZE - 2 * margin) / (N - 1);
  const left = OX + margin;
  const top = OY + margin;
  // Files a..d = 0..3 (left to right); ranks 1..4 with rank 1 at the bottom.
  const px = (file: number) => left + file * cell;
  const py = (rank: number) => top + (N - rank) * cell;
  const disc = cell * 0.9;
  const lines: string[] = [];
  for (let rank = 1; rank <= N; rank += 1) {
    lines.push(`<line x1="${px(0)}" y1="${py(rank)}" x2="${px(N - 1)}" y2="${py(rank)}"/>`);
  }
  for (let file = 0; file < N; file += 1) {
    lines.push(`<line x1="${px(file)}" y1="${py(1)}" x2="${px(file)}" y2="${py(N)}"/>`);
  }
  // Red palace X (files a-c, ranks 1-3): the two corner diagonals.
  lines.push(`<line x1="${px(0)}" y1="${py(1)}" x2="${px(2)}" y2="${py(3)}"/>`);
  lines.push(`<line x1="${px(0)}" y1="${py(3)}" x2="${px(2)}" y2="${py(1)}"/>`);
  // Rank 1 back rank: Treasure, General, Advisor, Elephant (a1-d1). Rank 2
  // soldiers on a, b, d (c2 empty) — exactly PP1P1PP cropped to files a-d.
  const boardPieces = [
    fortressTreasureDisc(px(0), py(1), disc, 'red', ctx.xqSet),
    xiangqiDisc(px(1), py(1), disc, 'red', 'general', ctx.xqSet),
    xiangqiDisc(px(2), py(1), disc, 'red', 'advisor', ctx.xqSet),
    xiangqiDisc(px(3), py(1), disc, 'red', 'elephant', ctx.xqSet),
    // River-gated since 2026-09-02: these sit on their own half, so base art.
    xiangqiDisc(px(0), py(2), disc, 'red', 'soldier', ctx.xqSet),
    xiangqiDisc(px(1), py(2), disc, 'red', 'soldier', ctx.xqSet),
    xiangqiDisc(px(3), py(2), disc, 'red', 'soldier', ctx.xqSet),
  ];
  return [
    `<rect class="vm-xq-bg" x="${OX}" y="${OY}" width="${SIZE}" height="${SIZE}"/>`,
    `<g class="vm-xq-line" stroke-width="1.5" stroke-linecap="round">${lines.join('')}</g>`,
    ...boardPieces,
  ].join('');
}

function jieqiBody(ctx: MiniCtx): string {
  // Same crop as Dark Xiangqi (mirrored), but jieqi hides identities, not
  // positions: every piece except the general is flipped to its blank
  // solid-colour back. No position fog — the whole board is visible.
  // Inset the grid a touch more than the default so the points pull in from the
  // frame, leaving room for larger, more legible discs without edge clipping.
  const g = xqGeom(5, 5, 11);
  const disc = g.gx * 0.92;
  const px = (f: number) => g.px(4 - f);
  const court: XiangqiPieceRole[] = ['chariot', 'horse', 'elephant', 'advisor', 'general'];
  const courtPieces = court.map((role, f) =>
    role === 'general'
      ? xiangqiDisc(px(f), g.py(4), disc, 'red', role, ctx.xqSet)
      : xiangqiBackDisc(px(f), g.py(4), disc, 'red', ctx.xqSet),
  );
  const halfPalace = `<g class="vm-xq-line" stroke-width="1" stroke-linecap="round"><line x1="${px(3)}" y1="${g.py(4)}" x2="${px(4)}" y2="${g.py(3)}"/><line x1="${px(3)}" y1="${g.py(2)}" x2="${px(4)}" y2="${g.py(3)}"/></g>`;
  const pieces = [
    ...courtPieces,
    xiangqiBackDisc(px(1), g.py(2), disc, 'red', ctx.xqSet),
    ...[0, 2, 4].map((f) => xiangqiBackDisc(px(f), g.py(1), disc, 'red', ctx.xqSet)),
  ];
  return [xqBoard(g), halfPalace, ...pieces].join('');
}

function banqiBody(ctx: MiniCtx): string {
  // Banqi plays in cells (not on intersections): a 3x3 cell crop of face-down
  // pieces, two flipped. Cells distinguish it from jieqi's point grid.
  const cols = 3;
  const rows = 3;
  const margin = 6;
  const cw = (SIZE - 2 * margin) / cols;
  const ch = (SIZE - 2 * margin) / rows;
  const left = OX + margin;
  const top = OY + margin;
  const ccx = (c: number) => left + (c + 0.5) * cw;
  const ccy = (r: number) => top + (r + 0.5) * ch;
  const disc = Math.min(cw, ch) * 0.86;
  const lines: string[] = [];
  for (let r = 0; r <= rows; r += 1) {
    lines.push(
      `<line x1="${left}" y1="${top + r * ch}" x2="${left + cols * cw}" y2="${top + r * ch}"/>`,
    );
  }
  for (let c = 0; c <= cols; c += 1) {
    lines.push(
      `<line x1="${left + c * cw}" y1="${top}" x2="${left + c * cw}" y2="${top + rows * ch}"/>`,
    );
  }
  // Two generals flipped face-up on opposite corners (red bottom-left, black
  // top-right); everything else a uniform face-down back (banqi backs are
  // colour-agnostic — you don't know colour or rank until a flip).
  const redGeneral: [number, number] = [0, 2];
  const blackGeneral: [number, number] = [2, 0];
  const revealed = new Set([
    `${redGeneral[0]},${redGeneral[1]}`,
    `${blackGeneral[0]},${blackGeneral[1]}`,
  ]);
  const backs: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (revealed.has(`${c},${r}`)) continue;
      backs.push(xiangqiBackDisc(ccx(c), ccy(r), disc, 'black', ctx.xqSet));
    }
  }
  return [
    `<rect class="vm-xq-bg" x="${OX}" y="${OY}" width="${SIZE}" height="${SIZE}"/>`,
    `<g class="vm-xq-line" stroke-width="1" stroke-linecap="round">${lines.join('')}</g>`,
    backs.join(''),
    xiangqiDisc(ccx(redGeneral[0]), ccy(redGeneral[1]), disc, 'red', 'general', ctx.xqSet),
    xiangqiDisc(ccx(blackGeneral[0]), ccy(blackGeneral[1]), disc, 'black', 'general', ctx.xqSet),
  ].join('');
}

// Crazyhouse: a chess crop with the variant's signature reserve. Captured pieces
// flip sides and wait "in hand" to be dropped back onto the board, so the marker
// pairs a 4x3 checker over a hand tray of waiting pieces.
function crazyhouseBody(ctx: MiniCtx): string {
  const cols = 4;
  const boardRows = 3;
  const cell = SIZE / cols;
  const boardH = boardRows * cell;
  const center = (c: number, r: number) => ({
    x: OX + (c + 0.5) * cell,
    y: OY + (r + 0.5) * cell,
  });
  const cells: string[] = [];
  for (let r = 0; r < boardRows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const light = (r + c) % 2 === 0;
      cells.push(
        `<rect class="${light ? 'vm-sq-light' : 'vm-sq-dark'}" x="${OX + c * cell}" y="${OY + r * cell}" width="${cell}" height="${cell}"/>`,
      );
    }
  }
  const back = ['white:rook', 'white:knight', 'white:queen', 'white:king'];
  const boardPieces = [
    ...back.map((key, c) => chessPieceAt(key, center(c, 2).x, center(c, 2).y, cell, ctx.chessSet)),
    ...[0, 1, 2, 3].map((c) =>
      chessPieceAt('white:pawn', center(c, 1).x, center(c, 1).y, cell, ctx.chessSet),
    ),
  ];
  const trayY = OY + boardH;
  const trayH = SIZE - boardH;
  const tray = [
    `<rect class="vm-hand-tray" x="${OX}" y="${trayY}" width="${SIZE}" height="${trayH}"/>`,
    `<line class="vm-hand-tray-edge" x1="${OX}" y1="${trayY}" x2="${OX + SIZE}" y2="${trayY}" stroke-width="1"/>`,
  ];
  const hand = ['white:knight', 'white:bishop', 'white:pawn'];
  const handPieces = hand.map((key, i) =>
    chessPieceAt(key, OX + (i + 0.5) * (SIZE / 3), trayY + trayH / 2, trayH, ctx.chessSet),
  );
  return [cells.join(''), ...boardPieces, ...tray, ...handPieces].join('');
}

// Blind chess: you only ever see your own army. Every square without one of your
// own pieces or pawns is dark, so all three empty ranks in front are fogged —
// the inverse of dark chess, where field-of-fire vision keeps them clear.
function kriegspielBody(ctx: MiniCtx): string {
  return fiveWideChessBody(KINGSIDE_FIVE, [0, 1, 2], ctx);
}

function revealChessBody(ctx: MiniCtx): string {
  // Hidden-identity chess (chess jieqi): every piece starts face-down except the
  // king, which is face-up. No fog — only identities hide.
  const cell = SIZE / 4;
  const center = (c: number, r: number) => ({ x: OX + (c + 0.5) * cell, y: OY + (r + 0.5) * cell });
  const kingCol = 1;
  const pieces: string[] = [];
  for (let c = 0; c < 4; c += 1) {
    const pawn = center(c, 2);
    const back = center(c, 3);
    pieces.push(chessBackToken(pawn.x, pawn.y, cell));
    if (c === kingCol) {
      pieces.push(chessPieceAt('white:king', back.x, back.y, cell, ctx.chessSet));
    } else {
      pieces.push(chessBackToken(back.x, back.y, cell));
    }
  }
  return [checker(4, 4, cell), ...pieces].join('');
}

// ---- shogi (wood grid + kanji koma) ---------------------------------------

// A koma (shogi piece) placed at an absolute top-left. Reuses the live koma art — a
// wedge tile + kanji, colours inlined — re-wrapped at the marker scale the way
// chessPieceAt re-wraps the cburnett glyphs.
function shogiKomaAt(
  piece: ShogiPiece,
  x: number,
  y: number,
  size: number,
  pointsUp = true,
): string {
  const inner = shogiKomaSvg(piece, pointsUp)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 40 40">${inner}</svg>`;
}

// Shogi: a 5x5 crop of one camp's bottom-right corner (sente), pentagon komas
// pointing up-screen toward the enemy. Columns left->right are files 5..1, rows
// top->bottom ranks 5..1, so the back rank (king, gold, silver, knight, lance)
// sits at the bottom, the lone rook on file 2 holds the gap rank, and the pawns
// run across the rank ahead; the far edge beyond the camp's sight is fogged in
// Dark Shogi.
function shogiBody(showFog: boolean): string {
  const n = 5;
  const cw = SIZE / n;
  const koma = cw * 0.86;
  const inset = (cw - koma) / 2;
  const place = (role: ShogiPieceRole, c: number, r: number): string =>
    shogiKomaAt(
      { color: 'black', role, promoted: false },
      OX + (n - 1 - c) * cw + inset,
      OY + r * cw + inset,
      koma,
      true,
    );
  const lines: string[] = [];
  for (let i = 1; i < n; i += 1) {
    lines.push(`<line x1="${OX}" y1="${OY + i * cw}" x2="${OX + SIZE}" y2="${OY + i * cw}"/>`);
    lines.push(`<line x1="${OX + i * cw}" y1="${OY}" x2="${OX + i * cw}" y2="${OY + SIZE}"/>`);
  }
  const fog: string[] = [];
  if (showFog) {
    fog.push(`<rect class="vm-shogi-fog" x="${OX}" y="${OY}" width="${SIZE}" height="${cw}"/>`);
  }
  const backRank: ShogiPieceRole[] = ['K', 'G', 'S', 'N', 'L'];
  const pieces = [
    ...backRank.map((role, c) => place(role, c, 4)),
    place('R', 3, 3),
    ...[0, 1, 2, 3, 4].map((c) => place('P', c, 2)),
  ];
  return [
    `<rect class="vm-shogi-bg" x="${OX}" y="${OY}" width="${SIZE}" height="${SIZE}"/>`,
    `<g class="vm-shogi-line" stroke-width="1" stroke-linecap="round">${lines.join('')}</g>`,
    fog.join(''),
    ...pieces,
  ].join('');
}

// ---- jungle (Dou Shou Qi) animal-rank tiles -------------------------------

// Jungle markers crop the REAL starting board (the shared dobutsu/terrain renderer), so
// the tile always matches the live board exactly. Shadows are off (markers don't need
// them, and it keeps filter ids out of the shared document); the marker frame's rounded
// clip-path trims the square crop.
function stripOuterSvg(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

// Embed a board SVG cropped to a `span × span` cell region whose bottom-left cell is
// (fileLo, rankLo) — rank 1 is the bottom row — filling the marker's content box.
function croppedBoardMarker(
  boardSvg: string,
  view: { cell: number; ranks: number },
  fileLo: number,
  rankLo: number,
  span: number,
): string {
  const { cell, ranks } = view;
  const x = fileLo * cell;
  const y = (ranks - (rankLo - 1) - span) * cell;
  const size = span * cell;
  return `<svg x="${OX}" y="${OY}" width="${SIZE}" height="${SIZE}" viewBox="${x} ${y} ${size} ${size}" preserveAspectRatio="xMidYMid slice">${stripOuterSvg(boardSvg)}</svg>`;
}

function jungleBody(): string {
  // The bottom-CENTER 3×3 of the real starting board (files c–e): red's den flanked by
  // its traps, with the leopard and wolf behind — the den makes it read as Jungle at a
  // glance. No last-move marker.
  const board = createInitialJungleState('marker').board;
  // Pinned to the animal skin: this is the variant's IDENTITY mark (nav, picker,
  // channel rail), not a play surface, so a viewer's board-skin preference must
  // not repaint the site's iconography.
  const svg = renderJungleBoardSvg(board, {
    // Marker boards render a few dozen pixels wide; the badge would be a smudge.
    cueBadges: false,
    idSuffix: '-mk-jungle',
    shadow: false,
    boardSkin: 'illustrated',
    pieceSkin: 'animals',
  });
  return croppedBoardMarker(svg, JUNGLE_BOARD_VIEW, 2, 1, 3);
}

function jungleFlipBody(): string {
  // A 2×2 crop with the two elephants flipped up on opposite corners (the rat-beats-
  // elephant headline piece) and the other two tiles face-down jade discs. No last move.
  const board: JungleFlipRenderBoard = {};
  for (const sq of ALL_JUNGLE_FLIP_SQUARES) board[sq] = { faceDown: true };
  board.a1 = { faceDown: false, color: 'red', role: 'elephant' };
  board.b2 = { faceDown: false, color: 'black', role: 'elephant' };
  // Pinned to the animal skin — see jungleBody.
  const svg = renderJungleFlipBoardSvg(board, {
    idSuffix: '-mk-flip',
    shadow: false,
    boardSkin: 'illustrated',
    pieceSkin: 'animals',
  });
  return croppedBoardMarker(svg, JUNGLE_FLIP_BOARD_VIEW, 0, 1, 2);
}

// ---- registry + render entry ----------------------------------------------

const BODIES: Record<VariantMiniId, (ctx: MiniCtx) => string> = {
  chess: chessCornerBody,
  'dark-chess': darkChessBody,
  draft960: draft960Body,
  xiangqi: (ctx) => xiangqiCourtBody(false, ctx),
  'dark-xiangqi': (ctx) => xiangqiCourtBody(true, ctx),
  'mini-xiangqi': (ctx) => miniXiangqiCutBody(false, ctx),
  'dark-mini-xiangqi': (ctx) => miniXiangqiCutBody(true, ctx),
  'drop-mini-xiangqi': dropMiniXiangqiBody,
  'fortress-xiangqi': fortressXiangqiBody,
  'duck-xiangqi': duckXiangqiBody,
  jieqi: jieqiBody,
  banqi: banqiBody,
  kriegspiel: kriegspielBody,
  'reveal-chess': revealChessBody,
  shogi: () => shogiBody(false),
  'dark-shogi': () => shogiBody(true),
  crazyhouse: crazyhouseBody,
  'dark-crazyhouse': crazyhouseBody,
  jungle: () => jungleBody(),
  'jungle-flip': () => jungleFlipBody(),
};

export const VARIANT_MINIS: readonly VariantMiniDef[] = [
  {
    id: 'chess',
    label: 'Chess',
    shortLabel: 'CH',
    accent: '#6b7280',
    blurb: 'The classic start: a back rank under a rank of pawns, nothing hidden.',
    family: 'chess',
  },
  {
    id: 'dark-chess',
    label: 'Fog Chess',
    shortLabel: 'DC',
    accent: '#1f6f5b',
    blurb: 'Four pawns over a back rank; the enemy half all fog.',
    family: 'chess',
  },
  {
    id: 'draft960',
    label: 'Dark Draft960',
    shortLabel: '960',
    accent: '#8a5a18',
    blurb: "White's back rank shuffled, the enemy half all fog.",
    family: 'chess',
  },
  {
    id: 'xiangqi',
    label: 'Xiangqi',
    shortLabel: 'XQ',
    accent: '#8b5a24',
    blurb: "Red's court and cannon across the river board, nothing hidden.",
    family: 'xiangqi',
  },
  {
    id: 'dark-xiangqi',
    label: 'Fog Xiangqi',
    shortLabel: 'DX',
    accent: '#9f342d',
    blurb: "Red's court and cannon; fog marks the squares no red piece can reach.",
    family: 'xiangqi',
  },
  {
    id: 'mini-xiangqi',
    label: 'Mini Xiangqi',
    shortLabel: 'MX',
    accent: '#a16207',
    blurb: 'The small-board opening: general by its palace, cannon, and chariot.',
    family: 'xiangqi',
  },
  {
    id: 'dark-mini-xiangqi',
    label: 'Dark Mini Xiangqi',
    shortLabel: 'DMX',
    accent: '#c2410c',
    blurb: 'A real-opening cut: general by its palace, cannon, and chariot.',
    family: 'xiangqi',
  },
  {
    id: 'drop-mini-xiangqi',
    label: 'Drop Mini Xiangqi',
    shortLabel: 'DRP',
    accent: '#0f766e',
    blurb: 'Mini Xiangqi with captured pieces waiting in a reserve tray.',
    family: 'xiangqi',
  },
  {
    id: 'fortress-xiangqi',
    label: 'Fortress Xiangqi',
    shortLabel: 'STF',
    accent: '#b45309',
    blurb: 'Xiangqi with a pocket: opposite-corner palaces, crazyhouse drops, and the Treasure.',
    family: 'xiangqi',
  },
  {
    id: 'duck-xiangqi',
    label: 'Duck Xiangqi',
    shortLabel: 'DKX',
    accent: '#b8860b',
    blurb:
      'Xiangqi with a shared duck that both players move, blocking and screening for either side.',
    family: 'xiangqi',
  },
  {
    id: 'jieqi',
    label: 'Banqi',
    shortLabel: 'JQ',
    accent: '#6d4aa0',
    blurb: 'The xiangqi opening with every piece flipped face-down but the general.',
    family: 'xiangqi',
  },
  {
    id: 'banqi',
    label: 'Jieqi',
    shortLabel: 'BQ',
    accent: '#2563a6',
    blurb: 'Face-down pieces in cells; both generals flipped up.',
    family: 'xiangqi',
  },
  {
    id: 'kriegspiel',
    label: 'Kriegspiel',
    shortLabel: 'KS',
    accent: '#566273',
    blurb: 'Blind chess: only your own army, alone on the board.',
    family: 'chess',
  },
  {
    id: 'reveal-chess',
    label: 'Reveal Chess',
    shortLabel: 'RV',
    accent: '#9b3f74',
    blurb: 'Chess with hidden identities: every piece face-down but the king.',
    family: 'chess',
  },
  {
    id: 'shogi',
    label: 'Shogi',
    shortLabel: 'SG',
    accent: '#a06a2c',
    blurb: 'Japanese chess: wedge koma, drops from hand, promotion in the far zone.',
    family: 'shogi',
  },
  {
    id: 'dark-shogi',
    label: 'Fog Shogi',
    shortLabel: 'DS',
    accent: '#7d5320',
    blurb: 'Shogi played blind: your own koma and their reach, the rest in fog.',
    family: 'shogi',
  },
  {
    id: 'crazyhouse',
    label: 'Crazyhouse',
    shortLabel: 'ZH',
    accent: '#b0533a',
    blurb: 'Chess with drops: captured pieces wait in hand, ready to parachute back in.',
    family: 'chess',
  },
  {
    id: 'dark-crazyhouse',
    label: 'Dark Crazyhouse',
    shortLabel: 'DCZ',
    accent: '#884230',
    blurb: 'Dark Crazyhouse uses the Crazyhouse drop marker while the variant art settles.',
    family: 'chess',
  },
  {
    id: 'jungle',
    label: 'Jungle Chess',
    shortLabel: 'JG',
    accent: '#2e7d4a',
    blurb: 'Animal ranks across the river board: the rat swims and beats the elephant.',
    family: 'jungle',
  },
  {
    id: 'jungle-flip',
    label: 'Flip Jungle',
    shortLabel: 'FJ',
    accent: '#1f7a5e',
    blurb: 'Animals shuffled face-down on a 4x4 grid; flip to reveal, equal ranks trade.',
    family: 'jungle',
  },
];

export function variantMiniForId(id: VariantMiniId): VariantMiniDef {
  const def = VARIANT_MINIS.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`Unknown variant mini: ${id}`);
  return def;
}

let clipSeq = 0;

export function renderVariantMiniBoard(
  id: VariantMiniId,
  opts: {
    className?: string;
    label?: string;
    size?: number;
    chessSet?: PieceSet;
    xqSet?: XiangqiPieceSet;
  } = {},
): string {
  const def = variantMiniForId(id);
  const size = opts.size ?? 96;
  const label = opts.label ?? `${def.label} board`;
  const ctx: MiniCtx = {
    chessSet: opts.chessSet ?? readStoredPieceSet(),
    xqSet: opts.xqSet ?? readStoredXiangqiPieceSet(),
  };
  // First render in a browser wires the listeners that rebuild markers on a
  // piece-set change (board/fog colours need no rebuild — they cascade).
  bindAppearanceListeners();
  clipSeq += 1;
  const clipId = `mini-clip-${clipSeq}`;
  const body = BODIES[id](ctx);
  const className = opts.className ? `variant-mini ${opts.className}` : 'variant-mini';
  const dataClass = opts.className ? ` data-mini-class="${escapeAttr(opts.className)}"` : '';
  return [
    `<svg class="${escapeAttr(className)}" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${escapeAttr(label)}" data-mini-id="${id}" data-mini-size="${size}" data-mini-label="${escapeAttr(label)}"${dataClass} xmlns="http://www.w3.org/2000/svg">`,
    `<defs><clipPath id="${clipId}"><rect x="${OX}" y="${OY}" width="${SIZE}" height="${SIZE}" rx="11"/></clipPath></defs>`,
    `<g clip-path="url(#${clipId})">${body}</g>`,
    `</svg>`,
  ].join('');
}

// Rebuild every mounted marker with the current piece sets. Board / xiangqi /
// fog colours follow the CSS cascade and need no rebuild; piece ART can't be
// swapped by CSS, so the SVG is re-rendered. Cheap: there are only a handful of
// markers on any page, and this only fires on an appearance change.
export function refreshVariantMiniBoards(root?: ParentNode): void {
  if (typeof document === 'undefined') return;
  const scope = root ?? document;
  for (const svg of Array.from(scope.querySelectorAll<SVGElement>('svg[data-mini-id]'))) {
    const id = svg.getAttribute('data-mini-id');
    if (!id || !VARIANT_MINIS.some((d) => d.id === id)) continue;
    const sizeAttr = Number(svg.getAttribute('data-mini-size'));
    const size = Number.isFinite(sizeAttr) && sizeAttr > 0 ? sizeAttr : undefined;
    const label = svg.getAttribute('data-mini-label') ?? undefined;
    const className = svg.getAttribute('data-mini-class') ?? undefined;
    svg.outerHTML = renderVariantMiniBoard(id as VariantMiniId, { size, label, className });
  }
}

let appearanceListenersBound = false;
function bindAppearanceListeners(): void {
  if (appearanceListenersBound) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  appearanceListenersBound = true;
  const refresh = (): void => {
    refreshVariantMiniBoards();
  };
  window.addEventListener(boardAppearanceChangedEvent, refresh);
  window.addEventListener(xiangqiAppearanceChangedEvent, refresh);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
