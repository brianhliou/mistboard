import { createHash } from 'node:crypto';
import type pg from 'pg';
import { getPool } from './persistence-db.js';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

/** Safe metadata only. Never return the hash to request handlers or loggers. */
export type XiangqiBroadcastPushToken = {
  id: string;
  tourSlug: string;
  label: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

type TokenRow = {
  id: string;
  tour_slug: string;
  label: string;
  created_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
};

/** Read-only, including for revoked tokens so auth can distinguish 401/403.
 * The status endpoint must use this without touching last_used_at. */
export async function findXiangqiBroadcastPushTokenOn(
  client: Queryable,
  token: string,
): Promise<XiangqiBroadcastPushToken | null> {
  if (!/^mbpush_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const { rows } = await client.query<TokenRow>(
    `SELECT id, tour_slug, label, created_at, revoked_at, last_used_at
       FROM xiangqi_broadcast_push_tokens WHERE token_hash = $1`,
    [hash],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        tourSlug: row.tour_slug,
        label: row.label,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
        lastUsedAt: row.last_used_at,
      }
    : null;
}

export async function findXiangqiBroadcastPushToken(
  token: string,
): Promise<XiangqiBroadcastPushToken | null> {
  return await findXiangqiBroadcastPushTokenOn(getPool(), token);
}

/** SQL enforces the one-minute bound across processes and concurrent requests. */
export async function touchXiangqiBroadcastPushTokenOn(
  client: Queryable,
  id: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE xiangqi_broadcast_push_tokens SET last_used_at = now()
      WHERE id = $1 AND revoked_at IS NULL
        AND (last_used_at IS NULL OR last_used_at <= now() - interval '1 minute')`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function touchXiangqiBroadcastPushToken(id: string): Promise<boolean> {
  return await touchXiangqiBroadcastPushTokenOn(getPool(), id);
}

export async function revokeXiangqiBroadcastPushTokenOn(
  client: Queryable,
  id: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE xiangqi_broadcast_push_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}
