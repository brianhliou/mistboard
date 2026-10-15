// The achievements ledger: deriving each account's facts from existing tables,
// awarding what the shared definitions (@mistboard/game ACHIEVEMENTS) qualify,
// and reading awards back for profiles and the catalog. Table: migration 166.
//
// One path serves the live hooks (achievement-triggers.ts, a few accounts at a
// time) and the backfill (scripts/backfill-achievements.mjs, every account):
// derive facts, run the predicates, INSERT ... ON CONFLICT DO NOTHING. A rerun
// changes nothing, a missed hook is repaired by the next backfill, and the
// earliest award stands because the facts are "first X" and never move.

import {
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementDefinition,
  type AchievementFact,
  type AchievementFactKey,
  type AchievementFacts,
  type AchievementIcon,
  type AchievementSourceKind,
  type AchievementTrigger,
  achievementFactsFor,
  achievementsForTrigger,
  qualifyAchievements,
} from '@mistboard/game';
import { COUNTED_USER, notRetiredVariant, playedHumanGame } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';

export type NewAchievementAward = {
  userId: string;
  achievementId: string;
  awardedAt: Date;
  sourceKind: AchievementSourceKind;
  sourceId: string;
};

export type AchievementEvaluation = {
  // Accounts whose facts were derived.
  checkedUsers: number;
  // Per achievement: accounts whose facts qualify (held already or not).
  qualified: Record<string, number>;
  // Awards this run wrote, or in a dry run would write.
  newAwards: NewAchievementAward[];
};

export type EvaluateAchievementsInput = {
  // Re-evaluate only this trigger's definitions; all of them when omitted.
  trigger?: AchievementTrigger;
  // The accounts to evaluate; null means every account (the backfill).
  userIds: readonly string[] | null;
  // Derive and compare, write nothing.
  dryRun?: boolean;
};

type FactRow = { user_id: string; source_id: string; at: Date };

// Each fact is the account's earliest qualifying event of its kind, one row per
// account (DISTINCT ON). $1 is the account filter: an id array, or NULL for all.
// Joining users keeps it to accounts that still exist (the ledger's FK).
const GAME_SEAT = `game_participants p
     JOIN users u ON u.id = p.subject_id
     JOIN games g ON g.room_id = p.game_id
     WHERE p.subject_type = 'user'
       AND ($1::text[] IS NULL OR p.subject_id = ANY($1::text[]))
       AND ${playedHumanGame('g')}`;

function firstGameSql(extra = ''): string {
  return `SELECT DISTINCT ON (p.subject_id)
       p.subject_id AS user_id, g.room_id AS source_id, g.ended_at AS at
     FROM ${GAME_SEAT}
       ${extra}
     ORDER BY p.subject_id, g.ended_at, g.room_id`;
}

const FACT_QUERIES: Record<AchievementFactKey, { sourceKind: AchievementSourceKind; sql: string }> =
  {
    firstGame: { sourceKind: 'game', sql: firstGameSql() },
    // Against a person: both seats are people, whoever they are.
    firstPvpGame: { sourceKind: 'game', sql: firstGameSql(`AND g.mode = 'pvp'`) },
    // Rated: the seat's rating moved. games.rated defaults to true on old rows,
    // so the written elo_after is the marker (rating-store.ts), as on profiles.
    firstRatedGame: {
      sourceKind: 'game',
      sql: firstGameSql(
        `AND g.mode = 'pvp' AND COALESCE(g.rated, false) AND p.elo_after IS NOT NULL`,
      ),
    },
    // One puzzle_attempts row per (account, puzzle): the first outcome (073).
    firstSolvedPuzzle: {
      sourceKind: 'puzzle',
      sql: `SELECT DISTINCT ON (pa.user_id)
           pa.user_id, pa.puzzle_id AS source_id, pa.created_at AS at
         FROM puzzle_attempts pa
         WHERE pa.solved
           AND ($1::text[] IS NULL OR pa.user_id = ANY($1::text[]))
           AND ${notRetiredVariant('pa')}
         ORDER BY pa.user_id, pa.created_at, pa.puzzle_id`,
    },
    // A post still on the board; a moderator-hidden post never earns.
    firstForumPost: {
      sourceKind: 'forum_post',
      sql: `SELECT DISTINCT ON (fp.author_account_id)
           fp.author_account_id AS user_id, fp.id AS source_id, fp.created_at AS at
         FROM forum_posts fp
         WHERE fp.author_account_id IS NOT NULL
           AND fp.hidden_at IS NULL
           AND ($1::text[] IS NULL OR fp.author_account_id = ANY($1::text[]))
         ORDER BY fp.author_account_id, fp.created_at, fp.id`,
    },
  };

export async function deriveAchievementFacts(
  keys: readonly AchievementFactKey[],
  userIds: readonly string[] | null,
): Promise<Map<string, AchievementFacts>> {
  const facts = new Map<string, AchievementFacts>();
  const ids = userIds ? [...userIds] : null;
  for (const key of keys) {
    const query = FACT_QUERIES[key];
    const { rows } = await getPool().query<FactRow>(query.sql, [ids]);
    for (const row of rows) {
      const fact: AchievementFact = {
        at: row.at,
        sourceKind: query.sourceKind,
        sourceId: String(row.source_id),
      };
      const entry = facts.get(row.user_id) ?? {};
      entry[key] = fact;
      facts.set(row.user_id, entry);
    }
  }
  return facts;
}

