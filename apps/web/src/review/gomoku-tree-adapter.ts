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

export type GomokuReviewView = GomokuPlayerView & { placements: readonly GomokuMove[] };

/** A parsed chapter position or recorded opening is the root, never a synthetic prefix of game moves.
 * Tree ply zero therefore means zero recorded placements, even on a dealt board. */
export function makeGomokuTreeAdapter(
  root?: GomokuOpening | GomokuRoomState,
): VariantTreeAdapter<GomokuMove, GomokuRoomState, GomokuReviewView> {
  // Derived review metadata stays outside the canonical rules state. Every
  // branch owns its path, so navigation and deserialization restore numbering.
  const placements = new WeakMap<GomokuRoomState, readonly GomokuMove[]>();
  return {
    mode: 'perfect-info',
    initialTruth: () => (root && 'board' in root ? root : createGomokuRoomState('analysis', root)),
    isLegal: (truth, move) => applyGomokuRoomMove(truth, move) !== truth,
    applyMove: (truth, move) => {
      const next = applyGomokuRoomMove(truth, move);
      if (next !== truth) placements.set(next, [...(placements.get(truth) ?? []), move]);
      return next;
    },
    project: (truth) => [
      {
        key: 'truth',
        label: 'Board',
        tier: 'primary',
        view: {
          ...getGomokuPlayerView(
            truth,
            truth.status.type === 'playing' ? truth.status.turn : 'black',
          ),
          placements: placements.get(truth) ?? [],
        },
      },
    ],
    moveLabel: formatGomokuMove,
    moveKey: formatGomokuMove,
    toEngineUci: formatGomokuMove,
    fromUci: parseGomokuMove,
  };
}
