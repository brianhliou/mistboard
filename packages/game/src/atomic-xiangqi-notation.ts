// Move labels for Atomic Xiangqi, written against the ATOMIC kernel.
//
// The shared xiangqi formatter replays and marks check with the standard rules,
// which are wrong here in three ways: atomic check includes a blast beside the
// general (a chariot bearing on the advisor next to it), the game is also won
// by blowing the general up, which the standard kernel never calls mate, and
// disambiguation must count only the rivals atomic allows. So the algebraic
// label takes its body from the shared formatter with atomic's legal moves and
// its suffix from atomic's own check and win rules. The relative styles (WXF,
// Chinese) carry no check mark and read only the pre-move board, so they stay
// on the shared formatter.

import {
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  applyAtomicXiangqiMove,
  createInitialAtomicXiangqiState,
  getAtomicXiangqiLegalMoves,
  isAtomicXiangqiGeneralInCheck,
  isAtomicXiangqiLegalMove,
  oppositeAtomicXiangqiColor,
} from './variants-atomic-xiangqi.js';
import type { XiangqiGameState } from './variants-xiangqi.js';
import {
  coordinateXiangqiLabel,
  formatXiangqiMove,
  XIANGQI_ALGEBRAIC_CHECK,
  XIANGQI_ALGEBRAIC_MATE,
  type XiangqiNotationStyle,
  xiangqiAlgebraicMoveBody,
} from './xiangqi-notation-format.js';
import { xiangqiMoveToPikafishUci } from './xiangqi-uci.js';

// The atomic state is the xiangqi state with the aftermath fields added; the
// relative formatter reads only the board and the turn.
function asXiangqiState(state: AtomicXiangqiGameState): XiangqiGameState {
  return state as unknown as XiangqiGameState;
}

/**
 * One atomic move in the reader's style. Algebraic marks `#` on the move that
 * wins outright (mate, or the blast that takes the general) and `+` when the
 * opponent's general can be removed next move, by capture or by a blast.
 */
export function formatAtomicXiangqiMove(
  state: AtomicXiangqiGameState,
  move: AtomicXiangqiMove,
  style: XiangqiNotationStyle,
): string {
  if (style !== 'algebraic') return formatXiangqiMove(asXiangqiState(state), move, style);
  if (state.status.type !== 'playing' || !isAtomicXiangqiLegalMove(state, move)) {
    return coordinateXiangqiLabel(move);
  }
  const mover = state.status.turn;
  const body = xiangqiAlgebraicMoveBody(state.board, move, getAtomicXiangqiLegalMoves(state));
  if (body === null) return coordinateXiangqiLabel(move);
  const after = applyAtomicXiangqiMove(state, move);
  let suffix = '';
  if (
    after.status.type === 'finished' &&
    after.status.winner === mover &&
    (after.status.reason === 'checkmate' || after.status.reason === 'general-captured')
  ) {
    suffix = XIANGQI_ALGEBRAIC_MATE;
  } else if (isAtomicXiangqiGeneralInCheck(after.board, oppositeAtomicXiangqiColor(mover))) {
    suffix = XIANGQI_ALGEBRAIC_CHECK;
  }
  return `${body}${suffix}`;
}

/**
 * A whole atomic line from the opening, replayed through the atomic kernel.
 * From the first move that does not replay, the rest render as coordinates
 * (ICCS for the ICCS style), since the board is no longer trustworthy.
 */
export function formatAtomicXiangqiMoves(
  moves: readonly AtomicXiangqiMove[],
  style: XiangqiNotationStyle,
  startState: AtomicXiangqiGameState = createInitialAtomicXiangqiState('notation-format'),
): string[] {
  let state: AtomicXiangqiGameState | null = startState;
  return moves.map((move) => {
    if (state?.status.type === 'playing' && isAtomicXiangqiLegalMove(state, move)) {
      const label = formatAtomicXiangqiMove(state, move, style);
      state = applyAtomicXiangqiMove(state, move);
      return label;
    }
    state = null;
    return style === 'iccs' ? xiangqiMoveToPikafishUci(move) : coordinateXiangqiLabel(move);
  });
}
