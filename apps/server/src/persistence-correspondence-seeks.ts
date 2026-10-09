/**
 * correspondence_seeks persistence: the open async-seek board (C3) plus directed
 * and link-only challenges (migration 076). A seek is a standing correspondence
 * request; accepting it (the tenant accept flow) creates a room seating both
 * players and deletes the seek, so this table holds only open seeks. The
 * per-user cap is enforced in app code via countOpenSeeksForUser.
 *
 * Two dimensions layer challenges onto the board:
 *   - visibility 'public' → the open board (anyone accepts); 'private' → off the
 *     board, accepted by link (whoever holds the unguessable seek id).
 *   - targetUserId set → a direct challenge only that account may accept; it
 *     surfaces in the target's "challenges to me" list, never on the board.
 * The public board is exactly visibility='public' AND targetUserId IS NULL.
 */

import { DAY_MS } from '@mistboard/game';
import { getPool } from './persistence-db.js';

/**
 * How long a public board seek stays live, counted from created_at. Board seeks
 * store no expires_at; the lapse is computed at read time (seekExpirySql), so it
 * covers rows posted before the rule existed and moves with this one constant.
 * Before it, prod's board was two identical month-old posts from one player.
 */
export const CORRESPONDENCE_SEEK_TTL_MS = 14 * DAY_MS;

// The instant a seek stops being live, as SQL: a challenge's own expires_at, or
// for a board seek (expires_at NULL) created_at plus the board TTL. Every read,
// the cap, the accept gate (through getCorrespondenceSeek) and the sweep use
// this one expression, so "expired" cannot mean different things in different
// places. The interpolated value is a numeric constant, never request input.
export function seekExpirySql(alias = ''): string {
  return `COALESCE(${alias}expires_at, ${alias}created_at + interval '${CORRESPONDENCE_SEEK_TTL_MS} milliseconds')`;
}

/**
 * Which side the creator wants, expressed as MOVE ORDER rather than a color, so one seek
 * board can serve every variant: 'first' is whoever moves first (chess white, xiangqi red),
 * 'second' the responder. The accept path maps these onto the tenant's own `colors` pair,
 * so no variant's color literals leak into the seek (migration 106).
 */
export type SeekColorPreference = 'first' | 'second' | 'random';

// 'public' seeks sit on the open board; 'private' seeks are off-board and
// accepted by link (the shareable "play me" URL is the seek id).
export type SeekVisibility = 'public' | 'private';

export type CorrespondenceSeekRecord = {
  id: string;
  creatorUserId: string;
  gameSpecId: string;
  daysPerMove: number;
  preferredColor: SeekColorPreference;
  // null → open seek / link challenge; set → direct challenge to that account.
  targetUserId: string | null;
  visibility: SeekVisibility;
  // On create: null → a public board seek, which lapses CORRESPONDENCE_SEEK_TTL_MS
  // after created_at; a timestamp → a challenge's own expiry. On read: always the
  // effective expiry (seekExpirySql), refused and swept once past.
  expiresAt: Date | null;
  // Casual (false/absent) or rated (migration 160). Carried into the room the
  // accept creates; the route admits true only for isCorrespondenceRatedSpec.
  // Always set on read.
  rated?: boolean;
};

export type CorrespondenceSeekListing = CorrespondenceSeekRecord & {
  creatorName: string | null;
  // The creator's handle, so a client can link the name to /@/<handle>. Null when
  // the account is closed or its profile is private (linkableHandleSql), so
  // "handle present => link" stays fail-closed on every surface that reads it.
  creatorHandle: string | null;
  createdAt: Date;
};

export async function createCorrespondenceSeek(seek: CorrespondenceSeekRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO correspondence_seeks
       (id, creator_user_id, game_spec_id, days_per_move, preferred_color, target_user_id, visibility, expires_at, rated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      seek.id,
      seek.creatorUserId,
      seek.gameSpecId,
      seek.daysPerMove,
      seek.preferredColor,
      seek.targetUserId,
      seek.visibility,
      seek.expiresAt,
      seek.rated === true,
    ],
  );
}

// Counts every open row the user created — public seeks AND private/direct
// challenges — so the cap bounds total outstanding invitations, not just board
// spam.
export async function countOpenSeeksForUser(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    // Expired rows are excluded so the cap counts exactly what
    // listOutgoingSeeksForUser shows and cancelSeek can remove. Without this,
    // dead links held a slot between their expiry and the sweeper's next pass,
    // and the player had no way to see or clear the row blocking them.
    `SELECT COUNT(*)::text AS count FROM correspondence_seeks
      WHERE creator_user_id = $1
        AND ${seekExpirySql()} > now()`,
    [userId],
  );
  return Number(rows[0]?.count ?? '0');
}

