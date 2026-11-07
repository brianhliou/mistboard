import { createUser, findUserByEmail, markUserEmailVerified } from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

definePersistenceTests('accounts', () => {
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
