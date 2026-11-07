// A move that IS the engine's best move must never be judged. The whole-game sweep evaluates
// each position with its OWN search, so the eval before a move and the eval after it can
// disagree even when the move was the engine's first choice; grading that drift printed the
// self-contradiction "Mistake. b1-b2 was best." under the move b1-b2 (seen in prod on a
// jungle-flip review). This mounts the real xiangqi review with exactly that shape.
import type { XiangqiMove } from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameAnalysis } from './game-analysis.js';
import { mountXiangqiReview } from './xiangqi-review.js';

const PLAYED: XiangqiMove[] = [{ from: 'b3', to: 'e3' }];

// Red played b3e3 — which evals[0] names as the best move — yet the post-move search reports a
// collapse (+250 -> -300), so the raw judgment says blunder.
const ANALYSIS: GameAnalysis = {
  engineId: 'test',
  depth: 12,
  evals: [
    { ply: 0, cp: 250, mate: null, best: 'b3e3', pv: ['b3e3', 'h8e8'] },
    { ply: 1, cp: -300, mate: null, best: 'h8e8', pv: ['h8e8'] },
  ],
  moves: [{ ply: 1, mover: 'red', judgment: 'blunder', accuracy: 20 }],
  chancePlies: [],
  unstablePlies: [],
  bestPlayedPlies: [],
  red: { accuracy: 20, inaccuracies: 0, mistakes: 0, blunders: 1, acpl: 550 },
  black: { accuracy: 100, inaccuracies: 0, mistakes: 0, blunders: 0, acpl: 0 },
};

function mount(analysis: GameAnalysis): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mountXiangqiReview(root, {
    ariaLabel: 'Review',
    title: 'Review',
    summary: '',
    moves: PLAYED,
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

describe('best-played move', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('never advises the move that was played, and carries no judgment glyph', async () => {
    const root = mount(ANALYSIS);
    await settle();
    expect(
      [...root.querySelectorAll('.analysis-summary__stat-label')].filter(
        (el) => el.textContent === 'Average centipawn loss',
      ),
    ).toHaveLength(2);

    const comments = [...root.querySelectorAll('.move-tree__comment')]
      .map((el) => el.textContent ?? '')
      .filter(Boolean);
    expect(comments).toEqual([]);
    // The glyph span is always present (CSS hides it when empty); it must carry no ?/??/?!.
    const glyphs = [...root.querySelectorAll('.review-move-list__suffix')]
      .map((el) => el.textContent ?? '')
      .filter(Boolean);
    expect(glyphs).toEqual([]);
  });

  it('still judges a move the engine did NOT pick', async () => {
    // Same collapse, but the engine wanted h3e3 instead — a real, advisable alternative.
    const root = mount({
      ...ANALYSIS,
      evals: [{ ...ANALYSIS.evals[0]!, best: 'h3e3', pv: ['h3e3'] }, ANALYSIS.evals[1]!],
    });
    await settle();

    const comments = [...root.querySelectorAll('.move-tree__comment')].map(
      (el) => el.textContent ?? '',
    );
    expect(comments.join(' ')).toContain('was best');
  });
});
