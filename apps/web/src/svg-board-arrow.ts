// Shared SVG arrow geometry for board overlays. Variant renderers own the square
// transform; this helper owns the visual anatomy once two board-space points are
// known. Keeping those concerns separate lets every SVG board expose the same
// engine/drawing overlay without pretending their grids share coordinates.

export type SvgBoardPoint = { x: number; y: number };

export type SvgBoardArrowStyle = {
  /** Extra class supplied by the caller, for example `xq-arrow--pv1`. */
  className?: string;
  color?: string;
  dashed?: boolean;
  /** SVG stroke-dasharray, when dashed. Defaults to the product's 10 8. */
  dashPattern?: string;
  opacity?: number;
  width?: number;
};

/** A styled arrow between two board squares, named in the board's own notation. Every
 *  variant's arrow type (XiangqiBoardArrow, JieqiBoardArrow, …) is this shape with its
 *  square type narrowed; a surface that carries arrows for whichever variant is mounted
 *  (the game embed's replay board) speaks this one and the variant's renderer reads it. */
export type SvgBoardSquareArrow = SvgBoardArrowStyle & { from: string; to: string };

/** A judgment badge on a board square, in the shape every variant's marker type takes
 *  for `kind: 'glyph'` (svg-board-marker.ts draws it; board-glyph-marker.css colours it
 *  by `className`, e.g. `xq-marker--blunder`). */
export type SvgBoardSquareGlyph = {
  square: string;
  kind: 'glyph';
  text: string;
  className: string;
};

export type SvgBoardArrowOptions = {
  /** Base class shared by every arrow on this board family. */
  baseClassName?: string;
  color?: string;
  defaultWidth?: number;
  /** Distance from the origin point before the shaft begins. */
  startInset?: number;
  /** Distance before the destination point where the tip lands. */
  tipInset?: number;
};

const DEFAULT_COLOR = '#2b6cb8';
const DEFAULT_WIDTH = 9;
const DEFAULT_START_INSET = 12;
const DEFAULT_TIP_INSET = 0;
const HEAD_LENGTH_RATIO = 20 / 9;
const HEAD_HALF_WIDTH_RATIO = 11 / 9;

const fmt = (value: number): number => Math.round(value * 10) / 10;

/** Render one round-capped shaft plus a triangular head between board-space
 * points. Width carries engine-candidate strength, so the head scales with it. */
export function svgBoardArrow(
  arrow: SvgBoardArrowStyle,
  from: SvgBoardPoint,
  to: SvgBoardPoint,
  options: SvgBoardArrowOptions = {},
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return '';

  const ux = dx / dist;
  const uy = dy / dist;
  const startInset = options.startInset ?? DEFAULT_START_INSET;
  const tipInset = options.tipInset ?? DEFAULT_TIP_INSET;
  const startX = from.x + ux * startInset;
  const startY = from.y + uy * startInset;
  const tipX = to.x - ux * tipInset;
  const tipY = to.y - uy * tipInset;
  const width = arrow.width ?? options.defaultWidth ?? DEFAULT_WIDTH;

  // A wide head on a one-step move can be longer than the span between the two
  // insets. Clamp it so the shaft never flips backwards.
  const span = dist - startInset - tipInset;
  const headLength = Math.min(width * HEAD_LENGTH_RATIO, Math.max(span, 0));
  const headHalfWidth = width * HEAD_HALF_WIDTH_RATIO;
  const baseX = tipX - ux * headLength;
  const baseY = tipY - uy * headLength;
  const px = -uy;
  const py = ux;
  const opacity = arrow.opacity ?? 0.9;
  const color = arrow.color ?? options.color ?? DEFAULT_COLOR;
  const baseClassName = options.baseClassName ?? 'board-arrow';
  const className = arrow.className ? `${baseClassName} ${arrow.className}` : baseClassName;
  // Callers can widen the dash. The product default stays 10/8 (engine PV
  // arrows); the video passes a longer pattern, because at broadcast scale with
  // a round linecap 10/8 reads as a dotted line rather than a line of force.
  const dash = arrow.dashed ? ` stroke-dasharray="${arrow.dashPattern ?? '10 8'}"` : '';
  const head =
    `${fmt(tipX)},${fmt(tipY)} ` +
    `${fmt(baseX + px * headHalfWidth)},${fmt(baseY + py * headHalfWidth)} ` +
    `${fmt(baseX - px * headHalfWidth)},${fmt(baseY - py * headHalfWidth)}`;

  return (
    `<g class="${className}" opacity="${opacity}" fill="${color}" stroke="${color}" pointer-events="none">` +
    `<line x1="${fmt(startX)}" y1="${fmt(startY)}" x2="${fmt(baseX)}" y2="${fmt(baseY)}" stroke-width="${fmt(width)}" stroke-linecap="round"${dash}/>` +
    `<polygon points="${head}" stroke="none"/>` +
    `</g>`
  );
}
