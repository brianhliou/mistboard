import {
  ALL_BANQI_SQUARES,
  type BanqiColor,
  type BanqiMove,
  type BanqiPieceRole,
  type BanqiPlayerView,
  type BanqiSeat,
  type BanqiSquare,
  banqiCoordOf,
  banqiLastMoverInk,
} from '@mistboard/game';
import {
  drawMarkerOnArrival,
  flipSvgPiece,
  glideSvgPiece,
  type PieceFlipEdge,
  type PieceFlipStyle,
  pieceAnimationDurationMs,
  pieceFlipDurationMs,
  pieceFlipStyle,
} from './board-anim.js';
import { BOARD_LASTMOVE_MARKER_SELECTOR } from './board-lastmove.js';
import {
  boardCornerRadius,
  roundPieceBox,
  tokenPieceSize,
  XIANGQI_PIECE_OUTLINE_SHARE,
} from './board-metrics.js';
import { type SvgBoardArrowStyle, svgBoardArrow } from './svg-board-arrow.js';
import {
  GLYPH_OFFSET_RATIO,
  GLYPH_RADIUS_RATIO,
  type SvgBoardMarkerStyle,
  svgBoardCircleMarker,
  svgBoardGlyphMarker,
} from './svg-board-marker.js';
import { flipTileOverlay } from './tile-flip-3d.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import {
  renderXiangqiPieceGlyphed,
  XIANGQI_PIECE_SHADOW,
  type XiangqiPieceSet,
  type XiangqiPieceShape,
  xiangqiBanqiBackMarks,
  xiangqiPieceShadowEnabled,
  xiangqiPieceShadowMarks,
  xiangqiTileBacking,
} from './xiangqi-piece-sets.js';

// Bespoke SVG renderer for the banqi board, drawn as the bottom HALF of a xiangqi
// board in its natural HORIZONTAL orientation: 8 files run left-to-right, 4 ranks
// bottom-to-top. The 8x4 banqi cells are the 32 cells bounded by a 9x5 line grid
// (half a xiangqi board); the 32 pieces sit in the CELL centres. The board is a
// plain grid — the parent board's palace and soldier/cannon starting-point marks
// are deliberately NOT drawn: banqi keeps none of those rules (no palace
// confinement, no fixed start array), so they would be purely decorative noise.
//
// Banqi is symmetric-information: BOTH seats see the IDENTICAL board (no per-seat
// flip), and a face-down tile carries NO colour or identity to anyone (the deal
// is the only hidden state, hidden from both). A face-down piece renders as a
// uniform disc (one colour, leaking nothing); a revealed piece renders with its
// xiangqi glyph.

const FILES = 8; // cells across (9 vertical lines / files a..i)
const RANKS = 4; // cells down (5 horizontal lines / ranks 1..5, river at the top)
const CELL = 64;
const MARGIN = 28;
// Banqi's piece look (Brian, 2026-10-14): a disc on every banqi board, never the
// grid boards' rounded square, its outer edge at 92% of the cell (not the 98% of
// the xiangqi family: banqi pieces sit in cells side by side, so they keep a gap).
// The box a piece is drawn in is cell x 0.92 / 0.948, since the outline ends at
// 94.8 of its 100-unit box. Face-down backs match the faces' outer size and shape.
export const BANQI_PIECE_SHAPE: XiangqiPieceShape = 'disc';
export const BANQI_PIECE_REACH = 0.92;
/** The box a banqi piece is drawn in on a board of this cell. */
export function banqiPieceDrawSize(cell: number): number {
  return roundPieceBox((cell * BANQI_PIECE_REACH) / XIANGQI_PIECE_OUTLINE_SHARE);
}
const PIECE_SIZE = banqiPieceDrawSize(CELL);
/** Half the piece's outer edge, the radius a mark ON the piece's edge uses. */
const PIECE_EDGE_R = (CELL * BANQI_PIECE_REACH) / 2;
/** The layout piece size the engine marker was tuned on. */
const MARK_PIECE_SIZE = tokenPieceSize(CELL);
const WIDTH = MARGIN * 2 + FILES * CELL;
const HEIGHT = MARGIN * 2 + RANKS * CELL;
const HIT_HALF = CELL / 2 - 1;
// Engine candidate marker. Was sharing the last-move ring's radius, which tied an
// unrelated mark to that ring's geometry; the other boards size it from the piece
// like their selection ring, so do the same here.
const ENGINE_MARKER_RADIUS = MARK_PIECE_SIZE / 2 + 6;
// Last move: banqi TINTS THE CELL instead of ringing the piece, and this is the
// one board on which that is the right call.
//
// board-lastmove.ts sizes both of its marks so the outer edge lands at half a
// cell. Every other board on that layer anchors pieces to INTERSECTIONS, where
// half a cell is open board. Banqi anchors to cell centres, where half a cell is
// the drawn grid line: the mark traced the cell exactly, erased the lines it
// crossed, and two marks on adjacent cells merged into a single blob (a1-b1 in
// any game). The reveal ring for flips sat 2.9 units FURTHER out, so it bled
// into the neighbouring cell outright.
//
// There was no room to shrink into. TOKEN_PIECE_RATIO is 0.90, so a halo living
// outside the piece (radius 29) and inside the cell (32) has three units to work
// with, and the shared geometry spent all of them. A cell tint is bounded by the
// cell by construction: adjacent marks cannot collide at any board scale, and
// the fill has the area to carry the mover's ink, which a 4-unit ring did not.
// The tint fills the cell edge to edge with square corners: this board IS a grid
// of squares, so a mark that traces the square is the honest one, and a rounded
// inset chip reads as a sticker floating in the cell rather than the cell being
// lit. Two adjacent marks therefore share an edge and paint over the grid line
// between them -- accepted, because the origin/destination opacity step still
// separates them and the pair reads as the path the piece took.
const LAST_MOVE_FLIP_STROKE = 2.5;
// A stroke straddles its rect's edge, so the flip's border needs half of itself
// back inside or it paints into the next cell -- the whole failure this
// treatment exists to end.
const LAST_MOVE_FLIP_INSET = LAST_MOVE_FLIP_STROKE / 2;

