import {
  applyBanqiMove,
  type BanqiMove,
  createInitialBanqiState,
  getBanqiLegalMoves,
  STANDARD_BANQI_DEAL,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { mountBanqiReview } from './banqi-review.js';
import { computeGameAnalysis } from './game-analysis.js';
import type { DecisionOverlay } from './tree-review.js';

// End-to-end wiring test (jsdom): mount the banqi review with a fake analysis + decision overlay
// and assert the visual outputs the decomposition adds — the flip glyph + per-move luck badge on
// the move list, and the headline accuracy summary re-graded luck-free (the flip counted as a
// mistake) with a luck caption instead of a separate decision block. Mirrors the jieqi UI test.

function firstMoves(count: number): BanqiMove[] {
  let state = createInitialBanqiState('t', STANDARD_BANQI_DEAL);
  const moves: BanqiMove[] = [];
  for (let i = 0; i < count; i += 1) {
    const move = getBanqiLegalMoves(state)[0]!;
    moves.push(move);
    state = applyBanqiMove(state, move);
  }
  return moves;
}

// A basic analysis whose flip plies carry no eval-swing judgment (they are chance moves).
function fakeAnalysis(plyCount: number) {
  const plies = Array.from({ length: plyCount + 1 }, (_, ply) => ({
    ply,
    cp: 0,
    mate: null,
    best: null,
  }));
  // Mark ply 1 as a chance (flip) ply so its basic judgment is null — the decision overlay owns it.
  return computeGameAnalysis({ engineId: 'test', depth: 10, plies, chancePlies: [1] });
}

function overlayWithFlaggedFlip(): DecisionOverlay {
  return {
    byPly: new Map([[1, { judgment: 'mistake', accuracy: 71, luck: -12, playedRank: 5 }]]),
    red: { reveals: 1, decisionAccuracy: 71 },
    black: { reveals: 0, decisionAccuracy: 100 },
  };
}

describe('banqi decision overlay wiring', () => {
  it('renders the two-number summary, the flip glyph, and the luck readout', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const moves = firstMoves(3);

    mountBanqiReview(
      root,
      'room-x',
      { deal: STANDARD_BANQI_DEAL, rules: {} },
      {
        ariaLabel: 'test',
        title: 'Banqi',
        summary: 'test',
        moves,
        analysis: {
          requestLabel: 'Analyse',
          fetchCached: async () => fakeAnalysis(moves.length),
          run: async () => fakeAnalysis(moves.length),
        },
        decisions: {
          fetchCached: async () => overlayWithFlaggedFlip(),
          canRun: true,
          run: async () => overlayWithFlaggedFlip(),
        },
      },
    );

    // Both fetchCached calls resolve on microtasks; let them flush.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // 1) The headline accuracy summary re-grades the flip luck-free: Red's flagged flip now counts
    // as a Mistake (the base analysis left it unjudged), and a luck caption replaces the old separate
    // decision block. No "Non-reveal" split, no ACPL row.
    const summary = root.querySelector('.analysis-summary');
    expect(summary).not.toBeNull();
    const redBlock = summary!.querySelector('.analysis-summary__player');
    expect(redBlock!.textContent).toContain('Mistake');
    expect(summary!.textContent).not.toContain('Non-reveal');
    expect(summary!.textContent).not.toContain('centipawn'); // ACPL hidden for chance variants
    // The luck caption was removed 2026-08-22: the summary carries the luck-free
    // grade and the per-move 🎲 badges carry the luck, with no legend under them.
    expect(root.querySelector('.review-decision-summary__caption')).toBeNull();

    // 2) The flagged flip (ply 1) shows the decision glyph (? mistake) in the move list.
    expect(root.textContent).toContain('?');

    // 3) Luck now shows INLINE on the flip move: a per-move dice badge, not the advice line.
    const luckBadges = [...root.querySelectorAll('.review-move-list__luck')].filter((el) =>
      el.textContent?.includes('🎲'),
    );
    expect(luckBadges.length).toBeGreaterThan(0);
    expect(luckBadges.some((el) => el.textContent?.includes('-12%'))).toBe(true);
    expect(luckBadges.some((el) => el.classList.contains('review-move-list__luck--unlucky'))).toBe(
      true,
    );

    root.remove();
  });
});
