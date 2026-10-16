// Client side of the fog chess decision layer. The server projects Misty's own per-ply solve
// into win% (mover POV): the best available move, the played move, its rank over all root
// moves, and the ranked alternatives. Here we turn those into display numbers — a decision
// quality glyph plus the alternatives block.
//
// Fog differs from the other chance variants in one way that matters: its luck axis is
// CATEGORICAL (the belief/sample/decision verdict), not a scalar swing, so no luck number is
// emitted. See the `luck` note on DecisionMoveInfo.
//
// Counterpart to game-analysis.ts; kept separate as the opt-in tier, mirroring
// review/jieqi-decisions.ts.
import {
  accuracyPercent,
  darkChessVariant,
  type GameState,
  type Move,
  type MoveJudgment,
  moveJudgment,
  moveToAlgebraic,
} from '@mistboard/game';
import { postAnalysisJob } from './analysis-job-poll.js';
import type { DecisionOverlay } from './analysis-marks.js';

/** One ranked alternative, win% mover POV (mirrors the server shape). */
export type DarkChessDecisionCandidate = {
  move: string;
  win: number;
  played?: boolean;
};

/** One analyzed ply's decomposition, win% from the MOVER's POV. */
export type DarkChessDecision = {
  ply: number;
  mover: 'white' | 'black';
  bestWin: number;
  playedWin: number;
  playedRank: number | null;
  candidates?: DarkChessDecisionCandidate[];
  /** Fog error class: belief_lost_truth | sample_error | decision_error. */
  verdict?: string;
  beliefSize?: number;
  truthInBelief?: boolean;
  truthInSample?: boolean;
};

export type DarkChessDecisionsResponse = {
  engineId: string;
  depth: number;
  decisions: DarkChessDecision[];
};

/**
 * Fog decision losses are converted to their chess-scale equivalent before grading.
 *
 * Misty's root value is an expectation over the mover's whole belief set, and
 * averaging across worlds squeezes the moves together: an error that costs 15 win
 * points in a position you can see costs about half that once it is scored across
 * every position consistent with what you actually observed. Grading the raw number
 * with lila's bars therefore under-marks everything — 17% of plies drew any mark,
 * against 33% when the SAME moves were graded on the revealed truth, and a whole
 * game could finish with no mistake and no blunder.
 *
 * The factor is measured, not chosen. Over 224 plies of three analyzed human games,
 * each ply was scored twice — belief-relative (Misty) and truth-relative (Stockfish
 * on the revealed board, which is the scale lila fitted its bars to). Quantile
 * matching the two distributions lands lila's 5 / 10 / 15 at 2.87 / 4.66 / 6.83 fog
 * points: per-bar ratios of 1.74 / 2.15 / 2.20, mean 2.03.
 *
 * Scaling the loss rather than defining a parallel set of fog bars keeps ONE tier
 * definition in the tree: judgment and accuracy read from the same shared curve, so
 * they cannot drift apart, and a later change to the bars carries over for free.
 *
 * Worth revisiting on a wider corpus — three games and two players is thin. One
 * residual is still unmeasured: the analyzer seeds its belief sample at a fixed 7,
 * so a re-run reproduces a game bit for bit and the sample-vs-belief estimation
 * error never appears as run-to-run spread. Threading a seed through the engine's
 * scripts/analyze_job.py is what would measure it.
 */
const FOG_DECISION_SCALE = 2;

export type DecisionView = {
  ply: number;
  mover: 'white' | 'black';
  /** Decision-quality glyph from the win% the CHOICE gave up (null = fine, or within noise). */
  judgment: MoveJudgment;
  /** Win% the choice gave up vs the best move (>= 0). */
  decisionLoss: number;
  /** Per-decision accuracy in [0, 100] (lila's win%-drop curve, best -> played). */
  accuracy: number;
  /**
   * Rank of the played move over all root moves. Reported, never folded into
   * `judgment`: measured against the same 224 plies it is already implied by the
   * loss (r = +0.76, and median rank rises 2 / 6 / 10 / 17 across unjudged /
   * inaccuracy / mistake / blunder), so escalating a tier on deep rank double-counts
   * it — promoting at rank >= 8 called 46 of 224 moves blunders. It also means
   * something different in a flat position, where 14 of those plies sat past rank 10
   * while costing under 3 win points: many moves were "better" and none of it
   * mattered. Cost is the severity axis; rank is context for reading the card.
   */
  playedRank: number | null;
  candidates?: DarkChessDecisionCandidate[];
  verdict?: string;
};

