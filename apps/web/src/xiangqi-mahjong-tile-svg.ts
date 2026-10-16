// Tile pictures for the Xiangqi Mahjong rules page (/rules/xiangqi-mahjong-32):
// a row of bone tiles, each carrying a xiangqi piece's figure or character in
// the reader's piece set (no disc: the tile is the frame), the
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
import { renderXiangqiPieceMark, type XiangqiPieceSet } from './xiangqi-piece-sets.js';

const TILE_W = 44;
const TILE_H = 58;
const TILE_GAP = 6;
const GROUP_GAP = 22;
const PAD = 4;

const FACE = '#f7f4ea';
const EDGE = '#d9d3c2';
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
  const piece = renderXiangqiPieceMark(
    { color: tileColor(tile) === 'r' ? 'red' : 'black', role: XMJ_ROLES[tilePiece(tile)] },
    pieceSet,
    { x: x + (TILE_W - PIECE_SIZE) / 2, y: y + (TILE_H - PIECE_SIZE) / 2, size: PIECE_SIZE },
  );
  const edge = claimed ? CLAIM : EDGE;
  const name = XMJ_PIECE_NAMES[tilePiece(tile)];
  return [
    `<rect x="${x}" y="${y + 2}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="${EDGE}"/>`,
    `<rect x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="${FACE}" stroke="${edge}" stroke-width="${claimed ? 2.5 : 1}"/>`,
    piece,
    `<text x="${x + TILE_W / 2}" y="${y + TILE_H + 16}" text-anchor="middle" font-size="10.5" fill="currentColor">${escapeText(name)}</text>`,
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
  const height = PAD + TILE_H + 22 + (anyLabel ? 26 : 0);
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
      const by = PAD + TILE_H + 24;
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
