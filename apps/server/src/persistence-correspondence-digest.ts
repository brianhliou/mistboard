// Reads and the one write behind the daily correspondence "your move" digest
// (correspondence-turn-digest.ts). The row source is room_deadlines, the same
// table the deadline warning and the your-move bell read: a row whose
// seat_user_id is the account is a game waiting on that account's move.

import { getPool } from './persistence-db.js';

export type CorrespondenceDigestGame = {
  roomId: string;
  gameSpecId: string;
  opponentName: string | null;
  dueAt: Date;
  // Whether the deadline warning for this exact deadline already went out.
  warned: boolean;
};

export type CorrespondenceDigestCandidate = {
  userId: string;
  email: string;
  // users.locale ('en' | 'zh-Hans' | 'zh-Hant' | null): the email's language.
  locale: string | null;
  games: CorrespondenceDigestGame[];
};

export type CorrespondenceDigestQuery = {
  now: Date;
  // Accounts whose last digest went out before this instant (or never).
  sentBefore: Date;
  // Only games whose move has been waiting since before this instant, for
  // accounts not seen on the site since before it either: someone who was
  // just here has seen the board, and a game that became their move an hour
  // ago is not yet a stalled one.
  idleSince: Date;
};

// One row per waiting game, grouped by account in code. Due rows are left to
// the timeout pass; the opt-out lives in the query like the other two
// correspondence emails so the module never re-derives an unset preference.
//
// "Waiting since" is the turn start: due_at minus the per-move allowance (a
// days-per-move clock resets to the full allowance on every move, so the
// deadline is always turn start + allowance), with the allowance read off the
// room-created event like the deadline warning does. Never rd.updated_at: the
// event writer re-upserts the row on every event, and a reconnect appends a
// seat-assigned event, so each visit by the player NOT on the move bumped it
// and pushed the absent player's digest back (prod, 2026-10-04). updated_at
// stays only as the fallback for a row whose room-created carries no allowance.
export async function listCorrespondenceDigestCandidates(
  query: CorrespondenceDigestQuery,
): Promise<CorrespondenceDigestCandidate[]> {
  const { rows } = await getPool().query<{
    user_id: string;
    email: string;
    locale: string | null;
    room_id: string;
    game_spec_id: string;
    opponent_name: string | null;
    due_at: Date;
    warned_at: Date | null;
  }>(
    `SELECT u.id AS user_id, u.email, u.locale, rd.room_id, rd.game_spec_id, rd.due_at, rd.warned_at,
            COALESCE(opp_user.display_name, opp_user.handle) AS opponent_name
     FROM room_deadlines rd
     JOIN users u ON u.id = rd.seat_user_id
     LEFT JOIN room_seat_tokens opp
       ON opp.room_id = rd.room_id AND opp.seat <> rd.seat AND opp.revoked_at IS NULL
     LEFT JOIN users opp_user ON opp_user.id = opp.user_id
     LEFT JOIN events rc ON rc.room_id = rd.room_id AND rc.seq = 0
     WHERE rd.seat_user_id IS NOT NULL
       AND rd.due_at > $1
       AND COALESCE(
         rd.due_at - (rc.payload->'timeControl'->>'initialMs')::double precision * interval '1 millisecond',
         rd.updated_at
       ) <= $3
       AND COALESCE((u.account_preferences->>'correspondenceTurnDigest')::boolean, true)
       AND (u.correspondence_digest_sent_at IS NULL OR u.correspondence_digest_sent_at < $2)
       AND (u.last_seen_at IS NULL OR u.last_seen_at <= $3)
     ORDER BY u.id, rd.due_at, rd.room_id`,
    [query.now, query.sentBefore, query.idleSince],
  );
  const byUser = new Map<string, CorrespondenceDigestCandidate>();
  for (const row of rows) {
    let candidate = byUser.get(row.user_id);
    if (!candidate) {
      candidate = { userId: row.user_id, email: row.email, locale: row.locale, games: [] };
      byUser.set(row.user_id, candidate);
    }
    candidate.games.push({
      roomId: row.room_id,
      gameSpecId: row.game_spec_id,
      opponentName: row.opponent_name,
      dueAt: row.due_at,
      warned: row.warned_at !== null,
    });
  }
  return [...byUser.values()];
}

export async function markCorrespondenceDigestSent(userId: string, at: Date): Promise<void> {
  await getPool().query(`UPDATE users SET correspondence_digest_sent_at = $2 WHERE id = $1`, [
    userId,
    at,
  ]);
}
