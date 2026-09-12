// Board renderer for Reveal Chess (chess-jieqi): standard 8x8 chess with hidden
// piece IDENTITIES.
//
// A thin variant adapter over the shared descriptor-driven cell-board core
// (@mistboard/board-render renderGridBoardSvg). The core owns geometry
// (orientation flip), furniture (grid, coords, frame, clip), and the generic
// interaction layers (last-move, selection, targets, hit). This file supplies
// only what is Reveal-Chess-specific: the 8x8 descriptor, the cburnett chess
// glyphs for revealed pieces, and the face-down disc token.
//
// Reveal Chess is NOT a fog tenant: every occupied square is public. The hidden
// axis is IDENTITY. A face-down (unrevealed) piece carries NO role on the wire
// (`{ color, faceDown: true }`) and renders as a solid disc with a centered "?"
// in chess's white/black ownership palette. A revealed piece carries its true
// role (`{ color, role, faceDown: false }`) and renders as the standard cburnett
// glyph (no recolor: reveal-chess uses the standard white/black set).
//
// The client renders ONLY the server-sent PlayerView; it never invents or infers
// a hidden identity (the hidden-info invariant on the client side).

import {
  GRID_INTERACTION_COLORS,
  type GridBoardDescriptor,
  type GridCellRef,
  type GridGeometry,
  PIECE_SVGS,
  renderGridBoardSvg,
} from '@mistboard/board-render';
import type {
  RevealChessColor,
  RevealChessPieceRole,
  RevealChessPlayerView,
  RevealChessSquare,
} from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { type GridBoardOverlayOptions, gridBoardOverlays } from './grid-board-overlays.js';

const FILES = 8;
const RANKS = 8;
const CELL = 50;

// The 8x8 reveal-chess board, expressed as data for the shared core. Mirrors the
// Grid-board chess palette (lichess brown), minus the river strip.
const REVEAL_CHESS_DESCRIPTOR: GridBoardDescriptor = {
  files: FILES,
  ranks: RANKS,
  cell: CELL,
  palette: {
    lightCell: 'var(--board-light)',
    darkCell: 'var(--board-dark)',
    coord: 'var(--crossroads-coord)',
    lastMove: 'var(--board-last-move)',
    selected: GRID_INTERACTION_COLORS.selected,
    targetDot: GRID_INTERACTION_COLORS.targetDot,
    targetRing: GRID_INTERACTION_COLORS.targetRing,
    targetHover: GRID_INTERACTION_COLORS.targetHover,
    fog: 'var(--board-fog-light-fill)',
  },
  svgClass: 'reveal-chess-live-svg',
};

export type RevealChessRenderOptions = GridBoardOverlayOptions<RevealChessSquare> & {
  // Whose side is at the bottom. Defaults to the view's own perspective.
  perspective?: RevealChessColor;
  lastMove?: { from: RevealChessSquare; to: RevealChessSquare } | null;
  // The currently selected square (highlighted).
  selected?: RevealChessSquare | null;
  // Legal destination squares for the selection (dots / capture rings).
  targets?: readonly RevealChessSquare[];
  // Squares to emphasise under the pieces (study / diagram callouts).
  highlights?: readonly RevealChessSquare[];
  // Add a transparent hit layer of <rect data-square="..."> for click handling.
  interactive?: boolean;
  // While dragging, omit the source piece so only the floating ghost shows.
  draggingFrom?: RevealChessSquare | null;
};

let boardCounter = 0;

export function renderRevealChessBoardSvg(
  view: RevealChessPlayerView,
  options: RevealChessRenderOptions = {},
): string {
  const perspective = options.perspective ?? view.perspective;
  boardCounter += 1;
  const id = `reveal-chess-live-${boardCounter}`;

  const occupied = new Set<RevealChessSquare>(Object.keys(view.board) as RevealChessSquare[]);
  const lastMove = options.lastMove ?? view.lastMove ?? null;

  return renderGridBoardSvg(REVEAL_CHESS_DESCRIPTOR, {
    id,
    // Omitting this drew the labels unconditionally: grid-board treats only an
    // explicit false as off, so the site-wide setting never reached this board.
    coords: boardCoordinatesEnabled(),
    flip: perspective === 'black',
    renderPieces: (geom) =>
      pieceLayer(view, geom, options.draggingFrom ?? null) +
      gridBoardOverlays(geom, coordOf, options),
    lastMove: lastMove ? [coordOf(lastMove.from), coordOf(lastMove.to)] : null,
    selected: options.selected ? coordOf(options.selected) : null,
    highlights: (options.highlights ?? []).map(coordOf),
    targets: (options.targets ?? []).map((sq) => ({ ...coordOf(sq), occupied: occupied.has(sq) })),
    interactive: options.interactive ?? false,
    squareName: (file, rank) => squareAt(file, rank),
  });
}

