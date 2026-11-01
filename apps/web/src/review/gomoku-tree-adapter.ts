import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  formatGomokuMove,
  type GomokuMove,
  type GomokuOpening,
  type GomokuPlayerView,
  type GomokuRoomState,
  getGomokuPlayerView,
  parseGomokuMove,
} from '@mistboard/game';
import type { VariantTreeAdapter } from './game-tree.js';

/** The recorded opening is the root, never a synthetic prefix of game moves.
 * Tree ply zero therefore means zero recorded placements, even on a dealt board. */
export function makeGomokuTreeAdapter(
  opening?: GomokuOpening,
): VariantTreeAdapter<GomokuMove, GomokuRoomState, GomokuPlayerView> {
  return {
    mode: 'perfect-info',
    initialTruth: () => createGomokuRoomState('analysis', opening),
    isLegal: (truth, move) => applyGomokuRoomMove(truth, move) !== truth,
    applyMove: applyGomokuRoomMove,
    project: (truth) => [
      {
        key: 'truth',
        label: 'Board',
        tier: 'primary',
        view: getGomokuPlayerView(
          truth,
          truth.status.type === 'playing' ? truth.status.turn : 'black',
        ),
      },
    ],
    moveLabel: formatGomokuMove,
    moveKey: formatGomokuMove,
    toEngineUci: formatGomokuMove,
    fromUci: parseGomokuMove,
  };
}
