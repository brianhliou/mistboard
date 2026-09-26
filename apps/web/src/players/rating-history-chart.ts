// The player's official rating history (#458): the CXA's 等级分 lists
// (2019 to 2023, closed) and its tournament points (2026 on). Two systems on
// two scales, so two panels with their own axes and a break between them,
// never one line joining a rating to a points total. Drawn in the idioms of
// the site's other charts (the stats activity chart's grid and the player
// card's accent line), redrawn at the container's width so the labels stay
// at their size on a phone.

import { t } from '../i18n/catalog.js';
import { CXA_POINTS_LISTS, type CxaPointsEntry } from './cxa-points.js';
import { CXA_LISTS, type CxaEntry } from './cxa-ratings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type ChartPoint = { date: string; value: number; label: string; rank: number | null };

export function ratingSeries(entries: readonly CxaEntry[]): ChartPoint[] {
  return entries.flatMap((e) => {
    const list = CXA_LISTS.find((l) => l.id === e.list);
    return list ? [{ date: list.date, value: e.rating, label: list.label, rank: e.rank }] : [];
  });
}

export function pointsSeries(entries: readonly CxaPointsEntry[]): ChartPoint[] {
  return entries.flatMap((e) => {
    const list = CXA_POINTS_LISTS.find((l) => l.id === e.list);
    return list ? [{ date: list.date, value: e.points, label: list.date, rank: e.rank }] : [];
  });
}

/** Round tick values covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = Math.max(1, max - min);
  const raw = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude;
  const ticks = [Math.floor(min / step) * step];
  while (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  if (ticks.length === 1) ticks.push(ticks[0]! + step);
  return ticks.map((v) => Math.round(v));
}

const DAY = 86_400_000;
const time = (date: string): number => Date.parse(`${date}T00:00:00Z`);

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

type Panel = { x0: number; x1: number; y0: number; y1: number };

/** One series in one panel: its grid and axis on `side`, the line, the dots. */
function drawSeries(
  svg: SVGSVGElement,
  panel: Panel,
  series: readonly ChartPoint[],
  kind: 'rating' | 'points',
  side: 'left' | 'right',
): void {
  const values = series.map((p) => p.value);
  // A rating axis starts near the values (2400 to 2800 is the story); a lone
  // points total is read from zero, since one dot has no range of its own.
  const lo = kind === 'points' && series.length === 1 ? 0 : Math.min(...values);
  const ticks = niceTicks(lo, Math.max(...values));
  const tMin = ticks[0]!;
  const tMax = Math.max(ticks[ticks.length - 1]!, tMin + 1);
  const y = (v: number): number => panel.y1 - ((v - tMin) / (tMax - tMin)) * (panel.y1 - panel.y0);

  const times = series.map((p) => time(p.date));
  const first = Math.min(...times);
  const last = Math.max(...times);
  const pad = series.length === 1 ? 0 : Math.max(30 * DAY, (last - first) * 0.03);
  const d0 = first - pad;
  const d1 = last + pad;
  const x = (ms: number): number =>
    d1 === d0
      ? (panel.x0 + panel.x1) / 2
      : panel.x0 + ((ms - d0) / (d1 - d0)) * (panel.x1 - panel.x0);

  const grid = el('g', { class: 'xqp-chart-grid' });
  for (const tick of ticks) {
    grid.append(el('line', { x1: panel.x0, x2: panel.x1, y1: y(tick), y2: y(tick) }));
    grid.append(
      el(
        'text',
        {
          x: side === 'left' ? panel.x0 - 6 : panel.x1 + 6,
          y: y(tick) + 3.5,
          'text-anchor': side === 'left' ? 'end' : 'start',
        },
        String(tick),
      ),
    );
  }
  svg.append(grid);

  const axis = el('g', { class: 'xqp-chart-axis' });
  axis.append(el('line', { x1: panel.x0, x2: panel.x1, y1: panel.y1, y2: panel.y1 }));
  if (series.length === 1) {
    axis.append(
      el(
        'text',
        { x: x(first), y: panel.y1 + 16, 'text-anchor': 'middle' },
        series[0]!.date.slice(0, 7),
      ),
    );
  } else {
    const firstYear = new Date(d0).getUTCFullYear();
    const lastYear = new Date(d1).getUTCFullYear();
    for (let year = firstYear; year <= lastYear; year += 1) {
      const at = time(`${year}-01-01`);
      if (at < d0 || at > d1) continue;
      axis.append(el('line', { x1: x(at), x2: x(at), y1: panel.y1, y2: panel.y1 + 4 }));
      // The year's label sits in the middle of its span, where the year's lists are.
      const mid = Math.min(time(`${year}-07-01`), d1);
      axis.append(
        el('text', { x: x(mid), y: panel.y1 + 16, 'text-anchor': 'middle' }, String(year)),
      );
    }
  }
  svg.append(axis);

  const coords = series.map((p) => ({ p, cx: x(time(p.date)), cy: y(p.value) }));
  if (coords.length > 1) {
    const line = coords.map((c) => `${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' L');
    svg.append(
      el('path', {
        class: `xqp-chart-area xqp-chart-area-${kind}`,
        d: `M${coords[0]!.cx.toFixed(1)},${panel.y1} L${line} L${coords[coords.length - 1]!.cx.toFixed(1)},${panel.y1} Z`,
      }),
      el('path', { class: `xqp-chart-line xqp-chart-line-${kind}`, d: `M${line}` }),
    );
  }
  for (const c of coords) {
    const dot = el('circle', {
      class: `xqp-chart-dot xqp-chart-dot-${kind}`,
      cx: c.cx.toFixed(1),
      cy: c.cy.toFixed(1),
      r: 3.5,
    });
    dot.append(
      el(
        'title',
        {},
        [c.p.label, String(c.p.value), c.p.rank !== null ? `#${c.p.rank}` : null]
          .filter(Boolean)
          .join(' · '),
      ),
    );
    svg.append(dot);
  }
  const end = coords[coords.length - 1];
  if (end) {
    svg.append(
      el(
        'text',
        {
          class: `xqp-chart-value xqp-chart-value-${kind}`,
          x: end.cx,
          y: end.cy - 9,
          'text-anchor': coords.length === 1 ? 'middle' : 'end',
        },
        String(end.p.value),
      ),
    );
  }
}

