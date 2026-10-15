// The /correspondence "Recently finished" list's query: the player's own
// finished correspondence games (time control on the room-created event), in
// the window, newest first, private seats included; and its seen watermark.
// Also the bell's "your game ended" rows read through the real end handler.

import {
  createUser,
  listRecentFinishedCorrespondenceGames,
  markNotificationsSeen,
  notificationsSeenAt,
  recordGameEnd,
} from './persistence.js';
import type { GameSummary } from './persistence-games.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { unseenFinishedCorrespondenceGames } from './routes/correspondence-games.js';

const NOW = new Date('2026-10-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, params);
  } finally {
    await client.end();
  }
}

async function seedGame(
  roomId: string,
  endedAt: string,
  options: { correspondence: boolean; aliceSeatVisibility?: string; status?: string },
): Promise<void> {
  await sql(
    `INSERT INTO games (room_id, variant, result, termination, ply_count, started_at, ended_at,
       mode, status, visibility, initial_ms, increment_ms)
     VALUES ($1, 'xiangqi', 'black-wins', 'timeout', 30, $2::timestamptz - interval '5 days', $2,
       'pvp', $3, 'public', $4, 0)`,
    [roomId, endedAt, options.status ?? 'completed', options.correspondence ? DAY : 180_000],
  );
  for (const [color, subjectId, visibility] of [
    ['red', 'u_alice', options.aliceSeatVisibility ?? 'public'],
    ['black', 'u_bob', 'public'],
  ]) {
    await sql(
      `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name, visibility)
       VALUES ($1, $2, 'user', $3, $3, $4)`,
      [roomId, color, subjectId, visibility],
    );
  }
  const timeControl = options.correspondence
    ? { initialMs: DAY, incrementMs: 0, daysPerMove: 1 }
    : { initialMs: 180_000, incrementMs: 2_000 };
  await sql(`INSERT INTO events (room_id, seq, type, payload) VALUES ($1, 0, 'room-created', $2)`, [
    roomId,
    { type: 'room-created', roomId, variant: 'xiangqi', timeControl },
  ]);
}

definePersistenceTests('correspondence recently finished', () => {
  test('lists only finished correspondence games after the cutoff, newest first', async () => {
    for (const [id, handle] of [
      ['u_alice', 'alice'],
      ['u_bob', 'bob'],
    ]) {
      await createUser({
        id,
        email: `${handle}@example.com`,
        emailVerifiedAt: NOW,
        handle,
        displayName: handle,
        now: NOW,
      });
    }
    await seedGame('corr_newest', '2026-09-30T10:00:00Z', { correspondence: true });
    await seedGame('corr_private', '2026-09-29T10:00:00Z', {
      correspondence: true,
      aliceSeatVisibility: 'private',
    });
    await seedGame('live_blitz', '2026-09-30T11:00:00Z', { correspondence: false });
    await seedGame('corr_too_old', '2026-09-10T10:00:00Z', { correspondence: true });

    const since = new Date(NOW.getTime() - 14 * DAY);
    const games = await listRecentFinishedCorrespondenceGames('u_alice', { since, limit: 10 });
    assert.deepEqual(
      games.map((game) => game.roomId),
      ['corr_newest', 'corr_private'],
    );
    assert.equal(games[0]?.playerColor, 'red');
    assert.equal(games[0]?.participants.length, 2, 'participants attached for the opponent name');

    const capped = await listRecentFinishedCorrespondenceGames('u_alice', { since, limit: 1 });
    assert.deepEqual(
      capped.map((game) => game.roomId),
      ['corr_newest'],
    );
  });

  test('the correspondence-finished watermark reads back what was marked', async () => {
    await createUser({
      id: 'u_wm',
      email: 'wm@example.com',
      emailVerifiedAt: NOW,
      handle: 'wm',
      displayName: 'wm',
      now: NOW,
    });
    const at = new Date('2026-10-02T03:04:05Z');
    await markNotificationsSeen('u_wm', 'correspondence-finished', at);
    assert.equal(
      (await notificationsSeenAt('u_wm', 'correspondence-finished'))?.toISOString(),
      at.toISOString(),
    );
    assert.equal(await notificationsSeenAt('u_nobody', 'correspondence-finished'), null);
  });

  test('the bell tells the other seat once, across a re-run of the end handler', async () => {
    for (const [id, handle] of [
      ['u_red', 'redplayer'],
      ['u_black', 'blackplayer'],
    ]) {
      await createUser({
        id,
        email: `${handle}@example.com`,
        emailVerifiedAt: NOW,
        handle,
        displayName: handle,
        now: NOW,
      });
      await markNotificationsSeen(id, 'correspondence-finished', new Date('2026-09-29T00:00:00Z'));
    }
    await sql(
      `INSERT INTO events (room_id, seq, type, payload) VALUES ($1, 0, 'room-created', $2)`,
      [
        'corr_resigned',
        {
          type: 'room-created',
          roomId: 'corr_resigned',
          variant: 'xiangqi',
          timeControl: { initialMs: DAY, incrementMs: 0, daysPerMove: 1 },
        },
      ],
    );
    // Black resigns. endedAt comes from the event log, so a retry writes the same row.
    const summary: GameSummary = {
      variant: 'xiangqi',
      mode: 'pvp',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 24,
      startedAt: new Date('2026-09-25T00:00:00Z'),
      endedAt: new Date('2026-09-30T10:00:00Z'),
      whiteClient: null,
      blackClient: null,
      whiteName: null,
      blackName: null,
      corpusId: null,
      initialMs: DAY,
      incrementMs: 0,
      participants: [
        {
          color: 'red',
          subjectType: 'user',
          subjectId: 'u_red',
          displayName: 'redplayer',
          visibility: 'public',
        },
        {
          color: 'black',
          subjectType: 'user',
          subjectId: 'u_black',
          displayName: 'blackplayer',
          visibility: 'public',
        },
      ],
    };
    await recordGameEnd('corr_resigned', summary);
    await recordGameEnd('corr_resigned', summary);

    const red = await unseenFinishedCorrespondenceGames('u_red', { limit: 3 }, undefined, NOW);
    assert.equal(red.total, 1, 'one notice, not one per end-handler run');
    assert.equal(red.games[0]?.roomId, 'corr_resigned');
    assert.equal(red.games[0]?.outcome, 'won');
    assert.equal(red.games[0]?.termination, 'resignation');
    assert.deepEqual(red.games[0]?.opponent, { handle: 'blackplayer', displayName: 'blackplayer' });
    const black = await unseenFinishedCorrespondenceGames('u_black', { limit: 3 }, undefined, NOW);
    assert.equal(black.total, 0, 'the player who resigned is not told');

    // Opening the bell (or /correspondence) clears it, and a later re-run of
    // the end handler does not bring it back.
    await markNotificationsSeen('u_red', 'correspondence-finished', NOW);
    await recordGameEnd('corr_resigned', summary);
    const after = await unseenFinishedCorrespondenceGames('u_red', { limit: 3 }, undefined, NOW);
    assert.equal(after.total, 0);
  });
});
