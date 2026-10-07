/**
 * Who still needs the duck explained.
 *
 * The full "Now place the duck / Any empty point..." card is for a player new to
 * the variant. On every placement of every game it was noise (Brian, 2026-10-06:
 * "maybe only show it for first move or first few games"), so it shows only in
 * the first DUCK_INTRO_GAMES duck games this browser has played, and in each of
 * those only for the first DUCK_INTRO_PLACEMENTS placements. After that the cue
 * is the compact one: the seat's "to move" chip reads "place duck".
 *
 * Counted per browser, in localStorage, so it covers guests and accounts alike
 * and needs no request. A signed-in player on a new device sees the intro again
 * for a few games; that is the cheap failure and the intended trade.
 */

export const DUCK_INTRO_GAMES = 3;
export const DUCK_INTRO_PLACEMENTS = 3;

const STORAGE_KEY = 'mistboard.duckXiangqi.introGames';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readIntroGames(storage: StorageLike | null): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Record that this browser is playing `roomId`, and say whether it is one of the
 * intro games. Idempotent per room, so a reload or reconnect is not a new game.
 * Storage that throws (private mode, blocked site data) means every game is an
 * intro game: the cost is the long card, never a missing explanation.
 */
export function enterDuckGame(
  roomId: string,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const games = readIntroGames(storage);
  if (games.includes(roomId)) return true;
  if (games.length >= DUCK_INTRO_GAMES) return false;
  if (!storage) return true;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...games, roomId]));
  } catch {
    // Unwritable storage: still explain this game.
  }
  return true;
}

/**
 * The full card or the compact chip, for a placement. `placementIndex` counts
 * this game's placements from 0 (the one being asked about included).
 */
export function duckPlacementCue(opts: {
  introGame: boolean;
  placementIndex: number;
}): 'card' | 'chip' {
  return opts.introGame && opts.placementIndex < DUCK_INTRO_PLACEMENTS ? 'card' : 'chip';
}
