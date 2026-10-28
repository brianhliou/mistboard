import { createUser } from './persistence.js';
import {
  getPuzzleRating,
  getUserPuzzleRating,
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
    assert.equal(user?.rating, 1800); // the new-player start, unchanged
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

  test('a first rating row starts a new player at 1800, not the 1500 column default', async () => {
    await mkUser('u6', 'newcomer');
    const res = await recordPuzzleAttempt({
      userId: 'u6',
      puzzleId: 'p-6',
      variant: 'xiangqi',
      solved: true,
      rated: true,
      seedRating: seedPuzzleRating(5), // 1900
    });
    assert.ok(res);
    // The delta is measured from the start the row was seeded with.
    assert.equal(res.userRating - res.userRatingDelta, 1800);
    const user = await getUserPuzzleRating('u6', 'xiangqi');
    assert.ok(user);
    assert.ok(user.rating > 1800);
    assert.equal(user.provisional, true);
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
});
