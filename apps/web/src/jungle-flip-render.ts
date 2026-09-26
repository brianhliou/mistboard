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
  type JungleFlipSeat,
  type JungleFlipSquare,
  jungleFlipCoordOf,
} from '@mistboard/game';
import { drawMarkerOnArrival, glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import { boardCornerRadius, TOKEN_PIECE_RATIO } from './board-metrics.js';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { currentJungleBoardSkin, currentJunglePieceSkin } from './jungle-appearance-storage.js';
import {
  framedTokenSvg,
  type JungleLastMoveInk,
  jungleBoardAssetHref,
  jungleCoverImage,
  jungleFaceDownDiscSvg,
  jungleLastMoveCellSvg,
  jungleShadowFilterDef,
} from './jungle-art.js';
import { characterTokenSvg, type JungleBoardSkin, type JunglePieceSkin } from './jungle-skins.js';
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
// Board corner radius, shared by the descriptor's internal clip-path AND the drawn
// border below so the two can never disagree about the curve. Derived from the shared
// ratio rather than hand-computed, which is what let it sit at 5 against a 4.86 target.
const BOARD_RADIUS = boardCornerRadius(FILES * CELL);
// Flip tokens back off the canonical ratio so they sit INSIDE the last-move
// ring (its inner clear is ~0.83·cell).
const FLIP_TOKEN_RATIO = TOKEN_PIECE_RATIO - 0.03;

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
  // Drop the per-token shadow filter (markers; avoids duplicate filter ids).
  shadow?: boolean;
  // Pin the look instead of resolving it — for surfaces that must render
  // deterministically (variant markers, rules diagrams, OG cards).
  boardSkin?: JungleBoardSkin;
  pieceSkin?: JunglePieceSkin;
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
): string {
  const parts: string[] = [];
  const s = geom.cell * FLIP_TOKEN_RATIO;
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
    const body = entry.faceDown
      ? // Face-down back: a banqi-style neutral jade disc (no ink/identity — the deal is
        // hidden from both sides), small enough to sit inside the last-move mark.
        jungleFaceDownDiscSvg(x, y, geom.cell, filterId)
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
 * from the same grid geometry the renderer uses (flip-aware). No-op at duration
 * 0 or when the slot is missing. Move payloads only, never board diffs.
 *
 * A FLIP is the self-move `from === to`: nothing travelled, so there is nothing
 * to glide and no arrival to fade. Same contract as the banqi board.
 */
export function animateJungleFlipBoardMove(
  host: HTMLElement,
  move: { from: JungleFlipSquare; to: JungleFlipSquare },
  perspective: JungleFlipSeat,
  opts: { reverse?: boolean } = {},
): void {
  if (move.from === move.to) return;
  const duration = pieceAnimationDurationMs();
  if (duration <= 0) return;
  const settleSquare = opts.reverse ? move.from : move.to;
  const originSquare = opts.reverse ? move.to : move.from;
  const slot = host.querySelector(`[data-piece-square="${settleSquare}"]`);
  if (!slot) return;
  const geom = createGridGeometry(DESCRIPTOR, perspective === 'black');
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
    size: CELL * FLIP_TOKEN_RATIO,
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
  const shadow = options.shadow ?? true;
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
      pieces(board, geom, gid, shadow, options.draggingFrom ?? null, pieceSkin) +
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
