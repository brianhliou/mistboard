// The site's boards, drawn for share cards.
//
// One renderer for every board card (position, study, rules, game): the board
// looks like the LIVE board with the site's DEFAULT piece set, not like the
// article diagrams. Live facts this mirrors, by surface:
//   xiangqi family  apps/web/src/xiangqi-board-surface.ts + app-base.css
//                   (--xq-board-bg #f5dca8, --xq-board-ink #5a3a14, 1.2px grid,
//                   margin 0.6 cell, no river label, no star points) and
//                   xiangqi-piece-sets.ts (`international`: #fef0d7 disc, 2.8
//                   ring in #c30d0d / #202427, PNG art per INTERNATIONAL_IMAGE_FRAMES;
//                   jieqi face-down = pieceBackMark; duck = gold ring + duck.png;
//                   treasure = the international treasure art).
//   banqi           apps/web/src/live-banqi-render.ts (same bg/ink, 1.5px grid,
//                   international discs, jade face-down #2f8f6b / #184a38).
//   jungle          apps/web/src/jungle-skins.ts + jungle-art.ts, the default
//                   'bare' board and 'animals' tokens.
//   fog chess       packages/board-render BROWN_PALETTE + inline cburnett pieces,
//                   via renderBoardComposition.
// Piece art is the same PNG the browser loads, embedded as a data URI from the
// web build (loadCardArt). Without the art (no dist, a missing file) a piece
// falls back to the baked traditional glyph so the card still draws.
//
// Layout rule (2026-09-12): a board card gives the board the full card height;
// caption text lives in the horizontal margin beside it, never under it.

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import {
  BROWN_PALETTE,
  boardCornerRadius,
  PIECE_SVGS,
  renderBoardComposition,
  XIANGQI_GLYPH_PATHS,
} from '@mistboard/board-render';
import {
  JUNGLE_DENS,
  JUNGLE_HEIGHT,
  JUNGLE_WIDTH,
  type JunglePieceRole,
  jungleIsWater,
  jungleSquareOf,
  jungleTrapOwner,
} from '@mistboard/game';
import type { PositionOgBoard } from './og-position.js';
import { escapeXml, OG_FONT, OG_HEIGHT, OG_WIDTH } from './og-primitives.js';

// ── Card frame ────────────────────────────────────────────────────────────────

export const CARD_PAD = 24;
/** The board's slot: full card height less the pad. */
export const CARD_BOARD_HEIGHT = OG_HEIGHT - 2 * CARD_PAD;
export const CARD_BOARD_X = 40;
/** Widest a board may run, so a wide board (banqi 8x4) still leaves a caption
 *  column beside it. */
export const CARD_BOARD_MAX_WIDTH = 720;
/** Gap between the board's right edge and the caption column. */
const CAPTION_GAP = 56;
const CAPTION_RIGHT = OG_WIDTH - 48;
export const CARD_BG = '#0f1115';

// ── Art ───────────────────────────────────────────────────────────────────────

type Ink = 'red' | 'black';

export type CardArt = ReadonlyMap<string, string>;

const XIANGQI_ROLES = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'soldier',
  'crossed-soldier',
  'treasure',
] as const;
const JUNGLE_ROLES: readonly JunglePieceRole[] = [
  'rat',
  'cat',
  'dog',
  'wolf',
  'leopard',
  'tiger',
  'lion',
  'elephant',
];

/** Every art file a card can need, keyed by its public path (no query). */
export function cardArtPaths(): string[] {
  const paths: string[] = ['piece-sets/xiangqi/animal-dobutsu/duck.png'];
  for (const ink of ['red', 'black'] as const) {
    for (const role of XIANGQI_ROLES)
      paths.push(`piece-sets/xiangqi/international/${ink}-${role}.png`);
    for (const role of JUNGLE_ROLES) paths.push(`piece-sets/jungle/dobutsu/${ink}-${role}.png`);
  }
  return paths;
}

const artByDir = new Map<string, Promise<CardArt>>();

/** The piece art from a web build, read once per static dir and kept for the
 *  process (the files are immutable per deploy). A file that cannot be read is
 *  simply absent from the map; its piece draws the glyph fallback. */
