// Follow/block persistence (the social kernel). Directed edges in
// user_relations: one row per (actor, target) pair, relation ∈ follow|block.
// Semantics follow the lichess relation model:
//   - blocking upserts over the actor's own prior follow (a pair holds one
//     relation per direction) and severs the target's follow of the actor;
//   - following silently no-ops when the target has blocked the actor, so the
//     actor cannot probe who blocked them;
//   - lists and counts are self-only surfaces. Since 2026-10-08 that includes
//     the Followers list: the followed account sees who follows it, nobody
//     else does, and there is no public followers count.
// The block edge is also the send gate the inbox slice (#88) will consume via
// hasBlock().

import { linkableHandleSql } from './persistence-correspondence-seeks.js';
import { getPool } from './persistence-db.js';
import type { PlayerTitle } from './persistence-titles.js';

export type UserRelationKind = 'follow' | 'block';

export type RelationListEntry = {
  // Server-internal: lets the route batch-decorate rows (ratings, game totals)
  // without N handle lookups. Routes must not serialize user ids to clients.
  targetId: string;
  handle: string;
  displayName: string;
  // Verified player title (088), null for everyone else.
  title: PlayerTitle | null;
  createdAt: Date;
  // Durable users.last_seen_at (087). NULL for accounts with no recorded
  // activity since the column landed; clients render a quiet fallback.
  lastSeenAt: Date | null;
};

export type RelationListPage = {
  entries: RelationListEntry[];
  total: number;
};

// Both directions of a viewer↔other pair in one round-trip. blockedBy is
// server-internal (inbox gate); routes must not serialize it to the viewer.
export type RelationsBetween = {
  following: boolean;
  blocked: boolean;
  blockedBy: boolean;
};

export const FOLLOW_CAP = 400;

export type FollowResult =
  | { ok: true }
  | { ok: false; error: 'follow_limit_reached' | 'unknown_user' | 'self_relation' };

export type RelationWriteResult =
  | { ok: true }
  | { ok: false; error: 'unknown_user' | 'self_relation' };

// Follow: upserts over the actor's own block (matching lichess, where the
// shared primary key makes follow-after-block an overwrite). Returns ok
// without writing when the target has blocked the actor — the caller must not
// be able to distinguish that from a successful follow.
export async function followUser(input: {
  actorId: string;
  targetHandle: string;
  now?: Date;
  followCap?: number;
}): Promise<FollowResult> {
  const targetId = await findUserIdByHandle(input.targetHandle);
  if (!targetId) return { ok: false, error: 'unknown_user' };
  if (targetId === input.actorId) return { ok: false, error: 'self_relation' };

  const cap = input.followCap ?? FOLLOW_CAP;
  const following = await countFollowing(input.actorId);
  if (following >= cap) return { ok: false, error: 'follow_limit_reached' };

  await getPool().query(
    `INSERT INTO user_relations (actor_id, target_id, relation, created_at)
     SELECT $1, $2, 'follow', $3
     WHERE NOT EXISTS (
       SELECT 1 FROM user_relations
       WHERE actor_id = $2 AND target_id = $1 AND relation = 'block'
     )
     ON CONFLICT (actor_id, target_id)
       DO UPDATE SET relation = 'follow', created_at = EXCLUDED.created_at`,
    [input.actorId, targetId, input.now ?? new Date()],
  );
  return { ok: true };
}

export async function unfollowUser(input: {
  actorId: string;
  targetHandle: string;
}): Promise<RelationWriteResult> {
  return deleteRelation(input.actorId, input.targetHandle, 'follow');
}

// Block: upserts over the actor's own follow AND deletes the reverse follow,
// so a block severs the pair's follow edges in both directions.
export async function blockUser(input: {
  actorId: string;
  targetHandle: string;
  now?: Date;
}): Promise<RelationWriteResult> {
  const targetId = await findUserIdByHandle(input.targetHandle);
  if (!targetId) return { ok: false, error: 'unknown_user' };
  if (targetId === input.actorId) return { ok: false, error: 'self_relation' };

  const pool = getPool();
  await pool.query(
    `INSERT INTO user_relations (actor_id, target_id, relation, created_at)
     VALUES ($1, $2, 'block', $3)
     ON CONFLICT (actor_id, target_id)
       DO UPDATE SET relation = 'block', created_at = EXCLUDED.created_at`,
    [input.actorId, targetId, input.now ?? new Date()],
  );
  await pool.query(
    `DELETE FROM user_relations
     WHERE actor_id = $1 AND target_id = $2 AND relation = 'follow'`,
    [targetId, input.actorId],
  );
  return { ok: true };
}

export async function unblockUser(input: {
  actorId: string;
  targetHandle: string;
}): Promise<RelationWriteResult> {
  return deleteRelation(input.actorId, input.targetHandle, 'block');
}

export async function countFollowing(actorId: string): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM user_relations
     WHERE actor_id = $1 AND relation = 'follow'`,
    [actorId],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

// The inbox send gate: has `blockerId` blocked `blockedId`?
export async function hasBlock(blockerId: string, blockedId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM user_relations
     WHERE actor_id = $1 AND target_id = $2 AND relation = 'block'
     LIMIT 1`,
    [blockerId, blockedId],
  );
  return rows.length > 0;
}

// The online-friends box (#94): the viewer's followed user ids, bounded by
// the follow cap, for intersecting with the in-memory presence map.
export async function listFollowingIds(actorId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ target_id: string }>(
    `SELECT target_id FROM user_relations
     WHERE actor_id = $1 AND relation = 'follow'
     LIMIT ${FOLLOW_CAP}`,
    [actorId],
  );
  return rows.map((row) => row.target_id);
}

