// Exact, bounded board-mate objectives for offline mining and corpus review.
import type { XiangqiGameState, XiangqiMove } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
  isStandardXiangqiGeneralInCheck,
} from './variants-xiangqi-standard.js';

export const XIANGQI_MATE_GOAL_PROFILE = {
  version: 'kernel-mate-within-n-v2',
  moveOrdering: 'checks-captures-and-king-defences-v1',
  maxNodes: 250_000,
  maxTimeMs: 3_000,
  maxPlies: 127,
  retryMateIn: 3,
  retryMaxNodes: 5_000_000,
  retryMaxTimeMs: 30_000,
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
  limits: { maxNodes: number; maxTimeMs: number; maxPlies: number };
};

/** Mate in N means a board checkmate (or xiangqi stalemate win) within 2N-1
 * plies against EVERY legal defence. Slower wins are outside this objective.
 * Keep the actual path's repetition/progress history: a position-only cache
 * would conflate states with different draw rights. No engine mate score or
 * repetition/perpetual-check forfeit is treated as a board-mate proof. */
export type XiangqiMateProofLimits = {
  maxNodes?: number;
  maxTimeMs?: number;
  maxPlies?: number;
};

export function proveXiangqiMateGoal(
  state: XiangqiGameState,
  mateIn: number,
  limits: XiangqiMateProofLimits = {},
): XiangqiMateGoalEvidence {
  return proveMateGoal(state, mateIn, limits);
}

export type XiangqiMateMoveEvidence = Omit<
  XiangqiMateGoalEvidence,
  'version' | 'verdict' | 'winningMoves'
> & {
  version: 'kernel-mate-move-v1';
  move: XiangqiMove;
  verdict: 'proved' | 'refuted' | 'unresolved';
};

/** Prove or refute one first move against every defence. This receipt says
 * nothing about other first moves; uniqueness requires complete root coverage. */
export function proveXiangqiMateMove(
  state: XiangqiGameState,
  move: XiangqiMove,
  mateIn: number,
  limits: XiangqiMateProofLimits = {},
): XiangqiMateMoveEvidence {
  if (!move) throw new Error('A root move is required');
  const proof = proveMateGoal(state, mateIn, limits, move);
  const { winningMoves: _winningMoves, ...rest } = proof;
  return {
    ...rest,
    version: 'kernel-mate-move-v1',
    move,
    reason: proof.complete
      ? proof.verdict === 'unique'
        ? 'move-forces-mate-within-goal'
        : 'move-does-not-force-mate-within-goal'
      : proof.reason,
    verdict:
      proof.complete && proof.verdict === 'unique'
        ? 'proved'
        : proof.complete && proof.verdict === 'no-mate'
          ? 'refuted'
          : 'unresolved',
  };
}

function proveMateGoal(
  state: XiangqiGameState,
  mateIn: number,
  limits: XiangqiMateProofLimits,
  rootMove?: XiangqiMove,
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
    limits: { maxNodes: budget.maxNodes, maxTimeMs: budget.maxTimeMs, maxPlies: budget.maxPlies },
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
  const roots = rootMove
    ? legal.filter((move) => move.from === rootMove.from && move.to === rootMove.to)
    : legal;
  if (rootMove && roots.length !== 1) return result('unresolved', 'invalid-root-move', false);
  const plies = 2 * mateIn - 1;
  if (plies > budget.maxPlies) return result('unresolved', 'mate-goal-ply-limit', false);
  const solver = state.status.turn;
  const deadline = performance.now() + budget.maxTimeMs;
  const exhausted = new Error('mate-goal-budget-exhausted');
  const checkTime = () => {
    if (performance.now() >= deadline) throw exhausted;
  };
  // Ordering changes only which proof/refutation is tried first. Every legal
  // move remains available; no quiet defence or quiet mating continuation is
  // discarded. Preserve move order for ties and all root alternatives.
  const captureValue = (s: XiangqiGameState, move: XiangqiMove) => {
    const role = s.board[move.to]?.role;
    return role === 'chariot' ? 9 : role === 'cannon' || role === 'horse' ? 4 : role ? 1 : 0;
  };
  function wins(current: XiangqiGameState, remaining: number): boolean {
    if (++nodes > budget.maxNodes) throw exhausted;
    checkTime();
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
    if (current.status.turn !== solver) {
      // A defender needs only one refutation. Try captures and king flights
      // before unrelated quiet piece moves; all defences still have to pass
      // before a mating key can be proved.
      moves.sort(
        (a, b) =>
          captureValue(current, b) - captureValue(current, a) ||
          Number(current.board[b.from]?.role === 'general') -
            Number(current.board[a.from]?.role === 'general'),
      );
      return moves.every((move) => wins(applyStandardXiangqiMove(current, move), remaining - 1));
    }
    if (remaining === 1)
      return moves.some((move) => wins(applyStandardXiangqiMove(current, move), 0));
    const children = moves.map((move) => {
      checkTime();
      const after = applyStandardXiangqiMove(current, move);
      const priority =
        after.status.type === 'finished'
          ? after.status.winner === solver
            ? 3
            : 0
          : after.status.type === 'playing' &&
              isStandardXiangqiGeneralInCheck(after, after.status.turn)
            ? 2
            : current.board[move.to]
              ? 1
              : 0;
      return { after, priority, capture: captureValue(current, move) };
    });
    children.sort((a, b) => b.priority - a.priority || b.capture - a.capture);
    return children.some(({ after }) => wins(after, remaining - 1));
  }
  try {
    for (const move of roots) {
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

/** Retry only an exhausted mate-in-three proof, directly at the tested cap.
 * Keep both receipts; a failed or ambiguous proof is never retried into a pass. */
export function proveXiangqiMateGoalWithRetry(
  state: XiangqiGameState,
  mateIn: number,
  prove: typeof proveXiangqiMateGoal = proveXiangqiMateGoal,
) {
  const attempts = [prove(state, mateIn)];
  if (
    mateIn === XIANGQI_MATE_GOAL_PROFILE.retryMateIn &&
    attempts[0]!.verdict === 'unresolved' &&
    attempts[0]!.reason === 'mate-goal-budget-exhausted'
  )
    attempts.push(
      prove(state, mateIn, {
        maxNodes: XIANGQI_MATE_GOAL_PROFILE.retryMaxNodes,
        maxTimeMs: XIANGQI_MATE_GOAL_PROFILE.retryMaxTimeMs,
      }),
    );
  return { proof: attempts[attempts.length - 1]!, attempts };
}
