// Live board renderer for Kriegspiel (standard chess played blind).
//
// A thin variant adapter over the shared descriptor-driven cell-board core
// (@mistboard/board-render renderGridBoardSvg) — the same 8x8 chess board Dark
// Crazyhouse use, with the fog overlay covering EVERY square the
// viewer does not own. Kriegspiel is stricter than fog: the view carries only
// the viewer's own pieces, so the whole rest of the board is shrouded (the
// player never learns whether an off-piece square is empty or holds an enemy).
//
// Driven by the kernel's KriegspielPlayerView. Every board entry is one of the
// viewer's own, fully known, chess pieces.

import {
  type GridBoardDescriptor,
  type GridCellRef,
  type GridGeometry,
  PIECE_SVGS,
  renderGridBoardSvg,
} from '@mistboard/board-render';
import type { Color, KriegspielPlayerView, Move, PieceRole, Square } from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { type GridBoardOverlayOptions, gridBoardOverlays } from './grid-board-overlays.js';
import { type PieceSet, readStoredPieceSet } from './theme.js';

const FILES = 8;
const RANKS = 8;
const CELL = 50;
const PIECE_SIZE = CELL;
const DEFAULT_CHESS_PIECE_SET: PieceSet = 'cburnett';
const CHESS_PIECE_CODES: Record<PieceRole, string> = {
  bishop: 'B',
  king: 'K',
  knight: 'N',
  pawn: 'P',
  queen: 'Q',
  rook: 'R',
};

// Pixel size of a board piece, exported so the drag helper can size the floating
// ghost to match the lifted piece exactly.
export const KRIEGSPIEL_PIECE_PX = PIECE_SIZE;

const KRIEGSPIEL_DESCRIPTOR: GridBoardDescriptor = {
  files: FILES,
  ranks: RANKS,
  cell: CELL,
  // Borderless, like the dark-chess fog board: no brown frame or board edge,
  // just the squares and the fog layer.
  pad: 0,
  boardRadius: 0,
  palette: {
    lightCell: 'var(--board-light)',
    darkCell: 'var(--board-dark)',
    coord: 'transparent',
    lastMove: 'var(--board-last-move)',
    selected: 'rgba(255,205,80,0.55)',
    targetDot: 'rgba(45,100,45,0.62)',
    targetRing: 'rgba(170,40,40,0.62)',
    fog: 'transparent',
  },
  // chess polarity: a1 is a dark square.
  darkWhenEven: false,
  svgClass: 'kriegspiel-live-svg',
};

export type KriegspielRenderOptions = GridBoardOverlayOptions<Square> & {
  // Whose side is at the bottom. Defaults to the view's own perspective.
  perspective?: Color;
  // Draw the fog overlay over non-visible squares. Defaults to true.
  showFog?: boolean;
  lastMove?: Move | null;
  selected?: Square | null;
  // Offered destination squares for the selection (dots / capture rings). In
  // Kriegspiel these are pseudo-legal — some are probes that will bounce.
  targets?: readonly Square[];
  // Squares a checking piece could occupy (the umpire's call, drawn over the
  // fog). Empty / omitted when the viewer is not in check.
  threats?: readonly Square[];
  // Add a transparent hit layer of <rect data-square="..."> for click handling.
  interactive?: boolean;
  // While dragging, omit the source piece so only the floating ghost shows.
  draggingFrom?: Square | null;
  // Chess piece set. Defaults to the active appearance setting.
  pieceSet?: PieceSet;
};

let boardCounter = 0;

function kriegspielFogPatternDefs(id: string): string {
  const boardSize = FILES * CELL;
  const driftStyle = [
    'width:100%',
    'height:100%',
    "background-image:url('/fog/fog.webp')",
    'background-repeat:repeat',
    `background-size:${CELL}px ${CELL}px`,
  ].join(';');
  const pattern = (
    tone: 'light' | 'dark',
  ) => `<pattern id="${id}-fog-${tone}" patternUnits="userSpaceOnUse" width="${boardSize}" height="${boardSize}">
<rect class="kriegspiel-fog-tint kriegspiel-fog-tint--${tone}" width="${boardSize}" height="${boardSize}"/>
<foreignObject class="kriegspiel-fog-tex kriegspiel-fog-tex-drift" x="0" y="0" width="${boardSize}" height="${boardSize}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="${driftStyle}"></div>
</foreignObject>
<image class="kriegspiel-fog-tex kriegspiel-fog-tex-mist" href="/fog/mistveil.webp" x="0" y="0" width="${boardSize}" height="${boardSize}" preserveAspectRatio="xMidYMid slice"/>
</pattern>`;
  return `${pattern('light')}${pattern('dark')}`;
}

