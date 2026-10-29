// Board renderer for Flip Jungle (兽棋 / 翻翻棋) — the 4×4 flip animal chess board.
//
// Thin adapter over the shared descriptor-driven cell-board core
// (@mistboard/board-render renderGridBoardSvg), like jungle-render.ts. Symmetric
// hidden-identity: a face-down tile draws as a neutral "back" disc (no ink/identity);
// a revealed tile draws as an ink-coloured animal character disc.
//
// Self-contained (its own glyph table + concrete colours) so it doesn't couple to the
// vanilla jungle-render.ts whose piece art is being refined in a parallel session; a
// later pass can extract a shared animal-disc module both renderers import.

import {
  createGridGeometry,
  type GridBoardDescriptor,
  type GridCellRef,
  type GridGeometry,
  renderGridBoardSvg,
} from '@mistboard/board-render';
import {
  ALL_JUNGLE_FLIP_SQUARES,
  type JungleFlipColor,
  type JungleFlipPieceRole,
  type JungleFlipSquare,
  jungleFlipCoordOf,
} from '@mistboard/game';
import {
  drawMarkerOnArrival,
  flipSvgPiece,
  glideSvgPiece,
  type PieceFlipEdge,
  type PieceFlipStyle,
  pieceAnimationDurationMs,
  pieceFlipDurationMs,
} from './board-anim.js';
import { boardCornerRadius } from './board-metrics.js';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { currentJungleBoardSkin, currentJunglePieceSkin } from './jungle-appearance-storage.js';
import {
  framedTokenSvg,
  JUNGLE_ART,
  type JungleLastMoveInk,
  jungleBoardAssetHref,
  jungleCoverImage,
  jungleFaceDownDiscSvg,
  jungleLastMoveCellSvg,
  jungleShadowFilterDef,
  jungleTokenSize,
} from './jungle-art.js';
import { characterTokenSvg, type JungleBoardSkin, type JunglePieceSkin } from './jungle-skins.js';
import { PIECE_3D_IVORY, piece3dEnabled, round2 } from './piece-3d.js';
import { type SvgBoardArrowStyle, svgBoardArrow } from './svg-board-arrow.js';
import {
  GLYPH_OFFSET_RATIO,
  GLYPH_RADIUS_RATIO,
  type SvgBoardMarkerStyle,
  svgBoardCircleMarker,
  svgBoardGlyphMarker,
} from './svg-board-marker.js';

const FILES = 4;
const RANKS = 4;
const CELL = 64;
/** A flat Flip Jungle tile's outer edge as a share of the cell, face up or down
 *  (Brian, 2026-10-29: "2d 85 and 3d 90"; JUNGLE_FLIP_TILE_3D has the 3D one).
 *  Plain Jungle keeps JUNGLE_TOKEN_REACH's whole cell. */
export const JUNGLE_FLIP_TOKEN_REACH = 0.85;
const tokenSpan = (cell: number): number => cell * JUNGLE_FLIP_TOKEN_REACH;
// Board corner radius, shared by the descriptor's internal clip-path AND the drawn
// border below so the two can never disagree about the curve. Derived from the shared
// ratio rather than hand-computed, which is what let it sit at 5 against a 4.86 target.
const BOARD_RADIUS = boardCornerRadius(FILES * CELL);

const PALETTE = {
  // Solid (non-alternating) board: one warm tan for every cell.
  lightCell: '#e7ce96',
  darkCell: '#e7ce96',
  // Borderless: no frame band or board edge, matching the vanilla Jungle board.
  coord: 'rgba(60,45,30,0.55)',
  lastMove: 'rgba(255,205,80,0.5)',
  selected: 'rgba(31,111,91,0.32)',
  targetDot: 'rgba(31,111,91,0.72)',
  targetRing: 'rgba(31,111,91,0.48)',
  targetHover: 'rgba(31,111,91,0.30)',
  fog: 'rgba(22,18,14,0.66)',
} as const;

// Tile-separating grid lines, banqi-style (matches the vanilla Jungle board).
const GRID_STROKE = 'rgba(91,74,50,0.55)';

// Token + terrain art comes from the shared jungle-art.ts recipe (the blog-aligned
// dobutsu look), the same source the vanilla board and the markers use.

