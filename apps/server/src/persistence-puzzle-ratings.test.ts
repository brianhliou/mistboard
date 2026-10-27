import { createUser } from './persistence.js';
import { getPool } from './persistence-db.js';
import {
  getPuzzleRating,
  getUserPuzzleRating,
  listAttemptedPuzzleIds,
  listFailedPuzzleAttempts,
  listPuzzleAttemptHistory,
  recordPuzzleAttempt,
} from './persistence-puzzle-ratings.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { seedPuzzleRating } from './puzzle-rating.js';

definePersistenceTests('puzzle-ratings', () => {
  const now = new Date();
  const mkUser = (id: string, handle: string) =>
    createUser({
      id,
      email: `${handle}@example.com`,
      emailVerifiedAt: now,
      handle,
      displayName: handle,
      now,
    });

  test('a rated solve raises the user and lowers the puzzle', async () => {
    await mkUser('u1', 'solver');
    const res = await recordPuzzleAttempt({
      userId: 'u1',
      puzzleId: 'p-1',
      variant: 'fortress-xiangqi',
      solved: true,
      rated: true,
      seedRating: seedPuzzleRating(3), // mate-in-2 -> 1600
    });
    assert.ok(res);
    assert.equal(res.firstAttempt, true);
    assert.equal(res.ratingChanged, true);
    assert.ok(res.userRatingDelta > 0);

    const user = await getUserPuzzleRating('u1', 'fortress-xiangqi');
    assert.ok(user);
    assert.ok(user.rating > 1500);
    assert.equal(user.solved, 1);
    assert.equal(user.attempts, 1);

    const puzzle = await getPuzzleRating('p-1');
    assert.ok(puzzle);
    assert.ok(puzzle.rating < 1600);
    assert.equal(puzzle.plays, 1);
    assert.equal(puzzle.solves, 1);
  });

  test('a repeat attempt is idempotent', async () => {
    await mkUser('u2', 'repeater');
    const seed = seedPuzzleRating(1);
    await recordPuzzleAttempt({
      userId: 'u2',
      puzzleId: 'p-2',
      variant: 'mini-xiangqi',
      solved: true,
      rated: true,
      seedRating: seed,
    });
    const firstRating = (await getUserPuzzleRating('u2', 'mini-xiangqi'))?.rating;

    const second = await recordPuzzleAttempt({
      userId: 'u2',
      puzzleId: 'p-2',
      variant: 'mini-xiangqi',
      solved: false,
      rated: true,
      seedRating: seed,
    });
    assert.ok(second);
    assert.equal(second.firstAttempt, false);
    assert.equal(second.ratingChanged, false);
    assert.equal(second.userRatingDelta, 0);

    const after = await getUserPuzzleRating('u2', 'mini-xiangqi');
    assert.equal(after?.rating, firstRating);
    assert.equal(after?.attempts, 1); // repeat did not re-count
  });

  test('an unrated attempt counts as a play but moves no ratings', async () => {
    await mkUser('u3', 'casual');
    const res = await recordPuzzleAttempt({
      userId: 'u3',
      puzzleId: 'p-3',
      variant: 'fortress-xiangqi',
      solved: true,
      rated: false,
      seedRating: seedPuzzleRating(3),
    });
    assert.ok(res);
    assert.equal(res.ratingChanged, false);
    assert.equal(res.userRatingDelta, 0);

    const user = await getUserPuzzleRating('u3', 'fortress-xiangqi');
    assert.equal(user?.rating, 1500); // unchanged
    assert.equal(user?.attempts, 1); // still counted
    assert.equal(user?.solved, 1);

    const puzzle = await getPuzzleRating('p-3');
    assert.equal(puzzle?.rating, 1600); // seed unchanged
    assert.equal(puzzle?.plays, 1);
  });

  test('failing lowers the user and raises the puzzle', async () => {
    await mkUser('u4', 'failer');
    const res = await recordPuzzleAttempt({
      userId: 'u4',
      puzzleId: 'p-4',
      variant: 'mini-xiangqi',
      solved: false,
      rated: true,
      seedRating: seedPuzzleRating(1), // 1300
    });
    assert.ok(res);
    assert.ok(res.userRatingDelta < 0);

    const puzzle = await getPuzzleRating('p-4');
    assert.ok(puzzle);
    assert.ok(puzzle.rating > 1300);
  });

  test('user puzzle ratings are per variant', async () => {
    await mkUser('u5', 'multi');
    await recordPuzzleAttempt({
      userId: 'u5',
      puzzleId: 'mx-1',
      variant: 'mini-xiangqi',
      solved: true,
      rated: true,
      seedRating: seedPuzzleRating(1),
    });
    const mini = await getUserPuzzleRating('u5', 'mini-xiangqi');
    const fortress = await getUserPuzzleRating('u5', 'fortress-xiangqi');
    assert.ok(mini);
    assert.equal(fortress, null); // untouched variant has no rating yet
  });

  test('history matches stored first outcomes, orders tied timestamps, and isolates accounts', async () => {
    await mkUser('history-owner', 'history-owner');
    await mkUser('history-other', 'history-other');
    const attempt = (puzzleId: string, solved: boolean, rated = true, variant = 'xiangqi') =>
      recordPuzzleAttempt({
        userId: 'history-owner',
        puzzleId,
        variant,
        solved,
        rated,
        seedRating: seedPuzzleRating(3),
      });
    // Insert out of chronological/tie-break order, and include an unrated
    // failure. A retry must not replace the stored first outcome or rating.
    await attempt('history-b', false);
    await attempt('history-a', true);
    await attempt('history-c', false, false);
    await attempt('history-a', false);
    await attempt('history-jungle', true, true, 'jungle');
    await recordPuzzleAttempt({
      userId: 'history-other',
      puzzleId: 'other-private',
      variant: 'xiangqi',
      solved: true,
      rated: true,
      seedRating: seedPuzzleRating(1),
    });
    await getPool().query(
      `UPDATE puzzle_attempts SET created_at = '2026-10-26T12:00:00Z'
       WHERE user_id = $1`,
      ['history-owner'],
    );
    const stored = await getPool().query<{
      puzzle_id: string;
      solved: boolean;
      rated: boolean;
      user_rating_before: number;
      user_rating_after: number;
      created_at: Date;
    }>(
      `SELECT * FROM puzzle_attempts WHERE user_id = $1 AND variant = $2
       ORDER BY created_at, puzzle_id`,
      ['history-owner', 'xiangqi'],
    );
    const first = await listPuzzleAttemptHistory('history-owner', 'xiangqi', 2, 0);
    const last = await listPuzzleAttemptHistory('history-owner', 'xiangqi', 2, 2);
    assert.equal(first.nextOffset, 2);
    assert.equal(last.nextOffset, null);
    assert.deepEqual(
      [...first.attempts, ...last.attempts],
      stored.rows.map((row) => ({
        puzzleId: row.puzzle_id,
        variant: 'xiangqi',
        solved: row.solved,
        rated: row.rated,
        ratingBefore: row.user_rating_before,
        ratingAfter: row.user_rating_after,
        ratingDelta: row.user_rating_after - row.user_rating_before,
        createdAt: row.created_at.toISOString(),
      })),
    );
    assert.deepEqual(
      first.attempts.map((row) => row.puzzleId),
      ['history-a', 'history-b'],
    );
    assert.equal(first.attempts[0]?.solved, true);
    assert.equal(last.attempts[0]?.ratingDelta, 0);
    assert.equal((await getUserPuzzleRating('history-owner', 'xiangqi'))?.attempts, 3);
    const other = await listPuzzleAttemptHistory('history-other', 'xiangqi', 50, 0);
    assert.deepEqual(
      other.attempts.map((row) => row.puzzleId),
      ['other-private'],
    );
    const jungle = await listPuzzleAttemptHistory('history-owner', 'jungle', 50, 0);
    assert.deepEqual(
      jungle.attempts.map((row) => row.puzzleId),
      ['history-jungle'],
    );

  test('a later solve repairs a rated or unrated failure without rewriting its first outcome', async () => {
    for (const rated of [true, false]) {
      const userId = `repair-${rated}`;
      await mkUser(userId, userId);
      const input = {
        userId,
        puzzleId: `failed-${rated}`,
        variant: 'xiangqi',
        solved: false,
        rated,
        seedRating: seedPuzzleRating(3),
      };
      const failed = await recordPuzzleAttempt(input);
      assert.equal(failed?.repairedAt, null);
      const original = await getPool().query(
        `SELECT solved, rated, user_rating_before, user_rating_after, created_at
         FROM puzzle_attempts WHERE user_id = $1 AND puzzle_id = $2`,
        [userId, input.puzzleId],
      );
      const userBefore = await getUserPuzzleRating(userId, input.variant);
      const puzzleBefore = await getPuzzleRating(input.puzzleId);
      const unresolved = await listFailedPuzzleAttempts(userId);
      assert.equal(unresolved.length, 1);
      assert.equal(unresolved[0].puzzleId, input.puzzleId);
      assert.equal(unresolved[0].failedAt, original.rows[0].created_at.toISOString());
      assert.equal(unresolved[0].repairedAt, null);

      // Simultaneous solves serialize on the rating locks. Only the first
      // repair time lands, and neither retry re-rates either participant.
      const retries = await Promise.all([
        recordPuzzleAttempt({ ...input, solved: true, rated: !rated }),
        recordPuzzleAttempt({ ...input, solved: true, rated: true }),
      ]);
      assert.ok(retries[0]?.repairedAt);
      for (const retry of retries) {
        assert.equal(retry?.firstAttempt, false);
        assert.equal(retry?.ratingChanged, false);
        assert.equal(retry?.userRatingDelta, 0);
        assert.equal(retry?.repairedAt, retries[0].repairedAt);
      }
      assert.deepEqual(await getUserPuzzleRating(userId, input.variant), userBefore);
      assert.deepEqual(await getPuzzleRating(input.puzzleId), puzzleBefore);
      const after = await getPool().query(
        `SELECT solved, rated, user_rating_before, user_rating_after, created_at
         FROM puzzle_attempts WHERE user_id = $1 AND puzzle_id = $2`,
        [userId, input.puzzleId],
      );
      assert.deepEqual(after.rows, original.rows);
      assert.deepEqual(await listFailedPuzzleAttempts(userId), []);
      assert.deepEqual(await listFailedPuzzleAttempts(userId, { repaired: true }), [
        { ...unresolved[0], repairedAt: retries[0].repairedAt },
      ]);
      assert.deepEqual(await listAttemptedPuzzleIds(userId), [input.puzzleId]);

      // A subsequent mistake cannot clear or move the first repair time.
      assert.equal((await recordPuzzleAttempt(input))?.repairedAt, retries[0].repairedAt);
    }
  });

  test('failed queues isolate accounts and variants and exclude original solves', async () => {
    await mkUser('queue-user', 'queue-user');
    await mkUser('other-user', 'other-user');
    const input = {
      userId: 'queue-user',
      variant: 'xiangqi',
      solved: false,
      rated: false,
      seedRating: seedPuzzleRating(1),
    };
    await recordPuzzleAttempt({ ...input, puzzleId: 'xiangqi-fail' });
    await recordPuzzleAttempt({ ...input, puzzleId: 'jungle-fail', variant: 'jungle' });
    await recordPuzzleAttempt({ ...input, puzzleId: 'first-solve', solved: true });
    await recordPuzzleAttempt({ ...input, puzzleId: 'other-fail', userId: 'other-user' });
    assert.deepEqual(
      (await listFailedPuzzleAttempts('queue-user', { variant: 'xiangqi' })).map(
        (failure) => failure.puzzleId,
      ),
      ['xiangqi-fail'],
    );
    assert.deepEqual(
      (await listFailedPuzzleAttempts('other-user')).map((failure) => failure.puzzleId),
      ['other-fail'],
    );
    // Solving an original success again never puts it into the repair history.
    assert.equal(
      (await recordPuzzleAttempt({ ...input, puzzleId: 'first-solve', solved: true }))?.repairedAt,
      null,
    );
    assert.deepEqual(await listFailedPuzzleAttempts('queue-user', { repaired: true }), []);
    assert.deepEqual(await listFailedPuzzleAttempts('queue-user', { variant: 'banqi' }), []);
  });
});
