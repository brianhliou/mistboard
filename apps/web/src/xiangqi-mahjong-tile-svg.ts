// Tile pictures for the Xiangqi Mahjong rules page (/rules/xiangqi-mahjong-32):
// a row of ivory tiles on a jade backing (the live table's look,
// xiangqi-mahjong.css), each carrying a xiangqi piece's figure or character in
// the reader's piece set (no disc: the tile is the frame; a third-party set
// lays its disc's surface over the face instead of ivory), the
// English piece name under each tile, and a bracket naming each group (set,
// pair).

import {
  tileColor,
  tilePiece,
  type XiangqiPieceRole,
  XMJ_PIECE_NAMES,
  type XmjPiece,
  type XmjTile,
} from '@mistboard/game';
import {
  renderXiangqiPieceMark,
  type XiangqiPieceSet,
  xiangqiTileBacking,
  xiangqiTileFaceHref,
} from './xiangqi-piece-sets.js';

export const XMJ_TILE_W = 44;
export const XMJ_TILE_H = 58;
export const XMJ_TILE_GAP = 6;
const TILE_W = XMJ_TILE_W;
const TILE_H = XMJ_TILE_H;
const TILE_GAP = XMJ_TILE_GAP;
const GROUP_GAP = 22;
const PAD = 4;

// The live table's tile: an ivory face, a jade backing showing as a band
// along the bottom edge, a light line where the face bevels in at the top.
const FACE = '#fbf7ec';
const FACE_LOW = '#efe7d2';
const EDGE = '#ded3b8';
const JADE = '#2f8a70';
const JADE_LOW = '#22684f';
export const XMJ_TILE_DEPTH = 5;
const DEPTH = XMJ_TILE_DEPTH;
export const XMJ_CLAIM_EDGE = '#2f6fb3';
const CLAIM = XMJ_CLAIM_EDGE;
const JADE_HIGH = '#45a587';
// The piece's box is a little wider than the tile; the figure or character
// inside it sits well within the tile.
const PIECE_SIZE = 52;

const XMJ_ROLES: Readonly<Record<XmjPiece, XiangqiPieceRole>> = {
  K: 'general',
  A: 'advisor',
  E: 'elephant',
  R: 'chariot',
  H: 'horse',
  C: 'cannon',
  P: 'soldier',
};

