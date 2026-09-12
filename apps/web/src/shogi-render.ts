// Live, fog-aware board renderer for Dark Shogi (9x9).
//
// A thin variant adapter over the shared descriptor-driven cell-board core
// (@mistboard/board-render renderGridBoardSvg), the same core the chess
// boards ride. The core owns geometry (orientation flip), furniture
// (grid, coords, frame, clip) and the generic interaction layers (last-move,
// selection, targets, fog, hit). This file supplies only what is shogi-specific:
// the 9x9 descriptor, the themed wood palette, the pentagonal koma glyph (a piece
// face on a wedge tile that points toward the enemy), and the hand-koma used by
// the reserves strip.
//
// Appearance: board theme + piece set are user-selectable (shogi-appearance-
// storage.ts), so the palette and the koma glyph are resolved per render from
// the stored preference (or an explicit option, used by the rules diagrams to
// pin the kanji default). The live board re-renders on shogiAppearanceChangedEvent.
//
// Driven by the engine's ShogiPlayerView. There are NO shrouded silhouettes —
// shogi has no screen mechanic, so the fog view simply omits pieces off vision;
// every board entry it carries is a fully-known piece (color, role, promoted).

import {
  GRID_INTERACTION_COLORS,
  type GridCellRef,
  type GridGeometry,
  type GridPalette,
  renderGridBoardSvg,
} from '@mistboard/board-render';
import {
  isShogiDrop,
  type ShogiColor,
  type ShogiHandRole,
  type ShogiMove,
  type ShogiPiece,
  type ShogiPlayerView,
  type ShogiSquare,
  shogiCoordOf,
  shogiSquareOf,
} from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';
import { type GridBoardOverlayOptions, gridBoardOverlays } from './grid-board-overlays.js';
import {
  readStoredShogiBoardTheme,
  readStoredShogiPieceSet,
  type ShogiBoardTheme,
} from './shogi-appearance-storage.js';
import {
  type ShogiPieceSet,
  shogiGlyph,
  shogiImagePieceHref,
  shogiImageSet,
} from './shogi-piece-sets.js';

const FILES = 9;
const RANKS = 9;
const CELL = 48;

// On-board text-koma tile size in the renderer's internal SVG units.
export const SHOGI_PIECE_PX = CELL * 0.9;
export const SHOGI_FILES = FILES;
const KOMA_GLYPH_CENTER_Y = 0.62;

// Per-theme cell colors. The frame is always transparent (borderless, to
// match the fog aesthetic of the other variants) and the interaction colors
// (last-move, selection, targets) are constant across themes.
const SHOGI_BOARD_PALETTES: Record<
  ShogiBoardTheme,
  { lightCell: string; darkCell: string; coord: string }
> = {
  wood: {
    lightCell: '#f4ddb0',
    darkCell: '#ecd09c',
    coord: '#8a6d3f',
  },
  kaya: {
    lightCell: '#f7e7c2',
    darkCell: '#f1ddb0',
    coord: '#9a7b46',
  },
  plain: {
    lightCell: '#ece4d4',
    darkCell: '#e3d8c4',
    coord: '#8c8270',
  },
};

const SHOGI_FOG_FALLBACK = 'rgba(46, 43, 37, 0.82)';

function paletteFor(theme: ShogiBoardTheme, fogFill = SHOGI_FOG_FALLBACK): GridPalette {
  const c = SHOGI_BOARD_PALETTES[theme] ?? SHOGI_BOARD_PALETTES.wood;
  return {
    lightCell: c.lightCell,
    darkCell: c.darkCell,
    // Borderless: the wood checker carries Shogi's identity, so the frame goes
    // transparent and the cells run edge-to-edge (see frame-zeroing below).
    coord: c.coord,
    lastMove: 'rgba(230,201,95,0.62)',
    selected: GRID_INTERACTION_COLORS.selected,
    targetDot: GRID_INTERACTION_COLORS.targetDot,
    targetRing: GRID_INTERACTION_COLORS.targetRing,
    targetHover: GRID_INTERACTION_COLORS.targetHover,
    // Off-vision pieces are already absent from the view, so fog can be a real
    // dark field instead of a pale disabled-state wash.
    fog: fogFill,
  };
}