// A masked board entry (mirrors JungleFlipVisibleBoardEntry on the wire).
export type JungleFlipRenderEntry =
  | { faceDown: true }
  | { faceDown: false; color: JungleFlipColor; role: JungleFlipPieceRole };
export type JungleFlipRenderBoard = Partial<Record<JungleFlipSquare, JungleFlipRenderEntry>>;

const DESCRIPTOR: GridBoardDescriptor = {
  files: FILES,
  ranks: RANKS,
  cell: CELL,
  palette: PALETTE,
  pad: 0,
  // Full-bleed <image> terrain (like jungle) isn't clipped by the outer CSS
  // border-radius, so round the internal clip-path to clip the corner images.
  boardRadius: BOARD_RADIUS,
  svgClass: 'jungle-flip-live-svg',
};

// Board geometry, exported so cropped consumers (the variant marker) can compute a
// sub-region viewBox.
export const JUNGLE_FLIP_BOARD_VIEW = { cell: CELL, files: FILES, ranks: RANKS } as const;

export type JungleFlipRenderOptions = {
  arrows?: readonly JungleFlipBoardArrow[];
  markers?: readonly JungleFlipBoardMarker[];
  lastMove?: { from: JungleFlipSquare; to: JungleFlipSquare } | null;
  /**
   * Ink of the side that made `lastMove`, from jungleFlipLastMoverInk. Must NOT
   * be read off the board: a flip reveals a random tile whose colour is
   * independent of the flipper. Omitted (diagrams, OG cards) falls back to gold.
   */
  lastMoveInk?: JungleLastMoveInk;
  selected?: JungleFlipSquare | null;
  targets?: readonly JungleFlipSquare[];
  // The square a revealed piece is being dragged from: its on-board token dims to a ghost.
  draggingFrom?: JungleFlipSquare | null;
  interactive?: boolean;
  idSuffix?: string;
  // Opt in to the per-token drop shadow (off by default since 2026-10-14).
  shadow?: boolean;
  // Pin the look instead of resolving it — for surfaces that must render
  // deterministically (variant markers, rules diagrams, OG cards).
  boardSkin?: JungleBoardSkin;
  pieceSkin?: JunglePieceSkin;
  /** Trial 3D tiles (#709): each tile shows a band of its body under its face.
   *  Off by default; without it the board's markup is unchanged. */
  tile3d?: boolean;
};

export interface JungleFlipBoardArrow extends SvgBoardArrowStyle {
  from: JungleFlipSquare;
  to: JungleFlipSquare;
}

export interface JungleFlipBoardMarker extends SvgBoardMarkerStyle {
  square: JungleFlipSquare;
  kind: 'circle' | 'glyph';
  /** Badge label for kind 'glyph' (e.g. '??'). Ignored by 'circle'. */
  text?: string;
}

function cellRef(square: JungleFlipSquare): GridCellRef {
  const { file, rank } = jungleFlipCoordOf(square);
  return { file, rank };
}

function defs(gid: string): string {
  return jungleShadowFilterDef(`${gid}-tok`);
}

