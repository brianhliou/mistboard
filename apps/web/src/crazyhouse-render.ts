// Live, fog-aware board renderer for Dark Crazyhouse (8x8 chess + drops).
//
// A thin variant adapter over the shared descriptor-driven cell-board core
// (@mistboard/board-render renderGridBoardSvg) — the same 8x8 chess board Reveal
// Chess uses, plus the fog overlay Dark Shogi uses. The core
// owns geometry (orientation flip), furniture (grid, coords, frame, clip) and the
// generic interaction layers (last-move, selection, targets, fog, hit). This file
// supplies the 8x8 chess descriptor, the cburnett glyphs, and the hand piece used
// by the reserves strip.
//
// Driven by the engine's CrazyhousePlayerView. There are NO shrouded silhouettes
// (dark chess omits off-vision pieces); every board entry it carries is a fully
// known chess piece.

import {
  GRID_INTERACTION_COLORS,
  type GridBoardDescriptor,
  type GridCellRef,
  type GridGeometry,
  PIECE_SVGS,
  renderGridBoardSvg,
} from '@mistboard/board-render';
import {
  type Color,
  type CrazyhouseDropRole,
  type CrazyhouseMove,
  type CrazyhousePlayerView,
  isCrazyhouseDrop,
  type PieceRole,
  type Square,
} from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { type GridBoardOverlayOptions, gridBoardOverlays } from './grid-board-overlays.js';

const FILES = 8;
const RANKS = 8;
const CELL = 50;
const PIECE_SIZE = CELL;

// Pixel size of a board piece — exported so the drag layer can size the floating
// ghost to match the rendered piece.
export const CRAZYHOUSE_PIECE_PX = PIECE_SIZE;

const CRAZYHOUSE_DESCRIPTOR: GridBoardDescriptor = {
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
  svgClass: 'crazyhouse-live-svg',
};

export type CrazyhouseRenderOptions = GridBoardOverlayOptions<Square> & {
  // Whose side is at the bottom. Defaults to the view's own perspective.
  perspective?: Color;
  // Draw the fog overlay over non-visible squares. Defaults to true.
  showFog?: boolean;
  lastMove?: CrazyhouseMove | null;
  selected?: Square | null;
  // Legal destination squares for the selection / drop (dots / capture rings).
  targets?: readonly Square[];
  // Add a transparent hit layer of <rect data-square="..."> for click handling.
  interactive?: boolean;
  // While dragging, keep a translucent copy on the source square.
  draggingFrom?: Square | null;
};

const HAND_ROLE_ORDER: readonly CrazyhouseDropRole[] = [
  'queen',
  'rook',
  'bishop',
  'knight',
  'pawn',
];

export { HAND_ROLE_ORDER as CRAZYHOUSE_HAND_ORDER };

let boardCounter = 0;

export function renderCrazyhouseBoardSvg(
  view: CrazyhousePlayerView,
  options: CrazyhouseRenderOptions = {},
): string {
  const perspective = options.perspective ?? view.perspective;
  const showFog = options.showFog ?? true;
  boardCounter += 1;
  const id = `crazyhouse-live-${boardCounter}`;

  const visible = new Set<Square>(view.visibleSquares);
  const occupied = new Set<Square>(Object.keys(view.board) as Square[]);
  const lastMove = options.lastMove ?? view.lastMove ?? null;
  const lastCells = lastMove
    ? isCrazyhouseDrop(lastMove)
      ? [coordOf(lastMove.to)]
      : [coordOf(lastMove.from), coordOf(lastMove.to)]
    : null;

  return renderGridBoardSvg(CRAZYHOUSE_DESCRIPTOR, {
    id,
    // Omitting this drew the labels unconditionally: grid-board treats only an
    // explicit false as off, so the site-wide setting never reached this board.
    coords: boardCoordinatesEnabled(),
    flip: perspective === 'black',
    renderPieces: (geom) =>
      [
        pieceLayer(view, geom, options.draggingFrom ?? null),
        showFog ? fogLayer(visible, geom) : '',
        gridBoardOverlays(geom, coordOf, options),
      ].join(''),
    lastMove: lastCells,
    selected: options.selected ? coordOf(options.selected) : null,
    targets: (options.targets ?? []).map((sq) => ({ ...coordOf(sq), occupied: occupied.has(sq) })),
    fogHidden: null,
    interactive: options.interactive ?? false,
    squareName: (file, rank) => squareAt(file, rank),
  });
}

// A standalone cburnett glyph for the reserves strip.
export function crazyhouseHandPieceSvg(role: CrazyhouseDropRole, color: Color): string {
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    '<svg viewBox="0 0 45 45" class="crazyhouse-hand-piece__svg" role="img" xmlns="http://www.w3.org/2000/svg">',
  );
}

// The standalone cburnett glyph for the floating drag ghost (board-drag.ts mounts
// it in a sized <div>). Only your own visible board pieces are draggable, so the
// piece identity is always known.
export function crazyhousePieceGhostSvg(role: PieceRole, color: Color): string {
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    `<svg width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`,
  );
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
        ? 'crazyhouse-fog-square--light'
        : 'crazyhouse-fog-square--dark';
      return `<rect class="crazyhouse-fog-square ${colorClass}" x="${x}" y="${y}" width="${CELL}" height="${CELL}"/>`;
    })
    .join('');
}

function isLightSquare(ref: GridCellRef): boolean {
  return (ref.file + ref.rank) % 2 === 0;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function pieceLayer(
  view: CrazyhousePlayerView,
  geom: GridGeometry,
  draggingFrom: Square | null,
): string {
  const size = PIECE_SIZE;
  const parts: string[] = [];
  for (const [square, piece] of Object.entries(view.board)) {
    if (!piece) continue;
    const { file, rank } = coordOf(square as Square);
    const { x, y } = geom.topLeft(file, rank);
    parts.push(chessPiece(piece.role, piece.color, x, y, size, square === draggingFrom));
  }
  return parts.join('');
}

function chessPiece(
  role: PieceRole,
  color: Color,
  x: number,
  y: number,
  size: number,
  dragSource: boolean,
): string {
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  const className = dragSource
    ? 'crazyhouse-board-piece crazyhouse-board-piece--drag-source'
    : 'crazyhouse-board-piece';
  return raw.replace(
    /^<svg[^>]*>/,
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 45 45" class="${className}" xmlns="http://www.w3.org/2000/svg">`,
  );
}
