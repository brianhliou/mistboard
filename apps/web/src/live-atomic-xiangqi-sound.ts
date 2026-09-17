// Sound policy for Atomic Xiangqi: standard xiangqi's, with the explosion.
//
// Every capture but a cannon's takes the pieces beside the target with it, so
// the ordinary capture sound is the blast, for the mover and for the side it
// was done to alike (an explosion is not quieter from the other side of the
// board). The cannon's shot keeps its slam, the one capture that does not
// explode, and the general's fall keeps the terminal king-capture cue. The
// opponent classifier reads the view's own aftermath rather than diffing piece
// counts: a blast that cleared only the mover's own neighbours changes nothing
// on our side of the count and is still an explosion.

import type { AtomicXiangqiBlastVictim, XiangqiMove } from '@mistboard/game';
import type { SoundKind } from './live-state.js';
import {
  classifyXiangqiOpponentSound,
  maybePlayXiangqiSnapshotSound,
  soundForOwnXiangqiMove,
  type XiangqiSeatOrSpectator,
  type XiangqiSoundView,
} from './live-xiangqi-sound.js';

type AtomicXiangqiSoundView = XiangqiSoundView & {
  lastBlast: readonly AtomicXiangqiBlastVictim[];
};

export function soundForOwnAtomicXiangqiMove(
  view: AtomicXiangqiSoundView | null,
  move: XiangqiMove,
): SoundKind {
  const kind = soundForOwnXiangqiMove(view, move);
  return kind === 'capture' ? 'blast' : kind;
}

export function classifyAtomicXiangqiOpponentSound(
  prev: AtomicXiangqiSoundView | null,
  next: AtomicXiangqiSoundView | null,
  seat: XiangqiSeatOrSpectator,
): SoundKind | null {
  const kind = classifyXiangqiOpponentSound(prev, next, seat);
  if (kind === null) return null;
  return next && next.lastBlast.length > 0 ? 'blast' : kind;
}

export function maybePlayAtomicXiangqiSnapshotSound(
  view: AtomicXiangqiSoundView | null,
  seat: XiangqiSeatOrSpectator,
): void {
  maybePlayXiangqiSnapshotSound(view, seat, (prev, next, s) =>
    classifyAtomicXiangqiOpponentSound(
      prev as AtomicXiangqiSoundView | null,
      next as AtomicXiangqiSoundView | null,
      s,
    ),
  );
}
