import { createUser } from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import {
  advancePuzzleStorm,
  bestPuzzleStorm,
  loadPuzzleStorm,
  recentStormPuzzleIds,
  savePuzzleStorm,
  startPuzzleStorm,
} from './puzzle-storm.js';

definePersistenceTests('puzzle storm', () => {
  test('storm atomically persists versioned scores and idempotent account/day bests', async () => {
    const now = new Date('2026-10-30T23:59:00Z');
    const user = await createUser({
      id: 'storm-owner',
      handle: 'storm-owner',
      displayName: 'Storm solver',
      email: 'storm@example.com',
      emailVerifiedAt: now,
      now,
    });
    const move = { from: 'a1', to: 'a2' } as const;
    const run = await startPuzzleStorm(['p1', 'p2'], user.id, now.getTime());
    const stale = (await loadPuzzleStorm(run.id))!;
    assert.deepEqual(stale, run);
    advancePuzzleStorm(run.state, move, 'solved', now.getTime());
    advancePuzzleStorm(stale.state, move, 'solved', now.getTime());
    advancePuzzleStorm(stale.state, move, 'solved', now.getTime());
    assert.deepEqual(await Promise.all([savePuzzleStorm(run), savePuzzleStorm(stale)]), [
      true,
      false,
    ]);
    assert.equal((await loadPuzzleStorm(run.id))!.state.score, 1);
    assert.deepEqual(await bestPuzzleStorm(user.id, run.day), { best: 1, dailyBest: 1 });
    assert.deepEqual([...(await recentStormPuzzleIds(user.id))], ['p1']);

    // A failed best write must also roll back the run/version update.
    const invalid = (await loadPuzzleStorm(run.id))!;
    // Delete the best to exercise the nonnegative-score constraint on INSERT.
    await getPool().query('DELETE FROM puzzle_storm_bests WHERE user_id = $1', [user.id]);
    invalid.state.score = -1;
    await assert.rejects(savePuzzleStorm(invalid));
    assert.deepEqual(await loadPuzzleStorm(run.id), run);

    advancePuzzleStorm(run.state, move, 'solved', now.getTime() + 61_000);
    await savePuzzleStorm(run);
    const next = await startPuzzleStorm(['p3'], user.id, now.getTime() + 62_000);
    advancePuzzleStorm(next.state, move, 'solved', now.getTime() + 62_000);
    await savePuzzleStorm(next);
    await savePuzzleStorm(next);
    assert.deepEqual(await bestPuzzleStorm(user.id, run.day), { best: 2, dailyBest: 2 });
    assert.deepEqual(await bestPuzzleStorm(user.id, next.day), { best: 2, dailyBest: 1 });
    const bestRows = await getPool().query(
      'SELECT score FROM puzzle_storm_bests WHERE user_id = $1 ORDER BY day',
      [user.id],
    );
    assert.deepEqual(bestRows.rows, [{ score: 2 }, { score: 1 }]);
    assert.equal((await loadPuzzleStorm(next.id))!.version, 2);
  });
});
