import type { GameEvent } from '@mistboard/game';
import {
  countWatchSealedGames,
  getGameSummary,
  listCompletedGames,
  listCorpusGames,
  listRecentEveGames,
  listRecentPublicGames,
  listWatchUnlockedGames,
  recordGameEnd,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('game lists', () => {
  test('listRecentEveGames returns completed EvE games newest first', async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 60_000);
    const shortTimeout = new Date(now.getTime() + 60_000);
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO engines (id, name, visibility, status)
         VALUES
           ('engine-white', 'White Engine', 'admin', 'active'),
           ('engine-black', 'Black Engine', 'admin', 'active')`,
      );
      await client.query(
        `INSERT INTO engine_versions (id, name, config_hash, play_signature, engine_id)
         VALUES
           ('engine-white-v1', 'White Engine', 'white-hash', 'white-signature', 'engine-white'),
           ('engine-black-v1', 'Black Engine', 'black-hash', 'black-signature', 'engine-black')`,
      );
      await client.query(
        `INSERT INTO eve_jobs (id, purpose, target_games, status, completed_games, finished_at)
         VALUES ('job-recent', 'smoke', 3, 'completed', 3, $1)`,
        [now],
      );
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_name, black_name, mode, status)
         VALUES
           ('eve-older', 'dark-chess', 'draw', 'truncated', 32, $1, $1,
            'engine-white-v1', 'engine-black-v1', 'eve', 'completed'),
           ('eve-newer', 'dark-chess', 'white-wins', 'king-captured', 15, $2, $2,
            'engine-white-v1', 'engine-black-v1', 'eve', 'completed'),
           ('eve-short-timeout', 'dark-chess', 'black-wins', 'timeout', 4, $3, $3,
            'engine-white-v1', 'engine-black-v1', 'eve', 'completed'),
           ('pvp-newer', 'dark-chess', 'black-wins', 'king-captured', 10, $2, $2,
            'white', 'black', 'pvp', 'completed')`,
        [older, now, shortTimeout],
      );
      await client.query(
        `INSERT INTO eve_games
           (game_id, job_id, game_index, white_engine_id, black_engine_id,
            white_config_hash, black_config_hash, white_play_signature, black_play_signature,
            time_control, opening_policy, seed)
         VALUES
           ('eve-older', 'job-recent', 0, 'engine-white-v1', 'engine-black-v1',
            'white-hash', 'black-hash', 'white-signature', 'black-signature',
            '{"kind":"none"}', '{}', 1),
           ('eve-newer', 'job-recent', 1, 'engine-white-v1', 'engine-black-v1',
            'white-hash', 'black-hash', 'white-signature', 'black-signature',
            '{"kind":"per-move","milliseconds":100}', '{}', 2),
           ('eve-short-timeout', 'job-recent', 2, 'engine-white-v1', 'engine-black-v1',
            'white-hash', 'black-hash', 'white-signature', 'black-signature',
            '{"kind":"per-move","milliseconds":100}', '{}', 3)`,
      );
    } finally {
      await client.end();
    }

    const games = await listRecentEveGames();
    assert.deepEqual(
      games.map((game) => game.roomId),
      ['eve-newer', 'eve-older'],
    );
    assert.equal(games[0]?.jobId, 'job-recent');
    assert.equal(games[0]?.gameIndex, 1);
    assert.equal(games[0]?.mode, 'eve');
    assert.deepEqual(games[0]?.timeControl, { kind: 'per-move', milliseconds: 100 });
  });

  test('listRecentPublicGames returns public games, public-facing PvE games, and EvE games only', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    const shortDecisive = new Date(now.getTime() - 30_000);
    const older = new Date(now.getTime() - 60_000);
    const shortTimeout = new Date(now.getTime() + 60_000);
    const oneMove = new Date(now.getTime() + 120_000);
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('public-pvp', 'dark-chess', 'white-wins', 'king-captured', 31, $1, $1,
            'public-white', 'public-black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('public-pve', 'dark-chess', 'black-wins', 'timeout', 23, $1, $1,
            'human-client-public', 'random-engine', NULL, NULL, 'pve', 'completed', 'public'),
           ('link-pve', 'dark-chess', 'black-wins', 'timeout', 22, $1, $1,
            'human-client', 'random-engine', NULL, NULL, 'pve', 'completed', 'link'),
           ('short-capture', 'dark-chess', 'white-wins', 'king-captured', 6, $2, $2,
            'short-white', 'short-black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('one-move-public', 'dark-chess', 'white-wins', 'king-captured', 1, $5, $5,
            'one-white', 'one-black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('link-eve', 'dark-chess', 'draw', 'truncated', 28, $4, $4,
            'engine:white', 'engine:black', 'White Engine', 'Black Engine', 'eve', 'completed', 'link'),
           ('short-timeout', 'dark-chess', 'black-wins', 'timeout', 4, $3, $3,
            'timeout-white', 'timeout-black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('private-pve', 'dark-chess', 'black-wins', 'timeout', 24, $4, $4,
            'human-client-private', 'random-engine', NULL, NULL, 'pve', 'completed', 'private'),
           ('private-pvp', 'dark-chess', 'draw', 'truncated', 6, $4, $4,
            'private-white', 'private-black', NULL, NULL, 'pvp', 'completed', 'private')`,
        [now, shortDecisive, shortTimeout, older, oneMove],
      );
      for (const roomId of [
        'public-pvp',
        'public-pve',
        'link-pve',
        'short-capture',
        'one-move-public',
        'link-eve',
        'short-timeout',
        'private-pve',
        'private-pvp',
      ]) {
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload)
           VALUES ($1, 0, 'room-created', $2)`,
          [
            roomId,
            {
              type: 'room-created',
              at: now.getTime(),
              roomId,
              variant: roomId.startsWith('watch-dmx') ? 'dark-mini-xiangqi' : 'dark-chess',
              offer: [],
            },
          ],
        );
      }
    } finally {
      await client.end();
    }

    const games = await listRecentPublicGames(10);
    assert.deepEqual(
      games.map((game) => game.roomId),
      ['public-pvp', 'public-pve', 'link-pve', 'link-eve'],
    );
  });

  test('watch feed lists fresh unlocked games and only active in-play sealed games', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    const newest = new Date(now.getTime() - 10 * 60_000);
    const middle = new Date(now.getTime() - 20 * 60_000);
    const oldest = new Date(now.getTime() - 30 * 60_000);
    const outsideWindow = new Date(now.getTime() - 3 * 60 * 60_000);
    const future = new Date(now.getTime() + 60_000);
    const activeSealedAt = now.getTime() - 5 * 60_000;
    const staleSealedAt = now.getTime() - 3 * 60 * 60_000;
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('watch-pvp-newest', 'dark-chess', 'white-wins', 'resignation', 31, $1, $1,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('watch-pve-link', 'dark-chess', 'white-wins', 'resignation', 12, $2, $2,
            'human', 'engine', NULL, NULL, 'pve', 'completed', 'link'),
           ('watch-dmx-pve', 'dark-mini-xiangqi', 'red-wins', 'general-captured', 12, $2, $2,
            'human', 'python-dmx-v1.0', NULL, NULL, 'pve', 'completed', 'public'),
           ('watch-dmx-private-pvp', 'dark-mini-xiangqi', 'red-wins', 'general-captured', 40, $1, $1,
            'red', 'black', NULL, NULL, 'pvp', 'completed', 'private'),
           ('watch-jungle-pve', 'jungle', 'red-wins', 'race', 12, $2, $2,
            'human', 'misty-jungle-level-2', NULL, NULL, 'pve', 'completed', 'public'),
           ('watch-xiangqi', 'dark-xiangqi', 'white-wins', 'resignation', 40, $1, $1,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('watch-eve', 'dark-chess', 'white-wins', 'resignation', 28, $3, $3,
            'engine-white', 'engine-black', 'White Engine', 'Black Engine', 'eve', 'completed', 'unlisted'),
           ('watch-old', 'dark-chess', 'white-wins', 'resignation', 40, $4, $4,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('watch-future', 'dark-chess', 'white-wins', 'resignation', 40, $5, $5,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('watch-no-event', 'dark-chess', 'white-wins', 'king-captured', 40, $1, $1,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('watch-nonterminal-event', 'dark-chess', 'draw', 'server-restarted', 53, $1, $1,
            'white', 'engine', NULL, NULL, 'pve', 'completed', 'public'),
           ('watch-private-pvp', 'dark-chess', 'white-wins', 'resignation', 40, $1, $1,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'private'),
           ('watch-private-eve', 'dark-chess', 'white-wins', 'resignation', 40, $1, $1,
            'engine-white', 'engine-black', NULL, NULL, 'eve', 'completed', 'private'),
           ('watch-short-pvp', 'dark-chess', 'white-wins', 'resignation', 12, $1, $1,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('watch-short-pve', 'dark-chess', 'white-wins', 'resignation', 1, $1, $1,
            'human', 'engine', NULL, NULL, 'pve', 'completed', 'public'),
           ('watch-short-timeout', 'dark-chess', 'black-wins', 'timeout', 4, $1, $1,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('watch-abandoned', 'dark-chess', 'white-wins', 'abandonment', 40, $1, $1,
            'white', 'black', NULL, NULL, 'pvp', 'completed', 'public'),
           ('watch-imported-public', 'dark-chess', 'white-wins', 'resignation', 40, $1, $1,
            'white', 'black', NULL, NULL, 'imported', 'completed', 'public')`,
        [newest, middle, oldest, outsideWindow, future],
      );
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status, visibility)
         VALUES
           ('sealed-public-pvp', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'white', 'black', NULL, NULL, 'pvp', 'running', 'public'),
           ('sealed-link-pve', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'human', 'engine', NULL, NULL, 'pve', 'running', 'link'),
           ('sealed-dmx-pve', 'dark-mini-xiangqi', NULL, NULL, 0, $1, NULL,
            'human', 'python-dmx-v1.0', NULL, NULL, 'pve', 'running', 'public'),
           ('sealed-unlisted-eve', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'engine-white', 'engine-black', NULL, NULL, 'eve', 'running', 'unlisted'),
           ('sealed-prestart', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'white', 'black', NULL, NULL, 'pvp', 'running', 'public'),
           ('sealed-stale-pvp', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'white', 'black', NULL, NULL, 'pvp', 'running', 'public'),
           ('sealed-paused-pve', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'human', 'engine', NULL, NULL, 'pve', 'running', 'public'),
           ('sealed-xiangqi', 'dark-xiangqi', NULL, NULL, 0, $1, NULL,
            'white', 'black', NULL, NULL, 'pvp', 'running', 'public'),
           ('sealed-private-pvp', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'white', 'black', NULL, NULL, 'pvp', 'running', 'private'),
           ('sealed-imported', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'white', 'black', NULL, NULL, 'imported', 'running', 'public'),
           ('sealed-manual', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'white', 'black', NULL, NULL, 'manual', 'running', 'public')`,
        [now],
      );
      for (const roomId of [
        'watch-pvp-newest',
        'watch-pve-link',
        'watch-dmx-pve',
        'watch-dmx-private-pvp',
        'watch-jungle-pve',
        'watch-xiangqi',
        'watch-eve',
        'watch-old',
        'watch-future',
        'watch-private-pvp',
        'watch-private-eve',
        'watch-short-pvp',
        'watch-short-pve',
        'watch-short-timeout',
        'watch-imported-public',
        'watch-nonterminal-event',
      ]) {
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload)
           VALUES ($1, 0, 'room-created', $2)`,
          [
            roomId,
            {
              type: 'room-created',
              at: now.getTime(),
              roomId,
              variant: 'dark-chess',
              offer: [],
            },
          ],
        );
      }
      for (const roomId of [
        'watch-pvp-newest',
        'watch-pve-link',
        'watch-xiangqi',
        'watch-eve',
        'watch-old',
        'watch-future',
        'watch-private-pvp',
        'watch-private-eve',
        'watch-short-pvp',
        'watch-short-pve',
        'watch-imported-public',
      ]) {
        const event: GameEvent = {
          type: 'seat-resigned',
          at: now.getTime() + 1,
          roomId,
          color: 'black',
        };
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload)
           VALUES ($1, 1, $2, $3)`,
          [roomId, event.type, event],
        );
      }
      for (const roomId of ['watch-dmx-pve', 'watch-dmx-private-pvp', 'watch-jungle-pve']) {
        const event = {
          type: 'move-played',
          at: now.getTime() + 1,
          roomId,
          color: 'red',
          move: { from: 'd1', to: 'd7' },
        } as const;
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload)
           VALUES ($1, 1, $2, $3)`,
          [roomId, event.type, event],
        );
      }
      const shortTimeoutEvent: GameEvent = {
        type: 'clock-expired',
        at: now.getTime() + 1,
        roomId: 'watch-short-timeout',
        color: 'white',
        clock: {
          activeColor: null,
          incrementMs: 0,
          initialMs: 180_000,
          remainingMs: { white: 0, black: 180_000 },
          runningSince: null,
        },
      };
      await client.query(
        `INSERT INTO events (room_id, seq, type, payload)
         VALUES ($1, 1, $2, $3)`,
        ['watch-short-timeout', shortTimeoutEvent.type, shortTimeoutEvent],
      );
      // A long but ABANDONED game: it clears the consistency guard (abandonment
      // pairs with seat-forfeited) and the ply floor, so the curated cut keeps
      // it (since 2026-09-10 the bar is the floor alone, not the termination).
      const abandonedEvent: GameEvent = {
        type: 'seat-forfeited',
        at: now.getTime() + 1,
        roomId: 'watch-abandoned',
        color: 'black',
      };
      await client.query(
        `INSERT INTO events (room_id, seq, type, payload)
         VALUES ($1, 1, $2, $3)`,
        ['watch-abandoned', abandonedEvent.type, abandonedEvent],
      );
      const sealedEvents: Array<{ event: GameEvent; roomId: string; seq: number }> = [
        {
          roomId: 'sealed-public-pvp',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-public-pvp',
            color: 'white',
            move: { from: 'e2', to: 'e4' },
          },
        },
        {
          roomId: 'sealed-link-pve',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-link-pve',
            color: 'black',
            move: { from: 'e7', to: 'e5' },
          },
        },
        {
          roomId: 'sealed-dmx-pve',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-dmx-pve',
            color: 'white',
            move: { from: 'd1', to: 'd2' },
          },
        },
        {
          roomId: 'sealed-unlisted-eve',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-unlisted-eve',
            color: 'white',
            move: { from: 'g1', to: 'f3' },
          },
        },
        {
          roomId: 'sealed-prestart',
          seq: 0,
          event: {
            type: 'room-created',
            at: activeSealedAt,
            roomId: 'sealed-prestart',
            variant: 'dark-chess',
            offer: [],
          },
        },
        {
          roomId: 'sealed-stale-pvp',
          seq: 0,
          event: {
            type: 'move-played',
            at: staleSealedAt,
            roomId: 'sealed-stale-pvp',
            color: 'white',
            move: { from: 'd2', to: 'd4' },
          },
        },
        {
          roomId: 'sealed-paused-pve',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-paused-pve',
            color: 'white',
            move: { from: 'c2', to: 'c4' },
          },
        },
        {
          roomId: 'sealed-paused-pve',
          seq: 1,
          event: {
            type: 'pause',
            at: activeSealedAt + 1,
            roomId: 'sealed-paused-pve',
            reason: 'shutdown',
          },
        },
        {
          roomId: 'sealed-xiangqi',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-xiangqi',
            color: 'white',
            move: { from: 'e2', to: 'e4' },
          },
        },
        {
          roomId: 'sealed-private-pvp',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-private-pvp',
            color: 'white',
            move: { from: 'b2', to: 'b4' },
          },
        },
        {
          roomId: 'sealed-imported',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-imported',
            color: 'white',
            move: { from: 'a2', to: 'a4' },
          },
        },
        {
          roomId: 'sealed-manual',
          seq: 0,
          event: {
            type: 'move-played',
            at: activeSealedAt,
            roomId: 'sealed-manual',
            color: 'white',
            move: { from: 'h2', to: 'h4' },
          },
        },
      ];
      for (const { event, roomId, seq } of sealedEvents) {
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload)
           VALUES ($1, $2, $3, $4)`,
          [roomId, seq, event.type, event],
        );
      }
    } finally {
      await client.end();
    }

    const unlocked = await listWatchUnlockedGames({
      limit: 10,
      now,
      variants: ['dark-chess', 'draft960'],
    });
    // Seal-until-finished, no per-mode ply floor: the short PvP/PvE/timeout games
    // unlock once completed, same as a long game (postgame review already showed
    // them). The termination/last-event consistency guard still excludes noise
    // (watch-no-event, watch-nonterminal-event), and visibility still hides
    // private games. Newest ended_at first, then room_id desc.
    assert.deepEqual(
      unlocked.map((game) => game.roomId),
      [
        'watch-short-timeout',
        'watch-short-pvp',
        'watch-short-pve',
        'watch-pvp-newest',
        'watch-abandoned',
        'watch-pve-link',
        'watch-eve',
        'watch-old',
      ],
    );
    assert.equal(
      await countWatchSealedGames({
        activeWindowMs: 2 * 60 * 60_000,
        now,
        variants: ['dark-chess', 'draft960'],
      }),
      3,
    );
    // Decision #6: a variant/family channel passes modes ['pvp','pve'] so EvE
    // games never pollute it (they belong to the Engines channel). Same fixture,
    // narrower mode filter drops the EvE game from both the unlocked list and the
    // sealed count.
    const humanOnly = await listWatchUnlockedGames({
      limit: 10,
      modes: ['pvp', 'pve'],
      now,
      variants: ['dark-chess', 'draft960'],
    });
    assert.deepEqual(
      humanOnly.map((game) => game.roomId),
      [
        'watch-short-timeout',
        'watch-short-pvp',
        'watch-short-pve',
        'watch-pvp-newest',
        'watch-abandoned',
        'watch-pve-link',
        'watch-old',
      ],
    );
    // The curated cut (Featured only, shared with the homepage showcase pool):
    // same recency order, minus every near-opening stub, so the channel's head
    // is the game the homepage board freezes on. watch-pve-link (12 ply) and
    // watch-short-* fall to the floor; watch-abandoned stays despite the
    // termination because it is 40 ply (the floor is the whole bar).
    const curated = await listWatchUnlockedGames({
      curated: true,
      limit: 10,
      modes: ['pvp', 'pve'],
      now,
      variants: ['dark-chess', 'draft960'],
    });
    assert.deepEqual(
      curated.map((game) => game.roomId),
      ['watch-pvp-newest', 'watch-abandoned', 'watch-old'],
    );
    assert.equal(
      await countWatchSealedGames({
        activeWindowMs: 2 * 60 * 60_000,
        modes: ['pvp', 'pve'],
        now,
        variants: ['dark-chess', 'draft960'],
      }),
      2,
    );
    // The Engines channel is the mirror image: modes ['eve'] returns only the EvE
    // game (private EvE still hidden), unlocked and sealed alike.
    const enginesOnly = await listWatchUnlockedGames({
      limit: 10,
      modes: ['eve'],
      now,
      variants: ['dark-chess', 'draft960'],
    });
    assert.deepEqual(
      enginesOnly.map((game) => game.roomId),
      ['watch-eve'],
    );
    assert.equal(
      await countWatchSealedGames({
        activeWindowMs: 2 * 60 * 60_000,
        modes: ['eve'],
        now,
        variants: ['dark-chess', 'draft960'],
      }),
      1,
    );
    const dmxUnlocked = await listWatchUnlockedGames({
      limit: 10,
      now,
      variants: ['dark-mini-xiangqi'],
    });
    assert.deepEqual(
      dmxUnlocked.map((game) => game.roomId),
      ['watch-dmx-pve'],
    );
    // Regression: jungle wins land on a move-played event but terminate with a
    // family reason ('race', den-entered) that the old chess-only allowlist
    // silently excluded from the watch feed.
    const jungleUnlocked = await listWatchUnlockedGames({
      limit: 10,
      now,
      variants: ['jungle'],
    });
    assert.deepEqual(
      jungleUnlocked.map((game) => game.roomId),
      ['watch-jungle-pve'],
    );
    assert.equal(
      await countWatchSealedGames({
        activeWindowMs: 2 * 60 * 60_000,
        now,
        variants: ['dark-mini-xiangqi'],
      }),
      1,
    );
  });

  test('watch feed backfills quiet windows and caps at latest 64 eligible games', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      for (let index = 0; index < 70; index++) {
        const roomId = `watch-cap-${String(index).padStart(2, '0')}`;
        const endedAt = new Date(now.getTime() - index * 60 * 60_000);
        await client.query(
          `INSERT INTO games
             (room_id, variant, result, termination, ply_count, started_at, ended_at,
              white_client, black_client, white_name, black_name, mode, status, visibility)
           VALUES
             ($1, 'dark-chess', 'white-wins', 'resignation', 40, $2, $2,
              'white', 'black', NULL, NULL, 'pvp', 'completed', 'public')`,
          [roomId, endedAt],
        );
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload)
           VALUES ($1, 0, 'room-created', $2)`,
          [
            roomId,
            {
              type: 'room-created',
              at: endedAt.getTime(),
              roomId,
              variant: 'dark-chess',
              offer: [],
            },
          ],
        );
        const terminalEvent: GameEvent = {
          type: 'seat-resigned',
          at: endedAt.getTime() + 1,
          roomId,
          color: 'black',
        };
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload)
           VALUES ($1, 1, $2, $3)`,
          [roomId, terminalEvent.type, terminalEvent],
        );
      }
    } finally {
      await client.end();
    }

    const unlocked = await listWatchUnlockedGames({
      limit: 100,
      now,
      variants: ['dark-chess'],
    });

    assert.equal(unlocked.length, 64);
    assert.equal(unlocked[0]?.roomId, 'watch-cap-00');
    assert.equal(unlocked.at(-1)?.roomId, 'watch-cap-63');
    assert.ok(unlocked.some((game) => game.roomId === 'watch-cap-30'));
    assert.ok(!unlocked.some((game) => game.roomId === 'watch-cap-64'));
  });

  test('listCorpusGames filters timeout games shorter than ten ply', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_name, black_name, corpus_id, mode, status)
         VALUES
           ('corpus-decisive-short', 'dark-chess', 'white-wins', 'king-captured', 6, $1, $1,
            'white', 'black', 'featured-corpus', 'imported', 'completed'),
           ('corpus-timeout-short', 'dark-chess', 'black-wins', 'timeout', 4, $1, $1,
            'white', 'black', 'featured-corpus', 'imported', 'completed'),
           ('corpus-timeout-ten', 'dark-chess', 'black-wins', 'timeout', 10, $1, $1,
            'white', 'black', 'featured-corpus', 'imported', 'completed')`,
        [now],
      );
    } finally {
      await client.end();
    }

    const games = await listCorpusGames('featured-corpus');
    assert.deepEqual(
      games.map((game) => game.roomId),
      ['corpus-decisive-short', 'corpus-timeout-ten'],
    );
  });

  test('listCompletedGames returns completed games in date range with participants', async () => {
    const day = new Date('2026-05-08T12:00:00.000Z');
    const older = new Date('2026-05-07T23:59:59.000Z');
    const newer = new Date('2026-05-09T00:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status)
         VALUES
           ('range-older', 'dark-chess', 'draw', 'truncated', 4, $1, $1,
            'old-white', 'old-black', NULL, NULL, 'pvp', 'completed'),
           ('range-eve', 'dark-chess', 'black-wins', 'timeout', 12, $2, $2,
            'engine:white', 'engine:black', 'White Engine', 'Black Engine', 'eve', 'completed'),
           ('range-newer', 'dark-chess', 'draw', 'truncated', 5, $3, $3,
            'new-white', 'new-black', NULL, NULL, 'pvp', 'completed'),
           ('range-running', 'dark-chess', NULL, NULL, 0, $2, NULL,
            NULL, NULL, NULL, NULL, 'pvp', 'running')`,
        [older, day, newer],
      );
    } finally {
      await client.end();
    }
    await recordGameEnd('range-pve', {
      variant: 'dark-chess',
      mode: 'pve',
      result: 'white-wins',
      termination: 'king-captured',
      plyCount: 9,
      startedAt: day,
      endedAt: day,
      whiteClient: 'human-client',
      blackClient: 'random-engine',
      whiteName: null,
      blackName: null,
      corpusId: null,
    });

    const games = await listCompletedGames({
      endedFrom: new Date('2026-05-08T00:00:00.000Z'),
      endedTo: new Date('2026-05-09T00:00:00.000Z'),
    });
    assert.deepEqual(
      games.map((game) => game.roomId),
      ['range-pve', 'range-eve'],
    );
    assert.equal(games[0]?.mode, 'pve');
    assert.deepEqual(games[0]?.participants, [
      {
        color: 'white',
        displayName: 'Guest',
        subjectType: 'guest',
        subjectId: null,
        visibility: 'public',
      },
      {
        color: 'black',
        displayName: 'Misty Random',
        subjectType: 'engine-version',
        subjectId: 'builtin-random-legal',
        visibility: 'public',
      },
    ]);

    const eveGames = await listCompletedGames({
      endedFrom: new Date('2026-05-08T00:00:00.000Z'),
      endedTo: new Date('2026-05-09T00:00:00.000Z'),
      mode: 'eve',
    });
    assert.deepEqual(
      eveGames.map((game) => game.roomId),
      ['range-eve'],
    );
  });

  test('getGameSummary returns completed game metadata without events', async () => {
    const now = new Date();
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_name, black_name, mode, status)
         VALUES
           ('summary-pve', 'dark-chess', 'white-wins', 'king-captured', 17, $1, $1,
            'human', 'engine', 'pve', 'completed'),
           ('summary-running', 'dark-chess', NULL, NULL, 0, $1, NULL,
            NULL, NULL, 'pvp', 'running')`,
        [now],
      );
    } finally {
      await client.end();
    }

    const summary = await getGameSummary('summary-pve');
    assert.equal(summary?.roomId, 'summary-pve');
    assert.equal(summary?.mode, 'pve');
    assert.equal(summary?.whiteName, 'human');
    assert.equal(summary?.blackName, 'engine');
    assert.equal(summary?.plyCount, 17);
    assert.deepEqual(summary?.participants, [
      {
        color: 'white',
        displayName: 'human',
        subjectType: 'guest',
        subjectId: null,
        visibility: 'public',
      },
      {
        color: 'black',
        displayName: 'engine',
        subjectType: 'guest',
        subjectId: null,
        visibility: 'public',
      },
    ]);
    assert.equal(await getGameSummary('summary-running'), null);
    assert.equal(await getGameSummary('missing-summary'), null);
  });
});
