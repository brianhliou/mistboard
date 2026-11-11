import {
  applyBanqiMove,
  type BanqiMove,
  createInitialBanqiState,
  getBanqiLegalMoves,
  STANDARD_BANQI_DEAL,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { banqiDecisionOverlay, summarizeDecisions } from './banqi-decisions.js';
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

describe('ranked flip alternatives', () => {
  it('formats and carries cached candidates through the variant overlay', async () => {
    const decision = {
      ply: 1,
      mover: 'red' as const,
      bestWin: 70,
      playedWin: 50,
      realizedWin: 40,
      playedRank: 2,
      candidates: [
        { move: 'b2b2', win: 70 },
        { move: 'a0a0', win: 50, played: true },
      ],
    };
    const mark = banqiDecisionOverlay(summarizeDecisions([decision])).byPly.get(1)!;
    expect(mark.candidates).toEqual([
      { label: 'b3 flip', uci: 'b2b2', win: 70, rank: 1 },
      { label: 'a1 flip', uci: 'a0a0', win: 50, rank: 2, played: true },
    ]);
    const root = document.createElement('div');
    document.body.append(root);
    const overlay = banqiDecisionOverlay(summarizeDecisions([decision]));
    mountBanqiReview(
      root,
      'ranked-test',
      { deal: STANDARD_BANQI_DEAL, rules: {} },
      {
        ariaLabel: 'test',
        title: 'test',
        summary: 'test',
        moves: firstMoves(3),
        analysis: {
          requestLabel: 'Analyse',
          fetchCached: async () => fakeAnalysis(3),
          run: async () => fakeAnalysis(3),
        },
        decisions: { fetchCached: async () => overlay, canRun: true, run: async () => overlay },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('b3 flip was best.');
    const toggle = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].find(
      (button) => button.textContent?.includes('Show alternatives'),
    )!;
    toggle.click();
    const row = root.querySelector('.move-tree__candidates');
    expect(row?.textContent).toContain('b3 flip');
    expect(row?.textContent).toContain('70%');
    expect(row?.querySelector('.move-tree__candidate--played')?.textContent).toContain('a1 flip');
    root.remove();
    const { candidates: _oldMissing, ...old } = decision;
    const legacy = banqiDecisionOverlay(summarizeDecisions([old])).byPly.get(1)!;
    expect(legacy.playedRank).toBe(2);
    expect(legacy.candidates).toBeUndefined();
  });
});
