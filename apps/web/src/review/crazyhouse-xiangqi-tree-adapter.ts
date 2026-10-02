// Crazyhouse Xiangqi adapter for the shared GameTree spine. Perfect
// information (the board and both hands are public), so like the fortress and
// atomic adapters `project` returns a single truth view and the client
// rebuilds every position, drops included, from the move list through the
// kernel. The node key is the kernel's UCI spelling, which is Fairy-Stockfish's
// for this variant (board `a1a2`, drop `P@e5`).

import {
  applyCrazyhouseXiangqiMove,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  crazyhouseXiangqiMoveFromUci,
  crazyhouseXiangqiMoveToUci,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiLegalMove,
} from '@mistboard/game';
import { crazyhouseXiangqiMoveLabel } from '../crazyhouse-xiangqi-view.js';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

export const crazyhouseXiangqiTreeAdapter: VariantTreeAdapter<
  CrazyhouseXiangqiMove,
  CrazyhouseXiangqiGameState,
  CrazyhouseXiangqiPlayerView
> = {
  mode: 'perfect-info',
  initialTruth: () => createInitialCrazyhouseXiangqiState('analysis'),
  isLegal: (truth, move) =>
    truth.status.type === 'playing' && isCrazyhouseXiangqiLegalMove(truth, move),
  // applyCrazyhouseXiangqiMove THROWS on an illegal move. The tree only calls
  // this after isLegal, so the throw is unreachable by construction.
  applyMove: (truth, move) => applyCrazyhouseXiangqiMove(truth, move),
  project: (truth): ProjectedView<CrazyhouseXiangqiPlayerView>[] => [
    {
      key: 'truth',
      label: 'Board',
      tier: 'primary',
      // Project for the side to move: the review board plays both sides, and
      // the view's legal moves and check flag are the mover's.
      view: getCrazyhouseXiangqiPlayerView(
        truth,
        truth.status.type === 'playing' ? truth.status.turn : 'red',
      ),
    },
  ],
  // The live room's notation, so the review's move list reads like the game's.
  moveLabel: (move) => crazyhouseXiangqiMoveLabel(move),
  moveKey: (move) => crazyhouseXiangqiMoveToUci(move),
  toEngineUci: (move) => crazyhouseXiangqiMoveToUci(move),
  fromUci: (uci) => crazyhouseXiangqiMoveFromUci(uci),
};
