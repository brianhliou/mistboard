import {
  clonePuzzleState,
  isPuzzleComplete,
  type PuzzleMove,
  type PuzzleSession,
  type PuzzleState,
} from './adapter.js';
import { puzzleBoardAdapter } from './registry.js';

export function explorationState(session: PuzzleSession): PuzzleState | null {
  const line = session.exploration;
  if (!line) return null;
  const adapter = puzzleBoardAdapter(session.puzzle.variant);
  let state = clonePuzzleState(session.puzzle.initial);
  for (const move of session.playedMoves.slice(0, line.rootPly))
    state = adapter.applyMove(state, move);
  for (const move of line.moves.slice(0, line.cursor)) state = adapter.applyMove(state, move);
  return state;
}

export function exploreMove(
  session: PuzzleSession,
  move: PuzzleMove,
  displayed: PuzzleState,
): boolean {
  if (
    !isPuzzleComplete(session) ||
    session.locked ||
    session.submitting ||
    session.viewPly < 0 ||
    displayed.status.type !== 'playing'
  )
    return false;
  try {
    if (puzzleBoardAdapter(session.puzzle.variant).applyMove(displayed, move) === displayed)
      return false;
  } catch {
    return false;
  }
  const line = session.exploration ?? { rootPly: session.viewPly, moves: [], cursor: 0 };
  line.moves = [...line.moves.slice(0, line.cursor), move];
  line.cursor = line.moves.length;
  session.exploration = line;
  session.solutionPlaybackCancelled = true;
  session.selectedSquare = null;
  session.selectedDrop = null;
  session.draggingFrom = null;
  return true;
}
