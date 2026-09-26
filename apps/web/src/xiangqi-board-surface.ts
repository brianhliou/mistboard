// The board SURFACE for every xiangqi-family board: grid lines (or checkered
// cells), palace marks, and the river. Pure string building on top of
// xiangqi-board-geometry's transform, parameterised by a board config, so the
// four renderers that draw a xiangqi-shaped board can share one implementation
// instead of four.
//
// Why this exists: xiangqi, jieqi, fortress and fog xiangqi each grew their own
// renderer with their own CELL/MARGIN literals. Only the first read the board
// appearance preferences, so choosing 'Traditional' or 'Square grid' silently
// did nothing on the other three. The preference could not simply be passed
// down, because 'Square grid' is not a flag — it is a different way of drawing
// the board — so the drawing itself had to become shared before the preference
// could reach anywhere.
//
// Board-specific facts (palace rectangles, where the river sits, its caption)
// are config, not constants: fortress is a 7x8 board and does not share
// xiangqi's palace coordinates.

import './xiangqi-board-surface.css';
import type { XiangqiColor } from '@mistboard/game';
import type { XiangqiBoardLayout } from './xiangqi-appearance-storage.js';
import {
  type XiangqiBoardGeometry,
  xiangqiBoardPoint,
  xiangqiBoardViewBox,
} from './xiangqi-board-geometry.js';

/** A palace, in 1-indexed board coordinates (inclusive on both ends). */
export interface XiangqiPalaceRect {
  fileMin: number;
  fileMax: number;
  rankMin: number;
  rankMax: number;
}

export interface XiangqiSurfaceConfig {
  geo: XiangqiBoardGeometry;
  /** Palaces to mark. Empty for a board without them. */
  palaces: readonly XiangqiPalaceRect[];
  /** The river sits between this rank and the next one up. Null for no river. */
  riverAfterRank: number | null;
  /** Caption drawn in the river on the intersection layout. Omit for none. */
  riverLabel?: string;
}

/** Grid lines, or the checkered rects of the square-grid layout. */
export function xiangqiSurfaceGrid(cfg: XiangqiSurfaceConfig, layout: XiangqiBoardLayout): string {
  const { geo } = cfg;
  if (layout === 'cell') return cellGrid(cfg);
  const { cell, margin, fileCount, rankCount } = geo;
  const parts: string[] = [];
  const left = margin;
  const right = margin + (fileCount - 1) * cell;
  const top = margin;
  const bottom = margin + (rankCount - 1) * cell;
  // The river breaks the interior verticals; the outer two files run its full
  // height, which is what closes the board's frame.
  const riverTop =
    cfg.riverAfterRank === null ? null : margin + (rankCount - 1 - cfg.riverAfterRank) * cell;
  const riverBottom = riverTop === null ? null : riverTop + cell;
  for (let rank = 0; rank < rankCount; rank++) {
    const y = margin + rank * cell;
    parts.push(`<line class="xq-live-line" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`);
  }
  for (let file = 0; file < fileCount; file++) {
    const x = margin + file * cell;
    if (file === 0 || file === fileCount - 1 || riverTop === null) {
      parts.push(`<line class="xq-live-line" x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/>`);
    } else {
      parts.push(`<line class="xq-live-line" x1="${x}" y1="${top}" x2="${x}" y2="${riverTop}"/>`);
      parts.push(
        `<line class="xq-live-line" x1="${x}" y1="${riverBottom}" x2="${x}" y2="${bottom}"/>`,
      );
    }
  }
  return parts.join('');
}

function cellGrid(cfg: XiangqiSurfaceConfig): string {
  const { cell, margin, fileCount, rankCount, riverGap } = cfg.geo;
  const parts: string[] = [];
  const left = margin - cell / 2;
  const top = margin - cell / 2;
  const right = left + fileCount * cell;
  const half = rankCount / 2;
  const riverTop = top + half * cell;
  const riverBottom = riverTop + riverGap;
  const bottom = top + rankCount * cell + riverGap;
  for (let row = 0; row < rankCount; row++) {
    const y = top + row * cell + (row >= half ? riverGap : 0);
    for (let file = 0; file < fileCount; file++) {
      parts.push(
        `<rect class="xq-live-cell xq-live-cell--${(file + row) % 2 === 0 ? 'light' : 'dark'}" x="${left + file * cell}" y="${y}" width="${cell}" height="${cell}"/>`,
      );
    }
  }
  // Only internal boundaries are stroked. The first/last cells meet the SVG
  // viewBox edge directly, so the square layout has no enclosing hairline.
  for (let boundary = 1; boundary < rankCount; boundary++) {
    if (boundary === half) continue;
    const y = top + boundary * cell + (boundary > half ? riverGap : 0);
    parts.push(`<line class="xq-live-cell-line" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/>`);
  }
  for (let boundary = 1; boundary < fileCount; boundary++) {
    const x = left + boundary * cell;
    parts.push(
      `<line class="xq-live-cell-line" x1="${x}" y1="${top}" x2="${x}" y2="${riverTop}"/>`,
    );
    parts.push(
      `<line class="xq-live-cell-line" x1="${x}" y1="${riverBottom}" x2="${x}" y2="${bottom}"/>`,
    );
  }
  return parts.join('');
}

