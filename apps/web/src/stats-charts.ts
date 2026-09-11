// Shared statistics rendering: the cumulative-activity SVG chart, the public
// stats shape, and number/date formatting. Used by the /about platform-activity
// section (pages-static.ts) and the dedicated /stats + /metrics pages
// (metrics.ts) so every stats surface draws one identical chart.

import './stats-charts.css';
import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';

export type PublicStatsMode = 'pvp' | 'pve' | 'eve';

export type PublicStatsDay = {
  date: string;
  completedGames: number;
  cumulativeGames: number;
};

export type PublicVariantSeries = {
  variant: string;
  total: number;
  days: PublicStatsDay[];
};

export type PublicStatsWeek = {
  weekStart: string;
  completedGames: number;
};

export type PublicSiteStats = {
  generatedAt: string;
  totalCompletedGames: number;
  last30dCompletedGames: number;
  publicGames: number;
  // Both optional so an older cached payload still parses.
  accounts?: number;
  weeklyCompletedGames?: PublicStatsWeek[];
  modeTotals: Record<PublicStatsMode, number>;
  variantTotals: Array<{ variant: string; count: number }>;
  dailyCompletedGames: PublicStatsDay[];
  // Optional so an older cached/served payload without it still parses; the
  // chart falls back to the single aggregate line when it is absent.
  variantDaily?: PublicVariantSeries[];
};

export function formatStatNumber(value: number, locale: Locale = currentLocale()): string {
  return new Intl.NumberFormat(LOCALE_META[locale].dateLocale).format(value);
}

// A cumulative-games area+line chart over the daily series. Returns an <svg>
// with a description passed by the caller (the about page and /stats word the
// aria-label differently). Renders nothing meaningful for an empty series — the
// caller checks `days.length` and shows its own empty state.
export function buildActivityChart(
  days: PublicStatsDay[],
  ariaLabel: string,
  locale: Locale = currentLocale(),
): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 340 150');
  svg.setAttribute('role', 'img');
  svg.setAttribute('class', 'platform-activity-svg');
  svg.setAttribute('aria-label', ariaLabel);

  const yScale = yAxisScale(days);
  const xTicks = xAxisTicks(days);
  const points = chartPoints(days, yScale.max);

  const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  area.setAttribute('class', 'platform-activity-area');
  area.setAttribute(
    'points',
    `${points} ${chartBounds.xMax},${chartBounds.yMax} ${chartBounds.xMin},${chartBounds.yMax}`,
  );

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('class', 'platform-activity-line');
  line.setAttribute('points', points);

  svg.append(buildYGrid(yScale, locale), buildXAxisTicks(xTicks, locale), area, line);
  return svg;
}

const chartBounds = {
  xMin: 42,
  xMax: 322,
  yMin: 20,
  yMax: 112,
};

function chartPoints(days: PublicStatsDay[], scaleMax: number): string {
  return chartCoordinates(days, scaleMax)
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

function chartCoordinates(
  days: PublicStatsDay[],
  scaleMax: number,
): Array<{ x: number; y: number }> {
  const max = Math.max(scaleMax, 1);
  return days.map((day, index) => {
    const x =
      days.length === 1
        ? (chartBounds.xMin + chartBounds.xMax) / 2
        : chartBounds.xMin + (index / (days.length - 1)) * (chartBounds.xMax - chartBounds.xMin);
    const y =
      chartBounds.yMax - (day.cumulativeGames / max) * (chartBounds.yMax - chartBounds.yMin);
    return { x, y };
  });
}

function buildYGrid(scale: { max: number; ticks: number[] }, locale: Locale): SVGElement {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'platform-activity-y-axis');
  for (const tick of scale.ticks) {
    const y = chartBounds.yMax - (tick / scale.max) * (chartBounds.yMax - chartBounds.yMin);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(chartBounds.xMin));
    line.setAttribute('x2', String(chartBounds.xMax));
    line.setAttribute('y1', y.toFixed(1));
    line.setAttribute('y2', y.toFixed(1));
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(chartBounds.xMin - 10));
    label.setAttribute('y', String(y + 4));
    label.textContent = formatStatNumber(tick, locale);
    group.append(line, label);
  }
  return group;
}

function buildXAxisTicks(
  ticks: Array<{ position: number; date: string }>,
  locale: Locale,
): SVGElement {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'platform-activity-x-axis');
  for (const tick of ticks) {
    const x = chartBounds.xMin + tick.position * (chartBounds.xMax - chartBounds.xMin);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x.toFixed(1));
    line.setAttribute('x2', x.toFixed(1));
    line.setAttribute('y1', String(chartBounds.yMax));
    line.setAttribute('y2', String(chartBounds.yMax + 5));
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', x.toFixed(1));
    label.setAttribute('y', String(chartBounds.yMax + 20));
    label.textContent = formatDateLabel(tick.date, locale);
    group.append(line, label);
  }
  return group;
}

