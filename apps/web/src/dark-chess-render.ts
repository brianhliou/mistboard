// Fog-aware SVG board renderer for the flagship Dark Chess (8x8 chess played
// under fog of war).
//
// A thin variant adapter over the shared descriptor-driven cell-board core
// (@mistboard/board-render renderGridBoardSvg), the 8x8 chess board with the
// fog overlay covering
// every square the viewer cannot see. This is the SVG twin of the chessground
// board the live room and legacy replay render: it lets the postgame review ride
// the shared review-layout shell (SVG scales with its container, so no
// chessground resize plumbing) while keeping the same green board + cburnett
// glyphs.
//
// Driven by the kernel's dark-chess PlayerView. Every board entry it carries is a
// fully known chess piece (own or a visible enemy); off-vision squares are
// shrouded by the fog layer.

import {
  GRID_INTERACTION_COLORS,
  type GridBoardDescriptor,
  type GridCellRef,
  type GridGeometry,
  PIECE_SVGS,
  renderGridBoardSvg,
} from '@mistboard/board-render';
import type { Color, Move, PieceRole, PlayerView, Square } from '@mistboard/game';
import './board-glyph-marker.css';
import './dark-chess-render.css';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { type SvgBoardArrowStyle, svgBoardArrow } from './svg-board-arrow.js';
import {
  GLYPH_OFFSET_RATIO,
  GLYPH_RADIUS_RATIO,
  type SvgBoardMarkerStyle,
  svgBoardCircleMarker,
  svgBoardGlyphMarker,
} from './svg-board-marker.js';

const FILES = 8;
const RANKS = 8;
const CELL = 50;
const PIECE_SIZE = CELL;

const DARK_CHESS_DESCRIPTOR: GridBoardDescriptor = {
  files: FILES,
  ranks: RANKS,
  cell: CELL,
  palette: {
    lightCell: 'var(--board-light)',
    darkCell: 'var(--board-dark)',
    coord: 'transparent',
    lastMove: 'var(--board-last-move)',
    selected: GRID_INTERACTION_COLORS.selected,
    targetDot: GRID_INTERACTION_COLORS.targetDot,
    targetRing: GRID_INTERACTION_COLORS.targetRing,
    targetHover: GRID_INTERACTION_COLORS.targetHover,
    fog: 'transparent',
  },
  pad: 0,
  boardRadius: 0,
  // chess polarity: a1 is a dark square.
  darkWhenEven: false,
  svgClass: 'dark-chess-live-svg',
};

// The subset of a PlayerView the board renderer needs. Truth passes a synthetic
// view (all pieces, no fog) built from the canonical board.
export type DarkChessBoardView = Pick<PlayerView, 'board' | 'visibleSquares' | 'lastMove'>;

export type DarkChessRenderOptions = {
  // Whose side is at the bottom. Defaults to White's perspective.
  perspective?: Color;
  // Draw the fog overlay over non-visible squares. Defaults to true.
  showFog?: boolean;
  lastMove?: Move | null;
  /** Judgment badge ('?', '??', '?!', '!', '!!') pinned to the last move's
   *  destination, the xiangqi replay board's marker on the chess board. */
  glyph?: string;
};

// Same palette classes as the xiangqi badge (board-glyph-marker.css), so a
// chess study and a xiangqi study read the same verdict the same way.
const GLYPH_CLASS: Record<string, string> = {
  '??': 'xq-marker--blunder',
  '?': 'xq-marker--mistake',
  '?!': 'xq-marker--inaccuracy',
  '!!': 'xq-marker--brilliant',
  '!': 'xq-marker--good',
};
const GLYPH_RADIUS = (13 / 60) * CELL;
const GLYPH_OFFSET = (21 / 60) * CELL;

/** The judgment badge at the top-right corner of the destination square, in
 *  screen space so it keeps its corner when the board flips. */
function glyphBadgeSvg(to: Square, glyph: string, geom: GridGeometry): string {
  const kind = GLYPH_CLASS[glyph];
  if (!kind) return '';
  const { file, rank } = coordOf(to);
  const { x, y } = geom.topLeft(file, rank);
  const cx = x + CELL / 2 + GLYPH_OFFSET;
  const cy = y + CELL / 2 - GLYPH_OFFSET;
  return (
    `<g class="xq-marker xq-marker--glyph ${kind}">` +
    `<circle class="xq-marker__disc" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${GLYPH_RADIUS.toFixed(1)}"/>` +
    `<text class="xq-marker__label" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" ` +
    `dominant-baseline="central" font-size="${(GLYPH_RADIUS * 1.15).toFixed(1)}">${glyph}</text>` +
    '</g>'
  );
}

