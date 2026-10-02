// Postgame analysis math (P3): centipawn eval -> win probability -> per-move
// judgment + accuracy. Formulas ported from lichess/lila.
//
// CALIBRATED AND LEFT ALONE, 2026-08-27. The note here used to say the chess
// constants "likely want recalibration on real xiangqi games". That was tested
// against 70 national-championship games (856 sampled positions, every 6th ply
// past move 10, paired with the actual game result). Do not re-litigate it
// without a bigger corpus; `scripts/calibrate-win-curve.mjs` reproduces it.
//
//   - Near equality, where essentially every judgment happens, the chess curve
//     is right: the -75..+75cp band (558 samples) scored 0.500 observed against
//     0.511 predicted.
//   - Best fit is K = 0.00623, 1.69x steeper than chess, because real games
//     convert a 200-400cp edge (0.909) harder than the chess curve expects
//     (0.739). But bootstrapping BY GAME -- the right unit, since positions
//     inside one game share its result -- gives a 95% CI of 0.0033-0.0114, which
//     contains the chess constant. Mean log-loss 0.6219 -> 0.6124. Refitting on
//     70 games would be fitting noise.
//   - The corpus is master play (49% draws, Red scores 0.571). A curve for
//     amateur games could differ; that is the sample that would settle it.
//
// So the residual error is confined to already-decided positions, where a drop
// from +300 to +150 is graded slightly gentler than xiangqi practice justifies.
// That is the least consequential region there is.
//
// ENGINE WDL IS NOT A SECOND SOURCE, 2026-09-01. Recorded because it looks like
// one and is not, and the next person to notice it will think they have found
// something. Pikafish carries its own WDL model (`UCI_ShowWDL`, off by default).
// Probed on 243 positions from 23 real games it disagrees with the curve below
// enormously, and in the SAME direction the 70-game outcome fit pointed: the gap
// peaks at ~+31 win-points near 200cp (logistic 67.6% vs engine 98.5%), and
// vanishes at equality (+0.7 in -75..+75, independently confirming the finding
// above). Tempting to call that corroboration. It is not, for three reasons:
//
//   - IT IS NOT AN INDEPENDENT OBSERVATION. Pikafish's reported cp is DEFINED by
//     its WDL model -- normalized eval, where 1.0 pawn means 0.5 win probability
//     (its own FAQ). Comparing cp-derived win% against WDL compares one function
//     with itself in two coordinate systems, plus lichess's curve.
//   - WRONG POPULATION, AND THE ANSWER WAS PREDETERMINED. That WDL is fit to
//     engine self-play at fishtest LTC, i.e. ~3400-strength conversion. A
//     near-perfect-play curve is GUARANTEED steeper than any human curve, so the
//     test could only ever come out one way. Sign agreement carries no
//     information.
//   - A CHESS CONTROL KILLS THE XIANGQI-SPECIFIC CLAIM. Stockfish 18 over 40
//     master chess games (210 deep samples, identical pipeline) diverges from
//     WIN_PCT_K by +21.2 / +31.9 / +24.9 / +17.9 across the same bands -- LARGER
//     than xiangqi's. And that constant is not miscalibrated for chess; it is
//     lichess's own chess constant fit on lichess human games. Per-engine,
//     xiangqi wants a SMALLER correction than chess (0.83x) -- the opposite sign
//     from the 1.69x. The divergence is a property of engine WDL models in
//     general, not a fact about xiangqi.
//
// The reconciling K over 150-500cp is ~0.021 (5.7x), far outside the outcome
// fit's bootstrap CI (0.0033-0.0114). Adopting anything near it collapses every
// position past ~250cp to 99-100%, so +400 -> +200 would grade as a ~1-point
// loss: it DESTROYS resolution in exactly the won-position region this note
// calls the residual error. That is a regression, not a fix.
//
// So the 1.69x remains a lone point estimate inside a CI that contains the chess
// constant, and what would settle it is unchanged: a bigger corpus of AMATEUR
// games with known results, the population postgame analysis actually grades.
// Evidence: `tmp/wdl-control-2026-09-01/` (untracked; xiangqi + chess samples).
//
// WDL IS NOT THE FIX -- MEASURED AND CLOSED OFF. The obvious next move is to
// stop deriving win% from cp and read the engine's WDL instead. Do not: it
// saturates HARDER than the clamped curve. Probed down one real game at
// 250k/1M/4M nodes, WDL pins at W100.0/D0.0/L0.0 from +5.5 material onward and
// never moves again across a further 15 points of material, while the clamped cp
// curve still climbs (87.6 -> 94.4 -> 97.3). Switching shrinks the measurable
// zone. The deeper reason is structural: engine WDL is fit to how the ENGINE
// converts, so it reports certainty exactly where a human review wants to grade
// conversion difficulty. `scripts/probe-win-curve-wdl.mjs` reproduces the probe.
//
// Corollary for anything that wants to grade conversion in a won position: no
// probability can do it, because the probability is genuinely ~1. Use quantities
// that stay unsaturated there -- material conceded (xiangqi-exchange.ts, already
// computed) and mate distance -- not a reshaped curve.
//
// REPRODUCIBILITY WARNING, 2026-09-01. `calibrate-win-curve.mjs` does NOT run as
// committed: it imports from `~/projects/mistboard-champions-replay` (a worktree
// that no longer exists) and reads its corpus from a session-scoped scratchpad
// path that is now empty. Both halves of the 70-game evidence are gone; only
// this note survives it. Anyone re-litigating starts by re-harvesting via
// `dpxq-archive-harvest.mjs`, and should land the corpus somewhere durable
// before spending the engine time.

