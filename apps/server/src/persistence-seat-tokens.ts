import { createHash, timingSafeEqual } from 'node:crypto';
import type { Color, XiangqiColor } from '@mistboard/game';
import type { MahjongSeat } from '@mistboard/mahjong';
import { getPool, withTransaction } from './persistence-db.js';

// Kept in lockstep with room_seat_tokens_seat_check (007, widened by 029 and
// again by 138). A seat outside the constraint means the token insert fails and
// the player comes back from a refresh as a spectator at their own table.
export type RoomSeatTokenSeat = Color | XiangqiColor | MahjongSeat;

export type RoomSeatTokenRecord<TSeat extends RoomSeatTokenSeat = Color> = {
  seat: TSeat;
  clientId: string;
  deviceId?: string | null;
  tokenHash: string;
  userId: string | null;
  userHandle: string | null;
  userDisplayName: string | null;
  issuedAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export async function loadRoomSeatTokens<TSeat extends RoomSeatTokenSeat = Color>(
  roomId: string,
): Promise<Partial<Record<TSeat, RoomSeatTokenRecord<TSeat>>>> {
  const { rows } = await getPool().query<{
    seat: TSeat;
    client_id: string;
    device_id: string | null;
    token_hash: string;
    user_id: string | null;
    user_handle: string | null;
    user_display_name: string | null;
    issued_at: Date;
    last_seen_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT room_seat_tokens.seat, room_seat_tokens.client_id, room_seat_tokens.device_id,
            room_seat_tokens.token_hash,
            room_seat_tokens.user_id, users.handle AS user_handle, users.display_name AS user_display_name,
            room_seat_tokens.issued_at, room_seat_tokens.last_seen_at, room_seat_tokens.revoked_at
     FROM room_seat_tokens
     LEFT JOIN users ON users.id = room_seat_tokens.user_id
     WHERE room_id = $1
       AND room_seat_tokens.revoked_at IS NULL`,
    [roomId],
  );
  const tokens: Partial<Record<TSeat, RoomSeatTokenRecord<TSeat>>> = {};
  for (const row of rows) {
    tokens[row.seat] = {
      seat: row.seat,
      clientId: row.client_id,
      deviceId: row.device_id,
      tokenHash: row.token_hash,
      userId: row.user_id,
      userHandle: row.user_handle,
      userDisplayName: row.user_display_name,
      issuedAt: row.issued_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
    };
  }
  return tokens;
}

/**
 * Does this account hold (or still hold) a seat in this room? The seat-token
 * table is the same attribution source game finishing uses, and rows survive the
 * game, so this answers "was a player here" for a finished room too. Guest seats
 * carry a null user_id and are never a match: the private player chat is an
 * account surface.
 */
export async function isRoomSeatUser(roomId: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `SELECT 1
     FROM room_seat_tokens
     WHERE room_id = $1
       AND user_id = $2
       AND revoked_at IS NULL
     LIMIT 1`,
    [roomId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function upsertRoomSeatToken(
  roomId: string,
  token: Omit<RoomSeatTokenRecord<RoomSeatTokenSeat>, 'issuedAt' | 'lastSeenAt' | 'revokedAt'> & {
    issuedAt: Date;
    lastSeenAt: Date;
    revokedAt?: Date | null;
  },
): Promise<void> {
  await getPool().query(
    `INSERT INTO room_seat_tokens
       (room_id, seat, client_id, token_hash, user_id, issued_at, last_seen_at, revoked_at,
        device_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (room_id, seat) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       device_id = EXCLUDED.device_id,
       token_hash = EXCLUDED.token_hash,
       user_id = EXCLUDED.user_id,
       issued_at = EXCLUDED.issued_at,
       last_seen_at = EXCLUDED.last_seen_at,
       revoked_at = EXCLUDED.revoked_at`,
    [
      roomId,
      token.seat,
      token.clientId,
      token.tokenHash,
      token.userId,
      token.issuedAt,
      token.lastSeenAt,
      token.revokedAt ?? null,
      token.deviceId ?? null,
    ],
  );
}

export async function touchRoomSeatToken(
  roomId: string,
  seat: RoomSeatTokenSeat,
  tokenHash: string,
  at: Date,
): Promise<void> {
  await getPool().query(
    `UPDATE room_seat_tokens
     SET last_seen_at = $4
     WHERE room_id = $1
       AND seat = $2
       AND token_hash = $3
       AND revoked_at IS NULL`,
    [roomId, seat, tokenHash, at],
  );
}

export async function replaceRoomSeatTokens(
  roomId: string,
  tokens: Partial<Record<RoomSeatTokenSeat, RoomSeatTokenRecord<RoomSeatTokenSeat>>>,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM room_seat_tokens WHERE room_id = $1', [roomId]);
    for (const token of Object.values(tokens)) {
      if (!token || token.revokedAt) continue;
      await client.query(
        `INSERT INTO room_seat_tokens
           (room_id, seat, client_id, token_hash, user_id, issued_at, last_seen_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          roomId,
          token.seat,
          token.clientId,
          token.tokenHash,
          token.userId,
          token.issuedAt,
          token.lastSeenAt,
          token.revokedAt,
        ],
      );
    }
  });
}

export async function verifyRoomSeatToken(
  roomId: string,
  rawSeatToken: string,
): Promise<{ seat: RoomSeatTokenSeat } | null> {
  if (!rawSeatToken) return null;
  const supplied = createHash('sha256').update(rawSeatToken).digest();
  const { rows } = await getPool().query<{ seat: RoomSeatTokenSeat; token_hash: string }>(
    `SELECT seat, token_hash
     FROM room_seat_tokens
     WHERE room_id = $1 AND revoked_at IS NULL`,
    [roomId],
  );
  for (const row of rows) {
    const expected = Buffer.from(row.token_hash, 'hex');
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) {
      return { seat: row.seat };
    }
  }
  return null;
}
