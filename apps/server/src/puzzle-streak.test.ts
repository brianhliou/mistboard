import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bestPuzzleStreak,
  loadPuzzleStreak,
  orderedPuzzleRamp,
  recentStreakPuzzleIds,
  savePuzzleStreak,
  shuffledPuzzleRamp,
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

// Ten puzzles at each rating from 800 to 1300.
const widePool = Array.from({ length: 11 }, (_, rung) => 800 + rung * 50).flatMap((rating) =>
  Array.from({ length: 10 }, (_, i) => ({ id: `${rating}-${i}`, rating })),
);
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

test('each run shuffles inside its difficulty steps and keeps every puzzle', () => {
  const first = shuffledPuzzleRamp(widePool, { random: seeded(1) });
  const second = shuffledPuzzleRamp(widePool, { random: seeded(2) });
  for (const ramp of [first, second]) {
    assert.deepEqual([...ramp].map((p) => p.id).sort(), widePool.map((p) => p.id).sort());
    // 110 puzzles make steps of 11: each step is easier than the next.
    for (let at = 11; at < ramp.length; at += 11) {
      const before = Math.max(...ramp.slice(at - 11, at).map((p) => p.rating));
      const after = Math.min(...ramp.slice(at, at + 11).map((p) => p.rating));
      assert.ok(before <= after, `step at ${at} goes backwards`);
    }
  }
  assert.notDeepEqual(
    first.slice(0, 5).map((p) => p.id),
    second.slice(0, 5).map((p) => p.id),
  );
  assert.deepEqual(shuffledPuzzleRamp([]), []);
});

test('puzzles from recent runs wait one step so a run opens on new ones', () => {
  const firstStep = new Set(widePool.slice(0, 11).map((p) => p.id));
  const ramp = shuffledPuzzleRamp(widePool, { avoid: firstStep, random: seeded(3) });
  assert.deepEqual(
    ramp
      .slice(0, 11)
      .map((p) => p.id)
      .sort(),
    widePool
      .slice(11, 22)
      .map((p) => p.id)
      .sort(),
  );
  assert.deepEqual(
    ramp
      .slice(11, 22)
      .map((p) => p.id)
      .sort(),
    [...firstStep].sort(),
  );
  // With nothing new left, the run still holds every puzzle.
  const thin = [800, 850, 900].map((rating) => ({ id: String(rating), rating }));
  assert.deepEqual(
    shuffledPuzzleRamp(thin, { avoid: new Set(['800', '850', '900']), random: () => 0 })
      .map((p) => p.id)
      .sort(),
    ['800', '850', '900'],
  );
});

test('recent streak puzzles are the ones an account reached in its last runs', async () => {
  const run = await startPuzzleStreak(['seen', 'unreached'], 'recent-owner');
  run.state.results.push({ id: 'seen', outcome: 'solved' });
  assert.equal(await savePuzzleStreak(run), true);
  assert.deepEqual([...(await recentStreakPuzzleIds('recent-owner'))], ['seen']);
  assert.deepEqual([...(await recentStreakPuzzleIds(null))], []);
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