export function loadCardArt(staticDir: string): Promise<CardArt> {
  let pending = artByDir.get(staticDir);
  if (!pending) {
    pending = (async () => {
      const art = new Map<string, string>();
      await Promise.all(
        cardArtPaths().map(async (relPath) => {
          try {
            const buf = await fs.readFile(resolve(staticDir, relPath));
            art.set(relPath, `data:image/png;base64,${buf.toString('base64')}`);
          } catch {
            // absent: fallback glyph
          }
        }),
      );
      return art;
    })();
    artByDir.set(staticDir, pending);
  }
  return pending;
}

/** Forget loaded art (tests). */
export function resetCardArt(): void {
  artByDir.clear();
}

// ── Live palette ──────────────────────────────────────────────────────────────

const BOARD_BG = '#f5dca8';
const BOARD_INK = '#5a3a14';
const DISC_FACE = '#fef0d7';
const DISC_RING: Record<Ink, string> = { red: '#c30d0d', black: '#202427' };
const BACK: Record<Ink, { fill: string; stroke: string }> = {
  red: { fill: '#a95f4a', stroke: '#6f342c' },
  black: { fill: '#2f7d62', stroke: '#174536' },
};
const DUCK_RING = '#b8860b';
const JADE = { fill: '#2f8f6b', stroke: '#184a38' };
const JUNGLE = {
  land: '#e7ce96',
  water: '#8fb9c9',
  den: '#d8b06a',
  trap: '#e8d3ae',
  mark: '#8a6534',
  grid: 'rgba(91,74,50,0.55)',
  disc: '#fff2cf',
  ring: { red: '#b5322b', black: '#28323c' } as Record<Ink, string>,
};
// Mirrors TRADITIONAL in apps/web/src/xiangqi-piece-sets.ts, the glyph fallback.
const TRADITIONAL: Record<Ink, Record<string, string>> = {
  red: {
    general: '帥',
    advisor: '仕',
    elephant: '相',
    horse: '傌',
    chariot: '俥',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '將',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '砲',
    soldier: '卒',
  },
};
// INTERNATIONAL_IMAGE_FRAMES in xiangqi-piece-sets.ts: where each PNG sits in
// the piece's 100-unit box.
const FRAMES: Record<string, { x: number; y: number; w: number; h: number }> = {
  general: { x: -7, y: -7, w: 114, h: 114 },
  advisor: { x: -7, y: -7, w: 114, h: 114 },
  elephant: { x: -5, y: -5, w: 110, h: 110 },
  horse: { x: -7, y: -7, w: 114, h: 114 },
  chariot: { x: -5.5, y: -7, w: 111, h: 114 },
  cannon: { x: -11, y: -11, w: 122, h: 122 },
  soldier: { x: 0, y: 0, w: 100, h: 100 },
  'crossed-soldier': { x: 0, y: 0, w: 100, h: 100 },
  treasure: { x: -7, y: -7, w: 114, h: 114 },
};

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Live intersection boards: margin 0.6 cell (xiangqi-board.ts CELL 60 / MARGIN 36). */
const INTERSECTION_MARGIN = 0.6;
const PIECE_RATIO = 0.9;

export function intersectionLayout(files: number, ranks: number, height: number) {
  const cell = height / (ranks - 1 + 2 * INTERSECTION_MARGIN);
  const margin = INTERSECTION_MARGIN * cell;
  const width = 2 * margin + (files - 1) * cell;
  return {
    cell,
    margin,
    width,
    pieceSize: PIECE_RATIO * cell,
    px: (file: number) => margin + file * cell,
    py: (rank: number) => margin + (ranks - rank) * cell,
  };
}

/** The board's drawn size inside the slot: height-bound, then capped at the
 *  slot width for wide boards. */