export const BANQI_PIECE_PX = PIECE_SIZE;

export type BanqiBoardRenderOptions = {
  arrows?: readonly BanqiBoardArrow[];
  markers?: readonly BanqiBoardMarker[];
  interactive?: boolean;
  // The selected own revealed piece (move source), if any.
  selectedSquare?: BanqiSquare | null;
  // Board moves of the selected piece (flips excluded — a face-down tile is
  // clicked directly to flip, so it needs no target dot).
  legalMoves?: readonly BanqiMove[];
  // Moves of the selected piece that the 長捉 rule forbids (view.forbiddenMoves):
  // each destination gets a red cross where its dot would be. Interactive only.
  forbiddenMoves?: readonly BanqiMove[];
  pieceSet?: XiangqiPieceSet;
  // While dragging, render the origin as a dim source shadow.
  draggingFrom?: BanqiSquare | null;
  // Coordinate labels (the site-wide Board coordinates setting, #308): callers
  // pass boardCoordinatesEnabled(); authored diagrams leave it off.
  coordinates?: boolean;
  // Spike (?tile=3d): tiles with a visible rim. Unset reads the flag.
  tile3d?: boolean;
};

export interface BanqiBoardArrow extends SvgBoardArrowStyle {
  from: BanqiSquare;
  to: BanqiSquare;
}

export interface BanqiBoardMarker extends SvgBoardMarkerStyle {
  square: BanqiSquare;
  kind: 'circle' | 'glyph';
  /** Badge label for kind 'glyph' (e.g. '??'). Ignored by 'circle'. */
  text?: string;
}

// The standalone disc for the floating drag ghost (board-drag.ts mounts it in a
// sized <div>). Only revealed pieces are draggable, so the entry is always known.
export function banqiPieceGhostSvg(
  entry: { color: BanqiColor; role: BanqiPieceRole },
  pieceSet?: XiangqiPieceSet,
): string {
  const set = pieceSet ?? readStoredXiangqiPieceSet();
  const inner = renderXiangqiPieceGlyphed(entry, set, {
    ariaLabel: `${entry.color} ${entry.role}`,
    className: 'banqi-piece',
    shrouded: false,
    x: 0,
    y: 0,
    size: PIECE_SIZE,
    shape: BANQI_PIECE_SHAPE,
  });
  return `<svg width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 ${PIECE_SIZE} ${PIECE_SIZE}" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}

// The editor's ghost for a face-down tile: the same back the board draws.
export function banqiFaceDownGhostSvg(pieceSet?: XiangqiPieceSet): string {
  const set = pieceSet ?? readStoredXiangqiPieceSet();
  const c = PIECE_SIZE / 2;
  return `<svg width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 ${PIECE_SIZE} ${PIECE_SIZE}" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${faceDownDisc(c, c, set)}</svg>`;
}

// A line intersection. `fileLine` 0..8 runs left→right (file a at the left);
// `rankLine` 0..4 runs top→bottom (the river edge at the top, rank 1 at the
// bottom).
function point(fileLine: number, rankLine: number): { x: number; y: number } {
  return { x: MARGIN + fileLine * CELL, y: MARGIN + rankLine * CELL };
}

// A cell centre for a banqi square (file 0..7 across, rank 1..4 up; identical for
// both seats, no flip — rank 1 sits at the bottom).
function cellCenter(square: BanqiSquare): { x: number; y: number } {
  const { file, rank } = banqiCoordOf(square);
  return { x: MARGIN + (file + 0.5) * CELL, y: MARGIN + (4.5 - rank) * CELL };
}

export function banqiArrowSvg(arrow: BanqiBoardArrow): string {
  const scaledArrow = {
    ...arrow,
    width: arrow.width === undefined ? undefined : arrow.width * (CELL / 72),
  };
  return svgBoardArrow(scaledArrow, cellCenter(arrow.from), cellCenter(arrow.to), {
    baseClassName: 'xq-arrow',
    defaultWidth: 8,
    startInset: 10,
  });
}

export function banqiMarkerSvg(marker: BanqiBoardMarker): string {
  const center = cellCenter(marker.square);
  if (marker.kind === 'glyph') {
    return svgBoardGlyphMarker(
      marker,
      center,
      CELL * GLYPH_RADIUS_RATIO,
      CELL * GLYPH_OFFSET_RATIO,
      {
        baseClassName: 'xq-marker',
      },
    );
  }
  return svgBoardCircleMarker(marker, center, ENGINE_MARKER_RADIUS, {
    baseClassName: 'xq-marker engine-marker',
  });
}