function yAxisScale(days: PublicStatsDay[]): { max: number; ticks: number[] } {
  const max = chartMax(days);
  if (max <= 6) return { max, ticks: Array.from({ length: max + 1 }, (_, i) => i) };
  const step = niceTickStep(max / 3);
  const scaleMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= scaleMax; value += step) ticks.push(value);
  return { max: scaleMax, ticks };
}

function chartMax(days: PublicStatsDay[]): number {
  return Math.max(...days.map((day) => day.cumulativeGames), 1);
}

function niceTickStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function xAxisTicks(days: PublicStatsDay[]): Array<{ position: number; date: string }> {
  if (days.length === 1) return [{ position: 0.5, date: days[0]?.date ?? '' }];
  const tickCount = Math.min(days.length, 5);
  const lastIndex = days.length - 1;
  const ticks: Array<{ position: number; date: string }> = [];
  for (let i = 0; i < tickCount; i++) {
    const position = i / (tickCount - 1);
    const index = Math.round(position * lastIndex);
    const day = days[index];
    if (day) ticks.push({ position, date: day.date });
  }
  return ticks;
}

function formatDateLabel(value: string | undefined, locale: Locale = currentLocale()): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toLocaleDateString(LOCALE_META[locale].dateLocale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// ── interactive, full-width chart (dedicated /stats page) ────────────────────
// The /about page keeps the compact static buildActivityChart above; /stats gets
// this variant-filterable, hover-readable one. It draws the same cumulative-line
// shape but stretches to the container width and swaps its series in place.

const SVG_NS = 'http://www.w3.org/2000/svg';

const iChart = { xMin: 54, xMax: 704, yMin: 18, yMax: 250 };
const iView = { w: 720, h: 288 };

export type ActivitySeries = {
  key: string;
  label: string;
  days: PublicStatsDay[];
};

function svgNode<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function iCoordinates(days: PublicStatsDay[], scaleMax: number): Array<{ x: number; y: number }> {
  const max = Math.max(scaleMax, 1);
  return days.map((day, index) => {
    const x =
      days.length === 1
        ? (iChart.xMin + iChart.xMax) / 2
        : iChart.xMin + (index / (days.length - 1)) * (iChart.xMax - iChart.xMin);
    const y = iChart.yMax - (day.cumulativeGames / max) * (iChart.yMax - iChart.yMin);
    return { x, y };
  });
}

export function buildInteractiveActivityChart(
  series: ActivitySeries[],
  locale: Locale = currentLocale(),
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'stats-chart';

  const filter = document.createElement('div');
  filter.className = 'stats-chart-filter';
  filter.setAttribute('role', 'group');
  filter.setAttribute('aria-label', 'Filter the chart by variant');
  const chips = new Map<string, HTMLButtonElement>();

  const plot = document.createElement('div');
  plot.className = 'stats-chart-plot';
  const svg = svgNode('svg');
  svg.setAttribute('viewBox', `0 0 ${iView.w} ${iView.h}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('class', 'stats-chart-svg');

  const tooltip = document.createElement('div');
  tooltip.className = 'stats-chart-tooltip';
  tooltip.hidden = true;
  plot.append(svg, tooltip);

  // Closure state read by the pointer handler; refreshed on every render.
  let coords: Array<{ x: number; y: number }> = [];
  let activeDays: PublicStatsDay[] = [];
  let hoverGuide: SVGLineElement | null = null;
  let hoverDot: SVGCircleElement | null = null;
  let selectedKey = series[0]?.key ?? '';

  function render(): void {
    const active = series.find((s) => s.key === selectedKey) ?? series[0];
    const days = active?.days ?? [];
    activeDays = days;
    svg.replaceChildren();
    hideHover();

    if (days.length === 0) {
      const text = svgNode('text');
      text.setAttribute('x', String(iView.w / 2));
      text.setAttribute('y', String(iView.h / 2));
      text.setAttribute('class', 'stats-chart-empty');
      text.textContent = 'No completed games yet.';
      svg.append(text);
      coords = [];
      svg.setAttribute('aria-label', active?.label ?? '');
      return;
    }

    const yScale = yAxisScale(days);
    coords = iCoordinates(days, yScale.max);
    const pointString = coords.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

    // Y grid
    const yGroup = svgNode('g');
    yGroup.setAttribute('class', 'stats-chart-y-axis');
    for (const tick of yScale.ticks) {
      const y = iChart.yMax - (tick / yScale.max) * (iChart.yMax - iChart.yMin);
      const line = svgNode('line');
      line.setAttribute('x1', String(iChart.xMin));
      line.setAttribute('x2', String(iChart.xMax));
      line.setAttribute('y1', y.toFixed(1));
      line.setAttribute('y2', y.toFixed(1));
      const label = svgNode('text');
      label.setAttribute('x', String(iChart.xMin - 8));
      label.setAttribute('y', String(y + 3.5));
      label.textContent = formatStatNumber(tick, locale);
      yGroup.append(line, label);
    }

    // X ticks
    const xGroup = svgNode('g');
    xGroup.setAttribute('class', 'stats-chart-x-axis');
    for (const tick of xAxisTicks(days)) {
      const x = iChart.xMin + tick.position * (iChart.xMax - iChart.xMin);
      const line = svgNode('line');
      line.setAttribute('x1', x.toFixed(1));
      line.setAttribute('x2', x.toFixed(1));
      line.setAttribute('y1', String(iChart.yMax));
      line.setAttribute('y2', String(iChart.yMax + 5));
      const label = svgNode('text');
      label.setAttribute('x', x.toFixed(1));
      label.setAttribute('y', String(iChart.yMax + 18));
      label.textContent = formatDateLabel(tick.date, locale);
      xGroup.append(line, label);
    }

    const area = svgNode('polygon');
    area.setAttribute('class', 'stats-chart-area');
    area.setAttribute(
      'points',
      `${pointString} ${iChart.xMax},${iChart.yMax} ${iChart.xMin},${iChart.yMax}`,
    );

    const line = svgNode('polyline');
    line.setAttribute('class', 'stats-chart-line');
    line.setAttribute('points', pointString);

    hoverGuide = svgNode('line');
    hoverGuide.setAttribute('class', 'stats-chart-guide');
    hoverGuide.setAttribute('y1', String(iChart.yMin));
    hoverGuide.setAttribute('y2', String(iChart.yMax));
    hoverGuide.style.opacity = '0';
    hoverDot = svgNode('circle');
    hoverDot.setAttribute('class', 'stats-chart-dot');
    hoverDot.setAttribute('r', '3.5');
    hoverDot.style.opacity = '0';

    svg.append(yGroup, xGroup, area, line, hoverGuide, hoverDot);
    svg.setAttribute(
      'aria-label',
      `${active?.label ?? ''}: ${formatStatNumber(days.at(-1)?.cumulativeGames ?? 0, locale)} cumulative games`,
    );
  }

  function hideHover(): void {
    tooltip.hidden = true;
    if (hoverGuide) hoverGuide.style.opacity = '0';
    if (hoverDot) hoverDot.style.opacity = '0';
  }

  function onMove(event: PointerEvent): void {
    if (coords.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * iView.w;
    const denom = iChart.xMax - iChart.xMin;
    const frac = denom === 0 ? 0 : (viewX - iChart.xMin) / denom;
    const index = Math.max(0, Math.min(coords.length - 1, Math.round(frac * (coords.length - 1))));
    const point = coords[index];
    const day = activeDays[index];
    if (!point || !day) return;
    if (hoverGuide) {
      hoverGuide.setAttribute('x1', point.x.toFixed(1));
      hoverGuide.setAttribute('x2', point.x.toFixed(1));
      hoverGuide.style.opacity = '1';
    }
    if (hoverDot) {
      hoverDot.setAttribute('cx', point.x.toFixed(1));
      hoverDot.setAttribute('cy', point.y.toFixed(1));
      hoverDot.style.opacity = '1';
    }
    tooltip.replaceChildren();
    const value = document.createElement('strong');
    value.textContent = formatStatNumber(day.cumulativeGames, locale);
    const when = document.createElement('span');
    when.textContent = formatDateLabel(day.date, locale);
    tooltip.append(value, when);
    tooltip.hidden = false;
    const leftPx = (point.x / iView.w) * rect.width;
    const topPx = (point.y / iView.h) * rect.height;
    tooltip.style.left = `${leftPx}px`;
    tooltip.style.top = `${topPx}px`;
  }

  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', hideHover);

  function select(key: string): void {
    selectedKey = key;
    for (const [chipKey, chip] of chips) {
      const on = chipKey === key;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    render();
  }

  if (series.length > 1) {
    for (const s of series) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'stats-chart-chip';
      chip.textContent = s.label;
      chip.setAttribute('aria-pressed', s.key === selectedKey ? 'true' : 'false');
      if (s.key === selectedKey) chip.classList.add('is-active');
      chip.addEventListener('click', () => select(s.key));
      chips.set(s.key, chip);
      filter.append(chip);
    }
    figure.append(filter);
  }

  figure.append(plot);
  render();
  return figure;
}
