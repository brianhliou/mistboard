import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { getPool, withTransaction } from './persistence-db.js';

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
    `SELECT t.id, t.tour_slug, t.label, t.created_at, t.revoked_at, t.last_used_at
       FROM xiangqi_broadcast_push_tokens t WHERE t.token_hash = $1
        AND (t.account_id IS NULL OR EXISTS (
          SELECT 1 FROM xiangqi_broadcast_push_grants g
          JOIN users u ON u.id = g.account_id
          WHERE g.account_id = t.account_id AND g.tour_slug = t.tour_slug
            AND g.revoked_at IS NULL AND u.play_disabled_at IS NULL
        ))`,
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

export type BroadcastPushGrant = {
  tourSlug: string;
  name: string;
  tokens: XiangqiBroadcastPushToken[];
};

function tokenMetadata(row: TokenRow): XiangqiBroadcastPushToken {
  return {
    id: row.id,
    tourSlug: row.tour_slug,
    label: row.label,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

export async function listAccountBroadcastPushGrants(
  accountId: string,
): Promise<BroadcastPushGrant[]> {
  const { rows: grants } = await getPool().query<{ tour_slug: string; name: string }>(
    `SELECT g.tour_slug, t.name FROM xiangqi_broadcast_push_grants g
      JOIN xiangqi_broadcast_tours t ON t.slug = g.tour_slug
      WHERE g.account_id = $1 AND g.revoked_at IS NULL ORDER BY g.created_at, g.id`,
    [accountId],
  );
  // Explicit projection: hashes and bearer values never enter a list response.
  const { rows: tokens } = await getPool().query<TokenRow>(
    `SELECT t.id, t.tour_slug, t.label, t.created_at, t.revoked_at, t.last_used_at
      FROM xiangqi_broadcast_push_tokens t
      JOIN xiangqi_broadcast_push_grants g
        ON g.account_id = t.account_id AND g.tour_slug = t.tour_slug AND g.revoked_at IS NULL
      WHERE t.account_id = $1 ORDER BY t.created_at, t.id`,
    [accountId],
  );
  return grants.map((g) => ({
    tourSlug: g.tour_slug,
    name: g.name,
    tokens: tokens.filter((t) => t.tour_slug === g.tour_slug).map(tokenMetadata),
  }));
}

/** The grant row serializes concurrent creates with each other and grant revocation. */
export async function createAccountBroadcastPushTokenOn(
  client: Queryable,
  accountId: string,
  tourSlug: string,
  label: string,
): Promise<{ token: string; metadata: XiangqiBroadcastPushToken } | 'not_found' | 'token_limit'> {
  // Lock accounts before grants, as the operator grant/revoke commands do.
  // This also prevents a play-disable racing a token creation transaction.
  const { rows: users } = await client.query(
    'SELECT id FROM users WHERE id = $1 AND play_disabled_at IS NULL FOR SHARE',
    [accountId],
  );
  if (!users[0]) return 'not_found';
  const { rows: grants } = await client.query(
    `SELECT g.id FROM xiangqi_broadcast_push_grants g
      WHERE g.account_id = $1 AND g.tour_slug = $2 AND g.revoked_at IS NULL
        FOR UPDATE OF g`,
    [accountId, tourSlug],
  );
  if (!grants[0]) return 'not_found';
  const { rows: counts } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM xiangqi_broadcast_push_tokens
      WHERE account_id = $1 AND tour_slug = $2 AND revoked_at IS NULL`,
    [accountId, tourSlug],
  );
  if (Number(counts[0]!.count) >= 5) return 'token_limit';
  const token = `mbpush_${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  const { rows } = await client.query<TokenRow>(
    `INSERT INTO xiangqi_broadcast_push_tokens (id, account_id, tour_slug, label, token_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, tour_slug, label, created_at, revoked_at, last_used_at`,
    [`bpt_${randomBytes(4).toString('hex')}`, accountId, tourSlug, label, hash],
  );
  return { token, metadata: tokenMetadata(rows[0]!) };
}

export async function createAccountBroadcastPushToken(
  accountId: string,
  tourSlug: string,
  label: string,
) {
  return withTransaction((client) =>
    createAccountBroadcastPushTokenOn(client, accountId, tourSlug, label),
  );
}

export async function revokeAccountBroadcastPushToken(
  accountId: string,
  tourSlug: string,
  id: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE xiangqi_broadcast_push_tokens t SET revoked_at = COALESCE(t.revoked_at, now())
      WHERE t.id = $3 AND t.account_id = $1 AND t.tour_slug = $2 AND EXISTS (
        SELECT 1 FROM xiangqi_broadcast_push_grants g WHERE g.account_id = $1
          AND g.tour_slug = $2 AND g.revoked_at IS NULL)`,
    [accountId, tourSlug, id],
  );
  return (rowCount ?? 0) > 0;
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
