import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bestPuzzleStreak,
  loadPuzzleStreak,
  orderedPuzzleRamp,
  savePuzzleStreak,
  startPuzzleStreak,
} from './puzzle-streak.js';

test('the fixed ramp climbs ratings without depending on input order', () => {
  const pool = [700, 900, 800, 850, 1000, 1500].map((rating) => ({ id: String(rating), rating }));
  const ramp = orderedPuzzleRamp(pool);
  assert.deepEqual(
    ramp.map((p) => p.rating),
    [800, 850, 900, 1000, 1500],
  );
  assert.deepEqual(orderedPuzzleRamp([...pool].reverse()), ramp);
  assert.deepEqual(orderedPuzzleRamp([]), []);
  assert.equal(pool.length, 6);
});

test('overlapping state updates cannot count the same solve twice, best survives a new run', async () => {
  const first = await startPuzzleStreak(['one', 'two'], 'memory-owner');
  const second = await loadPuzzleStreak(first.id);
  assert.ok(second);
  first.state.score = 1;
  first.state.results.push({ id: 'one', outcome: 'solved' });
  second.state.score = 2;
  assert.deepEqual(await Promise.all([savePuzzleStreak(first), savePuzzleStreak(second)]), [
    true,
    false,
  ]);
  assert.equal((await loadPuzzleStreak(first.id))!.state.score, 1);
  await startPuzzleStreak(['one'], 'memory-owner');
  assert.equal(await bestPuzzleStreak('memory-owner'), 1);
  assert.equal(await bestPuzzleStreak('someone-else'), 0);
  assert.equal(await bestPuzzleStreak(null), null);
  assert.equal(await loadPuzzleStreak('missing'), null);
});
