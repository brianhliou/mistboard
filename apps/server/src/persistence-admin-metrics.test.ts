import { createUser } from './persistence-accounts.js';
import { getAdminMetrics } from './persistence-admin-metrics.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

type ParticipantFixture = {
  color: 'white' | 'black';
  subjectType: 'guest' | 'user' | 'engine-version';
  subjectId: string;
};

async function insertGame(input: {
  roomId: string;
  variant: string;
  mode: 'pvp' | 'pve' | 'eve' | 'imported';
  endedAt: string;
  participants: ParticipantFixture[];
}): Promise<void> {
  await getPool().query(
    `INSERT INTO games
       (room_id, variant, mode, status, result, termination, ply_count, started_at, ended_at)
     VALUES ($1, $2, $3, 'completed', 'white-wins', 'checkmate', 20,
             $4::timestamptz - interval '10 minutes', $4)`,
    [input.roomId, input.variant, input.mode, input.endedAt],
  );
  for (const participant of input.participants) {
    await getPool().query(
      `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.roomId,
        participant.color,
        participant.subjectType,
        participant.subjectId,
        participant.subjectId,
      ],
    );
  }
}

definePersistenceTests('admin metrics', () => {
  test('weekly series count accounts and guest browsers, and keep engines apart', async () => {
    // now is a Wednesday; the current week starts Monday 2026-07-20 and the
    // 3-week window opens on 2026-07-06.
    const now = new Date('2026-07-22T12:00:00Z');
    await createUser({
      id: 'user-1',
      email: 'one@example.com',
      emailVerifiedAt: now,
      handle: 'one',
      displayName: 'One',
      now: new Date('2026-07-14T09:00:00Z'),
    });
    await createUser({
      id: 'user-2',
      email: 'two@example.com',
      emailVerifiedAt: now,
      handle: 'two',
      displayName: 'Two',
      now: new Date('2026-07-21T09:00:00Z'),
    });
    await getPool().query(
      `UPDATE users SET patron_since = '2026-07-21T10:00:00Z' WHERE id = 'user-2'`,
    );
    await getPool().query(
      `INSERT INTO patron_subscriptions (account_id, status, is_lifetime) VALUES ('user-2', 'active', false)`,
    );

    // Week of 07-06: guest-1's first game, vs the bot.
    await insertGame({
      roomId: 'w1-pve',
      variant: 'xiangqi',
      mode: 'pve',
      endedAt: '2026-07-08T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'guest', subjectId: 'guest-1' },
        { color: 'black', subjectType: 'engine-version', subjectId: 'engine-1' },
      ],
    });
    // Week of 07-13: guest-1 returns and user-1 appears; one bot-vs-bot game
    // that must not reach any human number.
    await insertGame({
      roomId: 'w2-pvp',
      variant: 'jieqi',
      mode: 'pvp',
      endedAt: '2026-07-15T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'guest', subjectId: 'guest-1' },
        { color: 'black', subjectType: 'user', subjectId: 'user-1' },
      ],
    });
    await insertGame({
      roomId: 'w2-eve',
      variant: 'dark-chess',
      mode: 'eve',
      endedAt: '2026-07-16T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'engine-version', subjectId: 'engine-1' },
        { color: 'black', subjectType: 'engine-version', subjectId: 'engine-2' },
      ],
    });
    await insertGame({
      roomId: 'w2-imported',
      variant: 'xiangqi',
      mode: 'imported',
      endedAt: '2026-07-16T13:00:00Z',
      participants: [],
    });
    // Week of 07-20 (current, partial): user-1 twice in one week counts once.
    await insertGame({
      roomId: 'w3-pve-a',
      variant: 'xiangqi',
      mode: 'pve',
      endedAt: '2026-07-21T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'user', subjectId: 'user-1' },
        { color: 'black', subjectType: 'engine-version', subjectId: 'engine-1' },
      ],
    });
    await insertGame({
      roomId: 'w3-pve-b',
      variant: 'xiangqi',
      mode: 'pve',
      endedAt: '2026-07-21T13:00:00Z',
      participants: [
        { color: 'white', subjectType: 'user', subjectId: 'user-1' },
        { color: 'black', subjectType: 'engine-version', subjectId: 'engine-1' },
      ],
    });
    // An operator account excluded from statistics: its week-3 game and the
    // account itself leave every count, and the game shows up only as
    // internal in the block that says what was left out.
    await createUser({
      id: 'user-op',
      email: 'op@example.com',
      emailVerifiedAt: now,
      handle: 'op',
      displayName: 'Op',
      now: new Date('2026-07-21T09:30:00Z'),
    });
    await getPool().query(`UPDATE users SET stats_excluded_at = now() WHERE id = 'user-op'`);
    // A browser the excluded account has used: its guest games are out too.
    await getPool().query(
      `INSERT INTO stats_excluded_devices (device_id, account_id) VALUES ('guest-7', 'user-op')`,
    );
    await insertGame({
      roomId: 'w2-excluded-device',
      variant: 'xiangqi',
      mode: 'pve',
      endedAt: '2026-07-16T15:00:00Z',
      participants: [
        { color: 'white', subjectType: 'guest', subjectId: 'guest-7' },
        { color: 'black', subjectType: 'engine-version', subjectId: 'engine-1' },
      ],
    });
    await insertGame({
      roomId: 'w3-internal',
      variant: 'xiangqi',
      mode: 'pvp',
      endedAt: '2026-07-21T14:00:00Z',
      participants: [
        { color: 'white', subjectType: 'user', subjectId: 'user-op' },
        { color: 'black', subjectType: 'guest', subjectId: 'guest-7' },
      ],
    });
    // A game after `now` is outside every window.
    await insertGame({
      roomId: 'future',
      variant: 'xiangqi',
      mode: 'pvp',
      endedAt: '2026-07-23T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'guest', subjectId: 'guest-9' },
        { color: 'black', subjectType: 'guest', subjectId: 'guest-8' },
      ],
    });

    await getPool().query(
      `INSERT INTO chat_lines (id, room, author_account_id, body_text, created_at) VALUES
         ('c1', 'lobby', 'user-1', 'hi', '2026-07-15T12:00:00Z'),
         ('c2', 'lobby', 'user-1', 'hidden', '2026-07-15T12:01:00Z'),
         ('c3', 'lobby', 'user-1', 'shadow', '2026-07-15T12:02:00Z')`,
    );
    await getPool().query(
      `UPDATE chat_lines SET hidden_at = now() WHERE id = 'c2';
       UPDATE chat_lines SET shadow = true WHERE id = 'c3'`,
    );
    const metrics = await getAdminMetrics({ now, weeks: 3 });

    assert.deepEqual(
      metrics.weekly.map((week) => week.weekStart),
      ['2026-07-06', '2026-07-13', '2026-07-20'],
    );
    const [w1, w2, w3] = metrics.weekly;
    assert.ok(w1 && w2 && w3);

    assert.deepEqual(
      [w1, w2, w3].map((w) => [
        w.humanGames,
        w.pvpGames,
        w.pveGames,
        w.guestGames,
        w.eveGames,
        w.internalGames,
      ]),
      [
        [1, 0, 1, 1, 0, 0],
        [1, 1, 0, 1, 1, 1],
        [2, 0, 2, 0, 0, 1],
      ],
    );
    // Players are accounts plus guest browsers: guest-1 is new in week 1 and
    // returning in week 2 beside user-1 (new); user-1 alone in week 3,
    // counted once despite two games. guest-7 sits on an excluded device.
    assert.deepEqual(
      [w1, w2, w3].map((w) => [w.players, w.signedInPlayers, w.newPlayers, w.returningPlayers]),
      [
        [1, 0, 1, 0],
        [2, 1, 1, 1],
        [1, 1, 0, 1],
      ],
    );
    // Rolling 28 days at each week's end.
    assert.deepEqual(
      [w1, w2, w3].map((w) => w.activePlayers28d),
      [1, 2, 2],
    );
    assert.deepEqual(
      [w1, w2, w3].map((w) => [w.newAccounts, w.newPatrons, w.chatLines]),
      [
        [0, 0, 0],
        [1, 0, 1],
        [1, 1, 0],
      ],
    );

    // user-op is not an account here, and its game is not a game.
    assert.equal(metrics.accounts, 2);
    assert.equal(metrics.humanGames, 5);
    assert.equal(metrics.activePlayers28d, 2);
    assert.equal(metrics.previousActivePlayers28d, 0);
    assert.equal(metrics.activePatrons, 1);
    assert.deepEqual(metrics.humanGamesByVariant, { xiangqi: 4, jieqi: 1 });
    assert.deepEqual(metrics.humanGamesByResult, { 'white-wins': 5 });

    assert.equal(metrics.engines.eveGames, 1);
    assert.equal(metrics.engines.importedGames, 1);
    assert.equal(metrics.engines.manualGames, 0);
    assert.equal(metrics.engines.internalGames, 2);
    assert.equal(metrics.engines.internalGamesLast7d, 2);
    assert.deepEqual(metrics.engines.eveByVariant, { 'dark-chess': 1 });
  });
});
