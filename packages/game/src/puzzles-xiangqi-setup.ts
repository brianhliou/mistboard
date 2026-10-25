// The setup move of a standard-xiangqi puzzle, with what it captured.
//
// A puzzle's `initial` is the position AFTER the opponent's setup move (the
// mined blunder), and `initial.lastMove` names that move's squares. That is
// not enough to show the board one move earlier: a capture leaves no trace of
// the piece it took. The source game knows, so the server derives the captured
// piece from it (deriveXiangqiPuzzleSetupMove) and the client rebuilds the
// pre-setup board from `initial` plus that one record
// (xiangqiPuzzlePreSetupState), letting the trainer glide the setup move in
// before the solver plays, as lichess does (#664).
//
// Both directions fail closed: any disagreement between the source game, the
// stored `initial` and the payload returns null, and the trainer keeps showing
// `initial` immediately. Standard xiangqi is open information, so the captured
// piece was on the board for both players to see; nothing hidden travels here.

import type { XiangqiPuzzle } from './puzzles-xiangqi.js';
import {
  createInitialXiangqiState,
  type XiangqiBoard,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPiece,
} from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  isStandardXiangqiLegalMove,
} from './variants-xiangqi-standard.js';

export type XiangqiPuzzleSetupMove = XiangqiMove & {
  /** The piece standing on `to` before the setup move, or null for a quiet move. */
  captured: XiangqiPiece | null;
};

function sameXiangqiBoard(left: XiangqiBoard, right: XiangqiBoard): boolean {
  const leftSquares = Object.keys(left) as (keyof XiangqiBoard)[];
  if (leftSquares.length !== Object.keys(right).length) return false;
  return leftSquares.every((square) => {
    const a = left[square];
    const b = right[square];
    return a !== undefined && b !== undefined && a.color === b.color && a.role === b.role;
  });
}

/**
 * Replay the source game's first `sourceGame.ply` moves and return the last
 * one (the setup move) with the piece it captured. Null unless every move is
 * legal from the standard opening, the last one matches `initial.lastMove`,
 * and the resulting board and side to move equal the puzzle's `initial`.
 */
export function deriveXiangqiPuzzleSetupMove(
  puzzle: Pick<XiangqiPuzzle, 'initial' | 'sourceGame'>,
  gameMoves: readonly XiangqiMove[],
): XiangqiPuzzleSetupMove | null {
  const last = puzzle.initial.lastMove;
  const ply = puzzle.sourceGame?.ply;
  if (!last || ply === undefined) return null;
  if (!Number.isInteger(ply) || ply < 1 || ply > gameMoves.length) return null;
  let state = createInitialXiangqiState('puzzle-setup');
  for (let index = 0; index < ply - 1; index += 1) {
    const move = gameMoves[index]!;
    if (!isStandardXiangqiLegalMove(state, move)) return null;
    state = applyStandardXiangqiMove(state, move);
  }
  const setup = gameMoves[ply - 1]!;
  if (setup.from !== last.from || setup.to !== last.to) return null;
  if (!isStandardXiangqiLegalMove(state, setup)) return null;
  const captured = state.board[setup.to];
  const after = applyStandardXiangqiMove(state, setup);
  if (!sameXiangqiBoard(after.board, puzzle.initial.board)) return null;
  if (
    after.status.type !== 'playing' ||
    puzzle.initial.status.type !== 'playing' ||
    after.status.turn !== puzzle.initial.status.turn
  ) {
    return null;
  }
  return {
    from: setup.from,
    to: setup.to,
    captured: captured ? { color: captured.color, role: captured.role } : null,
  };
}

/**
 * The position one ply before a puzzle's `initial`: the setup move taken back
 * and its captured piece restored. Null unless `setup` names `initial.lastMove`
 * and replaying it from the rebuilt position legally reproduces `initial`'s
 * board, so a stale or tampered payload can never paint a wrong board.
 */
export function xiangqiPuzzlePreSetupState(
  initial: XiangqiGameState,
  setup: XiangqiPuzzleSetupMove | null | undefined,
): XiangqiGameState | null {
  const last = initial.lastMove;
  if (!setup || !last || setup.from !== last.from || setup.to !== last.to) return null;
  if (initial.status.type !== 'playing') return null;
  const mover = initial.board[setup.to];
  if (!mover || mover.color === initial.status.turn) return null;
  if (initial.board[setup.from] !== undefined) return null;
  if (setup.captured && setup.captured.color !== initial.status.turn) return null;
  const board: XiangqiBoard = { ...initial.board, [setup.from]: { ...mover } };
  if (setup.captured) board[setup.to] = { ...setup.captured };
  else delete board[setup.to];
  const pre: XiangqiGameState = {
    id: initial.id,
    board,
    status: { type: 'playing', turn: mover.color },
    moveNumber: mover.color === 'black' ? Math.max(1, initial.moveNumber - 1) : initial.moveNumber,
    progressClock: 0,
    positionCounts: {},
  };
  const move: XiangqiMove = { from: setup.from, to: setup.to };
  if (!isStandardXiangqiLegalMove(pre, move)) return null;
  const replayed = applyStandardXiangqiMove(pre, move);
  if (!sameXiangqiBoard(replayed.board, initial.board)) return null;
  return pre;
}
