import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  type JieqiMove,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { computeGameAnalysis } from './game-analysis.js';
import { mountJieqiReview } from './jieqi-review.js';
import { type DecisionOverlay, decisionBestQuote } from './tree-review.js';

// End-to-end wiring test (jsdom): mount the jieqi review with a fake analysis + decision overlay
// and assert the visual outputs the decomposition adds — the reveal glyph + per-move luck badge on
// the move list, and the headline accuracy summary re-graded luck-free (reveal counted as a
// mistake) with a luck caption instead of a separate decision block.

function firstMoves(count: number): JieqiMove[] {
  let state = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
  const moves: JieqiMove[] = [];
  for (let i = 0; i < count; i += 1) {
    const move = getJieqiLegalMoves(state)[0]!;
    moves.push(move);
    state = applyJieqiMove(state, move);
  }
  return moves;
}

// A basic analysis whose reveal plies carry no eval-swing judgment (they are chance moves).
function fakeAnalysis(plyCount: number) {
  const plies = Array.from({ length: plyCount + 1 }, (_, ply) => ({
    ply,
    cp: 0,
    mate: null,
    best: null,
  }));
  // Mark ply 1 as a chance (reveal) ply so its basic judgment is null — the decision overlay owns it.
  return computeGameAnalysis({ engineId: 'test', depth: 10, plies, chancePlies: [1] });
}

function overlayWithFlaggedReveal(): DecisionOverlay {
  return {
    byPly: new Map([[1, { judgment: 'mistake', accuracy: 71, luck: -12, playedRank: 5 }]]),
    red: { reveals: 1, decisionAccuracy: 71 },
    black: { reveals: 0, decisionAccuracy: 100 },
  };
}

describe('jieqi decision overlay wiring', () => {
  it('renders the two-number summary, the reveal glyph, and the luck readout', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const moves = firstMoves(3);

    mountJieqiReview(root, 'room-x', STANDARD_JIEQI_DEAL, {
      ariaLabel: 'test',
      title: 'Jieqi',
      summary: 'test',
      moves,
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => fakeAnalysis(moves.length),
        run: async () => fakeAnalysis(moves.length),
      },
      decisions: {
        fetchCached: async () => overlayWithFlaggedReveal(),
        canRun: true,
        run: async () => overlayWithFlaggedReveal(),
      },
    });

    // Both fetchCached calls resolve on microtasks; let them flush.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // 1) The headline accuracy summary re-grades the reveal luck-free: Red's flagged reveal now
    // counts as a Mistake (the base analysis left it unjudged), and a luck caption replaces the old
    // separate decision block. No "Non-reveal" split, no ACPL row.
    const summary = root.querySelector('.analysis-summary');
    expect(summary).not.toBeNull();
    const redBlock = summary!.querySelector('.analysis-summary__player');
    expect(redBlock!.textContent).toContain('Mistake');
    expect(summary!.textContent).not.toContain('Non-reveal');
    expect(summary!.textContent).not.toContain('centipawn'); // ACPL hidden for chance variants
    // The luck caption was removed 2026-08-22: the summary carries the luck-free
    // grade and the per-move 🎲 badges carry the luck, with no legend under them.
    expect(root.querySelector('.review-decision-summary__caption')).toBeNull();

    // 2) The flagged reveal (ply 1) shows the decision glyph (? mistake) in the move list.
    expect(root.textContent).toContain('?');

    // 3) Luck now shows INLINE on the reveal move: a per-move dice badge, not the advice line.
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

  it('names the better reveal in the advice line', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const moves = firstMoves(3);
    const overlay: DecisionOverlay = {
      byPly: new Map([
        [
          1,
          {
            judgment: 'mistake',
            accuracy: 71,
            luck: -12,
            playedRank: 2,
            candidates: [
              { label: 'i5-i0', win: 60 },
              { label: 'b3-b10', win: 48, played: true },
            ],
          },
        ],
      ]),
      red: { reveals: 1, decisionAccuracy: 71 },
      black: { reveals: 0, decisionAccuracy: 100 },
    };
    mountJieqiReview(root, 'room-y', STANDARD_JIEQI_DEAL, {
      ariaLabel: 'test',
      title: 'Jieqi',
      summary: 'test',
      moves,
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => fakeAnalysis(moves.length),
        run: async () => fakeAnalysis(moves.length),
      },
      decisions: { fetchCached: async () => overlay, canRun: true, run: async () => overlay },
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(root.textContent).toContain('Mistake. i5-i0 was best.');
    root.remove();
  });
});

describe('decisionBestQuote', () => {
  const base = { judgment: 'mistake' as const, accuracy: 70, playedRank: 2 };
  it('quotes the top alternative when it was not played', () => {
    expect(
      decisionBestQuote({
        ...base,
        candidates: [
          { label: 'a', win: 60 },
          { label: 'b', win: 50, played: true },
        ],
      }),
    ).toBe(' a was best.');
  });
  it('says nothing when the played move led, the table is missing, or the first row is not rank 1', () => {
    expect(
      decisionBestQuote({ ...base, candidates: [{ label: 'a', win: 60, played: true }] }),
    ).toBe('');
    expect(decisionBestQuote(base)).toBe('');
    expect(decisionBestQuote({ ...base, candidates: [{ label: 'c', win: 40, rank: 3 }] })).toBe('');
  });
});
