// Homepage chat activity rows: things that happened on the site, derived on
// read from finished games and public studies, never written into chat_lines.
// The lobby chat sat empty for six weeks at ~18 homepage visits a day while
// ~50 games finished daily (2026-10-03); these rows put that play in the box.
//
// What qualifies, newest first, within ACTIVITY_WINDOW_MS:
//   bot-win   a person (account or guest) beat a bot of level MIN_BOT_LEVEL or
//             above in a counted PvE game, so the row reads as earned (Brian,
//             2026-10-03); a bot with no level in its name (Pikafish, Misty,
//             KataGo) is a top bot and always qualifies
//   study     a public study was created
// Losses, draws and aborts never appear, and neither do PvP results: a PvP
// win names the person who lost (Brian, 2026-10-03). A bot is the only
// opponent the feed may name. A seat whose account is closed or
// private has no public handle, so its game is skipped rather than shown as a
// guest. Counted-game rules (excluded accounts, ply floor, launch date) come
// from persistence-counted-games.ts like every other aggregate.

import { crosstableReviewUrl } from './crosstable.js';
import { countedHumanGame } from './persistence-counted-games.js';
import { getPool, isInitialized } from './persistence-db.js';

export const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GAME_EVENT_LIMIT = 20;
const STUDY_EVENT_LIMIT = 3;
export const MIN_BOT_LEVEL = 4;

export type LobbyActivityEvent = {
  id: string;
  kind: 'bot-win' | 'study';
  createdAt: string;
  href: string;
  handle: string | null;
  opponent?: string;
  gameSpecId?: string;
  title?: string;
};

type GameEventRow = {
  room_id: string;
  variant: string;
  ended_at: Date;
  winner_type: string;
  winner_handle: string | null;
  loser_type: string;
  loser_name: string;
};

type StudyEventRow = {
  id: string;
  name: string;
  created_at: Date;
  owner_handle: string;
};

// The ladder level lives only in the bot seat's name ('Fairy-Stockfish Level 6',
// subject id 'pikafish-level-3'); no column stores it.
function botLevel(alias: string): string {
  return `COALESCE(
    substring(${alias}.display_name from 'Level ([0-9]+)'),
    substring(${alias}.subject_id from 'level-([0-9]+)')
  )::int`;
}

function publicHandle(alias: string): string {
  return `${alias}.closed_at IS NULL AND ${alias}.profile_visibility <> 'private'`;
}

export async function listLobbyActivity(now = new Date()): Promise<LobbyActivityEvent[]> {
  if (!isInitialized()) return [];
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_MS);
  const pool = getPool();
  const [games, studies] = await Promise.all([
    pool.query<GameEventRow>(
      `SELECT g.room_id, g.variant, g.ended_at,
              w.subject_type AS winner_type, wu.handle AS winner_handle,
              l.subject_type AS loser_type, l.display_name AS loser_name
         FROM games g
         JOIN game_participants w
           ON w.game_id = g.room_id AND g.result = w.color || '-wins'
         JOIN game_participants l
           ON l.game_id = g.room_id AND l.color <> w.color
         LEFT JOIN users wu
           ON w.subject_type = 'user' AND wu.id = w.subject_id AND ${publicHandle('wu')}
        WHERE ${countedHumanGame('g')}
          AND g.ended_at >= $1
          AND g.visibility <> 'private'
          AND g.result IN ('white-wins', 'black-wins', 'red-wins')
          AND g.mode = 'pve'
          AND l.subject_type IN ('bot', 'engine-version')
          AND COALESCE(${botLevel('l')}, ${MIN_BOT_LEVEL}) >= ${MIN_BOT_LEVEL}
          AND (w.subject_type = 'guest' OR wu.handle IS NOT NULL)
        ORDER BY g.ended_at DESC, g.room_id
        LIMIT $2`,
      [since, GAME_EVENT_LIMIT],
    ),
    pool.query<StudyEventRow>(
      `SELECT s.id, s.name, s.created_at, u.handle AS owner_handle
         FROM studies s
         JOIN users u ON u.id = s.owner_id
        WHERE s.visibility = 'public'
          AND u.profile_visibility IN ('public', 'unlisted')
          AND s.created_at >= $1
        ORDER BY s.created_at DESC, s.id
        LIMIT $2`,
      [since, STUDY_EVENT_LIMIT],
    ),
  ]);
  const events: LobbyActivityEvent[] = [];
  for (const row of games.rows) {
    const event = gameEvent(row);
    if (event) events.push(event);
  }
  for (const row of studies.rows) {
    events.push({
      id: `act_study_${row.id}`,
      kind: 'study',
      createdAt: row.created_at.toISOString(),
      href: `/study/${encodeURIComponent(row.id)}`,
      handle: row.owner_handle,
      title: row.name,
    });
  }
  return events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function gameEvent(row: GameEventRow): LobbyActivityEvent | null {
  const href = crosstableReviewUrl(row.room_id, row.variant);
  if (!href) return null;
  const base = {
    id: `act_game_${row.room_id}`,
    createdAt: row.ended_at.toISOString(),
    href,
    gameSpecId: row.variant,
  };
  return {
    ...base,
    kind: 'bot-win',
    handle: row.winner_type === 'guest' ? null : row.winner_handle,
    opponent: row.loser_name,
  };
}

// Every homepage viewer polls the lobby every 7 s; the activity query runs at
// most once a minute per process.
const CACHE_TTL_MS = 60 * 1000;
let cache: { at: number; events: Promise<LobbyActivityEvent[]> } | null = null;

export function cachedLobbyActivity(nowMs = Date.now()): Promise<LobbyActivityEvent[]> {
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.events;
  const events = listLobbyActivity(new Date(nowMs)).catch(() => {
    cache = null; // a failed read is retried on the next poll, not cached
    return [];
  });
  cache = { at: nowMs, events };
  return events;
}

export function resetLobbyActivityCacheForTests(): void {
  cache = null;
}