export function boardSize(board: PositionOgBoard): { width: number; height: number } {
  const h = CARD_BOARD_HEIGHT;
  let aspect: number;
  switch (board.kind) {
    case 'intersection': {
      const g = intersectionLayout(board.files, board.ranks, 1000);
      aspect = g.width / 1000;
      break;
    }
    case 'grid':
      aspect = board.files / board.ranks;
      break;
    case 'jungle':
      aspect = JUNGLE_WIDTH / JUNGLE_HEIGHT;
      break;
    case 'chess':
      aspect = 1;
      break;
    default: {
      const unreachable: never = board;
      throw new Error(`card board: unhandled ${String(unreachable)}`);
    }
  }
  if (h * aspect <= CARD_BOARD_MAX_WIDTH) return { width: h * aspect, height: h };
  return { width: CARD_BOARD_MAX_WIDTH, height: CARD_BOARD_MAX_WIDTH / aspect };
}

// ── Piece primitives ──────────────────────────────────────────────────────────

function piece(cx: number, cy: number, size: number, inner: string): string {
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})">${inner}</g>`;
}

function internationalDisc(ink: Ink): string {
  return `<circle cx="50" cy="50" r="46" fill="${DISC_FACE}" stroke="${DISC_RING[ink]}" stroke-width="2.8"/>`;
}

function artImage(art: CardArt, relPath: string, role: string): string | null {
  const uri = art.get(relPath);
  if (!uri) return null;
  const f = FRAMES[role] ?? FRAMES.soldier!;
  return `<image href="${uri}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" preserveAspectRatio="xMidYMid meet"/>`;
}

function glyphInner(ink: Ink, glyph: string): string {
  const path = XIANGQI_GLYPH_PATHS[glyph];
  const inkHex = ink === 'red' ? '#b91c1c' : '#1f2937';
  const mark = path
    ? `<path d="${path}" fill="${inkHex}"/>`
    : `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="${OG_FONT}" font-size="44" font-weight="700" fill="${inkHex}">${escapeXml(glyph)}</text>`;
  return `<circle cx="50" cy="50" r="46" fill="#f3e6c4" stroke="${inkHex}" stroke-width="2.5"/><circle cx="50" cy="50" r="38" fill="none" stroke="${inkHex}" stroke-width="1.5"/>${mark}`;
}

/** A revealed xiangqi-family piece in the international set, or the
 *  traditional glyph disc when its art is not loaded. */
function xiangqiPiece(art: CardArt, ink: Ink, role: string, artRole: string): string {
  const image = artImage(art, `piece-sets/xiangqi/international/${ink}-${artRole}.png`, artRole);
  if (image) return `${internationalDisc(ink)}${image}`;
  return glyphInner(ink, TRADITIONAL[ink][role] ?? (role === 'treasure' ? '寶' : '?'));
}

/** pieceBackMark: a jieqi face-down piece (ink public, role hidden). */
function backInner(ink: Ink): string {
  const b = BACK[ink];
  return `<circle cx="50" cy="50" r="43" fill="${b.fill}" stroke="${b.stroke}" stroke-width="3"/>`;
}

function duckInner(art: CardArt): string {
  const uri = art.get('piece-sets/xiangqi/animal-dobutsu/duck.png');
  const image = uri
    ? `<image href="${uri}" x="8" y="8" width="84" height="84" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="${OG_FONT}" font-size="30" font-weight="700" fill="${DUCK_RING}">DUCK</text>`;
  return `<circle cx="50" cy="50" r="46" fill="${DISC_FACE}" stroke="${DUCK_RING}" stroke-width="2.8"/>${image}`;
}

/** Live drop shadow under the pieces (live-xiangqi.css .xq-piece). A filter,
 *  not CSS, so resvg draws it. */
function shadowDefs(id: string): string {
  return `<defs><filter id="${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#231b12" flood-opacity="0.25"/></filter></defs>`;
}

// ── Boards ────────────────────────────────────────────────────────────────────

function hasCrossedRiver(ink: Ink, rank: number, ranks: number): boolean {
  // Standard 9x10: red crosses at rank 6, black at rank 5. Fortress soldiers are
  // veterans from move one (xiangqi-crossed-soldier.ts drawsFortressCrossedSoldier).
  if (ranks !== 10) return true;
  return ink === 'red' ? rank >= 6 : rank <= 5;
}

