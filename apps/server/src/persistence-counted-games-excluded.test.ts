// Which games an excluded seat drops (excludedFromStats). Planted cases: the
// operator against a bot is testing and stays out; the operator against a
// real signed-in account is that player's game and counts; the operator
// against a guest stays out even when the guest's browser is not excluded (it
// could be the operator on another browser); so does the operator against
// another excluded account, his own browser or a pre-137 guest seat. The
// legacy clause (any excluded seat drops the game) is run beside it to pin the
// one case the rule changed.

import {
  countedHumanGame,
  excludedSeatExists,
  internalHumanGame,
  shortHumanGame,
} from './persistence-counted-games.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('counted games with excluded seats', () => {
  test('an excluded seat drops the game unless every other seat is a real signed-in account', async () => {
    const ended = new Date('2026-07-29T11:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO users (id, email, handle, display_name, stats_excluded_at) VALUES
           ('cx-owner', 'cx-owner@example.com', 'cxowner', 'Owner', now()),
           ('cx-alt', 'cx-alt@example.com', 'cxalt', 'Alt', now()),
           ('cx-real', 'cx-real@example.com', 'cxreal', 'Real', NULL)`,
      );
      await client.query(
        `INSERT INTO stats_excluded_devices (device_id, account_id) VALUES ('cx-owner-device', 'cx-owner')`,
      );
      const games: Array<[string, 'pvp' | 'pve', number]> = [
        ['cx-owner-vs-bot', 'pve', 30],
        ['cx-owner-vs-real', 'pvp', 30],
        ['cx-owner-vs-alt', 'pvp', 30],
        ['cx-owner-vs-own-browser', 'pvp', 30],
        ['cx-owner-vs-legacy-guest', 'pvp', 30],
        ['cx-owner-vs-guest', 'pvp', 30],
        ['cx-owner-vs-real-and-guest', 'pvp', 30],
        ['cx-owner-browser-vs-real', 'pvp', 30],
        ['cx-owner-vs-real-pvp-bot-seat', 'pvp', 30],
        ['cx-owner-vs-real-short', 'pvp', 1],
        ['cx-real-vs-bot', 'pve', 30],
      ];
      for (const [roomId, mode, plies] of games) {
        await client.query(
          `INSERT INTO games
             (room_id, variant, result, termination, ply_count, started_at, ended_at,
              white_client, black_client, white_name, black_name, mode, status, visibility)
           VALUES ($1, 'xiangqi', 'red-wins', 'resignation', $3, $4, $4,
                   'red', 'black', NULL, NULL, $2, 'completed', 'public')`,
          [roomId, mode, plies, ended],
        );
      }
      const seats: Array<[string, string, string, string | null]> = [
        ['cx-owner-vs-bot', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-bot', 'black', 'bot', 'xiangqi-l3'],
        ['cx-owner-vs-real', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-real', 'black', 'user', 'cx-real'],
        ['cx-owner-vs-alt', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-alt', 'black', 'user', 'cx-alt'],
        ['cx-owner-vs-own-browser', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-own-browser', 'black', 'guest', 'cx-owner-device'],
        ['cx-owner-vs-legacy-guest', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-legacy-guest', 'black', 'guest', null],
        // A guest seat from a browser nobody excluded: could be anyone,
        // including the operator in another browser, so the game stays out.
        ['cx-owner-vs-guest', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-guest', 'black', 'guest', 'cx-unknown-device'],
        // A real account at the table does not rescue a guest in another chair.
        ['cx-owner-vs-real-and-guest', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-real-and-guest', 'black', 'user', 'cx-real'],
        ['cx-owner-vs-real-and-guest', 'east', 'guest', 'cx-unknown-device'],
        ['cx-owner-browser-vs-real', 'red', 'guest', 'cx-owner-device'],
        ['cx-owner-browser-vs-real', 'black', 'user', 'cx-real'],
        ['cx-owner-vs-real-pvp-bot-seat', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-real-pvp-bot-seat', 'black', 'user', 'cx-real'],
        // A four-seat table (east/west) with an engine in one chair.
        ['cx-owner-vs-real-pvp-bot-seat', 'east', 'engine-version', 'engine-x'],
        ['cx-owner-vs-real-short', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-real-short', 'black', 'user', 'cx-real'],
        ['cx-real-vs-bot', 'red', 'user', 'cx-real'],
        ['cx-real-vs-bot', 'black', 'bot', 'xiangqi-l3'],
      ];
      for (const [gameId, color, subjectType, subjectId] of seats) {
        await client.query(
          `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name)
           VALUES ($1, $2, $3, $4, 'Seat')`,
          [gameId, color, subjectType, subjectId],
        );
      }

      const ids = async (where: string) =>
        (
          await client.query<{ room_id: string }>(
            `SELECT g.room_id FROM games g WHERE g.room_id LIKE 'cx-%' AND ${where} ORDER BY g.room_id`,
          )
        ).rows.map((row) => row.room_id);

      const counted = await ids(countedHumanGame('g'));
      assert.deepEqual(counted, ['cx-owner-browser-vs-real', 'cx-owner-vs-real', 'cx-real-vs-bot']);
      // Left out for the seats, and reported as internal on /metrics.
      assert.deepEqual(await ids(internalHumanGame('g')), [
        'cx-owner-vs-alt',
        'cx-owner-vs-bot',
        'cx-owner-vs-guest',
        'cx-owner-vs-legacy-guest',
        'cx-owner-vs-own-browser',
        'cx-owner-vs-real-and-guest',
        'cx-owner-vs-real-pvp-bot-seat',
      ]);
      // The non-excluded guest seat is a counted player seat, so a rule keyed
      // on "some countable person sat in it" would have counted this game.
      assert.ok(!counted.includes('cx-owner-vs-guest'));
      // Under the ply floor: short, not internal. The rows still partition.
      assert.deepEqual(await ids(shortHumanGame('g')), ['cx-owner-vs-real-short']);

      // The legacy clause dropped every game with an excluded seat, the
      // owner against a real player included: the case this rule changed.
      const legacy = await ids(
        `g.status = 'completed' AND g.ply_count >= 2 AND NOT ${excludedSeatExists('g')}`,
      );
      assert.deepEqual(legacy, ['cx-real-vs-bot']);
      assert.ok(!legacy.includes('cx-owner-vs-real'));
    } finally {
      await client.end();
    }
  });
});
