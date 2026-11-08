import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advancePuzzleStorm,
  bestPuzzleStorm,
  expirePuzzleStorm,
  loadPuzzleStorm,
  recentStormPuzzleIds,
  savePuzzleStorm,
  startPuzzleStorm,
  stormComboBonusMs,
  stormRemainingMs,
} from './puzzle-storm.js';

const move = { from: 'a1', to: 'a2' } as const;
const start = Date.parse('2026-10-30T23:59:00Z');

test('storm counts solver moves for combo bonuses and solved puzzles for score', async () => {
  const { state } = await startPuzzleStorm(['one', 'two'], null, start);
  assert.equal(stormRemainingMs(state, start), 180_000);
  const bonuses = new Map([
    [5, 3_000],
    [12, 5_000],
    [20, 7_000],
    [30, 10_000],
    [40, 10_000],
    [50, 10_000],
  ]);
  let earned = 0;
  for (let combo = 1; combo <= 50; combo++) {
    const bonus = bonuses.get(combo) ?? 0;
    assert.equal(stormComboBonusMs(combo), bonus, `combo ${combo}`);
    earned += bonus;
    assert.equal(
      advancePuzzleStorm(state, move, combo === 50 ? 'solved' : 'correct', start + combo * 1_000),
      true,
    );
    assert.equal(state.combo, combo);
    assert.equal(state.deadlineAt, start + 181_000 + earned);
    assert.equal(state.score, combo === 50 ? 1 : 0);
    assert.equal(stormRemainingMs(state, start + combo * 1_000), 181_000 + earned - combo * 1_000);
  }
  assert.deepEqual(state.results, [{ id: 'one', outcome: 'solved' }]);
  assert.deepEqual(state.moves, []);
  assert.equal(state.finished, false);
});

test('a miss subtracts ten seconds, resets the combo and moves on; a later combo earns again', async () => {
  const { state } = await startPuzzleStorm(['one', 'two', 'three'], null, start);
  for (let i = 0; i < 5; i++) advancePuzzleStorm(state, move, 'correct', start);
  advancePuzzleStorm(state, move, 'failed', start + 1_000);
  assert.equal(state.combo, 0);
  assert.equal(state.score, 0);
  assert.equal(stormRemainingMs(state, start + 1_000), 172_000);
  assert.deepEqual(state.results, [{ id: 'one', outcome: 'failed' }]);
  assert.deepEqual(state.moves, []);
  for (let i = 0; i < 5; i++) advancePuzzleStorm(state, move, 'correct', start + 2_000);
  assert.equal(state.deadlineAt, start + 176_000);
  advancePuzzleStorm(state, move, 'failed', start + 170_000);
  assert.equal(state.finished, true);
  assert.equal(stormRemainingMs(state, start + 170_000), 0);
  assert.equal(state.score, 0);
  const ended = structuredClone(state);
  assert.equal(advancePuzzleStorm(state, move, 'solved', start + 170_001), false);
  assert.deepEqual(state, ended);
});

test('deadline is exclusive: a late combo cannot resurrect the clock; corpus exhaustion finishes', async () => {
  const { state } = await startPuzzleStorm(['one', 'two'], null, start);
  for (let i = 0; i < 4; i++) advancePuzzleStorm(state, move, 'correct', start);
  assert.equal(expirePuzzleStorm(state, start + 179_999), false);
  assert.equal(advancePuzzleStorm(state, move, 'solved', start + 180_000), false);
  assert.equal(state.finished, true);
  assert.equal(state.combo, 4);
  assert.equal(state.score, 0);
  assert.deepEqual(state.results, []);
  const last = await startPuzzleStorm(['last'], null, start);
  assert.equal(advancePuzzleStorm(last.state, move, 'solved', start + 179_999), true);
  assert.equal(last.state.score, 1);
  assert.equal(last.state.finished, true);
  assert.equal((await startPuzzleStorm([], null, start)).state.finished, true);
});

test('stale saves cannot change scores or bests; UTC daily bests survive lower runs and midnight', async () => {
  const run = await startPuzzleStorm(['one', 'two', 'three'], 'storm-owner', start);
  const stale = (await loadPuzzleStorm(run.id))!;
  advancePuzzleStorm(run.state, move, 'solved', start);
  advancePuzzleStorm(stale.state, move, 'solved', start);
  advancePuzzleStorm(stale.state, move, 'solved', start);
  assert.deepEqual(await Promise.all([savePuzzleStorm(run), savePuzzleStorm(stale)]), [
    true,
    false,
  ]);
  assert.equal((await loadPuzzleStorm(run.id))!.state.score, 1);
  assert.equal(run.version, 1);
  assert.deepEqual(await bestPuzzleStorm(run.userId, run.day), { best: 1, dailyBest: 1 });
  advancePuzzleStorm(run.state, move, 'solved', start + 61_000);
  await savePuzzleStorm(run);
  assert.equal(run.day, '2026-10-30');
  assert.deepEqual(await bestPuzzleStorm(run.userId, run.day), { best: 2, dailyBest: 2 });
  const lower = await startPuzzleStorm(['four'], run.userId, start + 62_000);
  advancePuzzleStorm(lower.state, move, 'solved', start + 62_000);
  await savePuzzleStorm(lower);
  assert.deepEqual(await bestPuzzleStorm(run.userId, lower.day), { best: 2, dailyBest: 1 });
  assert.deepEqual(await bestPuzzleStorm(run.userId, '2026-10-30'), { best: 2, dailyBest: 2 });
  assert.deepEqual(await bestPuzzleStorm('other-owner', run.day), { best: 0, dailyBest: 0 });
  assert.deepEqual(await bestPuzzleStorm(null, run.day), { best: null, dailyBest: null });
  assert.deepEqual([...(await recentStormPuzzleIds(run.userId))].sort(), ['four', 'one', 'two']);
  assert.deepEqual([...(await recentStormPuzzleIds(null))], []);
  assert.equal(await loadPuzzleStorm('missing'), null);
});

test('an unstarted clock survives idle time and starts on its first graded move', async () => {
  const run = await startPuzzleStorm(['one', 'two'], null, start);
  assert.equal(run.state.startedAt, null);
  assert.equal(run.state.deadlineAt, null);
  assert.equal(expirePuzzleStorm(run.state, start + 900_000), false);
  assert.equal(stormRemainingMs(run.state, start + 900_000), 180_000);
  const resumed = (await loadPuzzleStorm(run.id))!;
  assert.equal(resumed.state.startedAt, null);
  assert.equal(resumed.state.deadlineAt, null);
  assert.equal(stormRemainingMs(resumed.state, start + 900_000), 180_000);
  assert.equal(advancePuzzleStorm(resumed.state, move, 'failed', start + 900_000), true);
  assert.equal(resumed.state.startedAt, start + 900_000);
  assert.equal(resumed.state.deadlineAt, start + 1_070_000);
  assert.equal(stormRemainingMs(resumed.state, start + 900_000), 170_000);
  assert.equal(await savePuzzleStorm(resumed), true);
  const started = (await loadPuzzleStorm(run.id))!;
  assert.equal(started.state.deadlineAt, resumed.state.deadlineAt);
  assert.equal(expirePuzzleStorm(started.state, start + 1_070_000), true);
  assert.equal(advancePuzzleStorm(started.state, move, 'solved', start + 1_070_000), false);
});
