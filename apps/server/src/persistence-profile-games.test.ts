// The profile Games list's result and opponent filters: the owner's seat
// decides the result, and a private account is never matchable.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createUser, getUserGamesPage } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { tryHandle as tryHandleUsers } from './routes/users.js';

const NOW = new Date('2026-09-01T00:00:00Z');

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, params);
  } finally {
    await client.end();
  }
}

async function seedUsers(): Promise<void> {
  for (const [id, handle, visibility] of [
    ['u_alice', 'alice', 'public'],
    ['u_bob', 'bob', 'public'],
    ['u_carol', 'carol', 'private'],
  ] as const) {
    await createUser({
      id,
      email: `${handle}@example.com`,
      emailVerifiedAt: NOW,
      handle,
      displayName: handle,
      profileVisibility: visibility,
      now: NOW,
    });
  }
}

type Seat = {
  color: string;
  subjectType: 'user' | 'guest';
  subjectId: string;
  visibility?: string;
};

// A list row only: the Games list reads games + game_participants.
async function seedRow(
  roomId: string,
  variant: string,
  result: string,
  endedAt: string,
  seats: Seat[],
  visibility = 'public',
): Promise<void> {
  await sql(
    `INSERT INTO games (room_id, variant, result, termination, ply_count, started_at, ended_at,
       mode, status, visibility)
     VALUES ($1, $2, $3, 'resignation', 30, $4::timestamptz - interval '10 minutes', $4, 'pvp',
       'completed', $5)`,
    [roomId, variant, result, endedAt, visibility],
  );
  for (const seat of seats) {
    await sql(
      `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name, visibility)
       VALUES ($1, $2, $3, $4, $4, $5)`,
      [roomId, seat.color, seat.subjectType, seat.subjectId, seat.visibility ?? 'public'],
    );
  }
}

const alice = (color: string, visibility = 'public'): Seat => ({
  color,
  subjectType: 'user',
  subjectId: 'u_alice',
  visibility,
});
const user = (id: string, color: string): Seat => ({ color, subjectType: 'user', subjectId: id });
const guest = (color: string): Seat => ({ color, subjectType: 'guest', subjectId: `g-${color}` });

async function seedList(): Promise<void> {
  await seedUsers();
  await seedRow('pg_win_bob', 'xiangqi', 'red-wins', '2026-08-01T10:00:00Z', [
    alice('red'),
    user('u_bob', 'black'),
  ]);
  await seedRow('pg_loss_bob', 'xiangqi', 'red-wins', '2026-08-02T10:00:00Z', [
    user('u_bob', 'red'),
    alice('black'),
  ]);
  await seedRow('pg_draw', 'jungle', 'draw', '2026-08-03T10:00:00Z', [
    alice('red'),
    guest('black'),
  ]);
  await seedRow('pg_win_carol', 'dark-chess', 'white-wins', '2026-08-04T10:00:00Z', [
    alice('white'),
    user('u_carol', 'black'),
  ]);
  // Alice marked her seat private: hers to see, nobody else's.
  await seedRow('pg_win_private', 'xiangqi', 'black-wins', '2026-08-05T10:00:00Z', [
    guest('red'),
    alice('black', 'private'),
  ]);
}

const ids = (page: { games: { roomId: string }[] } | null) =>
  (page?.games ?? []).map((game) => game.roomId).sort();

type Captured = { status: number; headers: Record<string, string>; body: Buffer };

function fakeRequest(pathname: string): IncomingMessage {
  return {
    method: 'GET',
    url: pathname,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

definePersistenceTests('profile games filters', () => {
  test('the result filter reads the owner seat, as the row paints it', async () => {
    await seedList();
    assert.deepEqual(ids(await getUserGamesPage('alice', null, 0, 50, { result: 'win' })), [
      'pg_win_bob',
      'pg_win_carol',
    ]);
    assert.deepEqual(ids(await getUserGamesPage('alice', null, 0, 50, { result: 'loss' })), [
      'pg_loss_bob',
    ]);
    assert.deepEqual(ids(await getUserGamesPage('alice', null, 0, 50, { result: 'draw' })), [
      'pg_draw',
    ]);
    // The owner also sees the game she marked private.
    const own = await getUserGamesPage('alice', 'u_alice', 0, 50, { result: 'win' });
    assert.deepEqual(ids(own), ['pg_win_bob', 'pg_win_carol', 'pg_win_private']);
    assert.equal(own?.total, 3, 'total is the filtered count');
  });

  test('the opponent filter matches a public handle in any case, never a private account', async () => {
    await seedList();
    assert.deepEqual(ids(await getUserGamesPage('alice', null, 0, 50, { opponent: 'BOB' })), [
      'pg_loss_bob',
      'pg_win_bob',
    ]);
    assert.deepEqual(
      ids(await getUserGamesPage('alice', null, 0, 50, { opponent: 'bob', result: 'win' })),
      ['pg_win_bob'],
    );
    // carol's profile is private: naming her matches nothing, so the filter
    // cannot be used to learn who she played.
    assert.deepEqual(ids(await getUserGamesPage('alice', null, 0, 50, { opponent: 'carol' })), []);
    // Nor does the owner's own handle.
    assert.deepEqual(ids(await getUserGamesPage('alice', null, 0, 50, { opponent: 'alice' })), []);
    // Filters combine with the pool.
    assert.deepEqual(
      ids(
        await getUserGamesPage('alice', null, 0, 50, { ratingVariant: 'xiangqi', result: 'loss' }),
      ),
      ['pg_loss_bob'],
    );
  });

  test('the games route takes result and vs, and rejects values that are not', async () => {
    await seedList();
    const call = async (query: string) => {
      const captured: Captured = { status: 0, headers: {}, body: Buffer.alloc(0) };
      const response = {
        writeHead(status: number) {
          captured.status = status;
          return this;
        },
        end(chunk?: string) {
          if (chunk) captured.body = Buffer.from(chunk);
        },
      } as unknown as ServerResponse;
      const pathname = '/api/users/alice/games';
      await tryHandleUsers(
        {},
        fakeRequest(`${pathname}?${query}`),
        response,
        pathname,
        new URL(`http://localhost${pathname}?${query}`),
      );
      return captured;
    };
    const ok = await call('result=draw&vs=');
    assert.equal(ok.status, 200);
    assert.deepEqual(
      (JSON.parse(ok.body.toString('utf8')) as { games: { roomId: string }[] }).games.map(
        (game) => game.roomId,
      ),
      ['pg_draw'],
    );
    assert.equal((await call('result=won')).status, 400);
    assert.equal((await call('vs=not%20a%20handle')).status, 400);
  });
});
