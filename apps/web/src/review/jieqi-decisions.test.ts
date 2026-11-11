import { describe, expect, it } from 'vitest';
import { computeGameAnalysis, mergeDecisionAnalysis } from './game-analysis.js';
import {
  decisionView,
  type JieqiDecision,
  jieqiDecisionOverlay,
  summarizeDecisions,
} from './jieqi-decisions.js';

// The server now sends win% directly (mover POV): bestWin / playedWin / realizedWin.
function decision(p: Partial<JieqiDecision>): JieqiDecision {
  return {
    ply: 1,
    mover: 'red',
    bestWin: 50,
    playedWin: 50,
    realizedWin: 50,
    playedRank: 1,
    ...p,
  };
}

describe('decisionView', () => {
  it('keeps the same grade and accuracy when the server withholds luck', () => {
    const full = decision({ bestWin: 70, playedWin: 50, realizedWin: 62 });
    const { realizedWin: _outcome, ...grade } = full;
    const { luck: _luck, ...enabled } = decisionView(full);
    expect(decisionView(grade)).toEqual(enabled);
    const overlay = jieqiDecisionOverlay(summarizeDecisions([grade]));
    expect(overlay.red).toEqual(jieqiDecisionOverlay(summarizeDecisions([full])).red);
    expect(JSON.stringify([...overlay.byPly.values()])).not.toContain('luck');
  });
  it('leaves a decision loss under the inaccuracy bar unjudged', () => {
    // 3 points is under moveJudgment's own 5-point bar, so no glyph.
    const v = decisionView(decision({ bestWin: 53, playedWin: 50 }));
    expect(v.judgment).toBeNull();
    expect(v.decisionLoss).toBe(3);
  });

  it('grades a decision loss at or past the bar', () => {
    const v = decisionView(decision({ bestWin: 70, playedWin: 45 }));
    expect(v.judgment).toBe('blunder'); // a 25-point drop
    expect(v.decisionLoss).toBe(25);
  });

  it('decisionLoss is clamped at 0 (played can never beat best)', () => {
    const v = decisionView(decision({ bestWin: 50, playedWin: 55 }));
    expect(v.decisionLoss).toBe(0);
  });

  it('luck is the signed swing of realized vs the played move’s pool mean', () => {
    // Perfect choice (played == best) but the reveal came out below its average: pure bad luck.
    const v = decisionView(decision({ bestWin: 60, playedWin: 60, realizedWin: 48 }));
    expect(v.judgment).toBeNull(); // the DECISION was best
    expect(v.luck).toBe(-12); // realized - played
  });

  it('0 luck means the reveal came out exactly at its pool average', () => {
    const v = decisionView(decision({ playedWin: 55, realizedWin: 55 }));
    expect(v.luck).toBe(0);
  });
});

describe('summarizeDecisions', () => {
  it('aggregates decision accuracy per mover (skill only, no summed luck)', () => {
    const summary = summarizeDecisions([
      decision({ ply: 1, mover: 'red', bestWin: 60, playedWin: 60, realizedWin: 40 }), // perfect, unlucky
      decision({ ply: 3, mover: 'red', bestWin: 70, playedWin: 40, realizedWin: 45 }), // poor choice
      decision({ ply: 2, mover: 'black', bestWin: 55, playedWin: 55, realizedWin: 80 }), // perfect, lucky
    ]);
    expect(summary.red.reveals).toBe(2);
    expect(summary.black.reveals).toBe(1);
    // Red made one perfect + one poor decision → accuracy below 100.
    expect(summary.red.decisionAccuracy).toBeLessThan(100);
    // Black's single reveal was a perfect choice → ~100% decision accuracy.
    expect(summary.black.decisionAccuracy).toBeGreaterThan(95);
    // No netLuck field: luck is per-move, never summed.
    expect('netLuck' in summary.red).toBe(false);
    expect(summary.byPly.get(3)?.mover).toBe('red');
  });

  it('a player with no reveals reports 100% decision accuracy', () => {
    const summary = summarizeDecisions([
      decision({ ply: 1, mover: 'red', bestWin: 50, playedWin: 50, realizedWin: 50 }),
    ]);
    expect(summary.black.reveals).toBe(0);
    expect(summary.black.decisionAccuracy).toBe(100);
  });
});

describe('luck-only decisions', () => {
  it('keeps luck with no glyph, accuracy, rank or alternatives when bestWin is absent', () => {
    const row = {
      ply: 1,
      mover: 'red' as const,
      playedWin: 50,
      realizedWin: 62,
      playedRank: 1,
      candidates: [{ move: 'a0a1', win: 50 }],
    };
    expect(decisionView(row)).toEqual({ ply: 1, mover: 'red', judgment: null, luck: 12 });
    const summary = summarizeDecisions([row, decision({ ply: 3, bestWin: 70, playedWin: 45 })]);
    expect(summary.red.reveals).toBe(1);
    const overlay = jieqiDecisionOverlay(summary);
    expect(overlay.byPly.get(1)).toEqual({ judgment: null, luck: 12, playedRank: null });
    expect(overlay.byPly.get(3)?.judgment).toBe('blunder');
    expect(overlay.byPly.get(3)?.accuracy).toBeTypeOf('number');
    expect(overlay.red).toEqual(
      summarizeDecisions([decision({ ply: 3, bestWin: 70, playedWin: 45 })]).red,
    );
  });
});

it('excludes a luck-only reveal from headline accuracy even when stored analysis has no chance flags', () => {
  const base = {
    engineId: 'pikafish',
    depth: 12,
    plies: [0, 1, 2].map((ply) => ({ ply, cp: ply === 0 ? 500 : -500, mate: null, best: null })),
  };
  const raw = computeGameAnalysis(base);
  const marked = computeGameAnalysis({ ...base, chancePlies: [1] });
  const overlay = jieqiDecisionOverlay(
    summarizeDecisions([{ ply: 1, mover: 'red', playedWin: 50, realizedWin: 20 }]),
  );
  expect(mergeDecisionAnalysis(raw, overlay.byPly)).toEqual(
    mergeDecisionAnalysis(marked, new Map()),
  );
});