/** Tinted palace rectangles. The square-grid layout uses these as its palace cue. */
export function xiangqiSurfacePalaceBands(
  cfg: XiangqiSurfaceConfig,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
): string {
  const inset = layout === 'cell' ? cfg.geo.cell / 2 : 0;
  const jungle = layout === 'cell' && jungleThemeActive();
  return cfg.palaces
    .map((p) => {
      const a = point(cfg, p.fileMin, p.rankMin, perspective, layout);
      const b = point(cfg, p.fileMax, p.rankMax, perspective, layout);
      const x = Math.min(a.x, b.x) - inset;
      const y = Math.min(a.y, b.y) - inset;
      const width = Math.abs(b.x - a.x) + inset * 2;
      const height = Math.abs(b.y - a.y) + inset * 2;
      const band = `<rect class="xq-live-palace-band" x="${x}" y="${y}" width="${width}" height="${height}"/>`;
      return jungle ? band + jungleRug(cfg, x, y, width, height) : band;
    })
    .join('');
}

// JUNGLE THEME (2026-09-25). The children's board draws two things no other theme
// does: a rug in each palace and a painted river. The theme is a root data
// attribute, and every board re-renders on an appearance change, so reading it
// here reaches all four xiangqi-shaped renderers without threading a flag
// through each of them.
function jungleThemeActive(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.dataset.xiangqiBoardTheme === 'jungle'
  );
}

// A plain cream rug. One colour on purpose: a red rug under red pieces (tried in
// the mocks) swallowed them, and a rug with a coloured border made the pieces on
// its outer squares look off centre, because the border ate into those squares.
function jungleRug(
  cfg: XiangqiSurfaceConfig,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const { cell } = cfg.geo;
  const parts = [
    `<rect class="xq-live-palace-rug" x="${x}" y="${y}" width="${width}" height="${height}"/>`,
  ];
  // Faint seams keep the rug reading as squares a piece stands on.
  const pad = cell / 10;
  for (let c = x + cell; c < x + width - 1; c += cell) {
    parts.push(
      `<line class="xq-live-palace-seam" x1="${c}" y1="${y + pad}" x2="${c}" y2="${y + height - pad}"/>`,
    );
  }
  for (let r = y + cell; r < y + height - 1; r += cell) {
    parts.push(
      `<line class="xq-live-palace-seam" x1="${x + pad}" y1="${r}" x2="${x + width - pad}" y2="${r}"/>`,
    );
  }
  return parts.join('');
}

// The Jungle game's own water tile, clipped to the river strip by a nested <svg>
// (which clips without needing a document-unique clipPath id when several
// boards share a page), with sandy banks. At the square grid's 12-unit river the
// mocks' lily pads shrank to dots, so they are left out until the river widens.
function jungleRiver(x: number, y: number, width: number, height: number): string {
  const tile = height * 6;
  const tiles: string[] = [];
  for (let tx = 0; tx < width; tx += tile) {
    tiles.push(
      `<image href="/piece-sets/jungle/dobutsu/board/water.png?v=2" x="${tx}" y="${(height - tile) / 2}" width="${tile}" height="${tile}"/>`,
    );
  }
  return [
    `<svg class="xq-live-river-art" x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${tiles.join('')}</svg>`,
    `<line class="xq-live-river-bank" x1="${x}" y1="${y}" x2="${x + width}" y2="${y}"/>`,
    `<line class="xq-live-river-bank" x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}"/>`,
  ].join('');
}

/** The palace diagonals. */
export function xiangqiSurfacePalace(
  cfg: XiangqiSurfaceConfig,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
): string {
  // The square grid uses its tinted 3x3 palace cells as the visual cue. The
  // traditional diagonals are retained only for the intersection layouts,
  // where they remain part of the board geometry.
  if (layout === 'cell') return '';
  const parts: string[] = [];
  for (const p of cfg.palaces) {
    const a = point(cfg, p.fileMin, p.rankMax, perspective, layout);
    const b = point(cfg, p.fileMax, p.rankMin, perspective, layout);
    const c = point(cfg, p.fileMax, p.rankMax, perspective, layout);
    const d = point(cfg, p.fileMin, p.rankMin, perspective, layout);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
    parts.push(`<line x1="${c.x}" y1="${c.y}" x2="${d.x}" y2="${d.y}"/>`);
  }
  return parts.join('');
}

