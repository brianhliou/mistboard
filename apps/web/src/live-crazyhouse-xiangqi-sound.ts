// Sound policy for Crazyhouse Xiangqi: standard xiangqi's, plus the drop.
//
// Extracted from live-crazyhouse-xiangqi.ts so the live room and Mistboard TV
// hear one classifier: a reserve drop sounds as a drop, every board move is
// read exactly as standard xiangqi reads it (open information, so the mover's
// and the target's roles are both on the board).

import {
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiDropMove,
} from '@mistboard/game';
import type { SoundKind } from './live-state.js';
import { soundForOwnXiangqiMove, type XiangqiSoundView } from './live-xiangqi-sound.js';

export function soundForOwnCrazyhouseXiangqiMove(
  view: CrazyhouseXiangqiPlayerView | null,
  move: CrazyhouseXiangqiMove,
): SoundKind {
  if (isCrazyhouseXiangqiDropMove(move)) return 'drop';
  return soundForOwnXiangqiMove(view as XiangqiSoundView | null, move);
}
