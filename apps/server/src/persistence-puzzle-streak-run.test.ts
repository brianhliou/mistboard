import { createUser } from './persistence.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import {
  bestPuzzleStreak,
  loadPuzzleStreak,
  savePuzzleStreak,
  startPuzzleStreak,
} from './puzzle-streak.js';

definePersistenceTests('puzzle streak runs', () => {
  test('streak state round-trips, rejects a stale write, and retains an account best across runs', async () => {
    const user = await createUser({
      id: 'streak-run-owner',
      handle: 'streak-run-owner',
      displayName: 'Streak solver',
      email: 'streak-run@example.com',
      emailVerifiedAt: new Date(),
      now: new Date(),
    });
    const run = await startPuzzleStreak(['p1', 'p2'], user.id);
    const stale = await loadPuzzleStreak(run.id);
    assert.ok(stale);
    run.state.score = 1;
    run.state.results.push({ id: 'p1', outcome: 'solved' });
    assert.equal(await savePuzzleStreak(run), true);
    assert.equal(await savePuzzleStreak(stale), false);
    const restored = await loadPuzzleStreak(run.id);
    assert.equal(restored!.state.score, 1);
    assert.equal(restored!.userId, user.id);
    await startPuzzleStreak(['p1'], user.id);
    assert.equal(await bestPuzzleStreak(user.id), 1);
    assert.equal(await bestPuzzleStreak(null), null);
  });
});