export const REVEAL_CHESS_BOARD_PX = CELL;

// Pixel size of the floating drag ghost (board-drag.ts mounts it in a sized
// <div>). One cell, so the ghost matches the on-board footprint.
export const REVEAL_CHESS_PIECE_PX = CELL;

// The standalone token for the floating drag ghost: a face-down entry's ghost is
// the same "?" ownership disc the board draws; a revealed entry's ghost is its
// cburnett glyph (drawn with the same 0.86-cell inset as the board). Mirrors the
// two cases in pieceLayer so the ghost looks identical to the piece being lifted.
export function revealChessPieceGhostSvg(
  entry:
    | { color: RevealChessColor; role: RevealChessPieceRole; faceDown: false }
    | { color: RevealChessColor; faceDown: true },
): string {
  const inner = entry.faceDown
    ? facedownDisc(entry.color, 0, 0)
    : (() => {
        const size = CELL * 0.86;
        const inset = (CELL - size) / 2;
        return chessPiece(entry.role, entry.color, inset, inset, size);
      })();
  return (
    `<svg width="${CELL}" height="${CELL}" viewBox="0 0 ${CELL} ${CELL}" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`
  );
}

// ── Coordinates ─────────────────────────────────────────────────────────────

function coordOf(square: RevealChessSquare): GridCellRef {
  return { file: square.charCodeAt(0) - 'a'.charCodeAt(0), rank: Number(square.slice(1)) };
}

function squareAt(file: number, rank: number): RevealChessSquare {
  return `${String.fromCharCode('a'.charCodeAt(0) + file)}${rank}` as RevealChessSquare;
}

// ── Pieces (the Reveal-Chess-specific layer) ──────────────────────────────────

function pieceLayer(
  view: RevealChessPlayerView,
  geom: GridGeometry,
  draggingFrom: RevealChessSquare | null,
): string {
  const parts: string[] = [];
  for (const [square, entry] of Object.entries(view.board)) {
    if (!entry) continue;
    if (square === draggingFrom) continue;
    const { file, rank } = coordOf(square as RevealChessSquare);
    const { x, y } = geom.topLeft(file, rank);
    if (entry.faceDown) {
      // No role on a face-down entry: render the ownership disc, never guess.
      parts.push(facedownDisc(entry.color, x, y));
      continue;
    }
    const size = CELL * 0.86;
    const inset = (CELL - size) / 2;
    parts.push(chessPiece(entry.role, entry.color, x + inset, y + inset, size));
  }
  return parts.join('');
}

// A revealed piece: the standard cburnett glyph. Reveal Chess uses the standard
// white/black set, so no recolor is needed.
function chessPiece(
  role: RevealChessPieceRole,
  color: RevealChessColor,
  x: number,
  y: number,
  size: number,
): string {
  const raw = PIECE_SVGS[`${color}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">`,
  );
}

// Face-down token (locked design): a solid circular disc with a centered "?" in
// chess's white/black ownership palette. The "?" is required — it signals that
// the identity is hidden, not merely that a piece is present.
//   white piece: body #f4efe4, rim #3a342b, "?" #2b2620
//   black piece: body #2b2620, rim #0d0b08, "?" #efe7d6
const FACEDOWN_PALETTE: Record<RevealChessColor, { body: string; rim: string; q: string }> = {
  white: { body: '#f4efe4', rim: '#3a342b', q: '#2b2620' },
  black: { body: '#2b2620', rim: '#0d0b08', q: '#efe7d6' },
};

export function revealChessFacedownDisc(
  color: RevealChessColor,
  x: number,
  y: number,
  cell: number = CELL,
): string {
  const { body, rim, q } = FACEDOWN_PALETTE[color];
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  return (
    `<g class="reveal-chess-facedown" aria-label="${color} hidden piece">` +
    `<circle cx="${cx}" cy="${cy}" r="${cell * 0.4}" fill="${body}" stroke="${rim}" stroke-width="2"/>` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Georgia, 'Times New Roman', serif" font-weight="700" ` +
    `font-size="${cell * 0.46}" fill="${q}">?</text>` +
    `</g>`
  );
}

function facedownDisc(color: RevealChessColor, x: number, y: number): string {
  return revealChessFacedownDisc(color, x, y, CELL);
}
