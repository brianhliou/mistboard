import './xiangqi-registration.js';
import './jieqi-registration.js';
import './jungle-registration.js';
import { listLobbyActivity } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('lobby activity', () => {
  test('listLobbyActivity gives a seat one row per UTC day, however its wins interleave', async () => {
    const now = new Date('2026-10-03T12:00:00.000Z');
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      // [room, guest device, bot id, bot name, minutesAgo]. Today device-a
      // beats AB-JChess three times around device-b's win and a lower-rung
      // win; yesterday (13+ hours ago) it beat AB-JChess once and Pikafish once.
      const wins: [string, string, string, string, number][] = [
        ['day-a1', 'device-a', 'ab-jchess', 'AB-JChess', 10],
        ['day-b1', 'device-b', 'ab-jchess', 'AB-JChess', 20],
        ['day-a2', 'device-a', 'ab-jchess', 'AB-JChess', 30],
        ['day-a-low', 'device-a', 'pikafish-level-7', 'Pikafish Level 7', 40],
        ['day-a3', 'device-a', 'ab-jchess', 'AB-JChess', 50],
        ['day-a4', 'device-a', 'ab-jchess', 'AB-JChess', 13 * 60],
        ['day-a5', 'device-a', 'pikafish', 'Pikafish', 14 * 60],
      ];
      for (const [room, device, botId, botName, ago] of wins) {
        await client.query(
          `INSERT INTO games
             (room_id, variant, result, termination, ply_count, started_at, ended_at,
              white_client, black_client, mode, status, visibility)
           VALUES ($1, 'jieqi', 'red-wins', 'checkmate', 60, $2, $2, 'red', 'black', 'pve',
                   'completed', 'public')`,
          [room, minutesAgo(ago)],
        );
        await client.query(
          `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name)
           VALUES ($1, 'red', 'guest', $2, 'Guest'), ($1, 'black', 'bot', $3, $4)`,
          [room, device, botId, botName],
        );
      }
    } finally {
      await client.end();
    }

    const events = await listLobbyActivity(now);

    assert.deepEqual(
      events.map((e) => [e.id, e.opponent ?? null, e.count ?? 1]),
      [
        ['act_game_day-a1', 'AB-JChess', 3],
        ['act_game_day-b1', 'AB-JChess', 1],
        // Two bots in one day: the row names neither.
        ['act_game_day-a4', null, 2],
      ],
    );
    // Device ids stay on the server.
    assert.ok(!JSON.stringify(events).includes('device-'));
  });

  test('listLobbyActivity shows wins over the top of a ladder and new public studies, nothing else', async () => {
    const now = new Date('2026-10-03T12:00:00.000Z');
    const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO users (id, email, handle, display_name, profile_visibility, stats_excluded_at)
         VALUES ('act-fox', 'fox@example.com', 'fox', 'Fox', 'public', NULL),
                ('act-kaoru', 'kaoru@example.com', 'kaoru', 'Kaoru', 'public', NULL),
                ('act-shy', 'shy@example.com', 'shy', 'Shy', 'private', NULL),
                ('act-op', 'op@example.com', 'op', 'Op', 'public', now())`,
      );
      // [room, variant, result, mode, visibility, plies, endedAt]
      const games: [string, string, string, string, string, number, Date][] = [
        ['act-guest-beats-bot', 'xiangqi', 'red-wins', 'pve', 'link', 40, hoursAgo(1)],
        ['act-fox-beats-bot', 'jieqi', 'red-wins', 'pve', 'public', 50, hoursAgo(2)],
        ['act-bot-beats-fox', 'jieqi', 'black-wins', 'pve', 'public', 50, hoursAgo(3)],
        ['act-rated', 'jieqi', 'red-wins', 'pvp', 'public', 60, hoursAgo(4)],
        ['act-casual', 'xiangqi', 'red-wins', 'pvp', 'public', 60, hoursAgo(5)],
        ['act-private-profile', 'xiangqi', 'red-wins', 'pve', 'public', 40, hoursAgo(6)],
        ['act-excluded', 'xiangqi', 'red-wins', 'pve', 'public', 40, hoursAgo(7)],
        ['act-draw', 'xiangqi', 'draw', 'pve', 'public', 40, hoursAgo(8)],
        ['act-private-game', 'xiangqi', 'red-wins', 'pve', 'private', 40, hoursAgo(9)],
        ['act-short', 'xiangqi', 'red-wins', 'pve', 'public', 1, hoursAgo(10)],
        ['act-old', 'xiangqi', 'red-wins', 'pve', 'public', 40, hoursAgo(8 * 24)],
        ['act-low-level', 'xiangqi', 'red-wins', 'pve', 'public', 40, hoursAgo(11)],
        ['act-low-level-id', 'jieqi', 'red-wins', 'pve', 'public', 40, hoursAgo(12)],
        ['act-level-7', 'xiangqi', 'red-wins', 'pve', 'public', 40, hoursAgo(11.5)],
        ['act-pikafish-7', 'jieqi', 'red-wins', 'pve', 'public', 40, hoursAgo(11.6)],
        ['act-misty', 'jungle', 'red-wins', 'pve', 'public', 40, hoursAgo(13)],
      ];
      for (const [room, variant, result, mode, visibility, plies, endedAt] of games) {
        await client.query(
          `INSERT INTO games
             (room_id, variant, result, termination, ply_count, started_at, ended_at,
              white_client, black_client, mode, status, visibility)
           VALUES ($1, $2, $3, 'resignation', $4, $5, $5, 'red', 'black', $6, 'completed', $7)`,
          [room, variant, result, plies, endedAt, mode, visibility],
        );
      }
      // [room, color, subjectType, subjectId, displayName, eloAfter]
      const seats: [string, string, string, string | null, string, number | null][] = [
        ['act-guest-beats-bot', 'red', 'guest', 'device-1', 'Guest', null],
        [
          'act-guest-beats-bot',
          'black',
          'bot',
          'fairy-stockfish-level-8',
          'Fairy-Stockfish Level 8',
          null,
        ],
        ['act-fox-beats-bot', 'red', 'user', 'act-fox', 'Fox', null],
        ['act-fox-beats-bot', 'black', 'bot', 'ab-jchess', 'AB-JChess', null],
        ['act-bot-beats-fox', 'red', 'user', 'act-fox', 'Fox', null],
        ['act-bot-beats-fox', 'black', 'bot', 'pikafish-level-6', 'Pikafish Level 6', null],
        ['act-rated', 'red', 'user', 'act-kaoru', 'Kaoru', 1540],
        ['act-rated', 'black', 'user', 'act-fox', 'Fox', 1460],
        ['act-casual', 'red', 'user', 'act-kaoru', 'Kaoru', null],
        ['act-casual', 'black', 'user', 'act-fox', 'Fox', null],
        ['act-private-profile', 'red', 'user', 'act-shy', 'Shy', null],
        ['act-private-profile', 'black', 'bot', 'misty', 'Misty', null],
        ['act-excluded', 'red', 'user', 'act-op', 'Op', null],
        ['act-excluded', 'black', 'bot', 'misty', 'Misty', null],
        ['act-draw', 'red', 'user', 'act-fox', 'Fox', null],
        ['act-draw', 'black', 'bot', 'misty', 'Misty', null],
        ['act-private-game', 'red', 'user', 'act-fox', 'Fox', null],
        ['act-private-game', 'black', 'bot', 'misty', 'Misty', null],
        ['act-short', 'red', 'user', 'act-fox', 'Fox', null],
        ['act-short', 'black', 'bot', 'misty', 'Misty', null],
        ['act-old', 'red', 'user', 'act-fox', 'Fox', null],
        ['act-old', 'black', 'bot', 'misty', 'Misty', null],
        ['act-low-level', 'red', 'guest', 'device-2', 'Guest', null],
        [
          'act-low-level',
          'black',
          'bot',
          'fairy-stockfish-level-3',
          'Fairy-Stockfish Level 3',
          null,
        ],
        ['act-low-level-id', 'red', 'guest', 'device-3', 'Guest', null],
        ['act-low-level-id', 'black', 'bot', 'pikafish-level-2', 'Pikafish', null],
        // One rung below the top of each numbered ladder.
        ['act-level-7', 'red', 'guest', 'device-4', 'Guest', null],
        ['act-level-7', 'black', 'bot', 'fairy-stockfish-level-7', 'Fairy-Stockfish Level 7', null],
        ['act-pikafish-7', 'red', 'guest', 'device-5', 'Guest', null],
        ['act-pikafish-7', 'black', 'bot', 'pikafish-level-7', 'Pikafish Level 7', null],
        ['act-misty', 'red', 'user', 'act-fox', 'Fox', null],
        ['act-misty', 'black', 'bot', 'misty', 'Misty', null],
      ];
      for (const [room, color, subjectType, subjectId, displayName, eloAfter] of seats) {
        await client.query(
          `INSERT INTO game_participants
             (game_id, color, subject_type, subject_id, display_name, elo_after)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [room, color, subjectType, subjectId, displayName, eloAfter],
        );
      }
      await client.query(
        `INSERT INTO studies (id, owner_id, name, visibility, created_at)
         VALUES ('act-study-new', 'act-kaoru', 'Opening traps', 'public', $1),
                ('act-study-private', 'act-kaoru', 'Notes', 'private', $1),
                ('act-study-old', 'act-kaoru', 'Old study', 'public', $2)`,
        [hoursAgo(30), hoursAgo(8 * 24)],
      );
    } finally {
      await client.end();
    }

    const events = await listLobbyActivity(now);

    assert.deepEqual(events, [
      {
        id: 'act_game_act-guest-beats-bot',
        kind: 'bot-win',
        createdAt: hoursAgo(1).toISOString(),
        href: '/xiangqi/game/act-guest-beats-bot',
        gameSpecId: 'xiangqi',
        handle: null,
        opponent: 'Fairy-Stockfish Level 8',
      },
      {
        id: 'act_game_act-fox-beats-bot',
        kind: 'bot-win',
        createdAt: hoursAgo(2).toISOString(),
        href: '/jieqi/game/act-fox-beats-bot',
        gameSpecId: 'jieqi',
        handle: 'fox',
        opponent: 'AB-JChess',
      },
      {
        id: 'act_game_act-misty',
        kind: 'bot-win',
        createdAt: hoursAgo(13).toISOString(),
        href: '/jungle/game/act-misty',
        gameSpecId: 'jungle',
        handle: 'fox',
        opponent: 'Misty',
      },
      {
        id: 'act_study_act-study-new',
        kind: 'study',
        createdAt: hoursAgo(30).toISOString(),
        href: '/study/act-study-new',
        handle: 'kaoru',
        title: 'Opening traps',
      },
    ]);
  });
});