/** Draw both panels at `width` px into `svg`, replacing what was there. */
export function drawRatingHistory(
  svg: SVGSVGElement,
  ratings: readonly ChartPoint[],
  points: readonly ChartPoint[],
  width: number,
): void {
  const height = 210;
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const top = 14;
  const bottom = height - 26;
  const padL = 44;
  const padR = 44;
  const gap = 30;
  const rightW = Math.max(64, Math.round(width * 0.16));
  const left: Panel = { x0: padL, x1: width - padR - rightW - gap, y0: top, y1: bottom };
  const right: Panel = { x0: width - padR - rightW, x1: width - padR, y0: top, y1: bottom };

  if (ratings.length > 0) drawSeries(svg, left, ratings, 'rating', 'left');
  // The break: the CXA abolished 等级分 on 2026-01-30 for tournament points.
  const breakX = (left.x1 + right.x0) / 2;
  svg.append(
    el('line', { class: 'xqp-chart-break', x1: breakX, x2: breakX, y1: top - 6, y2: bottom + 6 }),
  );
  if (points.length > 0) drawSeries(svg, right, points, 'points', 'right');
  else {
    svg.append(
      el(
        'text',
        {
          class: 'xqp-chart-note',
          x: (right.x0 + right.x1) / 2,
          y: (top + bottom) / 2,
          'text-anchor': 'middle',
        },
        t('broadcast.playerChartNotListed'),
      ),
    );
  }
}

/** The chart's figure: a legend naming both systems, the SVG, and a caption
 *  saying why they do not share a line. Null with no 等级分 history, where
 *  the points card already says everything one number can. */
export function ratingHistoryFigure(
  ratingEntries: readonly CxaEntry[],
  pointsEntries: readonly CxaPointsEntry[],
): HTMLElement | null {
  const ratings = ratingSeries(ratingEntries);
  const points = pointsSeries(pointsEntries);
  if (ratings.length < 2) return null;
  const figure = document.createElement('figure');
  figure.className = 'xqp-chart';
  const legend = document.createElement('div');
  legend.className = 'xqp-chart-legend';
  for (const [kind, label] of [
    ['rating', t('broadcast.playerChartRating')],
    ['points', t('broadcast.playerChartPoints')],
  ] as const) {
    const item = document.createElement('span');
    item.className = `xqp-chart-key xqp-chart-key-${kind}`;
    item.textContent = label;
    legend.append(item);
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'xqp-chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    [
      t('broadcast.playerChartRating'),
      ratings.map((p) => `${p.label} ${p.value}`).join(', '),
      t('broadcast.playerChartPoints'),
      points.map((p) => `${p.label} ${p.value}`).join(', '),
    ]
      .filter(Boolean)
      .join('. '),
  );
  const frame = document.createElement('div');
  frame.className = 'xqp-chart-frame';
  frame.append(svg);
  let drawnAt = 0;
  const redraw = (): void => {
    const width = Math.round(frame.clientWidth) || 720;
    if (width === drawnAt) return;
    drawnAt = width;
    drawRatingHistory(svg, ratings, points, width);
  };
  redraw();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(frame);
  const caption = document.createElement('figcaption');
  caption.textContent = t('broadcast.playerChartCaption');
  figure.append(legend, frame, caption);
  return figure;
}
