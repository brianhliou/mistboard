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

// Games whose game_started already fired in this browser, one list per kind.
// A page load is not a game start: a seated player who refreshes a live room,
// or comes back to it after a phone app switch, renders `playing` again on a
// fresh page with a fresh tracker, and until 2026-10-14 (#437) each of those
// counted as another start. The client cannot tell a reload's snapshot from the
// first one (a bot or quick-pair room is already `playing` when it first
// renders), so the server's game id is remembered here instead.
//
// Correspondence keeps its own key from 2026-10-02 so the games already marked
// there are not counted again. Kept short: an id that falls off the end belongs
// to a game long since started (and a finished room never re-fires a start).
const CORRESPONDENCE_STARTED_KEY = 'mistboard.correspondenceStarted';
const CORRESPONDENCE_STARTED_CAP = 50;
const LIVE_STARTED_KEY = 'mistboard.liveGameStarted';
const LIVE_STARTED_CAP = 100;

// Storage blocked: still dedupe within the page (a tracker reset re-renders the
// same room), though a reload may count the start again.
const startedInMemory = new Set<string>();

function readStartedIds(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function markStarted(key: string, cap: number, gameId: string): void {
  startedInMemory.add(`${key}:${gameId}`);
  try {
    const ids = readStartedIds(key).filter((id) => id !== gameId);
    ids.push(gameId);
    window.localStorage.setItem(key, JSON.stringify(ids.slice(-cap)));
  } catch {
    // Storage blocked: the in-memory set above is all there is.
  }
}

function hasStarted(key: string, gameId: string): boolean {
  return startedInMemory.has(`${key}:${gameId}`) || readStartedIds(key).includes(gameId);
}

export function hasTrackedCorrespondenceStart(gameId: string): boolean {
  return hasStarted(CORRESPONDENCE_STARTED_KEY, gameId);
}

export function markCorrespondenceStartTracked(gameId: string): void {
  markStarted(CORRESPONDENCE_STARTED_KEY, CORRESPONDENCE_STARTED_CAP, gameId);
}

export function hasTrackedLiveGameStart(gameId: string): boolean {
  return hasStarted(LIVE_STARTED_KEY, gameId);
}

export function markLiveGameStartTracked(gameId: string): void {
  markStarted(LIVE_STARTED_KEY, LIVE_STARTED_CAP, gameId);
}

// Tests only: forget the in-memory half so each case starts clean.
export function resetTrackedGameStartsForTests(): void {
  startedInMemory.clear();
}
