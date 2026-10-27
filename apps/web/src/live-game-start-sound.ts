// The game-start sound (lichess GenericNotify), shared by every live stack.
//
// It rides the board's lifecycle frame (live-lifecycle-effects.ts): the room
// sounds exactly when that frame reports 'start', which is already the one
// cross-variant definition of "this game just became playable for you": a
// seated viewer, a live position at the opening (moveNumber < 2), status
// playing, and the room ready (PvP: the opponent is connected; PvE and solo:
// from the first frame; correspondence: never). Both live stacks call it from
// their lifecycle update (live-render.ts for the chess stack, the tenant
// live-client for every other variant), so a new tenant gets the sound by
// using the tenant client, with no per-variant wiring.
//
// Correspondence stays silent, as the lifecycle frame already decides: a
// days-per-move game is not a sitting both players start together, and the
// room is opened whenever a player gets to it.
//
// Once per game per tab: a reload at the opening, or an SPA remount of the
// same room, must not sound again. sessionStorage holds the per-game flag (a
// module Set backs it when storage throws or is blocked). It plays through
// playWhenUnlocked so a cold page load, whose AudioContext is still locked
// by autoplay policy, sounds it on the first gesture instead of dropping it.
// Volume and mute apply inside the controller, like every other sound.

import type { LiveLifecycleEffect } from './live-lifecycle-effects.js';
import { playSoundWhenUnlocked } from './live-sound.js';

const STORAGE_PREFIX = 'mistboard.gameStartSounded.';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type GameStartSoundDeps = {
  play(): void;
  storage(): FlagStorage | null;
};

const soundedThisPage = new Set<string>();

const defaultDeps: GameStartSoundDeps = {
  play: () => playSoundWhenUnlocked('game-start'),
  storage: () => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  },
};

export function gameStartSoundStorageKey(gameId: string): string {
  return `${STORAGE_PREFIX}${gameId}`;
}

function alreadySounded(storage: FlagStorage | null, key: string): boolean {
  if (soundedThisPage.has(key)) return true;
  try {
    return storage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markSounded(storage: FlagStorage | null, key: string): void {
  soundedThisPage.add(key);
  try {
    storage?.setItem(key, '1');
  } catch {
    // Blocked or full storage: the page-level Set still holds the flag.
  }
}

/**
 * Plays the game-start sound when the lifecycle frame just reported 'start'
 * for this game and this tab has not sounded it yet. Returns whether it played.
 */
export function maybePlayGameStartSound(
  effect: LiveLifecycleEffect | string | null,
  gameId: string | null | undefined,
  deps: GameStartSoundDeps = defaultDeps,
): boolean {
  if (effect !== 'start' || !gameId) return false;
  const key = gameStartSoundStorageKey(gameId);
  const storage = deps.storage();
  if (alreadySounded(storage, key)) return false;
  markSounded(storage, key);
  deps.play();
  return true;
}

export function resetGameStartSoundForTests(): void {
  soundedThisPage.clear();
}
