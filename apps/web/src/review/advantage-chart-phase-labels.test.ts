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
    expect(labelsOf(chart.el).map((l) => l.style.visibility)).toEqual(['', '', 'hidden']);

    // Wider plot: the endgame span is 40px now, and the label comes back.
    plot.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
    FakeResizeObserver.last!.fire();
    expect(labelsOf(chart.el).map((l) => l.style.visibility)).toEqual(['', '', '']);
  });
});
