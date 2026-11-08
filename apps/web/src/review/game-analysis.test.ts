import { accuracyPercent } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { decisionView as banqiDecisionView } from './banqi-decisions.js';
import {
  computeGameAnalysis,
  judgmentGlyph,
  mergeDecisionAnalysis,
  type PlyDecision,
  praiseGlyph,
  regradeBestPlayed,
  withPraise,
} from './game-analysis.js';

const evals = (cps: (number | null)[]) => ({
  engineId: 'pikafish',
  depth: 12,
  plies: cps.map((cp, ply) => ({ ply, cp, mate: null, best: null })),
});

describe('computeGameAnalysis', () => {
  it.each(['cp', 'mate'] as const)(
    'uses the first mover POV for aggregate accuracy with %s evaluations',
    (kind) => {
      const response = {
        engineId: 'rapfi-gomoku',
        depth: 9,
        plies: [-1, 1, -1, -1].map((sign, ply) => ({
          ply,
          cp: kind === 'cp' ? sign * 600 : null,
          mate: kind === 'mate' ? sign * 6 : null,
          best: null,
        })),
      };
      const analysis = computeGameAnalysis(response, { firstMover: 'black' });
      expect(analysis.moves.map((move) => move.judgment)).toEqual(['blunder', 'blunder', null]);
      expect(analysis.red.blunders).toBe(1);
      expect(analysis.black.blunders).toBe(1);
      expect(analysis.red.accuracy).toBeCloseTo(analysis.moves[1]!.accuracy);
      expect(analysis.black.accuracy).toBeLessThan(60);
      // A mirrored first-seat opening must produce the same grades and aggregate scores.
      const mirrored = computeGameAnalysis({
        ...response,
        plies: response.plies.map((point) => ({
          ...point,
          cp: point.cp === null ? null : -point.cp,
          mate: point.mate === null ? null : -point.mate,
        })),
      });
      expect(analysis.red).toEqual(mirrored.black);
      expect(analysis.black).toEqual(mirrored.red);
      const regraded = regradeBestPlayed(analysis, new Set([3]));
      expect(regraded.red.accuracy).toBeCloseTo(analysis.red.accuracy);
      expect(regraded.black.accuracy).toBeCloseTo(analysis.black.accuracy);
      const merged = mergeDecisionAnalysis(analysis, new Map());
      expect(merged.red.accuracy).toBeCloseTo(analysis.red.accuracy);
      expect(merged.black.accuracy).toBeCloseTo(analysis.black.accuracy);
    },
  );

  it('assigns movers by ply parity (Red on odd plies)', () => {
    const a = computeGameAnalysis(evals([0, 20, 15, 30]));
    expect(a.moves.map((m) => m.mover)).toEqual(['red', 'black', 'red']);
    expect(a.moves.map((m) => m.ply)).toEqual([1, 2, 3]);
  });

  it('flags a Red blunder when Red POV collapses on a Red move', () => {
    // ply 1 is Red's move; Red POV drops 0 -> -600 (Red gave up ~30 win%).
    const a = computeGameAnalysis(evals([0, -600]));
    expect(a.moves[0]?.mover).toBe('red');
    expect(a.moves[0]?.judgment).toBe('blunder');
    expect(a.red.blunders).toBe(1);
    expect(a.red.accuracy).toBeLessThan(60);
    expect(a.black.blunders).toBe(0);
  });

  it('leaves a CHANCE (flip) ply unjudged and uncounted', () => {
    // Same collapse as above, but ply 1 is marked as a chance move (a flip). We can't yet
    // separate the decision from the reveal, so it gets no glyph and isn't counted.
    const a = computeGameAnalysis({ ...evals([0, -600]), chancePlies: [1] });
    expect(a.moves[0]?.mover).toBe('red');
    expect(a.moves[0]?.judgment).toBe(null);
    expect(a.red.blunders).toBe(0);
    expect(a.red.mistakes).toBe(0);
    expect(a.red.inaccuracies).toBe(0);
    // ACPL excludes the chance ply too (no attributable loss).
    expect(a.red.acpl).toBe(0);
  });

  it('leaves a move that WAS the engine best ungraded, scored 100, and uncounted', () => {
    // Same collapse as the blunder above, but ply 1 played the engine's own best move: the
    // pre-move and post-move evals come from two independent searches, so the drop is search
    // drift, not an error. Judging it would print "Blunder. X was best." on the move X.
    const a = computeGameAnalysis(evals([0, -600]), { bestPlayedPlies: new Set([1]) });
    expect(a.moves[0]?.judgment).toBe(null);
    expect(a.moves[0]?.accuracy).toBe(100);
    expect(a.red.blunders).toBe(0);
    expect(a.red.acpl).toBe(0);
    expect(a.bestPlayedPlies).toEqual([1]);
  });

  it('keeps a chance ply chance-graded even when it played the engine best', () => {
    // The decision decomposition owns a reveal's grade; a flat 100 would overwrite it.
    const a = computeGameAnalysis(
      { ...evals([0, -600]), chancePlies: [1] },
      { bestPlayedPlies: new Set([1]) },
    );
    expect(a.bestPlayedPlies).toEqual([]);
    expect(a.moves[0]?.judgment).toBe(null);
    expect(a.moves[0]?.accuracy).toBeLessThan(100);
  });

  it('regradeBestPlayed re-derives the summary without recomputing from the wire', () => {
    const base = computeGameAnalysis(evals([0, -600]));
    expect(base.red.blunders).toBe(1);
    const regraded = regradeBestPlayed(base, new Set([1]));
    expect(regraded.moves[0]?.judgment).toBe(null);
    expect(regraded.red.blunders).toBe(0);
    // No best-played plies = the same analysis object back (no work, no drift).
    expect(regradeBestPlayed(base, new Set())).toBe(base);
  });

  it('a Black move that improves Black is not penalised', () => {
    // ply 2 is Black's move; Red POV drops 200 -> 0, i.e. Black improved.
    const a = computeGameAnalysis(evals([0, 200, 0]));
    const blackMove = a.moves.find((m) => m.mover === 'black');
    expect(blackMove?.judgment).toBeNull();
    expect(blackMove?.accuracy).toBeGreaterThan(95);
  });

  it('reports ACPL and keeps accuracy within [0, 100]', () => {
    const a = computeGameAnalysis(evals([0, 20, -10, 40]));
    expect(a.red.acpl).toBeGreaterThanOrEqual(0);
    expect(a.red.accuracy).toBeGreaterThanOrEqual(0);
    expect(a.red.accuracy).toBeLessThanOrEqual(100);
  });
});

