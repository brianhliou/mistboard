// 3D pieces: a disc seen a little from above, with a band of its body (the
// rim) showing along the bottom edge, as the Xiangqi Mahjong tiles show theirs
// (xiangqi-mahjong-tile-svg.ts). Banqi draws its tiles this way by default
// (live-banqi-render.ts), and since 2026-10-28 every board with a turn-over or a
// disc piece does (Brian: "ship 3D as the default for all variants"). The Pieces
// menu's "3D pieces" switch turns it off (piece3dEnabled); a caller's `tile3d`
// overrides the setting.
//
// A piece is one object, so its rim is one colour face up and face down,
// before, during and after a turn-over: ivory on Mistboard's sets, an asset
// set's own material on its. The turn-over carries the rim with the face and,
// edge-on, shows the piece's thickness (flipSvgPiece's `edge`) instead of a
// hairline. Vector only, no idle motion.
//
// The disc and rim together are centred on the piece's anchor (a cell centre
// or a point): the disc is raised by half the rim. How much of the pitch they
// span and how thick the rim is are per board (Piece3dSpec), because a banqi
// tile has room to grow past its flat size and a xiangqi piece has none.

import type { XiangqiPiece } from '@mistboard/game';
import type { PieceFlipEdge } from './board-anim.js';
import type { BoardLastMovePiece } from './board-lastmove.js';
import {
  roundPieceBox,
  XIANGQI_PIECE_OUTLINE_SHARE,
  XIANGQI_PIECE_REACH,
} from './board-metrics.js';
import {
  renderXiangqiPieceGlyphed,
  XIANGQI_PIECE_SHADOW,
  type XiangqiPieceRenderOptions,
  type XiangqiPieceSet,
  type XiangqiPieceShape,
  xiangqiPieceRingWidth,
  xiangqiPieceSetShape,
  xiangqiPieceShadowEnabled,
  xiangqiPieceShadowMarks,
  xiangqiTileBacking,
} from './xiangqi-piece-sets.js';

/** Whether boards draw 3D pieces: off unless the reader switched it on (the
 *  root's data-banqi-tile3d, stamped by theme.ts from the one stored setting). */
export function piece3dEnabled(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.banqiTile3d === 'on';
}

/** How a board sizes its 3D pieces. */
export interface Piece3dSpec {
  /** Share of the pitch (cell, or gap between points) the disc and rim span. */
  readonly reach: number;
  /** Rim thickness as a share of the piece box. */
  readonly depthShare: number;
}

/**
 * Banqi tiles: a flat banqi disc spans BANQI_PIECE_REACH (0.92), so the tile
 * grows to 0.95 and its disc comes out about 5% narrower than the flat one,
 * with a rim of about 5 px at the 64 cell.
 */
export const BANQI_PIECE_3D: Piece3dSpec = { reach: 0.95, depthShare: 0.085 };

/**
 * Xiangqi and jieqi pieces: a flat piece already spans XIANGQI_PIECE_REACH
 * (0.98) of the point gap, so the 3D piece keeps that footprint and the rim
 * comes out of the disc. A rim near banqi's (0.045 read as no rim at phone
 * size, about 1.5 CSS px) makes the disc about 8% narrower than flat: about
 * 4.6 px of rim at xiangqi's 60, 5.5 at jieqi's 72.
 */
export const XIANGQI_PIECE_3D: Piece3dSpec = { reach: XIANGQI_PIECE_REACH, depthShare: 0.08 };

/** How much deeper the Thicker edge is (the reader's Pieces pick). */
export const PIECE_3D_THICK_EDGE = 1.5;

/** Whether the reader picked the Thicker edge: the root's data-piece-edge,
 *  stamped by theme.ts from the stored setting (Brian, 2026-10-29: both depths
 *  "look decent", so both ship, Standard by default). */
export function piece3dThickEdge(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.pieceEdge === 'thick';
}

/**
 * The rim's share of the box for this reader. The footprint holds either way,
 * so the Thicker edge takes its extra depth out of the face (about 4% narrower).
 */
export function piece3dDepthShare(spec: { readonly depthShare: number }): number {
  return piece3dThickEdge() ? spec.depthShare * PIECE_3D_THICK_EDGE : spec.depthShare;
}

/** The body (rim and wall) on Mistboard's own sets. */
export const PIECE_3D_IVORY: readonly [string, string] = ['#efe7d2', '#d6c9a8'];