/**
 * A user's handle only when their profile may be linked: an open account whose
 * profile is not private. The same rule the postgame participant rows and the
 * lobby activity feed apply (persistence-games.ts, persistence-lobby-activity.ts),
 * so a name links on the correspondence pages exactly when it links elsewhere.
 * The display name is unaffected; only the link is withheld.
 */
export function linkableHandleSql(alias: string): string {
  return `CASE WHEN ${alias}.closed_at IS NULL AND ${alias}.profile_visibility <> 'private'
               THEN ${alias}.handle END`;
}

const SEEK_COLUMNS = `s.id, s.creator_user_id, s.game_spec_id, s.days_per_move, s.preferred_color,
            s.target_user_id, s.visibility, ${seekExpirySql('s.')} AS expires_at, s.rated,
            COALESCE(u.display_name, u.handle) AS creator_name,
            ${linkableHandleSql('u')} AS creator_handle, s.created_at`;

type SeekListingRow = {
  id: string;
  creator_user_id: string;
  game_spec_id: string;
  days_per_move: number;
  preferred_color: SeekColorPreference;
  target_user_id: string | null;
  visibility: SeekVisibility;
  expires_at: Date | null;
  rated: boolean;
  creator_name: string | null;
  creator_handle: string | null;
  created_at: Date;
};

/** A seek the caller created, plus the recipient's name for a directed one. */
export type OutgoingCorrespondenceSeek = CorrespondenceSeekListing & {
  targetName: string | null;
  // Linkable handle of a directed challenge's recipient (linkableHandleSql).
  targetHandle: string | null;
};

function toListing(row: SeekListingRow): CorrespondenceSeekListing {
  return {
    id: row.id,
    creatorUserId: row.creator_user_id,
    gameSpecId: row.game_spec_id,
    daysPerMove: row.days_per_move,
    preferredColor: row.preferred_color,
    targetUserId: row.target_user_id,
    visibility: row.visibility,
    expiresAt: row.expires_at,
    rated: row.rated,
    creatorName: row.creator_name,
    creatorHandle: row.creator_handle,
    createdAt: row.created_at,
  };
}

// The public board: open seeks only — never directed or link-only challenges.
export async function listOpenCorrespondenceSeeks(
  limit = 100,
): Promise<CorrespondenceSeekListing[]> {
  const { rows } = await getPool().query<SeekListingRow>(
    `SELECT ${SEEK_COLUMNS}
     FROM correspondence_seeks s
     JOIN users u ON u.id = s.creator_user_id
     WHERE s.visibility = 'public' AND s.target_user_id IS NULL
       AND ${seekExpirySql('s.')} > now()
     ORDER BY s.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(toListing);
}

// The creator's own still-live board seek with exactly these terms, if any.
// Posting the same offer twice used to stack identical rows on the board; the
// create route returns this one instead. Same liveness rule as the cap, so a
// lapsed duplicate never blocks a fresh post.
export async function findOpenDuplicatePublicSeek(seek: {
  creatorUserId: string;
  gameSpecId: string;
  daysPerMove: number;
  preferredColor: SeekColorPreference;
  rated?: boolean;
}): Promise<CorrespondenceSeekListing | null> {
  const { rows } = await getPool().query<SeekListingRow>(
    `SELECT ${SEEK_COLUMNS}
     FROM correspondence_seeks s
     JOIN users u ON u.id = s.creator_user_id
     WHERE s.creator_user_id = $1
       AND s.game_spec_id = $2
       AND s.days_per_move = $3
       AND s.preferred_color = $4
       AND s.rated = $5
       AND s.visibility = 'public' AND s.target_user_id IS NULL
       AND ${seekExpirySql('s.')} > now()
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [
      seek.creatorUserId,
      seek.gameSpecId,
      seek.daysPerMove,
      seek.preferredColor,
      seek.rated === true,
    ],
  );
  const row = rows[0];
  return row ? toListing(row) : null;
}

// "Challenges to me" — the directed challenges awaiting a specific user, newest
// first, with the challenger's display name.
export async function listChallengesForUser(
  targetUserId: string,
  limit = 100,
): Promise<CorrespondenceSeekListing[]> {
  const { rows } = await getPool().query<SeekListingRow>(
    `SELECT ${SEEK_COLUMNS}
     FROM correspondence_seeks s
     JOIN users u ON u.id = s.creator_user_id
     WHERE s.target_user_id = $1
       AND ${seekExpirySql('s.')} > now()
     ORDER BY s.created_at DESC
     LIMIT $2`,
    [targetUserId, limit],
  );
  return rows.map(toListing);
}

