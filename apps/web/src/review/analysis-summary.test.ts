// The judgment counts are controls, not labels: hover lights the plies on the
// chart, click jumps to the next one. Zero rows stay inert, and the Learn
// button only renders when the surface offers retro mode.
import { describe, expect, it, vi } from 'vitest';
import { createAnalysisSummary } from './analysis-summary.js';
import type { GameAnalysis } from './game-analysis.js';

const ANALYSIS: GameAnalysis = {
  engineId: 'test',
  depth: 12,
  evals: [],
  moves: [],
  chancePlies: [],
  unstablePlies: [],
  bestPlayedPlies: [],
  red: { accuracy: 80, inaccuracies: 2, mistakes: 0, blunders: 1, acpl: 40 },
  black: { accuracy: 90, inaccuracies: 0, mistakes: 1, blunders: 0, acpl: 20 },
};

describe('analysis summary judgment rows', () => {
  it('keeps centipawn loss by default and omits it only when the variant opts out', () => {
    const labels = (hideAcpl?: boolean) =>
      [
        ...createAnalysisSummary(ANALYSIS, undefined, { hideAcpl }).querySelectorAll(
          '.analysis-summary__stat-label',
        ),
      ].map((el) => el.textContent);
    expect(labels().filter((label) => label === 'Average centipawn loss')).toHaveLength(2);
    expect(labels(false)).toEqual(labels());
    expect(labels(true)).not.toContain('Average centipawn loss');
  });

  it('renders non-zero counts as buttons carrying side + judgment, zero counts as plain rows', () => {
    const el = createAnalysisSummary(ANALYSIS, undefined, {
      onJudgment: { hover: () => {}, jump: () => {} },
    });
    const live = [...el.querySelectorAll('button.analysis-summary__stat')].map(
      (b) => `${(b as HTMLElement).dataset.side}:${(b as HTMLElement).dataset.judgment}`,
    );
    expect(live).toEqual(['red:inaccuracy', 'red:blunder', 'black:mistake']);
    // "0 Mistakes" for red is a div, and so is the ACPL row.
    const inert = el.querySelectorAll('div.analysis-summary__stat');
    expect(inert.length).toBe(3 + 2);
  });

  it('fires hover with the row on enter and null on leave, and jump on click', () => {
    const hover = vi.fn();
    const jump = vi.fn();
    const el = createAnalysisSummary(ANALYSIS, undefined, { onJudgment: { hover, jump } });
    const row = el.querySelector<HTMLButtonElement>('button[data-judgment="blunder"]')!;
    row.dispatchEvent(new Event('mouseenter'));
    row.dispatchEvent(new Event('mouseleave'));
    row.click();
    expect(hover.mock.calls).toEqual([
      ['red', 'blunder'],
      ['red', null],
    ]);
    expect(jump.mock.calls).toEqual([['red', 'blunder']]);
  });

  it('stays static without onJudgment (a surface with no chart to light)', () => {
    const el = createAnalysisSummary(ANALYSIS);
    expect(el.querySelectorAll('button.analysis-summary__stat').length).toBe(0);
  });

  it('shows the Learn button only when offered, pressed while retro mode is open', () => {
    expect(createAnalysisSummary(ANALYSIS).querySelector('.analysis-summary__learn')).toBeNull();
    const onLearn = vi.fn();
    const el = createAnalysisSummary(ANALYSIS, undefined, { onLearn, learnActive: true });
    const button = el.querySelector<HTMLButtonElement>('.analysis-summary__learn')!;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('Learn from your mistakes');
    // It sits BETWEEN the two players (lichess).
    expect(button.previousElementSibling?.className).toBe('analysis-summary__player');
    expect(button.nextElementSibling?.className).toBe('analysis-summary__player');
    button.click();
    expect(onLearn).toHaveBeenCalledTimes(1);
  });
});
