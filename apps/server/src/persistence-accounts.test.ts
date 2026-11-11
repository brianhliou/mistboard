import type { IncomingMessage, ServerResponse } from 'node:http';
import { signDmEmailUnsubscribeToken } from './inbox-email-unsubscribe.js';
import {
  createUser,
  findUserByEmail,
  markUserEmailVerified,
  updateUserAccountPreference,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { createInboxEmailUnsubscribeRoute } from './routes/inbox-email-unsubscribe.js';

definePersistenceTests('accounts', () => {
  test('DM unsubscribe persists only inboxEmail and invalid or unknown tokens change nothing', async () => {
    const user = await createUser({
      id: 'user_dm_unsubscribe',
      email: 'dm-unsubscribe@example.com',
      emailVerifiedAt: null,
      handle: 'dmunsubscribe',
      displayName: 'DM unsubscribe',
      now: new Date(),
    });
    const secret = 'test-only-persistence-signing-key';
    const route = createInboxEmailUnsubscribeRoute({ env: { MISTBOARD_ENGINE_SECRET: secret } });
    const token = signDmEmailUnsubscribeToken(user.id, secret);
    async function call(method: string, value: string) {
      const url = new URL('https://mistboard.example/api/inbox/email/unsubscribe');
      url.searchParams.set('t', value);
      let status = 0;
      const response = {
        writeHead(code: number) {
          status = code;
          return this;
        },
        end() {},
      } as unknown as ServerResponse;
      assert.equal(
        await route.tryHandle(
          {},
          { method, headers: {} } as IncomingMessage,
          response,
          url.pathname,
          url,
        ),
        true,
      );
      return status;
    }
    assert.equal(await call('GET', token), 200);
    assert.deepEqual(
      (await findUserByEmail(user.email))?.accountPreferences,
      user.accountPreferences,
    );
    for (const invalid of [`${token}x`, signDmEmailUnsubscribeToken('unknown_account', secret)]) {
      assert.equal(await call('POST', invalid), 400);
      assert.deepEqual(
        (await findUserByEmail(user.email))?.accountPreferences,
        user.accountPreferences,
      );
    }
    for (let i = 0; i < 2; i++) {
      assert.equal(await call('POST', token), 200);
      assert.deepEqual((await findUserByEmail(user.email))?.accountPreferences, {
        ...user.accountPreferences,
        inboxEmail: false,
      });
    }
  });

  test('inbox email defaults on and persists independently of the bell', async () => {
    const now = new Date();
    const user = await createUser({
      id: 'user_inbox_email',
      email: 'inbox-email@example.com',
      emailVerifiedAt: null,
      handle: 'inbox-email',
      displayName: 'Inbox Email',
      now,
    });
    assert.equal(user.accountPreferences.inboxEmail, true);
    assert.equal((await findUserByEmail(user.email))?.accountPreferences.inboxEmail, true);

    // Existing rows lack the new key; malformed JSON values also keep the default.
    for (const preferences of [{ inboxBell: false }, { inboxBell: false, inboxEmail: 'false' }]) {
      await getPool().query('UPDATE users SET account_preferences = $2::jsonb WHERE id = $1', [
        user.id,
        JSON.stringify(preferences),
      ]);
      const legacy = await findUserByEmail(user.email);
      assert.equal(legacy?.accountPreferences.inboxEmail, true);
      assert.equal(legacy?.accountPreferences.inboxBell, false);
    }

    for (const enabled of [false, true]) {
      const updated = await updateUserAccountPreference(user.id, 'inboxEmail', enabled, now);
      assert.equal(updated?.accountPreferences.inboxEmail, enabled);
      assert.equal(updated?.accountPreferences.inboxBell, false);
      const stored = await findUserByEmail(user.email);
      assert.equal(stored?.accountPreferences.inboxEmail, enabled);
      assert.equal(stored?.accountPreferences.inboxBell, false);
    }
  });

  test('Gomoku and every historical rating bucket survive the migrated CHECK', async () => {
    await createUser({
      id: 'gomoku-check',
      email: 'gomoku-check@example.com',
      emailVerifiedAt: null,
      handle: 'gomokucheck',
      displayName: 'Migration fixture',
      now: new Date(),
    });
    const pools = [
      'fog',
      'fog_draft960',
      'dark_mini_xiangqi',
      'drop_mini_xiangqi',
      'dark_xiangqi',
      'crossroads_chess_open',
      'crossroads_chess',
      'jieqi',
      'banqi',
      'reveal_chess',
      'dark_shogi',
      'dark_crazyhouse',
      'kriegspiel',
      'jungle',
      'jungle_flip',
      'fortress_xiangqi',
      'xiangqi',
      'duck_xiangqi',
      'atomic_xiangqi',
      'crazyhouse_xiangqi',
      'xiangqi_mahjong',
      'gomoku',
    ];
    for (const pool of pools) {
      await getPool().query(
        `INSERT INTO user_ratings (user_id, variant, time_class, elo_rating, rating_deviation, volatility, games_played)
        VALUES ($1, $2, 'blitz', 1500, 350, 0.06, 0)`,
        ['gomoku-check', pool],
      );
    }
    const { rows } = await getPool().query(`SELECT variant FROM user_ratings WHERE user_id = $1`, [
      'gomoku-check',
    ]);
    assert.deepEqual(rows.map((row) => row.variant).sort(), pools.sort());
  });

  test('users are findable by email case-insensitively', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    const user = await createUser({
      id: 'user_alice',
      email: 'Alice@Example.com',
      emailVerifiedAt: null,
      handle: 'alice',
      displayName: 'Alice',
      now,
    });
    assert.equal(user.emailVerifiedAt, null);

    const found = await findUserByEmail('alice@example.com');
    assert.equal(found?.id, 'user_alice');

    const verified = await markUserEmailVerified('user_alice', new Date(now.getTime() + 1_000));
    assert.ok(verified.emailVerifiedAt);
  });
});