// Write awards; an (account, achievement) already in the ledger is left as it
// was. Returns only the rows this call inserted.
export async function awardAchievements(
  awards: readonly NewAchievementAward[],
): Promise<NewAchievementAward[]> {
  if (awards.length === 0) return [];
  const { rows } = await getPool().query<{
    user_id: string;
    achievement_id: string;
    awarded_at: Date;
    source_kind: AchievementSourceKind;
    source_id: string;
  }>(
    `INSERT INTO user_achievements (user_id, achievement_id, awarded_at, source_kind, source_id)
     SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[], $5::text[])
     ON CONFLICT (user_id, achievement_id) DO NOTHING
     RETURNING user_id, achievement_id, awarded_at, source_kind, source_id`,
    [
      awards.map((a) => a.userId),
      awards.map((a) => a.achievementId),
      awards.map((a) => a.awardedAt),
      awards.map((a) => a.sourceKind),
      awards.map((a) => a.sourceId),
    ],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    achievementId: row.achievement_id,
    awardedAt: row.awarded_at,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
  }));
}

async function heldAchievementKeys(userIds: readonly string[] | null): Promise<Set<string>> {
  const { rows } = await getPool().query<{ user_id: string; achievement_id: string }>(
    `SELECT user_id, achievement_id FROM user_achievements
     WHERE $1::text[] IS NULL OR user_id = ANY($1::text[])`,
    [userIds ? [...userIds] : null],
  );
  return new Set(rows.map((row) => `${row.user_id}\u0000${row.achievement_id}`));
}

export async function evaluateAchievements(
  input: EvaluateAchievementsInput,
): Promise<AchievementEvaluation> {
  const userIds = input.userIds ? [...new Set(input.userIds.filter(Boolean))] : null;
  const empty: AchievementEvaluation = { checkedUsers: 0, qualified: {}, newAwards: [] };
  if (userIds && userIds.length === 0) return empty;

  let definitions: readonly AchievementDefinition[] = achievementsForTrigger(input.trigger);
  const held = await heldAchievementKeys(userIds);
  // Live path: skip the fact queries for definitions every target already holds.
  if (userIds) {
    definitions = definitions.filter((definition) =>
      userIds.some((userId) => !held.has(`${userId}\u0000${definition.id}`)),
    );
    if (definitions.length === 0) return { ...empty, checkedUsers: userIds.length };
  }

  const facts = await deriveAchievementFacts(achievementFactsFor(definitions), userIds);
  const qualified: Record<string, number> = {};
  const pending: NewAchievementAward[] = [];
  for (const [userId, userFacts] of facts) {
    for (const award of qualifyAchievements(userFacts, definitions)) {
      qualified[award.achievementId] = (qualified[award.achievementId] ?? 0) + 1;
      if (held.has(`${userId}\u0000${award.achievementId}`)) continue;
      pending.push({ userId, ...award });
    }
  }
  const newAwards = input.dryRun ? pending : await awardAchievements(pending);
  return { checkedUsers: userIds ? userIds.length : facts.size, qualified, newAwards };
}

export type UserAchievement = {
  id: string;
  awardedAt: Date;
};

// An account's awards, oldest first, limited to ids the catalog still defines
// (a row for a removed definition stays in the ledger but is not shown).
// source_id stays server-side: it can name a private game or a hidden post.
export async function getUserAchievements(userId: string): Promise<UserAchievement[]> {
  const { rows } = await getPool().query<{ achievement_id: string; awarded_at: Date }>(
    `SELECT achievement_id, awarded_at FROM user_achievements
     WHERE user_id = $1 AND achievement_id = ANY($2::text[])
     ORDER BY awarded_at, achievement_id`,
    [userId, ACHIEVEMENTS.map((definition) => definition.id)],
  );
  return rows.map((row) => ({ id: row.achievement_id, awardedAt: row.awarded_at }));
}

// The profile's read: null when no such handle, or the profile is private and
// the viewer is not its owner (the same gate as getUserProfileByHandle).
export async function getUserAchievementsByHandle(
  handle: string,
  viewerUserId: string | null,
): Promise<UserAchievement[] | null> {
  const { rows } = await getPool().query<{ id: string; profile_visibility: string }>(
    `SELECT id, profile_visibility FROM users WHERE lower(handle) = lower($1) LIMIT 1`,
    [handle],
  );
  const user = rows[0];
  if (!user) return null;
  if (user.profile_visibility === 'private' && viewerUserId !== user.id) return null;
  return getUserAchievements(user.id);
}

export type AchievementCatalogEntry = {
  id: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  titleKey: string;
  descriptionKey: string;
  // Accounts holding it, stats-excluded accounts left out.
  holders: number;
};

export type AchievementCatalog = {
  achievements: AchievementCatalogEntry[];
  // Accounts the holder counts are out of (stats-excluded left out), so a
  // client can show rarity as a share.
  accounts: number;
};

export async function getAchievementCatalog(): Promise<AchievementCatalog> {
  const [holderResult, accountResult] = await Promise.all([
    getPool().query<{ achievement_id: string; holders: string }>(
      `SELECT achievement_id, COUNT(*)::text AS holders
       FROM user_achievements
       WHERE user_id IN (SELECT id FROM users WHERE ${COUNTED_USER})
       GROUP BY achievement_id`,
    ),
    getPool().query<{ accounts: string }>(
      `SELECT COUNT(*)::text AS accounts FROM users WHERE ${COUNTED_USER}`,
    ),
  ]);
  const holders = new Map(
    holderResult.rows.map((row) => [row.achievement_id, Number(row.holders)]),
  );
  return {
    achievements: ACHIEVEMENTS.map((definition) => ({
      id: definition.id,
      category: definition.category,
      icon: definition.icon,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      holders: holders.get(definition.id) ?? 0,
    })),
    accounts: Number(accountResult.rows[0]?.accounts ?? 0),
  };
}
