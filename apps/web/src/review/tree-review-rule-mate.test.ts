// An engine "mate 1" that is the perpetual-check rule, not a checkmate. Pikafish judges
// repetition in its search, so on a broadcast record where Black checks in a cycle it scored
// the position after 29... f4-g2+ as Red mating in one (Red's e1-f1 repeats it a third time).
// Nobody is mated there, the event played on, and the review printed "#1", spiked the chart
// to the edge and graded 29... f4-g2+ a blunder. This mounts the real xiangqi review on that
// record with the sweep as it was stored (no `rule` tag), so the client must tag it too.
import type { XiangqiMove } from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { RULE_MATE_RECORD_EVALS, RULE_MATE_RECORD_MOVES } from './fixtures/rule-mate-record.js';
import { computeGameAnalysis, type GameAnalysis, type PlyEval } from './game-analysis.js';
import { mountXiangqiReview } from './xiangqi-review.js';

const MOVES: XiangqiMove[] = RULE_MATE_RECORD_MOVES.split(' ').map((uci) => {
  const squares = /^([a-i]\d+)([a-i]\d+)$/.exec(uci);
  if (!squares) throw new Error(`bad fixture move ${uci}`);
  return { from: squares[1], to: squares[2] } as XiangqiMove;
});

function storedEvals(): PlyEval[] {
  return RULE_MATE_RECORD_EVALS.map(([ply, cp, mate, best, pv]) => ({
    ply,
    cp,
    mate,
    best: best || null,
    pv: pv ? pv.split(' ') : [],
  }));
}

function analysisOf(evals: PlyEval[]): GameAnalysis {
  return computeGameAnalysis({ engineId: 'pikafish', depth: 18, plies: evals });
}

function mount(analysis: GameAnalysis, record: boolean): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mountXiangqiReview(root, {
    ariaLabel: 'Review',
    title: 'Review',
    summary: '',
    moves: MOVES,
    record,
    analysis: {
      requestLabel: 'Analyse',
      fetchCached: async () => analysis,
      run: async () => analysis,
    },
  });
  return root;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const evalTexts = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.review-move-list__eval')].map((el) => el.textContent ?? '');

const comments = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.move-tree__comment')].map((el) => el.textContent ?? '');

const suffixes = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.review-move-list__suffix')]
    .map((el) => el.textContent ?? '')
    .filter(Boolean);

/** The curve's plotted y per ply (index = ply). */
function curveYs(root: HTMLElement): number[] {
  const points = root.querySelector('.advantage-chart__line')?.getAttribute('points') ?? '';
  return points
    .split(' ')
    .filter(Boolean)
    .map((pair) => Number(pair.split(',')[1]));
}

describe('perpetual-check rule mate on a broadcast record', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('the stored sweep grades 29... f4-g2+ a blunder (the shape this fixes)', () => {
    const raw = analysisOf(storedEvals());
    expect(raw.evals[58]?.mate).toBe(1);
    expect(raw.moves.find((move) => move.ply === 58)?.judgment).toBe('blunder');
  });

  it('labels the rule instead of "#1", holds the chart, and leaves the move ungraded', async () => {
    const root = mount(analysisOf(storedEvals()), true);
    await settle();

    const evals = evalTexts(root);
    expect(evals.length).toBeGreaterThanOrEqual(60);
    expect(evals).not.toContain('#1');
    expect(evals.filter((text) => text === 'Perpetual')).toHaveLength(1);
    const ruleEval = [...root.querySelectorAll<HTMLElement>('.review-move-list__eval')].find(
      (el) => el.textContent === 'Perpetual',
    );
    expect(ruleEval?.title).toBe(
      'Not a checkmate. The engine scores the coming repetition as a win for Red: perpetual check loses under Mistboard rules.',
    );
    // The label sits on 29... f4-g2+, the move after which the engine read the rule.
    expect(ruleEval?.closest('button')?.textContent).toMatch(/g2/);

    // Chart: the rule point holds ply 57's standing instead of jumping to Red's edge.
    const ys = curveYs(root);
    expect(ys).toHaveLength(61);
    expect(ys[58]).toBe(ys[57]);

    // Grading: no blunder on the record; the move carries the reason instead.
    expect(suffixes(root)).not.toContain('??');
    expect(comments(root).join(' ')).not.toContain('Blunder');
    expect(comments(root)).toContain(
      'Repeats into a perpetual-check loss under Mistboard rules, which this event did not apply. Not graded.',
    );
  });

  it('a game played here keeps its grade and only changes the label', async () => {
    const root = mount(analysisOf(storedEvals()), false);
    await settle();

    const evals = evalTexts(root);
    expect(evals).not.toContain('#1');
    expect(evals).toContain('Perpetual');
    expect(suffixes(root)).toContain('??');
    expect(comments(root).join(' ')).toContain('Blunder');
    expect(comments(root).join(' ')).not.toContain('Not graded');
  });

  it('a mate score the rules do not explain stays "#1" and is graded', async () => {
    // Same position, but the engine's line is not the repeating e1-f1: the kernel cannot
    // confirm a repetition, so the score stays an ordinary mate.
    const evals = storedEvals().map((entry) =>
      entry.ply === 58 ? { ...entry, best: 'a8b8', pv: ['a8b8'] } : entry,
    );
    const root = mount(analysisOf(evals), true);
    await settle();

    expect(evalTexts(root)).toContain('#1');
    expect(evalTexts(root)).not.toContain('Perpetual');
    expect(suffixes(root)).toContain('??');
  });
});