export type MoveJudgment = 'blunder' | 'mistake' | 'inaccuracy' | null;

const WIN_PCT_CLAMP_CP = 1000;
// lila rawWinningChances constant (chess). Recalibrate for xiangqi if evals feel
// too flat / too spiky.
export const WIN_PCT_K = 0.00368208;

// AB-JChess's centipawns are on their own scale, not Pikafish's: fitted on 400 of
// its match games (mistboard-engine lab/jieqi-abjchess-2026-09-29), p(win) =
// 1/(1+exp(-0.00985*cp)), so +112cp already reads as 75%. Same logistic form as
// lila's 2/(1+exp(-K*cp))-1 on [-1, 1] (that is 2p-1), so only K changes. Raw cp
// from two engines is never comparable; their win% on each engine's own K is.
export const ABJCHESS_WIN_PCT_K = 0.00985;

/**
 * The win-curve constant for an analysis stored under `engineId`. Every surface
 * that turns STORED engine cp into win% asks this with the engineId the analysis
 * came back with, so a game analysed by AB-JChess is drawn and graded on AB's
 * curve and an older PikaJieQi analysis on lila's. Unknown or absent ids get
 * lila's constant, which is what every engine but AB-JChess has always used.
 */
export function winPercentK(engineId: string | null | undefined): number {
  return engineId?.startsWith('ab-jchess') ? ABJCHESS_WIN_PCT_K : WIN_PCT_K;
}

/**
 * Centipawns / mate (from ONE side's POV) -> that side's win probability in
 * [0, 100]. A mate maps through lila's mate->cp ladder ((21 - min(10, N)) * 100,
 * so mate-in-1 reads as 2000cp and a distant mate as 1100cp) rather than
 * short-circuiting to certainty: swings between mate distances still register.
 * `k` is the engine's curve constant (winPercentK); the default is lila's.
 */
export function winPercent(cp: number | null, mate: number | null, k: number = WIN_PCT_K): number {
  if (mate != null) {
    const mateCp = (21 - Math.min(10, Math.abs(mate))) * 100;
    return logisticWinPercent(mate > 0 ? mateCp : -mateCp, k);
  }
  if (cp == null) return 50;
  return logisticWinPercent(Math.max(-WIN_PCT_CLAMP_CP, Math.min(WIN_PCT_CLAMP_CP, cp)), k);
}

function logisticWinPercent(cp: number, k: number): number {
  const chances = 2 / (1 + Math.exp(-k * cp)) - 1; // [-1, 1]
  return 50 + 50 * chances;
}

/**
 * lila's per-move accuracy, from the mover's win% before and after their move.
 * Returns [0, 100]; a move that doesn't drop win% scores 100. The +1 is lila's
 * uncertainty bonus (imperfect analysis).
 */
