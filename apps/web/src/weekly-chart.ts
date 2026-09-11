// Weekly multi-series line chart for the admin /metrics page. One y-axis, up
// to four series in a fixed colour order (identity never repaints when a
// series is absent), a crosshair tooltip listing every series for the hovered
// week, a legend when there is more than one series, and a collapsed table of
// the same numbers so nothing depends on colour alone.
//
// The cumulative chart in stats-charts.ts answers "how much so far"; this one
// answers "how much this week", which is the growth question.

import './weekly-chart.css';
import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';
import { formatStatNumber } from './stats-charts.js';

export type WeeklySeries = {
  key: string;
  label: string;
  values: number[];
};

export type WeeklyChartOptions = {
  // ISO dates (YYYY-MM-DD) of each week's Monday, oldest first. Every series
  // has one value per entry.
  weeks: string[];
  series: WeeklySeries[];
  ariaLabel: string;
  // The last week is still in progress; its final segment is drawn dashed and
  // the tooltip says so.
  partialLast?: boolean;
  locale?: Locale;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const view = { w: 720, h: 260 };
const plot = { xMin: 52, xMax: 708, yMin: 14, yMax: 222 };
// Fixed slots: the nth series always wears the nth colour class.
const MAX_SERIES = 4;

function svgNode<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

export function buildWeeklyChart(options: WeeklyChartOptions): HTMLElement {
  const locale = options.locale ?? currentLocale();
  const weeks = options.weeks;
  const series = options.series.slice(0, MAX_SERIES);
  const partialLast = options.partialLast ?? weeks.length > 0;

  const figure = document.createElement('figure');
  figure.className = 'weekly-chart';

  if (series.length > 1) figure.append(buildLegend(series));

  const plotBox = document.createElement('div');
  plotBox.className = 'weekly-chart-plot';
  const svg = svgNode('svg');
  svg.setAttribute('viewBox', `0 0 ${view.w} ${view.h}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('class', 'weekly-chart-svg');
  svg.setAttribute('aria-label', options.ariaLabel);
  const tooltip = document.createElement('div');
  tooltip.className = 'weekly-chart-tooltip';
  tooltip.hidden = true;
  plotBox.append(svg, tooltip);
  figure.append(plotBox);

  if (weeks.length === 0) {
    const text = svgNode('text');
    text.setAttribute('x', String(view.w / 2));
    text.setAttribute('y', String(view.h / 2));
    text.setAttribute('class', 'weekly-chart-empty');
    text.textContent = 'No data yet.';
    svg.append(text);
    return figure;
  }

  const scale = yScale(series);
  const xs = weeks.map((_, index) => xFor(index, weeks.length));
  const yFor = (value: number): number => plot.yMax - (value / scale.max) * (plot.yMax - plot.yMin);

  // Y grid: recessive lines, labels in muted ink.
  const yGroup = svgNode('g');
  yGroup.setAttribute('class', 'weekly-chart-y-axis');
  for (const tick of scale.ticks) {
    const y = yFor(tick);
    const line = svgNode('line');
    line.setAttribute('x1', String(plot.xMin));
    line.setAttribute('x2', String(plot.xMax));
    line.setAttribute('y1', y.toFixed(1));
    line.setAttribute('y2', y.toFixed(1));
    const label = svgNode('text');
    label.setAttribute('x', String(plot.xMin - 8));
    label.setAttribute('y', (y + 3.5).toFixed(1));
    label.textContent = formatStatNumber(tick, locale);
    yGroup.append(line, label);
  }

  // X ticks: every fourth week plus the last, so 26 weeks stays legible.
  const xGroup = svgNode('g');
  xGroup.setAttribute('class', 'weekly-chart-x-axis');
  const tickEvery = weeks.length > 12 ? 4 : weeks.length > 6 ? 2 : 1;
  weeks.forEach((week, index) => {
    const isLast = index === weeks.length - 1;
    const onGrid = (weeks.length - 1 - index) % tickEvery === 0;
    if (!onGrid && !isLast) return;
    const x = xs[index] ?? plot.xMin;
    const line = svgNode('line');
    line.setAttribute('x1', x.toFixed(1));
    line.setAttribute('x2', x.toFixed(1));
    line.setAttribute('y1', String(plot.yMax));
    line.setAttribute('y2', String(plot.yMax + 5));
    const label = svgNode('text');
    label.setAttribute('x', x.toFixed(1));
    label.setAttribute('y', String(plot.yMax + 18));
    label.textContent = formatWeekLabel(week, locale);
    xGroup.append(line, label);
  });

  const lines = svgNode('g');
  series.forEach((s, slot) => {
    const coords = s.values.map((value, index) => ({ x: xs[index] ?? plot.xMin, y: yFor(value) }));
    const solidEnd = partialLast && coords.length > 1 ? coords.length - 1 : coords.length;
    const solid = svgNode('polyline');
    solid.setAttribute('class', `weekly-chart-line weekly-chart-series-${slot}`);
    solid.setAttribute('points', pointString(coords.slice(0, solidEnd)));
    lines.append(solid);
    if (solidEnd < coords.length) {
      const dashed = svgNode('polyline');
      dashed.setAttribute(
        'class',
        `weekly-chart-line weekly-chart-line-partial weekly-chart-series-${slot}`,
      );
      dashed.setAttribute('points', pointString(coords.slice(solidEnd - 1)));
      lines.append(dashed);
    }
  });

  const guide = svgNode('line');
  guide.setAttribute('class', 'weekly-chart-guide');
  guide.setAttribute('y1', String(plot.yMin));
  guide.setAttribute('y2', String(plot.yMax));
  guide.style.opacity = '0';
  const dots = series.map((_, slot) => {
    const dot = svgNode('circle');
    dot.setAttribute('class', `weekly-chart-dot weekly-chart-series-${slot}`);
    dot.setAttribute('r', '4');
    dot.style.opacity = '0';
    return dot;
  });

  svg.append(yGroup, xGroup, lines, guide, ...dots);

  function hideHover(): void {
    tooltip.hidden = true;
    guide.style.opacity = '0';
    for (const dot of dots) dot.style.opacity = '0';
  }

  function onMove(event: PointerEvent): void {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * view.w;
    const frac = (viewX - plot.xMin) / (plot.xMax - plot.xMin);
    const index = Math.max(0, Math.min(weeks.length - 1, Math.round(frac * (weeks.length - 1))));
    const x = xs[index] ?? plot.xMin;
    const week = weeks[index];
    if (week === undefined) return;
    guide.setAttribute('x1', x.toFixed(1));
    guide.setAttribute('x2', x.toFixed(1));
    guide.style.opacity = '1';
    let topY = plot.yMax;
    series.forEach((s, slot) => {
      const y = yFor(s.values[index] ?? 0);
      topY = Math.min(topY, y);
      const dot = dots[slot];
      if (!dot) return;
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
      dot.style.opacity = '1';
    });

    tooltip.replaceChildren();
    const when = document.createElement('span');
    when.className = 'weekly-chart-tooltip-week';
    when.textContent =
      partialLast && index === weeks.length - 1
        ? `Week of ${formatWeekLabel(week, locale)} (so far)`
        : `Week of ${formatWeekLabel(week, locale)}`;
    tooltip.append(when);
    series.forEach((s, slot) => {
      const row = document.createElement('span');
      row.className = 'weekly-chart-tooltip-row';
      const swatch = document.createElement('i');
      swatch.className = `weekly-chart-swatch weekly-chart-series-${slot}`;
      const label = document.createElement('span');
      label.textContent = s.label;
      const value = document.createElement('strong');
      value.textContent = formatStatNumber(s.values[index] ?? 0, locale);
      row.append(swatch, label, value);
      tooltip.append(row);
    });
    tooltip.hidden = false;
    tooltip.classList.toggle('is-left', index > weeks.length / 2);
    tooltip.style.left = `${(x / view.w) * rect.width}px`;
    tooltip.style.top = `${(topY / view.h) * rect.height}px`;
  }

  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', hideHover);

  figure.append(buildTable(weeks, series, locale));
  return figure;
}

function buildLegend(series: WeeklySeries[]): HTMLElement {
  const legend = document.createElement('ul');
  legend.className = 'weekly-chart-legend';
  series.forEach((s, slot) => {
    const item = document.createElement('li');
    const swatch = document.createElement('i');
    swatch.className = `weekly-chart-swatch weekly-chart-series-${slot}`;
    const label = document.createElement('span');
    label.textContent = s.label;
    item.append(swatch, label);
    legend.append(item);
  });
  return legend;
}

// The same numbers as a table, collapsed. Admins copy from it; it is also the
// no-colour reading of the chart.
function buildTable(weeks: string[], series: WeeklySeries[], locale: Locale): HTMLElement {
  const details = document.createElement('details');
  details.className = 'weekly-chart-table';
  const summary = document.createElement('summary');
  summary.textContent = 'Table';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  const weekHead = document.createElement('th');
  weekHead.textContent = 'Week';
  head.append(weekHead);
  for (const s of series) {
    const th = document.createElement('th');
    th.textContent = s.label;
    head.append(th);
  }
  table.append(head);
  // Newest first: the current week is what an admin opens the table for.
  for (let index = weeks.length - 1; index >= 0; index -= 1) {
    const row = document.createElement('tr');
    const weekCell = document.createElement('td');
    weekCell.textContent = weeks[index] ?? '';
    row.append(weekCell);
    for (const s of series) {
      const cell = document.createElement('td');
      cell.textContent = formatStatNumber(s.values[index] ?? 0, locale);
      row.append(cell);
    }
    table.append(row);
  }
  details.append(summary, table);
  return details;
}

function xFor(index: number, count: number): number {
  if (count <= 1) return (plot.xMin + plot.xMax) / 2;
  return plot.xMin + (index / (count - 1)) * (plot.xMax - plot.xMin);
}

function pointString(coords: Array<{ x: number; y: number }>): string {
  return coords.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function yScale(series: WeeklySeries[]): { max: number; ticks: number[] } {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top + step / 2; tick += step) ticks.push(tick);
  return { max: top, ticks };
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / magnitude;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * magnitude;
}

function formatWeekLabel(isoDate: string, locale: Locale): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