/**
 * How far the disc shadow reaches past the rim's bottom, as a share of the
 * box: its drop plus its widest ring (XIANGQI_PIECE_SHADOW, in the 100 box).
 */
export const PIECE_3D_SHADOW_SHARE =
  (XIANGQI_PIECE_SHADOW.dy + Math.max(...XIANGQI_PIECE_SHADOW.spread)) / 100;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The box a 3D piece is drawn in at this pitch: the disc (to its outline) and
 * the rim below it together span `spec.reach` of the pitch.
 */
export function piece3dBox(pitch: number, spec: Piece3dSpec): number {
  return roundPieceBox(
    (pitch * spec.reach) / (XIANGQI_PIECE_OUTLINE_SHARE + piece3dDepthShare(spec)),
  );
}

/** The disc's centre for a piece anchored at `anchor`: raised by half the rim. */
export function piece3dDiscCenter(
  anchor: { x: number; y: number },
  box: number,
  spec: Piece3dSpec,
): { x: number; y: number } {
  return { x: anchor.x, y: round2(anchor.y - (box * piece3dDepthShare(spec)) / 2) };
}

export interface Piece3dLook {
  /** The disc's outer radius, where the rim's sides meet it. */
  radius: number;
  /** The rim's thickness. */
  depth: number;
  /** The body: the rim's face colour, then its darker lower band. */
  body: readonly [string, string];
}

export function piece3dLook(
  pieceSet: XiangqiPieceSet,
  box: number,
  spec: Piece3dSpec,
): Piece3dLook {
  const backing = xiangqiTileBacking(pieceSet);
  // Asset discs are normalised to radius 45 of the 100 box; Mistboard's faces
  // end at 47.4 (the face-down radius plus its stroke).
  const radius = round2(box * (backing ? 0.45 : 0.474));
  const depth = round2(box * piece3dDepthShare(spec));
  const body: readonly [string, string] = backing ? [backing[1], backing[2]] : PIECE_3D_IVORY;
  return { radius, depth, body };
}

/** A 3D piece's face-down outline width in a box of `box`: the face-up ring's,
 *  so the outline keeps its weight when the piece turns over (Brian,
 *  2026-10-29: the unflipped ones "look a little thicker"). The rim itself
 *  carries no line: outlined too, the whole piece "looks too heavy". */
export function piece3dLineWidth(pieceSet: XiangqiPieceSet, box: number): number {
  return round2((box * xiangqiPieceRingWidth(pieceSet)) / 100);
}

// The part of the side wall below the disc: straight sides from the disc's
// middle down `k`, closed by the bottom half of a disc there.
function bandPath(cx: number, cy: number, r: number, k: number): string {
  return `M${round2(cx - r)} ${cy}V${round2(cy + k)}A${r} ${r} 0 0 0 ${round2(cx + r)} ${round2(cy + k)}V${cy}Z`;
}

/**
 * The rim under one piece whose disc is centred at (cx, cy), drawn before its
 * face or back in the same slot, with the disc shadow when the reader has
 * piece shadows on (the face then draws none of its own).
 */
export function piece3dRim(
  cx: number,
  cy: number,
  pieceSet: XiangqiPieceSet,
  box: number,
  spec: Piece3dSpec,
  className: string,
): string {
  const look = piece3dLook(pieceSet, box, spec);
  const [mid, low] = look.body;
  const shadow = xiangqiPieceShadowEnabled()
    ? xiangqiPieceShadowMarks(look.radius, cx, cy + look.depth, box)
    : '';
  return [
    `<g class="${className}" aria-hidden="true">`,
    shadow,
    `<path d="${bandPath(cx, cy, look.radius, look.depth)}" fill="${low}"/>`,
    `<path d="${bandPath(cx, cy, look.radius, look.depth - 1.5)}" fill="${mid}"/>`,
    `</g>`,
  ].join('');
}

/** The piece's edge for a turn-over: its thickness and the band it shows. */
export function piece3dEdge(
  pieceSet: XiangqiPieceSet,
  box: number,
  spec: Piece3dSpec,
): PieceFlipEdge {
  const look = piece3dLook(pieceSet, box, spec);
  return {
    halfWidth: look.radius,
    depth: look.depth,
    fills: [look.body[0], look.body[0]],
    stroke: look.body[1],
  };
}

// ── Xiangqi-family pieces (xiangqi and jieqi boards, opt-in) ─────────────────

