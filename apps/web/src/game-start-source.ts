// Which door a game was started from, carried across the navigation into the
// room so `game_started` can say it. A click that creates a game writes the
// source just before it navigates; the room's lifecycle tracker reads it once
// on the first `playing` transition and clears it.
//
// Without this every start looked alike: the homepage panel's one-click rows
// emitted no event at all, so their share of first games could only be
// inferred from what a session did NOT do.

export type GameStartSource =
  | 'panel-bot'
  | 'panel-play-again'
  | 'panel-waiting'
  | 'panel-person'
  | 'panel-offer'
  | 'lobby-bot'
  | 'lobby-seek'
  | 'quick-pair'
  | 'setup-dialog'
  | 'engine-offer';

const KEY = 'mistboard.gameStartSource';
// Long enough for a slow room create and a matchmaking wait to land; short
// enough that a stale value cannot label a game started later from a link.
const MAX_AGE_MS = 10 * 60 * 1_000;

export function rememberGameStartSource(source: GameStartSource, now: number = Date.now()): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ source, at: now }));
  } catch {
    // Storage blocked (private mode, sandboxed preview): the start is unlabeled.
  }
}

/** Read and clear the pending source. `'none'` covers a room link, a reload, a
 *  rematch from inside the room, or a stale value. */
export function takeGameStartSource(now: number = Date.now()): GameStartSource | 'none' {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return 'none';
    const parsed = JSON.parse(raw) as { source?: GameStartSource; at?: number };
    if (!parsed.source || typeof parsed.at !== 'number') return 'none';
    return now - parsed.at <= MAX_AGE_MS ? parsed.source : 'none';
  } catch {
    return 'none';
  }
}
