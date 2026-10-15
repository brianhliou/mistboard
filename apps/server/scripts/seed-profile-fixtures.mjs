#!/usr/bin/env node

import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required. Run via `npm run db:seed:profiles`.');
  process.exit(1);
}

assertLocalDatabase(databaseUrl);

const pool = new Pool({ connectionString: databaseUrl });

const fixtureUserIds = [
  'seed-profile-rich',
  'seed-profile-empty',
  'seed-profile-long-names',
  'seed-profile-rival',
];

const fixtureHandles = ['seed-rich', 'seed-empty', 'seed-long-names', 'seed-rival'];

const games = [
  {
    roomId: 'seed-profile-rich-001',
    userId: 'seed-profile-rich',
    userColor: 'white',
    opponentName: 'Mistboard Engine v0.9.5',
    opponentSubjectType: 'engine-version',
    opponentSubjectId: 'python-tier1-v0.9.5',
    result: 'white-wins',
    termination: 'resignation',
    plyCount: 43,
    mode: 'pve',
    initialMs: 300_000,
    incrementMs: 5_000,
    rated: false,
    endedAt: '2026-05-20T22:11:00.000Z',
  },
  {
    roomId: 'seed-profile-rich-002',
    userId: 'seed-profile-rich',
    userColor: 'white',
    opponentName: 'Capture Seeker v1',
    opponentSubjectType: 'engine-version',
    opponentSubjectId: 'builtin-capture-seeker',
    result: 'white-wins',
    termination: 'resignation',
    plyCount: 35,
    mode: 'pve',
    initialMs: 180_000,
    incrementMs: 2_000,
    rated: false,
    endedAt: '2026-05-20T21:39:00.000Z',
  },
  {
    roomId: 'seed-profile-rich-003',
    userId: 'seed-profile-rich',
    userColor: 'white',
    opponentName: 'Capture Seeker v1',
    opponentSubjectType: 'engine-version',
    opponentSubjectId: 'builtin-capture-seeker',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: 28,
    mode: 'pve',
    initialMs: 60_000,
    incrementMs: 1_000,
    rated: false,
    endedAt: '2026-05-20T20:21:00.000Z',
  },
  {
    roomId: 'seed-profile-rich-004',
    userId: 'seed-profile-rich',
    userColor: 'white',
    opponentUserId: 'seed-profile-rival',
    opponentName: 'Seed Rival',
    opponentSubjectType: 'user',
    opponentSubjectId: 'seed-profile-rival',
    result: 'white-wins',
    termination: 'resignation',
    plyCount: 51,
    mode: 'pvp',
    initialMs: 180_000,
    incrementMs: 2_000,
    rated: true,
    endedAt: '2026-05-19T18:04:00.000Z',
    userRatingBefore: 1532,
    userRatingAfter: 1560,
    opponentRatingBefore: 1500,
    opponentRatingAfter: 1472,
  },
  {
    roomId: 'seed-profile-rich-005',
    userId: 'seed-profile-rich',
    userColor: 'black',
    opponentUserId: 'seed-profile-rival',
    opponentName: 'Seed Rival',
    opponentSubjectType: 'user',
    opponentSubjectId: 'seed-profile-rival',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: 64,
    mode: 'pvp',
    initialMs: 300_000,
    incrementMs: 5_000,
    rated: true,
    endedAt: '2026-05-18T17:30:00.000Z',
    userRatingBefore: 1490,
    userRatingAfter: 1515,
    opponentRatingBefore: 1472,
    opponentRatingAfter: 1447,
  },
  {
    roomId: 'seed-profile-rich-006',
    userId: 'seed-profile-rich',
    userColor: 'white',
    opponentName: 'Random Legal v1',
    opponentSubjectType: 'engine-version',
    opponentSubjectId: 'builtin-random-legal',
    result: 'white-wins',
    termination: 'resignation',
    plyCount: 21,
    mode: 'pve',
    initialMs: 60_000,
    incrementMs: 1_000,
    rated: false,
    endedAt: '2026-05-17T16:12:00.000Z',
  },
  {
    roomId: 'seed-profile-long-names-001',
    userId: 'seed-profile-long-names',
    userColor: 'white',
    opponentName: 'Long-Named Experimental Fog Engine With Calibration Notes v2026.05.29',
    opponentSubjectType: 'engine-version',
    opponentSubjectId: 'seed-long-engine-v2026-05-29',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: 72,
    mode: 'pve',
    initialMs: 180_000,
    incrementMs: 2_000,
    rated: false,
    endedAt: '2026-05-21T19:45:00.000Z',
  },
];

