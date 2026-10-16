// Standard-xiangqi (open / perfect-info) adapter for the shared GameTree spine.
// Every hook is a one-liner over the existing `@mistboard/game` kernel — the same
// functions xiangqi-review-model.ts already uses to replay a move list. This is
// the first concrete VariantTreeAdapter and the proof that open variants need no
// new rules code to ride the tree: Truth = XiangqiGameState, View =
// StandardXiangqiPlayerView, and `project` returns a single truth view (length 1).
// The fog counterpart (dark xiangqi) will share every hook except `project`,
// which returns the truth + per-POV triptych (length 3).

import {
  ARBITER_ADJUDICATED_DRAWS,
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  formatXiangqiMove,
  fsfUciToXiangqiSquares,
  getStandardXiangqiPlayerView,
  isStandardXiangqiLegalMove,
  type StandardXiangqiPlayerView,
  type XiangqiGameState,
  type XiangqiMove,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { currentXiangqiNotationStyle } from '../xiangqi-notation.js';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

export const xiangqiTreeAdapter: VariantTreeAdapter<
  XiangqiMove,
  XiangqiGameState,
  StandardXiangqiPlayerView
> = {
  mode: 'perfect-info',
  initialTruth: () => createInitialXiangqiState('analysis'),
  isLegal: (truth, move) =>
    truth.status.type === 'playing' && isStandardXiangqiLegalMove(truth, move),
  applyMove: (truth, move) => applyStandardXiangqiMove(truth, move),
  project: (truth): ProjectedView<StandardXiangqiPlayerView>[] => [
    {
      key: 'truth',
      label: 'Board',
      tier: 'primary',
      // Open information → the "player view" is the full truth; perspective is
      // applied by the board renderer (orientation), not here. Project for the
      // SIDE TO MOVE: the view's legalMoves are only populated for the projected
      // color, and the review board plays both sides (a fixed 'red' projection
      // left black with no legal moves, rejecting every move at odd plies).
      view: getStandardXiangqiPlayerView(
        truth,
        truth.status.type === 'playing' ? truth.status.turn : 'red',
      ),
    },
  ],
  // Rendered in the user's notation display mode (settings gear). Labels are
  // cached at node creation; tree-review relabels on the notation-changed
  // event. The formatter falls back to `from-to` for anything it cannot name
  // (and 'coordinate', the default, IS from-to).
  moveLabel: (move, parentTruth) =>
    formatXiangqiMove(parentTruth, move, currentXiangqiNotationStyle()),
  // FSF xiangqi UCI is 1-indexed = our square notation, so the engine key and the
  // sibling-dedup NodeId are the same canonical string.
  moveKey: (move) => xiangqiMoveToFsfUci(move),
  toEngineUci: (move) => xiangqiMoveToFsfUci(move),
  // Inverse of moveKey/toEngineUci: our square notation IS FSF xiangqi UCI, so a
  // token splits straight back into { from, to }. parentTruth is unused (coordinate
  // moves need no disambiguation); an off-position token is rejected by addMove on
  // rebuild, not here. Returns null for a token that isn't two valid squares.
  fromUci: (uci) => fsfUciToXiangqiSquares(uci),
};

/**
 * A played record runs past the two draws an arbiter decides (repetition and
 * the progress clock): they are claimed or called, never automatic, so a
 * tournament game can go on for dozens of plies after our kernel would have
 * stopped it. 2026 league round 6 board 7 hit the kernel's threefold at ply 199
 * and Red won at ply 211; the review showed a "truncated import" and a draw.
 * Checkmate and stalemate stay terminal. The side to move is the opposite of
 * whoever made the last move, read off the board.
 */
export function resumeAdjudicatedDraw(truth: XiangqiGameState): XiangqiGameState {
  if (
    truth.status.type !== 'finished' ||
    !ARBITER_ADJUDICATED_DRAWS.has(truth.status.reason) ||
    !truth.lastMove
  ) {
    return truth;
  }
  const mover = truth.board[truth.lastMove.to]?.color;
  if (!mover) return truth;
  return { ...truth, status: { type: 'playing', turn: mover === 'red' ? 'black' : 'red' } };
}

/** The adapter for a played record (a broadcast or archive game): the same
 *  hooks, resumed past an arbiter-adjudicated draw before every one. */
export const xiangqiRecordTreeAdapter: typeof xiangqiTreeAdapter = {
  ...xiangqiTreeAdapter,
  isLegal: (truth, move) => xiangqiTreeAdapter.isLegal(resumeAdjudicatedDraw(truth), move),
  applyMove: (truth, move) => applyStandardXiangqiMove(resumeAdjudicatedDraw(truth), move),
  project: (truth) => xiangqiTreeAdapter.project(resumeAdjudicatedDraw(truth)),
  moveLabel: (move, parentTruth) =>
    xiangqiTreeAdapter.moveLabel(move, resumeAdjudicatedDraw(parentTruth)),
};
