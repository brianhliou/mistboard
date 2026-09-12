import type { JieqiColor, JieqiMove, JieqiPlayerView, JieqiSquare } from '@mistboard/game';
import { drawMarkerOnArrival, glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import {
  BOARD_LASTMOVE_MARKER_SELECTOR,
  boardLastMoveMarkersSvg,
  boardLastMoveStyleAttr,
} from './board-lastmove.js';
import { boardCornerRadius, tokenPieceSize } from './board-metrics.js';
import { readDisplayPreferences } from './display-preferences.js';
import { type SvgBoardArrowStyle, svgBoardArrow } from './svg-board-arrow.js';
import {
  GLYPH_OFFSET_RATIO,
  GLYPH_RADIUS_RATIO,
  type SvgBoardMarkerStyle,
  svgBoardCircleMarker,
  svgBoardGlyphMarker,
} from './svg-board-marker.js';
import type { XiangqiBoardLayout } from './xiangqi-appearance-storage.js';
import {
  readStoredXiangqiBoardLayout,
  readStoredXiangqiPieceSet,
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
import { renderXiangqiPieceGlyphed, type XiangqiPieceSet } from './xiangqi-piece-sets.js';

// Bespoke SVG renderer for the 9x10 jieqi board. Pieces sit on intersections
// (xiangqi convention). Unlike the Dark Xiangqi renderer there is NO fog:
// jieqi positions are fully public. The hidden axis is IDENTITY — a face-down
// piece renders as a color-known "back" (shroudedStyle 'back'); a revealed piece
// renders with its glyph. The captured-pool UI is the caller's concern.

const CELL = 72;
const MARGIN = 42;
const PIECE_SIZE = tokenPieceSize(CELL);
// Move/selection markers wrap the disc: radii track the piece radius.
const RING_SELECTION = PIECE_SIZE / 2 + 6;
const RING_LAST = PIECE_SIZE / 2 + 4;
const RING_CAPTURE = PIECE_SIZE / 2 + 1;
const FILES = 9;
const RANKS = 10;
const HIT_HALF = 31;

// Jieqi is xiangqi's board at a larger scale, so it takes the shared surface
// rather than keeping its own copy of the grid and palace drawing. That is what
// lets the board appearance preferences (Traditional / Square grid) reach it at
// all: 'Square grid' is a different way of drawing the board, not a flag.
export const JIEQI_GEO: XiangqiBoardGeometry = {
  fileCount: FILES,
  rankCount: RANKS,
  cell: CELL,
  margin: MARGIN,
  riverGap: Math.round(CELL / 5),
  // Reserved only while labels are shown, and reclaimed when they are off, so a
  // reader who never turns coordinates on sees the board exactly as it was.
  coordGutter: Math.round(CELL / 5),
};
const JIEQI_GEO_NO_COORDS: XiangqiBoardGeometry = { ...JIEQI_GEO, coordGutter: 0 };
const JIEQI_SURFACE: XiangqiSurfaceConfig = {
  geo: JIEQI_GEO,
  palaces: [
    { fileMin: 3, fileMax: 5, rankMin: 1, rankMax: 3 },
    { fileMin: 3, fileMax: 5, rankMin: 8, rankMax: 10 },
  ],
  // The river breaks the interior files. Jieqi carries no 楚河漢界 caption, so
  // no riverLabel: the gap alone is the cue, as it was before this shared.
  riverAfterRank: 5,
};
// The layout for the CURRENT render. The exported marker/arrow helpers take a
// perspective but no layout (they are called for whatever board is on screen),
// so the renderer records it here rather than re-reading localStorage per point.
let activeLayout: XiangqiBoardLayout = 'intersection';
// Shared board rounding (board-metrics), so this board's corner matches every
// other board's at the same rendered width.
// Sized from the BOARD's own width, not the viewBox: the coordinate gutter is
// outside the board and must not change how its corners round.
const BOARD_CORNER_RX = boardCornerRadius(MARGIN * 2 + (FILES - 1) * CELL);
// The river sits between ranks 5 and 6 (display rows 4 and 5 from the top).

export type JieqiBoardRenderOptions = {
  /** false = draw no coordinates AND reserve no space for them, whatever the
   *  reader's preference says. For surfaces whose framing is authored rather
   *  than played on: article diagrams, the homepage puzzle thumbnail. Boards
   *  you actually play on leave this alone and follow the preference. */
  coordinates?: boolean;
  arrows?: readonly JieqiBoardArrow[];
  markers?: readonly JieqiBoardMarker[];
  interactive?: boolean;
  selectedSquare?: JieqiSquare | null;
  legalMoves?: readonly JieqiMove[];
  pieceSet?: XiangqiPieceSet;
  // While dragging, render the origin as a dim source shadow.
  draggingFrom?: JieqiSquare | null;
  /** Override the stored board-layout preference (tests, previews). */
  layout?: XiangqiBoardLayout;
};

export interface JieqiBoardArrow extends SvgBoardArrowStyle {
  from: JieqiSquare;
  to: JieqiSquare;
}

export interface JieqiBoardMarker extends SvgBoardMarkerStyle {
  square: JieqiSquare;
  kind: 'circle' | 'glyph';
  /** Badge label for kind 'glyph' (e.g. '??'). Ignored by 'circle'. */
  text?: string;
}

function jieqiCoordOf(square: JieqiSquare): { file: number; rank: number } {
  return { file: square.charCodeAt(0) - 97, rank: Number(square.slice(1)) };
}

function jieqiSquareOf(file: number, rank: number): JieqiSquare {
  return `${String.fromCharCode(97 + file)}${rank}` as JieqiSquare;
}

function intersection(
  file: number,
  rank: number,
  perspective: JieqiColor,
  layout: XiangqiBoardLayout = activeLayout,
): { x: number; y: number } {
  return xiangqiBoardPoint(file, rank, perspective, layout, JIEQI_GEO);
}

export function renderJieqiBoardSvg(
  view: JieqiPlayerView,
  perspective: JieqiColor = view.perspective,
  options: JieqiBoardRenderOptions = {},
): string {
  const pieceSet = options.pieceSet ?? readStoredXiangqiPieceSet();
  const legalMoves = options.legalMoves ?? [];
  const layout = options.layout ?? readStoredXiangqiBoardLayout();
  activeLayout = layout;
  const showCoords = options.coordinates !== false && readDisplayPreferences().boardCoordinates;
  const surface = showCoords ? JIEQI_SURFACE : { ...JIEQI_SURFACE, geo: JIEQI_GEO_NO_COORDS };
  const vb = xiangqiBoardViewBox(layout, surface.geo);
  const coords = showCoords
    ? xiangqiSurfaceCoords(
        surface,
        perspective,
        layout,
        xiangqiCoordLabels(currentXiangqiNotationStyle(), FILES, RANKS),
      )
    : '';
  // The square grid paints its own cells, so the board-coloured backdrop only
  // applies to the intersection layout; on 'cell' it would tint the river gap.
  const backdrop =
    layout === 'cell'
      ? ''
      : `<rect class="jieqi-board-bg" x="${vb.minX}" y="${vb.minY}" width="${vb.width}" height="${vb.height}" rx="${BOARD_CORNER_RX}"/>`;
  // Drawn AFTER the grid, matching the standard board. On the square grid the
  // cells are filled rects, so anything beneath them is invisible; the tint and
  // the river band have to sit on top to be seen at all.
  // Emitted only when they draw something. The intersection layout has neither a
  // river tint nor palace bands (the gap and the diagonals are its cues), and an
  // empty <g> would still put its class in the markup, which reads as a tint
  // that is not there.
  const riverInner = xiangqiSurfaceRiver(surface, perspective, layout);
  const river = riverInner
    ? `<g class="jieqi-river xq-live-river" aria-hidden="true" pointer-events="none">${riverInner}</g>`
    : '';
  const bandsInner =
    layout === 'cell' ? xiangqiSurfacePalaceBands(surface, perspective, layout) : '';
  const palaceBands = bandsInner
    ? `<g class="jieqi-palace-bands xq-live-palace-bands">${bandsInner}</g>`
    : '';
  return `
    <svg class="jieqi-board jieqi-board--${layout} xq-surface xq-surface--${layout}" data-xiangqi-layout="${layout}"${boardLastMoveStyleAttr(PIECE_SIZE)} viewBox="${vb.minX} ${vb.minY} ${vb.width} ${vb.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Jieqi board">
      ${backdrop}
      <g class="jieqi-grid">${xiangqiSurfaceGrid(surface, layout)}${xiangqiSurfacePalace(surface, perspective, layout)}</g>
      ${river}
      ${palaceBands}
      ${coords ? `<g class="jieqi-coords xq-live-coords" aria-hidden="true" pointer-events="none">${coords}</g>` : ''}
      ${lastMoveMarkers(view, perspective)}
      ${selectionRing(options.selectedSquare ?? null, perspective)}
      ${options.interactive ? '' : moveHints(view, legalMoves, perspective)}
      ${pieceLayer(view, perspective, pieceSet, options.draggingFrom ?? null)}
      <g class="jieqi-board-markers xq-live-markers" aria-hidden="true" pointer-events="none">${(options.markers ?? []).map((marker) => jieqiMarkerSvg(marker, perspective)).join('')}</g>
      <g class="jieqi-board-arrows xq-live-arrows" aria-hidden="true" pointer-events="none">${jieqiArrowLayer(options.arrows ?? [], perspective)}</g>
      ${options.interactive ? hitLayer(perspective, view, legalMoves) : ''}
    </svg>
  `;
}

export function jieqiArrowSvg(arrow: JieqiBoardArrow, perspective: JieqiColor): string {
  const from = jieqiCoordOf(arrow.from);
  const to = jieqiCoordOf(arrow.to);
  return svgBoardArrow(
    arrow,
    intersection(from.file, from.rank, perspective),
    intersection(to.file, to.rank, perspective),
    { baseClassName: 'xq-arrow' },
  );
}

export function jieqiMarkerSvg(marker: JieqiBoardMarker, perspective: JieqiColor): string {
  const { file, rank } = jieqiCoordOf(marker.square);
  const center = intersection(file, rank, perspective);
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
  return svgBoardCircleMarker(marker, center, RING_SELECTION, {
    baseClassName: 'xq-marker engine-marker',
  });
}

function jieqiArrowLayer(arrows: readonly JieqiBoardArrow[], perspective: JieqiColor): string {
  return arrows.map((arrow) => jieqiArrowSvg(arrow, perspective)).join('');
}

export const JIEQI_PIECE_PX = PIECE_SIZE;

// The standalone piece for the floating drag ghost (board-drag.ts mounts it in a
// sized <div>). Mirrors pieceLayer exactly: a face-down piece's ghost is the
// colour-known "back" (it moves AND reveals, so it is draggable), and a revealed
// piece's ghost is its glyph.
export function jieqiPieceGhostSvg(
  entry: JieqiPlayerView['board'][JieqiSquare],
  pieceSet?: XiangqiPieceSet,
  // The square the drag started from, so a soldier past the river keeps its
  // promoted art while it floats. Face-down entries ignore it: their soldier
  // role is a placeholder for an identity nobody has seen.
  originSquare?: JieqiSquare,
): string {
  if (!entry) return '';
  const set = pieceSet ?? readStoredXiangqiPieceSet();
  const inner = entry.faceDown
    ? renderXiangqiPieceGlyphed({ color: entry.color, role: 'soldier' }, set, {
        ariaLabel: `${entry.color} hidden piece`,
        className: 'jieqi-piece',
        shrouded: true,
        shroudedStyle: 'back',
        x: 0,
        y: 0,
        size: PIECE_SIZE,
      })
    : renderXiangqiPieceGlyphed({ color: entry.color, role: entry.role }, set, {
        ariaLabel: `${entry.color} ${entry.role}`,
        className: 'jieqi-piece',
        shrouded: false,
        crossed: originSquare ? drawsCrossedSoldier(entry, jieqiCoordOf(originSquare).rank) : false,
        x: 0,
        y: 0,
        size: PIECE_SIZE,
      });
  return `<svg width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 ${PIECE_SIZE} ${PIECE_SIZE}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}

// Each piece is wrapped in a positioned slot keyed by its square, so the glide
// (animateJieqiBoardMove) can find the piece that just settled. Mirrors the
// xiangqi / mini / fortress piece layers.
function pieceLayer(
  view: JieqiPlayerView,
  perspective: JieqiColor,
  pieceSet: XiangqiPieceSet,
  draggingFrom: JieqiSquare | null,
): string {
  return Object.entries(view.board)
    .map(([square, entry]) => {
      if (!entry) return '';
      const dragSource = square === draggingFrom;
      const { file, rank } = jieqiCoordOf(square as JieqiSquare);
      const { x, y } = intersection(file, rank, perspective);
      const pieceSvg = entry.faceDown
        ? renderXiangqiPieceGlyphed({ color: entry.color, role: 'soldier' }, pieceSet, {
            ariaLabel: `${entry.color} hidden piece`,
            className: dragSource ? 'jieqi-piece jieqi-piece--drag-source' : 'jieqi-piece',
            shrouded: true,
            shroudedStyle: 'back',
            x: x - PIECE_SIZE / 2,
            y: y - PIECE_SIZE / 2,
            size: PIECE_SIZE,
          })
        : // A revealed soldier past the river draws with the promoted-soldier art,
          // same as the standard xiangqi board (red owns ranks 1-5, black 6-10).
          renderXiangqiPieceGlyphed({ color: entry.color, role: entry.role }, pieceSet, {
            ariaLabel: `${entry.color} ${entry.role}`,
            className: dragSource ? 'jieqi-piece jieqi-piece--drag-source' : 'jieqi-piece',
            shrouded: false,
            x: x - PIECE_SIZE / 2,
            y: y - PIECE_SIZE / 2,
            size: PIECE_SIZE,
            crossed: drawsCrossedSoldier(entry, rank),
          });
      return `<g class="jieqi-piece-slot" data-piece-square="${square}">${pieceSvg}</g>`;
    })
    .join('');
}

/**
 * Glide the piece that settled on `move.to` from its origin (or with `reverse`
 * the piece back on `move.from`), then draw the destination halo on as it lands.
 * Call AFTER the innerHTML swap that rendered the final position. No-op at
 * duration 0 or when the slot is missing. The move must come from a payload the
 * client already received (an event, a view's lastMove), never a board diff.
 */
export function animateJieqiBoardMove(
  host: HTMLElement,
  move: { from: JieqiSquare; to: JieqiSquare },
  perspective: JieqiColor,
  opts: { reverse?: boolean } = {},
): void {
  const duration = pieceAnimationDurationMs();
  if (duration <= 0) return;
  const settleSquare = opts.reverse ? move.from : move.to;
  const originSquare = opts.reverse ? move.to : move.from;
  const slot = host.querySelector(`[data-piece-square="${settleSquare}"]`);
  if (!slot) return;
  const origin = jieqiCoordOf(originSquare);
  const settle = jieqiCoordOf(settleSquare);
  const from = intersection(origin.file, origin.rank, perspective);
  const to = intersection(settle.file, settle.rank, perspective);
  glideSvgPiece(slot, from.x - to.x, from.y - to.y, duration);
  // A reverse step renders the PRIOR move's marker at a different square, so
  // fading it in would not track the reverse glide.
  if (!opts.reverse) {
    drawMarkerOnArrival(host.querySelector(BOARD_LASTMOVE_MARKER_SELECTOR), duration);
  }
}

function selectionRing(selection: JieqiSquare | null, perspective: JieqiColor): string {
  if (!selection) return '';
  const { file, rank } = jieqiCoordOf(selection);
  const { x, y } = intersection(file, rank, perspective);
  return `<circle class="jieqi-selection" cx="${x}" cy="${y}" r="${RING_SELECTION}"/>`;
}

function moveHints(
  view: JieqiPlayerView,
  moves: readonly JieqiMove[],
  perspective: JieqiColor,
): string {
  return moves
    .map((move) => {
      const { file, rank } = jieqiCoordOf(move.to);
      const { x, y } = intersection(file, rank, perspective);
      const capture = view.board[move.to] !== undefined;
      return capture
        ? `<circle class="jieqi-hint-capture" cx="${x}" cy="${y}" r="${RING_CAPTURE}"/>`
        : `<circle class="jieqi-hint" cx="${x}" cy="${y}" r="10"/>`;
    })
    .join('');
}

// Shared with every other token board (board-lastmove.ts): a darkened origin
// disc and a gold halo on the destination, rather than the symmetric pair of
// soft rings this board drew until 2026-08-27.
function lastMoveMarkers(view: JieqiPlayerView, perspective: JieqiColor): string {
  if (!view.lastMove) return '';
  const center = (square: JieqiSquare): { x: number; y: number } => {
    const { file, rank } = jieqiCoordOf(square);
    return intersection(file, rank, perspective);
  };
  return boardLastMoveMarkersSvg(
    { from: center(view.lastMove.from), to: center(view.lastMove.to) },
    PIECE_SIZE,
  );
}

function hitLayer(
  perspective: JieqiColor,
  view: JieqiPlayerView,
  moves: readonly JieqiMove[],
): string {
  const targets = new Map<JieqiSquare, { capture: boolean }>();
  for (const move of moves) targets.set(move.to, { capture: view.board[move.to] !== undefined });
  const parts: string[] = [];
  for (let f = 0; f < FILES; f += 1) {
    for (let r = 1; r <= RANKS; r += 1) {
      const sq = jieqiSquareOf(f, r);
      const { x, y } = intersection(f, r, perspective);
      const target = targets.get(sq);
      const marker = target
        ? target.capture
          ? `<circle class="jieqi-hint-capture" cx="${x}" cy="${y}" r="${RING_CAPTURE}"/>`
          : `<circle class="jieqi-hint" cx="${x}" cy="${y}" r="10"/>`
        : '';
      const hover = target
        ? `<circle class="jieqi-target-hover" cx="${x}" cy="${y}" r="${RING_LAST}"/>`
        : '';
      parts.push(
        `<g data-square="${sq}" class="jieqi-hit${target ? ' jieqi-hit--target' : ''}">${hover}${marker}<rect x="${x - HIT_HALF}" y="${y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}"/></g>`,
      );
    }
  }
  return parts.join('');
}

let stylesInstalled = false;

export function installJieqiBoardStyles(): void {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const style = document.createElement('style');
  style.textContent = `
    .jieqi-board {
      display: block;
      width: 100%;
      height: auto;
      touch-action: manipulation;
      -webkit-user-select: none;
      user-select: none;
    }
    .jieqi-board-bg { fill: var(--mini-xq-board-bg, #f5dca8); }
    .jieqi-grid line {
      stroke: var(--mini-xq-grid, #5a3a14);
      stroke-width: 1.2;
    }
    .jieqi-selection { fill: rgba(31, 111, 91, 0.32); stroke: none; pointer-events: none; }
    .jieqi-hint { fill: rgba(31, 111, 91, 0.72); opacity: 0.78; pointer-events: none; }
    .jieqi-hint-capture {
      fill: none; stroke: rgba(31, 111, 91, 0.48); stroke-width: 3; pointer-events: none;
    }
    .jieqi-target-hover {
      fill: rgba(31, 111, 91, 0.3);
      opacity: 0;
      pointer-events: none;
    }
    .jieqi-hit--target:hover .jieqi-target-hover {
      opacity: 1;
    }
    .jieqi-hit--target:hover .jieqi-hint,
    .jieqi-hit--target:hover .jieqi-hint-capture {
      opacity: 0;
    }
    .jieqi-piece { pointer-events: none; filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.2)); }
    .jieqi-piece--drag-source { opacity: 0.34; }
    .jieqi-hit rect { fill: transparent; cursor: pointer; }
  `;
  document.head.append(style);
}
