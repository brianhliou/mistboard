import { XIANGQI_SPEC_ID } from './game-specs.js';
import { standardXiangqiPuzzleMoveEquals, type XiangqiPuzzle } from './puzzles-xiangqi.js';
import type { XiangqiGameState, XiangqiMove } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  isStandardXiangqiLegalMove,
} from './variants-xiangqi-standard.js';
import { standardXiangqiPositionKey } from './xiangqi-position.js';

export type XiangqiPuzzleTransposition = {
  /** Number of stored solution plies consumed at the matching position. */
  solutionPly: number;
  /** Number of plies in the supplied alternative, including defender moves. */
  alternativePly: number;
};

/**
 * Detect whether the END of a fully supplied alternative line rejoins the
 * stored solution after their common prefix. Both lines start at puzzle.initial
 * and include both sides' moves. An unchanged prefix is not a transposition.
 * If the stored line visits the position more than once, return its first visit
 * after divergence. Illegal lines (including moves after a finish) return null.
 *
 * This is a positional detector, not a puzzle grader or a search: it compares
 * placement, side to move and terminal outcome. Clocks and repetition history
 * can differ between paths. A caller must retain the alternative's actual
 * history, revalidate any continuation and prove the required defender replies
 * before accepting an answer. In particular, a match does not prove a forced
 * win. The existing strict grader deliberately does not call this helper (#340).
 */
export function detectStandardXiangqiPuzzleTransposition(
  puzzle: XiangqiPuzzle,
  alternativeLine: readonly XiangqiMove[],
): XiangqiPuzzleTransposition | null {
  if (puzzle.variant !== XIANGQI_SPEC_ID || puzzle.initial.status.type !== 'playing') return null;
  let commonPrefixPly = 0;
  while (
    commonPrefixPly < puzzle.solution.length &&
    commonPrefixPly < alternativeLine.length &&
    standardXiangqiPuzzleMoveEquals(
      puzzle.solution[commonPrefixPly]!,
      alternativeLine[commonPrefixPly]!,
    )
  ) {
    commonPrefixPly += 1;
  }
  if (commonPrefixPly === alternativeLine.length) return null;

  const stored = replayLine(puzzle.initial, puzzle.solution);
  const alternative = replayLine(puzzle.initial, alternativeLine);
  if (!stored || !alternative) return null;
  const endpoint = alternative[alternative.length - 1]!;
  const endpointKey = positionKey(endpoint);
  for (let solutionPly = commonPrefixPly + 1; solutionPly < stored.length; solutionPly += 1) {
    if (positionKey(stored[solutionPly]!) === endpointKey) {
      return { solutionPly, alternativePly: alternativeLine.length };
    }
  }
  return null;
}

function replayLine(
  initial: XiangqiGameState,
  line: readonly XiangqiMove[],
): XiangqiGameState[] | null {
  const states = [initial];
  let state = initial;
  for (const move of line) {
    if (!isStandardXiangqiLegalMove(state, move)) return null;
    state = applyStandardXiangqiMove(state, move);
    states.push(state);
  }
  return states;
}

function positionKey(state: XiangqiGameState): string {
  const key = standardXiangqiPositionKey(state);
  const status = state.status;
  // A terminal position has no side-to-move token. Preserve its outcome so a
  // draw cannot collide with a mate (or with the same board still in play).
  if (status.type === 'finished') return `${key} ${status.winner} ${status.reason}`;
  return `${key} ${status.type}`;
}