function shogiDescriptor(theme: ShogiBoardTheme, fogFill?: string) {
  return {
    files: FILES,
    ranks: RANKS,
    cell: CELL,
    palette: paletteFor(theme, fogFill),
    pad: 0,
    boardRadius: 0,
    // Shogi files run 9..1 left-to-right from Black's side; ranks fall back to the
    // core's numeric labels (the core has no rank-letter hook — cosmetic only,
    // every interaction is click-driven by data-square).
    fileLabel: (file: number) => String(FILES - file),
    svgClass: 'shogi-board-svg',
  };
}

function shogiFogPatternDefs(id: string): string {
  const boardSize = FILES * CELL;
  return `<pattern id="${id}-fog" patternUnits="userSpaceOnUse" width="${boardSize}" height="${boardSize}">
<rect class="shogi-fog-tint" width="${boardSize}" height="${boardSize}" fill="${SHOGI_FOG_FALLBACK}"/>
<image class="shogi-fog-tex shogi-fog-tex-drift" href="/fog/fog.webp" x="0" y="0" width="${boardSize}" height="${boardSize}" preserveAspectRatio="xMidYMid slice"/>
<image class="shogi-fog-tex shogi-fog-tex-mist" href="/fog/mistveil.webp" x="0" y="0" width="${boardSize}" height="${boardSize}" preserveAspectRatio="xMidYMid slice"/>
</pattern>`;
}

export type ShogiRenderOptions = GridBoardOverlayOptions<ShogiSquare> & {
  // Whose side sits at the bottom. Defaults to the view's own perspective.
  perspective?: ShogiColor;
  // Draw the fog overlay over non-visible squares. Defaults to true.
  showFog?: boolean;
  lastMove?: ShogiMove | null;
  selected?: ShogiSquare | null;
  // Legal destinations for the current selection / drop (dots or capture rings).
  targets?: readonly ShogiSquare[];
  // Add a transparent hit layer of <rect data-square="..."> for click handling.
  interactive?: boolean;
  // While dragging, omit the source koma so only the floating ghost shows.
  draggingFrom?: ShogiSquare | null;
  // Override the piece set / board theme. The live board omits both and reads
  // the stored preference.
  pieceSet?: ShogiPieceSet;
  boardTheme?: ShogiBoardTheme;
  // Draw file/rank coordinate labels. Defaults to false; live and review boards
  // should stay visually clean, while specific teaching diagrams can opt in.
  showCoords?: boolean;
  // Squares to tint as forbidden (red). The rules diagrams use this to show the
  // drop restrictions, e.g. the file a pawn cannot be dropped onto (nifu).
  forbidden?: readonly ShogiSquare[];
};

let boardCounter = 0;

export function renderShogiBoardSvg(
  view: ShogiPlayerView,
  options: ShogiRenderOptions = {},
): string {
  const perspective = options.perspective ?? view.perspective;
  const showFog = options.showFog ?? true;
  const set = options.pieceSet ?? readStoredShogiPieceSet();
  const theme = options.boardTheme ?? readStoredShogiBoardTheme();
  boardCounter += 1;
  const id = `shogi-live-${boardCounter}`;

  const visible = new Set<ShogiSquare>(view.visibleSquares);
  const occupied = new Set<ShogiSquare>(Object.keys(view.board) as ShogiSquare[]);
  const lastMove = options.lastMove ?? view.lastMove ?? null;
  const lastCells = lastMove
    ? isShogiDrop(lastMove)
      ? [coordOf(lastMove.to)]
      : [coordOf(lastMove.from), coordOf(lastMove.to)]
    : null;

  return renderGridBoardSvg(shogiDescriptor(theme, `url(#${id}-fog)`), {
    id,
    flip: perspective === 'white',
    extraDefs: showFog ? shogiFogPatternDefs(id) : '',
    renderPieces: (geom) =>
      pieceLayer(view, geom, perspective, options.draggingFrom ?? null, set) +
      gridBoardOverlays(geom, coordOf, options),
    lastMove: lastCells,
    selected: options.selected ? coordOf(options.selected) : null,
    targets: (options.targets ?? []).map((sq) => ({ ...coordOf(sq), occupied: occupied.has(sq) })),
    fogHidden: showFog ? hiddenSquares(visible) : null,
    threats: (options.forbidden ?? []).map((sq) => coordOf(sq)),
    interactive: options.interactive ?? false,
    coords: options.showCoords ?? boardCoordinatesEnabled(),
    squareName: (file, rank) => squareAt(file, rank),
  });
}

