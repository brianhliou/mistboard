// Client side of the jieqi decision-vs-luck decomposition (Layer 2). The server does the hard
// part now: per REVEAL ply it returns three win% numbers (mover POV) — the played move's TRUE
// pool-mean EV, the best move's pool-mean EV, and the realized outcome. Here we just turn those
// into the display numbers: a DECISION-quality glyph (graded) and a LUCK value (shown per move,
// never graded). Counterpart to game-analysis.ts; kept separate as a heavier, opt-in tier.
import { accuracyPercent, type MoveJudgment, moveJudgment } from '@mistboard/game';
import { postAnalysisJob } from './analysis-job-poll.js';
import type { DecisionOverlay } from './analysis-marks.js';
import { formatJieqiBestMove } from './move-advice-text.js';

/** One reveal ply's decomposition, all win% from the MOVER's POV (mirrors the server shape). */
export type JieqiDecision = {
  ply: number;
  mover: 'red' | 'black';
  /** True pool-mean EV (win%) of the best available move — the decision ceiling. */
  bestWin: number;
  /** True pool-mean EV (win%) of the played move — the decision, before the dice. */
  playedWin: number;
  /** Win% the reveal ACTUALLY produced — the truth, including luck. */
  realizedWin: number;
  /** Rank of the played move among candidates by true baseline (1 = it WAS the best). */
  playedRank: number | null;
  /** Alternatives the server true-baselined, best first. Absent on decisions cached before
   *  the server kept them; every consumer treats that as "rank only, no list". */
  candidates?: JieqiDecisionCandidate[];
};

/** One true-baselined alternative, in the same win% units as bestWin. */
export type JieqiDecisionCandidate = {
  /** Engine UCI of the candidate's root move. */
  move: string;
  /** True pool-mean EV (win%) of this move, mover POV — luck stripped. */
  win: number;
  /** True when this is the move actually played. */
  played?: boolean;
};

export type JieqiDecisionsResponse = {
  engineId: string;
  depth: number;
  decisions: JieqiDecision[];
};

// No deadband, deliberately. A noise-floor guard set to 5 win points used to stand
// in front of moveJudgment; it could never change an outcome, because moveJudgment
// already returns null below its own 5-point inaccuracy bar. The bar IS the floor.
//
// Its premise was wrong too. It read the tight clustering of chance-ply values as
// engine noise; measured 2026-09-05 over 204 chance plies, this variant's
// chance plies and its quiet plies sit on the same scale (p90 ratio 1.14, 95% CI
// [0.71, 1.71] — contains 1.0, excludes 2.0). Averaging over hidden state does
// compress the scale, but only in proportion to how much of it there is: fog chess
// averages across millions of board worlds and did need a correction (a scale
// factor, not a deadband), where one reveal draws from the mover's own remaining
// face-down pieces.
// Depth: memory corpus, chance_variant_judgment_bars_calibrated.

/** A reveal ply's derived, display-ready view. `luck` and `decisionLoss` are win% (points). */
export type DecisionView = {
  ply: number;
  mover: 'red' | 'black';
  /** Decision-quality glyph from the win% the CHOICE gave up (null = under the inaccuracy bar). */
  judgment: MoveJudgment;
  /** Win% the choice gave up vs the best move (>= 0). */
  decisionLoss: number;
  /** Win% the reveal swung vs its OWN pool-average expectation (signed: + lucky, - unlucky).
   *  0 = the reveal came out exactly average — "the average piece still in the bag". */
  luck: number;
  /** Per-decision accuracy in [0, 100] (lila's win%-drop curve, best -> played). */
  accuracy: number;
  playedRank: number | null;
  /** Ranked alternatives, best first, carried straight through from the server. */
  candidates?: JieqiDecisionCandidate[];
};

export function decisionView(d: JieqiDecision): DecisionView {
  const decisionLoss = Math.max(0, d.bestWin - d.playedWin);
  const judgment = moveJudgment(d.bestWin, d.playedWin);
  return {
    ply: d.ply,
    mover: d.mover,
    judgment,
    decisionLoss,
    luck: d.realizedWin - d.playedWin,
    accuracy: accuracyPercent(d.bestWin, d.playedWin),
    playedRank: d.playedRank,
    ...(d.candidates?.length ? { candidates: d.candidates } : {}),
  };
}

