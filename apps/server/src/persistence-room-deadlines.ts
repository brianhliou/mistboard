/**
 * room_deadlines persistence: the durable index for correspondence
 * (days-per-move) deadline enforcement. Rows are maintained by the tenant
 * event writer (upsert on every event while a deadline exists, delete on
 * terminal) and consumed by the deadline sweeper, which re-derives the
 * deadline from the hydrated room's event log before acting — the event log
 * stays the source of truth; this table only decides which rooms to look at.
 */

import { linkableHandleSql } from './persistence-correspondence-seeks.js';
import { getPool } from './persistence-db.js';

export type RoomDeadlineRecord = {
  roomId: string;
  gameSpecId: string;
  seat: string;
  seatUserId: string | null;
  dueAt: Date;
};

export type DueRoomDeadline = {
  roomId: string;
  gameSpecId: string;
  seat: string;
  dueAt: Date;
};

// One in-flight correspondence game from a player's perspective. The same
// room_deadlines index that the sweeper reads (one row per active days-per-move
// room, keyed to the seat on the move) doubles as the "your games" source — the
// seat_user_id partial index is built for exactly this.
export type CorrespondenceGameSummary = {
  roomId: string;
  gameSpecId: string;
  mySeat: string;
  isYourMove: boolean;
  opponentName: string | null;
  // The opponent's handle for a /@/<handle> link; null for a closed or private
  // account (linkableHandleSql) and for a seat with no account behind it.
  opponentHandle?: string | null;
  dueAt: Date;
  // Rated correspondence: read off the room's own room-created event (seq 0), the
  // durable home of the flag, so the index needs no copy of it.
  rated?: boolean;
};

export async function upsertRoomDeadline(record: RoomDeadlineRecord): Promise<void> {
  // A changed due_at re-arms the warning email (warned_at resets); an
  // unchanged due_at keeps it so re-upserts on unrelated events stay
  // idempotent.
  await getPool().query(
    `INSERT INTO room_deadlines (room_id, game_spec_id, seat, seat_user_id, due_at, warned_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, now())
     ON CONFLICT (room_id) DO UPDATE SET
       game_spec_id = EXCLUDED.game_spec_id,
       seat = EXCLUDED.seat,
       seat_user_id = EXCLUDED.seat_user_id,
       due_at = EXCLUDED.due_at,
       warned_at = CASE
         WHEN room_deadlines.due_at = EXCLUDED.due_at THEN room_deadlines.warned_at
         ELSE NULL
       END,
       updated_at = now()`,
    [record.roomId, record.gameSpecId, record.seat, record.seatUserId, record.dueAt],
  );
}

export async function deleteRoomDeadline(roomId: string): Promise<void> {
  await getPool().query('DELETE FROM room_deadlines WHERE room_id = $1', [roomId]);
}

// All of a player's in-flight correspondence games, your-move-first then
// soonest-deadline. Joins the deadline index (active days-per-move rooms) to
// the seat the player holds, and resolves the opponent's name from the other
// seat's account. Rooms without a deadline row (finished, or a still-open
// invite) and live rooms naturally fall out — only active correspondence
// rooms the player is seated in survive the join.
export async function listCorrespondenceGamesForUser(
  userId: string,
): Promise<CorrespondenceGameSummary[]> {
  const { rows } = await getPool().query<{
    room_id: string;
    game_spec_id: string;
    my_seat: string;
    on_move_seat: string;
    due_at: Date;
    opponent_name: string | null;
    opponent_handle: string | null;
    rated: boolean;
  }>(
    `SELECT rd.room_id, rd.game_spec_id, mine.seat AS my_seat, rd.seat AS on_move_seat,
            rd.due_at, COALESCE(opp_user.display_name, opp_user.handle) AS opponent_name,
            ${linkableHandleSql('opp_user')} AS opponent_handle,
            COALESCE((created.payload->>'rated')::boolean, false) AS rated
     FROM room_seat_tokens mine
     JOIN room_deadlines rd ON rd.room_id = mine.room_id
     LEFT JOIN events created ON created.room_id = rd.room_id AND created.seq = 0
     LEFT JOIN room_seat_tokens opp
       ON opp.room_id = mine.room_id AND opp.seat <> mine.seat AND opp.revoked_at IS NULL
     LEFT JOIN users opp_user ON opp_user.id = opp.user_id
     WHERE mine.user_id = $1 AND mine.revoked_at IS NULL
     ORDER BY (rd.seat = mine.seat) DESC, rd.due_at ASC`,
    [userId],
  );
  return rows.map((row) => ({
    roomId: row.room_id,
    gameSpecId: row.game_spec_id,
    mySeat: row.my_seat,
    isYourMove: row.on_move_seat === row.my_seat,
    opponentName: row.opponent_name,
    opponentHandle: row.opponent_handle,
    dueAt: row.due_at,
    rated: row.rated,
  }));
}

