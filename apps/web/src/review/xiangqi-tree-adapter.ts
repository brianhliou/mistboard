// Standard-xiangqi (open / perfect-info) adapter for the shared GameTree spine.
// Every hook is a one-liner over the existing `@mistboard/game` kernel — the same
// functions xiangqi-review-model.ts already uses to replay a move list. This is
// the first concrete VariantTreeAdapter and the proof that open variants need no
// new rules code to ride the tree: Truth = XiangqiGameState, View =
// StandardXiangqiPlayerView, and `project` returns a single truth view (length 1).
// The fog counterpart (dark xiangqi) will share every hook except `project`,
// which returns the truth + per-POV triptych (length 3).

import {
  applyStandardXiangqiMove,
  applyXiangqiRecordMove,
  createInitialXiangqiState,
  formatXiangqiMove,
  fsfUciToXiangqiSquares,
  getStandardXiangqiPlayerView,
  isStandardXiangqiLegalMove,
  resumeAdjudicatedDraw,
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

export { resumeAdjudicatedDraw } from '@mistboard/game';

/** The adapter for a played record (a broadcast or archive game): the same
 *  hooks, resumed past an arbiter-adjudicated draw before every one. */
export const xiangqiRecordTreeAdapter: typeof xiangqiTreeAdapter = {
  ...xiangqiTreeAdapter,
  isLegal: (truth, move) => xiangqiTreeAdapter.isLegal(resumeAdjudicatedDraw(truth), move),
  applyMove: (truth, move) => applyXiangqiRecordMove(truth, move),
  project: (truth) => xiangqiTreeAdapter.project(resumeAdjudicatedDraw(truth)),
  moveLabel: (move, parentTruth) =>
    xiangqiTreeAdapter.moveLabel(move, resumeAdjudicatedDraw(parentTruth)),
};
