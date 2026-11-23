import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdvantageChart } from './advantage-chart.js';
import type { PlyEval } from './game-analysis.js';

// Phase labels in Chinese. The English labels are rotated a quarter turn
// (writing-mode: vertical-rl), which reads as one line. Chinese in the same
// mode stands upright and stacks one character per line (開 over 局), so a
// Chinese label is set horizontally on one line instead, and a label too wide
// for its phase's span is hidden rather than wrapped.

const evals: PlyEval[] = Array.from({ length: 101 }, (_, ply) => ({
  ply,
  cp: 0,
  mate: null,
  best: null,
}));
const phases = { middle: 20, end: 90 };
const zhHant = { opening: '開局', middlegame: '中局', endgame: '殘局' };

const css = readFileSync(resolve(__dirname, 'advantage-chart.css'), 'utf8');
const ruleFor = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return '';
  return css.slice(at, css.indexOf('}', at));
};

/** Captures the chart's ResizeObserver so a test can run its fit pass. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.last = this;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeResizeObserver.last = null;
});

const labelsOf = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('.advantage-chart__phase-label'),
];

describe('advantage chart phase labels', () => {
  it('sets Chinese labels on one horizontal line, never wrapped', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {}, phases, phaseLabels: zhHant });
    const labels = labelsOf(chart.el);
    expect(labels.map((l) => l.textContent)).toEqual(['開局', '中局', '殘局']);
    for (const label of labels) {
      expect(label.classList.contains('advantage-chart__phase-label--line')).toBe(true);
    }
    const rule = ruleFor('.advantage-chart__phase-label--line');
    expect(rule).toMatch(/writing-mode:\s*horizontal-tb/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });

  it('keeps the English labels rotated, exactly as before', () => {
    const chart = createAdvantageChart(evals, { onJump: () => {}, phases });
    const labels = labelsOf(chart.el);
    expect(labels.map((l) => l.textContent)).toEqual(['Opening', 'Middlegame', 'Endgame']);
    for (const label of labels) {
      expect(label.classList.contains('advantage-chart__phase-label--line')).toBe(false);
    }
    expect(ruleFor('.advantage-chart__phase-label')).toMatch(/writing-mode:\s*vertical-rl/);
  });

  it('hides a Chinese label that does not fit its span instead of wrapping it', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const chart = createAdvantageChart(evals, { onJump: () => {}, phases, phaseLabels: zhHant });
    const plot = chart.el.querySelector<HTMLElement>('.advantage-chart__plot')!;
    // 200px wide: opening spans 40px, middlegame 140px, endgame 20px.
    plot.getBoundingClientRect = () => ({ width: 200 }) as DOMRect;
    for (const label of labelsOf(chart.el)) {
      label.getBoundingClientRect = () => ({ width: 22 }) as DOMRect;
    }
    FakeResizeObserver.last!.fire();
    expect(labelsOf(chart.el).map((l) => l.style.display)).toEqual(['', '', 'none']);

    // Wider plot: the endgame span is 40px now, and the label comes back.
    plot.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
    FakeResizeObserver.last!.fire();
    expect(labelsOf(chart.el).map((l) => l.style.display)).toEqual(['', '', '']);
  });

  // #1233: a 390px phone, an endgame from ply 98 of 101. The rotated
  // "Endgame" column started 8px before the plot's edge and ran 7px past it,
  // which widened the whole page. It is display: none, not visibility: hidden,
  // because a hidden box still counts toward the page's scroll width.
  it('hides a rotated label that would run past the plot instead of widening the page', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const late = { middle: 20, end: 98 };
    const chart = createAdvantageChart(evals, { onJump: () => {}, phases: late });
    const plot = chart.el.querySelector<HTMLElement>('.advantage-chart__plot')!;
    plot.getBoundingClientRect = () => ({ width: 370 }) as DOMRect;
    for (const label of labelsOf(chart.el)) {
      label.getBoundingClientRect = () => ({ width: 15 }) as DOMRect;
    }
    expect(FakeResizeObserver.last).not.toBeNull();
    FakeResizeObserver.last!.fire();
    // Opening and middlegame stay: a rotated column may cross the next
    // divider; only the plot's right edge bounds it.
    expect(labelsOf(chart.el).map((l) => l.style.display)).toEqual(['', '', 'none']);

    // Endgame from ply 90: 37px to the edge, and the label fits again.
    const roomy = createAdvantageChart(evals, { onJump: () => {}, phases });
    const roomyPlot = roomy.el.querySelector<HTMLElement>('.advantage-chart__plot')!;
    roomyPlot.getBoundingClientRect = () => ({ width: 370 }) as DOMRect;
    for (const label of labelsOf(roomy.el)) {
      label.getBoundingClientRect = () => ({ width: 15 }) as DOMRect;
    }
    FakeResizeObserver.last!.fire();
    expect(labelsOf(roomy.el).map((l) => l.style.display)).toEqual(['', '', '']);
  });
});