// Room ids of every active correspondence game. room_deadlines holds exactly one
// row per in-flight days-per-move room (upserted while active, deleted on
// terminal), so this is the durable "correspondence games in play" set —
// including games with nobody currently connected. Returned as ids, not a bare
// count, so the caller can dedupe against rooms already counted live.
export async function listActiveCorrespondenceRoomIds(): Promise<string[]> {
  const { rows } = await getPool().query<{ room_id: string }>('SELECT room_id FROM room_deadlines');
  return rows.map((row) => row.room_id);
}

// The same active set with the deadline attached: which seat is on the move and
// when it forfeits. Feeds the current-games page (current-games.ts), which
// hydrates each room from this index and shows the deadline on the card.
export type ActiveRoomDeadline = {
  roomId: string;
  gameSpecId: string;
  seat: string;
  dueAt: Date;
};

export async function listActiveRoomDeadlines(): Promise<ActiveRoomDeadline[]> {
  const { rows } = await getPool().query<{
    room_id: string;
    game_spec_id: string;
    seat: string;
    due_at: Date;
  }>('SELECT room_id, game_spec_id, seat, due_at FROM room_deadlines ORDER BY due_at');
  return rows.map((row) => ({
    roomId: row.room_id,
    gameSpecId: row.game_spec_id,
    seat: row.seat,
    dueAt: row.due_at,
  }));
}

export async function listDueRoomDeadlines(now: Date, limit = 50): Promise<DueRoomDeadline[]> {
  const { rows } = await getPool().query(
    `SELECT room_id, game_spec_id, seat, due_at
     FROM room_deadlines
     WHERE due_at <= $1
     ORDER BY due_at
     LIMIT $2`,
    [now, limit],
  );
  return rows.map((row) => ({
    roomId: row.room_id as string,
    gameSpecId: row.game_spec_id as string,
    seat: row.seat as string,
    dueAt: row.due_at as Date,
  }));
}

// A correspondence game approaching its move deadline, with everything the
// warning email needs: the recipient account (the seat on the move), the
// opponent's name, and the per-move allowance in ms (room-created initialMs,
// which equals daysPerMove for correspondence) so the sweeper can scale the
// warning lead per game. Allowance comes from the room-created event, so the
// query needs no room hydration.
export type DeadlineWarningCandidate = {
  roomId: string;
  gameSpecId: string;
  dueAt: Date;
  allowanceMs: number;
  recipientEmail: string;
  recipientUserId: string;
  // users.locale ('en' | 'zh-Hans' | 'zh-Hant' | null): the email's language.
  recipientLocale: string | null;
  opponentName: string | null;
};

// Un-warned, not-yet-due rows with a seated account whose deadline falls inside
// the max-lead window. The sweeper applies the per-game lead (a fraction of the
// allowance) in code; this just bounds the candidate set cheaply.
export async function listDeadlineWarningCandidates(
  now: Date,
  maxLeadMs: number,
): Promise<DeadlineWarningCandidate[]> {
  const { rows } = await getPool().query<{
    room_id: string;
    game_spec_id: string;
    due_at: Date;
    allowance_ms: string | null;
    recipient_email: string;
    recipient_user_id: string;
    recipient_locale: string | null;
    opponent_name: string | null;
  }>(
    `SELECT rd.room_id, rd.game_spec_id, rd.due_at, rd.seat_user_id AS recipient_user_id,
            u.email AS recipient_email, u.locale AS recipient_locale,
            COALESCE(opp_user.display_name, opp_user.handle) AS opponent_name,
            (rc.payload->'timeControl'->>'initialMs') AS allowance_ms
     FROM room_deadlines rd
     JOIN users u ON u.id = rd.seat_user_id
     LEFT JOIN room_seat_tokens opp
       ON opp.room_id = rd.room_id AND opp.seat <> rd.seat AND opp.revoked_at IS NULL
     LEFT JOIN users opp_user ON opp_user.id = opp.user_id
     LEFT JOIN events rc ON rc.room_id = rd.room_id AND rc.payload->>'type' = 'room-created'
     WHERE rd.warned_at IS NULL
       AND rd.seat_user_id IS NOT NULL
       AND COALESCE(
         (u.account_preferences->>'correspondenceDeadlineEmail')::boolean,
         true
       )
       AND rd.due_at > $1
       AND rd.due_at <= $2
     ORDER BY rd.due_at`,
    [now, new Date(now.getTime() + maxLeadMs)],
  );
  return rows
    .filter((row) => row.allowance_ms !== null)
    .map((row) => ({
      roomId: row.room_id,
      gameSpecId: row.game_spec_id,
      dueAt: row.due_at,
      allowanceMs: Number(row.allowance_ms),
      recipientEmail: row.recipient_email,
      recipientUserId: row.recipient_user_id,
      recipientLocale: row.recipient_locale,
      opponentName: row.opponent_name,
    }));
}

// Mark the current deadline warned so the sweeper sends once. Guarded on
// warned_at IS NULL so a re-arm (a move resets due_at, nulling warned_at) is
// the only path that sends again — one warning per deadline.
export async function markRoomDeadlineWarned(roomId: string, at: Date): Promise<void> {
  await getPool().query(
    `UPDATE room_deadlines SET warned_at = $2 WHERE room_id = $1 AND warned_at IS NULL`,
    [roomId, at],
  );
}
