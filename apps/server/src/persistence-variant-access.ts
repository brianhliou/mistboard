// Per-account access to a gated variant (136).
//
// The rule this encodes: a variant can be live in the code, registered, and
// reachable by URL, and still be playable only by people who were let in by
// hand. That is the state a variant should be in while its rules are written
// but not yet trusted by anyone who plays the game for real.
//
// Fail-closed. An allowlisted spec is refused unless a row says otherwise, so
// forgetting to grant somebody shows up as "I can't get in", never as a
// stranger quietly playing a variant whose scoring nobody has checked.

import type { GameSpecId } from '@mistboard/game';
import type pg from 'pg';
import { getPool } from './persistence-db.js';

type VariantAccessDatabase = pg.Pool | pg.PoolClient;

/**
 * Specs that need a grant on top of their feature flag.
 *
 * Membership is a statement about TRUST, not about readiness: a spec belongs
 * here while the code runs but its rules have not been checked by somebody who
 * plays the game. Take a spec out of this list when that check has happened,
 * not when the build goes green.
 */
export const ALLOWLISTED_GAME_SPEC_IDS = ['mahjong'] as const satisfies readonly GameSpecId[];

const ALLOWLISTED: ReadonlySet<GameSpecId> = new Set(ALLOWLISTED_GAME_SPEC_IDS);

/** Whether this spec consults the grant table at all. */
export function isAllowlistedGameSpec(gameSpecId: string): boolean {
  return ALLOWLISTED.has(gameSpecId as GameSpecId);
}

/**
 * May this account take a seat in this variant?
 *
 * Signed-out callers are refused for an allowlisted spec, because a grant is
 * per account and an anonymous visitor has none. Every non-allowlisted spec is
 * allowed here and gated by its feature flag as before, so this is safe to call
 * unconditionally on the seat path.
 */
export async function mayPlayVariant(
  userId: string | null,
  gameSpecId: string,
  // Resolved lazily, NOT as a default argument. A default is evaluated before
  // the body runs, so `database = getPool()` would demand an initialized pool
  // on every seat assignment in the whole server, including the variants that
  // return on the first line without querying anything. That broke every
  // in-memory ws test the moment this call was added.
  database?: VariantAccessDatabase,
): Promise<boolean> {
  if (!isAllowlistedGameSpec(gameSpecId)) return true;
  if (!userId) return false;
  const result = await (database ?? getPool()).query(
    `SELECT 1 FROM variant_access_grants WHERE user_id = $1 AND game_spec_id = $2`,
    [userId, gameSpecId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export type VariantGrant = {
  userId: string;
  gameSpecId: string;
  grantedAt: Date;
  note: string | null;
};

/** Idempotent: re-granting refreshes the note and leaves the original date. */
export async function grantVariantAccess(
  userId: string,
  gameSpecId: string,
  note: string | null = null,
  database: VariantAccessDatabase = getPool(),
): Promise<void> {
  await database.query(
    `INSERT INTO variant_access_grants (user_id, game_spec_id, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, game_spec_id) DO UPDATE SET note = EXCLUDED.note`,
    [userId, gameSpecId, note],
  );
}

/** Revoking does not disturb a seat the account already holds; see seat-session. */
export async function revokeVariantAccess(
  userId: string,
  gameSpecId: string,
  database: VariantAccessDatabase = getPool(),
): Promise<void> {
  await database.query(
    `DELETE FROM variant_access_grants WHERE user_id = $1 AND game_spec_id = $2`,
    [userId, gameSpecId],
  );
}

/** Everyone currently holding a grant for a spec. Operator-facing. */
export async function listVariantGrants(
  gameSpecId: string,
  database: VariantAccessDatabase = getPool(),
): Promise<VariantGrant[]> {
  const result = await database.query<{
    user_id: string;
    game_spec_id: string;
    granted_at: Date;
    note: string | null;
  }>(
    `SELECT user_id, game_spec_id, granted_at, note
       FROM variant_access_grants
      WHERE game_spec_id = $1
      ORDER BY granted_at`,
    [gameSpecId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    gameSpecId: row.game_spec_id,
    grantedAt: row.granted_at,
    note: row.note,
  }));
}