let boardCounter = 0;

export function renderDarkChessBoardSvg(
  view: DarkChessBoardView,
  options: DarkChessRenderOptions = {},
): string {
  const perspective = options.perspective ?? 'white';
  const showFog = options.showFog ?? true;
  boardCounter += 1;
  const id = `dark-chess-live-${boardCounter}`;

  const visible = new Set<Square>(view.visibleSquares);
  const lastMove = options.lastMove ?? view.lastMove ?? null;
  const lastCells = lastMove ? [coordOf(lastMove.from), coordOf(lastMove.to)] : null;

  return renderGridBoardSvg(DARK_CHESS_DESCRIPTOR, {
    id,
    // Omitting this drew the labels unconditionally: grid-board treats only an
    // explicit false as off, so the site-wide setting never reached this board.
    coords: boardCoordinatesEnabled(),
    flip: perspective === 'black',
    renderPieces: (geom) =>
      [
        pieceLayer(view, geom, null),
        showFog ? fogLayer(visible, geom) : '',
        options.glyph && lastMove ? glyphBadgeSvg(lastMove.to, options.glyph, geom) : '',
      ].join(''),
    lastMove: lastCells,
    selected: null,
    targets: [],
    fogHidden: null,
    interactive: false,
    squareName: (file, rank) => squareAt(file, rank),
  });
}

// The subset of interactive state the review board threads in (selection + drag +
// legal targets). Separate from the read-only render so the postgame/watch paths
// stay untouched.
export type DarkChessInteractiveOptions = DarkChessRenderOptions & {
  selected?: Square | null;
  targets?: readonly Square[];
  draggingFrom?: Square | null;
  /** Engine-line and user-drawn arrows, painted above the pieces. */
  arrows?: readonly ChessBoardArrow[];
  /** Rings and judgment badges, painted above the pieces. */
  markers?: readonly ChessBoardMarker[];
};

/** One board arrow (engine PV, best-move advice, a drawn shape). Same style
 *  vocabulary as the xiangqi board's (`xq-arrow--pv1`, `--alt`, `--draw`). */
export type ChessBoardArrow = SvgBoardArrowStyle & { from: Square; to: Square };

/** A ring on a square, or the judgment badge in its top-right corner. */
export type ChessBoardMarker = SvgBoardMarkerStyle & {
  square: Square;
  kind: 'circle' | 'glyph';
  text?: string;
};

function cellCentre(square: Square, geom: GridGeometry): { x: number; y: number } {
  const { file, rank } = coordOf(square);
  const { x, y } = geom.topLeft(file, rank);
  return { x: x + CELL / 2, y: y + CELL / 2 };
}

/** Arrows above the pieces: from centre to centre, the shared arrow anatomy. */
function arrowLayer(arrows: readonly ChessBoardArrow[], geom: GridGeometry): string {
  return arrows
    .map((arrow) =>
      svgBoardArrow(arrow, cellCentre(arrow.from, geom), cellCentre(arrow.to, geom), {
        baseClassName: 'xq-arrow',
        startInset: CELL * 0.3,
        tipInset: CELL * 0.12,
      }),
    )
    .join('');
}

/** Rings and glyph badges above the pieces. */
function markerLayer(markers: readonly ChessBoardMarker[], geom: GridGeometry): string {
  return markers
    .map((marker) => {
      const centre = cellCentre(marker.square, geom);
      return marker.kind === 'glyph'
        ? svgBoardGlyphMarker(
            marker,
            centre,
            CELL * GLYPH_RADIUS_RATIO,
            CELL * GLYPH_OFFSET_RATIO,
            { baseClassName: 'xq-marker' },
          )
        : svgBoardCircleMarker(marker, centre, CELL * 0.42, { baseClassName: 'xq-marker' });
    })
    .join('');
}

