// Atomic Xiangqi adapter for the shared GameTree spine. Perfect information on
// the standard board, so every hook is a one-liner over the atomic kernel, the
// way the standard xiangqi adapter is over its kernel. Truth =
// AtomicXiangqiGameState, View = AtomicXiangqiPlayerView (a
// StandardXiangqiPlayerView plus the check flag and the aftermath), and
// `project` returns a single truth view.
//
// The move label is the reader's notation (WXF, algebraic or coordinates),
// formatted from the PARENT position the way the xiangqi adapter does it. That
// is right here where the live room's move list is not: the formatter reads the
// board it is handed, and the parent truth is the exploded board, so a WXF label
// never names a piece the blast already removed.

import {
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  type AtomicXiangqiPlayerView,
  applyAtomicXiangqiMove,
  createInitialAtomicXiangqiState,
  formatXiangqiMove,
  fsfUciToXiangqiSquares,
  getAtomicXiangqiPlayerView,
  isAtomicXiangqiLegalMove,
  xiangqiMoveToFsfUci,
} from '@mistboard/game';
import { currentXiangqiNotationStyle } from '../xiangqi-notation.js';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

export const atomicXiangqiTreeAdapter: VariantTreeAdapter<
  AtomicXiangqiMove,
  AtomicXiangqiGameState,
  AtomicXiangqiPlayerView
> = {
  mode: 'perfect-info',
  initialTruth: () => createInitialAtomicXiangqiState('analysis'),
  isLegal: (truth, move) =>
    truth.status.type === 'playing' && isAtomicXiangqiLegalMove(truth, move),
  // applyAtomicXiangqiMove THROWS on an illegal move. The tree only calls this
  // after isLegal, so the throw is unreachable by construction; swallowing it
  // would turn a wiring bug into a wrong board.
  applyMove: (truth, move) => applyAtomicXiangqiMove(truth, move),
  project: (truth): ProjectedView<AtomicXiangqiPlayerView>[] => [
    {
      key: 'truth',
      label: 'Board',
      tier: 'primary',
      // Project for the side to move: the review board plays both sides and
      // the check flag is the mover's.
      view: getAtomicXiangqiPlayerView(
        truth,
        truth.status.type === 'playing' ? truth.status.turn : 'red',
      ),
    },
  ],
  moveLabel: (move, parentTruth) =>
    formatXiangqiMove(parentTruth, move, currentXiangqiNotationStyle()),
  // Our square notation IS Fairy-Stockfish's for this variant (a1-i10), so the
  // node key, the engine token and the study's stored UCI are one string.
  moveKey: (move) => xiangqiMoveToFsfUci(move),
  toEngineUci: (move) => xiangqiMoveToFsfUci(move),
  fromUci: (uci) => fsfUciToXiangqiSquares(uci),
};