export function renderKriegspielBoardSvg(
  view: KriegspielPlayerView,
  options: KriegspielRenderOptions = {},
): string {
  const perspective = options.perspective ?? view.perspective;
  const showFog = options.showFog ?? true;
  const pieceSet = options.pieceSet ?? readStoredPieceSet();
  boardCounter += 1;
  const id = `kriegspiel-live-${boardCounter}`;

  const visible = new Set<Square>(view.visibleSquares);
  const occupied = new Set<Square>(Object.keys(view.board) as Square[]);
  const lastMove = options.lastMove ?? view.lastMove ?? null;
  const lastCells = lastMove ? [coordOf(lastMove.from), coordOf(lastMove.to)] : null;

  return renderGridBoardSvg(KRIEGSPIEL_DESCRIPTOR, {
    id,
    flip: perspective === 'black',
    renderPieces: (geom) =>
      [
        pieceLayer(view, geom, options.draggingFrom ?? null, pieceSet),
        showFog ? fogLayer(visible, geom, id) : '',
        gridBoardOverlays(geom, coordOf, options),
      ].join(''),
    extraDefs: showFog ? kriegspielFogPatternDefs(id) : '',
    lastMove: lastCells,
    selected: options.selected ? coordOf(options.selected) : null,
    targets: (options.targets ?? []).map((sq) => ({ ...coordOf(sq), occupied: occupied.has(sq) })),
    fogHidden: null,
    threats: (options.threats ?? []).map(coordOf),
    interactive: options.interactive ?? false,
    coords: boardCoordinatesEnabled(),
    squareName: (file, rank) => squareAt(file, rank),
  });
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

function fogLayer(visible: Set<Square>, geom: GridGeometry, id: string): string {
  return hiddenSquares(visible)
    .map((ref) => {
      const { x, y } = geom.topLeft(ref.file, ref.rank);
      const tone = isLightSquare(ref) ? 'light' : 'dark';
      return `<rect class="kriegspiel-fog-square kriegspiel-fog-square--${tone}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="url(#${id}-fog-${tone})"/>`;
    })
    .join('');
}

function isLightSquare(ref: GridCellRef): boolean {
  return (ref.file + ref.rank) % 2 === 0;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function pieceLayer(
  view: KriegspielPlayerView,
  geom: GridGeometry,
  draggingFrom: Square | null,
  pieceSet: PieceSet,
): string {
  const size = PIECE_SIZE;
  const parts: string[] = [];
  for (const [square, piece] of Object.entries(view.board)) {
    if (!piece) continue;
    if (square === draggingFrom) continue;
    const { file, rank } = coordOf(square as Square);
    const { x, y } = geom.topLeft(file, rank);
    parts.push(chessPiece(piece.role, piece.color, x, y, size, pieceSet));
  }
  return parts.join('');
}

function chessPiece(
  role: PieceRole,
  color: Color,
  x: number,
  y: number,
  size: number,
  pieceSet: PieceSet,
): string {
  if (pieceSet !== DEFAULT_CHESS_PIECE_SET) {
    const code = CHESS_PIECE_CODES[role];
    return `<image href="/pieces/${pieceSet}/${color === 'white' ? 'w' : 'b'}${code}.svg" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">`,
  );
}

// A standalone cburnett glyph for the promotion picker (matches the board).
export function kriegspielPromotionPieceSvg(
  role: PieceRole,
  color: Color,
  pieceSet: PieceSet = readStoredPieceSet(),
): string {
  if (pieceSet !== DEFAULT_CHESS_PIECE_SET) {
    const code = CHESS_PIECE_CODES[role];
    return `<svg viewBox="0 0 45 45" class="kriegspiel-promotion__svg" role="img" xmlns="http://www.w3.org/2000/svg"><image href="/pieces/${pieceSet}/${color === 'white' ? 'w' : 'b'}${code}.svg" width="45" height="45" preserveAspectRatio="xMidYMid meet"/></svg>`;
  }
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    '<svg viewBox="0 0 45 45" class="kriegspiel-promotion__svg" role="img" xmlns="http://www.w3.org/2000/svg">',
  );
}

// The standalone glyph for the floating drag ghost (board-drag.ts mounts it in a
// sized <div>). The dragged piece is always one of the viewer's own known pieces.
export function kriegspielPieceGhostSvg(
  role: PieceRole,
  color: Color,
  pieceSet: PieceSet = readStoredPieceSet(),
): string {
  if (pieceSet !== DEFAULT_CHESS_PIECE_SET) {
    const code = CHESS_PIECE_CODES[role];
    return `<svg width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 ${PIECE_SIZE} ${PIECE_SIZE}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><image href="/pieces/${pieceSet}/${color === 'white' ? 'w' : 'b'}${code}.svg" width="${PIECE_SIZE}" height="${PIECE_SIZE}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  }
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    `<svg width="${PIECE_SIZE}" height="${PIECE_SIZE}" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`,
  );
}
