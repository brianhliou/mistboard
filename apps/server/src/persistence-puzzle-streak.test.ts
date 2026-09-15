import { createUser, getPuzzleStreak } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('puzzle streak', () => {
  test('getPuzzleStreak folds solved attempts into player-calendar days', async () => {
    const now = new Date('2026-09-14T01:00:00.000Z');
    const user = await createUser({
      id: 'pstreak-user',
      email: 'pstreak@example.com',
      emailVerifiedAt: now,
      handle: 'pstreak',
      displayName: 'P Streak',
      now,
    });
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      // New York calendar: 09-11 02:30Z is 09-10 evening, so solved days are
      // 09-10, 09-11, 09-12; the 09-13 row is a fail and does not count.
      await client.query(
        `INSERT INTO puzzle_attempts (user_id, puzzle_id, variant, solved, rated, created_at)
         VALUES
           ($1, 'p1', 'xiangqi', true, true, '2026-09-11T02:30:00Z'),
           ($1, 'p2', 'xiangqi', true, false, '2026-09-11T15:00:00Z'),
           ($1, 'p3', 'xiangqi', true, true, '2026-09-12T15:00:00Z'),
           ($1, 'p4', 'xiangqi', false, true, '2026-09-13T15:00:00Z')`,
        [user.id],
      );
    } finally {
      await client.end();
    }

    const alive = await getPuzzleStreak(user.id, { timeZone: 'America/New_York', now });
    assert.deepEqual(alive, {
      current: 3,
      best: 3,
      lastPlayedDay: '2026-09-12',
      today: '2026-09-13',
    });

    const utc = await getPuzzleStreak(user.id, { timeZone: 'UTC', now });
    assert.equal(utc.best, 2);

    const nobody = await getPuzzleStreak('pstreak-none', { now });
    assert.equal(nobody.best, 0);
  });
});
