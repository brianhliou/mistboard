// Pure search-evidence checks shared by the native miner and packet publisher.
import type { XiangqiPuzzleSolverJudgment } from './puzzles-xiangqi-endpoint.js';
import {
  classifyXiangqiSolverMoveUniqueness,
  XIANGQI_SOLVER_GATE_DEFAULTS,
  type XiangqiUciScore,
  type XiangqiVerifyLine,
  xiangqiSolverMoveCoverage,
  xiangqiUciScoreToCp,
} from './puzzles-xiangqi-mining.js';
import type { XiangqiGameState, XiangqiMove } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  isStandardXiangqiLegalMove,
} from './variants-xiangqi-standard.js';
import { pikafishUciToXiangqiSquares } from './xiangqi-uci.js';
export type XiangqiScoredLine = {
  rank: number;
  score: XiangqiUciScore;
  pvUci: string[];
  depth?: number;
  nodes?: number;
};
export type XiangqiSolverPlyAnalysis = {
  lines: XiangqiScoredLine[];
  best: XiangqiVerifyLine | undefined;
  second: XiangqiVerifyLine | undefined;
  unique: boolean;
  reason: ReturnType<typeof classifyXiangqiSolverMoveUniqueness>['reason'];
  moveCoverage: ReturnType<typeof xiangqiSolverMoveCoverage>;
};
export function normalizeXiangqiSearchEvidence(
  state: XiangqiGameState,
  lines: XiangqiScoredLine[],
): XiangqiSolverPlyAnalysis {
  const moveCoverage = xiangqiSolverMoveCoverage(state);
  const convert = (line: XiangqiScoredLine | undefined): XiangqiVerifyLine | undefined => {
    if (!line) return undefined;
    const scoreCp = xiangqiUciScoreToCp(line.score);
    return scoreCp === null ? undefined : { scoreCp, mate: line.score.mate };
  };
  const normalized = lines.map(convert).filter((v): v is XiangqiVerifyLine => v !== undefined);
  const best = convert(lines[0]),
    second = convert(lines[1]);
  const verdict = classifyXiangqiSolverMoveUniqueness(best, second, XIANGQI_SOLVER_GATE_DEFAULTS, {
    lines: normalized,
    legalMoveCount: moveCoverage.legalMoveCount,
  });
  return { lines, best, second, unique: verdict.unique, reason: verdict.reason, moveCoverage };
}
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
