// Move times (lichess "Move times"): one bar per ply, coloured by side and
// scaled to the slowest move, mirrored about a centre line: the first seat's
// bars (odd plies) grow up from it, the second seat's (even plies) down.
//
// Behind the bars, when the game had a real clock, each side's REMAINING clock is
// drawn the way lichess draws it: a centre line is zero, the first seat's clock
// runs from the top edge toward it and the second seat's from the bottom edge,
// both on one scale (the largest value either clock reached), so a spent clock
// closes on the centre and an increment pushes it back out.
//
// It scrubs under the pointer exactly like the advantage chart beside it (the
// shared chart-scrub module): a cursor on the hovered bar, a readout naming the
// move, its think time and both clocks, and a click that jumps the board there.
import '../seat-disc-ink.css';
import { t } from '../i18n/catalog.js';
import type { ShowcaseClockPair } from '../showcase-clock.js';
import { formatClock } from '../web-utils.js';
import { attachChartScrub, createChartTip, showChartTip } from './chart-scrub.js';
import {
  type ReviewInk,
  type ReviewSeatColors,
  reviewColorForSeat,
  reviewInkLabel,
} from './review-seat-colors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 1000;
const VIEW_H = 100;
const MID_Y = VIEW_H / 2;

export interface MoveTimesChart {
  el: HTMLElement;
  /** Rest the cursor on this ply's bar (where the board is). Ply 0, the start
   *  position, has no bar and hides it. */
  setPly(ply: number): void;
}

export type MoveTimesChartOptions = {
  seatColors?: ReviewSeatColors;
  /** Remaining clocks per ply (series[0] = the start, series[p] = after ply p).
   *  Absent = an untimed game: the bars draw alone. */
  clocks?: readonly ShowcaseClockPair[];
  /** Move text for `ply`, in the move tree's own "5. b1-c3" form. */
  moveLabel?(ply: number): string | null;
  /** Present = a click jumps the board to the ply under the pointer. */
  onJump?(ply: number): void;
};

export function createMoveTimesChart(
  times: readonly number[],
  opts: MoveTimesChartOptions = {},
): MoveTimesChart {
  const plies = times.length;
  const firstInk = reviewColorForSeat('red', opts.seatColors);
  const secondInk = reviewColorForSeat('black', opts.seatColors);
  const inkOf = (ply: number): ReviewInk => (ply % 2 === 1 ? firstInk : secondInk);

  const el = document.createElement('div');
  el.className = 'review-move-times-panel';
  const chart = document.createElement('div');
  chart.className = 'review-move-times';

  const overlay = opts.clocks ? clockOverlay(opts.clocks, plies, firstInk, secondInk) : null;
  if (overlay) chart.append(overlay);

  const max = Math.max(1, ...times);
  const heightOf = (ms: number): number => Math.max(2, Math.round((ms / max) * 100));
  const bars = times.map((ms, i) => {
    const bar = document.createElement('div');
    const dir = i % 2 === 0 ? 'up' : 'down';
    bar.className = `review-move-times__bar review-move-times__bar--${dir} review-move-times__bar--${inkOf(i + 1)}`;
    // Half the frame each way: the slowest move reaches an edge.
    bar.style.height = `${heightOf(ms) / 2}%`;
    chart.append(bar);
    return bar;
  });

  const cursor = document.createElement('div');
  cursor.className = 'review-move-times__cursor';
  cursor.hidden = true;
  const tip = createChartTip('review-move-times__tip');
  chart.append(cursor, tip);

  const totals = { first: 0, second: 0 };
  times.forEach((ms, i) => {
    if (i % 2 === 0) totals.first += ms;
    else totals.second += ms;
  });
  const caption = document.createElement('p');
  caption.className = 'review-move-times__caption';
  caption.setAttribute('aria-label', t('underboard.moveTimesBySide'));
  caption.append(
    sideTotal(firstInk, totals.first),
    document.createTextNode(' · '),
    sideTotal(secondInk, totals.second),
  );
  el.append(chart, caption);

  /** Centre of ply `ply`'s bar column, as a fraction of the chart width. */
  const columnCentre = (ply: number): number => (ply - 0.5) / plies;

  let selectedPly = 0;
  let hovered: HTMLElement | null = null;

  function moveCursor(ply: number): void {
    if (ply < 1 || ply > plies) {
      cursor.hidden = true;
      return;
    }
    cursor.hidden = false;
    cursor.style.left = `${(columnCentre(ply) * 100).toFixed(3)}%`;
  }

  function highlight(ply: number | null): void {
    hovered?.classList.remove('review-move-times__bar--hovered');
    hovered = ply === null ? null : (bars[ply - 1] ?? null);
    hovered?.classList.add('review-move-times__bar--hovered');
    chart.classList.toggle('review-move-times--hovering', hovered !== null);
  }

  function showTip(ply: number): void {
    const clock = opts.clocks?.[ply];
    showChartTip(tip, {
      move: opts.moveLabel?.(ply) ?? fallbackMoveLabel(ply),
      value: formatDuration(times[ply - 1] ?? 0),
      detail: clock
        ? `${reviewInkLabel(firstInk)} ${formatClock(clock.first)} · ${reviewInkLabel(secondInk)} ${formatClock(clock.second)}`
        : null,
      at: columnCentre(ply),
      // A tall first-seat bar reaches the top of the frame, where the readout sits.
      low: ply % 2 === 1 && heightOf(times[ply - 1] ?? 0) > 55,
    });
  }

  attachChartScrub({
    // The whole frame, full height: a short bar is as easy to land on as a tall
    // one, because the pointer snaps to the COLUMN under it, not to the bar.
    surface: chart,
    plyAt: (fraction) => Math.min(plies, Math.floor(fraction * plies) + 1),
    onHover: (ply) => {
      moveCursor(ply);
      highlight(ply);
      showTip(ply);
    },
    onLeave: () => {
      moveCursor(selectedPly);
      highlight(null);
      tip.hidden = true;
    },
    ...(opts.onJump ? { onJump: opts.onJump } : {}),
  });
  if (opts.onJump) chart.classList.add('review-move-times--jumps');

  function setPly(ply: number): void {
    selectedPly = ply;
    if (!hovered) moveCursor(ply);
  }

  return { el, setPly };
}

