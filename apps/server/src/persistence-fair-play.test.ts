import { correspondenceTimeControl } from '@mistboard/game';
import { markFairPlay, unmarkFairPlay } from './fair-play.js';
import { createUser, recordGameEnd } from './persistence.js';
import { getPool, withTransaction } from './persistence-db.js';
import {
  getBestRatings,
  getBestRatingsAnyTimeClass,
  getLeaderboard,
  getLeaderboardSummary,
  getMostActivePlayers,
} from './persistence-leaderboards.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

definePersistenceTests('fair play', () => {
  async function seed() {
    const now = new Date();
    for (const id of ['marked', 'opponent', 'provisional']) {
      await createUser({
        id,
        email: `${id}@example.com`,
        emailVerifiedAt: now,
        handle: id,
        displayName: id,
        now,
      });
      for (const timeClass of ['blitz', 'correspondence']) {
        await getPool().query(
          `INSERT INTO user_ratings (user_id, variant, time_class, elo_rating, games_played, rating_deviation)
           VALUES ($1, 'xiangqi', $2, 1500, 20, $3)`,
          [id, timeClass, id === 'provisional' ? 200 : 80],
        );
      }
    }
    for (const [i, timeClass, opponent, result, loss] of [
      [0, 'blitz', 'opponent', 'red-wins', 100],
      [1, 'blitz', 'opponent', 'red-wins', 100],
      [2, 'correspondence', 'opponent', 'red-wins', 60],
      [3, 'blitz', 'provisional', 'red-wins', 50],
      [4, 'blitz', 'opponent', 'draw', 10],
      [5, 'blitz', 'opponent', 'black-wins', -10],
    ] as const) {
      await recordGameEnd(`fp-${i}`, {
        variant: 'xiangqi',
        mode: 'pvp',
        result,
        termination: 'resignation',
        plyCount: 10,
        // Plant immutable rating events below so the test controls the refund math.
        rated: false,
        startedAt: now,
        endedAt: new Date(now.getTime() + i * 1000),
        ...(timeClass === 'correspondence'
          ? correspondenceTimeControl(1)
          : { initialMs: 180_000, incrementMs: 2_000 }),
        whiteClient: null,
        blackClient: null,
        whiteName: null,
        blackName: null,
        corpusId: null,
        visibility: 'public',
        participants: [
          {
            color: 'red',
            subjectType: 'user',
            subjectId: 'marked',
            displayName: 'marked',
            visibility: 'public',
          },
          {
            color: 'black',
            subjectType: 'user',
            subjectId: opponent,
            displayName: opponent,
            visibility: 'public',
          },
        ],
      });
      await getPool().query(
        `UPDATE game_participants SET elo_before = 1500,
         elo_after = CASE WHEN subject_id = 'marked' THEN 1510 ELSE 1500 - $2 END
         WHERE game_id = $1`,
        [`fp-${i}`, loss],
      );
    }
  }

  test('dry run writes nothing; concurrent repeated marks refund once, preserving RD and games', async () => {
    await seed();
    const before = (
      await getPool().query('SELECT * FROM user_ratings ORDER BY user_id, time_class')
    ).rows;
    const preview = await withTransaction((client) => markFairPlay(client, 'marked', true));
    assert.equal(
      preview.reduce((total, refund) => total + refund.points, 0),
      210,
    );
    assert.deepEqual(
      (await getPool().query('SELECT * FROM user_ratings ORDER BY user_id, time_class')).rows,
      before,
    );
    assert.equal((await getPool().query('SELECT * FROM fair_play_refunds')).rowCount, 0);
    assert.equal(
      (await getPool().query("SELECT fair_play_marked_at FROM users WHERE id = 'marked'")).rows[0]
        .fair_play_marked_at,
      null,
    );
    const marked = await Promise.all([
      withTransaction((client) => markFairPlay(client, 'marked')),
      withTransaction((client) => markFairPlay(client, 'marked')),
    ]);
    assert.deepEqual(marked.map((refunds) => refunds.length).sort(), [0, 3]);
    const rows = (await getPool().query('SELECT * FROM user_ratings ORDER BY user_id, time_class'))
      .rows;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const previous = before[i]!;
      const points = row.user_id === 'opponent' ? (row.time_class === 'blitz' ? 150 : 60) : 0;
      assert.equal(row.elo_rating, previous.elo_rating + points);
      for (const column of ['rating_deviation', 'volatility', 'games_played', 'last_rated_at']) {
        assert.deepEqual(row[column], previous[column], column);
      }
    }
    assert.equal((await getPool().query('SELECT * FROM fair_play_refunds')).rowCount, 3);
    await withTransaction((client) => unmarkFairPlay(client, 'marked'));
    assert.deepEqual(await withTransaction((client) => markFairPlay(client, 'marked')), []);
    assert.equal((await getPool().query('SELECT * FROM fair_play_refunds')).rowCount, 3);
  });

  test('mark removes an account from every leaderboard and representative rating read; unmark restores it', async () => {
    await seed();
    assert.ok(
      (await getLeaderboard({ variant: 'xiangqi', timeClass: 'blitz' })).some(
        (row) => row.handle === 'marked',
      ),
    );
    await withTransaction((client) => markFairPlay(client, 'marked'));
    assert.ok(
      !(await getLeaderboard({ variant: 'xiangqi', timeClass: 'blitz' })).some(
        (row) => row.handle === 'marked',
      ),
    );
    assert.ok(
      !(await getLeaderboardSummary({ timeClass: 'blitz' }))
        .flatMap((ladder) => ladder.leaderboard)
        .some((row) => row.handle === 'marked'),
    );
    assert.ok(!(await getMostActivePlayers()).some((row) => row.handle === 'marked'));
    assert.equal((await getBestRatings(['marked', 'opponent'], 'blitz')).has('marked'), false);
    assert.equal((await getBestRatingsAnyTimeClass(['marked', 'opponent'])).has('marked'), false);
    await withTransaction((client) => unmarkFairPlay(client, 'marked'));
    assert.equal((await getBestRatings(['marked'], 'blitz')).has('marked'), true);
  });

  test('an interrupted mark rolls back both flag and refunds', async () => {
    await seed();
    await assert.rejects(
      withTransaction(async (client) => {
        await markFairPlay(client, 'marked');
        throw new Error('interrupt');
      }),
      /interrupt/,
    );
    assert.equal((await getPool().query('SELECT * FROM fair_play_refunds')).rowCount, 0);
    assert.equal(
      (await getPool().query("SELECT fair_play_marked_at FROM users WHERE id = 'marked'")).rows[0]
        .fair_play_marked_at,
      null,
    );
  });
});
