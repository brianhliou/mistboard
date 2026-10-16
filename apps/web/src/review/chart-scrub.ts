// Hover scrub shared by the review underboard charts (Computer analysis, Move
// times). lichess scrubs both under the pointer: a cursor follows it, a readout
// names the move it is over, and a click jumps there. One implementation, so the
// two tabs cannot drift apart in how a pointer maps to a ply, when the readout
// clears, or where it sits.
//
// Each chart keeps its own geometry (a curve of points vs a row of bar columns),
// so it supplies `plyAt` for its x axis; everything else lives here.
import './chart-scrub.css';

export type ChartScrubOptions = {
  /** Listens for the pointer, and its box maps a client x to a ply. */
  surface: Element;
  /** Click-to-jump listener. Defaults to `surface`. */
  clickTarget?: Element;
  /** Ply at a horizontal fraction of the surface, 0 = left edge, 1 = right edge. */
  plyAt(fraction: number): number;
  onHover(ply: number): void;
  onLeave(): void;
  /** Present = a click jumps the board to the ply under the pointer. */
  onJump?(ply: number): void;
};

export function attachChartScrub(opts: ChartScrubOptions): void {
  /** Ply under a client x, or null while the surface has no layout (offscreen,
   *  or a jsdom test that gave it none). */
  const plyAtClientX = (clientX: number): number | null => {
    const box = opts.surface.getBoundingClientRect();
    if (box.width === 0) return null;
    return opts.plyAt(Math.max(0, Math.min(1, (clientX - box.left) / box.width)));
  };
  if (opts.onJump) {
    const jump = opts.onJump;
    (opts.clickTarget ?? opts.surface).addEventListener('click', (event) => {
      const ply = plyAtClientX((event as MouseEvent).clientX);
      if (ply != null) jump(ply);
    });
  }
  opts.surface.addEventListener('pointermove', (event) => {
    const ply = plyAtClientX((event as PointerEvent).clientX);
    if (ply != null) opts.onHover(ply);
  });
  opts.surface.addEventListener('pointerleave', () => opts.onLeave());
}

/** The readout box. Starts hidden; `showChartTip` fills and places it. */
export function createChartTip(...extraClasses: string[]): HTMLDivElement {
  const tip = document.createElement('div');
  tip.className = ['review-chart-tip', ...extraClasses].join(' ');
  tip.hidden = true;
  return tip;
}

export type ChartTipContent = {
  /** The move, e.g. "12... h10-i10". Null = the readout shows the value alone. */
  move: string | null;
  /** The chart's own reading at that ply (an eval, a think time). */
  value: string;
  /** A secondary reading after the value (the clocks on Move times). */
  detail?: string | null;
  /** Cursor position as a fraction of the frame width. */
  at: number;
  /** Sit at the bottom of the frame instead of the top, to stay off the data. */
  low: boolean;
};

export function showChartTip(tip: HTMLElement, content: ChartTipContent): void {
  tip.replaceChildren();
  if (content.move) tip.append(tipPart('review-chart-tip__move', content.move));
  tip.append(tipPart('review-chart-tip__value', content.value));
  if (content.detail) tip.append(tipPart('review-chart-tip__detail', content.detail));
  tip.hidden = false;
  // Anchor to the cursor, and slide the box back over itself as it approaches the
  // right edge so it stays inside the frame without a measure-and-clamp.
  const at = Math.max(0, Math.min(1, content.at));
  tip.style.left = `${(at * 100).toFixed(3)}%`;
  tip.style.transform = `translateX(${(-at * 100).toFixed(1)}%)`;
  tip.classList.toggle('review-chart-tip--low', content.low);
}

function tipPart(className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}
