// Admin roster of every registered account (the unlisted /accounts surface).
//
// A cross-user read like persistence-leaderboards.ts, but deliberately not
// gated by profile visibility: the admin sees closed, private, and unverified
// accounts too, which is the point of the roster. Never reachable from a
// public route; routes/admin-accounts.ts sits behind requireAdminSession.
//
// Games are counted from game_participants (subject_type 'user'), the same
// attribution the leaderboards use, across every visibility (a private game
// is still a game the account played).

import type { AccountRole } from './persistence-accounts.js';
import { getPool } from './persistence-db.js';
import type { PlayerTitle } from './persistence-titles.js';

// Each sortable column in both directions. The pair naming (`x` / `x-asc`,
// `name` / `name-desc`) keeps the historical keys stable: `newest`, `seen`,
// `games` are what saved /accounts URLs already carry.
export const ADMIN_ACCOUNT_SORTS = [
  'newest',
  'oldest',
  'seen',
  'seen-asc',
  'games',
  'games-asc',
  'name',
  'name-desc',
] as const;
export type AdminAccountSort = (typeof ADMIN_ACCOUNT_SORTS)[number];

export function isAdminAccountSort(value: string): value is AdminAccountSort {
  return (ADMIN_ACCOUNT_SORTS as readonly string[]).includes(value);
}

export type AdminAccountRow = {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  handle: string;
  displayName: string;
  accountRole: AccountRole;
  title: PlayerTitle | null;
  patronSince: Date | null;
  profileVisibility: 'private' | 'unlisted' | 'public';
  createdAt: Date;
  lastSeenAt: Date | null;
  closedAt: Date | null;
  gamesPlayed: number;
};

export type AdminAccountsQuery = {
  sort: AdminAccountSort;
  /** Case-insensitive substring over handle, display name, and email. */
  search: string | null;
  limit: number;
  offset: number;
};

export type AdminAccountsPage = {
  accounts: AdminAccountRow[];
  /** Accounts matching the search (not just this page). */
  total: number;
  /** Whole-roster signup figures, independent of the search. */
  summary: { accounts: number; last7d: number; last30d: number };
};

export const ADMIN_ACCOUNTS_MAX_LIMIT = 500;

// Never-seen accounts sort last in both directions: "least recently seen"
// is a question about people who have been seen.
const ORDER_BY: Record<AdminAccountSort, string> = {
  newest: 'u.created_at DESC, u.id',
  oldest: 'u.created_at ASC, u.id',
  seen: 'u.last_seen_at DESC NULLS LAST, u.created_at DESC, u.id',
  'seen-asc': 'u.last_seen_at ASC NULLS LAST, u.created_at ASC, u.id',
  games: 'games_played DESC, u.created_at DESC, u.id',
  'games-asc': 'games_played ASC, u.created_at DESC, u.id',
  name: 'lower(u.display_name) ASC, lower(u.handle) ASC, u.id',
  'name-desc': 'lower(u.display_name) DESC, lower(u.handle) DESC, u.id',
};

// ILIKE pattern for the search box: the user's text is a literal, so its own
// %, _, and \ are escaped before the wildcards go on.
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function listAdminAccounts(query: AdminAccountsQuery): Promise<AdminAccountsPage> {
  const limit = Math.max(1, Math.min(query.limit, ADMIN_ACCOUNTS_MAX_LIMIT));
  const offset = Math.max(0, query.offset);
  const search = query.search?.trim() ? likePattern(query.search.trim()) : null;
  const pool = getPool();
  const [page, summary] = await Promise.all([
    pool.query<{
      id: string;
      email: string;
      email_verified_at: Date | null;
      handle: string;
      display_name: string;
      account_role: AccountRole;
      title: PlayerTitle | null;
      patron_since: Date | null;
      profile_visibility: AdminAccountRow['profileVisibility'];
      created_at: Date;
      last_seen_at: Date | null;
      closed_at: Date | null;
      games_played: string;
      total: string;
    }>(
      `SELECT u.id, u.email, u.email_verified_at, u.handle, u.display_name, u.account_role,
              u.title, u.patron_since, u.profile_visibility, u.created_at, u.last_seen_at,
              u.closed_at,
              COALESCE(g.games_played, 0) AS games_played,
              COUNT(*) OVER () AS total
       FROM users u
       LEFT JOIN (
         SELECT p.subject_id AS user_id, COUNT(*) AS games_played
         FROM game_participants p
         JOIN games ON games.room_id = p.game_id
         WHERE p.subject_type = 'user'
           AND games.status = 'completed'
         GROUP BY p.subject_id
       ) g ON g.user_id = u.id
       WHERE $1::text IS NULL
          OR u.handle ILIKE $1
          OR u.display_name ILIKE $1
          OR u.email ILIKE $1
       ORDER BY ${ORDER_BY[query.sort]}
       LIMIT $2 OFFSET $3`,
      [search, limit, offset],
    ),
    pool.query<{ accounts: string; last7d: string; last30d: string }>(
      `SELECT COUNT(*) AS accounts,
              COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '7 days') AS last7d,
              COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '30 days') AS last30d
       FROM users`,
    ),
  ]);
  const summaryRow = summary.rows[0];
  return {
    accounts: page.rows.map((row) => ({
      id: row.id,
      email: row.email,
      emailVerifiedAt: row.email_verified_at,
      handle: row.handle,
      displayName: row.display_name,
      accountRole: row.account_role,
      title: row.title,
      patronSince: row.patron_since,
      profileVisibility: row.profile_visibility,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      closedAt: row.closed_at,
      gamesPlayed: Number(row.games_played),
    })),
    total: page.rows[0] ? Number(page.rows[0].total) : 0,
    summary: {
      accounts: Number(summaryRow?.accounts ?? 0),
      last7d: Number(summaryRow?.last7d ?? 0),
      last30d: Number(summaryRow?.last30d ?? 0),
    },
  };
}