// The board terrain (bushy 4×4 board) + grid + last-move ring, painted under the pieces.
// Mirrors the vanilla board: the bushy bg would hide the core's last-move layer, so the
// ring is drawn here over the terrain.
function terrain(
  geom: GridGeometry,
  lastMove: { from: JungleFlipSquare; to: JungleFlipSquare } | null,
  lastMoveInk: JungleLastMoveInk,
  boardSkin: JungleBoardSkin,
): string {
  const c = geom.cell;
  const boardW = FILES * c;
  const boardH = RANKS * c;
  // Both skins paint an OPAQUE base: the core stack draws its last-move and
  // selection fills BEFORE renderPieces, so a transparent land would let those
  // show through on the plain skin only (this board draws its own last-move
  // marks below, over the terrain, precisely because of this order).
  const parts: string[] = [
    boardSkin === 'bare'
      ? `<rect x="0" y="0" width="${boardW}" height="${boardH}" style="fill: var(--jungle-bare-land, ${PALETTE.lightCell})"/>`
      : jungleCoverImage(jungleBoardAssetHref('flip-board'), 0, 0, boardW, boardH),
  ];
  // INTERIOR lines only, and NO drawn perimeter at all: the playable background
  // defines the board edge, exactly as on the 7x9 board (see jungle-render.ts's
  // furniture()). Perimeter lines are straight and meet at square corners, which
  // the rounded clip-path then shaves — the painted board image hid that, but on
  // the bare board those lines were the border and the corners read as mistrimmed.
  // A rounded-rect border on the clip's own radius fixed the trim, but the edge is
  // cleaner without any border at all.
  for (let i = 1; i < FILES; i += 1) {
    const x = i * c;
    parts.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${boardH}" stroke="${GRID_STROKE}" stroke-width="1" stroke-linecap="round"/>`,
    );
  }
  for (let j = 1; j < RANKS; j += 1) {
    const y = j * c;
    parts.push(
      `<line x1="0" y1="${y}" x2="${boardW}" y2="${y}" stroke="${GRID_STROKE}" stroke-width="1" stroke-linecap="round"/>`,
    );
  }
  if (lastMove) {
    // A board move tints two cells, origin weaker than destination. A flip is a
    // self-move (`from === to`), so it tints one and takes a border: drawing an
    // origin tint there too would falsely suggest the piece travelled away and
    // back. The tint carries the ink of the side that ACTED, which for a flip is
    // not the ink of the tile it turned up.
    const to = jungleFlipCoordOf(lastMove.to);
    const toTopLeft = geom.topLeft(to.file, to.rank);
    if (lastMove.from === lastMove.to) {
      parts.push(jungleLastMoveCellSvg(toTopLeft.x, toTopLeft.y, c, 'flip', lastMoveInk));
    } else {
      const from = jungleFlipCoordOf(lastMove.from);
      const fromTopLeft = geom.topLeft(from.file, from.rank);
      parts.push(jungleLastMoveCellSvg(fromTopLeft.x, fromTopLeft.y, c, 'from', lastMoveInk));
      parts.push(jungleLastMoveCellSvg(toTopLeft.x, toTopLeft.y, c, 'to', lastMoveInk));
    }
  }
  return parts.join('');
}

function pieces(
  board: JungleFlipRenderBoard,
  geom: GridGeometry,
  gid: string,
  shadow: boolean,
  draggingFrom: JungleFlipSquare | null,
  pieceSkin: JunglePieceSkin,
  tile3d = false,
): string {
  const parts: string[] = [];
  const tile = tile3d ? jungleFlipTile3dGeometry(geom.cell) : null;
  // The same outer edge as the face-down tile (JUNGLE_FLIP_TOKEN_REACH).
  const s = jungleTokenSize(tokenSpan(geom.cell));
  const filterId = shadow ? `${gid}-tok` : undefined;
  // The face-down disc is already flat, so it is shared by both skins.
  const tokenSvg = pieceSkin === 'characters' ? characterTokenSvg : framedTokenSvg;
  for (const square of ALL_JUNGLE_FLIP_SQUARES) {
    const entry = board[square];
    if (!entry) continue;
    const { file, rank } = jungleFlipCoordOf(square);
    const { x, y } = geom.center(file, rank);
    // Every tile gets a keyed slot, face-down included: a revealed piece can
    // capture onto a square and the glide has to find whatever settled there.
    // The keyed outer slot lets a post-render glide find the token
    // (animateJungleFlipBoardMove); the drag-source dimmer stays an inner wrapper.
    const body = tile
      ? jungleFlipTile3dMarkup({ x, y }, entry.faceDown ? null : entry, tile, pieceSkin, filterId)
      : entry.faceDown
        ? // Face-down back: a neutral jade rounded square (no ink or identity, the deal is
          // hidden from both sides), the same outer size and shape as a face-up token.
          jungleFaceDownDiscSvg(x, y, tokenSpan(geom.cell), filterId)
        : // Revealed: the framed token for the active skin (matches the vanilla board).
          tokenSvg({ cx: x, cy: y, size: s, ink: entry.color, role: entry.role, filterId });
    // While this piece is being dragged, dim its on-board token so only the ghost reads.
    const slotBody =
      !entry.faceDown && square === draggingFrom
        ? `<g class="jungle-drag-source">${body}</g>`
        : body;
    parts.push(`<g class="jgf-piece-slot" data-piece-square="${square}">${slotBody}</g>`);
  }
  return parts.join('');
}