function gridLines(): string {
  const parts: string[] = [];
  const a = point(0, 0);
  const z = point(FILES, RANKS);
  for (let r = 0; r <= RANKS; r += 1) {
    const y = MARGIN + r * CELL;
    parts.push(`<line x1="${a.x}" y1="${y}" x2="${z.x}" y2="${y}"/>`);
  }
  for (let f = 0; f <= FILES; f += 1) {
    const x = MARGIN + f * CELL;
    parts.push(`<line x1="${x}" y1="${a.y}" x2="${x}" y2="${z.y}"/>`);
  }
  return parts.join('');
}

/** The jade back's radius in a piece box of `size`: its outer edge (r plus half its
 *  2-unit stroke, .banqi-back > circle) lands where a face's outline ends, 47.4 of
 *  the 100-unit box. */
export function banqiFaceDownRadius(size: number): number {
  return Math.round((size * 0.474 - 1) * 100) / 100;
}

// A uniform face-down disc: one colour, a single ring, no glyph (the deal is
// hidden from both). A flat disc with no inner ring keeps the back clean. The
// photo and printed sets draw the back their Xiangqi Mahjong tiles show
// (xiangqiBanqiBackMarks), one look for both sides since a banqi tile must not
// tell its colour; Mistboard's own sets keep this jade disc, as Mahjong does.
function faceDownDisc(
  cx: number,
  cy: number,
  pieceSet: XiangqiPieceSet,
  className = 'banqi-back',
  tile3d = false,
): string {
  if (tile3d) {
    return banqiTile3dMarkup({ x: cx, y: cy }, null, pieceSet, {
      dragSource: className.includes('banqi-drag-source'),
    });
  }
  return faceDownDiscFlat(cx, cy, pieceSet, className, xiangqiPieceShadowEnabled());
}

function faceDownDiscFlat(
  cx: number,
  cy: number,
  pieceSet: XiangqiPieceSet,
  className: string,
  shadowOn: boolean,
  box = PIECE_SIZE,
): string {
  const marks = xiangqiBanqiBackMarks(pieceSet);
  if (marks) {
    const x = cx - box / 2;
    const y = cy - box / 2;
    // The asset backs are normalised to a radius-45 disc, like the faces.
    const shadow = shadowOn ? xiangqiPieceShadowMarks(45) : '';
    const overflowAttr = shadow ? ' overflow="visible"' : '';
    return `<g class="${className}"><svg x="${x}" y="${y}" width="${box}" height="${box}"${overflowAttr} viewBox="0 0 100 100">${shadow}${marks}</svg></g>`;
  }
  const r = banqiFaceDownRadius(box);
  // The disc's outer edge includes its 2-unit stroke (.banqi-back > circle).
  const shadow = shadowOn ? xiangqiPieceShadowMarks(r + 1, cx, cy, box) : '';
  return [
    `<g class="${className}">`,
    shadow,
    `<circle cx="${cx}" cy="${cy}" r="${r}"/>`,
    `</g>`,
  ].join('');
}

function pieceLayer(
  view: BanqiPlayerView,
  pieceSet: XiangqiPieceSet,
  draggingFrom: BanqiSquare | null,
  tile3d = false,
): string {
  return ALL_BANQI_SQUARES.map((square) => {
    const entry = view.board[square];
    if (!entry) return '';
    const dragSource = square === draggingFrom;
    if (tile3d) {
      const tile = entry.faceDown ? null : { color: entry.color, role: entry.role };
      const markup = banqiTile3dMarkup(cellCenter(square), tile, pieceSet, { dragSource });
      return `<g class="banqi-piece-slot" data-piece-square="${square}">${markup}</g>`;
    }
    const { x, y } = cellCenter(square);
    const pieceSvg = entry.faceDown
      ? faceDownDisc(x, y, pieceSet, dragSource ? 'banqi-back banqi-drag-source' : 'banqi-back')
      : renderXiangqiPieceGlyphed({ color: entry.color, role: entry.role }, pieceSet, {
          ariaLabel: `${entry.color} ${entry.role}`,
          className: dragSource ? 'banqi-piece banqi-drag-source' : 'banqi-piece',
          shrouded: false,
          x: x - PIECE_SIZE / 2,
          y: y - PIECE_SIZE / 2,
          size: PIECE_SIZE,
          shape: BANQI_PIECE_SHAPE,
        });
    return `<g class="banqi-piece-slot" data-piece-square="${square}">${pieceSvg}</g>`;
  }).join('');
}

/**
 * Glide the piece that settled on `move.to` from its origin (or with `reverse`
 * the piece back on `move.from`), then draw the destination halo on as it lands.
 * Call AFTER the innerHTML swap that rendered the final position.
 *
 * Flips are self-moves with nothing to travel, so they are a no-op here: the
 * reveal is the tile changing face in place, and the marker layer already says
 * where. Banqi has no per-seat flip (both seats see the same board), so unlike
 * the xiangqi family there is no perspective to pass.
 */
