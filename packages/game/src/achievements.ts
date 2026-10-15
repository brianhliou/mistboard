// Achievement definitions as data: the one catalog the server evaluates and
// the web client renders (docs-private/competitive-layer-2026-10.md section d,
// approved 2026-10-14). Adding an achievement is one entry here, its strings in
// the web community catalogs, and a backfill run
// (scripts/backfill-achievements.mjs); the ledger and the hooks do not change.
//
// Each definition is a pure predicate over per-account FACTS, which the server
// derives from existing tables (apps/server/src/persistence-achievements.ts,
// one SQL query per fact). The live hooks and the backfill go through the same
// facts and the same predicates, so a missed hook is caught by the next
// backfill and a backfill can never award something the live path would not.
//
// Bot-ladder badges (per-level checkmarks, "beat the top bot") stay out:
// skipped by Brian on 2026-09-15 (memory streaks_and_digest_settled), and the
// design doc holds them for his word. Retired variants never award (the facts
// leave their games and puzzles out). Awards are never revoked.

export type AchievementTrigger = 'game_end' | 'puzzle_attempt' | 'forum_post';

export type AchievementCategory = 'play' | 'puzzles' | 'community';

// What the ledger row points back to. 'study' and 'tournament' are reserved for
// the study and arena-trophy kinds the design names; nothing awards them yet.
export type AchievementSourceKind = 'game' | 'puzzle' | 'forum_post' | 'study' | 'tournament';

// One derived fact per key: the account's first qualifying event of that kind.
export type AchievementFactKey =
  | 'firstGame'
  | 'firstPvpGame'
  | 'firstRatedGame'
  | 'firstSolvedPuzzle'
  | 'firstForumPost';

export type AchievementFact = {
  at: Date;
  sourceKind: AchievementSourceKind;
  sourceId: string;
};

export type AchievementFacts = Partial<Record<AchievementFactKey, AchievementFact>>;

export type AchievementAward = {
  awardedAt: Date;
  sourceKind: AchievementSourceKind;
  sourceId: string;
};

// Semantic glyph names; the web maps each to a Lucide icon (ui-icon.ts).
export type AchievementIcon = 'first-game' | 'versus' | 'rated' | 'puzzle' | 'forum';

export type AchievementDefinition = {
  id: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  // Web i18n keys (community domain, `profile.` prefix).
  titleKey: string;
  descriptionKey: string;
  // The events after which the live path re-evaluates this definition.
  triggers: readonly AchievementTrigger[];
  // The facts the predicate reads; the server derives only these.
  facts: readonly AchievementFactKey[];
  qualify(facts: AchievementFacts): AchievementAward | null;
};

// The first event of a kind is the award: when it happened and what it was.
function firstOf(key: AchievementFactKey): (facts: AchievementFacts) => AchievementAward | null {
  return (facts) => {
    const fact = facts[key];
    if (!fact) return null;
    return { awardedAt: fact.at, sourceKind: fact.sourceKind, sourceId: fact.sourceId };
  };
}

export const ACHIEVEMENTS = [
  {
    id: 'first-game',
    category: 'play',
    icon: 'first-game',
    titleKey: 'profile.achievementFirstGame',
    descriptionKey: 'profile.achievementFirstGameDesc',
    triggers: ['game_end'],
    facts: ['firstGame'],
    qualify: firstOf('firstGame'),
  },
  {
    id: 'first-pvp',
    category: 'play',
    icon: 'versus',
    titleKey: 'profile.achievementFirstPvp',
    descriptionKey: 'profile.achievementFirstPvpDesc',
    triggers: ['game_end'],
    facts: ['firstPvpGame'],
    qualify: firstOf('firstPvpGame'),
  },
  {
    id: 'first-rated',
    category: 'play',
    icon: 'rated',
    titleKey: 'profile.achievementFirstRated',
    descriptionKey: 'profile.achievementFirstRatedDesc',
    triggers: ['game_end'],
    facts: ['firstRatedGame'],
    qualify: firstOf('firstRatedGame'),
  },
  {
    id: 'first-puzzle',
    category: 'puzzles',
    icon: 'puzzle',
    titleKey: 'profile.achievementFirstPuzzle',
    descriptionKey: 'profile.achievementFirstPuzzleDesc',
    triggers: ['puzzle_attempt'],
    facts: ['firstSolvedPuzzle'],
    qualify: firstOf('firstSolvedPuzzle'),
  },
  {
    id: 'first-forum-post',
    category: 'community',
    icon: 'forum',
    titleKey: 'profile.achievementFirstForumPost',
    descriptionKey: 'profile.achievementFirstForumPostDesc',
    triggers: ['forum_post'],
    facts: ['firstForumPost'],
    qualify: firstOf('firstForumPost'),
  },
] as const satisfies readonly AchievementDefinition[];

export type AchievementId = (typeof ACHIEVEMENTS)[number]['id'];

// Ledger ids: lowercase slugs, room for a later `arena:<id>:1` trophy id.
export const ACHIEVEMENT_ID_PATTERN = /^[a-z0-9][a-z0-9:-]{0,79}$/;

const BY_ID = new Map<string, AchievementDefinition>(
  ACHIEVEMENTS.map((definition) => [definition.id, definition]),
);

export function getAchievementDefinition(id: string): AchievementDefinition | null {
  return BY_ID.get(id) ?? null;
}

// The definitions a trigger re-evaluates; every definition when none is given
// (the backfill).
export function achievementsForTrigger(
  trigger?: AchievementTrigger,
): readonly AchievementDefinition[] {
  if (!trigger) return ACHIEVEMENTS;
  return ACHIEVEMENTS.filter((definition) =>
    (definition.triggers as readonly AchievementTrigger[]).includes(trigger),
  );
}

// The facts those definitions read, deduplicated, in catalog order.
export function achievementFactsFor(
  definitions: readonly AchievementDefinition[],
): AchievementFactKey[] {
  const keys: AchievementFactKey[] = [];
  for (const definition of definitions) {
    for (const key of definition.facts) if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Every award one account's facts qualify for, among the given definitions.
export function qualifyAchievements(
  facts: AchievementFacts,
  definitions: readonly AchievementDefinition[] = ACHIEVEMENTS,
): Array<{ achievementId: string } & AchievementAward> {
  const awards: Array<{ achievementId: string } & AchievementAward> = [];
  for (const definition of definitions) {
    const award = definition.qualify(facts);
    if (award) awards.push({ achievementId: definition.id, ...award });
  }
  return awards;
}
