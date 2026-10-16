// Client side of the Flip Jungle decision-vs-luck decomposition (Layer 2). The server does the
// hard part: per FLIP ply it returns three win% numbers (mover POV) — the played flip's TRUE
// pool-mean EV, the best move's pool-mean EV, and the realized outcome. Here we just turn those
// into the display numbers: a DECISION-quality glyph (graded) and a LUCK value (shown per move,
// never graded). Mirrors review/banqi-decisions.ts; kept separate as a heavier, opt-in tier.
import { accuracyPercent, type MoveJudgment, moveJudgment } from '@mistboard/game';
import { postAnalysisJob } from './analysis-job-poll.js';
import type { DecisionOverlay } from './analysis-marks.js';

/** One flip ply's decomposition, all win% from the MOVER's (seat's) POV (mirrors the server shape). */
export type JungleFlipDecision = {
  ply: number;
  mover: 'red' | 'black';
  /** True pool-mean EV (win%) of the best available move — the decision ceiling. */
  bestWin: number;
  /** True pool-mean EV (win%) of the played flip — the decision, before the dice. */
  playedWin: number;
  /** Win% the flip ACTUALLY produced — the truth, including luck. */
  realizedWin: number;
  /** Rank of the played move among candidates by true baseline (1 = it WAS the best). */
  playedRank: number | null;
};

export type JungleFlipDecisionsResponse = {
  engineId: string;
  depth: number;
  decisions: JungleFlipDecision[];
};

// No deadband, deliberately. A noise-floor guard set to 5 win points used to stand
// in front of moveJudgment; it could never change an outcome, because moveJudgment
// already returns null below its own 5-point inaccuracy bar. The bar IS the floor.
//
// Its premise was wrong too. It read the tight clustering of chance-ply values as
// engine noise; not measured directly here (too few cached games), but
// banqi — structurally the same, one flip from a small pool scored against the
// same rank-1 candidate set — came back null on 187 chance plies. Averaging over
// hidden state does compress the scale, but only in proportion to how much of it
// there is: fog chess averages across millions of board worlds and did need a
// correction (a scale factor, not a deadband), where one flip draws from a dozen
// face-down tiles.
// Depth: memory corpus, chance_variant_judgment_bars_calibrated.

/** A flip ply's derived, display-ready view. `luck` and `decisionLoss` are win% (points). */
export type DecisionView = {
  ply: number;
  mover: 'red' | 'black';
  /** Decision-quality glyph from the win% the CHOICE gave up (null = under the inaccuracy bar). */
  judgment: MoveJudgment;
  /** Win% the choice gave up vs the best move (>= 0). */
  decisionLoss: number;
  /** Win% the flip swung vs its OWN pool-average expectation (signed: + lucky, - unlucky).
   *  0 = the flip came out exactly average — "the average tile still in the bag". */
  luck: number;
  /** Per-decision accuracy in [0, 100] (lila's win%-drop curve, best -> played). */
  accuracy: number;
  playedRank: number | null;
};

export function decisionView(d: JungleFlipDecision): DecisionView {
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
  };
}

export type PlayerDecisionSummary = {
  /** How many flip decisions this player made. */
  reveals: number;
  /** Mean per-decision accuracy in [0, 100] (100 when the player made no flips). Grades only
   *  the choice, never the outcome — the only number here that could ever feed a rating. */
  decisionAccuracy: number;
};

export type JungleFlipDecisionSummary = {
  /** Per-flip view keyed by ply, so the move list can look one up on navigation. */
  byPly: Map<number, DecisionView>;
  red: PlayerDecisionSummary;
  black: PlayerDecisionSummary;
};

export function summarizeDecisions(
  decisions: readonly JungleFlipDecision[],
): JungleFlipDecisionSummary {
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
  return new URL(
    `/api/jungle-flip/games/${encodeURIComponent(roomId)}/decisions`,
    window.location.href,
  ).pathname;
}

/** GET the already-cached decomposition, or null on a miss (204). Never triggers a compute. */
export async function fetchCachedJungleFlipDecisions(
  roomId: string,
): Promise<JungleFlipDecisionSummary | null> {
  const response = await fetch(decisionsUrl(roomId), { method: 'GET' });
  if (response.status === 204 || !response.ok) return null;
  return summarizeDecisions(((await response.json()) as JungleFlipDecisionsResponse).decisions);
}

/** POST to compute the decomposition (account-gated on the server), then summarize it.
 *  A cached game answers immediately (200); otherwise the server enqueues a background
 *  job (202) and this polls it to completion (see analysis-job-poll). */
export async function requestJungleFlipDecisions(
  roomId: string,
): Promise<JungleFlipDecisionSummary> {
  const body = await postAnalysisJob<JungleFlipDecisionsResponse>(decisionsUrl(roomId), {
    errorPrefix: 'decisions_request_failed',
  });
  return summarizeDecisions(body.decisions);
}

/** Adapt the jungle-flip decomposition summary to the review's variant-agnostic overlay shape.
 *  Shared by the postgame review and the game embed. No candidates: the server keeps only
 *  the played flip's rank, so a judged flip says the word and points at nothing. */
export function jungleFlipDecisionOverlay(summary: JungleFlipDecisionSummary): DecisionOverlay {
  return {
    byPly: new Map(
      [...summary.byPly].map(([ply, view]) => [
        ply,
        {
          judgment: view.judgment,
          accuracy: view.accuracy,
          luck: view.luck,
          playedRank: view.playedRank,
        },
      ]),
    ),
    red: { reveals: summary.red.reveals, decisionAccuracy: summary.red.decisionAccuracy },
    black: { reveals: summary.black.reveals, decisionAccuracy: summary.black.decisionAccuracy },
  };
}
