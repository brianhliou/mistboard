// Shared, bounded verification for mining and read-only corpus audits.
import type { XiangqiPuzzleGoal } from '../../packages/game/src/puzzles-xiangqi.ts';
import type { XiangqiPuzzleSolverJudgment } from '../../packages/game/src/puzzles-xiangqi-endpoint.ts';
import {
  proveXiangqiMateGoalWithRetry,
  type XiangqiMateGoalEvidence,
} from '../../packages/game/src/puzzles-xiangqi-mate.ts';
import {
  XIANGQI_SOLVER_GATE_DEFAULTS,
  type XiangqiSolverUniquenessOptions,
  xiangqiSolverLineWinRate,
} from '../../packages/game/src/puzzles-xiangqi-mining.ts';
import type { XiangqiGameState, XiangqiMove } from '../../packages/game/src/variants-xiangqi.ts';
import {
  applyStandardXiangqiMove,
  isStandardXiangqiLegalMove,
} from '../../packages/game/src/variants-xiangqi-standard.ts';
import { pikafishUciToXiangqiSquares } from '../../packages/game/src/xiangqi-uci.ts';
import {
  analyzeXiangqiSolverPly,
  type PikafishEngine,
  type XiangqiSolverPlyAnalysis,
} from './xiangqi-pikafish-uci.ts';

export const XIANGQI_PUZZLE_VERIFICATION_PROFILE = {
  version: 'cc0-25m-selective-100m-mate-goal-v3',
  baselineNodes: [5_000_000, 25_000_000],
  baselineTimeMs: [30_000, 90_000],
  escalationNodes: 100_000_000,
  escalationTimeMs: 180_000,
  boundaryMargin: 0.03,
  minimumFinalDepth: 22,
  minimumMultiPv: 3,
  hashMb: 64,
  threads: 1,
} as const;

const unknown = new Set([
  'missing-best',
  'missing-alternative',
  'invalid-score',
  'immediate-mate-alternatives-unchecked',
]);
const coordinate = (move: XiangqiMove) =>
  `${move.from[0]}${Number(move.from.slice(1)) - 1}${move.to[0]}${Number(move.to.slice(1)) - 1}`;

/** Only later turns may use the grader's immediate-mate exception. A rule
 * forfeit or a positive engine mate score is not a board-verified mate. */
export function completesXiangqiMateGoal(
  state: XiangqiGameState,
  move: XiangqiMove,
  solutionPly: number,
  goal?: XiangqiPuzzleGoal,
): boolean {
  if (
    solutionPly === 0 ||
    goal?.type !== 'checkmate' ||
    state.status.type !== 'playing' ||
    (goal.winner && goal.winner !== state.status.turn) ||
    !isStandardXiangqiLegalMove(state, move)
  )
    return false;
  const after = applyStandardXiangqiMove(state, move);
  return (
    after.status.type === 'finished' &&
    after.status.winner === state.status.turn &&
    (after.status.reason === 'checkmate' || after.status.reason === 'stalemate')
  );
}

export function judgeXiangqiSearchEvidence(
  solutionPly: number,
  stored: XiangqiMove,
  searches: readonly XiangqiSolverPlyAnalysis[],
  minimumDepth = XIANGQI_PUZZLE_VERIFICATION_PROFILE.minimumFinalDepth as number,
): XiangqiPuzzleSolverJudgment {
  const result = (verdict: XiangqiPuzzleSolverJudgment['verdict'], reason: string) => ({
    solutionPly,
    verdict,
    reason,
  });
  if (
    searches.length < 2 ||
    searches.length > 3 ||
    searches.some((s) => unknown.has(s.reason) || !s.lines.length)
  )
    return result('unresolved', 'incomplete-search-evidence');
  const deep = searches[searches.length - 1]!;
  const immediate = new Set(deep.moveCoverage.immediateWins.map(coordinate));
  const best = (s: XiangqiSolverPlyAnalysis) => s.lines[0]?.pvUci[0] ?? '';
  const equivalent = (a: string, b: string) => a === b || (immediate.has(a) && immediate.has(b));
  const allLegalWinNow = deep.moveCoverage.legalMoveCount === immediate.size;
  if (!allLegalWinNow && deep.lines.some((line) => (line.depth ?? 0) < minimumDepth))
    return result('unresolved', 'search-under-depth');
  if (!searches.every((s) => equivalent(best(s), best(deep))))
    return result('unresolved', 'best-move-unstable');
  if (!searches.every((s) => s.unique === deep.unique))
    return result('unresolved', 'separation-unstable');
  if (!deep.unique) return result('fail', deep.reason);
  if (!searches.every((s) => equivalent(best(s), coordinate(stored))))
    return result('fail', 'stored-answer-mismatch');
  return result('pass', deep.reason);
}

