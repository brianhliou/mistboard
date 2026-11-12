// Account-session persistence: session create/resolve, metadata, and
// revocation. Split out of persistence-accounts.ts; the shared users-row
// plumbing (USER_COLUMNS_QUALIFIED, userFromRow) stays there.
import type pg from 'pg';
import {
  USER_COLUMNS_QUALIFIED,
  type UserAccount,
  type UserRow,
  userFromRow,
} from './persistence-accounts.js';
import { countedHumanGame, countedPlayerSeat } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';

export type AccountSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  deviceId?: string | null;
  createdAt?: Date;
};

export type AccountSessionSummary = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  userAgent: string | null;
};

export async function createAccountSession(session: AccountSession): Promise<void> {
  await getPool().query(
    `INSERT INTO account_sessions (id, user_id, token_hash, expires_at, user_agent, device_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))`,
    [
      session.id,
      session.userId,
      session.tokenHash,
      session.expiresAt,
      session.userAgent ?? null,
      session.deviceId ?? null,
      session.createdAt ?? null,
    ],
  );
}

export async function listActiveAccountSessions(
  userId: string,
  at: Date,
): Promise<AccountSessionSummary[]> {
  const { rows } = await getPool().query<{
    id: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
    user_agent: string | null;
  }>(
    `SELECT id, created_at, last_seen_at, expires_at, user_agent
     FROM account_sessions
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > $2
     ORDER BY last_seen_at DESC, created_at DESC`,
    [userId, at],
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
  }));
}

export async function backfillUserAccountSessionAgent(
  userId: string,
  sessionIds: string[],
  userAgent: string,
): Promise<void> {
  await getPool().query(
    `UPDATE account_sessions
     SET user_agent = $3
     WHERE user_id = $1
       AND id = ANY($2::text[])
       AND user_agent IS NULL`,
    [userId, sessionIds, userAgent],
  );
}

export async function revokeUserAccountSession(
  userId: string,
  sessionId: string,
  at: Date,
): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE account_sessions
     SET revoked_at = $3
     WHERE id = $1
       AND user_id = $2
       AND revoked_at IS NULL`,
    [sessionId, userId, at],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revokeOtherUserAccountSessions(
  userId: string,
  currentSessionIds: string[],
  at: Date,
): Promise<number> {
  const result = await getPool().query(
    `UPDATE account_sessions
     SET revoked_at = $3
     WHERE user_id = $1
       AND NOT (id = ANY($2::text[]))
       AND revoked_at IS NULL`,
    [userId, currentSessionIds, at],
  );
  return result.rowCount ?? 0;
}

// How stale users.last_seen_at may get before a session validation refreshes
// it. Throttling the durable bump keeps the per-request cost at zero extra
// writes in the common case (the session-row update below still happens every
// request, as before 087).
const LAST_SEEN_BUMP_INTERVAL_MS = 5 * 60 * 1000;

export async function getUserByAccountSession(
  sessionId: string,
  tokenHash: string,
  at: Date,
): Promise<UserAccount | null> {
  // One statement, two writes: the session-row touch (pre-087 behavior) and a
  // throttled bump of the durable users.last_seen_at (087). The bump CTE only
  // matches when the current value is NULL or older than the throttle window,
  // so steady traffic writes the users row at most once per interval.
  const { rows } = await getPool().query<UserRow>(
    `WITH matched AS (
       UPDATE account_sessions
       SET last_seen_at = $3
       FROM users
       WHERE account_sessions.id = $1
         AND account_sessions.token_hash = $2
         AND account_sessions.user_id = users.id
         AND users.closed_at IS NULL
         AND account_sessions.revoked_at IS NULL
         AND account_sessions.expires_at > $3
       RETURNING ${USER_COLUMNS_QUALIFIED}
     ),
     last_seen_bump AS (
       UPDATE users
       SET last_seen_at = $3
       FROM matched
       WHERE users.id = matched.id
         AND (users.last_seen_at IS NULL
              OR users.last_seen_at < $3::timestamptz - ($4 * interval '1 millisecond'))
     )
     SELECT * FROM matched`,
    [sessionId, tokenHash, at, LAST_SEEN_BUMP_INTERVAL_MS],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function revokeAccountSession(
  sessionId: string,
  tokenHash: string,
  at: Date,
): Promise<void> {
  await getPool().query(
    `UPDATE account_sessions
     SET revoked_at = $3
     WHERE id = $1
       AND token_hash = $2
       AND revoked_at IS NULL`,
    [sessionId, tokenHash, at],
  );
}

export type GuestSignInWeek = {
  weekStart: string;
  guests: number;
  signedInWithin7d: number;
  complete: boolean;
};

// One browser per game-finish week, even if it played several games or signed
// in several times. Any qualifying finish may start its seven-day window.
// Historical sessions without device attribution cannot establish conversion.
export async function getWeeklyGuestSignIns(
  { now = new Date(), weeks = 26 }: { now?: Date; weeks?: number } = {},
  db: Pick<pg.Pool, 'query'> = getPool(),
): Promise<GuestSignInWeek[]> {
  const { rows } = await db.query<{
    week_start: string;
    guests: number;
    signed_in: number;
    complete: boolean;
  }>(
    `WITH axis AS (
       SELECT generate_series(
         date_trunc('week', $1::timestamptz AT TIME ZONE 'UTC') - ($2::int - 1) * interval '1 week',
         date_trunc('week', $1::timestamptz AT TIME ZONE 'UTC'), interval '1 week'
       ) AT TIME ZONE 'UTC' AS week_start
     ), guest_weeks AS (
       SELECT date_trunc('week', g.ended_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS week_start,
              guest.subject_id,
              bool_or(EXISTS (
                SELECT 1 FROM account_sessions s JOIN users u ON u.id = s.user_id
                WHERE s.device_id = guest.subject_id AND u.stats_excluded_at IS NULL
                  AND s.created_at >= g.ended_at
                  AND s.created_at <= g.ended_at + interval '168 hours'
                  AND s.created_at < $1::timestamptz
              )) AS signed_in
       FROM games g JOIN game_participants guest ON guest.game_id = g.room_id
       WHERE ${countedHumanGame('g')} AND g.mode = 'pvp'
         AND guest.subject_type = 'guest' AND ${countedPlayerSeat('guest')}
         AND g.ended_at >= (SELECT min(week_start) FROM axis) AND g.ended_at < $1::timestamptz
         AND EXISTS (
           SELECT 1 FROM game_participants opponent
           WHERE opponent.game_id = g.room_id AND opponent.color <> guest.color
             AND ${countedPlayerSeat('opponent')}
         )
       GROUP BY 1, guest.subject_id
     )
     SELECT to_char(a.week_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS week_start,
            count(g.subject_id)::int AS guests,
            count(g.subject_id) FILTER (WHERE g.signed_in)::int AS signed_in,
            a.week_start + interval '336 hours' <= $1::timestamptz AS complete
     FROM axis a LEFT JOIN guest_weeks g USING (week_start)
     GROUP BY a.week_start ORDER BY a.week_start`,
    [now, weeks],
  );
  return rows.map((row) => ({
    weekStart: row.week_start,
    guests: row.guests,
    signedInWithin7d: row.signed_in,
    complete: row.complete,
  }));
}
