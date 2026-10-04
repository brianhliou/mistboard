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
  | 'engine-offer'
  | 'home-correspondence';

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

// ── Correspondence (2026-10-03) ──────────────────────────────────────────────
// A correspondence game starts for its seek's poster days after the click that
// posted it, usually from an email, so the ten-minute session slot above cannot
// carry the source. This one lives in localStorage for as long as a public seek
// can (14 days) and is keyed to the variant, so a seek posted from the homepage
// button labels the first correspondence game of that variant that starts here.
const CORRESPONDENCE_KEY = 'mistboard.correspondenceStartSource';
const CORRESPONDENCE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

export function rememberCorrespondenceStartSource(
  source: GameStartSource,
  gameSpecId: string,
  now: number = Date.now(),
): void {
  try {
    window.localStorage.setItem(
      CORRESPONDENCE_KEY,
      JSON.stringify({ source, gameSpecId, at: now }),
    );
  } catch {
    // Storage blocked: the start is unlabeled.
  }
}

/** Read and clear the long-lived source when it matches this game's variant. */
export function takeCorrespondenceStartSource(
  gameSpecId: string | null,
  now: number = Date.now(),
): GameStartSource | 'none' {
  try {
    const raw = window.localStorage.getItem(CORRESPONDENCE_KEY);
    if (!raw) return 'none';
    const parsed = JSON.parse(raw) as {
      source?: GameStartSource;
      gameSpecId?: string;
      at?: number;
    };
    if (typeof parsed.at !== 'number' || now - parsed.at > CORRESPONDENCE_MAX_AGE_MS) {
      window.localStorage.removeItem(CORRESPONDENCE_KEY);
      return 'none';
    }
    if (!parsed.source || parsed.gameSpecId !== gameSpecId) return 'none';
    window.localStorage.removeItem(CORRESPONDENCE_KEY);
    return parsed.source;
  } catch {
    return 'none';
  }
}

// Correspondence games whose game_started already fired in this browser. Kept
// short: a player has a handful of games going, and an id that falls off the end
// belongs to a game long since started.
const STARTED_KEY = 'mistboard.correspondenceStarted';
const STARTED_CAP = 50;

function readStartedIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STARTED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function hasTrackedCorrespondenceStart(gameId: string): boolean {
  return readStartedIds().includes(gameId);
}

export function markCorrespondenceStartTracked(gameId: string): void {
  try {
    const ids = readStartedIds().filter((id) => id !== gameId);
    ids.push(gameId);
    window.localStorage.setItem(STARTED_KEY, JSON.stringify(ids.slice(-STARTED_CAP)));
  } catch {
    // Storage blocked: a reload may count the start again.
  }
}
