// Shared standard-Xiangqi board: intersection-board SVG geometry, the layer
// renderers, the pure click-to-move decision, and an INSTANCE-BASED interactive
// board. Both the live room (live-xiangqi.ts) and the analysis board consume the
// same factory — neither owns a module-level singleton. Selection/drag state
// lives per instance; the caller supplies policies (whose seat is interactive,
// when interaction is enabled) and an onMove sink (live: send to server;
// analysis: append to the move tree).
//
// The render-only renderXiangqiBoardSvg (postgame / replay / broadcast reuse it)
// also lives here; live-xiangqi.ts re-exports it for its existing importers.

// This board builds the judgment badge in its own intersection geometry rather
// than through svg-board-marker, so it imports the badge palette directly.
import './board-glyph-marker.css';
import type {
  StandardXiangqiPlayerView,
  XiangqiColor,
  XiangqiMove,
  XiangqiNotationStyle,
  XiangqiPiece,
  XiangqiSquare,
} from '@mistboard/game';
import { drawMarkerOnArrival, glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import { BOARD_LASTMOVE_MARKER_SELECTOR, boardLastMoveMarkersSvg } from './board-lastmove.js';
import { tokenPieceSize } from './board-metrics.js';
import { readDisplayPreferences } from './display-preferences.js';
import { type SvgBoardArrowStyle, svgBoardArrow } from './svg-board-arrow.js';
import { installBoardDrag, installBoardDraw } from './variant-tenant/board-drag.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';
import { escapeHtml } from './web-utils.js';
import {
  readStoredXiangqiBoardLayout,
  type XiangqiBoardLayout,
} from './xiangqi-appearance-storage.js';
import {
  type XiangqiBoardGeometry,
  xiangqiBoardPoint,
  xiangqiBoardViewBox,
} from './xiangqi-board-geometry.js';
import {
  type XiangqiSurfaceConfig,
  xiangqiSurfaceCoords,
  xiangqiSurfaceGrid,
  xiangqiSurfacePalace,
  xiangqiSurfacePalaceBands,
  xiangqiSurfaceRiver,
} from './xiangqi-board-surface.js';
import { xiangqiCoordLabels } from './xiangqi-coord-labels.js';
import { drawsCrossedSoldier } from './xiangqi-crossed-soldier.js';
import { currentXiangqiNotationStyle } from './xiangqi-notation.js';
import type { XiangqiPieceSet } from './xiangqi-piece-sets.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';

const FILES = 'abcdefghi';
const FILE_COUNT = 9;
const RANK_COUNT = 10;
const CELL = 60;
const MARGIN = 36;
const CELL_RIVER_GAP = 12;
// The live board's config for the shared geometry core; the article diagrams use
// their own (smaller) config against the same transform.
export const LIVE_BOARD_GEO: XiangqiBoardGeometry = {
  fileCount: FILE_COUNT,
  rankCount: RANK_COUNT,
  cell: CELL,
  margin: MARGIN,
  riverGap: CELL_RIVER_GAP,
  // A fifth of a cell puts the label clear of a piece sitting on the outer
  // intersection (radius 0.45 cells) with room to breathe. Reserved only while
  // labels are shown and reclaimed when they are off, so a reader who never
  // turns coordinates on sees the board exactly as it was.
  coordGutter: Math.round(CELL / 5),
};
// Same board with NO reserved gutter, for surfaces that are not interactive
// boards and whose framing is authored: video frames, and anything else that
// composites the board into a fixed layout. Coordinates are a playing aid, so
// they and the space they need stop at the edge of the interactive surfaces.
const LIVE_BOARD_GEO_NO_COORDS: XiangqiBoardGeometry = { ...LIVE_BOARD_GEO, coordGutter: 0 };
// Board-specific facts for the shared surface renderer. Jieqi supplies the same
// shape at its own scale; fortress supplies a 7x8 board with no river.
// Exported so the Duck Xiangqi board renders the SAME surface rather than a
// copy of these numbers. Board art that gets hand-duplicated drifts; the jungle
// art proved it twice.
export const LIVE_BOARD_SURFACE: XiangqiSurfaceConfig = {
  geo: LIVE_BOARD_GEO,
  palaces: [
    { fileMin: 3, fileMax: 5, rankMin: 1, rankMax: 3 },
    { fileMin: 3, fileMax: 5, rankMin: 8, rankMax: 10 },
  ],
  riverAfterRank: 5,
  riverLabel: '楚 河   漢 界',
};
export const XIANGQI_LIVE_PIECE_SIZE = tokenPieceSize(CELL);
const PIECE_SIZE = XIANGQI_LIVE_PIECE_SIZE;
const HIT_HALF = 26;
const NON_SELECTABLE_RIVER_ATTRS =
  'aria-hidden="true" pointer-events="none" style="-webkit-user-select: none; user-select: none;"';

// ── Rendering ────────────────────────────────────────────────────────────────

/** Render-only board SVG (no click layer). Reused by postgame / replay /
 *  broadcast / analysis-review surfaces. */
export function renderXiangqiBoardSvg(
  view: StandardXiangqiPlayerView,
  perspective: XiangqiColor = view.perspective,
  options: Pick<XiangqiBoardSvgState, 'layout' | 'coordinates'> = {},
): string {
  return xiangqiBoardSvg(view, perspective, {
    interactive: false,
    selectedSquare: null,
    draggingFrom: null,
    ...options,
  });
}

export interface XiangqiBoardSvgState {
  /** Tri-state, and the middle state is the default.
   *    undefined -- follow the reader's boardCoordinates display preference.
   *    false     -- force off, and reserve no gutter for them either. For
   *                 surfaces whose framing is authored rather than played on:
   *                 video frames, article diagrams, the puzzle thumbnail.
   *    true      -- force ON, whatever the preference says. For a surface where
   *                 the labels are the subject rather than a convenience: the
   *                 coordinate trainer's training-wheels toggle would otherwise
   *                 be inert, since the preference defaults to off.
   *  Boards you actually play on leave this alone. */
  coordinates?: boolean;
  /** Which notation the edge labels are drawn in. Defaults to the reader's
   *  notation preference, which is right for a board they are playing on. A
   *  surface that is TEACHING one system has to pin it: the coordinate trainer
   *  would otherwise label the board in WXF file numbers while asking for
   *  algebraic points. */
  coordinateStyle?: XiangqiNotationStyle;
  interactive: boolean;
  selectedSquare: XiangqiSquare | null;
  draggingFrom: XiangqiSquare | null;
  /** Explicit preview/layout override; normal interactive boards read the preference. */
  layout?: XiangqiBoardLayout;
  /** Explicit piece-set override; normal interactive boards read the preference.
   *  Renderers with no localStorage (video frames) must pass this or they
   *  silently inherit whatever the product default happens to be. */
  pieceSet?: XiangqiPieceSet;
  /** Engine/annotation arrows, drawn in array order (last = on top). */
  arrows?: readonly XiangqiBoardArrow[];
  /** Point markers (learn-mode collectible stars / annotation rings). */
  markers?: readonly XiangqiBoardMarker[];
}

/** A decoration pinned to one intersection: 'star' = a collectible item
 *  (xiangqi learn apples), 'circle' = an annotation ring, 'glyph' = a small
 *  labelled disc riding the top-right corner of the point (the review board's
 *  ?? / ? / ?! move annotations). Styling hooks via className; geometry flips
 *  with the board perspective like everything else. */
export interface XiangqiBoardMarker {
  square: XiangqiSquare;
  kind: 'star' | 'circle' | 'glyph';
  /** Disc label for kind 'glyph' (e.g. '??'). Ignored by the other kinds. */
  text?: string;
  className?: string;
}

/** One board arrow (engine PV hint / best-move advice). Geometry is derived from
 *  the same intersection transform the pieces use, so arrows flip with the board
 *  perspective automatically. */
export interface XiangqiBoardArrow extends SvgBoardArrowStyle {
  from: XiangqiSquare;
  to: XiangqiSquare;
}

/** Full board SVG with interaction state. The live room (live-xiangqi.ts) calls
 *  this directly with its own selection/drag state; render-only surfaces go
 *  through renderXiangqiBoardSvg above. */
export function xiangqiBoardSvg(
  view: StandardXiangqiPlayerView,
  perspective: XiangqiColor,
  state: XiangqiBoardSvgState,
): string {
  const layout = state.layout ?? readStoredXiangqiBoardLayout();
  // The gutter is reclaimed when labels are off, so a reader who never turns
  // coordinates on sees exactly the board they saw before this shipped. The
  // trade is that the board resizes when the setting changes -- which happens
  // once, in settings, where a reflow is expected.
  const showCoords = state.coordinates ?? readDisplayPreferences().boardCoordinates;
  const surface = showCoords
    ? LIVE_BOARD_SURFACE
    : { ...LIVE_BOARD_SURFACE, geo: LIVE_BOARD_GEO_NO_COORDS };
  const vb = xiangqiBoardViewBox(layout, surface.geo);
  const viewBox = `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`;
  const coords = showCoords
    ? xiangqiSurfaceCoords(
        LIVE_BOARD_SURFACE,
        perspective,
        layout,
        xiangqiCoordLabels(
          state.coordinateStyle ?? currentXiangqiNotationStyle(),
          FILE_COUNT,
          RANK_COUNT,
        ),
      )
    : '';
  return `
    <svg class="xq-live-svg xq-live-svg--${layout} xq-surface xq-surface--${layout}" data-xiangqi-layout="${layout}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
      <rect class="xq-live-bg" x="${vb.minX}" y="${vb.minY}" width="${vb.width}" height="${vb.height}"/>
      <g class="xq-live-grid">${xiangqiSurfaceGrid(surface, layout)}</g>
      <g class="xq-live-palace-bands">${xiangqiSurfacePalaceBands(surface, perspective, layout)}</g>
      <g class="xq-live-palace">${xiangqiSurfacePalace(surface, perspective, layout)}</g>
      <g class="xq-live-river" ${NON_SELECTABLE_RIVER_ATTRS}>${xiangqiSurfaceRiver(surface, perspective, layout)}</g>
      <g class="xq-live-coords" aria-hidden="true" pointer-events="none">${coords}</g>
      <g class="xq-live-lastmove">${lastMoveLayer(view, perspective, layout)}</g>
      <g class="xq-live-selection">${selectionLayer(state.selectedSquare, perspective, layout)}</g>
      <g class="xq-live-hints">${state.interactive ? '' : hintLayer(view, perspective, state.selectedSquare, layout)}</g>
      <g class="xq-live-pieces">${pieceLayer(view, perspective, state.draggingFrom, layout, state.pieceSet)}</g>
      <g class="xq-live-markers" aria-hidden="true" pointer-events="none">${markerLayer(state.markers ?? [], perspective, layout, 'point')}</g>
      <g class="xq-live-arrows" aria-hidden="true" pointer-events="none">${arrowLayer(state.arrows ?? [], perspective, layout)}</g>
      <g class="xq-live-glyphs" aria-hidden="true" pointer-events="none">${markerLayer(state.markers ?? [], perspective, layout, 'glyph')}</g>
      <g class="xq-live-clicks">${state.interactive ? clickLayer(view, perspective, state.selectedSquare, layout) : ''}</g>
    </svg>
  `;
}

function lastMoveLayer(
  view: StandardXiangqiPlayerView,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
): string {
  if (!view.lastMove) return '';
  const from = coordOf(view.lastMove.from);
  const to = coordOf(view.lastMove.to);
  const fromCenter = intersection(from.file, from.rank, perspective, layout);
  const toCenter = intersection(to.file, to.rank, perspective, layout);
  if (layout === 'cell') {
    const fromX = fromCenter.x - CELL / 2;
    const fromY = fromCenter.y - CELL / 2;
    const toX = toCenter.x - CELL / 2;
    const toY = toCenter.y - CELL / 2;
    return (
      `<rect class="xq-live-lastmove-square xq-live-lastmove-from" x="${fromX}" y="${fromY}" width="${CELL}" height="${CELL}"/>` +
      `<rect class="xq-live-lastmove-square xq-live-lastmove-to" x="${toX}" y="${toY}" width="${CELL}" height="${CELL}"/>`
    );
  }
  // Origin: a darkened "the piece came from here" shadow disc. Destination: a
  // gold ring around the moved piece (this layer sits under the pieces, so only
  // the halo outside the piece radius shows). Markup + styling are shared with
  // every other token board (board-lastmove.ts), the fog board included since
  // 2026-08-30; this board is the one the proportions were tuned on, so it
  // passes its own PIECE_SIZE and gets the canonical radii straight back.
  return boardLastMoveMarkersSvg({ from: fromCenter, to: toCenter }, PIECE_SIZE);
}

// ── Arrows (engine PV hints) ─────────────────────────────────────────────────
/** One arrow between two intersection centers: a round-capped shaft plus a
 *  triangular head, shortened at the destination so the head never covers the
 *  piece center. Pure string renderer — exported for tests. */
export function xiangqiArrowSvg(
  arrow: XiangqiBoardArrow,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout = 'intersection',
): string {
  const from = coordOf(arrow.from);
  const to = coordOf(arrow.to);
  const a = intersection(from.file, from.rank, perspective, layout);
  const b = intersection(to.file, to.rank, perspective, layout);
  return svgBoardArrow(arrow, a, b, { baseClassName: 'xq-arrow' });
}

function arrowLayer(
  arrows: readonly XiangqiBoardArrow[],
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
): string {
  return arrows.map((arrow) => xiangqiArrowSvg(arrow, perspective, layout)).join('');
}

// ── Point markers (learn stars / annotation rings) ───────────────────────────

const STAR_OUTER_RADIUS = 22;
const STAR_INNER_RADIUS = 9;
const MARKER_RING_RADIUS = 29;
const fmt = (value: number): number => Math.round(value * 10) / 10;

// Judgment-glyph disc, pinned to the top-right of the point so it clears the
// piece token instead of covering it (lila puts the same badge on the corner of
// the destination square). Sized to read as an annotation ON the position, not
// as another piece: well under the 27-unit piece radius, and pushed far enough
// out that it bites the token's corner rather than sitting on its face.
// OFFSET + RADIUS <= MARGIN keeps a last-file/rank glyph inside the board edge,
// so it never needs clamping.
const GLYPH_RADIUS = 13;
const GLYPH_OFFSET = 21;
const GLYPH_FONT_SIZE = 15;

function starPoints(cx: number, cy: number): string {
  const points: string[] = [];
  for (let k = 0; k < 10; k += 1) {
    const radius = k % 2 === 0 ? STAR_OUTER_RADIUS : STAR_INNER_RADIUS;
    const angle = -Math.PI / 2 + (k * Math.PI) / 5;
    points.push(`${fmt(cx + radius * Math.cos(angle))},${fmt(cy + radius * Math.sin(angle))}`);
  }
  return points.join(' ');
}

/** One marker at an intersection. Pure string renderer — exported for tests. */
export function xiangqiMarkerSvg(
  marker: XiangqiBoardMarker,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout = 'intersection',
): string {
  const coord = coordOf(marker.square);
  const center = intersection(coord.file, coord.rank, perspective, layout);
  const className = marker.className ? `xq-marker ${marker.className}` : 'xq-marker';
  if (marker.kind === 'glyph') {
    // Offsets are in SCREEN space (intersection() has already applied the
    // perspective flip), so the badge sits in the same corner whichever way the
    // board faces. Empty text draws nothing rather than an unlabelled disc.
    if (!marker.text) return '';
    const cx = center.x + GLYPH_OFFSET;
    const cy = center.y - GLYPH_OFFSET;
    return (
      `<g class="${className} xq-marker--glyph">` +
      `<circle class="xq-marker__disc" cx="${cx}" cy="${cy}" r="${GLYPH_RADIUS}"/>` +
      `<text class="xq-marker__label" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${GLYPH_FONT_SIZE}">${escapeHtml(marker.text)}</text>` +
      `</g>`
    );
  }
  if (marker.kind === 'circle') {
    return `<circle class="${className} xq-marker--circle" cx="${center.x}" cy="${center.y}" r="${MARKER_RING_RADIUS}" fill="none" stroke-width="5"/>`;
  }
  return `<polygon class="${className} xq-marker--star" points="${starPoints(center.x, center.y)}"/>`;
}

// Markers split across TWO layers: point decorations (stars / annotation rings)
// sit under the arrows as they always have, and judgment badges sit OVER them.
// An arrow lands on the same point the badge annotates, so in one layer the
// arrowhead would cover the verdict it is competing with for attention.
function markerLayer(
  markers: readonly XiangqiBoardMarker[],
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
  band: 'point' | 'glyph',
): string {
  return markers
    .filter((marker) => (marker.kind === 'glyph') === (band === 'glyph'))
    .map((marker) => xiangqiMarkerSvg(marker, perspective, layout))
    .join('');
}

function selectionLayer(
  square: XiangqiSquare | null,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
): string {
  if (!square) return '';
  const coord = coordOf(square);
  const center = intersection(coord.file, coord.rank, perspective, layout);
  return `<circle class="xq-live-selection-cell" cx="${center.x}" cy="${center.y}" r="30"/>`;
}

function hintLayer(
  view: StandardXiangqiPlayerView,
  perspective: XiangqiColor,
  selectedSquare: XiangqiSquare | null,
  layout: XiangqiBoardLayout,
): string {
  if (!selectedSquare) return '';
  return view.legalMoves
    .filter((move) => move.from === selectedSquare)
    .map((move) => {
      const coord = coordOf(move.to);
      const center = intersection(coord.file, coord.rank, perspective, layout);
      const occupied = view.board[move.to] !== undefined;
      return occupied
        ? `<circle class="xq-live-hint-capture" cx="${center.x}" cy="${center.y}" r="28"/>`
        : `<circle class="xq-live-hint-dot" cx="${center.x}" cy="${center.y}" r="7"/>`;
    })
    .join('');
}

function pieceLayer(
  view: StandardXiangqiPlayerView,
  perspective: XiangqiColor,
  draggingFromSquare: XiangqiSquare | null,
  layout: XiangqiBoardLayout,
  pieceSet?: XiangqiPieceSet,
): string {
  const parts: string[] = [];
  for (const [square, piece] of Object.entries(view.board)) {
    if (!piece) continue;
    const dragSource = square === draggingFromSquare;
    const coord = coordOf(square as XiangqiSquare);
    const center = intersection(coord.file, coord.rank, perspective, layout);
    // A soldier past the river renders with the promoted-soldier art. Mirrors
    // hasCrossedRiver()/inOwnHalf() in packages/game (red owns ranks 1-5, black
    // 6-10); coordOf().rank is the same 1-10 rank those use.
    const crossed =
      piece.role === 'soldier' && (piece.color === 'red' ? coord.rank >= 6 : coord.rank <= 5);
    const pieceSvg = renderXiangqiPiece(piece, {
      x: center.x - PIECE_SIZE / 2,
      y: center.y - PIECE_SIZE / 2,
      size: PIECE_SIZE,
      className: dragSource ? 'xq-piece xq-piece--drag-source' : 'xq-piece',
      crossed,
      ...(pieceSet ? { pieceSet } : {}),
    });
    // Keyed slot: a <g> wrapper per occupied square so a post-render glide can
    // find and transform the piece (transforms on the inner <svg x= y=> element
    // are inconsistent cross-browser; the wrapper animates cleanly).
    parts.push(`<g class="xq-piece-slot" data-piece-square="${square}">${pieceSvg}</g>`);
  }
  return parts.join('');
}

/**
 * Glide the piece that just settled on `move.to` from its origin (lichess-style),
 * or with `reverse` the piece back on `move.from` from the destination (a replay
 * back-step). Call AFTER the innerHTML swap that rendered the final position.
 * No-ops when animations are off (pref/reduced-motion), when the slot is missing
 * (capture-undo edge, disabled board), or when the geometry is degenerate. The
 * move must come from a payload the client already received (an event, a view's
 * lastMove, a timeline row) — never from diffing two boards on a fog surface.
 */
export function animateXiangqiBoardMove(
  host: HTMLElement,
  move: { from: XiangqiSquare; to: XiangqiSquare },
  perspective: XiangqiColor,
  opts: { reverse?: boolean } = {},
): void {
  const duration = pieceAnimationDurationMs();
  if (duration <= 0) return;
  const settleSquare = opts.reverse ? move.from : move.to;
  const originSquare = opts.reverse ? move.to : move.from;
  const slot = host.querySelector(`[data-piece-square="${settleSquare}"]`);
  if (!slot) return;
  const origin = coordOf(originSquare);
  const settle = coordOf(settleSquare);
  const layout = mountedXiangqiBoardLayout(host);
  const from = intersection(origin.file, origin.rank, perspective, layout);
  const to = intersection(settle.file, settle.rank, perspective, layout);
  glideSvgPiece(slot, from.x - to.x, from.y - to.y, duration);
  // Draw the destination marker on as the piece lands (forward moves only). On
  // intersection boards this is the gold ring; on square grids it is the
  // destination-cell wash. A reverse step renders the prior move's marker at a
  // different square, so fading it would not track the reverse glide.
  if (!opts.reverse) {
    drawMarkerOnArrival(host.querySelector(BOARD_LASTMOVE_MARKER_SELECTOR), duration);
  }
}

function clickLayer(
  view: StandardXiangqiPlayerView,
  perspective: XiangqiColor,
  selectedSquare: XiangqiSquare | null,
  layout: XiangqiBoardLayout,
): string {
  const targets = new Map<XiangqiSquare, { capture: boolean }>();
  if (selectedSquare) {
    for (const move of view.legalMoves) {
      if (move.from === selectedSquare) {
        targets.set(move.to, { capture: view.board[move.to] !== undefined });
      }
    }
  }
  const parts: string[] = [];
  for (let file = 0; file < FILE_COUNT; file++) {
    for (let rank = 1; rank <= RANK_COUNT; rank++) {
      const square = `${FILES[file]}${rank}` as XiangqiSquare;
      const center = intersection(file, rank, perspective, layout);
      const target = targets.get(square);
      const marker = target
        ? target.capture
          ? `<circle class="xq-live-hint-capture" cx="${center.x}" cy="${center.y}" r="28"/>`
          : `<circle class="xq-live-hint-dot" cx="${center.x}" cy="${center.y}" r="7"/>`
        : '';
      const hover = target
        ? `<circle class="xq-live-target-hover" cx="${center.x}" cy="${center.y}" r="31"/>`
        : '';
      parts.push(
        `<g class="xq-live-hit${target ? ' xq-live-hit--target' : ''}" data-square="${square}">${hover}${marker}<rect x="${center.x - HIT_HALF}" y="${center.y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}"/></g>`,
      );
    }
  }
  return parts.join('');
}

/** Piece sprite size in viewBox units; drag ghosts are mounted at this size. */
export const XIANGQI_PIECE_SIZE = PIECE_SIZE;

// The standalone piece SVG for the floating drag ghost (board-drag.ts mounts it
// in a sized <div>).
// `crossed` is the drag origin's river state: without it a promoted soldier
// reverts to recruit art the moment it is picked up.
export function xiangqiPieceGhostSvg(piece: XiangqiPiece, crossed = false): string {
  return renderXiangqiPiece(piece, {
    ariaLabel: `${piece.color} ${piece.role}`,
    className: 'xq-piece',
    size: PIECE_SIZE,
    crossed,
  });
}

// ── Pure click-to-move decision ──────────────────────────────────────────────

export type XiangqiClickResult =
  | { kind: 'select'; square: XiangqiSquare }
  | { kind: 'clear' }
  | { kind: 'move'; move: XiangqiMove }
  | { kind: 'noop' };

// Pure click-to-move decision over an open-information view: only the interacting
// seat's own pieces with at least one legal move are selectable. Live passes the
// player's fixed seat; analysis passes the side to move (so both colours play).
export function xiangqiClickResult(
  view: StandardXiangqiPlayerView,
  seat: unknown,
  selected: XiangqiSquare | null,
  square: XiangqiSquare,
): XiangqiClickResult {
  if (!canInteract(view, seat)) return { kind: 'noop' };
  if (!selected) {
    return canSelect(view, seat, square) ? { kind: 'select', square } : { kind: 'noop' };
  }
  if (selected === square) return { kind: 'clear' };
  const move = view.legalMoves.find(
    (candidate) => candidate.from === selected && candidate.to === square,
  );
  if (move) return { kind: 'move', move };
  return canSelect(view, seat, square) ? { kind: 'select', square } : { kind: 'clear' };
}

function canInteract(view: StandardXiangqiPlayerView, seat: unknown): boolean {
  return view.status.type === 'playing' && isXiangqiColor(seat) && view.status.turn === seat;
}

function canSelect(view: StandardXiangqiPlayerView, seat: unknown, square: XiangqiSquare): boolean {
  if (!canInteract(view, seat)) return false;
  const piece = view.board[square];
  if (!piece || piece.color !== seat) return false;
  return view.legalMoves.some((move) => move.from === square);
}

// ── Instance-based interactive board ─────────────────────────────────────────

export interface XiangqiInteractiveBoardOptions {
  /** Persistent board host; click + drag are delegated here once so they survive
   *  innerHTML re-renders. */
  board: HTMLElement;
  /** View used for click/drag legality at event time (live: room truth; analysis:
   *  the current tree node's truth view). */
  getInteractionView: () => StandardXiangqiPlayerView | null;
  /** Board orientation. */
  getPerspective: () => XiangqiColor;
  /** Whose pieces are interactive for a view. Live: the player's fixed seat;
   *  analysis: `view.status.turn` (the side to move). Return null = nobody. */
  seatFor: (view: StandardXiangqiPlayerView) => XiangqiColor | null;
  /** Outer gate. Live: connected AND not scrubbing history; analysis: always true. */
  enabled: () => boolean;
  /** A legal move was chosen (click or drop). Caller applies it — live sends to
   *  the server (and may play a sound); analysis appends to the move tree. */
  onMove: (move: XiangqiMove, view: StandardXiangqiPlayerView) => void;
  /** Optional: a right-button draw gesture completed (study annotation). `orig` is
   *  the pressed square; `dest` is where it released (null off-board, or === orig
   *  for a tap → circle; else an arrow). `alt` = modifier held (secondary brush).
   *  Absent = no draw affordance (live boards). The caller owns shape state and
   *  repaints via setArrows / setMarkers. */
  onDrawShape?: (orig: XiangqiSquare, dest: XiangqiSquare | null, opts: { alt: boolean }) => void;
}

export interface XiangqiInteractiveBoard {
  /** Re-render for a display view (tenant frame / analysis node change). */
  render(view: StandardXiangqiPlayerView | null, perspective: XiangqiColor): void;
  /** Clear the current selection (no render). */
  clearSelection(): void;
  /** Replace the arrow overlay (engine PV hints). Updates the mounted SVG in
   *  place when present; the arrows persist across full re-renders until the
   *  next setArrows call. Pass [] to clear. */
  setArrows(arrows: readonly XiangqiBoardArrow[]): void;
  /** Replace the point-marker overlay (learn stars / annotation rings). Same
   *  persistence contract as setArrows. Pass [] to clear. */
  setMarkers(markers: readonly XiangqiBoardMarker[]): void;
}

export function createXiangqiInteractiveBoard(
  opts: XiangqiInteractiveBoardOptions,
): XiangqiInteractiveBoard {
  let selectedSquare: XiangqiSquare | null = null;
  let draggingFrom: XiangqiSquare | null = null;
  let arrows: readonly XiangqiBoardArrow[] = [];
  let markers: readonly XiangqiBoardMarker[] = [];

  function render(view: StandardXiangqiPlayerView | null, perspective: XiangqiColor): void {
    if (!view) {
      opts.board.replaceChildren();
      return;
    }
    opts.board.innerHTML = xiangqiBoardSvg(view, perspective, {
      interactive: true,
      selectedSquare,
      draggingFrom,
      arrows,
      markers,
    });
  }

  function setArrows(next: readonly XiangqiBoardArrow[]): void {
    arrows = next;
    // Engine updates stream ~12/s: patch just the arrows group instead of
    // rebuilding the whole board SVG (which would also be wasted work mid-drag).
    const layer = opts.board.querySelector('.xq-live-arrows');
    if (layer) {
      const layout = mountedXiangqiBoardLayout(opts.board);
      layer.innerHTML = arrows
        .map((a) => xiangqiArrowSvg(a, opts.getPerspective(), layout))
        .join('');
    }
  }

  function setMarkers(next: readonly XiangqiBoardMarker[]): void {
    markers = next;
    const layout = mountedXiangqiBoardLayout(opts.board);
    // Two bands, patched together — same split the full render does, so a
    // streamed update and a fresh render agree on what sits above the arrows.
    for (const [selector, band] of [
      ['.xq-live-markers', 'point'],
      ['.xq-live-glyphs', 'glyph'],
    ] as const) {
      const layer = opts.board.querySelector(selector);
      if (layer) layer.innerHTML = markerLayer(markers, opts.getPerspective(), layout, band);
    }
  }

  // Re-render from the live interaction view after a click/drag mutation.
  function rerender(): void {
    render(opts.getInteractionView(), opts.getPerspective());
  }

  function clearSelection(): void {
    selectedSquare = null;
    draggingFrom = null;
  }

  function handleClick(square: XiangqiSquare): void {
    if (opts.enabled()) {
      const view = opts.getInteractionView();
      if (view) {
        const result = xiangqiClickResult(view, opts.seatFor(view), selectedSquare, square);
        if (result.kind === 'select') {
          selectedSquare = result.square;
        } else if (result.kind === 'clear') {
          selectedSquare = null;
        } else if (result.kind === 'move') {
          selectedSquare = null;
          opts.onMove(result.move, view);
        }
      }
    }
    rerender();
  }

  function canDrag(square: XiangqiSquare): boolean {
    if (!opts.enabled()) return false;
    const view = opts.getInteractionView();
    if (!view) return false;
    const seat = opts.seatFor(view);
    if (!isXiangqiColor(seat)) return false;
    if (view.status.type !== 'playing' || view.status.turn !== seat) return false;
    const piece = view.board[square];
    if (!piece) return false;
    return piece.color === seat;
  }

  function handleDrop(from: XiangqiSquare, to: XiangqiSquare | null): void {
    draggingFrom = null;
    const view = opts.getInteractionView();
    const move =
      to && view ? view.legalMoves.find((m) => m.from === from && m.to === to) : undefined;
    selectedSquare = null;
    if (move && view) opts.onMove(move, view);
    rerender();
  }

  installBoardDrag({
    board: opts.board,
    ghostSizePx: PIECE_SIZE,
    onSquareClick: (square) => handleClick(square as XiangqiSquare),
    canDragFrom: (square) => canDrag(square as XiangqiSquare),
    ghostHtml: (square) => {
      const piece = opts.getInteractionView()?.board[square as XiangqiSquare];
      if (!piece) return null;
      return xiangqiPieceGhostSvg(
        piece,
        drawsCrossedSoldier(piece, coordOf(square as XiangqiSquare).rank),
      );
    },
    onDragStart: (from) => {
      selectedSquare = from as XiangqiSquare;
      draggingFrom = from as XiangqiSquare;
      rerender();
    },
    onDrop: (from, to) => handleDrop(from as XiangqiSquare, to as XiangqiSquare | null),
  });

  if (opts.onDrawShape) {
    const onDrawShape = opts.onDrawShape;
    installBoardDraw({
      board: opts.board,
      onDraw: (orig, dest, drawOpts) =>
        onDrawShape(orig as XiangqiSquare, dest as XiangqiSquare | null, drawOpts),
    });
  }

  installSelectionClickAway({
    roots: () => [opts.board],
    hasSelection: () => selectedSquare !== null,
    clearSelection: () => {
      clearSelection();
      rerender();
    },
  });

  return { render, clearSelection, setArrows, setMarkers };
}

// ── Geometry ─────────────────────────────────────────────────────────────────

function intersection(
  file: number,
  rank: number,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout = 'intersection',
): { x: number; y: number } {
  return xiangqiBoardPoint(file, rank, perspective, layout, LIVE_BOARD_GEO);
}

function coordOf(square: XiangqiSquare): { file: number; rank: number } {
  return {
    file: Math.max(0, FILES.indexOf(square[0] ?? '')),
    rank: Number(square.slice(1)),
  };
}

function mountedXiangqiBoardLayout(host: ParentNode): XiangqiBoardLayout {
  const layout = host.querySelector('.xq-live-svg')?.getAttribute('data-xiangqi-layout');
  return layout === 'cell' || layout === 'intersection' ? layout : readStoredXiangqiBoardLayout();
}

export function isXiangqiColor(value: unknown): value is XiangqiColor {
  return value === 'red' || value === 'black';
}
