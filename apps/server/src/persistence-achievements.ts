// The achievements ledger: deriving each account's facts (first events) and
// counts (the leveling families, e.g. wins at 10 / 50 / 100 / 500) from existing tables,
// awarding what the shared definitions (@mistboard/game ACHIEVEMENTS) qualify,
// and reading awards back for profiles and the catalog. Table: migration 166.
//
// One path serves the live hooks (achievement-triggers.ts, a few accounts at a
// time) and the backfill (scripts/backfill-achievements.mjs, every account):
// derive facts, run the predicates, INSERT ... ON CONFLICT DO NOTHING. A rerun
// changes nothing, a missed hook is repaired by the next backfill, and the
// earliest award stands because the facts are "first X" and never move.

import {
  ACHIEVEMENT_AWARD_IDS,
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementCount,
  type AchievementCounterKey,
  type AchievementCounts,
  type AchievementDefinition,
  type AchievementFact,
  type AchievementFactKey,
  type AchievementFacts,
  type AchievementFamilyDefinition,
  type AchievementFamilyProgress,
  type AchievementIcon,
  type AchievementMetal,
  type AchievementSourceKind,
  type AchievementTier,
  type AchievementTrigger,
  achievementCountersFor,
  achievementFactsFor,
  achievementFamiliesForTrigger,
  achievementFamilyProgress,
  achievementLevelId,
  achievementsForTrigger,
  qualifyAchievementLevels,
  qualifyAchievements,
} from '@mistboard/game';
import {
  COUNTED_USER,
  notRetiredVariant,
  playedHumanGame,
  seatWonGame,
} from './persistence-counted-games.js';
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
  // Per award id (a single, or a family level such as `wins:50`): accounts
  // whose facts or counts qualify (held already or not).
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

// Counters for the leveling families (achievements.ts ACHIEVEMENT_FAMILIES).
// Each query numbers the account's qualifying events oldest first and returns
// the row at each requested threshold ($2) plus the last row, whose n is the
// total; so one pass gives both the count and the event that reached each
// level. $1 is the account filter, as for facts.
type CounterRow = { user_id: string; source_id: string; at: Date; n: string; total: string };

const COUNTER_QUERIES: Record<
  AchievementCounterKey,
  { sourceKind: AchievementSourceKind; sql: string }
> = {
  // A win from the account's seat in any game that counts toward its own
  // record (playedHumanGame), against a person or a bot alike.
  wins: {
    sourceKind: 'game',
    sql: `SELECT user_id, source_id, at, n::text, total::text FROM (
         SELECT p.subject_id AS user_id, g.room_id AS source_id, g.ended_at AS at,
           ROW_NUMBER() OVER (PARTITION BY p.subject_id ORDER BY g.ended_at, g.room_id) AS n,
           COUNT(*) OVER (PARTITION BY p.subject_id) AS total
         FROM ${GAME_SEAT}
           AND ${seatWonGame('p', 'g')}
       ) numbered
       WHERE n = ANY($2::int[]) OR n = total`,
  },
};

export async function deriveAchievementCounts(
  counters: ReadonlyMap<AchievementCounterKey, readonly number[]>,
  userIds: readonly string[] | null,
): Promise<Map<string, AchievementCounts>> {
  const counts = new Map<string, AchievementCounts>();
  const ids = userIds ? [...userIds] : null;
  for (const [key, thresholds] of counters) {
    const query = COUNTER_QUERIES[key];
    const { rows } = await getPool().query<CounterRow>(query.sql, [ids, [...thresholds]]);
    for (const row of rows) {
      const entry = counts.get(row.user_id) ?? {};
      const counter: AchievementCount = entry[key] ?? { count: Number(row.total), reached: {} };
      const n = Number(row.n);
      if (thresholds.includes(n)) {
        (counter.reached as Record<number, AchievementFact>)[n] = {
          at: row.at,
          sourceKind: query.sourceKind,
          sourceId: String(row.source_id),
        };
      }
      entry[key] = counter;
      counts.set(row.user_id, entry);
    }
  }
  return counts;
}

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

function familyLevelIds(family: AchievementFamilyDefinition): string[] {
  return family.levels.map((level) => achievementLevelId(family.id, level.threshold));
}