function renderIntersection(
  board: Extract<PositionOgBoard, { kind: 'intersection' }>,
  art: CardArt,
  height: number,
  id: string,
): string {
  const g = intersectionLayout(board.files, board.ranks, height);
  const { cell, width } = g;
  const parts: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" rx="${boardCornerRadius(width)}" fill="${BOARD_BG}"/>`,
    shadowDefs(id),
  ];
  const lw = Math.max(1, cell / 50);
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${BOARD_INK}" stroke-width="${lw}" stroke-linecap="round"/>`;
  // Ranks: every rank line full width.
  for (let rank = 1; rank <= board.ranks; rank += 1) {
    parts.push(line(g.px(0), g.py(rank), g.px(board.files - 1), g.py(rank)));
  }
  // Files: the edge files run the whole height; interior files stop at the river.
  const river = board.riverBetweenRanks;
  for (let file = 0; file < board.files; file += 1) {
    const edge = file === 0 || file === board.files - 1;
    if (edge || !river) {
      parts.push(line(g.px(file), g.py(board.ranks), g.px(file), g.py(1)));
    } else {
      parts.push(line(g.px(file), g.py(river[0]), g.px(file), g.py(1)));
      parts.push(line(g.px(file), g.py(board.ranks), g.px(file), g.py(river[1])));
    }
  }
  for (const p of board.palaces) {
    parts.push(line(g.px(p.fileLo), g.py(p.rankLo), g.px(p.fileHi), g.py(p.rankHi)));
    parts.push(line(g.px(p.fileHi), g.py(p.rankLo), g.px(p.fileLo), g.py(p.rankHi)));
  }
  // Fog wash (a rules card's one-seat view): the same dark-wood wash the live
  // fog board uses, on each hidden point. Pieces there were filtered out by the
  // caller, so the wash hides nothing; it only says "unseen".
  for (const at of board.fog ?? []) {
    parts.push(
      `<rect x="${g.px(at.file) - cell / 2}" y="${g.py(at.rank) - cell / 2}" width="${cell}" height="${cell}" fill="rgba(58,40,16,0.42)"/>`,
    );
  }
  parts.push(`<g filter="url(#${id})">`);
  for (const pc of board.pieces) {
    const artRole =
      pc.role === 'soldier' && hasCrossedRiver(pc.color, pc.rank, board.ranks)
        ? 'crossed-soldier'
        : pc.role;
    parts.push(
      piece(
        g.px(pc.file),
        g.py(pc.rank),
        g.pieceSize,
        xiangqiPiece(art, pc.color, pc.role, artRole),
      ),
    );
  }
  for (const extra of board.extras) {
    const cx = g.px(extra.file);
    const cy = g.py(extra.rank);
    if (extra.kind === 'face-down') parts.push(piece(cx, cy, g.pieceSize, backInner(extra.ink)));
    else if (extra.kind === 'duck') parts.push(piece(cx, cy, g.pieceSize, duckInner(art)));
    else
      parts.push(piece(cx, cy, g.pieceSize, xiangqiPiece(art, extra.ink, 'treasure', 'treasure')));
  }
  parts.push('</g>');
  return parts.join('');
}

/** Banqi (8x4) and Flip Jungle (4x4) grids. Banqi is the xiangqi surface with
 *  international discs; flip jungle is the bare jungle board with animal tokens.
 *  Both use the jade face-down disc. Which look applies is decided by the tile
 *  marks: glyph marks are banqi, text marks are flip jungle. */
