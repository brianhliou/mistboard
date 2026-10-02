// The per-move marks both the review's move tree and the game embed read: glyph, advice,
// and the better move to draw. Fixtures are a real jieqi game's stored analysis and
// decision layer (prod, jq_23d2a761…, fetched 2026-10-02), where ply 27 is a reveal
// blunder, plus hand-built xiangqi shapes for the quiet-move and policy cases.
import { describe, expect, it } from 'vitest';
import {
  analysisMarks,
  bestPlayedPliesFromSquares,
  betterFromPly,
  type DecisionOverlay,
  judgmentBadgeAtPly,
  markArrowMoves,
} from './analysis-marks.js';
import jieqiAnalysis from './fixtures/jieqi-23d2a761.analysis.json' with { type: 'json' };
import jieqiDecisions from './fixtures/jieqi-23d2a761.decisions.json' with { type: 'json' };
import { computeGameAnalysis, type XiangqiGameAnalysisResponse } from './game-analysis.js';
import { jieqiDecisionOverlay, summarizeDecisions } from './jieqi-decisions.js';
import { defaultFormatBestMove, formatJieqiBestMove } from './move-advice-text.js';

function jieqiMarks() {
  const analysis = computeGameAnalysis(jieqiAnalysis as XiangqiGameAnalysisResponse);
  const overlay = jieqiDecisionOverlay(
    summarizeDecisions(
      (jieqiDecisions as { decisions: Parameters<typeof summarizeDecisions>[0] }).decisions,
    ),
  );
  return analysisMarks({
    analysis,
    decisions: overlay,
    quoteEvalBestMove: true,
    formatBestMove: formatJieqiBestMove,
  });
}

// Red's b3-e3 collapses the eval (+250 -> -300) where the engine wanted h3-e3.
const XIANGQI_BLUNDER: XiangqiGameAnalysisResponse = {
  engineId: 'test',
  depth: 12,
  plies: [
    { ply: 0, cp: 250, mate: null, best: 'h3e3' },
    { ply: 1, cp: -300, mate: null, best: 'h8e8' },
    { ply: 2, cp: -300, mate: null, best: 'h3e3' },
  ],
};

describe('analysisMarks: quiet moves (eval track)', () => {
  it('glyphs a judged move, quotes the best move, and points at it', () => {
    const marks = analysisMarks({
      analysis: computeGameAnalysis(XIANGQI_BLUNDER),
      quoteEvalBestMove: true,
      formatBestMove: defaultFormatBestMove,
    });
    const blunder = marks.get(1);
    expect(blunder).toMatchObject({
      suffix: '??',
      suffixClass: 'blunder',
      comment: 'Blunder. h3-e3 was best.',
      commentClass: 'blunder',
      better: { kind: 'move', uci: 'h3e3' },
    });
    expect(markArrowMoves(blunder)).toEqual([{ uci: 'h3e3' }]);
    // A fine move carries nothing to draw or say.
    expect(marks.get(2)).toEqual({ ply: 2, better: null });
    expect(markArrowMoves(marks.get(2))).toEqual([]);
  });

  it('keeps the glyph but neither quotes nor draws the best move where the variant forbids it', () => {
    const marks = analysisMarks({
      analysis: computeGameAnalysis(XIANGQI_BLUNDER),
      quoteEvalBestMove: false,
      formatBestMove: defaultFormatBestMove,
    });
    expect(marks.get(1)).toMatchObject({ suffix: '??', comment: 'Blunder.', better: null });
    expect(markArrowMoves(marks.get(1))).toEqual([]);
  });

  it('carries a praise glyph and note, with nothing to draw', () => {
    const analysis = computeGameAnalysis(XIANGQI_BLUNDER);
    const praised = {
      ...analysis,
      moves: analysis.moves.map((m) => (m.ply === 2 ? { ...m, praise: 'great' as const } : m)),
    };
    const mark = analysisMarks({
      analysis: praised,
      quoteEvalBestMove: true,
      formatBestMove: defaultFormatBestMove,
    }).get(2);
    expect(mark).toMatchObject({ suffix: '!', suffixClass: 'great', commentClass: 'great' });
    expect(mark?.comment).toContain('Great move');
    expect(mark?.better).toBeNull();
  });
});