const users = [
  {
    id: 'seed-profile-rich',
    email: 'seed-rich@example.local',
    handle: 'seed-rich',
    displayName: 'Seed Rich',
    profileVisibility: 'public',
    accountRole: 'player',
    createdAt: '2026-05-01T12:00:00.000Z',
  },
  {
    id: 'seed-profile-empty',
    email: 'seed-empty@example.local',
    handle: 'seed-empty',
    displayName: 'Seed Empty',
    profileVisibility: 'public',
    accountRole: 'player',
    createdAt: '2026-05-02T12:00:00.000Z',
  },
  {
    id: 'seed-profile-long-names',
    email: 'seed-long-names@example.local',
    handle: 'seed-long-names',
    displayName: 'Seed Long Names',
    profileVisibility: 'public',
    accountRole: 'player',
    createdAt: '2026-05-03T12:00:00.000Z',
  },
  {
    id: 'seed-profile-rival',
    email: 'seed-rival@example.local',
    handle: 'seed-rival',
    displayName: 'Seed Rival',
    profileVisibility: 'public',
    accountRole: 'player',
    createdAt: '2026-05-04T12:00:00.000Z',
  },
];

const ratings = [
  {
    userId: 'seed-profile-rich',
    variant: 'fog',
    timeClass: 'bullet',
    eloRating: 1492,
    gamesPlayed: 1,
    ratingDeviation: 230,
    volatility: 0.06,
    lastRatedAt: '2026-05-17T16:12:00.000Z',
  },
  {
    userId: 'seed-profile-rich',
    variant: 'fog',
    timeClass: 'blitz',
    eloRating: 1560,
    gamesPlayed: 2,
    ratingDeviation: 82,
    volatility: 0.06,
    lastRatedAt: '2026-05-19T18:04:00.000Z',
  },
  {
    userId: 'seed-profile-rich',
    variant: 'fog',
    timeClass: 'rapid',
    eloRating: 1515,
    gamesPlayed: 1,
    ratingDeviation: 318,
    volatility: 0.06,
    lastRatedAt: '2026-05-20T22:11:00.000Z',
  },
  {
    userId: 'seed-profile-rival',
    variant: 'fog',
    timeClass: 'blitz',
    eloRating: 1447,
    gamesPlayed: 2,
    ratingDeviation: 260,
    volatility: 0.06,
    lastRatedAt: '2026-05-19T18:04:00.000Z',
  },
];

try {
  await seed();
} finally {
  await pool.end();
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertRequiredSchema(client);
    await deleteExistingFixtures(client);
    await insertUsers(client);
    await insertGames(client);
    await insertRatings(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('Seeded local profile fixtures:');
  for (const handle of ['seed-rich', 'seed-empty', 'seed-long-names']) {
    console.log(`  /@/${handle}`);
  }
}

async function assertRequiredSchema(client) {
  const { rows } = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1)`,
    [['users', 'games', 'game_participants', 'user_ratings', 'events']],
  );
  const found = new Set(rows.map((row) => row.table_name));
  const missing = ['users', 'games', 'game_participants', 'user_ratings', 'events'].filter(
    (table) => !found.has(table),
  );
  if (missing.length > 0) {
    throw new Error(`Missing tables: ${missing.join(', ')}. Run npm run db:migrate first.`);
  }
}

async function deleteExistingFixtures(client) {
  const roomIds = games.map((game) => game.roomId);
  await client.query('DELETE FROM events WHERE room_id = ANY($1)', [roomIds]);
  await client.query('DELETE FROM games WHERE room_id = ANY($1)', [roomIds]);
  await client.query('DELETE FROM user_handle_reservations WHERE lower(handle) = ANY($1)', [
    fixtureHandles,
  ]);
  await client.query('DELETE FROM users WHERE id = ANY($1)', [fixtureUserIds]);
}

async function insertUsers(client) {
  for (const user of users) {
    await client.query(
      `INSERT INTO users
         (id, email, email_verified_at, handle, display_name, profile_visibility,
          account_role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        user.id,
        user.email,
        user.createdAt,
        user.handle,
        user.displayName,
        user.profileVisibility,
        user.accountRole,
        user.createdAt,
      ],
    );
  }
}