export function animateBanqiBoardMove(
  host: HTMLElement,
  move: { from: BanqiSquare; to: BanqiSquare },
  opts: { reverse?: boolean } = {},
): void {
  if (move.from === move.to) return;
  const duration = pieceAnimationDurationMs();
  if (duration <= 0) return;
  const settleSquare = opts.reverse ? move.from : move.to;
  const originSquare = opts.reverse ? move.to : move.from;
  const slot = host.querySelector(`[data-piece-square="${settleSquare}"]`);
  if (!slot) return;
  const from = cellCenter(originSquare);
  const to = cellCenter(settleSquare);
  glideSvgPiece(slot, from.x - to.x, from.y - to.y, duration);
  // A reverse step renders the prior move's marker at a different square, so
  // fading it in would not track the reverse glide.
  if (!opts.reverse) {
    drawMarkerOnArrival(host.querySelector(BOARD_LASTMOVE_MARKER_SELECTOR), duration);
  }
}

// The selection tints the whole cell, grid line to grid line: pieces sit in
// cells here, so the cell is the unit, and an inset rounded rect read as a
// sticker behind the piece rather than a selected square (Brian, 2026-09-21,
// on the rules-page diagrams that draw exactly this).
function selectionRing(selection: BanqiSquare | null): string {
  if (!selection) return '';
  const { x, y } = cellCenter(selection);
  return `<rect class="banqi-selection" x="${x - CELL / 2}" y="${y - CELL / 2}" width="${CELL}" height="${CELL}"/>`;
}

// A capturable piece is outlined in the hint green: the ring sits ON the
// piece's own edge (PIECE_EDGE_R), wide enough to replace its outline. A ring
// outside the piece would cross into the neighbouring cell, since a piece
// fills 92% of its cell. Same radius in the static and interactive layers.
const CAPTURE_RING_R = PIECE_EDGE_R;
const HINT_DOT_R = 10;
// Half the arm span of the 長捉 cross: a little wider than the dot it replaces, so
// it reads as a mark rather than a smudge, still well inside the empty cell.
const FORBIDDEN_CROSS_HALF = 9;

// A red cross where a legal-move dot would be: the move exists, but the 長捉 rule
// forbids it right now. Chase moves are quiet, so the cell is always empty.
function forbiddenCross(x: number, y: number): string {
  const h = FORBIDDEN_CROSS_HALF;
  return `<path class="banqi-hint-forbidden" d="M${x - h} ${y - h}L${x + h} ${y + h}M${x + h} ${y - h}L${x - h} ${y + h}"/>`;
}

// Drawn ABOVE the piece layer, where the interactive hit layer draws the same
// marks: a capture ring sits around the target piece, and under the pieces it
// was hidden by the piece's own outline (the rules diagrams found this).
function moveHints(view: BanqiPlayerView, moves: readonly BanqiMove[]): string {
  return moves
    .filter((move) => move.from !== move.to)
    .map((move) => {
      const { x, y } = cellCenter(move.to);
      const occupant = view.board[move.to];
      const capture = !!occupant && !occupant.faceDown;
      return capture
        ? `<circle class="banqi-hint-capture" cx="${x}" cy="${y}" r="${CAPTURE_RING_R}"/>`
        : `<circle class="banqi-hint" cx="${x}" cy="${y}" r="${HINT_DOT_R}"/>`;
    })
    .join('');
}

function lastMoveCell(
  square: BanqiSquare,
  modifier: string,
  ink: BanqiColor | null,
  inset = 0,
): string {
  const { x, y } = cellCenter(square);
  const span = CELL - inset * 2;
  const inkClass = ink ? ` banqi-lastmove--${ink}` : '';
  return `<rect class="banqi-lastmove ${modifier}${inkClass}" x="${x - span / 2}" y="${y - span / 2}" width="${span}" height="${span}"/>`;
}

function lastMoveMarkers(view: BanqiPlayerView): string {
  if (!view.lastMove) return '';
  // Ink of the side that ACTED, never the ink of the piece a flip turned up:
  // a flip reveals a random tile, so the two disagree about half the time and
  // reading the mark off the board would be wrong exactly where it is needed.
  const ink = banqiLastMoverInk(view);
  // A flip is a self-move: one cell, never an invented origin to wash. One
  // tinted cell already reads as a flip against a move's two, and the border
  // says so without depending on the viewer seeing both cells at once.
  if (view.lastMove.from === view.lastMove.to) {
    return lastMoveCell(
      view.lastMove.to,
      'banqi-lastmove-to banqi-lastmove-flip',
      ink,
      LAST_MOVE_FLIP_INSET,
    );
  }
  return (
    lastMoveCell(view.lastMove.from, 'banqi-lastmove-from', ink) +
    lastMoveCell(view.lastMove.to, 'banqi-lastmove-to', ink)
  );
}

function hitLayerWithTargets(
  moves: readonly BanqiMove[],
  view?: BanqiPlayerView,
  forbiddenMoves: readonly BanqiMove[] = [],
): string {
  const targets = new Map<BanqiSquare, { capture: boolean }>();
  if (view) {
    for (const move of moves) {
      const occupant = view.board[move.to];
      targets.set(move.to, { capture: !!occupant && !occupant.faceDown });
    }
  }
  const forbidden = new Set(forbiddenMoves.map((move) => move.to));
  return ALL_BANQI_SQUARES.map((square) => {
    const { x, y } = cellCenter(square);
    const target = targets.get(square);
    if (!target && forbidden.has(square)) {
      return `<g data-square="${square}" data-forbidden-move="true" class="banqi-hit banqi-hit--forbidden">${forbiddenCross(x, y)}<rect x="${x - HIT_HALF}" y="${y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}"/></g>`;
    }
    const marker = target
      ? target.capture
        ? `<circle class="banqi-hint-capture" cx="${x}" cy="${y}" r="${CAPTURE_RING_R}"/>`
        : `<circle class="banqi-hint" cx="${x}" cy="${y}" r="${HINT_DOT_R}"/>`
      : '';
    const hover = target
      ? `<rect class="banqi-target-hover" x="${x - HIT_HALF}" y="${y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}" rx="6"/>`
      : '';
    return `<g data-square="${square}" class="banqi-hit${target ? ' banqi-hit--target' : ''}">${hover}${marker}<rect x="${x - HIT_HALF}" y="${y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}"/></g>`;
  }).join('');
}