describe('analysisMarks: chance plies (decision layer)', () => {
  it('grades the real ply-27 reveal blunder on the choice and names the top reveal', () => {
    const mark = jieqiMarks().get(27);
    expect(mark).toMatchObject({
      suffix: '??',
      suffixClass: 'blunder',
      comment: 'Blunder. e2-d1 was best.',
      commentClass: 'blunder',
    });
    // Luck is the reveal's own swing, rounded; it rides along for the review's badge.
    expect(mark?.luck).toBe(-35);
  });

  it('points at the top three alternatives in rank order, never the move played, never a line', () => {
    const mark = jieqiMarks().get(27);
    expect(mark?.better?.kind).toBe('candidates');
    const moves = markArrowMoves(mark);
    expect(moves.map((m) => m.uci)).toEqual(['e1d0', 'e1f2', 'e1d2']);
    // Win% descending: the weights downstream read the gap to the first.
    expect(moves.map((m) => Math.round(m.win ?? 0))).toEqual([70, 67, 67]);
    expect(moves.some((m) => m.uci === 'b2d2')).toBe(false); // the played reveal
  });

  it('draws nothing for a reveal the decision layer did not judge, though it keeps its luck', () => {
    // Ply 25: the played reveal ranked second, 1.4 win points off the best: no glyph.
    const mark = jieqiMarks().get(25);
    expect(mark?.suffix).toBeUndefined();
    expect(mark?.comment).toBeUndefined();
    expect(mark?.better).toBeNull();
    expect(typeof mark?.luck).toBe('number');
  });

  it('a decision ply replaces an eval glyph, and a fine decision clears it', () => {
    const analysis = computeGameAnalysis(XIANGQI_BLUNDER);
    const overlay: DecisionOverlay = {
      byPly: new Map([[1, { judgment: null, accuracy: 100, playedRank: 1 }]]),
      red: { reveals: 1, decisionAccuracy: 100 },
      black: { reveals: 0, decisionAccuracy: 100 },
    };
    const mark = analysisMarks({
      analysis,
      decisions: overlay,
      quoteEvalBestMove: true,
      formatBestMove: defaultFormatBestMove,
    }).get(1);
    expect(mark?.suffix).toBeUndefined();
    expect(mark?.better).toBeNull();
  });

  it('a judged reveal whose table carries no engine moves draws nothing (banqi, older caches)', () => {
    const overlay: DecisionOverlay = {
      byPly: new Map([
        [
          1,
          {
            judgment: 'mistake',
            accuracy: 60,
            playedRank: 4,
            candidates: [
              { label: 'a1-a2', win: 60 },
              { label: 'b1-b2', win: 40, played: true },
            ],
          },
        ],
      ]),
      red: { reveals: 1, decisionAccuracy: 60 },
      black: { reveals: 0, decisionAccuracy: 100 },
    };
    const mark = analysisMarks({
      analysis: computeGameAnalysis({ ...XIANGQI_BLUNDER, chancePlies: [1] }),
      decisions: overlay,
      quoteEvalBestMove: true,
      formatBestMove: defaultFormatBestMove,
    }).get(1);
    expect(mark?.comment).toBe('Mistake. a1-a2 was best.');
    expect(mark?.better).toBeNull();
  });
});

describe('bestPlayedPliesFromSquares', () => {
  it('matches the stored best move against the move played, by board squares', () => {
    const analysis = computeGameAnalysis(XIANGQI_BLUNDER);
    const parse = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    expect(
      bestPlayedPliesFromSquares(
        analysis.evals,
        [
          { ply: 1, from: 'h3', to: 'e3' },
          { ply: 2, from: 'h7', to: 'e7' },
        ],
        parse,
      ),
    ).toEqual(new Set([1]));
    // A drop (no `from`) matches on its destination when the best move is a drop too.
    expect(
      bestPlayedPliesFromSquares(
        [{ ply: 0, cp: 0, mate: null, best: 'R@e5' }],
        [{ ply: 1, to: 'e5' }],
        () => ({ to: 'e5' }),
      ),
    ).toEqual(new Set([1]));
  });
});

describe('where marks show on the board (lichess convention)', () => {
  it('the better move attaches to the position BEFORE the judged move', () => {
    const marks = jieqiMarks();
    expect(betterFromPly(marks, 26)).toMatchObject({ kind: 'candidates' });
    expect(betterFromPly(marks, 27)).toBeNull(); // the blunder's own position
    expect(betterFromPly(marks, 24)).toBeNull(); // next move (25) was fine
    const quiet = analysisMarks({
      analysis: computeGameAnalysis(XIANGQI_BLUNDER),
      quoteEvalBestMove: true,
      formatBestMove: defaultFormatBestMove,
    });
    expect(betterFromPly(quiet, 0)).toEqual({ kind: 'move', uci: 'h3e3' });
    expect(betterFromPly(quiet, 1)).toBeNull();
  });

  it('the badge attaches to the judged move itself, and only to a judged one', () => {
    const marks = jieqiMarks();
    expect(judgmentBadgeAtPly(marks, 27)).toEqual({ text: '??', suffixClass: 'blunder' });
    expect(judgmentBadgeAtPly(marks, 26)).toBeNull();
    expect(judgmentBadgeAtPly(marks, 25)).toBeNull();
  });

  it('a variant that forbids quoting still badges the move, with nothing to draw', () => {
    const marks = analysisMarks({
      analysis: computeGameAnalysis(XIANGQI_BLUNDER),
      quoteEvalBestMove: false,
      formatBestMove: defaultFormatBestMove,
    });
    expect(betterFromPly(marks, 0)).toBeNull();
    expect(judgmentBadgeAtPly(marks, 1)).toEqual({ text: '??', suffixClass: 'blunder' });
  });
});
