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

// 'standard' achievements live on the achievements page only. 'badge' is kept
// for the rarer, more important ones, which the profile also shows (at most
// three). Nothing is a badge yet; the tier exists so one can be.
export type AchievementTier = 'standard' | 'badge';

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
export type AchievementIcon = 'first-game' | 'versus' | 'rated' | 'puzzle' | 'forum' | 'wins';

export type AchievementDefinition = {
  id: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  tier: AchievementTier;
  // Web i18n keys (community domain, `profile.` prefix): the title, what the
  // holder did (an earned card), and how to earn it (a locked card).
  titleKey: string;
  descriptionKey: string;
  hintKey: string;
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
    tier: 'standard',
    titleKey: 'profile.achievementFirstGame',
    descriptionKey: 'profile.achievementFirstGameDesc',
    hintKey: 'profile.achievementFirstGameHint',
    triggers: ['game_end'],
    facts: ['firstGame'],
    qualify: firstOf('firstGame'),
  },
  {
    id: 'first-pvp',
    category: 'play',
    icon: 'versus',
    tier: 'standard',
    titleKey: 'profile.achievementFirstPvp',
    descriptionKey: 'profile.achievementFirstPvpDesc',
    hintKey: 'profile.achievementFirstPvpHint',
    triggers: ['game_end'],
    facts: ['firstPvpGame'],
    qualify: firstOf('firstPvpGame'),
  },
  {
    id: 'first-rated',
    category: 'play',
    icon: 'rated',
    tier: 'standard',
    titleKey: 'profile.achievementFirstRated',
    descriptionKey: 'profile.achievementFirstRatedDesc',
    hintKey: 'profile.achievementFirstRatedHint',
    triggers: ['game_end'],
    facts: ['firstRatedGame'],
    qualify: firstOf('firstRatedGame'),
  },
  {
    id: 'first-puzzle',
    category: 'puzzles',
    icon: 'puzzle',
    tier: 'standard',
    titleKey: 'profile.achievementFirstPuzzle',
    descriptionKey: 'profile.achievementFirstPuzzleDesc',
    hintKey: 'profile.achievementFirstPuzzleHint',
    triggers: ['puzzle_attempt'],
    facts: ['firstSolvedPuzzle'],
    qualify: firstOf('firstSolvedPuzzle'),
  },
  {
    id: 'first-forum-post',
    category: 'community',
    icon: 'forum',
    tier: 'standard',
    titleKey: 'profile.achievementFirstForumPost',
    descriptionKey: 'profile.achievementFirstForumPostDesc',
    hintKey: 'profile.achievementFirstForumPostHint',
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

// Leveling families. One achievement that repeats at bigger numbers ("10
// wins", "50 wins", ...) is one family with ordered levels, shown as one card
// that levels up (Brian picked the collectible-card look on 2026-10-14 and
// asked how it scales; this is the answer). Each level reached is its own
// ledger row, id `<family>:<threshold>` (ACHIEVEMENT_ID_PATTERN already allows
// the colon), with the date of the event that reached it, so the profile count
// and badges keep reading plain award rows and no migration is needed.
//
// "Level" in code, "tier" on the card: `tier` already names standard | badge.
//
// A family reads a COUNTER instead of a fact: the server derives the running
// total and, for each threshold reached, the event that reached it (the 10th
// win, the 50th). Crossing several thresholds at once (a backfill, a jump)
// awards each level with its own event's date.

export type AchievementCounterKey = 'wins';

// The card's band per level, lowest first.
export type AchievementMetal = 'bronze' | 'silver' | 'gold' | 'platinum';

export type AchievementLevel = { threshold: number; metal: AchievementMetal };

export type AchievementCount = {
  count: number;
  // Threshold -> the event that brought the count to it.
  reached: Readonly<Record<number, AchievementFact>>;
};

export type AchievementCounts = Partial<Record<AchievementCounterKey, AchievementCount>>;

export type AchievementFamilyDefinition = {
  id: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  // Web i18n keys taking {count}: "{count} wins", "Won {count} games.", and
  // how to earn the next level.
  titleKey: string;
  descriptionKey: string;
  hintKey: string;
  triggers: readonly AchievementTrigger[];
  counter: AchievementCounterKey;
  // Strictly ascending thresholds.
  levels: readonly AchievementLevel[];
};

export const ACHIEVEMENT_FAMILIES = [
  {
    // A win from the account's seat in any game that counts toward its own
    // record (persistence-counted-games.ts playedHumanGame: completed, against a
    // person or a bot, both sides moved, a live variant).
    id: 'wins',
    category: 'play',
    icon: 'wins',
    titleKey: 'profile.achievementWins',
    descriptionKey: 'profile.achievementWinsDesc',
    hintKey: 'profile.achievementWinsHint',
    triggers: ['game_end'],
    counter: 'wins',
    levels: [
      { threshold: 10, metal: 'bronze' },
      { threshold: 50, metal: 'silver' },
      { threshold: 100, metal: 'gold' },
      { threshold: 500, metal: 'platinum' },
    ],
  },
] as const satisfies readonly AchievementFamilyDefinition[];

export function achievementLevelId(familyId: string, threshold: number): string {
  return `${familyId}:${threshold}`;
}

const FAMILY_BY_ID = new Map<string, AchievementFamilyDefinition>(
  ACHIEVEMENT_FAMILIES.map((family) => [family.id, family]),
);

export function getAchievementFamily(id: string): AchievementFamilyDefinition | null {
  return FAMILY_BY_ID.get(id) ?? null;
}

// A level award id back to its family and level (index 0 is the first level);
// null for anything else, singles included.
export function getAchievementLevel(
  id: string,
): { family: AchievementFamilyDefinition; level: AchievementLevel; index: number } | null {
  const colon = id.lastIndexOf(':');
  if (colon <= 0) return null;
  const family = FAMILY_BY_ID.get(id.slice(0, colon));
  if (!family) return null;
  const threshold = id.slice(colon + 1);
  const index = family.levels.findIndex((level) => String(level.threshold) === threshold);
  if (index < 0) return null;
  return { family, level: family.levels[index]!, index };
}

// Every id the ledger can hold for a defined achievement: singles, then each
// family's levels in order.
export const ACHIEVEMENT_AWARD_IDS: readonly string[] = [
  ...ACHIEVEMENTS.map((definition) => definition.id),
  ...ACHIEVEMENT_FAMILIES.flatMap((family) =>
    family.levels.map((level) => achievementLevelId(family.id, level.threshold)),
  ),
];

export function achievementFamiliesForTrigger(
  trigger?: AchievementTrigger,
): readonly AchievementFamilyDefinition[] {
  if (!trigger) return ACHIEVEMENT_FAMILIES;
  return ACHIEVEMENT_FAMILIES.filter((family) =>
    (family.triggers as readonly AchievementTrigger[]).includes(trigger),
  );
}

// The counters those families read, each with the thresholds to locate.
export function achievementCountersFor(
  families: readonly AchievementFamilyDefinition[],
): Map<AchievementCounterKey, number[]> {
  const counters = new Map<AchievementCounterKey, number[]>();
  for (const family of families) {
    const thresholds = counters.get(family.counter) ?? [];
    for (const level of family.levels) {
      if (!thresholds.includes(level.threshold)) thresholds.push(level.threshold);
    }
    counters.set(
      family.counter,
      thresholds.sort((a, b) => a - b),
    );
  }
  return counters;
}

// Every level the counts reach, lowest first, each dated at its own event.
export function qualifyAchievementLevels(
  counts: AchievementCounts,
  families: readonly AchievementFamilyDefinition[] = ACHIEVEMENT_FAMILIES,
): Array<{ achievementId: string } & AchievementAward> {
  const awards: Array<{ achievementId: string } & AchievementAward> = [];
  for (const family of families) {
    const counter = counts[family.counter];
    if (!counter) continue;
    for (const level of family.levels) {
      if (counter.count < level.threshold) break;
      const fact = counter.reached[level.threshold];
      if (!fact) continue;
      awards.push({
        achievementId: achievementLevelId(family.id, level.threshold),
        awardedAt: fact.at,
        sourceKind: fact.sourceKind,
        sourceId: fact.sourceId,
      });
    }
  }
  return awards;
}

// Where an account stands in a family: `level` is how many levels it holds
// (0 = locked), `nextThreshold` the next one to reach, null at the top.
export type AchievementFamilyProgress = {
  id: string;
  level: number;
  count: number;
  nextThreshold: number | null;
};

export function achievementFamilyProgress(
  family: AchievementFamilyDefinition,
  heldIds: ReadonlySet<string>,
  count: number,
): AchievementFamilyProgress {
  let level = 0;
  family.levels.forEach((entry, index) => {
    if (heldIds.has(achievementLevelId(family.id, entry.threshold))) level = index + 1;
  });
  const next = family.levels[level];
  return { id: family.id, level, count, nextThreshold: next ? next.threshold : null };
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