// A note on `truthInSample`, because it is tempting to gate grading on it and that
// is WRONG. It records whether this solve's root draw happened to include the
// position that actually existed — a findability diagnostic, not a validity check.
// Misty plays the same way: it samples roots from a belief reaching seven figures
// and its sample usually excludes the truth too. Reasoning over a sample of
// consistent worlds IS the architecture, and the player did not have the truth
// either. "Best across 200 worlds consistent with what you observed" is a real
// statement about a decision under uncertainty. `truthInSample` earns its place
// explaining WHY a graded mistake happened (sample_error), never deciding whether
// a grade may exist. Sampling noise is absorbed by the lowest bar, which after
// scaling sits at 2.5 win points of belief-relative loss.
export function decisionView(d: DarkChessDecision): DecisionView {
  const decisionLoss = Math.max(0, d.bestWin - d.playedWin);
  // Grade on the chess-equivalent loss; report `decisionLoss` raw, because that is
  // the expected-win cost the choice really carried over the mover's belief.
  const equivalentLoss = decisionLoss * FOG_DECISION_SCALE;
  return {
    ply: d.ply,
    mover: d.mover,
    judgment: moveJudgment(equivalentLoss, 0),
    decisionLoss,
    accuracy: accuracyPercent(equivalentLoss, 0),
    playedRank: d.playedRank,
    ...(d.candidates?.length ? { candidates: d.candidates } : {}),
    ...(d.verdict ? { verdict: d.verdict } : {}),
  };
}

export type PlayerDecisionSummary = {
  /** How many decisions this player made (every analyzed ply of theirs). */
  decisions: number;
  /** Mean per-decision accuracy in [0, 100] (100 when the player made none). Grades the choice
   *  against what the mover could actually know, never against the hidden truth. */
  decisionAccuracy: number;
};

export type DarkChessDecisionSummary = {
  byPly: Map<number, DecisionView>;
  white: PlayerDecisionSummary;
  black: PlayerDecisionSummary;
};

export function summarizeDecisions(
  decisions: readonly DarkChessDecision[],
): DarkChessDecisionSummary {
  const views = decisions.map(decisionView);
  const byPly = new Map(views.map((view) => [view.ply, view]));
  const summarize = (mover: 'white' | 'black'): PlayerDecisionSummary => {
    const mine = views.filter((view) => view.mover === mover);
    return {
      decisions: mine.length,
      decisionAccuracy: mine.length ? mean(mine.map((v) => v.accuracy)) : 100,
    };
  };
  return { byPly, white: summarize('white'), black: summarize('black') };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, v) => a + v, 0) / values.length;
}

// Mirrors the analysis endpoint: GET reads only the cache (204 = the analysis it rides on has
// not been computed yet), POST computes (account-gated).
function decisionsUrl(roomId: string): string {
  return new URL(
    `/api/dark-chess/games/${encodeURIComponent(roomId)}/decisions`,
    window.location.href,
  ).pathname;
}

/** GET the already-cached decomposition, or null on a miss (204). Never triggers a compute. */
export async function fetchCachedDarkChessDecisions(
  roomId: string,
): Promise<DarkChessDecisionSummary | null> {
  const response = await fetch(decisionsUrl(roomId), { method: 'GET' });
  if (response.status === 204 || !response.ok) return null;
  return summarizeDecisions(((await response.json()) as DarkChessDecisionsResponse).decisions);
}

/** POST to compute (account-gated), then summarize. A cached game answers 200 immediately;
 *  otherwise the server enqueues a job (202) and this polls it (see analysis-job-poll). */
