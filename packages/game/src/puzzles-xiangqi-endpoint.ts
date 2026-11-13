import type { XiangqiPuzzle, XiangqiPuzzleGoal } from './puzzles-xiangqi.js';
import { trimXiangqiWinningAdvantageMoves } from './puzzles-xiangqi-trim.js';
import type { XiangqiGameState, XiangqiMove } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  isStandardXiangqiGeneralInCheck,
  isStandardXiangqiLegalMove,
} from './variants-xiangqi-standard.js';

export const XIANGQI_PUZZLE_ENDPOINT_VERSION = 'tactical-endpoint-v2';
export const XIANGQI_PUZZLE_REVIEW_VERSION = 'advantage-ambiguity-review-v1';

export type XiangqiPuzzleEndpoint =
  | {
      ok: true;
      moves: XiangqiMove[];
      kind: 'terminal' | 'material-payoff' | 'defensive-key' | 'forcing-key';
    }
  | { ok: false; reason: 'invalid-line' | 'goal-incomplete' | 'no-tactical-payoff' | 'too-short' };

/** Choose an honest stopping point without changing the stated goal. A mate
 * task must finish; an advantage task stops at its last capture, a forcing
 * check, or its unique initial defence. Other quiet endpoints need review. */
export function xiangqiPuzzleSolutionEndpoint(
  initial: XiangqiGameState,
  moves: readonly XiangqiMove[],
  goal: XiangqiPuzzleGoal,
  minimumPlies = 1,
): XiangqiPuzzleEndpoint {
  if (!moves.length || moves.length % 2 !== 1 || minimumPlies < 1)
    return { ok: false, reason: 'invalid-line' };
  if (initial.status.type !== 'playing') return { ok: false, reason: 'invalid-line' };
  const solver = goal.winner ?? initial.status.turn;
  let state = initial;
  let hasCapture = false;
  for (const [ply, move] of moves.entries()) {
    if (state.status.type !== 'playing' || !isStandardXiangqiLegalMove(state, move))
      return { ok: false, reason: 'invalid-line' };
    if (ply % 2 === 0 && state.board[move.to]) hasCapture = true;
    state = applyStandardXiangqiMove(state, move);
  }
  if (state.status.type === 'finished') {
    return state.status.winner === solver &&
      (state.status.reason === 'checkmate' || state.status.reason === 'stalemate') &&
      moves.length >= minimumPlies
      ? { ok: true, moves: [...moves], kind: 'terminal' }
      : { ok: false, reason: 'goal-incomplete' };
  }
  if (state.status.type !== 'playing') return { ok: false, reason: 'invalid-line' };
  if (goal.type === 'checkmate') return { ok: false, reason: 'goal-incomplete' };
  // A checking fork can already establish the tactical win before its forced
  // capture. Its solver turns must still pass the separation gate.
  if (!hasCapture && isStandardXiangqiGeneralInCheck(state, state.status.turn)) {
    return moves.length >= minimumPlies
      ? { ok: true, moves: [...moves], kind: 'forcing-key' }
      : { ok: false, reason: 'too-short' };
  }
  const endpoint = hasCapture
    ? trimXiangqiWinningAdvantageMoves(initial, moves)
    : isStandardXiangqiGeneralInCheck(initial, solver)
      ? [moves[0] as XiangqiMove]
      : null;
  if (!endpoint) return { ok: false, reason: 'no-tactical-payoff' };
  if (endpoint.length < minimumPlies) return { ok: false, reason: 'too-short' };
  return { ok: true, moves: endpoint, kind: hasCapture ? 'material-payoff' : 'defensive-key' };
}

export type XiangqiPuzzleSolverJudgment = {
  solutionPly: number;
  verdict: 'pass' | 'fail' | 'unresolved';
  reason: string;
};

export type XiangqiPuzzleAuditDecision = {
  disposition: 'keep' | 'shorter-replacement' | 'withhold-candidate' | 'needs-review';
  reason: string;
  firstProblemPly: number | null;
  replacement?: {
    solution: XiangqiMove[];
    endpointKind: 'terminal' | 'material-payoff' | 'defensive-key' | 'forcing-key';
  };
};

/** Read-only decision planning. A replacement is a proposal for a new reviewed
 * record, never permission to rewrite the existing rated puzzle. */
export function decideXiangqiPuzzleAudit(
  puzzle: XiangqiPuzzle,
  judgments: readonly XiangqiPuzzleSolverJudgment[],
  minimumPlies = 1,
): XiangqiPuzzleAuditDecision {
  let passed = 0;
  let problem: XiangqiPuzzleSolverJudgment | undefined;
  for (const judgment of judgments) {
    if (judgment.solutionPly !== passed * 2)
      return { disposition: 'needs-review', reason: 'incomplete-evidence', firstProblemPly: null };
    if (judgment.verdict !== 'pass') {
      problem = judgment;
      break;
    }
    passed++;
  }
  if (problem?.verdict === 'unresolved')
    return {
      disposition: 'needs-review',
      reason: problem.reason,
      firstProblemPly: problem.solutionPly,
    };
  // A score comparison can reject a new single-answer candidate without
  // establishing that an existing tactical position has no teaching value.
  // Keep the admission failure and require editorial review of these roots.
  if (
    problem?.solutionPly === 0 &&
    puzzle.goal.type === 'winning-advantage' &&
    [
      'mate-not-unique',
      'runner-up-mates',
      'insufficient-separation',
      'stored-answer-mismatch',
    ].includes(problem.reason)
  )
    return { disposition: 'needs-review', reason: problem.reason, firstProblemPly: 0 };
  if (problem?.solutionPly === 0)
    return { disposition: 'withhold-candidate', reason: problem.reason, firstProblemPly: 0 };
  if (!problem && passed !== Math.ceil(puzzle.solution.length / 2))
    return { disposition: 'needs-review', reason: 'incomplete-evidence', firstProblemPly: null };
  // A capture in a verified prefix may be preparation for the real prize.
  // Never replace a full tactic with that earlier capture just because its
  // next key is below the admission cutoff. Keep the whole case for review.
  if (problem && puzzle.goal.type === 'winning-advantage') {
    const full = xiangqiPuzzleSolutionEndpoint(
      puzzle.initial,
      puzzle.solution,
      puzzle.goal,
      minimumPlies,
    );
    if (full.ok && full.moves.length >= problem.solutionPly + 1)
      return {
        disposition: 'needs-review',
        reason: 'tactical-payoff-unverified',
        firstProblemPly: problem.solutionPly,
      };
  }
  const prefix = problem ? puzzle.solution.slice(0, problem.solutionPly - 1) : puzzle.solution;
  const endpoint = xiangqiPuzzleSolutionEndpoint(puzzle.initial, prefix, puzzle.goal, minimumPlies);
  if (!endpoint.ok)
    return {
      disposition: problem ? 'withhold-candidate' : 'needs-review',
      reason: endpoint.reason,
      firstProblemPly: problem?.solutionPly ?? null,
    };
  if (!problem && endpoint.moves.length === puzzle.solution.length)
    return { disposition: 'keep', reason: 'all-solver-turns-pass', firstProblemPly: null };
  return {
    disposition: 'shorter-replacement',
    reason: problem?.reason ?? 'stop-at-payoff',
    firstProblemPly: problem?.solutionPly ?? null,
    replacement: { solution: endpoint.moves, endpointKind: endpoint.kind },
  };
}
