import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACHIEVEMENT_AWARD_IDS,
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENT_ID_PATTERN,
  ACHIEVEMENTS,
  type AchievementCounts,
  type AchievementFact,
  type AchievementFacts,
  achievementCountersFor,
  achievementFactsFor,
  achievementFamiliesForTrigger,
  achievementFamilyProgress,
  achievementLevelId,
  achievementsForTrigger,
  getAchievementDefinition,
  getAchievementFamily,
  getAchievementLevel,
  qualifyAchievementLevels,
  qualifyAchievements,
} from './index.js';

const AT = new Date('2026-10-01T12:00:00Z');

test('ids are unique ledger slugs and keys sit in the profile i18n namespace', () => {
  const ids = ACHIEVEMENTS.map((definition) => definition.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(', ')}`);
  for (const definition of ACHIEVEMENTS) {
    assert.match(definition.id, ACHIEVEMENT_ID_PATTERN);
    assert.match(definition.titleKey, /^profile\.achievement[A-Z]\w+$/);
    assert.equal(definition.descriptionKey, `${definition.titleKey}Desc`);
    assert.equal(definition.hintKey, `${definition.titleKey}Hint`);
    assert.ok(['standard', 'badge'].includes(definition.tier), `${definition.id} tier`);
    assert.ok(definition.triggers.length > 0, `${definition.id} has no trigger`);
    assert.ok(definition.facts.length > 0, `${definition.id} reads no fact`);
  }
});

test('the first set holds no bot-ladder badge (skipped 2026-09-15)', () => {
  for (const definition of ACHIEVEMENTS) {
    assert.doesNotMatch(definition.id, /bot|ladder|level/);
  }
});

test('the starter set is all standard tier: badges are reserved for rarer feats', () => {
  assert.deepEqual(
    ACHIEVEMENTS.filter((definition) => definition.tier !== 'standard').map((d) => d.id),
    [],
  );
});

test('no facts, no awards', () => {
  assert.deepEqual(qualifyAchievements({}), []);
});

test('each first-event fact awards its achievement at the event, pointing at its source', () => {
  const facts: AchievementFacts = {
    firstGame: { at: AT, sourceKind: 'game', sourceId: 'room-1' },
    firstSolvedPuzzle: { at: AT, sourceKind: 'puzzle', sourceId: 'xq-12' },
  };
  assert.deepEqual(qualifyAchievements(facts), [
    { achievementId: 'first-game', awardedAt: AT, sourceKind: 'game', sourceId: 'room-1' },
    { achievementId: 'first-puzzle', awardedAt: AT, sourceKind: 'puzzle', sourceId: 'xq-12' },
  ]);
});

test('a pvp game alone does not award first-rated, and a rated one does', () => {
  const pvp: AchievementFacts = {
    firstGame: { at: AT, sourceKind: 'game', sourceId: 'r' },
    firstPvpGame: { at: AT, sourceKind: 'game', sourceId: 'r' },
  };
  const ids = (facts: AchievementFacts) => qualifyAchievements(facts).map((a) => a.achievementId);
  assert.deepEqual(ids(pvp), ['first-game', 'first-pvp']);
  assert.deepEqual(ids({ ...pvp, firstRatedGame: { at: AT, sourceKind: 'game', sourceId: 'r' } }), [
    'first-game',
    'first-pvp',
    'first-rated',
  ]);
});

test('a trigger re-evaluates only its own definitions and derives only their facts', () => {
  const forum = achievementsForTrigger('forum_post');
  assert.deepEqual(
    forum.map((definition) => definition.id),
    ['first-forum-post'],
  );
  assert.deepEqual(achievementFactsFor(forum), ['firstForumPost']);
  assert.deepEqual(achievementFactsFor(achievementsForTrigger('game_end')), [
    'firstGame',
    'firstPvpGame',
    'firstRatedGame',
  ]);
  // The backfill: every definition, every fact once.
  assert.equal(achievementsForTrigger().length, ACHIEVEMENTS.length);
  const all = achievementFactsFor(achievementsForTrigger());
  assert.equal(new Set(all).size, all.length);
  // A forum fact never awards through the game-end definitions.
  assert.deepEqual(
    qualifyAchievements(
      { firstForumPost: { at: AT, sourceKind: 'forum_post', sourceId: 'p' } },
      achievementsForTrigger('game_end'),
    ),
    [],
  );
});

test('lookup is fail-closed for unknown ids', () => {
  assert.equal(getAchievementDefinition('first-game')?.category, 'play');
  assert.equal(getAchievementDefinition('top-bot-xiangqi'), null);
});

test('families: ids, keys and levels are well formed, thresholds strictly ascending', () => {
  const singleIds = new Set<string>(ACHIEVEMENTS.map((definition) => definition.id));
  const metals = ['bronze', 'silver', 'gold', 'platinum'];
  for (const family of ACHIEVEMENT_FAMILIES) {
    assert.ok(!singleIds.has(family.id), `${family.id} collides with a single`);
    assert.match(family.titleKey, /^profile\.achievement[A-Z]\w+$/);
    assert.equal(family.descriptionKey, `${family.titleKey}Desc`);
    assert.equal(family.hintKey, `${family.titleKey}Hint`);
    assert.ok(family.triggers.length > 0, `${family.id} has no trigger`);
    assert.ok(family.levels.length > 0 && family.levels.length <= metals.length);
    family.levels.forEach((level, index) => {
      assert.ok(Number.isInteger(level.threshold) && level.threshold > 0);
      if (index > 0) assert.ok(level.threshold > family.levels[index - 1]!.threshold);
      assert.equal(level.metal, metals[index], `${family.id} level ${index + 1} metal`);
      assert.match(achievementLevelId(family.id, level.threshold), ACHIEVEMENT_ID_PATTERN);
    });
  }
  assert.equal(new Set(ACHIEVEMENT_AWARD_IDS).size, ACHIEVEMENT_AWARD_IDS.length);
});

test('wins levels up at 10 / 50 / 100 / 500, bronze to platinum', () => {
  const wins = getAchievementFamily('wins');
  assert.deepEqual(
    wins?.levels.map((level) => [level.threshold, level.metal]),
    [
      [10, 'bronze'],
      [50, 'silver'],
      [100, 'gold'],
      [500, 'platinum'],
    ],
  );
  assert.deepEqual(
    achievementFamiliesForTrigger('game_end').map((family) => family.id),
    ['wins'],
  );
  assert.deepEqual(achievementFamiliesForTrigger('forum_post'), []);
  assert.deepEqual(
    [...achievementCountersFor(ACHIEVEMENT_FAMILIES)],
    [['wins', [10, 50, 100, 500]]],
  );
});

test('level ids resolve to their family and level, and nothing else does', () => {
  const level = getAchievementLevel('wins:100');
  assert.equal(level?.family.id, 'wins');
  assert.equal(level?.index, 2);
  assert.equal(level?.level.metal, 'gold');
  for (const id of ['wins', 'wins:11', 'first-game', 'losses:10', ':10', 'arena:x:1']) {
    assert.equal(getAchievementLevel(id), null, id);
  }
});

const fact = (sourceId: string): AchievementFact => ({ at: AT, sourceKind: 'game', sourceId });

test('a count below the first threshold awards nothing; each crossing awards its own level', () => {
  assert.deepEqual(qualifyAchievementLevels({} satisfies AchievementCounts), []);
  assert.deepEqual(qualifyAchievementLevels({ wins: { count: 9, reached: {} } }), []);
  const at10 = qualifyAchievementLevels({ wins: { count: 10, reached: { 10: fact('g10') } } });
  assert.deepEqual(
    at10.map((award) => [award.achievementId, award.sourceId]),
    [['wins:10', 'g10']],
  );
  // A jump (a backfill) crosses several levels at once, each dated at its own game.
  const jump = qualifyAchievementLevels({
    wins: { count: 143, reached: { 10: fact('g10'), 50: fact('g050'), 100: fact('g0100') } },
  });
  assert.deepEqual(
    jump.map((award) => [award.achievementId, award.sourceId]),
    [
      ['wins:10', 'g10'],
      ['wins:50', 'g050'],
      ['wins:100', 'g0100'],
    ],
  );
});

test('progress: level held, count, and the next threshold (null at the top)', () => {
  const wins = getAchievementFamily('wins')!;
  assert.deepEqual(achievementFamilyProgress(wins, new Set(), 3), {
    id: 'wins',
    level: 0,
    count: 3,
    nextThreshold: 10,
  });
  assert.deepEqual(
    achievementFamilyProgress(wins, new Set(['wins:10', 'wins:50', 'wins:100']), 143),
    { id: 'wins', level: 3, count: 143, nextThreshold: 500 },
  );
  assert.equal(
    achievementFamilyProgress(wins, new Set(ACHIEVEMENT_AWARD_IDS), 612).nextThreshold,
    null,
  );
});