// AB-JChess cp are on a steeper curve than PikaJieQi's (#482): the same -60cp drop is ~5.5
// win points on lila's curve and ~14.4 on AB's. The stored engineId says which applies, so
// a jieqi game analysed by AB must be graded on AB's curve and an older one on lila's.
describe('engine-specific win curve', () => {
  const abId = 'ab-jchess-jieqi-analysis@1+1ae95ca6+abjchess-20260911+nodes50000+consistent-win1';
  const pikaId = 'pikafish-jieqi-analysis@0.4.0+e75cee3a+history1+nodes500000+consistent1';

  it('grades an AB-JChess analysis on its own curve', () => {
    const ab = computeGameAnalysis({ ...evals([0, -60]), engineId: abId });
    expect(ab.moves[0]?.judgment).toBe('mistake');
    const pika = computeGameAnalysis({ ...evals([0, -60]), engineId: pikaId });
    expect(pika.moves[0]?.judgment).toBe('inaccuracy');
    // Accuracy follows the same curve: the steeper one costs more.
    expect(ab.red.accuracy).toBeLessThan(pika.red.accuracy);
  });

  it('keeps the curve through the best-played regrade and the decision merge', () => {
    const ab = computeGameAnalysis({ ...evals([0, -60, -60, -60]), engineId: abId });
    const regraded = regradeBestPlayed(ab, new Set([3]));
    expect(regraded.moves[0]?.judgment).toBe('mistake');
    const merged = mergeDecisionAnalysis(ab, new Map());
    const pikaMerged = mergeDecisionAnalysis(
      computeGameAnalysis({ ...evals([0, -60, -60, -60]), engineId: pikaId }),
      new Map(),
    );
    expect(merged.red.accuracy).toBeLessThan(pikaMerged.red.accuracy);
  });

  it('grades Misty moves and merged flip decisions on the same expected-score scale', () => {
    const base = computeGameAnalysis({
      ...evals([0, -120, -120, -120]),
      engineId: 'misty-three-kingdoms-banqi-analysis@1',
    });
    // A 6-point expected-score loss crosses only the 5-point inaccuracy bar;
    // the chess curve sees a 10.9-point loss and calls this a mistake.
    const expectedAccuracy = accuracyPercent(50, 44);
    expect(base.moves[0]?.judgment).toBe('inaccuracy');
    expect(base.moves[0]?.winLoss).toBeCloseTo(6);
    expect(base.moves[0]?.accuracy).toBeCloseTo(expectedAccuracy);
    expect(base.red.inaccuracies).toBe(1);
    expect(base.red.mistakes).toBe(0);
    expect(regradeBestPlayed(base, new Set([3])).moves[0]?.judgment).toBe('inaccuracy');
    // An empty overlay must retain ordinary move accuracy (the merge's second
    // score-to-win% call site), rather than quietly restoring the chess curve.
    expect(mergeDecisionAnalysis(base, new Map()).red.accuracy).toBeCloseTo(base.red.accuracy);

    const flip = banqiDecisionView({
      ply: 3,
      mover: 'red',
      bestWin: 50,
      playedWin: 44,
      realizedWin: 20,
      playedRank: 2,
    });
    expect(flip.judgment).toBe(base.moves[0]?.judgment);
    expect(flip.accuracy).toBeCloseTo(expectedAccuracy);
    const merged = mergeDecisionAnalysis(base, new Map([[3, flip]]));
    expect(merged.red.inaccuracies).toBe(2);
    expect(merged.red.mistakes).toBe(0);
    expect(merged.red.accuracy).toBeCloseTo(expectedAccuracy);
  });

  it('uses the mover POV for Misty losses when Black moves first', () => {
    const base = computeGameAnalysis(
      { ...evals([0, 120]), engineId: 'misty-three-kingdoms-banqi-analysis@1' },
      { firstMover: 'black' },
    );
    expect(base.moves[0]?.mover).toBe('black');
    expect(base.moves[0]?.judgment).toBe('inaccuracy');
    expect(base.moves[0]?.winLoss).toBeCloseTo(6);
    expect(base.black.accuracy).toBeCloseTo(accuracyPercent(50, 44));
    expect(mergeDecisionAnalysis(base, new Map()).black.accuracy).toBeCloseTo(base.black.accuracy);
  });
});