/**
 * Glide the piece that settled on `move.to` from its origin (or with `reverse`
 * the piece back on `move.from`). Call AFTER the innerHTML swap. Deltas come
 * from the same grid geometry the renderer uses: never flipped, like the board
 * (the deal has no sides). It took the viewer's seat until 2026-09-30, so the
 * second mover saw every glide mirrored onto a board drawn unflipped. No-op at
 * duration 0 or when the slot is missing. Move payloads only, never board diffs.
 *
 * A FLIP is the self-move `from === to`: nothing travelled, so there is nothing
 * to glide and no arrival to fade. Same contract as the banqi board.
 */
export function animateJungleFlipBoardMove(
  host: HTMLElement,
  move: { from: JungleFlipSquare; to: JungleFlipSquare },
  opts: { reverse?: boolean } = {},
): void {
  if (move.from === move.to) return;
  const duration = pieceAnimationDurationMs();
  if (duration <= 0) return;
  const settleSquare = opts.reverse ? move.from : move.to;
  const originSquare = opts.reverse ? move.to : move.from;
  const slot = host.querySelector(`[data-piece-square="${settleSquare}"]`);
  if (!slot) return;
  const geom = createGridGeometry(DESCRIPTOR, false);
  const origin = jungleFlipCoordOf(originSquare);
  const settle = jungleFlipCoordOf(settleSquare);
  const from = geom.center(origin.file, origin.rank);
  const to = geom.center(settle.file, settle.rank);
  glideSvgPiece(slot, from.x - to.x, from.y - to.y, duration);
  // Fade the destination tint in as the piece lands. A reverse step renders the
  // PRIOR move's mark on a different cell, so fading it would not track the glide.
  if (!opts.reverse) {
    drawMarkerOnArrival(host.querySelector('.jungle-last-move-to'), duration);
  }
}

// The floating ghost piece shown while dragging a revealed animal (a framed token in a
// one-cell SVG box), appended to <body> by installBoardDrag.
export function jungleFlipPieceGhostSvg(entry: {
  color: JungleFlipColor;
  role: JungleFlipPieceRole;
}): string {
  const tokenSvg = currentJunglePieceSkin() === 'characters' ? characterTokenSvg : framedTokenSvg;
  const inner = tokenSvg({
    cx: CELL / 2,
    cy: CELL / 2,
    size: jungleTokenSize(tokenSpan(CELL)),
    ink: entry.color,
    role: entry.role,
  });
  return `<svg viewBox="0 0 ${CELL} ${CELL}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${inner}</svg>`;
}

export function renderJungleFlipBoardSvg(
  board: JungleFlipRenderBoard,
  options: JungleFlipRenderOptions = {},
): string {
  const gid = `jungleflip${options.idSuffix ?? ''}`;
  // Off by default since 2026-10-14 (no shadow on the new tokens); still opt-in.
  const shadow = options.shadow ?? false;
  // Resolved once per render; a caller may pin either axis (markers, diagrams).
  const boardSkin = options.boardSkin ?? currentJungleBoardSkin();
  const pieceSkin = options.pieceSkin ?? currentJunglePieceSkin();
  return renderGridBoardSvg(DESCRIPTOR, {
    id: gid,
    flip: false, // the deal has no sides — a fixed orientation is least confusing
    extraDefs: shadow ? defs(gid) : '',
    coords: boardCoordinatesEnabled(),
    renderPieces: (geom) =>
      terrain(geom, options.lastMove ?? null, options.lastMoveInk ?? null, boardSkin) +
      pieces(
        board,
        geom,
        gid,
        shadow,
        options.draggingFrom ?? null,
        pieceSkin,
        options.tile3d ?? piece3dEnabled(),
      ) +
      `<g class="jungle-flip-board-markers xq-live-markers" aria-hidden="true" pointer-events="none">${jungleFlipMarkerLayer(options.markers ?? [], geom)}</g>` +
      `<g class="jungle-flip-board-arrows xq-live-arrows" aria-hidden="true" pointer-events="none">${jungleFlipArrowLayer(options.arrows ?? [], geom)}</g>`,
    // Last-move is drawn inside terrain (over the bushy board); the core's own last-move
    // layer sits under renderPieces and would be hidden by the board image.
    lastMove: null,
    selected: options.selected ? cellRef(options.selected) : null,
    targets: (options.targets ?? []).map((sq) => {
      const ref = cellRef(sq);
      return { ...ref, occupied: board[sq] !== undefined };
    }),
    squareName: (file, rank) => `${'abcd'[file]}${rank}`,
    interactive: options.interactive ?? false,
  });
}