export function shogiBoardPieceScale(set: ShogiPieceSet = readStoredShogiPieceSet()): number {
  return shogiImageSet(set) ? 1 : 0.9;
}

// A standalone mini-koma (reserves strip, promotion preview). pointsUp false
// renders an opponent-oriented (upside-down) tile, used for the postgame top
// reserve. The piece set follows the stored preference unless pinned.
export function shogiKomaSvg(
  piece: ShogiPiece,
  pointsUp = true,
  set: ShogiPieceSet = readStoredShogiPieceSet(),
): string {
  const size = 40;
  return `<svg viewBox="0 0 ${size} ${size}" class="shogi-hand-koma__svg" role="img" aria-label="${piece.color} ${piece.role}${piece.promoted ? ' promoted' : ''}" xmlns="http://www.w3.org/2000/svg">${komaFragment(
    piece,
    0,
    0,
    size,
    pointsUp,
    set,
  )}</svg>`;
}

// Reserves are always unpromoted hand pieces — a thin wrapper over the general
// koma for the hand strip.
export function shogiHandKomaSvg(
  role: ShogiHandRole,
  color: ShogiColor,
  pointsUp = true,
  set: ShogiPieceSet = readStoredShogiPieceSet(),
): string {
  return shogiKomaSvg({ color, role, promoted: false }, pointsUp, set);
}

// The standalone koma for the floating drag ghost (board-drag.ts mounts it in a
// sized <div>). Only your OWN visible board pieces are draggable, so the koma
// always points up (toward the enemy) like every piece you own. The SVG fills
// its container so the responsive drag helper can scale the koma to board size.
export function shogiPieceGhostSvg(
  piece: ShogiPiece,
  set: ShogiPieceSet = readStoredShogiPieceSet(),
): string {
  const size = 40;
  return `<svg viewBox="0 0 ${size} ${size}" class="shogi-piece-ghost__svg" width="100%" height="100%" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${komaFragment(
    piece,
    0,
    0,
    size,
    true,
    set,
  )}</svg>`;
}

