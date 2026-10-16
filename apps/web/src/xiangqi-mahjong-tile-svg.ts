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

/**
 * A row of tile groups. `title` is the accessible name. The figure keeps its
 * drawn size on wide screens and shrinks to fit a phone.
 */
export function xmjTileRowSvg(
  groups: readonly XmjTileGroup[],
  title: string,
  pieceSet: XiangqiPieceSet = 'international',
): string {
  const anyLabel = groups.some((g) => g.label);
  const height = PAD + TILE_H + DEPTH + 21 + (anyLabel ? 26 : 0);
  let x = PAD;
  const parts: string[] = [];
  groups.forEach((group, gi) => {
    if (gi > 0) x += GROUP_GAP - TILE_GAP;
    const start = x;
    let claimedDrawn = false;
    for (const tile of group.tiles) {
      const isClaimed = !claimedDrawn && group.claimed === tile;
      if (isClaimed) claimedDrawn = true;
      parts.push(tileSvg(tile, x, PAD, isClaimed, pieceSet));
      x += TILE_W + TILE_GAP;
    }
    const end = x - TILE_GAP;
    if (group.label) {
      const by = PAD + TILE_H + DEPTH + 23;
      parts.push(
        `<path d="M${start + 2} ${by - 4}V${by}H${end - 2}V${by - 4}" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1"/>`,
        `<text x="${(start + end) / 2}" y="${by + 14}" text-anchor="middle" font-size="11" font-style="italic" fill="currentColor" fill-opacity="0.75">${escapeText(group.label)}</text>`,
      );
    }
  });
  const width = x - TILE_GAP + PAD;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="xmj-article-tiles" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeText(title)}" style="max-width:min(100%,${Math.round(width * 1.15)}px);margin:0 auto"><title>${escapeText(title)}</title>${parts.join('')}</svg>`;
}

/** Every tile in a list of groups, in the order drawn. */
export function xmjGroupTiles(groups: readonly XmjTileGroup[]): XmjTile[] {
  return groups.flatMap((g) => [...g.tiles]);
}