async function insertGames(client) {
  for (const game of games) {
    const startedAt = new Date(new Date(game.endedAt).getTime() - 12 * 60_000).toISOString();
    const whiteName =
      game.userColor === 'white' ? displayNameForUser(game.userId) : game.opponentName;
    const blackName =
      game.userColor === 'black' ? displayNameForUser(game.userId) : game.opponentName;
    const whiteClient = game.userColor === 'white' ? `user:${game.userId}` : clientLabel(game);
    const blackClient = game.userColor === 'black' ? `user:${game.userId}` : clientLabel(game);

    await client.query(
      `INSERT INTO games
         (room_id, variant, result, termination, ply_count, started_at, ended_at,
          white_client, black_client, white_name, black_name, corpus_id, mode, status,
          review_status, visibility, published_at, rated, initial_ms, increment_ms,
          region)
       VALUES
         ($1, 'dark-chess', $2, $3, $4, $5, $6,
          $7, $8, $9, $10, NULL, $11, 'completed',
          'reviewed', 'public', $6, $12, $13, $14,
          'local-fixture')`,
      [
        game.roomId,
        game.result,
        game.termination,
        game.plyCount,
        startedAt,
        game.endedAt,
        whiteClient,
        blackClient,
        whiteName,
        blackName,
        game.mode,
        game.rated,
        game.initialMs,
        game.incrementMs,
      ],
    );

    await insertParticipants(client, game);
    await insertReplayEvents(client, game, startedAt);
  }
}

async function insertParticipants(client, game) {
  const userParticipant = {
    color: game.userColor,
    subjectType: 'user',
    subjectId: game.userId,
    displayName: displayNameForUser(game.userId),
    ratingBefore: game.userRatingBefore ?? null,
    ratingAfter: game.userRatingAfter ?? null,
  };
  const opponentColor = game.userColor === 'white' ? 'black' : 'white';
  const opponentParticipant = {
    color: opponentColor,
    subjectType: game.opponentSubjectType,
    subjectId: game.opponentSubjectId ?? game.opponentUserId ?? null,
    displayName: game.opponentName,
    ratingBefore: game.opponentRatingBefore ?? null,
    ratingAfter: game.opponentRatingAfter ?? null,
  };

  const participants =
    game.userColor === 'white'
      ? [userParticipant, opponentParticipant]
      : [opponentParticipant, userParticipant];

  for (const participant of participants) {
    await client.query(
      `INSERT INTO game_participants
         (game_id, color, subject_type, subject_id, display_name, visibility,
          elo_before, elo_after, rd_before, rd_after)
       VALUES ($1, $2, $3, $4, $5, 'public', $6, $7, NULL, NULL)`,
      [
        game.roomId,
        participant.color,
        participant.subjectType,
        participant.subjectId,
        participant.displayName,
        participant.ratingBefore,
        participant.ratingAfter,
      ],
    );
  }
}

async function insertReplayEvents(client, game, startedAt) {
  const startedMs = new Date(startedAt).getTime();
  const endedMs = new Date(game.endedAt).getTime();
  const losingColor = game.result === 'white-wins' ? 'black' : 'white';
  const events = [
    {
      type: 'room-created',
      at: startedMs,
      roomId: game.roomId,
      variant: 'dark-chess',
      gameSpecId: 'dark-chess',
      offer: [],
      offers: {},
      timeControl: { initialMs: game.initialMs, incrementMs: game.incrementMs },
      region: 'local-fixture',
      rated: game.rated,
    },
    {
      type: 'seat-assigned',
      at: startedMs + 100,
      roomId: game.roomId,
      clientId: game.userColor === 'white' ? `user:${game.userId}` : clientLabel(game),
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: startedMs + 200,
      roomId: game.roomId,
      clientId: game.userColor === 'black' ? `user:${game.userId}` : clientLabel(game),
      seat: 'black',
    },
    {
      type: 'seat-resigned',
      at: endedMs,
      roomId: game.roomId,
      color: losingColor,
    },
  ];

  for (let index = 0; index < events.length; index++) {
    await client.query(
      `INSERT INTO events (room_id, seq, type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [game.roomId, index + 1, events[index].type, events[index], new Date(events[index].at)],
    );
  }
}

async function insertRatings(client) {
  for (const rating of ratings) {
    await client.query(
      `INSERT INTO user_ratings
         (user_id, variant, time_class, elo_rating, games_played,
          rating_deviation, volatility, last_rated_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        rating.userId,
        rating.variant,
        rating.timeClass,
        rating.eloRating,
        rating.gamesPlayed,
        rating.ratingDeviation,
        rating.volatility,
        rating.lastRatedAt,
      ],
    );
  }
}

function displayNameForUser(userId) {
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error(`Unknown fixture user ${userId}`);
  return user.displayName;
}

function clientLabel(game) {
  if (game.opponentSubjectType === 'user') return `user:${game.opponentSubjectId}`;
  return game.opponentSubjectId ?? `fixture:${game.roomId}`;
}

function assertLocalDatabase(value) {
  if (process.env.MISTBOARD_ALLOW_NONLOCAL_SEED === 'true') return;
  const parsed = new URL(value);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      'Refusing to seed a non-local database. Set MISTBOARD_ALLOW_NONLOCAL_SEED=true to override.',
    );
  }
}
