// Shared SVG marker geometry for board overlays. Variant renderers own square
// transforms and ring radii; this helper owns the common engine/user ink and the
// move-judgment badge.

import './board-glyph-marker.css';
import type { SvgBoardPoint } from './svg-board-arrow.js';
import { escapeHtml } from './web-utils.js';

export type SvgBoardMarkerStyle = {
  className?: string;
  color?: string;
  opacity?: number;
  width?: number;
};

/** Judgment badge pinned to a square's top-right corner (lila's glyph badge).
 *  `text` is the same symbol the move list shows ('??', '?', '?!', a user NAG). */
export type SvgBoardGlyphStyle = SvgBoardMarkerStyle & { text?: string; icon?: SvgBoardGlyphIcon };

/** A drawn mark in place of a text label: the puzzle verdicts (lichess's green
 *  check and red cross). Drawn as strokes, not as ✓/✗ text, because those code
 *  points fall back to different fonts (and on some systems to emoji). */
export type SvgBoardGlyphIcon = 'check' | 'cross';

// Stroke paths in units of the disc radius, centred on the disc.
const GLYPH_ICON_PATHS: Record<SvgBoardGlyphIcon, readonly (readonly [number, number])[][]> = {
  check: [
    [
      [-0.46, 0.02],
      [-0.14, 0.34],
      [0.48, -0.3],
    ],
  ],
  cross: [
    [
      [-0.34, -0.34],
      [0.34, 0.34],
    ],
    [
      [0.34, -0.34],
      [-0.34, 0.34],
    ],
  ],
};

/** The icon's strokes for a disc at (cx, cy) of radius r. */
export function svgBoardGlyphIcon(
  icon: SvgBoardGlyphIcon,
  cx: number,
  cy: number,
  r: number,
): string {
  const d = GLYPH_ICON_PATHS[icon]
    .map((stroke) =>
      stroke
        .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${fmt(cx + x * r)} ${fmt(cy + y * r)}`)
        .join(' '),
    )
    .join(' ');
  return `<path class="xq-marker__icon" d="${d}" stroke-width="${fmt(r * 0.24)}"/>`;
}

/** Badge geometry as fractions of a board's cell (or point spacing), so every
 *  variant gets a proportionally identical badge from its own units. Matches the
 *  xiangqi board's hand-tuned 13/21 against its 64-unit spacing. */
export const GLYPH_RADIUS_RATIO = 0.2;
export const GLYPH_OFFSET_RATIO = 0.33;

export type SvgBoardMarkerOptions = {
  baseClassName?: string;
  color?: string;
  defaultWidth?: number;
};

const fmt = (value: number): number => Math.round(value * 10) / 10;

export function svgBoardCircleMarker(
  marker: SvgBoardMarkerStyle,
  center: SvgBoardPoint,
  radius: number,
  options: SvgBoardMarkerOptions = {},
): string {
  const baseClassName = options.baseClassName ?? 'board-marker';
  const className = marker.className ? `${baseClassName} ${marker.className}` : baseClassName;
  const color = marker.color ?? options.color ?? '#2b6cb8';
  const opacity = marker.opacity ?? 0.9;
  const width = marker.width ?? options.defaultWidth ?? 4;
  return `<circle class="${className}" cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(radius)}" fill="none" stroke="${color}" stroke-width="${fmt(width)}" opacity="${opacity}" pointer-events="none"/>`;
}

/**
 * Judgment badge for one square: a filled disc with the glyph, offset toward the
 * square's top-right corner the way lila pins its move glyphs. The offset is in
 * SCREEN space, so the badge stays in the same corner whichever way the board is
 * flipped (callers pass an already-perspective-mapped centre).
 *
 * No text and no icon draws nothing rather than an unlabelled disc: a bare coloured dot
 * next to a piece would read as a target hint, which is a different vocabulary.
 */
export function svgBoardGlyphMarker(
  marker: SvgBoardGlyphStyle,
  center: SvgBoardPoint,
  radius: number,
  offset: number,
  options: SvgBoardMarkerOptions = {},
): string {
  if (!marker.text && !marker.icon) return '';
  const baseClassName = options.baseClassName ?? 'board-marker';
  const className = marker.className ? `${baseClassName} ${marker.className}` : baseClassName;
  const cx = fmt(center.x + offset);
  const cy = fmt(center.y - offset);
  const fontSize = fmt(radius * 1.15);
  return (
    `<g class="${className} xq-marker--glyph">` +
    `<circle class="xq-marker__disc" cx="${cx}" cy="${cy}" r="${fmt(radius)}"/>` +
    (marker.icon
      ? svgBoardGlyphIcon(marker.icon, cx, cy, radius)
      : `<text class="xq-marker__label" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}">${escapeHtml(marker.text ?? '')}</text>`) +
    `</g>`
  );
}