function renderGrid(
  board: Extract<PositionOgBoard, { kind: 'grid' }>,
  art: CardArt,
  width: number,
  height: number,
  id: string,
): string {
  const cell = width / board.files;
  const jungle = board.tiles.some((t) => !t.hidden && t.mark.kind === 'text');
  const bg = jungle ? JUNGLE.land : BOARD_BG;
  const gridInk = jungle ? JUNGLE.grid : BOARD_INK;
  const parts: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" rx="${boardCornerRadius(width)}" fill="${bg}"/>`,
    shadowDefs(id),
  ];
  const lw = jungle ? 1 : Math.max(1, cell / 40);
  for (let f = 1; f < board.files; f += 1) {
    parts.push(
      `<line x1="${f * cell}" y1="0" x2="${f * cell}" y2="${height}" stroke="${gridInk}" stroke-width="${lw}"/>`,
    );
  }
  for (let r = 1; r < board.ranks; r += 1) {
    parts.push(
      `<line x1="0" y1="${r * cell}" x2="${width}" y2="${r * cell}" stroke="${gridInk}" stroke-width="${lw}"/>`,
    );
  }
  if (!jungle) {
    parts.push(
      `<rect x="${lw / 2}" y="${lw / 2}" width="${width - lw}" height="${height - lw}" rx="${boardCornerRadius(width)}" fill="none" stroke="${gridInk}" stroke-width="${lw}"/>`,
    );
  }
  const cx = (file: number) => (file + 0.5) * cell;
  const cy = (rank: number) => (board.ranks - rank + 0.5) * cell;
  parts.push(`<g filter="url(#${id})">`);
  for (const tile of board.tiles) {
    const x = cx(tile.file);
    const y = cy(tile.rank);
    if (tile.hidden) {
      const r = jungle ? 0.374 * cell : 0.46 * PIECE_RATIO * cell;
      const sw = jungle ? 0.031 * cell : 2;
      parts.push(
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${JADE.fill}" stroke="${JADE.stroke}" stroke-width="${sw}"/>`,
      );
    } else if (tile.mark.kind === 'glyph') {
      const role = roleOfGlyph(tile.mark.glyph) ?? 'soldier';
      parts.push(piece(x, y, PIECE_RATIO * cell, xiangqiPiece(art, tile.ink, role, role)));
    } else {
      parts.push(jungleToken(art, x, y, 0.87 * cell, tile.ink, roleOfJungleName(tile.mark.text)));
    }
  }
  parts.push('</g>');
  return parts.join('');
}

function roleOfGlyph(glyph: string): string | null {
  for (const ink of ['red', 'black'] as const) {
    for (const [role, g] of Object.entries(TRADITIONAL[ink])) if (g === glyph) return role;
  }
  return null;
}

function roleOfJungleName(text: string): JunglePieceRole {
  const lower = text.toLowerCase() as JunglePieceRole;
  return JUNGLE_ROLES.includes(lower) ? lower : 'rat';
}

function jungleToken(
  art: CardArt,
  cx: number,
  cy: number,
  size: number,
  ink: Ink,
  role: JunglePieceRole,
): string {
  const uri = art.get(`piece-sets/jungle/dobutsu/${ink}-${role}.png`);
  const inner = uri
    ? `<image href="${uri}" x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${OG_FONT}" font-size="${size * 0.3}" font-weight="700" fill="${JUNGLE.ring[ink]}">${escapeXml(role[0]!.toUpperCase() + role.slice(1))}</text>`;
  return [
    `<circle cx="${cx}" cy="${cy}" r="${0.485 * size}" fill="${JUNGLE.disc}"/>`,
    inner,
    `<circle cx="${cx}" cy="${cy}" r="${0.45 * size}" fill="none" stroke="${JUNGLE.ring[ink]}" stroke-width="${0.032 * size}"/>`,
  ].join('');
}

// Lucide House and Crosshair (jungle-skins.ts draws the den and the trap with
// them); node data copied so the server does not depend on the web's lucide.
const HOUSE = `<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`;
const CROSSHAIR = `<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>`;

function lucide(body: string, cx: number, cy: number, size: number, opacity?: number): string {
  const soft = opacity === undefined ? '' : ` opacity="${opacity}"`;
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 24})"${soft} fill="none" stroke="${JUNGLE.mark}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}

