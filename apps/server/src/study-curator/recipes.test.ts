import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultStudyRecipesPath,
  loadStudyRecipes,
  parseStudyRecipe,
  parseStudyRecipesFile,
  StudyRecipeError,
} from './recipes.js';

const VALID = {
  id: 'central-cannon-2026',
  version: 1,
  study: { name: 'x', description: 'y', visibility: 'unlisted' },
  source: { playedFrom: '2026-01-01', results: ['1-0', '0-1'], plyMin: 40, plyMax: 120 },
  opening: { name: 'Central Cannon', byPly: 8, red: ['C@e3'], black: ['H@c8', 'H@g8'] },
  mode: 'model-games',
  chapters: { max: 12 },
  annotate: { maxMoments: 6, openingDeviation: true },
};

test('a valid recipe parses to its typed shape', () => {
  const recipe = parseStudyRecipe(VALID);
  assert.equal(recipe.id, 'central-cannon-2026');
  assert.deepEqual(recipe.opening, {
    name: 'Central Cannon',
    byPly: 8,
    red: ['C@e3'],
    black: ['H@c8', 'H@g8'],
  });
  assert.deepEqual(recipe.source.results, ['1-0', '0-1']);
  assert.equal(recipe.chapters.max, 12);
});

test('bad fields are named', () => {
  assert.throws(() => parseStudyRecipe({ ...VALID, id: 'Not A Slug' }), StudyRecipeError);
  assert.throws(
    () => parseStudyRecipe({ ...VALID, opening: { ...VALID.opening, red: ['X@e3'] } }),
    /placement/,
  );
  assert.throws(
    () => parseStudyRecipe({ ...VALID, opening: { ...VALID.opening, red: ['C@e11'] } }),
    /placement/,
  );
  assert.throws(
    () => parseStudyRecipe({ ...VALID, source: { ...VALID.source, playedFrom: '2026/01/01' } }),
    /playedFrom/,
  );
  assert.throws(
    () => parseStudyRecipe({ ...VALID, source: { plyMin: 100, plyMax: 50 } }),
    /plyMin/,
  );
  assert.throws(() => parseStudyRecipe({ ...VALID, mode: 'reel' }), /mode/);
  assert.throws(
    () => parseStudyRecipe({ ...VALID, study: { ...VALID.study, visibility: 'private' } }),
    /visibility/,
  );
  assert.throws(() => parseStudyRecipe({ ...VALID, chapters: {} }), /chapters.max/);
});

test('the file rejects duplicate ids and the wrong envelope', () => {
  assert.throws(() => parseStudyRecipesFile({ version: 1, recipes: [VALID, VALID] }), /duplicate/);
  assert.throws(() => parseStudyRecipesFile({ version: 2, recipes: [] }), /version/);
});

test('the shipped recipes file parses', () => {
  const recipes = loadStudyRecipes(defaultStudyRecipesPath({}));
  assert.ok(recipes.length >= 2);
  assert.ok(recipes.some((r) => r.mode === 'decisive-moments'));
  assert.ok(recipes.some((r) => r.opening));
});