export function verifyXiangqiSearchPvs(
  state: XiangqiGameState,
  analysis: XiangqiSolverPlyAnalysis,
): boolean {
  for (const line of analysis.lines) {
    let current = { ...state, positionCounts: {}, progressClock: 0 };
    for (const token of line.pvUci) {
      if (current.status.type !== 'playing') break;
      const move = pikafishUciToXiangqiSquares(token);
      if (!move || !isStandardXiangqiLegalMove(current, move)) return false;
      current = applyStandardXiangqiMove(current, move);
    }
  }
  return true;
}

export function xiangqiSearchEscalationReasons(
  solutionPly: number,
  stored: XiangqiMove,
  searches: readonly XiangqiSolverPlyAnalysis[],
  gate: XiangqiSolverUniquenessOptions = XIANGQI_SOLVER_GATE_DEFAULTS,
): string[] {
  const judgment = judgeXiangqiSearchEvidence(solutionPly, stored, searches);
  const reasons =
    judgment.verdict === 'unresolved' || judgment.reason === 'stored-answer-mismatch'
      ? [judgment.reason]
      : [];
  const deep = searches[searches.length - 1];
  if (deep?.best) {
    const rate = xiangqiSolverLineWinRate(deep.best, gate.winRateK);
    const margin = XIANGQI_PUZZLE_VERIFICATION_PROFILE.boundaryMargin;
    if (Math.abs(rate - gate.winHi) <= margin) reasons.push('near-winning-floor');
    if (deep.second) {
      const second = xiangqiSolverLineWinRate(deep.second, gate.winRateK);
      if (Math.abs(rate - second - gate.minWinRateGap) <= margin)
        reasons.push('near-separation-cutoff');
      if (deep.best.mate === 1 && Math.abs(second - gate.mateInOneMaxWinRate) <= margin)
        reasons.push('near-immediate-mate-cutoff');
    }
  }
  return reasons;
}

