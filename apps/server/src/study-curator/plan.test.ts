import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChapterDraft } from './annotate.js';
import { type CuratorMark, type DesiredChapter, planChapters, readCuratorMark } from './plan.js';

const draft = (name: string, gamebook = false): ChapterDraft => ({
  name,
  i18n: {},
  orientation: 'red',
  root: { version: 1, root: { children: [] } },
  tags: { red: 'a', black: 'b', result: '1-0', event: 'e' },
  gamebook,
});

const mark = (gameId: string, over: Partial<CuratorMark> = {}): CuratorMark => ({
  recipeId: 'r',
  gameId,
  recipeVersion: 1,
  annotatorVersion: 1,
  engineId: 'eng@5',
  ...over,
});

const desired = (
  gameId: string,
  over: Partial<CuratorMark> = {},
  gamebook = false,
): DesiredChapter => ({
  mark: mark(gameId, over),
  draft: draft(gameId, gamebook),
});

test('readCuratorMark accepts only a complete mark', () => {
  assert.deepEqual(readCuratorMark({ curator: mark('g') }), mark('g'));
  assert.equal(readCuratorMark({ curator: { recipeId: 'r' } }), null);
  assert.equal(readCuratorMark({}), null);
  assert.equal(readCuratorMark(null), null);
});

test('planChapters adds, keeps, updates, removes and orders', () => {
  const existing = [
    { id: 'c-old', denorm: { curator: mark('g-old') }, gamebook: false },
    { id: 'c-keep', denorm: { curator: mark('g-keep') }, gamebook: false },
    { id: 'c-stale', denorm: { curator: mark('g-stale', { engineId: 'eng@4' }) }, gamebook: false },
    { id: 'c-hand', denorm: {}, gamebook: false },
    { id: 'c-other', denorm: { curator: mark('g-x', { recipeId: 'other' }) }, gamebook: false },
  ];
  const plan = planChapters('r', existing, [
    desired('g-new'),
    desired('g-stale'),
    desired('g-keep'),
  ]);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0]?.mark.gameId, 'g-new');
  assert.deepEqual(
    plan.update.map((u) => u.id),
    ['c-stale'],
  );
  assert.deepEqual(plan.remove, ['c-old']);
  assert.deepEqual(plan.order, [{ add: 0 }, { id: 'c-stale' }, { id: 'c-keep' }]);
  assert.deepEqual(plan.foreign, ['c-hand', 'c-other']);
  assert.deepEqual(plan.gamebook, []);
});

test('a current chapter whose gamebook flag drifted gets the flag, not a rewrite', () => {
  const existing = [{ id: 'c', denorm: { curator: mark('g') }, gamebook: false }];
  const plan = planChapters('r', existing, [desired('g', {}, true)]);
  assert.deepEqual(plan.update, []);
  assert.deepEqual(plan.gamebook, [{ id: 'c', gamebook: true }]);
});

test('a recipe version bump rewrites every chapter in place', () => {
  const existing = [
    { id: 'c1', denorm: { curator: mark('g1') }, gamebook: false },
    { id: 'c2', denorm: { curator: mark('g2') }, gamebook: false },
  ];
  const plan = planChapters('r', existing, [
    desired('g1', { recipeVersion: 2 }),
    desired('g2', { recipeVersion: 2 }),
  ]);
  assert.deepEqual(
    plan.update.map((u) => u.id),
    ['c1', 'c2'],
  );
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.remove, []);
});