export async function requestDarkChessDecisions(roomId: string): Promise<DarkChessDecisionSummary> {
  const body = await postAnalysisJob<DarkChessDecisionsResponse>(decisionsUrl(roomId), {
    errorPrefix: 'decisions_request_failed',
  });
  return summarizeDecisions(body.decisions);
}

/** Board notation for a plain chess UCI move ("e2e4" -> "e2-e4", "a7a8q" -> "a7-a8=Q").
 *  Shared by the "… was best." advice line and the decisions alternatives block, so the two
 *  can never drift into different dialects on the same page. Lives here, CSS-free, so the
 *  game embed can name moves without the review surface. */
export function formatDarkChessMove(uci: string): string {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.length > 4 ? `=${uci.slice(4, 5).toUpperCase()}` : '';
  return `${from}-${to}${promo}`;
}

/**
 * Name a candidate move the way the move list does. The block used to render
 * coordinates ("c2-d2") beside a move list in SAN ("Qd2") — the same move twice,
 * in two notations, which is most of why the card was hard to read.
 *
 * Replays once to recover the position before each ply, since SAN is only defined
 * against a position. Every step degrades to the coordinate label rather than
 * throwing: Misty writes castling in standard UCI
 * ("e1g1") where this kernel offers king-onto-rook ("e1h1"), so a candidate can
 * legitimately fail to match.
 */
export function darkChessSanNamer(moves: Move[]): (ply: number, uci: string) => string {
  const before: GameState[] = [];
  try {
    let state = darkChessVariant.createInitialState('analysis');
    for (const move of moves) {
      before.push(state);
      state = darkChessVariant.applyMove(state, move);
    }
  } catch {
    // Replay diverged; every lookup below falls back to the coordinate label.
  }
  return (ply, uci) => {
    const fallback = formatDarkChessMove(uci);
    const state = before[ply - 1];
    if (!state || state.status.type !== 'playing') return fallback;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const legal = darkChessVariant.getLegalMoves(state, state.status.turn);
    const match = legal.find((candidate) => candidate.from === from && candidate.to === to);
    if (!match) return fallback;
    try {
      return moveToAlgebraic(state, match);
    } catch {
      return fallback;
    }
  };
}

// Adapt the fog decomposition to the review's variant-agnostic overlay (shared by the postgame
// review and the game embed). Two seams matter here:
// the shell keys its seats red/black (first mover first), so white's summary goes under `red`;
// and candidate moves are named in SAN, because the review layer must never see engine UCI.
// `luck` is deliberately omitted — fog's luck axis is the categorical verdict, not a signed
// swing (see DecisionMoveInfo.luck).
export function darkChessDecisionOverlay(
  summary: DarkChessDecisionSummary,
  moves: Move[],
): DecisionOverlay {
  const san = darkChessSanNamer(moves);
  return {
    byPly: new Map(
      [...summary.byPly].map(([ply, view]) => [
        ply,
        {
          judgment: view.judgment,
          accuracy: view.accuracy,
          playedRank: view.playedRank,
          // Alternatives only where the choice actually cost something. jieqi shows
          // them on every decision because its decisions ARE the reveal plies — a
          // few dozen genuine moments. Under fog every ply is a decision, so the
          // same rule drew a candidate block under all 53 moves of a 53-ply game
          // when only 7 cleared the noise deadband; the other 46 asserted a
          // distinction the analyzer had already judged to be engine noise.
          ...(view.judgment && view.candidates?.length
            ? {
                candidates: view.candidates.map((c, index) => ({
                  label: san(ply, c.move),
                  win: Math.round(c.win),
                  // The engine's OWN rank. The played move is appended to the
                  // ranked set when it missed the cut, so its row position is not
                  // its rank — showing the position told the reader a 21st-choice
                  // move was second best.
                  rank: c.played ? (view.playedRank ?? index + 1) : index + 1,
                  ...(c.played ? { played: true as const } : {}),
                })),
              }
            : {}),
        },
      ]),
    ),
    red: { reveals: summary.white.decisions, decisionAccuracy: summary.white.decisionAccuracy },
    black: { reveals: summary.black.decisions, decisionAccuracy: summary.black.decisionAccuracy },
  };
}
