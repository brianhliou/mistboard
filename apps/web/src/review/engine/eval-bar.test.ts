import { describe, expect, it } from 'vitest';
import { createEvalBar } from './eval-bar.js';

describe('eval bar ruler', () => {
  it('does not imply a linear scale with unlabelled ticks', () => {
    expect(createEvalBar().el.querySelector('.review-eval-bar__tick')).toBeNull();
  });

  it('leaves the numeric evaluation to the larger engine headline', () => {
    expect(createEvalBar().el.querySelector('.review-eval-bar__label')).toBeNull();
  });
});

describe('eval bar fill', () => {
  it('marks the gauge idle without removing it from the layout', () => {
    const bar = createEvalBar();
    bar.setIdle(true);
    expect(bar.el.classList.contains('review-eval-bar--idle')).toBe(true);
    bar.setIdle(false);
    expect(bar.el.classList.contains('review-eval-bar--idle')).toBe(false);
  });

  it('uses a neutral palette when flip-game colors are unbound', () => {
    const bar = createEvalBar();
    bar.setNeutral(true);
    expect(bar.el.classList.contains('review-eval-bar--neutral')).toBe(true);
    bar.setNeutral(false);
    expect(bar.el.classList.contains('review-eval-bar--neutral')).toBe(false);
  });

  it('sits at half height for an even position', () => {
    const bar = createEvalBar();
    bar.setEval(0, null);
    const fill = bar.el.querySelector<HTMLElement>('.review-eval-bar__fill');
    expect(fill?.style.height).toBe('50.0%');
  });

  it('grows past half when Red is ahead and shrinks when behind', () => {
    const bar = createEvalBar();
    const height = () =>
      Number.parseFloat(
        bar.el.querySelector<HTMLElement>('.review-eval-bar__fill')?.style.height ?? '0',
      );
    bar.setEval(300, null);
    const ahead = height();
    bar.setEval(-300, null);
    const behind = height();
    expect(ahead).toBeGreaterThan(50);
    expect(behind).toBeLessThan(50);
    expect(Number((ahead + behind).toFixed(0))).toBe(100);
  });

  it("draws an engine's own win curve when the handle passes one, the default otherwise", () => {
    const bar = createEvalBar();
    const height = () =>
      bar.el.querySelector<HTMLElement>('.review-eval-bar__fill')?.style.height ?? '';
    // AB-JChess's fitted curve (ABJCHESS_20261031_WIN_PCT_K): +409 cp reads 75%,
    // as on the review chart of its server analysis.
    bar.setEval(409, null, 0.00269);
    expect(height()).toBe('75.0%');
    bar.setEval(409, null);
    expect(height()).toBe(`${((1 / (1 + Math.exp(-409 / 320))) * 100).toFixed(1)}%`);
    bar.setEval(null, 3, 0.00269);
    expect(Number.parseFloat(height())).toBeGreaterThan(90);
  });

  it('reads a mate as decisive rather than merely large', () => {
    const bar = createEvalBar();
    bar.setEval(null, 3);
    const fill = bar.el.querySelector<HTMLElement>('.review-eval-bar__fill');
    expect(Number.parseFloat(fill?.style.height ?? '0')).toBeGreaterThan(90);
  });
});
