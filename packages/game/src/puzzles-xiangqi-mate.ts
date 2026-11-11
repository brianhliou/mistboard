// Exact, bounded board-mate objectives for offline mining and corpus review.
import type { XiangqiGameState, XiangqiMove } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
} from './variants-xiangqi-standard.js';

export const XIANGQI_MATE_GOAL_PROFILE = {
  version: 'kernel-mate-within-n-v1',
  maxNodes: 250_000,
  maxTimeMs: 3_000,
  maxPlies: 127,
} as const;

export type XiangqiMateGoalEvidence = {
  version: typeof XIANGQI_MATE_GOAL_PROFILE.version;
  mateIn: number;
  verdict: 'unique' | 'ambiguous' | 'no-mate' | 'unresolved';
  reason: string;
  /** Every returned move has a complete AND/OR proof against all defences.
   * An interrupted search never establishes that the other moves fail. */
  winningMoves: XiangqiMove[];
  legalMoveCount: number;
  complete: boolean;
  nodes: number;
};

/** Mate in N means a board checkmate (or xiangqi stalemate win) within 2N-1
 * plies against EVERY legal defence. Slower wins are outside this objective.
 * Keep the actual path's repetition/progress history: a position-only cache
 * would conflate states with different draw rights. No engine mate score or
 * repetition/perpetual-check forfeit is treated as a board-mate proof. */
export function proveXiangqiMateGoal(
  state: XiangqiGameState,
  mateIn: number,
  limits: { maxNodes?: number; maxTimeMs?: number; maxPlies?: number } = {},
): XiangqiMateGoalEvidence {
  const budget = { ...XIANGQI_MATE_GOAL_PROFILE, ...limits };
  const winningMoves: XiangqiMove[] = [];
  const result = (
    verdict: XiangqiMateGoalEvidence['verdict'],
    reason: string,
    complete: boolean,
  ): XiangqiMateGoalEvidence => ({
    version: XIANGQI_MATE_GOAL_PROFILE.version,
    mateIn,
    verdict,
    reason,
    winningMoves,
    legalMoveCount: legal.length,
    complete,
    nodes,
  });
  let nodes = 0;
  const legal = state.status.type === 'playing' ? getStandardXiangqiLegalMoves(state) : [];
  if (
    state.status.type !== 'playing' ||
    !Number.isSafeInteger(mateIn) ||
    mateIn < 1 ||
    !Number.isSafeInteger(budget.maxNodes) ||
    budget.maxNodes < 1 ||
    !Number.isFinite(budget.maxTimeMs) ||
    budget.maxTimeMs <= 0 ||
    !Number.isSafeInteger(budget.maxPlies) ||
    budget.maxPlies < 1
  )
    return result('unresolved', 'invalid-mate-goal', false);
  const plies = 2 * mateIn - 1;
  if (plies > budget.maxPlies) return result('unresolved', 'mate-goal-ply-limit', false);
  const solver = state.status.turn;
  const deadline = performance.now() + budget.maxTimeMs;
  const exhausted = new Error('mate-goal-budget-exhausted');
  function wins(current: XiangqiGameState, remaining: number): boolean {
    if (++nodes > budget.maxNodes || performance.now() >= deadline) throw exhausted;
    if (current.status.type !== 'playing')
      return (
        current.status.type === 'finished' &&
        current.status.winner === solver &&
        (current.status.reason === 'checkmate' || current.status.reason === 'stalemate')
      );
    if (remaining === 0) return false;
    const moves = getStandardXiangqiLegalMoves(current);
    // A playing state without legal moves is malformed, not a vacuous proof.
    if (!moves.length) return false;
    const continuation = (move: XiangqiMove) =>
      wins(applyStandardXiangqiMove(current, move), remaining - 1);
    return current.status.turn === solver ? moves.some(continuation) : moves.every(continuation);
  }
  try {
    for (const move of legal) {
      if (wins(applyStandardXiangqiMove(state, move), plies - 1)) winningMoves.push(move);
      // Two complete positive proofs suffice to disprove uniqueness. Do not
      // spend the rest of the budget enumerating other equivalent answers.
      if (winningMoves.length === 2) return result('ambiguous', 'multiple-within-goal', false);
    }
  } catch (error) {
    if (error !== exhausted) throw error;
    return result('unresolved', exhausted.message, false);
  }
  return winningMoves.length === 1
    ? result('unique', 'unique-within-mate-goal', true)
    : result('no-mate', 'mate-goal-not-forced', true);
}
