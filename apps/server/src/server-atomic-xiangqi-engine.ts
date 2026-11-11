/** Pure move helpers and historical seat identities. Native atomic play is retired. */
import {
  type AtomicXiangqiColor,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  atomicXiangqiBoardAfterMove,
} from '@mistboard/game';

// Compatibility for the retired room route, which still recognizes historical ids.
export {
  ATOMIC_XIANGQI_DEFAULT_ENGINE_ID,
  ATOMIC_XIANGQI_FSF_ENGINE_VERSION,
  atomicXiangqiEngineDisplayName,
  atomicXiangqiEngineVersion,
  isAtomicXiangqiEngineClientId,
} from './atomic-xiangqi-engine-history.js';

/** A kernel move as Fairy-Stockfish spells it: `<from><to>`, a1-i10 on both sides. */
export function atomicXiangqiMoveToUci(move: AtomicXiangqiMove): string {
  return `${move.from}${move.to}`;
}

/**
 * The general-removing move on offer, if any: a capture whose blast (or whose
 * target) is the enemy general. Read off the kernel's own `boardAfter`, so it
 * is the same test legality uses. Retained as a pure rules helper for
 * historical move validation.
 */
export function atomicXiangqiWinningMove(
  state: AtomicXiangqiGameState,
  legalMoves: readonly AtomicXiangqiMove[],
  color: AtomicXiangqiColor,
): AtomicXiangqiMove | null {
  const enemy: AtomicXiangqiColor = color === 'red' ? 'black' : 'red';
  for (const move of legalMoves) {
    if (state.board[move.to] === undefined) continue;
    const after = atomicXiangqiBoardAfterMove(state.board, move).board;
    const generalSurvives = Object.values(after).some(
      (piece) => piece.role === 'general' && piece.color === enemy,
    );
    if (!generalSurvives) return move;
  }
  return null;
}

/** Match an engine reply against the kernel's legal moves. Generated, never parsed. */
export function legalMoveForUci(
  legalMoves: readonly AtomicXiangqiMove[],
  uci: string,
): AtomicXiangqiMove | null {
  return legalMoves.find((move) => atomicXiangqiMoveToUci(move) === uci) ?? null;
}