/** The river: a caption on the intersection layout, a band on the square grid. */
export function xiangqiSurfaceRiver(
  cfg: XiangqiSurfaceConfig,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
): string {
  void perspective;
  if (cfg.riverAfterRank === null) return '';
  const { cell, margin, fileCount, rankCount, riverGap } = cfg.geo;
  if (layout === 'cell') {
    const x = margin - cell / 2;
    const y = margin - cell / 2 + (rankCount / 2) * cell;
    if (jungleThemeActive()) return jungleRiver(x, y, fileCount * cell, riverGap);
    return `<rect class="xq-live-cell-river" x="${x}" y="${y}" width="${fileCount * cell}" height="${riverGap}"/>`;
  }
  if (!cfg.riverLabel) return '';
  const riverTop = margin + (rankCount - 1 - cfg.riverAfterRank) * cell;
  const y = riverTop + cell / 2;
  const x = margin + ((fileCount - 1) / 2) * cell;
  return `
    <text class="xq-live-river-label" x="${x}" y="${y + 1}">${cfg.riverLabel}</text>
  `;
}

function point(
  cfg: XiangqiSurfaceConfig,
  file: number,
  rank: number,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
): { x: number; y: number } {
  return xiangqiBoardPoint(file, rank, perspective, layout, cfg.geo);
}

/** File labels for each side, indexed by LOGICAL file (0 = file a). Xiangqi
 *  notation numbers files from each player's own right, so the two sides carry
 *  different strings for the same file. Ranks are optional because WXF and
 *  Chinese never name one: a move is a piece, a file, a direction, and either a
 *  destination file or a count. Only the absolute notations need them. */
export interface XiangqiCoordLabels {
  red: readonly string[];
  black: readonly string[];
  ranks?: readonly string[];
}

/** Coordinate labels drawn in the reserved gutter. Returns '' when the board
 *  reserves no gutter, so a board that never shows coordinates costs nothing.
 *
 *  Each side's labels sit on ITS OWN edge and rotate with the board, so a
 *  player always reads their own numbering along the edge nearest them. That
 *  is the whole point for a learner: the numbering is the thing being taught. */
export function xiangqiSurfaceCoords(
  cfg: XiangqiSurfaceConfig,
  perspective: XiangqiColor,
  layout: XiangqiBoardLayout,
  labels: XiangqiCoordLabels,
): string {
  const { geo } = cfg;
  const gutter = geo.coordGutter ?? 0;
  if (gutter <= 0) return '';
  const vb = xiangqiBoardViewBox(layout, geo);
  // The usable band is the gap between the viewBox edge and the nearest PIECE,
  // not the gutter alone. A piece sits on the outer intersection and overhangs
  // the margin, but it does not consume all of it, so the label gets the gutter
  // plus whatever the margin leaves over: 21 units on the standard intersection
  // board where the gutter alone is 12. Sizing to the gutter made the labels
  // roughly half the size they had room for.
  const pieceTop = geo.margin - geo.cell * 0.45;
  const band = pieceTop - vb.minY;
  const size = Math.max(6, Math.round(band * 0.68));
  const topY = vb.minY + band / 2;
  const bottomY = vb.minY + vb.height - band / 2;

  const parts: string[] = [];
  for (let file = 0; file < geo.fileCount; file += 1) {
    const x = xiangqiBoardPoint(file, 1, perspective, layout, geo).x;
    // The label nearest a player is that player's own numbering. Red sits at the
    // bottom of its own screen, so red's numbering runs along the bottom edge.
    parts.push(
      label(x, bottomY, perspective === 'red' ? labels.red[file] : labels.black[file], size),
    );
    parts.push(label(x, topY, perspective === 'red' ? labels.black[file] : labels.red[file], size));
  }
  if (labels.ranks) {
    // Centred in the same clear band the file labels use, not in the gutter
    // alone: sizing to the gutter put these hard against the board edge.
    const leftX = vb.minX + band / 2;
    const rightX = vb.minX + vb.width - band / 2;
    for (let rank = 1; rank <= geo.rankCount; rank += 1) {
      const y = xiangqiBoardPoint(0, rank, perspective, layout, geo).y;
      const text = labels.ranks[rank - 1] ?? '';
      parts.push(label(leftX, y, text, size));
      parts.push(label(rightX, y, text, size));
    }
  }
  return parts.join('');
}

function label(x: number, y: number, text: string | undefined, size: number): string {
  if (!text) return '';
  return `<text class="xq-live-coord" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${size}">${text}</text>`;
}
