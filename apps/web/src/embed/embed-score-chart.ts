// Win-chance graph under a study chapter's board in the embed (the chapter's
// `scoreSeries`, migration 184). One or more named lines, all from one side's
// view, one value per position: index 0 the start, index n after ply n. A
// cursor sits on the board's ply, the pointer scrubs a readout, and a click or
// tap jumps the board there: the review underboard chart's behaviour
// (review/chart-scrub.ts). A single estimate fills in the leading seat's ink
// over the review chart's seat zones; two or more estimates are bare lines in
// the article's engine inks, with no shading (one line's fill would hide the other).
//
// One fixed height (embed.css): the card fits the board to the room the pane
// leaves (embed-card.ts underBoard), so a pane that changed height would resize
// the board.

import { maybeGameSpecForId } from '@mistboard/game';
import { ENGINE_A_COLOR, ENGINE_B_COLOR } from '../articles/eval-compare-chart.js';
import { attachChartScrub, createChartTip, showChartTip } from '../review/chart-scrub.js';
import { type ReviewSeatColors, reviewColorForSeat } from '../review/review-seat-colors.js';
import { seatColorWord } from '../variant-seat-label.js';
import '../seat-disc-ink.css';
import '../review/advantage-chart.css';
import { embedScoreSeatColors } from './embed-score-seat-colors.js';
import './embed-score-chart.css';

export type EmbedScoreSide = 'red' | 'black';
export type EmbedScoreSeriesLine = { name: string; color: string; values: number[] };
export type EmbedScoreSeries = { side: EmbedScoreSide; series: EmbedScoreSeriesLine[] };

const COLORS: Record<string, string> = {
  a: ENGINE_A_COLOR,
  b: ENGINE_B_COLOR,
  c: 'var(--eval-compare-c, #7a5fb0)',
  d: 'var(--eval-compare-d, #4f8a3c)',
};

/**
 * The chapter's series, if it has one that fits a line of `positions` positions
 * (plies + 1). Anything else, a malformed row or a series left stale by a tree
 * edit, is no graph: the chart is never drawn against moves it was not made for.
 */