export interface XmjTileGroup {
  readonly tiles: readonly XmjTile[];
  /** Under the bracket: "set", "pair", "sequence", ... Omitted: no bracket. */
  readonly label?: string;
  /** A set laid face up after a claim. The claimed tile gets a blue edge. */
  readonly claimed?: XmjTile;
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One tile with its top-left at (x, y). `name` writes the English piece name
 * under it (the default); a figure that labels each kind once turns it off.
 */
export function xmjTileSvg(
  tile: XmjTile,
  x: number,
  y: number,
  pieceSet: XiangqiPieceSet,
  opts: { claimed?: boolean; name?: boolean } = {},
): string {
  const claimed = opts.claimed ?? false;
  const color = tileColor(tile) === 'r' ? 'red' : 'black';
  const piece = renderXiangqiPieceMark({ color, role: XMJ_ROLES[tilePiece(tile)] }, pieceSet, {
    x: x + (TILE_W - PIECE_SIZE) / 2,
    y: y + (TILE_H - PIECE_SIZE) / 2,
    size: PIECE_SIZE,
  });
  const edge = claimed ? CLAIM : EDGE;
  const name = XMJ_PIECE_NAMES[tilePiece(tile)];
  // A third-party set's disc surface covers the whole face, as on the table.
  // Every tile at one x has the same outline in every figure, so the clip's
  // id may repeat across figures on a page. The face is drawn as a square as
  // tall as the tile and clipped, not stretched with `slice`: Chrome fits an
  // SVG image's square viewBox to the width and paints the disc's rim above
  // and below it.
  const faceHref = xiangqiTileFaceHref(pieceSet, color);
  // An asset set's tile is one block of its material; Mistboard's sit on jade.
  const [, jade, jadeLow] = xiangqiTileBacking(pieceSet) ?? [JADE, JADE, JADE_LOW];
  const clip = `xmj-face-${x}-${y}`;
  const face = faceHref
    ? `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" rx="6"/></clipPath><image href="${faceHref}" x="${x - (TILE_H - TILE_W) / 2}" y="${y}" width="${TILE_H}" height="${TILE_H}" clip-path="url(#${clip})"/><rect x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="none" stroke="${edge}" stroke-width="${claimed ? 2.5 : 1}"/>`
    : [
        `<path d="M${x + 1} ${y + TILE_H * 0.6}H${x + TILE_W - 1}V${y + TILE_H - 6}a5 5 0 0 1-5 5H${x + 6}a5 5 0 0 1-5-5Z" fill="${FACE_LOW}" fill-opacity="0.7"/>`,
        `<path d="M${x + 6} ${y + 1.5}H${x + TILE_W - 6}" stroke="#fff" stroke-opacity="0.9"/>`,
      ].join('');
  return [
    `<rect x="${x}" y="${y + DEPTH}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="${jadeLow}"/>`,
    `<rect x="${x}" y="${y + DEPTH - 1}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="${jade}"/>`,
    `<rect x="${x}" y="${y + 1}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="${EDGE}"/>`,
    `<rect x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="${FACE}" stroke="${edge}" stroke-width="${claimed ? 2.5 : 1}"/>`,
    face,
    piece,
    opts.name === false
      ? ''
      : `<text x="${x + TILE_W / 2}" y="${y + TILE_H + DEPTH + 15}" text-anchor="middle" font-size="10.5" fill="currentColor">${escapeText(name)}</text>`,
  ].join('');
}

/**
 * A tile turned over, the live table's back: jade on top, the ivory face
 * showing along the bottom edge as depth. `w`/`h` default to a full tile; the
 * wall draws them small.
 */
export function xmjTileBackSvg(x: number, y: number, w = TILE_W, h = TILE_H): string {
  const r = Math.max(2, Math.round(w * 0.14));
  const depth = Math.max(2, Math.round(h * 0.085));
  const id = `xmj-back-${w}-${h}`;
  return [
    `<linearGradient id="${id}" x1="0" y1="0" x2="0.45" y2="1"><stop offset="0" stop-color="${JADE_HIGH}"/><stop offset="0.45" stop-color="${JADE}"/><stop offset="1" stop-color="${JADE_LOW}"/></linearGradient>`,
    `<rect x="${x}" y="${y + depth}" width="${w}" height="${h}" rx="${r}" fill="${EDGE}"/>`,
    `<rect x="${x}" y="${y + depth - 1}" width="${w}" height="${h}" rx="${r}" fill="${FACE_LOW}"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${id})" stroke="${JADE_LOW}" stroke-width="1"/>`,
    w >= 20
      ? `<path d="M${x + r} ${y + 1.5}H${x + w - r}" stroke="#fff" stroke-opacity="0.3"/>`
      : '',
  ].join('');
}

const tileSvg = (
  tile: XmjTile,
  x: number,
  y: number,
  claimed: boolean,
  pieceSet: XiangqiPieceSet,
): string => xmjTileSvg(tile, x, y, pieceSet, { claimed });

/** One line of groups at `y`, starting at `x0`: its parts and right edge. */
function groupsLine(
  groups: readonly XmjTileGroup[],
  x0: number,
  y: number,
  pieceSet: XiangqiPieceSet,
): { parts: string[]; end: number } {
  let x = x0;
  const parts: string[] = [];
  groups.forEach((group, gi) => {
    if (gi > 0) x += GROUP_GAP - TILE_GAP;
    const start = x;
    let claimedDrawn = false;
    for (const tile of group.tiles) {
      const isClaimed = !claimedDrawn && group.claimed === tile;
      if (isClaimed) claimedDrawn = true;
      parts.push(tileSvg(tile, x, y, isClaimed, pieceSet));
      x += TILE_W + TILE_GAP;
    }
    const end = x - TILE_GAP;
    if (group.label) {
      const by = y + TILE_H + DEPTH + 23;
      parts.push(
        `<path d="M${start + 2} ${by - 4}V${by}H${end - 2}V${by - 4}" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1"/>`,
        `<text x="${(start + end) / 2}" y="${by + 14}" text-anchor="middle" font-size="11" font-style="italic" fill="currentColor" fill-opacity="0.75">${escapeText(group.label)}</text>`,
      );
    }
  });
  return { parts, end: x - TILE_GAP };
}

function lineHeight(groups: readonly XmjTileGroup[]): number {
  return TILE_H + DEPTH + 21 + (groups.some((g) => g.label) ? 26 : 0);
}

export function xmjTileFigureSvg(
  width: number,
  height: number,
  title: string,
  body: string,
): string {
  return wrapSvg(width, height, title, body);
}

function wrapSvg(width: number, height: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="xmj-article-tiles" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeText(title)}" style="max-width:min(100%,${Math.round(width * 1.15)}px);margin:0 auto"><title>${escapeText(title)}</title>${body}</svg>`;
}

/** A verdict mark at the left of a row: a check for a win, a cross for not. */
export type XmjRowBadge = 'win' | 'not-win';

const BADGE_R = 11;
const BADGE_W = BADGE_R * 2 + 12;

