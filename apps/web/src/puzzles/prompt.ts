import { XIANGQI_MATE_SEARCH_MAX_SOLVER_MOVES, XIANGQI_SPEC_ID } from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import type { PuzzleDetail } from './adapter.js';

/**
 * The neutral prompt for a puzzle: what the grader will actually accept.
 *
 * A standard-xiangqi mate puzzle accepts any move the kernel proves forces
 * mate within XIANGQI_MATE_SEARCH_MAX_SOLVER_MOVES, so "the best move" is
 * honest there: a slower mate still solves it. Past that cap the grader can
 * only compare against the stored line, which the mining gate admitted as the
 * strictly fastest mate, so the honest ask on a longer mate is the fastest one.
 * Every other variant and goal grades against the stored line alone.
 */
export function puzzlePrompt(
  puzzle: Pick<PuzzleDetail, 'variant' | 'goal' | 'solutionPlyCount'>,
): string {
  const solverMoves = Math.ceil(puzzle.solutionPlyCount / 2);
  if (
    puzzle.variant === XIANGQI_SPEC_ID &&
    puzzle.goal.type === 'checkmate' &&
    solverMoves > XIANGQI_MATE_SEARCH_MAX_SOLVER_MOVES
  ) {
    return t('puzzle.findFastestMate');
  }
  return t('puzzle.findBestMove');
}
