// The judgment counts are controls, not labels: hover lights the plies on the
// chart, click jumps to the next one. Zero rows stay inert, and the Learn
// button only renders when the surface offers retro mode.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// #1234: on a touch screen each count row is 40px tall (the #576 floor), and
// the accuracy column beside it kept its 16px text rows, so Accuracy and the
// three phases bunched at the top of a column twice their height and no row
// sat level with its neighbour. Both columns take the same 40px rows now.
describe('analysis summary rows on a touch screen', () => {
  const css = readFileSync(resolve(__dirname, 'analysis-summary.css'), 'utf8');
  const coarse = (() => {
    const at = css.indexOf('@media (pointer: coarse)');
    const end = css.indexOf('\n}', at);
    return at < 0 ? '' : css.slice(at, end);
  })();
  const ruleIn = (block: string, selector: string): string => {
    const at = block.indexOf(`${selector} {`);
    return at < 0 ? '' : block.slice(at, block.indexOf('}', at));
  };

  it('pairs every count row with an accuracy row of the same height', () => {
    const player = createAnalysisSummary(ANALYSIS).querySelector('.analysis-summary__player')!;
    // Inaccuracies, Mistakes, Blunders and ACPL, each its own row box, beside
    // the accuracy grid (Accuracy, then a row per phase the game reached).
    const stats = player.querySelectorAll('.analysis-summary__stats > .analysis-summary__stat');
    expect(stats.length).toBe(4);
    expect(
      player.querySelector('.analysis-summary__phases > .analysis-summary__phase'),
    ).not.toBeNull();
    // The phase rows are grid cells (display: contents), so the grid's own
    // row height is the one that has to match the count rows' floor.
    expect(ruleIn(coarse, '.analysis-summary__stat')).toMatch(/min-height:\s*40px/);
    expect(ruleIn(coarse, '.analysis-summary__phases')).toMatch(
      /grid-auto-rows:\s*minmax\(40px,\s*auto\)/,
    );
    expect(ruleIn(coarse, '.analysis-summary__phases')).toMatch(/align-items:\s*center/);
  });
});