export async function evaluateAchievements(
  input: EvaluateAchievementsInput,
): Promise<AchievementEvaluation> {
  const userIds = input.userIds ? [...new Set(input.userIds.filter(Boolean))] : null;
  const empty: AchievementEvaluation = { checkedUsers: 0, qualified: {}, newAwards: [] };
  if (userIds && userIds.length === 0) return empty;

  let definitions: readonly AchievementDefinition[] = achievementsForTrigger(input.trigger);
  let families: readonly AchievementFamilyDefinition[] = achievementFamiliesForTrigger(
    input.trigger,
  );
  const held = await heldAchievementKeys(userIds);
  // Live path: skip the queries for what every target already holds (for a
  // family, its top level).
  if (userIds) {
    const missing = (id: string) => userIds.some((userId) => !held.has(`${userId}\u0000${id}`));
    definitions = definitions.filter((definition) => missing(definition.id));
    families = families.filter((family) => familyLevelIds(family).some(missing));
    if (definitions.length === 0 && families.length === 0) {
      return { ...empty, checkedUsers: userIds.length };
    }
  }

  const [facts, counts] = await Promise.all([
    definitions.length > 0
      ? deriveAchievementFacts(achievementFactsFor(definitions), userIds)
      : new Map<string, AchievementFacts>(),
    families.length > 0
      ? deriveAchievementCounts(achievementCountersFor(families), userIds)
      : new Map<string, AchievementCounts>(),
  ]);
  const qualified: Record<string, number> = {};
  const pending: NewAchievementAward[] = [];
  const consider = (userId: string, awards: ReturnType<typeof qualifyAchievements>) => {
    for (const award of awards) {
      qualified[award.achievementId] = (qualified[award.achievementId] ?? 0) + 1;
      if (held.has(`${userId}\u0000${award.achievementId}`)) continue;
      pending.push({ userId, ...award });
    }
  };
  for (const [userId, userFacts] of facts)
    consider(userId, qualifyAchievements(userFacts, definitions));
  for (const [userId, userCounts] of counts) {
    consider(userId, qualifyAchievementLevels(userCounts, families));
  }
  const newAwards = input.dryRun ? pending : await awardAchievements(pending);
  const accounts = new Set([...facts.keys(), ...counts.keys()]);
  return { checkedUsers: userIds ? userIds.length : accounts.size, qualified, newAwards };
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
    [userId, ACHIEVEMENT_AWARD_IDS],
  );
  return rows.map((row) => ({ id: row.achievement_id, awardedAt: row.awarded_at }));
}

// Where the account stands in each family: levels held (from the ledger, so a
// level is never lost), the live count, and the next threshold.
export async function getUserAchievementProgress(
  userId: string,
  held: readonly UserAchievement[],
): Promise<AchievementFamilyProgress[]> {
  const heldIds = new Set(held.map((award) => award.id));
  const counts = await deriveAchievementCounts(achievementCountersFor(ACHIEVEMENT_FAMILIES), [
    userId,
  ]);
  const userCounts = counts.get(userId) ?? {};
  return ACHIEVEMENT_FAMILIES.map((family) =>
    achievementFamilyProgress(family, heldIds, userCounts[family.counter]?.count ?? 0),
  );
}

export type UserAchievementsPage = {
  achievements: UserAchievement[];
  families: AchievementFamilyProgress[];
};

// The profile's read: null when no such handle, or the profile is private and
// the viewer is not its owner (the same gate as getUserProfileByHandle).
export async function getUserAchievementsByHandle(
  handle: string,
  viewerUserId: string | null,
): Promise<UserAchievementsPage | null> {
  const { rows } = await getPool().query<{ id: string; profile_visibility: string }>(
    `SELECT id, profile_visibility FROM users WHERE lower(handle) = lower($1) LIMIT 1`,
    [handle],
  );
  const user = rows[0];
  if (!user) return null;
  if (user.profile_visibility === 'private' && viewerUserId !== user.id) return null;
  const achievements = await getUserAchievements(user.id);
  return { achievements, families: await getUserAchievementProgress(user.id, achievements) };
}

export type AchievementCatalogEntry = {
  id: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  tier: AchievementTier;
  titleKey: string;
  descriptionKey: string;
  hintKey: string;
  // Accounts holding it, stats-excluded accounts left out.
  holders: number;
};

export type AchievementFamilyCatalogEntry = {
  id: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  titleKey: string;
  descriptionKey: string;
  hintKey: string;
  // Each level's award id and its holders, stats-excluded accounts left out.
  levels: Array<{ id: string; threshold: number; metal: AchievementMetal; holders: number }>;
};

export type AchievementCatalog = {
  achievements: AchievementCatalogEntry[];
  families: AchievementFamilyCatalogEntry[];
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
      tier: definition.tier,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      hintKey: definition.hintKey,
      holders: holders.get(definition.id) ?? 0,
    })),
    families: ACHIEVEMENT_FAMILIES.map((family) => ({
      id: family.id,
      category: family.category,
      icon: family.icon,
      titleKey: family.titleKey,
      descriptionKey: family.descriptionKey,
      hintKey: family.hintKey,
      levels: family.levels.map((level) => {
        const id = achievementLevelId(family.id, level.threshold);
        return {
          id,
          threshold: level.threshold,
          metal: level.metal,
          holders: holders.get(id) ?? 0,
        };
      }),
    })),
    accounts: Number(accountResult.rows[0]?.accounts ?? 0),
  };
}