export function jungleFlipArrowSvg(arrow: JungleFlipBoardArrow): string {
  return jungleFlipArrowSvgWithGeometry(arrow, createGridGeometry(DESCRIPTOR, false));
}

export function jungleFlipMarkerSvg(marker: JungleFlipBoardMarker): string {
  return jungleFlipMarkerSvgWithGeometry(marker, createGridGeometry(DESCRIPTOR, false));
}

function jungleFlipArrowLayer(arrows: readonly JungleFlipBoardArrow[], geom: GridGeometry): string {
  return arrows.map((arrow) => jungleFlipArrowSvgWithGeometry(arrow, geom)).join('');
}

function jungleFlipMarkerLayer(
  markers: readonly JungleFlipBoardMarker[],
  geom: GridGeometry,
): string {
  return markers.map((marker) => jungleFlipMarkerSvgWithGeometry(marker, geom)).join('');
}

function jungleFlipArrowSvgWithGeometry(arrow: JungleFlipBoardArrow, geom: GridGeometry): string {
  const from = jungleFlipCoordOf(arrow.from);
  const to = jungleFlipCoordOf(arrow.to);
  const scaledArrow = {
    ...arrow,
    width: arrow.width === undefined ? undefined : arrow.width * (CELL / 72),
  };
  return svgBoardArrow(
    scaledArrow,
    geom.center(from.file, from.rank),
    geom.center(to.file, to.rank),
    { baseClassName: 'xq-arrow', defaultWidth: 8, startInset: 10 },
  );
}

function jungleFlipMarkerSvgWithGeometry(
  marker: JungleFlipBoardMarker,
  geom: GridGeometry,
): string {
  const coord = jungleFlipCoordOf(marker.square);
  const center = geom.center(coord.file, coord.rank);
  if (marker.kind === 'glyph') {
    return svgBoardGlyphMarker(
      marker,
      center,
      geom.cell * GLYPH_RADIUS_RATIO,
      geom.cell * GLYPH_OFFSET_RATIO,
      { baseClassName: 'xq-marker' },
    );
  }
  return svgBoardCircleMarker(marker, center, geom.cell * (26 / 60), {
    baseClassName: 'xq-marker engine-marker',
  });
}

// ── Turn-over and trial 3D tiles (#709) ─────────────────────────────────────

/**
 * Turn the tile on `square` over after the render that drew its face: the
 * board's own face-down tile (identity-free) turns to the face, in the tab's
 * flip style. With `tile3d` the 3D back turns and, edge-on, the tile shows its
 * thickness. Call only for a reveal (a flip, `from === to`) on a square the
 * render shows face up. No-op (false) under reduced motion, the 'none'
 * animation pref, without WAAPI, or when the slot is missing.
 */
export function animateJungleFlipReveal(
  host: HTMLElement,
  square: JungleFlipSquare,
  opts: { tile3d?: boolean; style?: PieceFlipStyle; delayMs?: number } = {},
): boolean {
  const slot = host.querySelector(`[data-piece-square="${square}"]`);
  if (!slot) return false;
  const geom = createGridGeometry(DESCRIPTOR, false);
  const { file, rank } = jungleFlipCoordOf(square);
  const anchor = geom.center(file, rank);
  const durationMs = pieceFlipDurationMs();
  const timing = {
    ...(opts.style ? { style: opts.style } : {}),
    ...(opts.delayMs ? { delayMs: opts.delayMs } : {}),
  };
  if (opts.tile3d ?? piece3dEnabled()) {
    const tile = jungleFlipTile3dGeometry(geom.cell);
    const face = { x: anchor.x, y: round2(anchor.y - tile.lift) };
    return flipSvgPiece(slot, face, jungleFlipTile3dMarkup(anchor, null, tile), durationMs, {
      ...timing,
      edge: jungleFlipTile3dEdge(tile),
    });
  }
  return flipSvgPiece(
    slot,
    anchor,
    jungleFaceDownDiscSvg(anchor.x, anchor.y, tokenSpan(geom.cell)),
    durationMs,
    timing,
  );
}

