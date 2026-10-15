import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACHIEVEMENT_ID_PATTERN,
  ACHIEVEMENTS,
  type AchievementFacts,
  achievementFactsFor,
  achievementsForTrigger,
  getAchievementDefinition,
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
