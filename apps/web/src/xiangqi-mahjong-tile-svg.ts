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

const TILE_W = 44;
const TILE_H = 58;
const TILE_GAP = 6;
const GROUP_GAP = 22;
const PAD = 4;

// The live table's tile: an ivory face, a jade backing showing as a band
// along the bottom edge, a light line where the face bevels in at the top.
const FACE = '#fbf7ec';
const FACE_LOW = '#efe7d2';
const EDGE = '#ded3b8';
const JADE = '#2f8a70';
const JADE_LOW = '#22684f';
const DEPTH = 5;
const CLAIM = '#2f6fb3';
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

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tileSvg(
  tile: XmjTile,
  x: number,
  y: number,
  claimed: boolean,
  pieceSet: XiangqiPieceSet,
): string {
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
    `<text x="${x + TILE_W / 2}" y="${y + TILE_H + DEPTH + 15}" text-anchor="middle" font-size="10.5" fill="currentColor">${escapeText(name)}</text>`,
  ].join('');
}

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

function wrapSvg(width: number, height: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="xmj-article-tiles" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeText(title)}" style="max-width:min(100%,${Math.round(width * 1.15)}px);margin:0 auto"><title>${escapeText(title)}</title>${body}</svg>`;
}

/**
 * A row of tile groups. `title` is the accessible name. The figure keeps its
 * drawn size on wide screens and shrinks to fit a phone.
 */
export function xmjTileRowSvg(
  groups: readonly XmjTileGroup[],
  title: string,
  pieceSet: XiangqiPieceSet = 'international',
): string {
  const { parts, end } = groupsLine(groups, PAD, PAD, pieceSet);
  return wrapSvg(end + PAD, PAD + lineHeight(groups), title, parts.join(''));
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
