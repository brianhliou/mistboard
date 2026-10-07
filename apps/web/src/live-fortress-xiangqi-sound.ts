// Sound policy for Fortress Xiangqi's own-move cue.
//
// Extracted from live-fortress-xiangqi.ts so the live room and Mistboard TV hear
// one classifier: a reserve drop is a drop, a board move onto an occupied square
// is a capture (the board is open information and only enemies are capturable),
// anything else is a move.

import {
  type FortressXiangqiMove,
  type FortressXiangqiPlayerView,
  isFortressXiangqiDropMove,
} from '@mistboard/game';
import type { SoundKind } from './live-state.js';

export function soundForOwnFortressXiangqiMove(
  view: Pick<FortressXiangqiPlayerView, 'board'> | null,
  move: FortressXiangqiMove,
): SoundKind {
  if (isFortressXiangqiDropMove(move)) return 'drop';
  return view?.board[move.to] ? 'capture' : 'move';
}