export type PlayerDecisionSummary = {
  /** How many reveal decisions this player made. */
  reveals: number;
  /** Mean per-decision accuracy in [0, 100] (100 when the player made no reveals). Grades only
   *  the choice, never the outcome — the only number here that could ever feed a rating. */
  decisionAccuracy: number;
};

export type JieqiDecisionSummary = {
  /** Per-reveal view keyed by ply, so the move list can look one up on navigation. */
  byPly: Map<number, DecisionView>;
  red: PlayerDecisionSummary;
  black: PlayerDecisionSummary;
};

export function summarizeDecisions(decisions: readonly JieqiDecision[]): JieqiDecisionSummary {
  const views = decisions.map(decisionView);
  const byPly = new Map(views.map((view) => [view.ply, view]));
  const summarize = (mover: 'red' | 'black'): PlayerDecisionSummary => {
    const mine = views.filter((view) => view.mover === mover);
    return {
      reveals: mine.length,
      decisionAccuracy: mine.length ? mean(mine.map((v) => v.accuracy)) : 100,
    };
  };
  return { byPly, red: summarize('red'), black: summarize('black') };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, v) => a + v, 0) / values.length;
}

// The decisions endpoint mirrors the analysis one: GET reads only the cache (204 = not computed
// yet, INCLUDING when the basic analysis it rides alongside isn't cached), POST computes (gated).
function decisionsUrl(roomId: string): string {
  return new URL(`/api/jieqi/games/${encodeURIComponent(roomId)}/decisions`, window.location.href)
    .pathname;
}

/** GET the already-cached decomposition, or null on a miss (204). Never triggers a compute. */
export async function fetchCachedJieqiDecisions(
  roomId: string,
): Promise<JieqiDecisionSummary | null> {
  const response = await fetch(decisionsUrl(roomId), { method: 'GET' });
  if (response.status === 204 || !response.ok) return null;
  return summarizeDecisions(((await response.json()) as JieqiDecisionsResponse).decisions);
}

/** POST to compute the decomposition (account-gated on the server), then summarize it.
 *  A cached game answers immediately (200); otherwise the server enqueues a background
 *  job (202) and this polls it to completion (see analysis-job-poll). */
export async function requestJieqiDecisions(roomId: string): Promise<JieqiDecisionSummary> {
  const body = await postAnalysisJob<JieqiDecisionsResponse>(decisionsUrl(roomId), {
    errorPrefix: 'decisions_request_failed',
  });
  return summarizeDecisions(body.decisions);
}

/** Adapt the jieqi decomposition summary to the review's variant-agnostic overlay shape.
 *  Shared by the postgame review and the game embed so the two name, rank and draw a
 *  reveal's alternatives identically. */
export function jieqiDecisionOverlay(summary: JieqiDecisionSummary): DecisionOverlay {
  return {
    byPly: new Map(
      [...summary.byPly].map(([ply, view]) => [
        ply,
        {
          judgment: view.judgment,
          accuracy: view.accuracy,
          luck: view.luck,
          playedRank: view.playedRank,
          // Format at the variant seam: the review layer is variant-agnostic and never
          // shows engine UCI. Same formatter the "… was best." advice line uses. The raw
          // move rides along only for drawing the arrow.
          ...(view.candidates?.length
            ? {
                candidates: view.candidates.map((candidate) => ({
                  label: formatJieqiBestMove(candidate.move),
                  win: candidate.win,
                  uci: candidate.move,
                  ...(candidate.played ? { played: true } : {}),
                })),
              }
            : {}),
        },
      ]),
    ),
    red: { reveals: summary.red.reveals, decisionAccuracy: summary.red.decisionAccuracy },
    black: { reveals: summary.black.reveals, decisionAccuracy: summary.black.decisionAccuracy },
  };
}