/** The remaining-clock layer, or null when there is nothing honest to draw. */
function clockOverlay(
  clocks: readonly ShowcaseClockPair[],
  plies: number,
  firstInk: ReviewInk,
  secondInk: ReviewInk,
): SVGSVGElement | null {
  const geometry = clockOverlayGeometry(clocks, plies);
  if (!geometry) return null;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    preserveAspectRatio: 'none',
    class: 'review-move-times__clocks',
    'aria-hidden': 'true',
  }) as SVGSVGElement;
  const side = (slot: 'first' | 'second', ink: ReviewInk): SVGElement => {
    const group = svgEl('g', {
      class: `review-move-times__clock review-move-times__clock--${slot} review-move-times__clock--${ink}`,
    });
    const points = geometry[slot].join(' ');
    group.append(
      svgEl('polygon', {
        points: `0,${MID_Y} ${points} ${geometry.endX},${MID_Y}`,
        class: 'review-move-times__clock-area',
      }),
      svgEl('polyline', { points, class: 'review-move-times__clock-line' }),
    );
    return group;
  };
  svg.append(
    side('first', firstInk),
    side('second', secondInk),
    svgEl('line', {
      x1: '0',
      y1: `${MID_Y}`,
      x2: `${VIEW_W}`,
      y2: `${MID_Y}`,
      class: 'review-move-times__clock-mid',
    }),
  );
  return svg;
}

/**
 * Points (in a 1000 x 100 view) for each side's remaining clock. series[p] sits at
 * the right edge of ply p's bar column (x = p / plies), so series[0], the start,
 * is the left edge. y = 50 is zero; the first seat's full scale is the top edge
 * (y = 0), the second seat's the bottom edge (y = 100). Both share one scale: the
 * largest value either clock ever showed, the initial time plus any increment it
 * banked above it. Null for an empty series or a game with no time on it.
 */
export function clockOverlayGeometry(
  clocks: readonly ShowcaseClockPair[],
  plies: number,
): { first: string[]; second: string[]; endX: string } | null {
  if (plies < 1 || clocks.length < 2) return null;
  const series = clocks.slice(0, plies + 1);
  const scale = Math.max(...series.flatMap((pair) => [pair.first, pair.second]));
  if (!(scale > 0)) return null;
  const x = (p: number): string => ((p / plies) * VIEW_W).toFixed(1);
  const reach = (ms: number): number => (Math.max(0, ms) / scale) * MID_Y;
  return {
    first: series.map((pair, p) => `${x(p)},${(MID_Y - reach(pair.first)).toFixed(2)}`),
    second: series.map((pair, p) => `${x(p)},${(MID_Y + reach(pair.second)).toFixed(2)}`),
    endX: x(series.length - 1),
  };
}

function sideTotal(ink: ReviewInk, ms: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'review-move-times__total';
  const swatch = document.createElement('span');
  swatch.className = `review-move-times__swatch review-move-times__bar--${ink}`;
  swatch.setAttribute('aria-hidden', 'true');
  span.append(swatch, document.createTextNode(`${reviewInkLabel(ink)} ${formatDuration(ms)}`));
  return span;
}

/** "14." for a first-seat ply, "14..." for a second-seat one: the move number
 *  alone, when the host supplies no move text. */
function fallbackMoveLabel(ply: number): string {
  return `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'}`;
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