// Coordinates (#308), in the move list's own names: files a-h left to right
// along the bottom, ranks 1-4 bottom to top up the left side, so "b3-b2" or
// "a4" in the score sheet is read straight off the board. Banqi shows one board
// to both seats, so the labels never flip. They sit in the frame margin, which
// a piece never reaches (it stops 3 units inside its cell), so nothing resizes
// when the setting flips.
export function banqiCoordinateLabels(): string {
  const size = 15;
  const bottomY = HEIGHT - MARGIN / 2;
  const leftX = MARGIN / 2;
  const parts: string[] = [];
  for (let file = 0; file < FILES; file += 1) {
    const { x } = cellCenter(`${'abcdefgh'[file]}1` as BanqiSquare);
    parts.push(coordLabel(x, bottomY, 'abcdefgh'[file] ?? '', size));
  }
  for (let rank = 1; rank <= RANKS; rank += 1) {
    const { y } = cellCenter(`a${rank}` as BanqiSquare);
    parts.push(coordLabel(leftX, y, String(rank), size));
  }
  return `<g class="banqi-coords" aria-hidden="true">${parts.join('')}</g>`;
}

function coordLabel(x: number, y: number, text: string, size: number): string {
  return `<text class="banqi-coord" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${size}">${text}</text>`;
}

// `perspective` is accepted for call-site parity with the other variants, but
// banqi shows the SAME board to both seats (symmetric info), so it is unused.
export function renderBanqiBoardSvg(
  view: BanqiPlayerView,
  _perspective: BanqiSeat = view.perspective,
  options: BanqiBoardRenderOptions = {},
): string {
  const pieceSet = options.pieceSet ?? readStoredXiangqiPieceSet();
  const moves = options.selectedSquare
    ? (options.legalMoves ?? []).filter((m) => m.from === options.selectedSquare)
    : [];
  const forbiddenMoves = options.selectedSquare
    ? (options.forbiddenMoves ?? []).filter(
        (m) => m.from === options.selectedSquare && m.to !== m.from,
      )
    : [];
  return `
    <svg class="banqi-board" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Banqi board">
      <rect class="banqi-board-bg" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="${boardCornerRadius(WIDTH)}"/>
      <g class="banqi-grid">${gridLines()}</g>
      ${options.coordinates ? banqiCoordinateLabels() : ''}
      ${lastMoveMarkers(view)}
      ${selectionRing(options.selectedSquare ?? null)}
      ${pieceLayer(view, pieceSet, options.draggingFrom ?? null, options.tile3d ?? banqiTile3dFlag())}
      ${options.interactive ? '' : moveHints(view, moves)}
      <g class="banqi-board-markers xq-live-markers" aria-hidden="true" pointer-events="none">${(options.markers ?? []).map(banqiMarkerSvg).join('')}</g>
      <g class="banqi-board-arrows xq-live-arrows" aria-hidden="true" pointer-events="none">${(options.arrows ?? []).map(banqiArrowSvg).join('')}</g>
      ${options.interactive ? hitLayerWithTargets(moves, view, forbiddenMoves) : ''}
    </svg>
  `;
}

let stylesInstalled = false;

/**
 * The board's presentation, as a stylesheet rather than presentation attributes.
 *
 * Exported because it is NOT optional decoration: `renderBanqiBoardSvg` emits class
 * names (`banqi-board-bg`, `banqi-grid`, `banqi-back`, the last-move marks) and nothing
 * else, so an SVG rendered without these rules has no board, no grid, and no face-down
 * discs. Anything rasterizing the markup outside a page (resvg has no page stylesheet)
 * must inline this string, and inlining a hand-copied duplicate is how the two drift.
 */
