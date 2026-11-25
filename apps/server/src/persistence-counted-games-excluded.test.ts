// Which games an excluded seat drops (excludedFromStats). Planted cases: the
// operator against a bot is testing and stays out; the operator against a
// real signed-in account is that player's game and counts; so is the operator
// against a guest browser no excluded account has used (set 2026-11-24). The
// operator against his own browser stays out, whether the browser is known
// from a live connect (stats_excluded_devices) or only from a sign-in
// (account_sessions.device_id), as do the operator against another excluded
// account, a pre-137 guest seat, or a table with a bot in it. The legacy
// clause (any excluded seat drops the game) is run beside it to pin the cases
// the rule changed.
//
// Known blind spot, asserted below so it cannot change unseen: a browser an
// excluded account never signed in on (a private window, a second profile, a
// QA tester's fresh browser) has a fresh device id and nothing ties it to the
// account, so the operator or a QA account playing it counts.

import {
  countedHumanGame,
  countedPlayerSeat,
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
  test('an excluded seat drops the game unless every other seat is a real person', async () => {
    const ended = new Date('2026-07-29T11:00:00.000Z');
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO users (id, email, handle, display_name, stats_excluded_at) VALUES
           ('cx-owner', 'cx-owner@example.com', 'cxowner', 'Owner', now()),
           ('cx-alt', 'cx-alt@example.com', 'cxalt', 'Alt', now()),
           ('cx-qa', 'cx-qa@example.com', 'cxqa', 'QA', now()),
           ('cx-real', 'cx-real@example.com', 'cxreal', 'Real', NULL)`,
      );
      await client.query(
        `INSERT INTO stats_excluded_devices (device_id, account_id) VALUES ('cx-owner-device', 'cx-owner')`,
      );
      // Browsers known only from a sign-in: the owner's phone (a revoked
      // session still counts as evidence), another excluded account's laptop,
      // and a real player's browser.
      await client.query(
        `INSERT INTO account_sessions (id, user_id, token_hash, expires_at, revoked_at, device_id) VALUES
           ('cx-s1', 'cx-owner', 'cx-h1', now() + interval '1 day', now(), 'cx-owner-phone'),
           ('cx-s2', 'cx-alt', 'cx-h2', now() + interval '1 day', NULL, 'cx-alt-laptop'),
           ('cx-s3', 'cx-real', 'cx-h3', now() + interval '1 day', NULL, 'cx-real-browser')`,
      );
      const games: Array<[string, 'pvp' | 'pve', number]> = [
        ['cx-owner-vs-bot', 'pve', 30],
        ['cx-owner-vs-real', 'pvp', 30],
        ['cx-owner-vs-alt', 'pvp', 30],
        ['cx-owner-vs-own-browser', 'pvp', 30],
        ['cx-owner-vs-signed-in-phone', 'pvp', 30],
        ['cx-owner-vs-alt-laptop', 'pvp', 30],
        ['cx-owner-vs-legacy-guest', 'pvp', 30],
        ['cx-owner-vs-guest', 'pvp', 30],
        ['cx-owner-vs-real-browser-guest', 'pvp', 30],
        ['cx-owner-vs-real-and-guest', 'pvp', 30],
        ['cx-owner-vs-guest-and-bot', 'pvp', 30],
        ['cx-owner-browser-vs-real', 'pvp', 30],
        ['cx-owner-browser-vs-guest', 'pvp', 30],
        ['cx-owner-vs-real-pvp-bot-seat', 'pvp', 30],
        ['cx-owner-vs-real-short', 'pvp', 1],
        ['cx-owner-vs-guest-short', 'pvp', 1],
        ['cx-qa-vs-fresh-guest', 'pvp', 30],
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
        // The owner's own browser, known from a live connect while signed in.
        ['cx-owner-vs-own-browser', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-own-browser', 'black', 'guest', 'cx-owner-device'],
        // Known only from a sign-in on that browser, now revoked.
        ['cx-owner-vs-signed-in-phone', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-signed-in-phone', 'black', 'guest', 'cx-owner-phone'],
        // Any excluded account's browser, not only the seated account's.
        ['cx-owner-vs-alt-laptop', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-alt-laptop', 'black', 'guest', 'cx-alt-laptop'],
        ['cx-owner-vs-legacy-guest', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-legacy-guest', 'black', 'guest', null],
        // A guest browser no excluded account has used: a real visitor.
        ['cx-owner-vs-guest', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-guest', 'black', 'guest', 'cx-unknown-device'],
        // A real player's browser, signed out for this game.
        ['cx-owner-vs-real-browser-guest', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-real-browser-guest', 'black', 'guest', 'cx-real-browser'],
        ['cx-owner-vs-real-and-guest', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-real-and-guest', 'black', 'user', 'cx-real'],
        ['cx-owner-vs-real-and-guest', 'east', 'guest', 'cx-unknown-device'],
        // A real guest does not rescue a table with an engine in another chair.
        ['cx-owner-vs-guest-and-bot', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-guest-and-bot', 'black', 'guest', 'cx-unknown-device'],
        ['cx-owner-vs-guest-and-bot', 'east', 'engine-version', 'engine-x'],
        ['cx-owner-browser-vs-real', 'red', 'guest', 'cx-owner-device'],
        ['cx-owner-browser-vs-real', 'black', 'user', 'cx-real'],
        ['cx-owner-browser-vs-guest', 'red', 'guest', 'cx-owner-device'],
        ['cx-owner-browser-vs-guest', 'black', 'guest', 'cx-unknown-device'],
        ['cx-owner-vs-real-pvp-bot-seat', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-real-pvp-bot-seat', 'black', 'user', 'cx-real'],
        // A four-seat table (east/west) with an engine in one chair.
        ['cx-owner-vs-real-pvp-bot-seat', 'east', 'engine-version', 'engine-x'],
        ['cx-owner-vs-real-short', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-real-short', 'black', 'user', 'cx-real'],
        ['cx-owner-vs-guest-short', 'red', 'user', 'cx-owner'],
        ['cx-owner-vs-guest-short', 'black', 'guest', 'cx-unknown-device'],
        // Blind spot: a QA account against its own fresh private window.
        ['cx-qa-vs-fresh-guest', 'red', 'user', 'cx-qa'],
        ['cx-qa-vs-fresh-guest', 'black', 'guest', 'cx-qa-private-window'],
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
      assert.deepEqual(counted, [
        'cx-owner-browser-vs-guest',
        'cx-owner-browser-vs-real',
        'cx-owner-vs-guest',
        'cx-owner-vs-real',
        'cx-owner-vs-real-and-guest',
        'cx-owner-vs-real-browser-guest',
        'cx-qa-vs-fresh-guest',
        'cx-real-vs-bot',
      ]);
      // The case this rule added: the owner against a real guest browser.
      assert.ok(counted.includes('cx-owner-vs-guest'));
      // Known blind spot: nothing ties a never-signed-in browser to the QA
      // account, so its game against that browser counts.
      assert.ok(counted.includes('cx-qa-vs-fresh-guest'));
      // Left out for the seats, and reported as internal on /metrics.
      assert.deepEqual(await ids(internalHumanGame('g')), [
        'cx-owner-vs-alt',
        'cx-owner-vs-alt-laptop',
        'cx-owner-vs-bot',
        'cx-owner-vs-guest-and-bot',
        'cx-owner-vs-legacy-guest',
        'cx-owner-vs-own-browser',
        'cx-owner-vs-real-pvp-bot-seat',
        'cx-owner-vs-signed-in-phone',
      ]);
      // Under the ply floor: short, not internal. The rows still partition.
      assert.deepEqual(await ids(shortHumanGame('g')), [
        'cx-owner-vs-guest-short',
        'cx-owner-vs-real-short',
      ]);

      // Players: the person opposite counts, the excluded account never does,
      // as for its games against accounts.
      const players = (
        await client.query<{ subject_id: string }>(
          `SELECT DISTINCT p.subject_id FROM games g
           JOIN game_participants p ON p.game_id = g.room_id
           WHERE g.room_id LIKE 'cx-%' AND ${countedHumanGame('g')} AND ${countedPlayerSeat('p')}
           ORDER BY p.subject_id`,
        )
      ).rows.map((row) => row.subject_id);
      assert.deepEqual(players, [
        'cx-qa-private-window',
        'cx-real',
        'cx-real-browser',
        'cx-unknown-device',
      ]);

      // The legacy clause dropped every game with an excluded seat, the
      // owner against a real player included: the cases the rule changed.
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