// "Challenges I sent" — every standing invitation this player created, whatever
// its visibility: public board posts, private share links, and directed
// challenges. This is the only read that can see a player's own private
// challenges: listOpenCorrespondenceSeeks is deliberately
// `visibility = 'public' AND target_user_id IS NULL`, and listChallengesForUser
// matches on target_user_id, so before this a link challenge existed nowhere its
// creator could see it and could not be cancelled, while still counting against
// MAX_OPEN_SEEKS_PER_USER for its full seven-day TTL (#353).
export async function listOutgoingSeeksForUser(
  creatorUserId: string,
  limit = 100,
): Promise<OutgoingCorrespondenceSeek[]> {
  const { rows } = await getPool().query<
    SeekListingRow & { target_name: string | null; target_handle: string | null }
  >(
    `SELECT ${SEEK_COLUMNS},
            COALESCE(t.display_name, t.handle) AS target_name,
            ${linkableHandleSql('t')} AS target_handle
     FROM correspondence_seeks s
     JOIN users u ON u.id = s.creator_user_id
     LEFT JOIN users t ON t.id = s.target_user_id
     WHERE s.creator_user_id = $1
       AND ${seekExpirySql('s.')} > now()
     ORDER BY s.created_at DESC
     LIMIT $2`,
    [creatorUserId, limit],
  );
  return rows.map((row) => ({
    ...toListing(row),
    targetName: row.target_name,
    targetHandle: row.target_handle,
  }));
}

// Housekeeping: drop seeks and challenges whose expiry has passed. Correctness never
// depends on this running (accept refuses an expired seek and lists filter it
// out); it just keeps the table from accreting dead links. Returns the count
// removed. Runs on the deadline sweeper's interval.
//
// A public board seek that lapses also leaves its creator one bell notice
// (migration 161), written by the same statement that deletes it: the INSERT
// reads the DELETE's RETURNING rows, so the two commit together or not at all.
// A crash cannot drop the notice after the seek is gone, or send it while the
// seek survives to be swept again. A seek deleted by an accept or a cancel first
// is simply not returned here, so it never notifies; seek_id as the notice's
// primary key backs this up if two sweepers ever race. Link and direct
// challenges carry their own expires_at and are deleted without a notice, and a
// closed or play-locked creator gets nothing.
export async function deleteExpiredCorrespondenceSeeks(now: Date = new Date()): Promise<number> {
  const { rows } = await getPool().query<{ deleted: number }>(
    `WITH expired AS (
       DELETE FROM correspondence_seeks WHERE ${seekExpirySql()} <= $1
       RETURNING id, creator_user_id, game_spec_id, days_per_move, preferred_color,
                 rated, created_at, visibility, target_user_id
     ),
     noticed AS (
       INSERT INTO correspondence_seek_expiry_notices
         (seek_id, user_id, game_spec_id, days_per_move, preferred_color, rated,
          posted_at, expired_at)
       SELECT e.id, e.creator_user_id, e.game_spec_id, e.days_per_move, e.preferred_color,
              e.rated, e.created_at, $1
       FROM expired e
       JOIN users u ON u.id = e.creator_user_id
       WHERE e.visibility = 'public' AND e.target_user_id IS NULL
         AND u.closed_at IS NULL
         AND u.play_disabled_at IS NULL
       ON CONFLICT (seek_id) DO NOTHING
     )
     -- A data-modifying CTE runs to completion whether or not the outer query
     -- reads it, so the notices are written even though only the count is.
     SELECT (SELECT count(*) FROM expired)::int AS deleted`,
    [now],
  );
  return rows[0]?.deleted ?? 0;
}

/** A board seek that lapsed unanswered, as the creator's bell shows it. */
export type SeekExpiryNotice = {
  seekId: string;
  gameSpecId: string;
  daysPerMove: number;
  preferredColor: SeekColorPreference;
  rated: boolean;
  expiredAt: Date;
};

// Unseen notices older than this drop off the bell by themselves.
export const SEEK_EXPIRY_NOTICE_WINDOW_DAYS = 30;

