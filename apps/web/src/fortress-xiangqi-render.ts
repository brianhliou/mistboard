import type {
  FortressXiangqiColor,
  FortressXiangqiPiece,
  FortressXiangqiPlayerView,
  FortressXiangqiSquare,
  XiangqiPiece,
} from '@mistboard/game';
import { fortressXiangqiCoordOf, fortressXiangqiSquareOf } from '@mistboard/game';
import { drawMarkerOnArrival, glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import {
  BOARD_LASTMOVE_MARKER_SELECTOR,
  boardLastMoveMarkersSvg,
  boardLastMoveStyleAttr,
} from './board-lastmove.js';
import { tokenPieceSize } from './board-metrics.js';
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
import { drawsFortressCrossedSoldier } from './xiangqi-crossed-soldier.js';
import { currentXiangqiNotationStyle } from './xiangqi-notation.js';
import {
  animalFlatTreasureMarks,
  animalTreasureMarks,
  cjkGlyphMark,
  internationalFlatTreasureMarks,
  internationalTreasureMarks,
  renderXiangqiPieceGlyphed,
  treasureSymbolMark,
  type XiangqiPieceSet,
} from './xiangqi-piece-sets.js';

// Bespoke SVG renderer for the 7x8 Fortress Xiangqi board. Perfect information
// (no fog): pieces sit on intersections, the two 3x3 palaces are in OPPOSITE
// corners (Red a1-c3, Black e6-g8), and a river band sits between ranks 4 and 5.
// The six shared xiangqi pieces reuse renderXiangqiPieceGlyphed; the Treasure
// (寶) — a Fortress-only role not in XiangqiPieceRole — is drawn inline here.

const CELL = 72;
const MARGIN = 42;
const PIECE_SIZE = tokenPieceSize(CELL);
// Move/selection markers wrap the disc: radii track the piece radius.
const RING_SELECTION = PIECE_SIZE / 2 + 6;
const RING_LAST = PIECE_SIZE / 2 + 4;
const RING_CAPTURE = PIECE_SIZE / 2 + 1;
const FILES = 7;
const RANKS = 8;
const HIT_HALF = 31;
// This board deliberately does NOT round its own background: perimeter clipping
// is the host's job here (see the render test), and the host clips at the shared
// --board-corner-radius like every other board.

type Palace = { fileLo: number; fileHi: number; rankLo: number; rankHi: number };
// Storm the Fortress is a 7x8 xiangqi-shaped board, so it takes the shared
// surface: that is what lets the board appearance preferences reach it, since
// 'Square grid' is a different way of drawing the board rather than a flag.
// Its river is a TINTED BAND rather than a caption and its palace bands carry
// their own class, so those stay local for the intersection layout; the square
// grid uses the shared ones, which is where the tinted cells are the cue.
export const FXQ_GEO: XiangqiBoardGeometry = {
  fileCount: FILES,
  rankCount: RANKS,
  cell: CELL,
  margin: MARGIN,
  riverGap: Math.round(CELL / 5),
  // Reserved only while labels are shown, and reclaimed when they are off, so a
  // reader who never turns coordinates on sees the board exactly as it was.
  coordGutter: Math.round(CELL / 5),
};
const FXQ_GEO_NO_COORDS: XiangqiBoardGeometry = { ...FXQ_GEO, coordGutter: 0 };
let activeLayout: XiangqiBoardLayout = 'intersection';
const RED_PALACE: Palace = { fileLo: 0, fileHi: 2, rankLo: 1, rankHi: 3 };
const BLACK_PALACE: Palace = { fileLo: 4, fileHi: 6, rankLo: 6, rankHi: 8 };
const FXQ_SURFACE: XiangqiSurfaceConfig = {
  geo: FXQ_GEO,
  palaces: [RED_PALACE, BLACK_PALACE].map((p) => ({
    fileMin: p.fileLo,
    fileMax: p.fileHi,
    rankMin: p.rankLo,
    rankMax: p.rankHi,
  })),
  // No caption: this board's river is drawn as a tinted band, below.
  riverAfterRank: 4,
};

export type FortressXiangqiBoardRenderOptions = {
  /** false = draw no coordinates AND reserve no space for them, whatever the
   *  reader's preference says. For surfaces whose framing is authored rather
   *  than played on: article diagrams, the homepage puzzle thumbnail. Boards
   *  you actually play on leave this alone and follow the preference. */
  coordinates?: boolean;
  arrows?: readonly FortressXiangqiBoardArrow[];
  markers?: readonly FortressXiangqiBoardMarker[];
  interactive?: boolean;
  selectedSquare?: FortressXiangqiSquare | null;
  // Highlighted destination squares — board-move targets for a selected piece,
  // or drop targets for a selected reserve role.
  targets?: readonly FortressXiangqiSquare[];
  // Rules-diagram annotation: destinations a piece CANNOT take (river-locked,
  // eye-blocked), drawn as a red cross. Non-interactive renders only.
  blockedSquares?: readonly FortressXiangqiSquare[];
  pieceSet?: XiangqiPieceSet;
  draggingFrom?: FortressXiangqiSquare | null;
  /** Override the stored board-layout preference (tests, previews). */
  layout?: XiangqiBoardLayout;
};

export interface FortressXiangqiBoardArrow extends SvgBoardArrowStyle {
  from: FortressXiangqiSquare;
  to: FortressXiangqiSquare;
}

export interface FortressXiangqiBoardMarker extends SvgBoardMarkerStyle {
  square: FortressXiangqiSquare;
  kind: 'circle' | 'glyph';
  /** Badge label for kind 'glyph' (e.g. '??'). Ignored by 'circle'. */
  text?: string;
}

export const FORTRESS_XIANGQI_PIECE_PX = PIECE_SIZE;

export function renderFortressXiangqiBoardSvg(
  view: FortressXiangqiPlayerView,
  perspective: FortressXiangqiColor = view.perspective,
  options: FortressXiangqiBoardRenderOptions = {},
): string {
  const pieceSet = options.pieceSet ?? readStoredXiangqiPieceSet();
  const targets = options.targets ?? [];
  const layout = options.layout ?? readStoredXiangqiBoardLayout();
  activeLayout = layout;
  const showCoords = options.coordinates !== false && readDisplayPreferences().boardCoordinates;
  const surface = showCoords ? FXQ_SURFACE : { ...FXQ_SURFACE, geo: FXQ_GEO_NO_COORDS };
  const vb = xiangqiBoardViewBox(layout, surface.geo);
  const coords = showCoords
    ? xiangqiSurfaceCoords(
        surface,
        perspective,
        layout,
        xiangqiCoordLabels(currentXiangqiNotationStyle(), FILES, RANKS),
      )
    : '';
  const cell = layout === 'cell';
  return `
    <svg class="fxq-board fxq-board--${layout} xq-surface xq-surface--${layout}" data-xiangqi-layout="${layout}"${boardLastMoveStyleAttr(PIECE_SIZE)} viewBox="${vb.minX} ${vb.minY} ${vb.width} ${vb.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Storm the Fortress board">
      ${cell ? '' : `<rect class="fxq-board-bg" x="${vb.minX}" y="${vb.minY}" width="${vb.width}" height="${vb.height}"/>`}
      ${cell ? '' : riverBand(perspective)}
      ${cell ? '' : palaceBands(perspective)}
      <!-- Square grid draws the palace tint and river band AFTER the cells:
           they are filled rects, so anything under them is invisible. The
           intersection layout keeps its original order, where the grid is only
           lines and the bands must sit beneath. -->
      <g class="fxq-grid">${xiangqiSurfaceGrid(surface, layout)}${xiangqiSurfacePalace(surface, perspective, layout)}</g>
      ${cell ? xiangqiSurfaceRiver(surface, perspective, layout) : ''}
      ${cell ? `<g class="xq-live-palace-bands">${xiangqiSurfacePalaceBands(surface, perspective, layout)}</g>` : ''}
      ${coords ? `<g class="fxq-coords xq-live-coords" aria-hidden="true" pointer-events="none">${coords}</g>` : ''}
      ${lastMoveMarkers(view, perspective)}
      ${selectionRing(options.selectedSquare ?? null, perspective)}
      ${options.interactive ? '' : moveHints(view, targets, perspective)}
      ${options.interactive ? '' : blockedMarks(options.blockedSquares ?? [], perspective)}
      ${pieceLayer(view, perspective, pieceSet, options.draggingFrom ?? null)}
      <g class="fxq-board-markers xq-live-markers" aria-hidden="true" pointer-events="none">${fortressXiangqiMarkerLayer(options.markers ?? [], perspective)}</g>
      <g class="fxq-board-arrows xq-live-arrows" aria-hidden="true" pointer-events="none">${fortressXiangqiArrowLayer(options.arrows ?? [], perspective)}</g>
      ${options.interactive ? hitLayer(perspective, view, targets) : ''}
    </svg>
  `;
}

export function fortressXiangqiMarkerSvg(
  marker: FortressXiangqiBoardMarker,
  perspective: FortressXiangqiColor,
): string {
  const coord = fortressXiangqiCoordOf(marker.square);
  const center = intersection(coord.file, coord.rank, perspective);
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
  return svgBoardCircleMarker(marker, center, RING_LAST, {
    baseClassName: 'xq-marker engine-marker',
  });
}

function fortressXiangqiMarkerLayer(
  markers: readonly FortressXiangqiBoardMarker[],
  perspective: FortressXiangqiColor,
): string {
  return markers.map((marker) => fortressXiangqiMarkerSvg(marker, perspective)).join('');
}

export function fortressXiangqiArrowSvg(
  arrow: FortressXiangqiBoardArrow,
  perspective: FortressXiangqiColor,
): string {
  const from = fortressXiangqiCoordOf(arrow.from);
  const to = fortressXiangqiCoordOf(arrow.to);
  return svgBoardArrow(
    arrow,
    intersection(from.file, from.rank, perspective),
    intersection(to.file, to.rank, perspective),
    { baseClassName: 'xq-arrow' },
  );
}

function fortressXiangqiArrowLayer(
  arrows: readonly FortressXiangqiBoardArrow[],
  perspective: FortressXiangqiColor,
): string {
  return arrows.map((arrow) => fortressXiangqiArrowSvg(arrow, perspective)).join('');
}

// A standalone <svg> for one piece, used as the floating drag ghost.
export function fortressXiangqiPieceGhostSvg(
  piece: FortressXiangqiPiece,
  pieceSet?: XiangqiPieceSet,
): string {
  const set = pieceSet ?? readStoredXiangqiPieceSet();
  const inner = renderFortressXiangqiPiece(piece, set, PIECE_SIZE / 2, PIECE_SIZE / 2, false, null);
  return `<svg width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 ${PIECE_SIZE} ${PIECE_SIZE}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}

// A 100x100 piece glyph (no position) for inline use — the reserve/pocket tiles.
// The six shared roles reuse renderXiangqiPieceGlyphed; the Treasure is inline.
export function renderFortressXiangqiPieceInline(
  piece: FortressXiangqiPiece,
  set: XiangqiPieceSet,
): string {
  if (piece.role === 'treasure') {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${piece.color} treasure">${treasureInnerMarks(piece.color, set)}</svg>`;
  }
  return renderXiangqiPieceGlyphed(piece as unknown as XiangqiPiece, set, {
    ariaLabel: `${piece.color} ${piece.role}`,
    // A reserve tile has no square, so it cannot answer the river question. Draw
    // the base soldier: it is what the piece is until it lands and crosses.
    crossed: false,
  });
}

