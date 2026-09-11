import { listAdminAccounts } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Three accounts that together cover what the public surfaces hide: a closed
// account, an unverified one, a private game, and a game still running.
async function seedRoster(client: pg.Client, now: Date): Promise<void> {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY_MS);
  await client.query(
    `INSERT INTO users
       (id, email, email_verified_at, handle, display_name, profile_visibility,
        created_at, last_seen_at, closed_at)
     VALUES
       ('adm_alice', 'adm-alice@example.com', $1, 'adm_alice', 'Alice Admin', 'public', $2, $3, NULL),
       ('adm_bob', 'adm-bob@example.com', $1, 'adm_bob', 'Bob Closed', 'private', $4, NULL, $5),
       ('adm_carol', 'adm-carol@example.com', NULL, 'adm_carol', 'Carol Quiet', 'public', $6, NULL, NULL)`,
    [at(1), at(1), at(0), at(2), at(0), at(40)],
  );
  const games: Array<{
    roomId: string;
    status: 'completed' | 'running';
    visibility: 'public' | 'private';
    red: string;
    black: string | null;
  }> = [
    { roomId: 'adm_g1', status: 'completed', visibility: 'public', red: 'adm_alice', black: null },
    {
      roomId: 'adm_g2',
      status: 'completed',
      visibility: 'private',
      red: 'adm_carol',
      black: 'adm_alice',
    },
    { roomId: 'adm_g3', status: 'running', visibility: 'public', red: 'adm_carol', black: null },
  ];
  for (const game of games) {
    const running = game.status === 'running';
    await client.query(
      `INSERT INTO games
         (room_id, variant, result, termination, ply_count, started_at, ended_at,
          white_name, black_name, mode, status, visibility)
       VALUES ($1, 'xiangqi', $2, $3, 40, $4, $5, 'Red', 'Black', 'pvp', $6, $7)`,
      [
        game.roomId,
        running ? null : 'red-wins',
        running ? null : 'resignation',
        at(1),
        running ? null : at(1),
        game.status,
        game.visibility,
      ],
    );
    await client.query(
      `INSERT INTO game_participants
         (game_id, color, subject_type, subject_id, display_name, visibility)
       VALUES
         ($1, 'red', 'user', $2, $2, $5),
         ($1, 'black', $3, $4, COALESCE($4, 'Guest'), $5)`,
      [game.roomId, game.red, game.black ? 'user' : 'guest', game.black, game.visibility],
    );
  }
}

definePersistenceTests('admin-accounts', () => {
  test('the roster lists every account with completed-game counts and signup figures', async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await seedRoster(client, new Date());

      const newest = await listAdminAccounts({
        sort: 'newest',
        search: null,
        limit: 200,
        offset: 0,
      });
      assert.deepEqual(
        newest.accounts.map((p) => p.id),
        ['adm_alice', 'adm_bob', 'adm_carol'],
      );
      assert.equal(newest.total, 3);
      assert.deepEqual(newest.summary, { accounts: 3, last7d: 2, last30d: 2 });

      const byId = new Map(newest.accounts.map((p) => [p.id, p]));
      // Alice: one public game and one private game, both completed. Carol: the
      // private one, plus a running game that is not a played game yet. Bob: none.
      assert.equal(byId.get('adm_alice')?.gamesPlayed, 2);
      assert.equal(byId.get('adm_carol')?.gamesPlayed, 1);
      assert.equal(byId.get('adm_bob')?.gamesPlayed, 0);
      // The admin-only facts the public surfaces hide are all present.
      assert.ok(byId.get('adm_bob')?.closedAt);
      assert.equal(byId.get('adm_bob')?.profileVisibility, 'private');
      assert.equal(byId.get('adm_carol')?.emailVerifiedAt, null);
      assert.equal(byId.get('adm_alice')?.email, 'adm-alice@example.com');
      assert.ok(byId.get('adm_alice')?.lastSeenAt);
    } finally {
      await client.end();
    }
  });

  test('sorts by last seen (never-seen last) and by games played', async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await seedRoster(client, new Date());
      const seen = await listAdminAccounts({ sort: 'seen', search: null, limit: 200, offset: 0 });
      assert.deepEqual(
        seen.accounts.map((p) => p.id),
        ['adm_alice', 'adm_bob', 'adm_carol'],
      );
      const games = await listAdminAccounts({ sort: 'games', search: null, limit: 200, offset: 0 });
      assert.deepEqual(
        games.accounts.map((p) => p.id),
        ['adm_alice', 'adm_carol', 'adm_bob'],
      );
      // The reverse of each column: never-seen accounts stay last either way,
      // oldest signup first, fewest games first, and names A to Z / Z to A.
      const ids = async (sort: Parameters<typeof listAdminAccounts>[0]['sort']) =>
        (await listAdminAccounts({ sort, search: null, limit: 200, offset: 0 })).accounts.map(
          (p) => p.id,
        );
      assert.deepEqual(await ids('seen-asc'), ['adm_alice', 'adm_carol', 'adm_bob']);
      assert.deepEqual(await ids('oldest'), ['adm_carol', 'adm_bob', 'adm_alice']);
      assert.deepEqual(await ids('games-asc'), ['adm_bob', 'adm_carol', 'adm_alice']);
      assert.deepEqual(await ids('name'), ['adm_alice', 'adm_bob', 'adm_carol']);
      assert.deepEqual(await ids('name-desc'), ['adm_carol', 'adm_bob', 'adm_alice']);
    } finally {
      await client.end();
    }
  });

  test('search matches handle, display name, or email case-insensitively, with literal wildcards', async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await seedRoster(client, new Date());
      const byHandle = await listAdminAccounts({
        sort: 'newest',
        search: 'ADM_BO',
        limit: 200,
        offset: 0,
      });
      assert.deepEqual(
        byHandle.accounts.map((p) => p.id),
        ['adm_bob'],
      );
      assert.equal(byHandle.total, 1);
      // Whole-roster figures do not narrow with the search.
      assert.equal(byHandle.summary.accounts, 3);

      const byName = await listAdminAccounts({
        sort: 'newest',
        search: 'quiet',
        limit: 200,
        offset: 0,
      });
      assert.deepEqual(
        byName.accounts.map((p) => p.id),
        ['adm_carol'],
      );

      const byEmail = await listAdminAccounts({
        sort: 'newest',
        search: 'alice@',
        limit: 200,
        offset: 0,
      });
      assert.deepEqual(
        byEmail.accounts.map((p) => p.id),
        ['adm_alice'],
      );

      // % and _ are text to search for, not SQL wildcards: '%' matches nobody,
      // and '_a' matches the handles that literally contain "_a" (adm_alice
      // only), not every handle with a character before an "a".
      const percent = await listAdminAccounts({
        sort: 'newest',
        search: '%',
        limit: 200,
        offset: 0,
      });
      assert.deepEqual(percent.accounts, []);
      assert.equal(percent.total, 0);
      const underscore = await listAdminAccounts({
        sort: 'newest',
        search: '_a',
        limit: 200,
        offset: 0,
      });
      assert.deepEqual(
        underscore.accounts.map((p) => p.id),
        ['adm_alice'],
      );
    } finally {
      await client.end();
    }
  });

  test('pages with limit and offset while total stays the full match count', async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await seedRoster(client, new Date());
      const page = await listAdminAccounts({ sort: 'newest', search: null, limit: 2, offset: 1 });
      assert.deepEqual(
        page.accounts.map((p) => p.id),
        ['adm_bob', 'adm_carol'],
      );
      assert.equal(page.total, 3);
    } finally {
      await client.end();
    }
  });
});
