// Mistboard TV sound: when a live game on /watch makes a sound.
//
// Policy (watch-route.ts drives it):
//  - Only live forward progress sounds: the followed game advancing by one ply
//    between polls, or by two (the poll is 4 s and a bot answers in well under
//    that, so a move and its reply routinely land in one frame; both sound, a
//    beat apart). A seed (first frame, a new featured game), a jump of more
//    plies (a hidden tab catching up), and every scrub or replay step stay
//    silent. Finished games are silent.
//  - The cue is the mover's own-move sound for that ply (watch-move-sound.ts via
//    the handle's moveSoundAtPly). When the followed game finishes, one neutral
//    end tone, once per game.
//  - There is no TV-specific switch: sound follows the site's own setting
//    (volume and Silent in the settings menu), through the shared controller,
//    which also stays silent until a gesture anywhere on the page unlocks audio
//    (browser autoplay policy), exactly as in the live rooms.

import { playSound } from './live-sound.js';
import type { SoundKind } from './live-state.js';

// The beat between a game's final move and the end tone.
export const WATCH_END_TONE_DELAY_MS = 450;

// The beat between a move and its reply when one live frame carries both.
export const WATCH_PAIR_GAP_MS = 300;

// The cues for a live frame that moved the followed game from `previousPly` to
// `nextPly`: one per new ply when the frame carries one or two, else nothing.
// `previousPly` null means "just seeded" (first frame, a new game), which never
// sounds. `soundAt` is the handle's moveSoundAtPly.
export function watchLiveMoveSoundPlan(
  previousPly: number | null,
  nextPly: number,
  soundAt: (ply: number) => SoundKind | null | undefined,
): Array<{ kind: SoundKind; delayMs: number }> {
  if (previousPly === null) return [];
  const delta = nextPly - previousPly;
  if (delta === 1) return [{ kind: soundAt(nextPly) ?? 'move', delayMs: 0 }];
  if (delta === 2) {
    return [
      { kind: soundAt(nextPly - 1) ?? 'move', delayMs: 0 },
      { kind: soundAt(nextPly) ?? 'move', delayMs: WATCH_PAIR_GAP_MS },
    ];
  }
  return [];
}

// What to play when the followed live game turns out to have finished. The last
// move is never served live (the payload stops once the game ends), so when the
// finished record is one or two plies past the last live frame, those moves
// sound first, under the same rule as a live frame. Then one neutral end
// tone: no win or lose framing for a spectator. A king capture is its own
// fanfare, as in the room (terminalSoundPlan), so it takes the tone's place.
export function watchLiveEndSoundPlan(
  lastLivePly: number | null,
  finalPly: number | null,
  soundAt: (ply: number) => SoundKind | null | undefined,
): Array<{ kind: SoundKind; delayMs: number }> {
  const moves = finalPly === null ? [] : watchLiveMoveSoundPlan(lastLivePly, finalPly, soundAt);
  const last = moves.at(-1);
  if (!last) return [{ kind: 'draw', delayMs: 0 }];
  if (last.kind === 'king-capture') return moves;
  return [...moves, { kind: 'draw', delayMs: last.delayMs + WATCH_END_TONE_DELAY_MS }];
}

export function playWatchSoundPlan(
  plan: ReadonlyArray<{ kind: SoundKind; delayMs: number }>,
): void {
  for (const step of plan) {
    if (step.delayMs > 0) window.setTimeout(() => playSound(step.kind), step.delayMs);
    else playSound(step.kind);
  }
}