function renderJungle(
  board: Extract<PositionOgBoard, { kind: 'jungle' }>,
  art: CardArt,
  height: number,
  id: string,
): string {
  const cell = height / JUNGLE_HEIGHT;
  const width = JUNGLE_WIDTH * cell;
  const parts: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" rx="${boardCornerRadius(width)}" fill="${JUNGLE.land}"/>`,
    shadowDefs(id),
  ];
  const left = (file: number) => file * cell;
  const top = (rank: number) => (JUNGLE_HEIGHT - rank) * cell;
  for (let rank = 1; rank <= JUNGLE_HEIGHT; rank += 1) {
    for (let file = 0; file < JUNGLE_WIDTH; file += 1) {
      const square = jungleSquareOf(file, rank);
      const x = left(file);
      const y = top(rank);
      if (jungleIsWater(square)) {
        parts.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${JUNGLE.water}"/>`,
        );
      } else if (JUNGLE_DENS.red === square || JUNGLE_DENS.black === square) {
        parts.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${JUNGLE.den}"/>`,
        );
        parts.push(lucide(HOUSE, x + cell / 2, y + cell / 2, cell * 0.52));
      } else if (jungleTrapOwner(square)) {
        parts.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${JUNGLE.trap}"/>`,
        );
        parts.push(lucide(CROSSHAIR, x + cell / 2, y + cell / 2, cell * 0.5, 0.75));
      }
    }
  }
  for (let f = 1; f < JUNGLE_WIDTH; f += 1) {
    parts.push(
      `<line x1="${f * cell}" y1="0" x2="${f * cell}" y2="${height}" stroke="${JUNGLE.grid}" stroke-width="1"/>`,
    );
  }
  for (let r = 1; r < JUNGLE_HEIGHT; r += 1) {
    parts.push(
      `<line x1="0" y1="${r * cell}" x2="${width}" y2="${r * cell}" stroke="${JUNGLE.grid}" stroke-width="1"/>`,
    );
  }
  parts.push(`<g filter="url(#${id})">`);
  for (const pc of board.pieces) {
    parts.push(
      jungleToken(
        art,
        left(pc.file) + cell / 2,
        top(pc.rank) + cell / 2,
        0.86 * cell,
        pc.ink,
        pc.role,
      ),
    );
  }
  parts.push('</g>');
  return parts.join('');
}

// ── The card ──────────────────────────────────────────────────────────────────

export type CardPlayer = {
  name: string;
  /** The seat's ink: red/black on the xiangqi family and jungle, white/black
   *  on the chess board. */
  ink: Ink | 'white';
  /** The seat's score: "1", "0", "½". Absent on a card with no result. */
  score?: string;
};

export type CardCaption = {
  /** The headline for a card without players (the variant, a rules title, a
   *  study name), one entry per line. Ignored when `players` is set. */
  title?: string[];
  /** Muted line under the title (the side to move), or under the variant on
   *  a game card. */
  subtitle?: string;
  /** A game's two seats. `top` is the side whose pieces start at the top of the
   *  board as drawn (black ink), `bottom` the side at the bottom (red ink): the
   *  names sit level with the board's back ranks, each behind a disc in its
   *  ink, so "which side was I" is read off the board, not decoded. */
  players?: {
    top: CardPlayer;
    bottom: CardPlayer;
    variant: string;
  };
};

/** Noto Sans Bold, roughly: Latin ~0.56 em, CJK a full em. */
function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) em += /[　-鿿＀-￯]/.test(ch) ? 1 : 0.56;
  return em * size;
}

function fit(text: string, base: number, min: number, maxWidth: number): number {
  const w = textWidth(text, base);
  return w <= maxWidth ? base : Math.max(min, Math.floor(base * (maxWidth / w)));
}

/** Break a headline into at most two lines when it is too wide for the column
 *  at its base size, so a long engine name keeps its size rather than shrinking
 *  to a whisper. The break is the most BALANCED one whose lines both fit (or,
 *  failing that, the most balanced one), never the longest first line: that
 *  orphans a trailing "4" under "Fairy-Stockfish Level". */
function breakLine(text: string, size: number, maxWidth: number): string[] {
  if (textWidth(text, size) <= maxWidth) return [text];
  const words = text.split(' ');
  if (words.length < 2) return [text];
  let best: { lines: string[]; score: number } | null = null;
  for (let i = 1; i < words.length; i += 1) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const widths = lines.map((line) => textWidth(line, size));
    const fits = widths.every((w) => w <= maxWidth);
    const score = (fits ? 0 : 1e6) + Math.abs(widths[0]! - widths[1]!);
    if (!best || score < best.score) best = { lines, score };
  }
  return best?.lines ?? [text];
}