export const SHOGI_HAND_ORDER: readonly ShogiHandRole[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

// ── Coordinates ─────────────────────────────────────────────────────────────
// Black's home rank (i) sits at the bottom; file 9 sits on the left. The core's
// `flip` rotates the whole board 180° for White's perspective.

function coordOf(square: ShogiSquare): GridCellRef {
  const { file, rankIndex } = shogiCoordOf(square);
  return { file: FILES - file, rank: RANKS - rankIndex };
}

function squareAt(file: number, rank: number): ShogiSquare {
  return shogiSquareOf(FILES - file, RANKS - rank);
}

function hiddenSquares(visible: Set<ShogiSquare>): GridCellRef[] {
  const refs: GridCellRef[] = [];
  for (let file = 0; file < FILES; file += 1) {
    for (let rank = 1; rank <= RANKS; rank += 1) {
      if (!visible.has(squareAt(file, rank))) refs.push({ file, rank });
    }
  }
  return refs;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function pieceLayer(
  view: ShogiPlayerView,
  geom: GridGeometry,
  perspective: ShogiColor,
  draggingFrom: ShogiSquare | null,
  set: ShogiPieceSet,
): string {
  // Image sets are self-contained koma art designed to fill the cell; text koma
  // draw a pentagon inset slightly inside it.
  const drawSize = shogiImageSet(set) ? CELL : CELL * 0.9;
  const drawInset = (CELL - drawSize) / 2;
  const parts: string[] = [];
  for (const [square, piece] of Object.entries(view.board)) {
    if (!piece) continue;
    if (square === draggingFrom) continue;
    const { file, rank } = coordOf(square as ShogiSquare);
    const { x, y } = geom.topLeft(file, rank);
    // A piece you own points up-screen (toward the enemy); the opponent's points
    // down. Your side is whoever sits at the bottom (the perspective player).
    const pointsUp = piece.color === perspective;
    parts.push(komaFragment(piece, x + drawInset, y + drawInset, drawSize, pointsUp, set));
  }
  return parts.join('');
}

// A single pentagonal koma at (x,y) of the given size. The tile is always drawn
// pointing up and rotated 180° for the down orientation, so ownership reads from
// which way it points (toward the enemy). The glyph is centered in the tile body
// (dominant-baseline central, ~0.6·size, the centroid of the home-plate pentagon)
// and sized to fill it.
//
// Image sets place a bundled lishogi koma SVG (a complete, side-oriented koma —
// 0XX sente apex-up, 1XX gote apex-down), so they need neither a drawn pentagon
// nor a rotation; the right file already points the right way.
//
// Text sets draw a pentagon + glyph. Kanji are read with the koma — rotated for
// the opponent, as on a real board. Latin letters carry no orientation, so the
// western set keeps them upright (and re-seats them in the now-top body of a
// flipped tile); ownership still reads from the tile's direction + color, and an
// upside-down "R" never looks broken.
function komaFragment(
  piece: ShogiPiece,
  x: number,
  y: number,
  size: number,
  pointsUp: boolean,
  set: ShogiPieceSet,
): string {
  const imageSet = shogiImageSet(set);
  if (imageSet) {
    const href = shogiImagePieceHref(imageSet, piece, pointsUp);
    return `<image href="${href}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}"/>`;
  }
  const fill = piece.color === 'black' ? '#d9a441' : '#f3e6c8';
  const stroke = piece.color === 'black' ? '#9a7320' : '#b89f68';
  const glyph = shogiGlyph(set, piece);
  const textFill = piece.promoted && glyph.promotedInk ? '#b22222' : '#3a2c14';
  const cx = (x + size / 2).toFixed(2);
  const cy = (y + size / 2).toFixed(2);
  const rotateGlyph = set !== 'western';

  const tilePath = `<path d="${pentagonPath(x, y, size)}" fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/>`;
  const tile = pointsUp ? tilePath : `<g transform="rotate(180 ${cx} ${cy})">${tilePath}</g>`;

  // Upright glyphs sit in the body: the inverse keeps western glyphs in the
  // visible body when the tile points down but the glyph itself stays upright.
  const baselineFactor = rotateGlyph || pointsUp ? KOMA_GLYPH_CENTER_Y : 1 - KOMA_GLYPH_CENTER_Y;
  const baselineY = (y + size * baselineFactor).toFixed(2);
  const textEl = `<text x="${cx}" y="${baselineY}" text-anchor="middle" dominant-baseline="central" font-size="${(size * glyph.fontScale).toFixed(1)}" font-family='${glyph.fontFamily}' font-weight="${glyph.fontWeight}" fill="${textFill}">${glyph.text}</text>`;
  const text =
    !pointsUp && rotateGlyph ? `<g transform="rotate(180 ${cx} ${cy})">${textEl}</g>` : textEl;

  return tile + text;
}

// Home-plate pentagon (apex up), as an absolute-coordinate path.
function pentagonPath(x: number, y: number, s: number): string {
  const pts: Array<[number, number]> = [
    [0.5, 0.05],
    [0.8, 0.3],
    [0.86, 0.95],
    [0.14, 0.95],
    [0.2, 0.3],
  ];
  return `${pts
    .map(
      ([px, py], i) =>
        `${i === 0 ? 'M' : 'L'}${(x + px * s).toFixed(2)} ${(y + py * s).toFixed(2)}`,
    )
    .join(' ')} Z`;
}
