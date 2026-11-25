// Variant-neutral whole-game eval sweep. Evaluate the position after 0, 1, … N plies
// (N+1 points) with a per-variant `evaluate`, returning a Red-POV eval per ply cursor.
// The `evaluate` fn owns the engine binary, the variant config, AND the POV
// normalization (the score must already be Red POV — see evaluateXiangqiPosition /
// evaluateFortressXiangqiPosition); this helper only walks the move prefixes,
// SEQUENTIALLY, since each evaluate typically gates through a per-engine pool and a
// stampede would just queue-timeout. This is the shared spine every per-variant
// analysis route calls, including xiangqi (whose real path binds the evaluate to
// one persistent engine session per sweep — see withXiangqiAnalysisSession, #168).

import type { AnalysisProgressStore } from './game-analysis-kernel.js';

export type SweepPlyEval = {
  ply: number;
  cp: number | null;
  mate: number | null;
  best: string | null;
  /** Principal variation (engine UCI), when the evaluator reports one. */
  pv?: string[];
  /** Runner-up root move from the SAME search, when the evaluator ran MultiPV > 1
   *  (xiangqi does; the other variants report one line and omit this). Scores are
   *  in the evaluator's own POV, i.e. the same POV as `cp`/`mate` on this row. */
  second?: { move: string; cp: number | null; mate: number | null };
  /** Set when this ply's eval survived a consistency re-search still contradicting the ply
   *  after it — the number is the best the engine offered but it is not trustworthy enough to
   *  grade a move against, so the client leaves the adjacent moves unjudged. Written only by
   *  the jieqi and FFQ banqi sweeps today (reconcileJieqiSeries, reconcileFFQBanqiBounces);
   *  absent everywhere else. */
  unstable?: boolean;
};

/**
 * Raised when a completed sweep carries no evaluation at all (every ply cp+mate null).
 * That means the engine produced moves but never emitted a score — a broken/stale binary
 * that would otherwise cache as a flat, mistake-free game. Fail closed: the caller surfaces
 * "engine unavailable" and nothing is persisted, so a later fixed engine can recompute.
 * Shared by every per-variant analysis module (jungle / banqi / jungle-flip).
 */
export class VacuousAnalysisError extends Error {
  constructor(variant?: string) {
    super(variant ? `${variant}_analysis_vacuous` : 'analysis_vacuous');
    this.name = 'VacuousAnalysisError';
  }
}

/** A sweep with zero usable evals (no cp and no mate on any ply). Empty = not vacuous. */
export function isVacuousAnalysis(plies: readonly SweepPlyEval[]): boolean {
  return plies.length > 0 && plies.every((p) => p.cp == null && p.mate == null);
}

export type PositionEvaluate = (
  moves: string[],
  opts: { depth: number },
) => Promise<{
  cp: number | null;
  mate: number | null;
  best: string | null;
  pv?: string[];
  second?: { move: string; cp: number | null; mate: number | null };
}>;

/**
 * Walk the move prefixes and evaluate each. With a `progress` store the sweep
 * checkpoints after every evaluated ply and RESUMES from the last checkpoint
 * (repo rule: persist expensive output incrementally — a killed sweep loses at
 * most one in-flight eval instead of the whole pass).
 */
export async function sweepPlyEvals(
  movesUci: readonly string[],
  evaluate: PositionEvaluate,
  depth: number,
  progress?: AnalysisProgressStore<SweepPlyEval>,
): Promise<SweepPlyEval[]> {
  const resumed = progress ? await progress.load() : null;
  const evals: SweepPlyEval[] = resumed ? [...resumed.items] : [];
  for (let ply = evals.length; ply <= movesUci.length; ply += 1) {
    const evaluation = await evaluate([...movesUci.slice(0, ply)], { depth });
    evals.push({
      ply,
      cp: evaluation.cp,
      mate: evaluation.mate,
      best: evaluation.best,
      ...(evaluation.pv?.length ? { pv: evaluation.pv } : {}),
      ...(evaluation.second ? { second: evaluation.second } : {}),
    });
    if (progress) await progress.save({ nextIndex: ply + 1, items: evals });
  }
  return evals;
}
