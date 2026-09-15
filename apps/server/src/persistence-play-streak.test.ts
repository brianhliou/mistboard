import { getPlayStreak } from './persistence-play-streak.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('play streak', () => {
  test('getPlayStreak folds counted games into player-calendar days', async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO users (id, email, handle, display_name)
         VALUES ('streak-user', 'streak@example.com', 'streaker', 'Streaker')`,
      );
      // New York calendar: 09-11 02:30Z is 09-10 22:30 local, so the counted
      // days are 09-10, 09-11, 09-12. 09-13 has only an aborted game, which
      // neither extends nor bridges. The one-ply game on 09-14 is under the
      // counted-ply floor and does not count either.
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('streak-d1', 'xiangqi', 'red-wins', 'resignation', 30, $1, $1,
            'human', 'engine', NULL, NULL, 'pve', 'completed', 'public'),
           ('streak-d2', 'xiangqi', 'black-wins', 'resignation', 30, $2, $2,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('streak-d3', 'xiangqi', 'red-wins', 'resignation', 30, $3, $3,
            'human', 'engine', NULL, NULL, 'pve', 'completed', 'public'),
           ('streak-aborted', 'xiangqi', NULL, 'abandoned', 0, $4, $4,
            'human', 'engine', NULL, NULL, 'pve', 'aborted', 'public'),
           ('streak-short', 'xiangqi', 'red-wins', 'abandonment', 1, $5, $5,
            'engine', 'human', NULL, NULL, 'pve', 'completed', 'public')`,
        [
          new Date('2026-09-11T02:30:00.000Z'),
          new Date('2026-09-11T15:00:00.000Z'),
          new Date('2026-09-12T15:00:00.000Z'),
          new Date('2026-09-13T15:00:00.000Z'),
          new Date('2026-09-14T15:00:00.000Z'),
        ],
      );
      await client.query(
        `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name)
         VALUES
           ('streak-d1', 'red', 'user', 'streak-user', 'Streaker'),
           ('streak-d2', 'black', 'user', 'streak-user', 'Streaker'),
           ('streak-d2', 'red', 'guest', 'device-abc', 'Guest'),
           ('streak-d3', 'red', 'user', 'streak-user', 'Streaker'),
           ('streak-aborted', 'red', 'user', 'streak-user', 'Streaker'),
           ('streak-short', 'black', 'user', 'streak-user', 'Streaker')`,
      );
    } finally {
      await client.end();
    }

    // Read on 09-13 evening New York: the run 09-10..09-12 is alive (yesterday).
    const alive = await getPlayStreak(
      { type: 'user', id: 'streak-user' },
      { timeZone: 'America/New_York', now: new Date('2026-09-14T01:00:00.000Z') },
    );
    assert.deepEqual(alive, {
      current: 3,
      best: 3,
      lastPlayedDay: '2026-09-12',
      today: '2026-09-13',
    });

    // The same games in UTC: 02:30Z on the 11th joins the 15:00Z game, so
    // only two distinct days.
    const utc = await getPlayStreak(
      { type: 'user', id: 'streak-user' },
      { timeZone: 'UTC', now: new Date('2026-09-13T12:00:00.000Z') },
    );
    assert.equal(utc.best, 2);
    assert.equal(utc.current, 2);

    // Two days later the run is over; the best remains.
    const lapsed = await getPlayStreak(
      { type: 'user', id: 'streak-user' },
      { timeZone: 'America/New_York', now: new Date('2026-09-15T15:00:00.000Z') },
    );
    assert.equal(lapsed.current, 0);
    assert.equal(lapsed.best, 3);

    // A guest device has its own streak from its own seat.
    const guest = await getPlayStreak(
      { type: 'guest', id: 'device-abc' },
      { timeZone: 'UTC', now: new Date('2026-09-11T20:00:00.000Z') },
    );
    assert.deepEqual(guest, {
      current: 1,
      best: 1,
      lastPlayedDay: '2026-09-11',
      today: '2026-09-11',
    });

    // Nobody: empty, not an error.
    const nobody = await getPlayStreak({ type: 'guest', id: 'device-none' });
    assert.equal(nobody.best, 0);
  });
});