// The river sits between ranks 4 and 5 — a tinted band across the middle.
function riverBand(perspective: FortressXiangqiColor): string {
  const top = intersection(0, perspective === 'red' ? 5 : 4, perspective);
  const bottom = intersection(0, perspective === 'red' ? 4 : 5, perspective);
  const y = Math.min(top.y, bottom.y);
  return `<rect class="fxq-river" x="${MARGIN}" y="${y}" width="${(FILES - 1) * CELL}" height="${CELL}"/>`;
}

function palaceBands(perspective: FortressXiangqiColor): string {
  return [RED_PALACE, BLACK_PALACE]
    .map((palace) => {
      const { x, y, width, height } = palaceRect(palace, perspective);
      return `<rect class="fxq-palace-band" x="${x}" y="${y}" width="${width}" height="${height}"/>`;
    })
    .join('');
}

function palaceRect(
  palace: Palace,
  perspective: FortressXiangqiColor,
): { x: number; y: number; width: number; height: number } {
  const a = intersection(palace.fileLo, palace.rankLo, perspective);
  const b = intersection(palace.fileHi, palace.rankHi, perspective);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function pieceLayer(
  view: FortressXiangqiPlayerView,
  perspective: FortressXiangqiColor,
  pieceSet: XiangqiPieceSet,
  draggingFrom: FortressXiangqiSquare | null,
): string {
  return Object.entries(view.board)
    .map(([square, piece]) => {
      if (!piece) return '';
      const { file, rank } = fortressXiangqiCoordOf(square as FortressXiangqiSquare);
      const { x, y } = intersection(file, rank, perspective);
      const pieceSvg = renderFortressXiangqiPiece(
        piece,
        pieceSet,
        x,
        y,
        square === draggingFrom,
        rank,
      );
      // Keyed slot: a <g> wrapper per occupied square so a post-render glide
      // (animateFortressXiangqiBoardMove) can find and transform the piece.
      return `<g class="fxq-piece-slot" data-piece-square="${square}">${pieceSvg}</g>`;
    })
    .join('');
}

/**
 * Glide the piece that settled on `move.to` from its origin (or with `reverse`
 * the piece back on `move.from`). Call AFTER the innerHTML swap; board moves
 * only (drops have no origin square and stay discrete). No-op at duration 0 or
 * when the slot is missing. The move must come from a received payload.
 */
export function animateFortressXiangqiBoardMove(
  host: HTMLElement,
  move: { from: FortressXiangqiSquare; to: FortressXiangqiSquare },
  perspective: FortressXiangqiColor,
  opts: { reverse?: boolean } = {},
): void {
  const duration = pieceAnimationDurationMs();
  if (duration <= 0) return;
  const settleSquare = opts.reverse ? move.from : move.to;
  const originSquare = opts.reverse ? move.to : move.from;
  const slot = host.querySelector(`[data-piece-square="${settleSquare}"]`);
  if (!slot) return;
  const origin = fortressXiangqiCoordOf(originSquare);
  const settle = fortressXiangqiCoordOf(settleSquare);
  const from = intersection(origin.file, origin.rank, perspective);
  const to = intersection(settle.file, settle.rank, perspective);
  glideSvgPiece(slot, from.x - to.x, from.y - to.y, duration);
  // Draw the destination halo on as the piece lands (forward moves only): a
  // reverse step renders the prior move's marker at a different square.
  if (!opts.reverse) {
    drawMarkerOnArrival(host.querySelector(BOARD_LASTMOVE_MARKER_SELECTOR), duration);
  }
}

// Render a single piece centered on (x, y). The six shared xiangqi roles go
// through the standard glyph renderer; the Treasure is drawn inline.
function renderFortressXiangqiPiece(
  piece: FortressXiangqiPiece,
  set: XiangqiPieceSet,
  x: number,
  y: number,
  dragSource: boolean,
  // Board rank, for the soldier's river question. REQUIRED, and null means "not
  // on a square" (the drag ghost): a numeric default is the trap, because 0
  // reads as across-the-river for one of the two colours.
  rank: number | null,
): string {
  const className = dragSource ? 'fxq-piece fxq-piece--drag-source' : 'fxq-piece';
  const left = x - PIECE_SIZE / 2;
  const top = y - PIECE_SIZE / 2;
  if (piece.role === 'treasure') {
    return treasureDisc(piece.color, set, left, top, className);
  }
  return renderXiangqiPieceGlyphed(piece as unknown as XiangqiPiece, set, {
    ariaLabel: `${piece.color} ${piece.role}`,
    className,
    shrouded: false,
    x: left,
    y: top,
    size: PIECE_SIZE,
    // River-gated again since 2026-09-02, so the promoted art means what it means
    // everywhere else: this soldier has crossed. Fortress-specific predicate —
    // the 9x10 one disagrees on rank 5 for both colours.
    crossed: rank !== null && drawsFortressCrossedSoldier(piece, rank),
  });
}

// Treasure disc inner marks (centered in a 100x100 box). On the Dobutsu set it
// mirrors the animal-disc look (cream fill + image + colored ring) with the
// peacock art from the v2 minimal set. Other sets use the character disc.
function treasureInnerMarks(color: FortressXiangqiColor, set: XiangqiPieceSet): string {
  if (set === 'animal-dobutsu') {
    return animalTreasureMarks(color);
  }
  if (set === 'animal-flat') {
    return animalFlatTreasureMarks(color);
  }
  if (set === 'international') {
    return internationalTreasureMarks(color);
  }
  if (set === 'international-flat') {
    return internationalFlatTreasureMarks(color);
  }
  const colorHex = color === 'red' ? '#b91c1c' : '#1f2937';
  // Hanzi draws from the same baked Noto Sans CJK SC Bold outline every other
  // xiangqi piece uses (never the viewer's system serif), so the Treasure's
  // stroke weight matches its neighbors. The Symbols set gets a faceted gem so
  // it stays glyph-free like the rest of that set.
  const mark =
    set === 'symbols'
      ? treasureSymbolMark(colorHex)
      : cjkGlyphMark(set === 'simplified' ? '宝' : set === 'western' ? 'T' : '寶', colorHex);
  return [
    `<circle cx="50" cy="50" r="46" fill="#f3e6c4" stroke="${colorHex}" stroke-width="2.5"/>`,
    `<circle cx="50" cy="50" r="38" fill="none" stroke="${colorHex}" stroke-width="1.5"/>`,
    mark,
  ].join('');
}

function treasureDisc(
  color: FortressXiangqiColor,
  set: XiangqiPieceSet,
  x: number,
  y: number,
  className: string,
): string {
  const styleAttr = set === 'international-flat' ? ' style="filter:none"' : '';
  return `<svg class="${className}"${styleAttr} x="${x}" y="${y}" width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${color} treasure">${treasureInnerMarks(color, set)}</svg>`;
}

function selectionRing(
  selection: FortressXiangqiSquare | null,
  perspective: FortressXiangqiColor,
): string {
  if (!selection) return '';
  const { file, rank } = fortressXiangqiCoordOf(selection);
  const { x, y } = intersection(file, rank, perspective);
  return `<circle class="fxq-selection" cx="${x}" cy="${y}" r="${RING_SELECTION}"/>`;
}

function moveHints(
  view: FortressXiangqiPlayerView,
  targets: readonly FortressXiangqiSquare[],
  perspective: FortressXiangqiColor,
): string {
  return targets
    .map((sq) => {
      const { file, rank } = fortressXiangqiCoordOf(sq);
      const { x, y } = intersection(file, rank, perspective);
      const capture = view.board[sq] !== undefined;
      return capture
        ? `<circle class="fxq-hint-capture" cx="${x}" cy="${y}" r="${RING_CAPTURE}"/>`
        : `<circle class="fxq-hint" cx="${x}" cy="${y}" r="10"/>`;
    })
    .join('');
}

// Red cross on a point the piece cannot reach — the rules-diagram idiom for
// river-locked and eye-blocked destinations (matches the collaborator sheet).
function blockedMarks(
  squares: readonly FortressXiangqiSquare[],
  perspective: FortressXiangqiColor,
): string {
  return squares
    .map((sq) => {
      const { file, rank } = fortressXiangqiCoordOf(sq);
      const { x, y } = intersection(file, rank, perspective);
      return [
        `<g class="fxq-hint-blocked">`,
        `<circle cx="${x}" cy="${y}" r="13" fill="rgba(194, 38, 30, 0.08)" stroke="#c2261e" stroke-width="2.6"/>`,
        `<line x1="${x - 9}" y1="${y - 9}" x2="${x + 9}" y2="${y + 9}" stroke="#c2261e" stroke-width="3.2" stroke-linecap="round"/>`,
        `<line x1="${x + 9}" y1="${y - 9}" x2="${x - 9}" y2="${y + 9}" stroke="#c2261e" stroke-width="3.2" stroke-linecap="round"/>`,
        `</g>`,
      ].join('');
    })
    .join('');
}

// Shared with every other token board (board-lastmove.ts). A drop has no origin
// square, so it marks only the destination.
function lastMoveMarkers(
  view: FortressXiangqiPlayerView,
  perspective: FortressXiangqiColor,
): string {
  const last = view.lastMove;
  if (!last) return '';
  const center = (square: FortressXiangqiSquare): { x: number; y: number } => {
    const { file, rank } = fortressXiangqiCoordOf(square);
    return intersection(file, rank, perspective);
  };
  return boardLastMoveMarkersSvg(
    { from: 'from' in last ? center(last.from) : null, to: center(last.to) },
    PIECE_SIZE,
  );
}

function hitLayer(
  perspective: FortressXiangqiColor,
  view: FortressXiangqiPlayerView,
  targets: readonly FortressXiangqiSquare[],
): string {
  const targetSet = new Map<FortressXiangqiSquare, { capture: boolean }>();
  for (const sq of targets) targetSet.set(sq, { capture: view.board[sq] !== undefined });
  const parts: string[] = [];
  for (let f = 0; f < FILES; f += 1) {
    for (let r = 1; r <= RANKS; r += 1) {
      const sq = fortressXiangqiSquareOf(f, r);
      const { x, y } = intersection(f, r, perspective);
      const target = targetSet.get(sq);
      const marker = target
        ? target.capture
          ? `<circle class="fxq-hint-capture" cx="${x}" cy="${y}" r="${RING_CAPTURE}"/>`
          : `<circle class="fxq-hint" cx="${x}" cy="${y}" r="10"/>`
        : '';
      const hover = target
        ? `<circle class="fxq-target-hover" cx="${x}" cy="${y}" r="${RING_LAST}"/>`
        : '';
      parts.push(
        `<g data-square="${sq}" class="fxq-hit${target ? ' fxq-hit--target' : ''}">${hover}${marker}<rect x="${x - HIT_HALF}" y="${y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}"/></g>`,
      );
    }
  }
  return parts.join('');
}

function intersection(
  file: number,
  rank: number,
  perspective: FortressXiangqiColor,
  layout: XiangqiBoardLayout = activeLayout,
): { x: number; y: number } {
  return xiangqiBoardPoint(file, rank, perspective, layout, FXQ_GEO);
}

// Black views the board rotated 180 degrees (BOTH axes flipped), so each side's
// own palace stays bottom-left on its own screen. Flipping only the rank (a
// vertical mirror) puts the palaces on the wrong diagonal.

let stylesInstalled = false;

export function installFortressXiangqiBoardStyles(): void {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --fxq-board-bg: var(--xq-board-bg, #f5dca8);
      --fxq-palace-band: var(--fxq-board-bg, #f5dca8);
      --fxq-river: var(--fxq-board-bg, #f5dca8);
      --fxq-grid: var(--xq-board-ink, #5a3a14);
    }
    :root[data-xiangqi-board-theme="international"] {
      --fxq-board-bg: var(--xq-board-bg, #f5dca8);
      --fxq-palace-band: var(--fxq-board-bg, #f5dca8);
      --fxq-river: var(--fxq-board-bg, #f5dca8);
      --fxq-grid: var(--xq-board-ink, #5a3a14);
    }
    :root[data-xiangqi-board-theme="traditional"] {
      --fxq-board-bg: var(--xq-board-bg, #d9bd82);
      --fxq-palace-band: var(--fxq-board-bg, #d9bd82);
      --fxq-river: var(--fxq-board-bg, #d9bd82);
      --fxq-grid: var(--xq-board-ink, #4b3c2a);
    }
    .fxq-board {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      display: block;
      width: 100%;
      height: auto;
      touch-action: manipulation;
    }
    .fxq-board image,
    .fxq-piece {
      -webkit-user-drag: none;
    }
    .fxq-board-bg {
      fill: var(--fxq-board-bg, #d9bd82);
    }
    .fxq-river {
      fill: var(--fxq-river, var(--fxq-board-bg, #f5dca8));
    }
    .fxq-palace-band {
      fill: var(--fxq-palace-band, var(--fxq-board-bg, #f5dca8));
    }
    /* 1.2 matches .xq-live-line, the class the shared surface stamps on the grid
       lines. Only the palace diagonals reach this rule (xiangqiSurfacePalace
       emits them unclassed), so a different value here shows up as four
       conspicuously thicker lines inside each palace. */
    .fxq-grid line {
      stroke: var(--fxq-grid, #4b3c2a);
      stroke-width: 1.2;
      stroke-linecap: round;
    }
    .fxq-selection {
      fill: rgba(31, 111, 91, 0.32);
      pointer-events: none;
    }
    .fxq-hint {
      fill: rgba(31, 111, 91, 0.72);
      opacity: 0.78;
      pointer-events: none;
    }
    .fxq-hint-capture {
      fill: none;
      stroke: rgba(31, 111, 91, 0.48);
      stroke-width: 3;
      pointer-events: none;
    }
    .fxq-target-hover {
      fill: rgba(31, 111, 91, 0.3);
      opacity: 0;
      pointer-events: none;
    }
    .fxq-hit--target:hover .fxq-target-hover {
      opacity: 1;
    }
    .fxq-hit--target:hover .fxq-hint,
    .fxq-hit--target:hover .fxq-hint-capture {
      opacity: 0;
    }
    .fxq-piece {
      pointer-events: none;
      filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.2));
    }
    .fxq-piece--drag-source {
      opacity: 0.34;
    }
    .fxq-hit rect {
      fill: transparent;
      cursor: pointer;
    }
    .live-route--fortress-xiangqi {
      --uni-board-aspect: calc(516 / 588);
      --uni-board-max: 560px;
    }
    .fortress-xiangqi-live-board {
      aspect-ratio: 516 / 588;
      width: 100%;
      min-height: 0;
      border-radius: var(--board-corner-radius);
      overflow: hidden;
      box-shadow: 0 18px 50px rgba(37, 31, 24, 0.16);
    }
    /* The square grid is a different rectangle: it spans full cells plus the
       river gap (7*72 wide, 8*72 + 14 tall) rather than the outer intersections.
       Both the slot aspect and the board's own aspect-ratio have to follow, or
       the board overflows its overflow:hidden host and loses its bottom rank. */
    :root[data-xiangqi-board-layout='cell'] .live-route--fortress-xiangqi {
      --uni-board-aspect: calc(504 / 590);
    }
    :root[data-xiangqi-board-layout='cell'] .fortress-xiangqi-live-board {
      aspect-ratio: 504 / 590;
    }
    /* Coordinates on reserves a gutter of a fifth of a cell each side, so each
       layout/coordinate combination is its own rectangle. The host clips with
       overflow:hidden, which is what ate this board's bottom rank once already. */
    :root[data-board-coordinates='on'] .live-route--fortress-xiangqi {
      --uni-board-aspect: calc(544 / 616);
    }
    :root[data-board-coordinates='on'] .fortress-xiangqi-live-board {
      aspect-ratio: 544 / 616;
    }
    :root[data-board-coordinates='on'][data-xiangqi-board-layout='cell'] .live-route--fortress-xiangqi {
      --uni-board-aspect: calc(532 / 618);
    }
    :root[data-board-coordinates='on'][data-xiangqi-board-layout='cell'] .fortress-xiangqi-live-board {
      aspect-ratio: 532 / 618;
    }
    .fortress-xiangqi-live-board--disabled {
      background: repeating-linear-gradient(135deg, #ece7dc, #ece7dc 16px, #ddd5c5 16px, #ddd5c5 32px);
    }
  `;
  document.head.append(style);
}