/**
 * Trial 3D tiles: a rounded-square tile seen a little from above, as banqi's
 * and xiangqi's 3D discs are (piece-3d.ts). Face and rim together are centred
 * on the cell and span `reach` of it, so they never pass the flat tile's
 * footprint; the face is raised by half the rim and
 * comes out narrower than flat by the rim's depth. One ivory body face up and
 * face down.
 */
export const JUNGLE_FLIP_TILE_3D = { reach: 0.9, depthShare: 0.08 } as const;

export interface JungleFlipTile3dGeometry {
  /** Rim thickness. */
  depth: number;
  /** How far the face is raised from the cell centre (half the rim). */
  lift: number;
  /** Half the face's outer width (ring or back stroke included). */
  half: number;
  /** The face's outer corner radius. */
  corner: number;
  /** The token size whose outer edge is the face. */
  size: number;
}

const JUNGLE_TOKEN_OUTER_PER_SIZE = 2 * JUNGLE_ART.ringRadiusRatio + JUNGLE_ART.ringStrokeRatio;

export function jungleFlipTile3dGeometry(cell: number): JungleFlipTile3dGeometry {
  const span = cell * JUNGLE_FLIP_TILE_3D.reach;
  const depth = round2(span * JUNGLE_FLIP_TILE_3D.depthShare);
  // Rounded down to the quarter so the face never outgrows span - depth.
  const size = Math.floor(((span - depth) / JUNGLE_TOKEN_OUTER_PER_SIZE) * 4) / 4;
  const face = size * JUNGLE_TOKEN_OUTER_PER_SIZE;
  const half = round2(face / 2);
  const stroke = face * JUNGLE_ART.faceDown.strokeRatio;
  const corner = round2((half - stroke / 2) * JUNGLE_ART.cornerPerHalf + stroke / 2);
  return { depth, lift: round2(depth / 2), half, corner, size };
}

// The side wall below the face: straight sides from the face's middle down
// `k`, closed by the face's bottom edge and corners moved down by `k`.
function tileBandPath(cx: number, cy: number, h: number, rc: number, k: number): string {
  const bottom = round2(cy + h + k);
  const turn = round2(bottom - rc);
  return (
    `M${round2(cx - h)} ${cy}V${turn}A${rc} ${rc} 0 0 0 ${round2(cx - h + rc)} ${bottom}` +
    `H${round2(cx + h - rc)}A${rc} ${rc} 0 0 0 ${round2(cx + h)} ${turn}V${cy}Z`
  );
}

/** One 3D tile on `anchor` (a cell centre): rim, then the back or the face. */
function jungleFlipTile3dMarkup(
  anchor: { x: number; y: number },
  entry: { color: JungleFlipColor; role: JungleFlipPieceRole } | null,
  tile: JungleFlipTile3dGeometry,
  pieceSkin: JunglePieceSkin = 'animals',
  filterId?: string,
): string {
  const cx = anchor.x;
  const cy = round2(anchor.y - tile.lift);
  const [mid, low] = PIECE_3D_IVORY;
  const rim =
    `<g class="jgf-rim" aria-hidden="true">` +
    `<path d="${tileBandPath(cx, cy, tile.half, tile.corner, tile.depth)}" fill="${low}"/>` +
    `<path d="${tileBandPath(cx, cy, tile.half, tile.corner, tile.depth - 1.5)}" fill="${mid}"/>` +
    `</g>`;
  if (!entry) return rim + jungleFaceDownDiscSvg(cx, cy, 2 * tile.half, filterId);
  const tokenSvg = pieceSkin === 'characters' ? characterTokenSvg : framedTokenSvg;
  return rim + tokenSvg({ cx, cy, size: tile.size, ink: entry.color, role: entry.role, filterId });
}

/** The 3D tile's edge for the turn-over: its thickness, in its body colour. */
function jungleFlipTile3dEdge(tile: JungleFlipTile3dGeometry): PieceFlipEdge {
  return {
    halfWidth: tile.half,
    depth: tile.depth,
    fills: [PIECE_3D_IVORY[0], PIECE_3D_IVORY[0]],
    stroke: PIECE_3D_IVORY[1],
  };
}