export function embedScoreSeries(value: unknown, positions: number): EmbedScoreSeries | null {
  if (!value || typeof value !== 'object' || positions < 2) return null;
  const { side, series } = value as { side?: unknown; series?: unknown };
  if (side !== 'red' && side !== 'black') return null;
  if (!Array.isArray(series) || series.length === 0) return null;
  const lines: EmbedScoreSeriesLine[] = [];
  for (const raw of series) {
    const { name, color, values } = (raw ?? {}) as Record<string, unknown>;
    if (typeof name !== 'string' || !name || typeof color !== 'string' || !(color in COLORS)) {
      return null;
    }
    if (!Array.isArray(values) || values.length !== positions) return null;
    if (!values.every((v) => typeof v === 'number' && v >= 0 && v <= 1)) return null;
    lines.push({ name, color, values: values as number[] });
  }
  return { side, series: lines };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** viewBox width; stretched to the pane (preserveAspectRatio none), so strokes
 *  are non-scaling and the x scale is simply ply / maxPly of it. */
const VIEW_W = 1000;
const VIEW_H = 100;
/** Keeps a cursor at ply 0 or the last ply from sitting half outside the box. */
const EDGE_INSET = 2;
let chartInstance = 0;

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** "Start", "12.", "12..." for the readout: the move a ply ends. */
function plyLabel(ply: number): string {
  if (ply === 0) return 'Start';
  return ply % 2 === 1 ? `${(ply + 1) / 2}.` : `${ply / 2}...`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export type EmbedScoreChart = {
  el: HTMLElement;
  /** Move the cursor to the board's ply. */
  setPly: (ply: number) => void;
};

export function createEmbedScoreChart(
  data: EmbedScoreSeries,
  opts: {
    variant: string;
    /** Null explicitly means the chapter's flip seats are still unbound. */
    seatColors?: ReviewSeatColors | null;
    onJump: (ply: number) => void;
    /** The move that reached a ply ("e2-e5"), shown after its number in the readout. */
    moveLabel?: (ply: number) => string;
  },
): EmbedScoreChart {
  const spec = maybeGameSpecForId(opts.variant);
  if (!spec) throw new Error(`unknown score chart variant: ${opts.variant}`);
  const maxPly = data.series[0]!.values.length - 1;
  const colors =
    opts.seatColors === undefined ? embedScoreSeatColors(opts.variant) : opts.seatColors;
  const topInk = colors ? reviewColorForSeat(data.side, colors) : null;
  const bottomInk = colors
    ? reviewColorForSeat(data.side === 'red' ? 'black' : 'red', colors)
    : null;
  const seatFill = data.series.length === 1 && colors !== null;
  const lineInk = (line: EmbedScoreSeriesLine): string =>
    seatFill ? 'var(--site-brand-accent)' : COLORS[line.color]!;
  const sideName = topInk
    ? seatColorWord(opts.variant, topInk)
    : data.side === 'red'
      ? 'First seat'
      : 'Second seat';
  const sideLabel = `Win chance for ${sideName}`;

  const el = document.createElement('div');
  el.className = 'embed-score-chart';
  el.dataset.seatInkFamily = spec.family;
  el.classList.toggle('embed-score-chart--seat-fill', seatFill);
  if (
    colors &&
    Object.values(colors).includes('white') &&
    Object.values(colors).includes('black')
  ) {
    el.classList.add('advantage-chart--white-black');
  }
  el.setAttribute('role', 'group');
  el.setAttribute(
    'aria-label',
    `${sideLabel}: ${data.series.map((s) => s.name).join(', ')}. Click to jump to a move.`,
  );

  const legend = document.createElement('div');
  legend.className = 'embed-score-chart__legend';
  for (const line of data.series) {
    const item = document.createElement('span');
    item.className = 'embed-score-chart__key';
    const swatch = document.createElement('span');
    swatch.className = 'embed-score-chart__swatch';
    swatch.style.background = lineInk(line);
    item.append(swatch, line.name);
    legend.append(item);
  }
  const side = document.createElement('span');
  side.className = 'embed-score-chart__side';
  side.textContent = sideLabel;
  legend.append(side);

  const plot = document.createElement('div');
  plot.className = 'embed-score-chart__plot';
  const chart = svg('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    preserveAspectRatio: 'none',
    class: 'embed-score-chart__svg',
    'aria-hidden': 'true',
  });
  const xOf = (ply: number): number => (maxPly === 0 ? 0 : (ply / maxPly) * VIEW_W);
  const yOf = (value: number): number => (1 - value) * VIEW_H;
  const pointsOf = (line: EmbedScoreSeriesLine): string =>
    line.values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const instance = ++chartInstance;
  const defs = svg('defs', {});
  chart.append(defs);
  const zoneInks = data.series.length === 1 ? [topInk, bottomInk] : [];
  for (const [i, ink] of zoneInks.entries()) {
    const y = (i * VIEW_H) / 2;
    const zoneId = `embed-score-zone-${instance}-${i}`;
    const gradient = svg('linearGradient', {
      id: zoneId,
      gradientUnits: 'userSpaceOnUse',
      x1: '0',
      y1: `${VIEW_H / 2}`,
      x2: '0',
      y2: i === 0 ? '0' : `${VIEW_H}`,
      class: `advantage-chart__zone advantage-chart__zone--${ink ?? 'neutral'}`,
    });
    gradient.append(
      svg('stop', { offset: '0', class: 'advantage-chart__zone-stop--near' }),
      svg('stop', { offset: '1', class: 'advantage-chart__zone-stop--far' }),
    );
    defs.append(gradient);
    chart.append(
      svg('rect', {
        x: '0',
        y: `${y}`,
        width: `${VIEW_W}`,
        height: `${VIEW_H / 2}`,
        fill: `url(#${zoneId})`,
        class: 'embed-score-chart__zone',
      }),
    );
  }
  if (seatFill) {
    for (const [i, ink] of [topInk, bottomInk].entries()) {
      const clipId = `embed-score-clip-${instance}-${i}`;
      const clip = svg('clipPath', { id: clipId });
      clip.append(
        svg('rect', {
          x: '0',
          y: `${(i * VIEW_H) / 2}`,
          width: `${VIEW_W}`,
          height: `${VIEW_H / 2}`,
        }),
      );
      defs.append(clip);
      chart.append(
        svg('polygon', {
          points: `0,${VIEW_H / 2} ${pointsOf(data.series[0]!)} ${VIEW_W},${VIEW_H / 2}`,
          'clip-path': `url(#${clipId})`,
          class: `advantage-chart__area advantage-chart__area--${ink}`,
        }),
      );
    }
  }
  for (const line of data.series) {
    chart.append(
      svg('polyline', {
        points: pointsOf(line),
        class: 'embed-score-chart__line',
        stroke: lineInk(line),
        'data-series': line.name,
      }),
    );
  }
  // The fills are opaque; all position markers must paint after them.
  chart.append(
    svg('line', {
      x1: '0',
      x2: `${VIEW_W}`,
      y1: `${VIEW_H / 2}`,
      y2: `${VIEW_H / 2}`,
      class: 'embed-score-chart__mid',
    }),
  );
  const cursor = svg('line', { y1: '0', y2: `${VIEW_H}`, class: 'embed-score-chart__cursor' });
  chart.append(cursor);
  // Names the dashed middle line, at the right end, where a finished game's
  // lines have left it for 0% or 100%.
  const mid = document.createElement('span');
  mid.className = 'embed-score-chart__mid-label';
  mid.setAttribute('aria-hidden', 'true');
  mid.textContent = '50%';
  plot.append(chart, mid);
  const tip = createChartTip('embed-score-chart__tip');
  plot.append(tip);
  el.append(legend, plot);

  let selectedPly = 0;
  const moveCursor = (ply: number): void => {
    const raw = xOf(Math.max(0, Math.min(maxPly, ply)));
    const x = Math.max(EDGE_INSET, Math.min(VIEW_W - EDGE_INSET, raw)).toFixed(2);
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
    el.dataset.ply = String(ply);
  };
  const showTip = (ply: number): void => {
    const values = data.series.map((s) => s.values[ply] ?? 0.5);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    showChartTip(tip, {
      move: [plyLabel(ply), ply > 0 ? opts.moveLabel?.(ply) : ''].filter(Boolean).join(' '),
      value: sideLabel,
      at: maxPly === 0 ? 0 : ply / maxPly,
      // Sit in the half the lines are not in, so the readout covers no data.
      low: mean > 0.5,
    });
    // One row per engine under the heading, each name in its line's ink, so
    // the readout says whose estimate each number is.
    for (const [i, s] of data.series.entries()) {
      const row = document.createElement('span');
      row.className = 'embed-score-chart__tip-row';
      const name = document.createElement('span');
      name.className = 'embed-score-chart__tip-name';
      name.setAttribute('style', `color: ${lineInk(s)}`);
      name.textContent = s.name;
      const value = document.createElement('span');
      value.className = 'embed-score-chart__tip-value';
      value.textContent = percent(values[i]!);
      row.append(name, value);
      tip.append(row);
    }
  };
  attachChartScrub({
    surface: plot,
    plyAt: (fraction) => Math.round(fraction * maxPly),
    onHover: (ply) => {
      moveCursor(ply);
      showTip(ply);
    },
    onLeave: () => {
      moveCursor(selectedPly);
      tip.hidden = true;
    },
    onJump: (ply) => opts.onJump(ply),
  });

  const setPly = (ply: number): void => {
    selectedPly = Math.max(0, Math.min(maxPly, ply));
    moveCursor(selectedPly);
  };
  setPly(0);
  return { el, setPly };
}