// This account's unseen expired-seek notices, newest first, capped by the
// caller, plus the uncapped total for the badge.
export async function unseenSeekExpiryNotices(
  userId: string,
  options: { limit?: number } = {},
): Promise<{ total: number; notices: SeekExpiryNotice[] }> {
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
  const { rows } = await getPool().query<{
    seek_id: string;
    game_spec_id: string;
    days_per_move: number;
    preferred_color: SeekColorPreference;
    rated: boolean;
    expired_at: Date;
    total: number;
  }>(
    `SELECT seek_id, game_spec_id, days_per_move, preferred_color, rated, expired_at,
            (count(*) OVER ())::int AS total
     FROM correspondence_seek_expiry_notices
     WHERE user_id = $1
       AND seen_at IS NULL
       AND expired_at > now() - make_interval(days => $2::int)
     ORDER BY expired_at DESC, seek_id ASC
     LIMIT $3::int`,
    [userId, SEEK_EXPIRY_NOTICE_WINDOW_DAYS, limit],
  );
  return {
    total: rows[0]?.total ?? 0,
    notices: rows.map((row) => ({
      seekId: row.seek_id,
      gameSpecId: row.game_spec_id,
      daysPerMove: row.days_per_move,
      preferredColor: row.preferred_color,
      rated: row.rated,
      expiredAt: row.expired_at,
    })),
  };
}

// Opening the bell is the read receipt: every unseen notice leaves the panel.
export async function markSeekExpiryNoticesSeen(
  userId: string,
  at: Date = new Date(),
): Promise<void> {
  await getPool().query(
    `UPDATE correspondence_seek_expiry_notices SET seen_at = $2
     WHERE user_id = $1 AND seen_at IS NULL`,
    [userId, at],
  );
}

// One seek by id with the creator's display name — the accept/challenge landing
// page's read. Unlike getCorrespondenceSeek this joins users for the name.
export async function getCorrespondenceSeekListing(
  id: string,
): Promise<CorrespondenceSeekListing | null> {
  const { rows } = await getPool().query<SeekListingRow>(
    `SELECT ${SEEK_COLUMNS}
     FROM correspondence_seeks s
     JOIN users u ON u.id = s.creator_user_id
     WHERE s.id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toListing(row) : null;
}

export async function getCorrespondenceSeek(id: string): Promise<CorrespondenceSeekRecord | null> {
  const { rows } = await getPool().query<{
    id: string;
    creator_user_id: string;
    game_spec_id: string;
    days_per_move: number;
    preferred_color: SeekColorPreference;
    target_user_id: string | null;
    visibility: SeekVisibility;
    expires_at: Date | null;
    rated: boolean;
  }>(
    `SELECT id, creator_user_id, game_spec_id, days_per_move, preferred_color,
            target_user_id, visibility, ${seekExpirySql()} AS expires_at, rated
     FROM correspondence_seeks WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    creatorUserId: row.creator_user_id,
    gameSpecId: row.game_spec_id,
    daysPerMove: row.days_per_move,
    preferredColor: row.preferred_color,
    targetUserId: row.target_user_id,
    visibility: row.visibility,
    expiresAt: row.expires_at,
    rated: row.rated,
  };
}

// Delete a seek, returning whether a row was removed. The accept flow relies on
// this boolean to win the race when two players accept the same seek at once:
// only the deleter (rowCount 1) proceeds to create the room. Pass ownerUserId
// to scope a cancel to the seek's creator.
export async function deleteCorrespondenceSeek(id: string, ownerUserId?: string): Promise<boolean> {
  const result = ownerUserId
    ? await getPool().query(
        'DELETE FROM correspondence_seeks WHERE id = $1 AND creator_user_id = $2',
        [id, ownerUserId],
      )
    : await getPool().query('DELETE FROM correspondence_seeks WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * The seek creator's mailbox, for the "your seek was accepted" email
 * (correspondence-start-email.ts). Returns null when the account is gone or
 * carries no email, and honours the opt-out in SQL the way the deadline
 * warning's candidate query does: an account that never touched the toggle has
 * no key in account_preferences, and COALESCE(..., true) opts it in.
 *
 * A row is returned only when the notice should actually be sent, so the caller
 * never has to re-derive the preference and the two correspondence emails can
 * never disagree about what "unset" means.
 */
export async function correspondenceStartRecipient(
  userId: string,
): Promise<{ email: string; locale: string | null } | null> {
  const { rows } = await getPool().query<{ email: string; locale: string | null }>(
    `SELECT email, locale FROM users
     WHERE id = $1
       AND email IS NOT NULL
       AND closed_at IS NULL
       AND COALESCE((account_preferences->>'correspondenceStartEmail')::boolean, true)`,
    [userId],
  );
  return rows[0] ? { email: rows[0].email, locale: rows[0].locale } : null;
}
