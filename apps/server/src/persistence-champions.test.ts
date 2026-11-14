import { beforeEach } from 'node:test';
import { RATED_POOL_BASES } from '@mistboard/game';
import { PROVISIONAL_RD } from './glicko.js';
import {
  clearChampionsCache,
  createUser,
  getChampions,
  getGameSummary,
  getLeaderboard,
  getLeaderboardSummary,
  getUserProfileByHandle,
  recordGameEnd,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import {
  isPublicRatingPool,
  PUBLIC_RATING_TIME_CLASSES,
  type RatingTimeClass,
  type RatingVariant,
} from './rating-buckets.js';
import { postgamePlayers } from './routes/lib.js';

definePersistenceTests('champions', () => {
  beforeEach(clearChampionsCache);

  async function player(id: string) {
    const now = new Date();
    await createUser({
      id,
      email: `${id}@example.com`,
      emailVerifiedAt: now,
      handle: id,
      displayName: id,
      profileVisibility: 'public',
      now,
    });
  }

  async function rating(
    id: string,
    elo = 1800,
    rd = 60,
    variant: RatingVariant = 'xiangqi',
    timeClass: RatingTimeClass = 'blitz',
  ) {
    await getPool().query(
      `INSERT INTO user_ratings
        (user_id, variant, time_class, elo_rating, rating_deviation, games_played, last_rated_at)
       VALUES ($1, $2, $3, $4, $5, 20, now())`,
      [id, variant, timeClass, elo, rd],
    );
  }

  async function ladder(count = 5) {
    for (let i = 0; i < count; i++) {
      await player(`player${i}`);
      await rating(`player${i}`, 1800 - i * 10);
    }
  }

  test('profiles and finished participants share current crowns and preserve identity gates', async (t) => {
    await ladder();
    const expected = [{ variant: 'xiangqi', timeClass: 'blitz' }];
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    for (const subjectType of [
      'user',
      'guest',
      'bot',
      'engine-version',
      'manual',
      'imported',
    ] as const) {
      const now = new Date();
      await recordGameEnd(`crowns-${subjectType}`, {
        variant: 'xiangqi',
        mode: 'pvp',
        result: 'draw',
        termination: 'draw',
        plyCount: 20,
        startedAt: now,
        endedAt: now,
        whiteClient: null,
        blackClient: null,
        whiteName: null,
        blackName: null,
        corpusId: null,
        visibility: 'public',
        participants: [
          {
            color: 'white',
            subjectType,
            subjectId: 'player0',
            displayName: 'Seat',
            visibility: 'public',
          },
        ],
      });
      const game = await getGameSummary(`crowns-${subjectType}`);
      assert.ok(game);
      if (subjectType === 'user') {
        assert.equal(game.participants[0]?.handle, 'player0');
        assert.deepEqual(game.participants[0]?.champions, expected);
        assert.deepEqual(postgamePlayers(game.participants)[0]?.champions, expected);
      } else {
        assert.doesNotMatch(JSON.stringify(game.participants), /"champions"|"handle"/);
        assert.doesNotMatch(
          JSON.stringify(postgamePlayers(game.participants)),
          /"champions"|"handle":"player0"/,
        );
      }
    }
    assert.deepEqual((await getUserProfileByHandle('player0', null))?.user.champions, expected);
    await getPool().query(`UPDATE user_ratings SET elo_rating = 2200 WHERE user_id = 'player1'`);
    t.mock.timers.tick(30_001);
    assert.deepEqual((await getGameSummary('crowns-user'))?.participants[0]?.champions, []);
    assert.deepEqual((await getUserProfileByHandle('player1', null))?.user.champions, expected);
    await getPool().query(
      `UPDATE game_participants SET subject_id = 'player1' WHERE game_id = 'crowns-user'`,
    );
    assert.deepEqual((await getGameSummary('crowns-user'))?.participants[0]?.champions, expected);
    await getPool().query(
      `UPDATE user_ratings SET last_rated_at = now() - interval '91 days' WHERE user_id = 'player1'`,
    );
    t.mock.timers.tick(30_001);
    assert.deepEqual((await getGameSummary('crowns-user'))?.participants[0]?.champions, []);
  });

  test('finished private seats and private or closed profiles expose no account metadata even with a warm crown', async () => {
    await ladder();
    await getChampions();
    const now = new Date();
    await recordGameEnd('crowns-privacy', {
      variant: 'xiangqi',
      mode: 'pvp',
      result: 'draw',
      termination: 'draw',
      plyCount: 20,
      startedAt: now,
      endedAt: now,
      whiteClient: null,
      blackClient: null,
      whiteName: null,
      blackName: null,
      corpusId: null,
      visibility: 'public',
      participants: [
        {
          color: 'white',
          subjectType: 'user',
          subjectId: 'player0',
          displayName: 'Seat',
          visibility: 'public',
        },
      ],
    });
    for (const privacy of ['unlisted', 'private', 'closed', 'seat-private']) {
      await getPool().query(
        `UPDATE users SET profile_visibility = $1, closed_at = $2 WHERE id = 'player0'`,
        [privacy === 'private' ? 'private' : 'unlisted', privacy === 'closed' ? now : null],
      );
      await getPool().query(
        `UPDATE game_participants SET visibility = $1 WHERE game_id = 'crowns-privacy'`,
        [privacy === 'seat-private' ? 'private' : 'public'],
      );
      const game = await getGameSummary('crowns-privacy');
      assert.ok(game);
      if (privacy === 'unlisted') {
        assert.deepEqual(game.participants[0]?.champions, [
          { variant: 'xiangqi', timeClass: 'blitz' },
        ]);
      } else {
        assert.doesNotMatch(JSON.stringify(game.participants), /"champions"|"title"|"flair"/);
        assert.doesNotMatch(
          JSON.stringify(postgamePlayers(game.participants)),
          /"champions"|"handle":"player0"/,
        );
      }
    }
  });

  test('only ratings active within 90 days appear on ladders; profile ratings survive', async () => {
    const now = new Date();
    for (const [id, days] of [
      ['active', 89],
      ['inactive', 91],
      ['undated', null],
    ] as const) {
      await createUser({
        id,
        email: `${id}@example.com`,
        emailVerifiedAt: now,
        handle: id,
        displayName: id,
        profileVisibility: 'public',
        now,
      });
      await getPool().query(
        `INSERT INTO user_ratings
          (user_id, variant, time_class, elo_rating, rating_deviation, games_played, last_rated_at)
         VALUES ($1, 'xiangqi', 'blitz', 1800, 60, 20, now() - $2 * interval '1 day')`,
        [id, days],
      );
    }
    assert.deepEqual(
      (await getLeaderboard({ variant: 'xiangqi', timeClass: 'blitz' })).map((row) => row.handle),
      ['active'],
    );
    assert.deepEqual(
      (await getLeaderboardSummary({ timeClass: 'blitz' })).flatMap((ladder) =>
        ladder.leaderboard.map((row) => row.handle),
      ),
      ['active'],
    );
    for (const handle of ['inactive', 'undated']) {
      const profile = await getUserProfileByHandle(handle, null);
      assert.equal(profile?.ratings.find((row) => row.variant === 'xiangqi')?.eloRating, 1800);
    }
  });

  test('five active established accounts are required; provisional players keep their ladder entry', async () => {
    await ladder(4);
    await player('provisional');
    await rating('provisional', 3000, PROVISIONAL_RD + 1);
    assert.deepEqual(
      await getChampions(),
      [],
      'a provisional account is not the fifth eligible player',
    );

    await player('fifth');
    await rating('fifth', 1600, PROVISIONAL_RD);
    clearChampionsCache();
    assert.deepEqual(
      await getChampions(),
      [{ userId: 'player0', handle: 'player0', variant: 'xiangqi', timeClass: 'blitz' }],
      'RD at the threshold is established; a provisional rating cannot win',
    );
    const board = await getLeaderboard({ variant: 'xiangqi', timeClass: 'blitz' });
    assert.equal(board[0]!.handle, 'provisional');
    assert.deepEqual(board[0]!.champions, []);
    assert.deepEqual(board.find((row) => row.handle === 'player0')?.champions, [
      { variant: 'xiangqi', timeClass: 'blitz' },
    ]);
    const summary = await getLeaderboardSummary({ timeClass: 'blitz', limitPerVariant: 2 });
    assert.deepEqual(
      summary[0]!.leaderboard,
      board.slice(0, 2),
      'summary limits do not limit champion eligibility',
    );
  });

  test('champions follow conservative order and break exact ties consistently', async () => {
    await ladder();
    await getPool().query(
      `UPDATE user_ratings SET elo_rating = 1880, rating_deviation = 110 WHERE user_id = 'player0'`,
    );
    assert.equal((await getChampions())[0]?.handle, 'player1', 'highest raw Elo does not win');
    await getPool().query(`UPDATE user_ratings SET elo_rating = 1790 WHERE user_id = 'player2'`);
    clearChampionsCache();
    assert.equal(
      (await getChampions())[0]?.handle,
      'player1',
      'handle order makes an exact tie deterministic',
    );
  });

  test('overtaking and activity expiry recompute after the short cache expires', async (t) => {
    await ladder();
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    assert.equal((await getChampions())[0]?.handle, 'player0');
    await getPool().query(`UPDATE user_ratings SET elo_rating = 2200 WHERE user_id = 'player1'`);
    assert.equal(
      (await getChampions())[0]?.handle,
      'player0',
      'reads briefly share the previous computation',
    );
    t.mock.timers.tick(30_001);
    assert.equal((await getChampions())[0]?.handle, 'player1', 'the new leader takes the crown');
    await getPool().query(
      `UPDATE user_ratings SET last_rated_at = now() - interval '91 days' WHERE user_id = 'player1'`,
    );
    t.mock.timers.tick(30_001);
    assert.deepEqual(await getChampions(), [], 'expiry drops the eligible count below five');
    await player('replacement');
    await rating('replacement', 1500);
    t.mock.timers.tick(30_001);
    assert.equal(
      (await getChampions())[0]?.handle,
      'player0',
      'an active fifth player restores the crown',
    );
  });

  test('each public rated variant and all four time classes have independent champions', async () => {
    for (let i = 0; i < 5; i++) await player(`player${i}`);
    const expected = new Map<string, string>();
    for (const [variantIndex, variant] of RATED_POOL_BASES.entries()) {
      for (const [classIndex, timeClass] of PUBLIC_RATING_TIME_CLASSES.entries()) {
        const winner = (variantIndex + classIndex) % 5;
        for (let i = 0; i < 5; i++) {
          await rating(`player${i}`, i === winner ? 2000 : 1500, 60, variant, timeClass);
        }
        if (isPublicRatingPool(variant)) expected.set(`${variant}/${timeClass}`, `player${winner}`);
      }
    }
    const champions = await getChampions();
    assert.equal(champions.length, expected.size);
    for (const champion of champions) {
      assert.equal(expected.get(`${champion.variant}/${champion.timeClass}`), champion.userId);
    }
    for (const timeClass of PUBLIC_RATING_TIME_CLASSES) {
      const summary = await getLeaderboardSummary({ timeClass });
      for (const { leaderboard } of summary) {
        for (const entry of leaderboard) {
          const earned = champions
            .filter((champion) => champion.handle === entry.handle)
            .map(({ variant, timeClass }) => ({ variant, timeClass }));
          assert.deepEqual(
            entry.champions,
            earned,
            'every entry carries all crowns across ladders',
          );
          assert.ok(
            entry.champions.every((champion) => !('userId' in champion)),
            'public crowns contain only ladder keys',
          );
        }
      }
    }
  });

  for (const [name, update] of [
    ['stats-excluded', 'stats_excluded_at = now()'],
    ['fair-play marked', 'fair_play_marked_at = now()'],
    ['private profile', "profile_visibility = 'private'"],
    ['inactive', "last_rated_at = now() - interval '91 days'"],
    ['undated', 'last_rated_at = NULL'],
    ['never played', 'games_played = 0'],
  ] as const) {
    test(`${name} accounts cannot win or count toward the five-player threshold`, async () => {
      await ladder();
      const table =
        update.startsWith('last_rated_at') || update.startsWith('games_played')
          ? 'user_ratings'
          : 'users';
      const idColumn = table === 'users' ? 'id' : 'user_id';
      await getPool().query(`UPDATE ${table} SET ${update} WHERE ${idColumn} = 'player0'`);
      assert.deepEqual(await getChampions(), [], 'only four eligible accounts remain');
      await player('replacement');
      await rating('replacement', 1500);
      clearChampionsCache();
      assert.equal((await getChampions())[0]?.handle, 'player1');
    });
  }

  test('unlisted profiles remain eligible', async () => {
    await ladder();
    await getPool().query(`UPDATE users SET profile_visibility = 'unlisted' WHERE id = 'player0'`);
    assert.equal((await getChampions())[0]?.handle, 'player0');
  });
});