export function accuracyPercent(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const drop = winBefore - winAfter;
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669 + 1;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Judge a move by how many win% points the mover gave up. lila's thresholds
 * (Advice.scala: winning-chance deltas 0.1 / 0.2 / 0.3 on a [-1, 1] scale) are
 * 5 / 10 / 15 win% points.
 */
export function moveJudgment(winBefore: number, winAfter: number): MoveJudgment {
  const drop = winBefore - winAfter;
  if (drop >= 15) return 'blunder';
  if (drop >= 10) return 'mistake';
  if (drop >= 5) return 'inaccuracy';
  return null;
}

/**
 * lila's whole-game accuracy (AccuracyPercent.gameAccuracy): per move, the
 * accuracy is weighted by the local win% volatility (a sliding-window stdev,
 * squeezed to [0.5, 12]) so forced sequences count less; the player's accuracy
 * is the mean of that volatility-weighted mean and the harmonic mean (the
 * harmonic mean is what makes a single blunder actually hurt).
 *
 * `winPercents` is the win% (first mover's POV) of every position 0..N in
 * order — one more entry than there are moves. The first mover owns the even
 * transitions (0->1, 2->3, ...). Returns 0 for a side with no moves.
 */
// `overrideAccuracyByPly` (1-based ply -> value) substitutes the per-move accuracy for chance/
// hidden-info variants (jieqi/banqi/jungle-flip), where a reveal ply's realized win% swing mixes
// SKILL with LUCK. A number replaces the curve-derived sample with a LUCK-FREE one (the decision's
// pool-mean accuracy, so the choice is graded and the dice are not); `null` drops the ply entirely
// (a reveal we couldn't decompose). Plies absent from the map derive from the curve as usual, so
// deterministic variants (no map) are unchanged. The volatility windows still span the full curve
// (a reveal is real local volatility); only each move's accuracy value is overridden.
export function gameAccuracy(
  winPercents: number[],
  overrideAccuracyByPly?: ReadonlyMap<number, number | null>,
): { first: number; second: number } {
  const moves = winPercents.length - 1;
  if (moves < 1) return { first: 0, second: 0 };

  // One volatility window per move: left-pad with the opening window so early
  // moves reuse the first window's stdev (lila's List.fill prefix).
  const windowSize = Math.max(2, Math.min(8, Math.floor(moves / 10)));
  const windows: number[][] = [];
  const padCount = Math.min(windowSize, winPercents.length) - 2;
  const firstWindow = winPercents.slice(0, windowSize);
  for (let i = 0; i < padCount; i += 1) windows.push(firstWindow);
  if (winPercents.length <= windowSize) {
    windows.push([...winPercents]);
  } else {
    for (let i = 0; i + windowSize <= winPercents.length; i += 1) {
      windows.push(winPercents.slice(i, i + windowSize));
    }
  }
  const weights = windows.map((window) => Math.max(0.5, Math.min(12, standardDeviation(window))));

  const samples: Record<'first' | 'second', Array<{ accuracy: number; weight: number }>> = {
    first: [],
    second: [],
  };
  for (let i = 0; i < moves; i += 1) {
    // Move index i produces ply i+1.
    const mover: 'first' | 'second' = i % 2 === 0 ? 'first' : 'second';
    const weight = weights[i] ?? 1;
    const override = overrideAccuracyByPly?.get(i + 1);
    if (override !== undefined) {
      // A reveal ply: use the luck-free decision accuracy (number), or drop it (null).
      if (override === null) continue;
      samples[mover].push({ accuracy: override, weight });
      continue;
    }
    const prev = winPercents[i]!;
    const next = winPercents[i + 1]!;
    const before = mover === 'first' ? prev : 100 - prev;
    const after = mover === 'first' ? next : 100 - next;
    samples[mover].push({ accuracy: accuracyPercent(before, after), weight });
  }

  const sideAccuracy = (side: 'first' | 'second'): number => {
    const list = samples[side];
    // No gradeable moves (e.g. every move this side made was an excluded reveal) → no errors to
    // count, so treat as 100% rather than a misleading 0%.
    if (list.length === 0) return 100;
    const weightSum = list.reduce((sum, s) => sum + s.weight, 0);
    const weighted =
      weightSum > 0
        ? list.reduce((sum, s) => sum + s.accuracy * s.weight, 0) / weightSum
        : list.reduce((sum, s) => sum + s.accuracy, 0) / list.length;
    // 1/0 -> Infinity -> harmonic 0: a total blunder floors the harmonic mean.
    const invSum = list.reduce((sum, s) => sum + 1 / s.accuracy, 0);
    const harmonic = list.length / invSum;
    return (weighted + harmonic) / 2;
  };

  return { first: sideAccuracy('first'), second: sideAccuracy('second') };
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