export async function verifyXiangqiSolverTurn(
  engine: Pick<PikafishEngine, 'newGame' | 'analyzeFen'> &
    Partial<Pick<PikafishEngine, 'lastSearch' | 'hashMb'>>,
  state: XiangqiGameState,
  solutionPly: number,
  stored?: XiangqiMove,
  goal?: XiangqiPuzzleGoal,
  gate: XiangqiSolverUniquenessOptions = XIANGQI_SOLVER_GATE_DEFAULTS,
  /** Stored mate tasks derive this from their remaining solution length.
   * A miner without a stored line must first obtain a coherent engine hint. */
  mateIn?: number,
) {
  const searches: XiangqiSolverPlyAnalysis[] = [];
  const budgets: number[] = [];
  const transcripts: NonNullable<PikafishEngine['lastSearch']>[] = [];
  let mateGoalEvidence: XiangqiMateGoalEvidence | undefined;
  let mateGoalAttempts: XiangqiMateGoalEvidence[] = [];
  const proveMate = (
    bound: number,
    answer?: XiangqiMove,
    engineEscalationReasons: string[] = [],
  ) => {
    const verified = proveXiangqiMateGoalWithRetry(state, bound);
    mateGoalEvidence = verified.proof;
    mateGoalAttempts = verified.attempts;
    const proof = mateGoalEvidence;
    let judgment: XiangqiPuzzleSolverJudgment;
    if (proof.verdict === 'unresolved')
      judgment = { solutionPly, verdict: 'unresolved', reason: proof.reason };
    else if (proof.verdict !== 'unique')
      judgment = { solutionPly, verdict: 'fail', reason: proof.reason };
    else if (answer && coordinate(proof.winningMoves[0]!) !== coordinate(answer))
      judgment = { solutionPly, verdict: 'fail', reason: 'stored-answer-mismatch' };
    else judgment = { solutionPly, verdict: 'pass', reason: proof.reason };
    return {
      transcripts,
      searches,
      budgets,
      escalationReasons: [
        ...engineEscalationReasons,
        ...(mateGoalAttempts.length > 1 ? ['mate-goal-30s-retry'] : []),
      ],
      mateGoalEvidence,
      mateGoalAttempts,
      judgment,
    };
  };
  if (mateIn !== undefined && goal?.type !== 'checkmate')
    throw new Error('A mate bound requires a checkmate goal');
  if (goal?.winner && (state.status.type !== 'playing' || goal.winner !== state.status.turn))
    throw new Error('Mate goal winner does not match the solver');
  if (mateIn !== undefined && (!Number.isSafeInteger(mateIn) || mateIn < 1))
    return proveMate(mateIn, stored);
  if (stored && completesXiangqiMateGoal(state, stored, solutionPly, goal))
    return {
      mateGoalEvidence,
      mateGoalAttempts,
      transcripts,
      searches,
      budgets,
      escalationReasons: [],
      judgment: { solutionPly, verdict: 'pass' as const, reason: 'kernel-mate-goal-completed' },
    };
  if (goal?.type === 'checkmate' && mateIn !== undefined) return proveMate(mateIn, stored);
  const profile = XIANGQI_PUZZLE_VERIFICATION_PROFILE;
  if (engine.hashMb !== undefined && engine.hashMb !== profile.hashMb)
    throw new Error(`Puzzle verification requires engine hash ${profile.hashMb} MB`);
  let timeCapped = false;
  const search = async (nodes: number, movetimeMs: number) => {
    const result = await analyzeXiangqiSolverPly(
      engine,
      state,
      { nodes, movetimeMs },
      gate,
      profile.minimumMultiPv,
    );
    if (!verifyXiangqiSearchPvs(state, result)) throw new Error('illegal-engine-pv');
    if (engine.lastSearch) {
      transcripts.push(engine.lastSearch);
      const actualNodes = Math.max(
        0,
        ...engine.lastSearch.rawInfo.map((line) => Number(/\bnodes (\d+)/.exec(line)?.[1] ?? 0)),
      );
      if (actualNodes < nodes && engine.lastSearch.elapsedMs >= movetimeMs - 1000)
        timeCapped = true;
    }
    searches.push(result);
    budgets.push(nodes);
  };
  for (const [i, nodes] of profile.baselineNodes.entries())
    await search(nodes, profile.baselineTimeMs[i]!);
  const token = searches[1]?.lines[0]?.pvUci[0];
  const answer = stored ?? (token ? pikafishUciToXiangqiSquares(token) : null);
  if (!answer)
    return {
      mateGoalEvidence,
      mateGoalAttempts,
      transcripts,
      searches,
      budgets,
      escalationReasons: ['missing-best'],
      judgment: {
        solutionPly,
        verdict: 'unresolved' as const,
        reason: 'incomplete-search-evidence',
      },
    };
  const escalationReasons = xiangqiSearchEscalationReasons(solutionPly, answer, searches, gate);
  if (timeCapped) escalationReasons.push('search-time-cap');
  if (escalationReasons.length) await search(profile.escalationNodes, profile.escalationTimeMs);
  // Mining has no stored mate bound yet. Engine scores can propose the N,
  // but admission requires an independent all-defences board proof. A general
  // winning-advantage task never acquires a mating objective from its scores.
  const inferred = searches.at(-1)?.best?.mate;
  if (
    goal?.type !== 'winning-advantage' &&
    inferred !== null &&
    inferred !== undefined &&
    inferred > 0 &&
    !timeCapped &&
    searches.every(
      (s) =>
        !unknown.has(s.reason) &&
        s.best?.mate === inferred &&
        s.lines[0]?.pvUci[0] === coordinate(answer),
    )
  )
    return proveMate(inferred, answer, escalationReasons);
  if (
    goal?.type !== 'winning-advantage' &&
    !timeCapped &&
    searches.some((s) => s.best?.mate !== null && (s.best?.mate ?? 0) > 0)
  )
    return {
      mateGoalEvidence,
      mateGoalAttempts,
      transcripts,
      searches,
      budgets,
      escalationReasons,
      judgment: { solutionPly, verdict: 'unresolved' as const, reason: 'mate-goal-bound-unstable' },
    };
  return {
    mateGoalEvidence,
    mateGoalAttempts,
    transcripts,
    searches,
    budgets,
    escalationReasons,
    judgment: timeCapped
      ? { solutionPly, verdict: 'unresolved' as const, reason: 'search-time-cap' }
      : judgeXiangqiSearchEvidence(solutionPly, answer, searches),
  };
}
