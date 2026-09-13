import {
  abortRunningGame,
  createUser,
  getBestRatings,
  getGameSummary,
  getLeaderboard,
  getLeaderboardSummary,
  getMostActivePlayers,
  getUserGamesPage,
  getUserProfileByHandle,
  getUserRatingHistory,
  recordGameEnd,
  recordGameStart,
} from './persistence.js';
import type { ProfileBucketRating } from './persistence-profiles.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import type { RatingVariant } from './rating-buckets.js';

definePersistenceTests('ratings', () => {
  test('rated PvP game updates both players Glicko ratings', async () => {
    const now = new Date();
    await createUser({
      id: 'user_white',
      email: 'w@example.com',
      emailVerifiedAt: now,
      handle: 'whiteplayer',
      displayName: 'White',
      now,
    });
    await createUser({
      id: 'user_black',
      email: 'b@example.com',
      emailVerifiedAt: now,
      handle: 'blackplayer',
      displayName: 'Black',
      now,
    });

    await recordGameEnd('rated-pvp-1', {
      variant: 'dark-chess',
      mode: 'pvp',
      rated: true,
      result: 'white-wins',
      termination: 'king-captured',
      plyCount: 30,
      startedAt: now,
      endedAt: now,
      initialMs: 180000, // 3+2 → blitz bucket
      incrementMs: 2000,
      whiteClient: 'browser',
      blackClient: 'browser',
      whiteName: 'White',
      blackName: 'Black',
      corpusId: null,
      participants: [
        {
          color: 'white',
          displayName: 'White',
          subjectType: 'user',
          subjectId: 'user_white',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'Black',
          subjectType: 'user',
          subjectId: 'user_black',
          visibility: 'public',
        },
      ],
      visibility: 'public',
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{
        user_id: string;
        elo_rating: number;
        rating_deviation: number;
        volatility: string;
        games_played: number;
      }>(
        `SELECT user_id, elo_rating, rating_deviation, volatility, games_played
         FROM user_ratings WHERE variant = 'fog' AND time_class = 'blitz'`,
      );
      assert.equal(rows.length, 2, 'both players got a rating row');
      const white = rows.find((r) => r.user_id === 'user_white')!;
      const black = rows.find((r) => r.user_id === 'user_black')!;
      // Winner rises above the 1500 base, loser falls below it.
      assert.ok(white.elo_rating > 1500, `white rating ${white.elo_rating}`);
      assert.ok(black.elo_rating < 1500, `black rating ${black.elo_rating}`);
      // RD tightened from the 350 default; volatility persisted.
      assert.ok(white.rating_deviation < 350, `white RD ${white.rating_deviation}`);
      assert.ok(Number(white.volatility) > 0, 'volatility stored');
      assert.equal(white.games_played, 1);

      // The per-game rating-event log (game_participants) recorded before/after.
      const { rows: parts } = await client.query<{
        elo_before: number;
        elo_after: number;
        rd_after: number;
      }>(
        `SELECT elo_before, elo_after, rd_after FROM game_participants
         WHERE game_id = 'rated-pvp-1' AND color = 'white'`,
      );
      assert.equal(parts[0]!.elo_before, 1500);
      assert.ok(parts[0]!.elo_after > 1500);
      assert.ok(parts[0]!.rd_after < 350);
    } finally {
      await client.end();
    }

    // The game summary exposes the rating delta so the game page can show +/-.
    const summary = await getGameSummary('rated-pvp-1');
    const wp = summary?.participants?.find((p) => p.color === 'white');
    assert.equal(wp?.ratingBefore, 1500, 'summary exposes ratingBefore');
    assert.ok((wp?.ratingAfter ?? 0) > 1500, 'summary exposes ratingAfter');
  });

  test('rated standard Xiangqi PvP game rates red and black users in the xiangqi bucket', async () => {
    // Regression for the #151 flip: xiangqi seats are red/black, and until the
    // ratedParticipantColorsForVariant entry existed the rating block searched
    // for a 'white' participant, found none, and SILENTLY rated nobody while
    // the games row still said rated=true.
    const now = new Date();
    await createUser({
      id: 'user_xq_red',
      email: 'xq-red@example.com',
      emailVerifiedAt: now,
      handle: 'xqred',
      displayName: 'XQ Red',
      now,
    });
    await createUser({
      id: 'user_xq_black',
      email: 'xq-black@example.com',
      emailVerifiedAt: now,
      handle: 'xqblack',
      displayName: 'XQ Black',
      now,
    });

    await recordGameEnd('rated-xq-1', {
      variant: 'xiangqi',
      mode: 'pvp',
      rated: true,
      result: 'black-wins',
      termination: 'resignation',
      plyCount: 3,
      startedAt: now,
      endedAt: now,
      initialMs: 180000,
      incrementMs: 2000,
      whiteClient: null,
      blackClient: null,
      whiteName: null,
      blackName: null,
      corpusId: null,
      participants: [
        {
          color: 'red',
          displayName: 'XQ Red',
          subjectType: 'user',
          subjectId: 'user_xq_red',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'XQ Black',
          subjectType: 'user',
          subjectId: 'user_xq_black',
          visibility: 'public',
        },
      ],
      visibility: 'public',
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{
        user_id: string;
        elo_rating: number;
        games_played: number;
      }>(
        `SELECT user_id, elo_rating, games_played
         FROM user_ratings WHERE variant = 'xiangqi' AND time_class = 'blitz'`,
      );
      assert.equal(rows.length, 2, 'both xiangqi players got a rating row');
      const red = rows.find((r) => r.user_id === 'user_xq_red')!;
      const black = rows.find((r) => r.user_id === 'user_xq_black')!;
      assert.ok(black.elo_rating > 1500, `black rating ${black.elo_rating}`);
      assert.ok(red.elo_rating < 1500, `red rating ${red.elo_rating}`);
      assert.equal(black.games_played, 1);
    } finally {
      await client.end();
    }
  });

  test('rated game rates on a forfeit (abandonment) termination', async () => {
    // Rating is termination-independent: any completed rated PvP game rates.
    // Forfeit (abandonment) is a real win, so it must move ratings like any other.
    const now = new Date();
    await createUser({
      id: 'ff_w',
      email: 'ffw@e.com',
      emailVerifiedAt: now,
      handle: 'ffwhite',
      displayName: 'FFW',
      now,
    });
    await createUser({
      id: 'ff_b',
      email: 'ffb@e.com',
      emailVerifiedAt: now,
      handle: 'ffblack',
      displayName: 'FFB',
      now,
    });
    await recordGameEnd('rated-forfeit', {
      variant: 'dark-chess',
      mode: 'pvp',
      rated: true,
      result: 'white-wins',
      termination: 'abandonment',
      plyCount: 12,
      startedAt: now,
      endedAt: now,
      initialMs: 180000,
      incrementMs: 2000,
      whiteClient: 'b',
      blackClient: 'b',
      whiteName: 'FFW',
      blackName: 'FFB',
      corpusId: null,
      participants: [
        {
          color: 'white',
          displayName: 'FFW',
          subjectType: 'user',
          subjectId: 'ff_w',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'FFB',
          subjectType: 'user',
          subjectId: 'ff_b',
          visibility: 'public',
        },
      ],
      visibility: 'public',
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ user_id: string; elo_rating: number }>(
        `SELECT user_id, elo_rating FROM user_ratings WHERE variant = 'fog' AND time_class = 'blitz'`,
      );
      assert.equal(rows.length, 2, 'forfeit rated both players');
      assert.ok(rows.find((r) => r.user_id === 'ff_w')!.elo_rating > 1500, 'forfeit winner gained');
      assert.ok(rows.find((r) => r.user_id === 'ff_b')!.elo_rating < 1500, 'forfeit loser lost');
    } finally {
      await client.end();
    }
  });

  test('aborted game does not affect ratings', async () => {
    // Aborts go through abortRunningGame (status='aborted'), never recordGameEnd,
    // so they must never touch ratings — even for a rated PvP room of two accounts.
    const now = new Date();
    await createUser({
      id: 'ab_w',
      email: 'abw@e.com',
      emailVerifiedAt: now,
      handle: 'abwhite',
      displayName: 'ABW',
      now,
    });
    await createUser({
      id: 'ab_b',
      email: 'abb@e.com',
      emailVerifiedAt: now,
      handle: 'abblack',
      displayName: 'ABB',
      now,
    });
    await recordGameStart('rated-aborted', {
      variant: 'dark-chess',
      mode: 'pvp',
      startedAt: now,
      whiteClient: 'b',
      blackClient: 'b',
      whiteName: 'ABW',
      blackName: 'ABB',
      corpusId: null,
    });
    const aborted = await abortRunningGame('rated-aborted', {
      abortedReason: 'user-abort',
      termination: 'abandoned',
    });
    assert.equal(aborted, true, 'running game was aborted');

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(`SELECT 1 FROM user_ratings WHERE user_id = ANY($1)`, [
        ['ab_w', 'ab_b'],
      ]);
      assert.equal(rows.length, 0, 'aborted game created no rating rows');
    } finally {
      await client.end();
    }
  });

  test('leaderboard shows provisional players (marked) ranked low by conservative rating', async () => {
    const now = new Date();
    await createUser({
      id: 'u_hi',
      email: 'hi@e.com',
      emailVerifiedAt: now,
      handle: 'settledhi',
      displayName: 'Hi',
      profileVisibility: 'public',
      now,
    });
    await createUser({
      id: 'u_lo',
      email: 'lo@e.com',
      emailVerifiedAt: now,
      handle: 'settledlo',
      displayName: 'Lo',
      profileVisibility: 'public',
      now,
    });
    await createUser({
      id: 'u_pv',
      email: 'pv@e.com',
      emailVerifiedAt: now,
      handle: 'provis',
      displayName: 'Pv',
      profileVisibility: 'public',
      now,
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      // Conservative (rating - 2*RD): hi=1480, lo=1430, pv=1300.
      // pv has the highest RAW rating (1900) but RD 300 (provisional) → it sorts
      // LAST by conservative rating and is marked provisional, not hidden.
      await client.query(
        `INSERT INTO user_ratings (user_id, variant, time_class, elo_rating, rating_deviation, volatility, games_played)
         VALUES
          ('u_hi','fog','blitz',1600,60,0.06,20),
          ('u_lo','fog','blitz',1550,60,0.06,20),
          ('u_pv','fog','blitz',1900,300,0.06,3)`,
      );
    } finally {
      await client.end();
    }

    const board = await getLeaderboard({ variant: 'fog', timeClass: 'blitz', limit: 100 });
    assert.equal(board.length, 3, 'provisional player is shown, not hidden');
    assert.equal(board[0]!.handle, 'settledhi', 'highest conservative rating ranks first');
    assert.equal(board[0]!.provisional, false);
    assert.equal(board[1]!.handle, 'settledlo');
    assert.equal(board[2]!.handle, 'provis', 'provisional sorts last despite highest raw rating');
    assert.equal(board[2]!.provisional, true);
    assert.equal(
      board[2]!.eloRating,
      1900,
      'displays actual rating (with "?" client-side), not conservative',
    );
    assert.equal(board[0]!.rank, 1);
  });

  test('leaderboard summary groups top-N per variant and hides private profiles', async () => {
    const now = new Date();
    const mk = (id: string, handle: string, visibility?: 'public' | 'private') =>
      createUser({
        id,
        email: `${id}@sum.com`,
        emailVerifiedAt: now,
        handle,
        displayName: handle,
        ...(visibility ? { profileVisibility: visibility } : {}),
        now,
      });
    await mk('sum_a', 'sum-alpha', 'public');
    await mk('sum_b', 'sum-beta', 'public');
    await mk('sum_c', 'sum-gamma', 'public');
    await mk('sum_p', 'sum-private', 'private');

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      // Jungle: three settled players + a private one that must not appear.
      // Jungle flip: one player, proving grouping keeps ladders separate.
      await client.query(
        `INSERT INTO user_ratings (user_id, variant, time_class, elo_rating, rating_deviation, volatility, games_played)
         VALUES
          ('sum_a','jungle','blitz',1700,60,0.06,20),
          ('sum_b','jungle','blitz',1600,60,0.06,20),
          ('sum_c','jungle','blitz',1500,60,0.06,20),
          ('sum_p','jungle','blitz',1900,60,0.06,20),
          ('sum_a','jungle_flip','blitz',1400,60,0.06,10)`,
      );
    } finally {
      await client.end();
    }

    // limitPerVariant=2 cuts the jungle ladder after two visible rows.
    const summary = await getLeaderboardSummary({ timeClass: 'blitz', limitPerVariant: 2 });
    const jungle = summary.find((ladder) => ladder.variant === 'jungle');
    assert.ok(jungle, 'jungle ladder present');
    assert.deepEqual(
      jungle.leaderboard.map((entry) => entry.handle),
      ['sum-alpha', 'sum-beta'],
      'top-2 visible players in conservative-rating order; private profile excluded',
    );
    assert.equal(jungle.leaderboard[0]!.rank, 1);
    assert.equal(jungle.leaderboard[1]!.rank, 2);

    const flip = summary.find((ladder) => ladder.variant === 'jungle_flip');
    assert.ok(flip, 'jungle_flip ladder present');
    assert.deepEqual(
      flip.leaderboard.map((entry) => entry.handle),
      ['sum-alpha'],
      'ladders group independently per variant',
    );
  });

  test('getBestRatings picks each user best blitz pool', async () => {
    const now = new Date();
    await createUser({
      id: 'best_a',
      email: 'best_a@e.com',
      emailVerifiedAt: now,
      handle: 'best-alpha',
      displayName: 'best-alpha',
      now,
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      // Two pools: jungle (higher elo, provisional RD) must win over fog.
      // A rapid row with an even higher elo must be ignored (wrong time class).
      await client.query(
        `INSERT INTO user_ratings (user_id, variant, time_class, elo_rating, rating_deviation, volatility, games_played)
         VALUES
          ('best_a','fog','blitz',1500,60,0.06,10),
          ('best_a','jungle','blitz',1650,300,0.06,2),
          ('best_a','fog','rapid',1900,60,0.06,10)`,
      );
    } finally {
      await client.end();
    }

    const best = await getBestRatings(['best_a', 'best_missing'], 'blitz');
    assert.equal(best.size, 1, 'unknown ids produce no entries');
    const entry = best.get('best_a');
    assert.ok(entry);
    assert.equal(entry.variant, 'jungle');
    assert.equal(entry.eloRating, 1650);
    assert.equal(entry.provisional, true, 'high RD marks the figure provisional');
  });

  test('getMostActivePlayers counts completed games and hides private profiles', async () => {
    const now = new Date();
    const mk = (id: string, handle: string, visibility: 'public' | 'private') =>
      createUser({
        id,
        email: `${id}@act.com`,
        emailVerifiedAt: now,
        handle,
        displayName: handle,
        profileVisibility: visibility,
        now,
      });
    await mk('act_a', 'act-alpha', 'public');
    await mk('act_b', 'act-beta', 'public');
    await mk('act_p', 'act-private', 'private');

    const endGame = (roomId: string, whiteId: string, blackId: string | null) =>
      recordGameEnd(roomId, {
        variant: 'jungle',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'resignation',
        plyCount: 10,
        startedAt: now,
        endedAt: now,
        whiteClient: 'browser',
        blackClient: 'browser',
        whiteName: null,
        blackName: null,
        corpusId: null,
        participants: [
          {
            color: 'white',
            displayName: 'W',
            subjectType: 'user',
            subjectId: whiteId,
            visibility: 'public',
          },
          blackId
            ? {
                color: 'black',
                displayName: 'B',
                subjectType: 'user',
                subjectId: blackId,
                visibility: 'public',
              }
            : {
                color: 'black',
                displayName: 'Guest',
                subjectType: 'guest',
                subjectId: null,
                visibility: 'public',
              },
        ],
        visibility: 'public',
      });

    // act_a: 2 games; act_b: 1 game; act_p: 1 game but private profile.
    await endGame('act-game-1', 'act_a', 'act_b');
    await endGame('act-game-2', 'act_a', null);
    await endGame('act-game-3', 'act_p', null);

    // Wide limit: this suite shares one database, so other tests' users are
    // also on the board; assert on our fixtures, not absolute positions.
    const active = await getMostActivePlayers(50);
    const handles = active.map((entry) => entry.handle);
    assert.ok(!handles.includes('act-private'), 'private profile excluded');
    const alpha = active.find((entry) => entry.handle === 'act-alpha');
    const beta = active.find((entry) => entry.handle === 'act-beta');
    assert.ok(alpha && beta);
    assert.equal(alpha.gamesPlayed, 2);
    assert.equal(beta.gamesPlayed, 1);
    assert.ok(alpha.rank < beta.rank, 'more games ranks higher');
  });

  test('getUserProfileByHandle lists completed account-attributed games', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    await createUser({
      id: 'user_profile',
      email: 'profile@example.com',
      emailVerifiedAt: now,
      handle: 'profile-player',
      displayName: 'Profile Player',
      profileVisibility: 'public',
      now,
    });
    await recordGameEnd('profile-game', {
      variant: 'dark-chess',
      mode: 'pvp',
      result: 'white-wins',
      termination: 'king-captured',
      plyCount: 9,
      startedAt: now,
      endedAt: new Date(now.getTime() + 60_000),
      whiteClient: 'profile-browser',
      blackClient: 'guest-browser',
      whiteName: null,
      blackName: null,
      corpusId: null,
      participants: [
        {
          color: 'white',
          displayName: 'Profile Player',
          subjectType: 'user',
          subjectId: 'user_profile',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'Guest',
          subjectType: 'guest',
          subjectId: null,
          visibility: 'public',
        },
      ],
    });
    await recordGameEnd('profile-dxq-game', {
      variant: 'dark-xiangqi',
      mode: 'pve',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 12,
      startedAt: now,
      endedAt: new Date(now.getTime() + 120_000),
      whiteClient: null,
      blackClient: null,
      whiteName: null,
      blackName: null,
      corpusId: null,
      rated: false,
      visibility: 'public',
      initialMs: 180_000,
      incrementMs: 2_000,
      participants: [
        {
          color: 'red',
          displayName: 'Profile Player',
          subjectType: 'user',
          subjectId: 'user_profile',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'Misty DXQ 1.2',
          subjectType: 'engine-version',
          subjectId: 'python-fdx-v1.2',
          visibility: 'public',
        },
      ],
    });

    const profile = await getUserProfileByHandle('profile-player', null);
    assert.equal(profile?.user.handle, 'profile-player');
    assert.equal(profile?.games.length, 2);
    assert.equal(profile?.gamesTotal, 2);
    assert.equal(profile?.games[0]?.roomId, 'profile-dxq-game');
    assert.equal(profile?.games[0]?.playerColor, 'red');
    assert.equal(profile?.games[0]?.participants[0]?.subjectType, 'user');
    const dxqRating = profile?.ratings.find((rating) => rating.variant === 'dark_xiangqi');
    assert.equal(dxqRating?.timeClass, 'blitz');
    assert.equal(dxqRating?.eloRating, null);
    assert.equal(dxqRating?.ratedGamesPlayed, 0);
    assert.equal(dxqRating?.totalGamesPlayed, 1);
    const fogRating = profile?.ratings.find((rating) => rating.variant === 'fog');
    assert.equal(fogRating?.timeClass, 'blitz');
    assert.equal(fogRating?.eloRating, null);
    assert.equal(fogRating?.ratedGamesPlayed, 0);
    assert.equal(fogRating?.totalGamesPlayed, 1);
  });

  test('getUserRatingHistory returns visible rated blitz points for one bucket', async () => {
    const now = new Date('2026-05-08T10:30:00.000Z');
    await createUser({
      id: 'user_history_player',
      email: 'history-player@example.com',
      emailVerifiedAt: now,
      handle: 'history-player',
      displayName: 'History Player',
      profileVisibility: 'public',
      now,
    });
    await createUser({
      id: 'user_history_opponent',
      email: 'history-opponent@example.com',
      emailVerifiedAt: now,
      handle: 'history-opponent',
      displayName: 'History Opponent',
      profileVisibility: 'public',
      now,
    });

    for (const [roomId, endedAt, visibility] of [
      ['history-public', new Date(now.getTime() + 60_000), 'public'],
      ['history-private', new Date(now.getTime() + 120_000), 'private'],
    ] as const) {
      await recordGameEnd(roomId, {
        variant: 'dark-chess',
        mode: 'pvp',
        rated: true,
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 30,
        startedAt: now,
        endedAt,
        initialMs: 180_000,
        incrementMs: 2_000,
        whiteClient: 'browser',
        blackClient: 'browser',
        whiteName: 'History Player',
        blackName: 'History Opponent',
        corpusId: null,
        visibility,
        participants: [
          {
            color: 'white',
            displayName: 'History Player',
            subjectType: 'user',
            subjectId: 'user_history_player',
            visibility,
          },
          {
            color: 'black',
            displayName: 'History Opponent',
            subjectType: 'user',
            subjectId: 'user_history_opponent',
            visibility,
          },
        ],
      });
    }

    await recordGameEnd('history-bullet-ignored', {
      variant: 'dark-chess',
      mode: 'pvp',
      rated: true,
      result: 'white-wins',
      termination: 'king-captured',
      plyCount: 18,
      startedAt: now,
      endedAt: new Date(now.getTime() + 180_000),
      initialMs: 60_000,
      incrementMs: 1_000,
      whiteClient: 'browser',
      blackClient: 'browser',
      whiteName: 'History Player',
      blackName: 'History Opponent',
      corpusId: null,
      visibility: 'public',
      participants: [
        {
          color: 'white',
          displayName: 'History Player',
          subjectType: 'user',
          subjectId: 'user_history_player',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'History Opponent',
          subjectType: 'user',
          subjectId: 'user_history_opponent',
          visibility: 'public',
        },
      ],
    });

    const publicHistory = await getUserRatingHistory('history-player', null, 'fog');
    assert.equal(publicHistory?.timeClass, 'blitz');
    assert.equal(publicHistory?.points.length, 1);
    assert.equal(publicHistory?.points[0]?.roomId, 'history-public');
    assert.equal(publicHistory?.points[0]?.ratingBefore, 1500);
    assert.ok((publicHistory?.points[0]?.ratingAfter ?? 0) > 1500);

    const ownerHistory = await getUserRatingHistory('history-player', 'user_history_player', 'fog');
    assert.deepEqual(
      ownerHistory?.points.map((point) => point.roomId),
      ['history-public', 'history-private'],
      'owner sees private history points, but bullet stays outside the public bucket',
    );

    const emptyBucket = await getUserRatingHistory('history-player', null, 'dark_xiangqi');
    assert.deepEqual(emptyBucket?.points, []);
    assert.equal(await getUserRatingHistory('missing-history-player', null, 'fog'), null);
  });

  test('getUserProfileByHandle counts launched variant activity buckets', async () => {
    const now = new Date('2026-05-08T12:00:00.000Z');
    await createUser({
      id: 'user_variant_profile',
      email: 'variant-profile@example.com',
      emailVerifiedAt: now,
      handle: 'variant-profile',
      displayName: 'Variant Profile',
      profileVisibility: 'public',
      now,
    });

    const variants: Array<{
      roomId: string;
      variant: string;
      bucket: RatingVariant;
      firstColor: 'white' | 'black' | 'red';
      secondColor: 'white' | 'black' | 'red';
      result: 'white-wins' | 'black-wins' | 'red-wins' | 'draw';
    }> = [
      {
        roomId: 'profile-dark-xiangqi',
        variant: 'dark-xiangqi',
        bucket: 'dark_xiangqi',
        firstColor: 'red',
        secondColor: 'black',
        result: 'red-wins',
      },
      {
        roomId: 'profile-jieqi',
        variant: 'jieqi',
        bucket: 'jieqi',
        firstColor: 'red',
        secondColor: 'black',
        result: 'black-wins',
      },
      {
        roomId: 'profile-banqi',
        variant: 'banqi',
        bucket: 'banqi',
        firstColor: 'red',
        secondColor: 'black',
        result: 'red-wins',
      },
    ];

    for (let i = 0; i < variants.length; i++) {
      const entry = variants[i]!;
      await recordGameEnd(entry.roomId, {
        variant: entry.variant,
        mode: 'pvp',
        result: entry.result,
        termination: 'resignation',
        plyCount: 12 + i,
        startedAt: now,
        endedAt: new Date(now.getTime() + (i + 1) * 60_000),
        whiteClient: null,
        blackClient: null,
        whiteName: null,
        blackName: null,
        corpusId: null,
        rated: false,
        visibility: 'public',
        initialMs: 180_000,
        incrementMs: 2_000,
        participants: [
          {
            color: entry.firstColor,
            displayName: 'Variant Profile',
            subjectType: 'user',
            subjectId: 'user_variant_profile',
            visibility: 'public',
          },
          {
            color: entry.secondColor,
            displayName: 'Guest',
            subjectType: 'guest',
            subjectId: null,
            visibility: 'public',
          },
        ],
      });
    }

    const profile = await getUserProfileByHandle('variant-profile', null);
    assert.equal(profile?.gamesTotal, variants.length);
    const profileRatings: readonly ProfileBucketRating[] = profile?.ratings ?? [];
    for (const entry of variants) {
      const rating = profileRatings.find((candidate) => candidate.variant === entry.bucket);
      assert.equal(rating?.timeClass, 'blitz', entry.variant);
      assert.equal(rating?.eloRating, null, entry.variant);
      assert.equal(rating?.ratedGamesPlayed, 0, entry.variant);
      assert.equal(rating?.totalGamesPlayed, 1, entry.variant);
    }
  });

  test('getUserGamesPage scopes history to a rating pool, legacy variant strings included', async () => {
    const now = new Date('2026-05-10T10:00:00.000Z');
    await createUser({
      id: 'user_pool',
      email: 'pool@example.com',
      emailVerifiedAt: now,
      handle: 'pool-player',
      displayName: 'Pool Player',
      profileVisibility: 'public',
      now,
    });
    const play = async (roomId: string, variant: string, minutes: number) => {
      await recordGameEnd(roomId, {
        variant,
        mode: 'pvp',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 9,
        startedAt: now,
        endedAt: new Date(now.getTime() + minutes * 60_000),
        whiteClient: 'pool-browser',
        blackClient: 'guest-browser',
        whiteName: null,
        blackName: null,
        corpusId: null,
        participants: [
          {
            color: 'white',
            displayName: 'Pool Player',
            subjectType: 'user',
            subjectId: 'user_pool',
            visibility: 'public',
          },
          {
            color: 'black',
            displayName: 'Guest',
            subjectType: 'guest',
            subjectId: null,
            visibility: 'public',
          },
        ],
      });
    };

    await play('pool-xq-1', 'xiangqi', 1);
    await play('pool-jq-1', 'jieqi', 2);
    await play('pool-xq-2', 'xiangqi', 3);
    // Pre-rename string for the fog pool. A filter built from the spec id
    // alone would drop this row while the rating rail still counted it.
    await play('pool-legacy-1', 'fog', 4);

    const all = await getUserGamesPage('pool-player', null, 0, 20);
    assert.equal(all?.total, 4);

    const xiangqi = await getUserGamesPage('pool-player', null, 0, 20, 'xiangqi');
    assert.equal(xiangqi?.total, 2);
    assert.deepEqual(
      xiangqi?.games.map((game) => game.roomId),
      ['pool-xq-2', 'pool-xq-1'],
    );

    const jieqi = await getUserGamesPage('pool-player', null, 0, 20, 'jieqi');
    assert.equal(jieqi?.total, 1);
    assert.equal(jieqi?.games[0]?.roomId, 'pool-jq-1');

    // The legacy row answers to its pool, not to its literal variant string.
    const fog = await getUserGamesPage('pool-player', null, 0, 20, 'fog');
    assert.equal(fog?.total, 1);
    assert.equal(fog?.games[0]?.roomId, 'pool-legacy-1');

    // total is the FILTERED total, so "Load more" stops at the right place.
    const firstPage = await getUserGamesPage('pool-player', null, 0, 1, 'xiangqi');
    assert.equal(firstPage?.total, 2);
    assert.equal(firstPage?.games.length, 1);
    assert.equal(firstPage?.games[0]?.roomId, 'pool-xq-2');

    // A pool the player has never touched is empty, not unfiltered.
    const banqi = await getUserGamesPage('pool-player', null, 0, 20, 'banqi');
    assert.equal(banqi?.total, 0);
    assert.deepEqual(banqi?.games, []);
  });

  test('getUserGamesPage paginates a user games newest-first with a stable total', async () => {
    const now = new Date('2026-05-09T10:00:00.000Z');
    await createUser({
      id: 'user_pager',
      email: 'pager@example.com',
      emailVerifiedAt: now,
      handle: 'pager-player',
      displayName: 'Pager Player',
      profileVisibility: 'public',
      now,
    });
    for (let i = 0; i < 3; i++) {
      await recordGameEnd(`pager-game-${i}`, {
        variant: 'dark-chess',
        mode: 'pvp',
        result: 'white-wins',
        termination: 'king-captured',
        plyCount: 9,
        startedAt: now,
        endedAt: new Date(now.getTime() + (i + 1) * 60_000),
        whiteClient: 'pager-browser',
        blackClient: 'guest-browser',
        whiteName: null,
        blackName: null,
        corpusId: null,
        participants: [
          {
            color: 'white',
            displayName: 'Pager Player',
            subjectType: 'user',
            subjectId: 'user_pager',
            visibility: 'public',
          },
          {
            color: 'black',
            displayName: 'Guest',
            subjectType: 'guest',
            subjectId: null,
            visibility: 'public',
          },
        ],
      });
    }

    // total reflects all matches regardless of the page window; rows are
    // newest-first (pager-game-2 has the latest endedAt).
    const page1 = await getUserGamesPage('pager-player', null, 0, 2);
    assert.equal(page1?.total, 3);
    assert.equal(page1?.games.length, 2);
    assert.equal(page1?.games[0]?.roomId, 'pager-game-2');
    assert.equal(page1?.games[1]?.roomId, 'pager-game-1');

    const page2 = await getUserGamesPage('pager-player', null, 2, 2);
    assert.equal(page2?.total, 3);
    assert.equal(page2?.games.length, 1);
    assert.equal(page2?.games[0]?.roomId, 'pager-game-0');

    assert.equal(await getUserGamesPage('no-such-handle', null, 0, 2), null);
  });
});