describe('mergeDecisionAnalysis', () => {
  it('re-grades a reveal ply luck-free: a blundered choice now counts, a lucky crater does not', () => {
    // Red's ply-1 reveal realized as a crater (0 -> -600), which the base leaves unjudged. The
    // decomposition says the CHOICE was a blunder (decision accuracy 12) — so the merged summary
    // must surface that blunder and drop Red's accuracy, even though the base showed a clean 100%.
    const base = computeGameAnalysis({ ...evals([0, -600]), chancePlies: [1] });
    expect(base.red.blunders).toBe(0);
    expect(base.red.accuracy).toBe(100); // base excludes the reveal -> misleading clean sheet

    const decisions = new Map<number, PlyDecision>([[1, { accuracy: 12, judgment: 'blunder' }]]);
    const merged = mergeDecisionAnalysis(base, decisions);
    expect(merged.red.blunders).toBe(1);
    expect(merged.red.accuracy).toBeLessThan(60);
    expect(merged.red.acpl).toBe(0); // ACPL is dropped for chance variants
  });

  it('a fine reveal choice keeps accuracy high regardless of the realized swing', () => {
    // Same crater outcome, but the choice was near-best (decision accuracy 98, no judgment).
    const base = computeGameAnalysis({ ...evals([0, -600]), chancePlies: [1] });
    const decisions = new Map<number, PlyDecision>([[1, { accuracy: 98, judgment: null }]]);
    const merged = mergeDecisionAnalysis(base, decisions);
    expect(merged.red.blunders).toBe(0);
    expect(merged.red.accuracy).toBeGreaterThan(90);
  });

  it('leaves a reveal with no decision entry ungraded (dropped, not blamed)', () => {
    const base = computeGameAnalysis({ ...evals([0, -600]), chancePlies: [1] });
    const merged = mergeDecisionAnalysis(base, new Map());
    expect(merged.red.blunders).toBe(0);
    expect(merged.red.accuracy).toBe(100); // no gradeable move -> 100, not a misleading 0
  });
});

describe('judgmentGlyph', () => {
  it('maps each judgment to its lichess glyph + colour class', () => {
    expect(judgmentGlyph('blunder')).toEqual({ suffix: '??', suffixClass: 'blunder' });
    expect(judgmentGlyph('mistake')).toEqual({ suffix: '?', suffixClass: 'mistake' });
    expect(judgmentGlyph('inaccuracy')).toEqual({ suffix: '?!', suffixClass: 'inaccuracy' });
  });

  it('returns null for a fine move (no glyph)', () => {
    expect(judgmentGlyph(null)).toBeNull();
  });
});

describe('withPraise', () => {
  it('attaches a positive verdict only to unjudged moves, and no-ops on an empty map', () => {
    const base = computeGameAnalysis(evals([0, 20, 600]));
    expect(withPraise(base, new Map())).toBe(base);
    const praised = withPraise(
      base,
      new Map([
        [1, 'brilliant' as const],
        [2, 'great' as const],
      ]),
    );
    expect(praised.moves[0]?.praise).toBe('brilliant');
    // Ply 2 is a blunder for its mover; an error is never praised.
    expect(praised.moves[1]?.judgment).toBe('blunder');
    expect(praised.moves[1]?.praise).toBeUndefined();
    expect(praiseGlyph('brilliant')).toEqual({ suffix: '!!', suffixClass: 'brilliant' });
    expect(praiseGlyph('great')).toEqual({ suffix: '!', suffixClass: 'great' });
    expect(praiseGlyph(undefined)).toBeNull();
  });
});