/**
 * The box a xiangqi or jieqi 3D piece is drawn in at this point gap, rounded
 * down to the quarter pixel so disc and rim never reach past a flat piece
 * (59 at xiangqi's 60, 71 at jieqi's 72).
 */
export function xiangqiPiece3dBox(pitch: number): number {
  const exact =
    (pitch * XIANGQI_PIECE_3D.reach) /
    (XIANGQI_PIECE_OUTLINE_SHARE + piece3dDepthShare(XIANGQI_PIECE_3D));
  return Math.floor(exact * 4) / 4;
}

/**
 * Whether a board draws 3D pieces in this set and layout shape: only a disc
 * has a rim. A set drawn as rounded squares on the cell layout stays flat.
 */
export function xiangqiPiece3dApplies(
  pieceSet: XiangqiPieceSet,
  shape: XiangqiPieceShape,
): boolean {
  return xiangqiPieceSetShape(pieceSet, shape) === 'disc';
}

/**
 * The piece the last-move band hugs on a board of 3D pieces: the disc's face,
 * raised with it, so the band rings the top of the piece and leaves the rim
 * outside it (Brian, 2026-10-28: a band around disc and rim "looks weird").
 */
export function xiangqiPiece3dMarkPiece(
  pieceSet: XiangqiPieceSet,
  pitch: number,
): BoardLastMovePiece {
  const box = xiangqiPiece3dBox(pitch);
  const look = piece3dLook(pieceSet, box, XIANGQI_PIECE_3D);
  return { box, outer: (look.radius * 100) / box, lift: round2(look.depth / 2) };
}

/** Where a 3D piece's disc sits for a piece anchored at `anchor`. */
export function xiangqiPiece3dDiscCenter(
  anchor: { x: number; y: number },
  pitch: number,
): { x: number; y: number } {
  return piece3dDiscCenter(anchor, xiangqiPiece3dBox(pitch), XIANGQI_PIECE_3D);
}

/**
 * One 3D piece centred on `anchor`: its rim (and shadow, when the reader has
 * piece shadows on), then the face or back `renderOpts` asks for, as a disc.
 */
export function xiangqiPiece3dMarkup(
  anchor: { x: number; y: number },
  pitch: number,
  piece: XiangqiPiece,
  pieceSet: XiangqiPieceSet,
  renderOpts: Omit<XiangqiPieceRenderOptions, 'x' | 'y' | 'size' | 'shape' | 'shadow'>,
  rimClass: string,
): string {
  const { band, face } = xiangqiPiece3dLayers(anchor, pitch, piece, pieceSet, renderOpts, rimClass);
  return band + face;
}

/** xiangqiPiece3dMarkup in its two layers: the rim (and shadow), then the disc. */
export function xiangqiPiece3dLayers(
  anchor: { x: number; y: number },
  pitch: number,
  piece: XiangqiPiece,
  pieceSet: XiangqiPieceSet,
  renderOpts: Omit<XiangqiPieceRenderOptions, 'x' | 'y' | 'size' | 'shape' | 'shadow'>,
  rimClass: string,
): { band: string; face: string } {
  const box = xiangqiPiece3dBox(pitch);
  const disc = piece3dDiscCenter(anchor, box, XIANGQI_PIECE_3D);
  return {
    band: piece3dRim(disc.x, disc.y, pieceSet, box, XIANGQI_PIECE_3D, rimClass),
    face: renderXiangqiPieceGlyphed(piece, pieceSet, {
      ...renderOpts,
      x: disc.x - box / 2,
      y: disc.y - box / 2,
      size: box,
      shape: 'disc',
      shadow: false,
      backStroke: xiangqiPieceRingWidth(pieceSet),
    }),
  };
}

/** A xiangqi or jieqi 3D piece's body for the perspective turn: disc, rim,
 *  and how far its shadow reaches past the rim. */
export function xiangqiPiece3dTurnLook(
  pieceSet: XiangqiPieceSet,
  pitch: number,
): Piece3dLook & { shadow: number } {
  const box = xiangqiPiece3dBox(pitch);
  return {
    ...piece3dLook(pieceSet, box, XIANGQI_PIECE_3D),
    shadow: box * PIECE_3D_SHADOW_SHARE,
  };
}

/** A xiangqi or jieqi 3D piece's edge for a turn-over. */
export function xiangqiPiece3dEdge(pieceSet: XiangqiPieceSet, pitch: number): PieceFlipEdge {
  return piece3dEdge(pieceSet, xiangqiPiece3dBox(pitch), XIANGQI_PIECE_3D);
}
