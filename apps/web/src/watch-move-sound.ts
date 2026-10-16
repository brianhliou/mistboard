// Spectator move sounds for Mistboard TV, per variant.
//
// A spectator hears what the MOVER heard: each function hands the variant's own
// live-room classifier (soundForOwn*Move, the same code that sounds a seated
// player's move) the board as it stood before the move, read from the mover's
// side, and the move the next view says was played. There is no second policy
// here, only the spectator framing:
//
//  - Only the mover's cues exist (move, capture, cannon-capture, king-capture,
//    flip, blast, drop). The victim's `captured` and the win/lose jingles are
//    seat-relative and never come out of these functions; game end is one
//    neutral tone, owned by watch-sound.ts.
//  - Both views are the ones the spectator's board is drawing (the tenant passes
//    the pane's own track), so a cue can only say what that board already shows.
//    A live jieqi payload carries the masked track and nothing else; a face-down
//    mover is not a cannon to this classifier even if it turns out to be one.
//
// `prev` is the view at ply N-1, `next` the view at ply N. A missing move (a
// payload without lastMove) is a plain move rather than silence: the ply did
// advance.

import type {
  AtomicXiangqiPlayerView,
  BanqiPlayerView,
  CrazyhouseXiangqiPlayerView,
  FortressXiangqiPlayerView,
  JieqiPlayerView,
  JungleFlipPlayerView,
  JunglePlayerView,
  StandardXiangqiPlayerView,
  XiangqiColor,
} from '@mistboard/game';
import { soundForOwnAtomicXiangqiMove } from './live-atomic-xiangqi-sound.js';
import { soundForOwnBanqiMove } from './live-banqi-sound.js';
import { soundForOwnCrazyhouseXiangqiMove } from './live-crazyhouse-xiangqi-sound.js';
import type { DarkXiangqiWireView } from './live-dark-xiangqi.js';
import { soundForOwnDarkXiangqiMove } from './live-dark-xiangqi-sound.js';
import { soundForOwnFortressXiangqiMove } from './live-fortress-xiangqi-sound.js';
import { soundForOwnJieqiMove } from './live-jieqi-sound.js';
import { soundForOwnJungleFlipMove } from './live-jungle-flip-sound.js';
import { soundForOwnJungleMove } from './live-jungle-sound.js';
import type { SoundKind } from './live-state.js';
import { soundForOwnXiangqiMove, type XiangqiSoundView } from './live-xiangqi-sound.js';

// The side that just moved, read off the PRE-move status (whose turn it was).
// Falls back to the view's own perspective, which is what the classifiers
// already assume for a seated player.
function moverColor<C extends string>(prev: {
  perspective: C;
  status: { type: string; turn?: C };
}): C {
  return prev.status.type === 'playing' && prev.status.turn ? prev.status.turn : prev.perspective;
}

export function watchXiangqiMoveSound(
  prev: StandardXiangqiPlayerView,
  next: StandardXiangqiPlayerView,
): SoundKind {
  if (!next.lastMove) return 'move';
  return soundForOwnXiangqiMove(prev as XiangqiSoundView, next.lastMove);
}

export function watchAtomicXiangqiMoveSound(
  prev: AtomicXiangqiPlayerView,
  next: AtomicXiangqiPlayerView,
): SoundKind {
  if (!next.lastMove) return 'move';
  return soundForOwnAtomicXiangqiMove(
    prev as unknown as Parameters<typeof soundForOwnAtomicXiangqiMove>[0],
    next.lastMove,
  );
}

export function watchCrazyhouseXiangqiMoveSound(
  prev: CrazyhouseXiangqiPlayerView,
  next: CrazyhouseXiangqiPlayerView,
): SoundKind {
  if (!next.lastMove) return 'move';
  return soundForOwnCrazyhouseXiangqiMove(prev, next.lastMove);
}

export function watchFortressXiangqiMoveSound(
  prev: FortressXiangqiPlayerView,
  next: FortressXiangqiPlayerView,
): SoundKind {
  if (!next.lastMove) return 'move';
  return soundForOwnFortressXiangqiMove(prev, next.lastMove);
}

// Jieqi's classifier reads "is the target an enemy" against view.perspective,
// so the spectator's board is re-read from the mover's side. Identity still comes
// only from the masked board: a face-down mover flips, a face-down target is a
// plain capture.
export function watchJieqiMoveSound(prev: JieqiPlayerView, next: JieqiPlayerView): SoundKind {
  if (!next.lastMove) return 'move';
  return soundForOwnJieqiMove({ ...prev, perspective: moverColor(prev) }, next.lastMove);
}

export function watchBanqiMoveSound(prev: BanqiPlayerView, next: BanqiPlayerView): SoundKind {
  if (!next.lastMove) return 'move';
  return soundForOwnBanqiMove(prev, next.lastMove);
}

export function watchJungleMoveSound(prev: JunglePlayerView, next: JunglePlayerView): SoundKind {
  if (!next.lastMove) return 'move';
  return soundForOwnJungleMove(prev, next.lastMove);
}

export function watchJungleFlipMoveSound(
  prev: JungleFlipPlayerView,
  next: JungleFlipPlayerView,
): SoundKind {
  if (!next.lastMove) return 'move';
  return soundForOwnJungleFlipMove(prev, next.lastMove);
}

// Field-of-fire fog. Dark xiangqi never airs live (the live election is
// fail-closed on fog), but the classifier is wired the same way so a fogged
// pane can only ever sound what it shows: a shrouded target is a capture of
// "something", never a general.
export function watchDarkXiangqiMoveSound(
  prev: DarkXiangqiWireView,
  next: DarkXiangqiWireView,
): SoundKind {
  if (!next.lastMove) return 'move';
  const mover: XiangqiColor = moverColor(prev);
  return soundForOwnDarkXiangqiMove({ ...prev, perspective: mover }, next.lastMove);
}