export const BANQI_BOARD_CSS = `
    .banqi-board {
      display: block;
      width: 100%;
      height: auto;
      touch-action: manipulation;
      -webkit-user-select: none;
      user-select: none;
      /* Match the room-page boards' soft card lift (xiangqi-live-board). */
      filter: drop-shadow(0 14px 36px rgba(37, 31, 24, 0.18));
    }
    .banqi-board-bg { fill: var(--mini-xq-board-bg, #f0d6a4); }
    .banqi-coord {
      fill: color-mix(in srgb, var(--mini-xq-grid, #5b4a32) 72%, transparent);
      font-weight: 700;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .banqi-grid line {
      stroke: var(--mini-xq-grid, #5b4a32);
      stroke-width: 1.5;
      stroke-linecap: round;
    }
    .banqi-selection { fill: rgba(31, 111, 91, 0.32); stroke: none; pointer-events: none; }
    .banqi-hint { fill: rgba(31, 111, 91, 0.72); opacity: 0.7; pointer-events: none; }
    .banqi-hint-capture {
      fill: none; stroke: rgba(31, 111, 91, 0.85); stroke-width: 4.5; pointer-events: none;
    }
    /* The 長捉 cross. The board surface keeps its wood colour in both site themes
       (it follows the board theme, not light/dark), so one red reads on all of
       them; the token lets a board theme override it. */
    .banqi-hint-forbidden {
      fill: none;
      stroke: var(--banqi-forbidden-mark, rgba(178, 34, 28, 0.85));
      stroke-width: 4;
      stroke-linecap: round;
      pointer-events: none;
    }
    .banqi-hit.banqi-hit--forbidden rect { cursor: not-allowed; }
    .banqi-target-hover {
      fill: rgba(31, 111, 91, 0.3);
      opacity: 0;
      pointer-events: none;
    }
    .banqi-hit--target:hover .banqi-target-hover {
      opacity: 1;
    }
    .banqi-hit--target:hover .banqi-hint,
    .banqi-hit--target:hover .banqi-hint-capture {
      opacity: 0;
    }
    /* Last move: a tinted CELL, not a ring around the piece (see the geometry
       note in this file). The tint carries the MOVER's ink so a flip says who
       flipped -- on a normal move the piece that landed already tells you, but a
       flip turns up a random tile whose colour means nothing about the mover.
       Gold is the fallback for the opening flip, before an ink is bound. */
    /* EVERY alpha here lives in the rgba colour, never in \`opacity\`. The arrival
       animation (drawMarkerOnArrival) fades element opacity 0 -> 1, so a mark
       whose resting opacity is 0.36 ramps to fully solid and then snaps back
       when the animation clears: it reads as a dark flash that settles lighter.
       This is the same rule live-xiangqi.css states for the square-grid marks;
       banqi shipped it wrong on 2026-08-30 and this is the fix.
       A gold fill barely reads on the tan board, which is why the ink is carried
       by the FILL and not by a border: a saturated 3-unit stroke around a gold
       cell was measurably harder to read than this at the same board scale.
       Red and black are balanced by eye rather than sharing one alpha -- red
       keeps far more chroma than navy does when composited over #f0d6a4. */
    .banqi-lastmove { pointer-events: none; }
    .banqi-lastmove-from { fill: rgba(214, 175, 78, 0.24); }
    .banqi-lastmove-to { fill: rgba(214, 175, 78, 0.4); }
    .banqi-lastmove--red.banqi-lastmove-from { fill: rgba(194, 32, 26, 0.19); }
    .banqi-lastmove--red.banqi-lastmove-to { fill: rgba(194, 32, 26, 0.36); }
    .banqi-lastmove--black.banqi-lastmove-from { fill: rgba(22, 40, 58, 0.22); }
    .banqi-lastmove--black.banqi-lastmove-to { fill: rgba(22, 40, 58, 0.44); }
    /* One tinted cell already reads as a flip against a move's two; the border
       says so on a glance that catches only the one cell. */
    .banqi-lastmove-flip {
      stroke: rgba(214, 175, 78, 0.4);
      stroke-width: ${LAST_MOVE_FLIP_STROKE};
    }
    .banqi-lastmove-flip.banqi-lastmove--red { stroke: rgba(143, 26, 20, 0.36); }
    .banqi-lastmove-flip.banqi-lastmove--black { stroke: rgba(11, 23, 35, 0.44); }
    /* The disc shadow is drawn into each piece and back (xiangqiPieceShadowMarks). */
    .banqi-piece { pointer-events: none; }
    .banqi-back { pointer-events: none; }
    .banqi-drag-source { opacity: 0.34; }
    /* The disc only: the shadow's circles sit inside a group of their own. */
    .banqi-back > circle { fill: #2f8f6b; stroke: #202427; stroke-width: 2; }
    .banqi-hit rect { fill: transparent; cursor: pointer; }
  `;

export function installBanqiBoardStyles(): void {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const style = document.createElement('style');
  style.textContent = BANQI_BOARD_CSS;
  document.head.append(style);
}

// ── Turn-over on a live reveal (#709) ────────────────────────────────────────

/**
 * The square a live flip just turned face up, or null: the banqi family's
 * turn-over trigger. Only a LIVE move event that is a flip (a self-move) and
 * whose square the rendered board now shows face up qualifies. The first
 * render, a reconnect, a scrub and a replay jump carry no live event, so they
 * never turn a tile; a live flip that lands while the viewer is scrubbed back
 * finds that square still face down on the board shown, so it does not either.
 * Reads only the wire move and the board already rendered, never a diff.
 */
export function banqiRevealFlipSquare<S extends string>(
  pending: { kind: 'live'; move: { from: S; to: S } } | { kind: 'scrub' } | null,
  board: Partial<Record<S, { faceDown: boolean }>>,
): S | null {
  if (pending?.kind !== 'live') return null;
  const { from, to } = pending.move;
  if (from !== to) return null;
  const entry = board[to];
  return entry && !entry.faceDown ? to : null;
}

/**
 * Turn the tile on `square` over for any banqi-family board whose slots are
 * `[data-piece-square]`: `center` maps a square to its viewBox point and `back`
 * draws the board's own face-down tile there (identity-free by construction).
 * Call after the render that drew the face. No-op under reduced motion or the
 * 'none' animation pref (the face just appears).
 */