function brandLine(x: number, y: number): string {
  return `<text x="${x}" y="${y}" fill="#8b9289" font-family="${OG_FONT}" font-size="30" font-weight="600" letter-spacing="1">mistboard.com</text>`;
}

function isJungleGrid(board: Extract<PositionOgBoard, { kind: 'grid' }>): boolean {
  return board.tiles.some((t) => !t.hidden && t.mark.kind === 'text');
}

// The caption's type scale, fixed so every game card reads the same: a name
// never grows to fill a column or shrinks to fit one (it wraps first), and the
// variant and brand keep their ratio to it.
const NAME_SIZE = 40;
const NAME_MIN = 30;
const SCORE_SIZE = 40;
const TOKEN_SIZE = 56;
const VARIANT_SIZE = 38;

/** The seat's king piece, drawn the way the board draws it: the general on
 *  the xiangqi family, the lion on the jungle boards, the cburnett king on the
 *  chess board (white or black ink means chess). */
function seatToken(
  art: CardArt,
  ink: CardPlayer['ink'],
  cx: number,
  cy: number,
  jungle: boolean,
): string {
  if (ink === 'white') return chessKing('white', cx, cy);
  if (jungle) return jungleToken(art, cx, cy, TOKEN_SIZE, ink, 'lion');
  return piece(cx, cy, TOKEN_SIZE, xiangqiPiece(art, ink, 'general', 'general'));
}

function chessKing(color: 'white' | 'black', cx: number, cy: number): string {
  const svg = PIECE_SVGS[`${color}:king`] ?? '';
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const scale = TOKEN_SIZE / 45;
  return `<g transform="translate(${cx - TOKEN_SIZE / 2} ${cy - TOKEN_SIZE / 2}) scale(${scale})">${inner}</g>`;
}

/** A game card's column: one row per seat, level with that seat's back rank
 *  (black at the board's top, red at its bottom) behind that seat's own king
 *  piece (the general, or the jungle lion) with its score at the row's right
 *  edge, so the side and the result are read off the pieces; the variant and
 *  the brand centred between the rows (the termination stays in the page
 *  description: a score is a result, a clause is a caption). Chosen over a
 *  scoreboard stacked at the top (2026-09-12): the vertical position is itself
 *  the "which side" cue, and the column stays filled. */
function playerRows(
  players: NonNullable<CardCaption['players']>,
  art: CardArt,
  x: number,
  width: number,
  boardY: number,
  boardHeight: number,
  jungleInk: boolean,
  chess: boolean,
): string[] {
  const gap = 16;
  const nameX = x + TOKEN_SIZE + gap;
  const hasScore = Boolean(players.top.score || players.bottom.score);
  const scoreW = hasScore ? SCORE_SIZE * 0.7 + 24 : 0;
  const nameW = width - (nameX - x) - scoreW;
  // A long name (an engine's) wraps before it shrinks; only a single word too
  // wide for the column shrinks, and never below NAME_MIN.
  const lines = (name: string) => breakLine(name, NAME_SIZE, nameW);
  const topLines = lines(players.top.name);
  const bottomLines = lines(players.bottom.name);
  const size = Math.min(
    ...[...topLines, ...bottomLines].map((line) => fit(line, NAME_SIZE, NAME_MIN, nameW)),
  );
  const lineGap = size * 1.12;
  const row = (player: CardPlayer, nameLines: string[], firstBaseline: number) => {
    const cx = x + TOKEN_SIZE / 2;
    const cy = firstBaseline - size * 0.36;
    const token = chess
      ? chessKing(player.ink === 'white' ? 'white' : 'black', cx, cy)
      : seatToken(art, player.ink, cx, cy, jungleInk);
    const score = player.score
      ? `<text x="${x + width}" y="${firstBaseline}" text-anchor="end" fill="#e5e9df" font-family="${OG_FONT}" font-size="${SCORE_SIZE}" font-weight="700">${escapeXml(player.score)}</text>`
      : '';
    return [
      token,
      ...nameLines.map(
        (line, index) =>
          `<text x="${nameX}" y="${firstBaseline + index * lineGap}" fill="#f3f4f6" font-family="${OG_FONT}" font-size="${size}" font-weight="700">${escapeXml(line)}</text>`,
      ),
      score,
    ].join('');
  };

  const topY = boardY + 8 + size;
  const bottomY = boardY + boardHeight - 10 - (bottomLines.length - 1) * lineGap;
  const midY = (topY + (topLines.length - 1) * lineGap + bottomY) / 2;
  const variantY = midY - 6;
  return [
    row(players.top, topLines, topY),
    `<text x="${x}" y="${variantY}" fill="#c9cfc3" font-family="${OG_FONT}" font-size="${VARIANT_SIZE}" font-weight="600">${escapeXml(players.variant)}</text>`,
    brandLine(x, variantY + VARIANT_SIZE * 1.3),
    row(players.bottom, bottomLines, bottomY),
  ];
}