// Interactive (review/analysis) render: like renderDarkChessBoardSvg but with
// selection highlight, legal-move target dots, drag-source dimming, and the grid's
// click hit-layer enabled. Mirrors renderJungleFlipBoardSvg's interactive contract.
export function renderDarkChessInteractiveBoardSvg(
  view: DarkChessBoardView,
  options: DarkChessInteractiveOptions = {},
): string {
  const perspective = options.perspective ?? 'white';
  const showFog = options.showFog ?? true;
  boardCounter += 1;
  const id = `dark-chess-live-${boardCounter}`;

  const visible = new Set<Square>(view.visibleSquares);
  const lastMove = options.lastMove ?? view.lastMove ?? null;
  const lastCells = lastMove ? [coordOf(lastMove.from), coordOf(lastMove.to)] : null;
  const draggingFrom = options.draggingFrom ?? null;

  return renderGridBoardSvg(DARK_CHESS_DESCRIPTOR, {
    id,
    // Omitting this drew the labels unconditionally: grid-board treats only an
    // explicit false as off, so the site-wide setting never reached this board.
    coords: boardCoordinatesEnabled(),
    flip: perspective === 'black',
    renderPieces: (geom) =>
      [
        pieceLayer(view, geom, draggingFrom),
        showFog ? fogLayer(visible, geom) : '',
        `<g class="xq-live-arrows" aria-hidden="true" pointer-events="none">${arrowLayer(options.arrows ?? [], geom)}${markerLayer(options.markers ?? [], geom)}</g>`,
      ].join(''),
    lastMove: lastCells,
    selected: options.selected ? coordOf(options.selected) : null,
    targets: (options.targets ?? []).map((square) => ({
      ...coordOf(square),
      occupied: view.board[square] !== undefined,
    })),
    fogHidden: null,
    interactive: true,
    squareName: (file, rank) => squareAt(file, rank),
  });
}

// The floating drag ghost for a piece (a single cburnett glyph in a one-cell box),
// appended to <body> by installBoardDrag.
export function darkChessPieceGhostSvg(role: PieceRole, color: Color): string {
  return chessPieceGlyphSvg(role, color);
}

// ── Coordinates ─────────────────────────────────────────────────────────────

function coordOf(square: Square): GridCellRef {
  return { file: square.charCodeAt(0) - 'a'.charCodeAt(0), rank: Number(square.slice(1)) };
}

function squareAt(file: number, rank: number): Square {
  return `${String.fromCharCode('a'.charCodeAt(0) + file)}${rank}` as Square;
}

function hiddenSquares(visible: Set<Square>): GridCellRef[] {
  const refs: GridCellRef[] = [];
  for (let file = 0; file < FILES; file += 1) {
    for (let rank = 1; rank <= RANKS; rank += 1) {
      if (!visible.has(squareAt(file, rank))) refs.push({ file, rank });
    }
  }
  return refs;
}

function fogLayer(visible: Set<Square>, geom: GridGeometry): string {
  return hiddenSquares(visible)
    .map((ref) => {
      const { x, y } = geom.topLeft(ref.file, ref.rank);
      const colorClass = isLightSquare(ref)
        ? 'dark-chess-fog-square--light'
        : 'dark-chess-fog-square--dark';
      return `<rect class="dark-chess-fog-square ${colorClass}" x="${x}" y="${y}" width="${CELL}" height="${CELL}"/>`;
    })
    .join('');
}

function isLightSquare(ref: GridCellRef): boolean {
  return (ref.file + ref.rank) % 2 === 0;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function pieceLayer(
  view: DarkChessBoardView,
  geom: GridGeometry,
  draggingFrom: Square | null,
): string {
  const size = PIECE_SIZE;
  const parts: string[] = [];
  for (const [square, piece] of Object.entries(view.board)) {
    if (!piece) continue;
    const { file, rank } = coordOf(square as Square);
    const { x, y } = geom.topLeft(file, rank);
    const token = chessPiece(piece.role, piece.color, x, y, size);
    parts.push(square === draggingFrom ? `<g class="dark-chess-drag-source">${token}</g>` : token);
  }
  return parts.join('');
}

function chessPiece(role: PieceRole, color: Color, x: number, y: number, size: number): string {
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 45 45" class="dark-chess-board-piece" xmlns="http://www.w3.org/2000/svg">`,
  );
}

// A standalone cburnett glyph (matching the board pieces) for the captured-
// material pools. The pool span sizes it via --capture-piece-size.
export function chessPieceGlyphSvg(role: PieceRole, color: Color): string {
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    '<svg viewBox="0 0 45 45" role="img" xmlns="http://www.w3.org/2000/svg">',
  );
}