export function flipBanqiFamilyReveal<S extends string>(
  host: HTMLElement,
  square: S,
  center: (square: S) => { x: number; y: number },
  back: (cx: number, cy: number) => string,
  style?: PieceFlipStyle,
): boolean {
  const slot = host.querySelector(`[data-piece-square="${square}"]`);
  if (!slot) return false;
  const point = center(square);
  return flipSvgPiece(
    slot,
    point,
    back(point.x, point.y),
    pieceFlipDurationMs(),
    style ? { style } : {},
  );
}

/** Banqi's turn-over: the jade (or the set's printed) back turns to the face. */
export function animateBanqiReveal(
  host: HTMLElement,
  square: BanqiSquare,
  opts: { tile3d?: boolean; style?: PieceFlipStyle } = {},
): boolean {
  const pieceSet = readStoredXiangqiPieceSet();
  if (opts.tile3d ?? banqiTile3dFlag()) {
    return flipBanqiTile3dReveal(host, square, cellCenter, pieceSet, { style: opts.style });
  }
  return flipBanqiFamilyReveal(
    host,
    square,
    cellCenter,
    (cx, cy) => faceDownDisc(cx, cy, pieceSet),
    opts.style,
  );
}

// ── 3D tiles: a spike behind ?tile=3d, not shipped ──────────────────────────
//
// A banqi tile is a short cylinder seen a little from above: under each disc a
// band of its body shows along the bottom edge, as the Xiangqi Mahjong tiles
// show theirs (xiangqi-mahjong-tile-svg.ts). A tile is one object, so its rim
// is one colour face up and face down, before, during and after the turn:
// ivory on Mistboard's sets, an asset set's own material on its. The rim tells
// nothing a back does not, and a turn-over never changes it. The turn-over
// carries the rim with the face and, edge-on, shows the tile's thickness
// (flipSvgPiece's `edge`) instead of a hairline. Vector only, no idle motion.

const TILE_3D_SEARCH_KEY = 'tile';
const TILE_3D_STORAGE_KEY = 'mistboard.tile3d';
let cachedTile3d: boolean | undefined;

/** Whether ?tile=3d is on for this tab: the query sets it, sessionStorage keeps it. */
export function banqiTile3dFlag(): boolean {
  if (cachedTile3d !== undefined) return cachedTile3d;
  let on = false;
  try {
    const raw = new URLSearchParams(globalThis.location?.search ?? '').get(TILE_3D_SEARCH_KEY);
    if (raw !== null) {
      on = raw === '3d';
      if (on) globalThis.sessionStorage?.setItem(TILE_3D_STORAGE_KEY, '1');
      else globalThis.sessionStorage?.removeItem(TILE_3D_STORAGE_KEY);
    } else {
      on = globalThis.sessionStorage?.getItem(TILE_3D_STORAGE_KEY) === '1';
    }
  } catch {
    on = false;
  }
  cachedTile3d = on;
  return on;
}

export function resetBanqiTile3dFlag(): void {
  cachedTile3d = undefined;
}

// The tile's body (rim and wall), the same under a face and under a back.
const TILE_IVORY: readonly [string, string] = ['#efe7d2', '#d6c9a8'];
// Thickness as a share of the piece box (54 px: about 4.6 px of rim).
const TILE_DEPTH_SHARE = 0.085;
// How far the disc shadow reaches past the rim's bottom: its drop plus its
// widest ring, in the 100-unit box (XIANGQI_PIECE_SHADOW).
const TILE_SHADOW_SHARE =
  (XIANGQI_PIECE_SHADOW.dy + Math.max(...XIANGQI_PIECE_SHADOW.spread)) / 100;
// The whole tile's height as a share of its box: the disc (to its outline),
// the rim below it and the shadow below that.
const TILE_3D_HEIGHT_SHARE = XIANGQI_PIECE_OUTLINE_SHARE + TILE_DEPTH_SHARE + TILE_SHADOW_SHARE;

/**
 * The box a 3D tile is drawn in at this pitch (cell, or the gap between
 * points): the whole tile, rim and shadow included, spans BANQI_PIECE_REACH of
 * it, as a flat disc's outline does. 54 at banqi's 64.
 */
export function banqiTile3dBox(pitch: number): number {
  return roundPieceBox((pitch * BANQI_PIECE_REACH) / TILE_3D_HEIGHT_SHARE);
}

const TILE_BOX = banqiTile3dBox(CELL);

/**
 * Where a 3D tile's disc sits for a tile anchored at `anchor` (a cell centre,
 * or a point on the Three Kingdoms board): raised by half the rim and shadow,
 * so the whole tile, not just its disc, is centred on the anchor.
 */
export function banqiTile3dDiscCenter(anchor: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return {
    x: anchor.x,
    y: round2(anchor.y - (TILE_BOX * (TILE_DEPTH_SHARE + TILE_SHADOW_SHARE)) / 2),
  };
}

/**
 * One 3D tile centred on `anchor`: its rim (and shadow), then the back when
 * `entry` is null, else the face. A face-down tile takes no identity, so every
 * back draws the same.
 */