/**
 * A finished board card: the board at full height on the left, the caption in
 * the column beside it, the brand at the column's foot. `board` is the public
 * projection og-position.ts resolves; `art` is loadCardArt's map (or an empty
 * map for the glyph fallback).
 */
export function renderBoardCard(
  board: PositionOgBoard,
  art: CardArt,
  caption: CardCaption,
): string {
  const { width, height } = boardSize(board);
  const boardX = CARD_BOARD_X;
  const boardY = CARD_PAD + (CARD_BOARD_HEIGHT - height) / 2;
  const id = 'card-shadow';
  let inner: string;
  switch (board.kind) {
    case 'intersection':
      inner = renderIntersection(board, art, height, id);
      break;
    case 'grid':
      inner = renderGrid(board, art, width, height, id);
      break;
    case 'jungle':
      inner = renderJungle(board, art, height, id);
      break;
    case 'chess':
      // The composition centres its board on the canvas width it is given, so a
      // canvas of exactly the board's width puts it at the origin.
      inner = renderBoardComposition({
        layout: 'single',
        canvasWidth: width,
        boardY: 0,
        boardSize: height,
        palette: BROWN_PALETTE,
        fogStyle: 'solid',
        boards: [
          {
            pieces: board.pieces,
            fogSquares: board.fogSquares ? [...board.fogSquares] : undefined,
            orientation: board.orientation ?? 'white',
          },
        ],
      });
      break;
    default: {
      const unreachable: never = board;
      throw new Error(`card board: unhandled ${String(unreachable)}`);
    }
  }
  const columnX = boardX + width + CAPTION_GAP;
  const columnW = CAPTION_RIGHT - columnX;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${CARD_BG}"/>`,
    `<svg x="${boardX}" y="${boardY}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${inner}</svg>`,
  ];

  const jungleInk = board.kind === 'jungle' || (board.kind === 'grid' && isJungleGrid(board));
  if (caption.players) {
    parts.push(
      ...playerRows(
        caption.players,
        art,
        columnX,
        columnW,
        boardY,
        height,
        jungleInk,
        board.kind === 'chess',
      ),
      `</svg>`,
    );
    return parts.join('');
  }

  // No players: the title from the column's top, the brand at its foot.
  const titleBase = 52;
  const titleLines = (caption.title ?? []).flatMap((line) => breakLine(line, titleBase, columnW));
  const titleSize = Math.min(...titleLines.map((line) => fit(line, titleBase, 30, columnW)));
  let y = boardY + 24 + titleSize;
  for (const line of titleLines) {
    parts.push(
      `<text x="${columnX}" y="${y}" fill="#f3f4f6" font-family="${OG_FONT}" font-size="${titleSize}" font-weight="700">${escapeXml(line)}</text>`,
    );
    y += titleSize * 1.18;
  }
  if (caption.subtitle) {
    y += 14;
    const size = fit(caption.subtitle, 32, 22, columnW);
    parts.push(
      `<text x="${columnX}" y="${y}" fill="#b8bfb3" font-family="${OG_FONT}" font-size="${size}" font-weight="600">${escapeXml(caption.subtitle)}</text>`,
    );
  }
  parts.push(brandLine(columnX, boardY + height - 4), `</svg>`);
  return parts.join('');
}