// The colours are site tokens (articles.css), so the badge follows the light
// and dark theme; the fallbacks are for a copy outside the article.
function badgeSvg(badge: XmjRowBadge, cx: number, cy: number): string {
  const win = badge === 'win';
  const label = win ? 'Winning hand' : 'Not a winning hand';
  const fill = win ? 'var(--article-mark-win,#2c7a4b)' : 'var(--article-mark-lose,#b3362b)';
  const mark = win
    ? `M${cx - 5} ${cy + 0.5}l3.6 3.6 6.6-7.4`
    : `M${cx - 4.2} ${cy - 4.2}l8.4 8.4M${cx + 4.2} ${cy - 4.2}l-8.4 8.4`;
  return `<g class="xmj-badge xmj-badge--${badge}" role="img" aria-label="${label}"><title>${label}</title><circle cx="${cx}" cy="${cy}" r="${BADGE_R}" style="fill:${fill}"/><path d="${mark}" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--article-mark-ink,#fff)"/></g>`;
}

/**
 * A row of tile groups. `title` is the accessible name. The figure keeps its
 * drawn size on wide screens and shrinks to fit a phone. `badge` puts a win
 * or not-win mark at the left of the row.
 */
export function xmjTileRowSvg(
  groups: readonly XmjTileGroup[],
  title: string,
  pieceSet: XiangqiPieceSet = 'international',
  badge?: XmjRowBadge,
): string {
  const x0 = PAD + (badge ? BADGE_W : 0);
  const { parts, end } = groupsLine(groups, x0, PAD, pieceSet);
  const mark = badge ? badgeSvg(badge, PAD + BADGE_R, PAD + TILE_H / 2) : '';
  return wrapSvg(end + PAD, PAD + lineHeight(groups), title, mark + parts.join(''));
}

/**
 * Rows of tiles, left-aligned, each row split by piece kind: a tile gap inside
 * a kind, a wider gap between kinds, and the kind's name once, centred under
 * it ("Advisor" under the two Advisors), instead of a name under every tile.
 */
export function xmjTileKindGridSvg(
  lines: readonly (readonly XmjTile[])[],
  title: string,
  pieceSet: XiangqiPieceSet = 'international',
  /** Rows after which a wider gap opens (red's block above black's). */
  breakAfter: readonly number[] = [],
): string {
  const KIND_GAP = 16;
  const ROW_H = TILE_H + DEPTH + 26;
  const BREAK = 18;
  const parts: string[] = [];
  let width = 0;
  let y = PAD;
  lines.forEach((line, row) => {
    if (row > 0) y += ROW_H + (breakAfter.includes(row - 1) ? BREAK : 0);
    let x = PAD;
    let i = 0;
    while (i < line.length) {
      const kind = line[i] as XmjTile;
      const start = x;
      while (line[i] === kind) {
        parts.push(xmjTileSvg(kind, x, y, pieceSet, { name: false }));
        x += TILE_W + TILE_GAP;
        i += 1;
      }
      const end = x - TILE_GAP;
      parts.push(
        `<text x="${(start + end) / 2}" y="${y + TILE_H + DEPTH + 16}" text-anchor="middle" font-size="11" fill="currentColor" class="xmj-kind-label">${escapeText(XMJ_PIECE_NAMES[tilePiece(kind)])}</text>`,
      );
      width = Math.max(width, end);
      x = end + KIND_GAP;
    }
  });
  return wrapSvg(width + PAD, y + ROW_H - 4, title, parts.join(''));
}

/**
 * Several rows of tile groups stacked in one figure, each row centred on the
 * widest. For a set too wide for one row at phone width: the figure is as wide
 * as its longest row, so it shrinks far less on a phone than one long row.
 */
export function xmjTileLinesSvg(
  lines: readonly (readonly XmjTileGroup[])[],
  title: string,
  pieceSet: XiangqiPieceSet = 'international',
): string {
  const widthOf = (groups: readonly XmjTileGroup[]) =>
    groups.reduce((w, g) => w + g.tiles.length * (TILE_W + TILE_GAP), 0) -
    TILE_GAP +
    (groups.length - 1) * (GROUP_GAP - TILE_GAP);
  const inner = Math.max(...lines.map(widthOf));
  const parts: string[] = [];
  let y = PAD;
  for (const groups of lines) {
    parts.push(...groupsLine(groups, PAD + (inner - widthOf(groups)) / 2, y, pieceSet).parts);
    y += lineHeight(groups);
  }
  return wrapSvg(inner + 2 * PAD, y, title, parts.join(''));
}

/** Every tile in a list of groups, in the order drawn. */
export function xmjGroupTiles(groups: readonly XmjTileGroup[]): XmjTile[] {
  return groups.flatMap((g) => [...g.tiles]);
}