// The friends-only DM policy gate: does `actorId` follow `targetId`?
export async function hasFollow(actorId: string, targetId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM user_relations
     WHERE actor_id = $1 AND target_id = $2 AND relation = 'follow'
     LIMIT 1`,
    [actorId, targetId],
  );
  return rows.length > 0;
}

export async function listRelations(
  actorId: string,
  relation: UserRelationKind,
  offset: number,
  limit: number,
): Promise<RelationListPage> {
  const { rows } = await getPool().query<{
    target_id: string;
    handle: string;
    display_name: string;
    title: PlayerTitle | null;
    created_at: Date;
    last_seen_at: Date | null;
    total_count: string;
  }>(
    `SELECT users.id AS target_id, users.handle, users.display_name, users.title,
            user_relations.created_at, users.last_seen_at,
            COUNT(*) OVER() AS total_count
     FROM user_relations
     JOIN users ON users.id = user_relations.target_id
     WHERE user_relations.actor_id = $1 AND user_relations.relation = $2
     ORDER BY user_relations.created_at DESC, users.handle ASC
     OFFSET $3 LIMIT $4`,
    [actorId, relation, offset, limit],
  );
  return {
    entries: rows.map((row) => ({
      targetId: row.target_id,
      handle: row.handle,
      displayName: row.display_name,
      title: row.title,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    })),
    total: parseInt(rows[0]?.total_count ?? '0', 10),
  };
}

// Which incoming follows the followed account gets to see, as a WHERE fragment
// over a follow row `rel` and its actor `actor`. Shared by the Followers list
// and the bell's new-follower rows so the badge never counts someone the list
// leaves out. Excluded: anyone the owner has blocked (blocking severs their
// follow, so this only guards rows that predate that rule), and closed
// accounts (closure deletes relations; same defensive posture). Play-locked
// accounts stay listed: the lock gates seats, not social edges, and the
// following list does not filter them either.
export function visibleFollowerSql(rel: string, actor: string): string {
  return `${actor}.closed_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_relations blk
            WHERE blk.actor_id = ${rel}.target_id
              AND blk.target_id = ${rel}.actor_id
              AND blk.relation = 'block'
          )`;
}

export type FollowerListEntry = {
  // Server-internal, like RelationListEntry.targetId; never serialized.
  actorId: string;
  // Null unless the follower's profile may be linked (linkableHandleSql): a
  // private profile shows its name with no link, as on every other surface.
  handle: string | null;
  displayName: string;
  title: PlayerTitle | null;
  createdAt: Date;
};

export type FollowerListPage = {
  entries: FollowerListEntry[];
  total: number;
};

// The accounts that follow `ownerId`, newest follow first. Self-only by
// construction: the only key is the owner's id, which routes take from the
// session, never from the request.
export async function listFollowers(
  ownerId: string,
  offset: number,
  limit: number,
): Promise<FollowerListPage> {
  const { rows } = await getPool().query<{
    actor_id: string;
    handle: string | null;
    display_name: string;
    title: PlayerTitle | null;
    created_at: Date;
    total_count: string;
  }>(
    `SELECT f.id AS actor_id, ${linkableHandleSql('f')} AS handle,
            COALESCE(NULLIF(f.display_name, ''), f.handle) AS display_name, f.title,
            r.created_at, COUNT(*) OVER() AS total_count
     FROM user_relations r
     JOIN users f ON f.id = r.actor_id
     WHERE r.target_id = $1 AND r.relation = 'follow'
       AND ${visibleFollowerSql('r', 'f')}
     ORDER BY r.created_at DESC, f.handle ASC
     OFFSET $2 LIMIT $3`,
    [ownerId, offset, limit],
  );
  return {
    entries: rows.map((row) => ({
      actorId: row.actor_id,
      handle: row.handle,
      displayName: row.display_name,
      title: row.title,
      createdAt: row.created_at,
    })),
    total: parseInt(rows[0]?.total_count ?? '0', 10),
  };
}

// The signed-in viewer's relation to a profile, resolved by handle so the
// profile route doesn't need the target's user id. Null when the handle is
// unknown or resolves to the viewer themselves.
export async function viewerRelationForHandle(
  viewerId: string,
  handle: string,
): Promise<RelationsBetween | null> {
  const targetId = await findUserIdByHandle(handle);
  if (!targetId || targetId === viewerId) return null;

  const { rows } = await getPool().query<{
    actor_id: string;
    relation: UserRelationKind;
  }>(
    `SELECT actor_id, relation FROM user_relations
     WHERE (actor_id = $1 AND target_id = $2)
        OR (actor_id = $2 AND target_id = $1)`,
    [viewerId, targetId],
  );
  const result: RelationsBetween = { following: false, blocked: false, blockedBy: false };
  for (const row of rows) {
    if (row.actor_id === viewerId) {
      if (row.relation === 'follow') result.following = true;
      if (row.relation === 'block') result.blocked = true;
    } else if (row.relation === 'block') {
      result.blockedBy = true;
    }
  }
  return result;
}

async function deleteRelation(
  actorId: string,
  targetHandle: string,
  relation: UserRelationKind,
): Promise<RelationWriteResult> {
  const targetId = await findUserIdByHandle(targetHandle);
  if (!targetId) return { ok: false, error: 'unknown_user' };
  if (targetId === actorId) return { ok: false, error: 'self_relation' };
  await getPool().query(
    `DELETE FROM user_relations
     WHERE actor_id = $1 AND target_id = $2 AND relation = $3`,
    [actorId, targetId, relation],
  );
  return { ok: true };
}

async function findUserIdByHandle(handle: string): Promise<string | null> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM users WHERE lower(handle) = lower($1) LIMIT 1`,
    [handle],
  );
  return rows[0]?.id ?? null;
}