export function banqiTile3dMarkup(
  anchor: { x: number; y: number },
  entry: { color: BanqiColor; role: BanqiPieceRole } | null,
  pieceSet: XiangqiPieceSet,
  opts: { dragSource?: boolean } = {},
): string {
  const dragSource = opts.dragSource ?? false;
  const disc = banqiTile3dDiscCenter(anchor);
  const rim = tileRim(disc.x, disc.y, pieceSet, dragSource);
  if (!entry) {
    const cls = dragSource ? 'banqi-back banqi-drag-source' : 'banqi-back';
    return rim + faceDownDiscFlat(disc.x, disc.y, pieceSet, cls, false, TILE_BOX);
  }
  return (
    rim +
    renderXiangqiPieceGlyphed({ color: entry.color, role: entry.role }, pieceSet, {
      ariaLabel: `${entry.color} ${entry.role}`,
      className: dragSource ? 'banqi-piece banqi-drag-source' : 'banqi-piece',
      shrouded: false,
      x: disc.x - TILE_BOX / 2,
      y: disc.y - TILE_BOX / 2,
      size: TILE_BOX,
      shape: BANQI_PIECE_SHAPE,
      shadow: false,
    })
  );
}

/**
 * Turn a 3D tile over after the render that drew its face. Lift and Spin turn
 * a coin with real perspective over the board (tile-flip-3d.ts); Flat, or a
 * page where the coin cannot go up, falls back to the SVG turn with the edge.
 * The back is the identity-free back the board drew before the reveal.
 * `durationMs` overrides the setting's length (a review sheet's slow motion).
 */
export function flipBanqiTile3dReveal<S extends string>(
  host: HTMLElement,
  square: S,
  anchorOf: (square: S) => { x: number; y: number },
  pieceSet: XiangqiPieceSet,
  opts: { style?: PieceFlipStyle; durationMs?: number } = {},
): boolean {
  const slot = host.querySelector(`[data-piece-square="${square}"]`);
  const face = slot?.querySelector(':scope > .banqi-piece');
  if (!slot || !face) return false;
  const style = opts.style ?? pieceFlipStyle();
  const durationMs = opts.durationMs ?? pieceFlipDurationMs();
  if (durationMs <= 0) return false;
  const anchor = anchorOf(square);
  const disc = banqiTile3dDiscCenter(anchor);
  if (style !== 'flat') {
    const look = tileLook(pieceSet);
    const shadow = TILE_BOX * TILE_SHADOW_SHARE;
    const turned = flipTileOverlay({
      slot,
      center: disc,
      radius: look.radius,
      depth: look.depth,
      reach: look.radius + look.depth + shadow + 2,
      front: {
        band: slot.querySelector(':scope > .banqi-rim')?.outerHTML ?? '',
        face: face.outerHTML,
      },
      back: {
        band: tileRim(disc.x, disc.y, pieceSet, false),
        face: faceDownDiscFlat(disc.x, disc.y, pieceSet, 'banqi-back', false, TILE_BOX),
      },
      // One body: the wall is the rim's colour on both halves.
      wall: { front: look.body[0], back: look.body[0] },
      durationMs,
      style,
    });
    if (turned) return true;
  }
  return flipSvgPiece(slot, disc, banqiTile3dMarkup(anchor, null, pieceSet), durationMs, {
    style,
    edge: banqiTileEdge(pieceSet),
  });
}

function tileLook(pieceSet: XiangqiPieceSet): {
  radius: number;
  depth: number;
  body: readonly [string, string];
} {
  const backing = xiangqiTileBacking(pieceSet);
  // Asset discs are normalised to radius 45 of the 100 box; Mistboard's faces
  // end at 47.4 (banqiFaceDownRadius plus its stroke).
  const radius = round2(TILE_BOX * (backing ? 0.45 : 0.474));
  const depth = round2(TILE_BOX * TILE_DEPTH_SHARE);
  const body: readonly [string, string] = backing ? [backing[1], backing[2]] : TILE_IVORY;
  return { radius, depth, body };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// The part of the side wall below the disc: straight sides from the disc's
// middle down `k`, closed by the bottom half of a disc there.
function tileBandPath(cx: number, cy: number, r: number, k: number): string {
  return `M${round2(cx - r)} ${cy}V${round2(cy + k)}A${r} ${r} 0 0 0 ${round2(cx + r)} ${round2(cy + k)}V${cy}Z`;
}

/** The rim under one tile, drawn before its face or back in the same slot. */
function tileRim(cx: number, cy: number, pieceSet: XiangqiPieceSet, dragSource: boolean): string {
  const look = tileLook(pieceSet);
  const [mid, low] = look.body;
  const shadow = xiangqiPieceShadowEnabled()
    ? xiangqiPieceShadowMarks(look.radius, cx, cy + look.depth, TILE_BOX)
    : '';
  const cls = dragSource ? 'banqi-rim banqi-drag-source' : 'banqi-rim';
  return [
    `<g class="${cls}" aria-hidden="true">`,
    shadow,
    `<path d="${tileBandPath(cx, cy, look.radius, look.depth)}" fill="${low}"/>`,
    `<path d="${tileBandPath(cx, cy, look.radius, look.depth - 1.5)}" fill="${mid}"/>`,
    `</g>`,
  ].join('');
}

/** The tile's edge for the turn-over: its thickness and the two bands it shows. */
export function banqiTileEdge(pieceSet: XiangqiPieceSet): PieceFlipEdge {
  const look = tileLook(pieceSet);
  return {
    halfWidth: look.radius,
    depth: look.depth,
    fills: [look.body[0], look.body[0]],
    stroke: look.body[1],
  };
}
