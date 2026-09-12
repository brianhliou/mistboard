import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import pg from 'pg';
import { accountSessionCookie, hashSecret } from '../src/account-session.js';
import { createAccountSession, createUser } from '../src/persistence.js';
import { connectClient, startTestServer, type TestServer } from './harness.js';

// End-to-end proof of the rated write path the persistence tests can't reach:
// two SIGNED-IN accounts go through the real lobby (rated gate requires login +
// the flag), get matched into a rated room, claim account-bound seats over an
// authenticated WS, play to a result, and both Glicko ratings move in Postgres.
// This is the "log into two accounts and play a rated game" flow, automated.

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  test('rated-game (skipped — set TEST_DATABASE_URL to enable)', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = testDbUrl;
  process.env.MISTBOARD_RATED_ENABLED = 'true'; // read at call time by feature-flags

  let serverInstance: TestServer;
  let db: pg.Client;

  before(async () => {
    serverInstance = await startTestServer();
    db = new pg.Client({ connectionString: testDbUrl });
    await db.connect();
  });

  after(async () => {
    await db.end();
    await serverInstance.close();
    delete process.env.DATABASE_URL;
    delete process.env.MISTBOARD_RATED_ENABLED;
  });

  // Create a user + an account session, returning the cookie the harness sends
  // on HTTP + WS so the server treats the connection as that signed-in account.
  async function signedInAccount(handle: string): Promise<{ userId: string; cookie: string }> {
    const userId = `user_${randomUUID()}`;
    const now = new Date();
    await createUser({
      id: userId,
      email: `${handle}@example.com`,
      emailVerifiedAt: now,
      handle,
      displayName: handle,
      profileVisibility: 'public',
      now,
    });
    const sessionId = `sess_${randomUUID()}`;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await createAccountSession({ id: sessionId, userId, tokenHash: hashSecret(token), expiresAt });
    return { userId, cookie: accountSessionCookie(sessionId, token, expiresAt) };
  }

  function httpBase(): string {
    return serverInstance.url.replace(/^ws/, 'http');
  }

  // Every official live pace is rated, each into its own ladder.
  const RATED_PACES = [
    { label: '1+1', timeControl: { initialMs: 60_000, incrementMs: 1_000 }, timeClass: 'bullet' },
    { label: '3+2', timeControl: { initialMs: 180_000, incrementMs: 2_000 }, timeClass: 'blitz' },
    { label: '5+5', timeControl: { initialMs: 300_000, incrementMs: 5_000 }, timeClass: 'rapid' },
  ] as const;

  async function joinRatedLobby(
    cookie: string,
    timeControl: { initialMs: number; incrementMs: number },
  ): Promise<{ status: string; roomId?: string }> {
    const resp = await fetch(`${httpBase()}/api/lobby`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ rated: true, timeControl }),
    });
    return (await resp.json()) as { status: string; roomId?: string };
  }

  for (const pace of RATED_PACES) {
    test(`signed-in lobby match plays a rated ${pace.label} game into the ${pace.timeClass} ladder`, async () => {
      await playRatedGame(pace);
    });
  }

  async function playRatedGame(pace: (typeof RATED_PACES)[number]): Promise<void> {
    const alice = await signedInAccount(`alice${Date.now().toString(36)}`);
    const bob = await signedInAccount(`bob${Date.now().toString(36)}`);

    // Real lobby flow: alice queues rated (waiting), bob queues rated (matched).
    const first = await joinRatedLobby(alice.cookie, pace.timeControl);
    assert.equal(first.status, 'waiting', 'first rated ticket waits');
    const second = await joinRatedLobby(bob.cookie, pace.timeControl);
    assert.equal(second.status, 'matched', 'second rated ticket matches');
    const roomId = second.roomId!;
    assert.ok(roomId, 'match returned a room');

    // Both connect to the matched room as their signed-in accounts.
    const a = await connectClient({ url: serverInstance.url, room: roomId, cookie: alice.cookie });
    const b = await connectClient({ url: serverInstance.url, room: roomId, cookie: bob.cookie });

    const bothSeated = (m: unknown) => {
      const seats = (m as { seats?: { white?: string; black?: string } }).seats;
      return !!seats?.white && !!seats?.black;
    };
    await Promise.all([a.waitFor(bothSeated), b.waitFor(bothSeated)]);

    const white = a.seat === 'white' ? a : b;
    const black = a.seat === 'black' ? a : b;

    // Resign is valid only from move 2, so both play a first move, then white resigns.
    const turnIs = (color: string) => (m: unknown) => {
      const s = (m as { state?: { status?: { type: string; turn?: string } } }).state?.status;
      return s?.type === 'playing' && s.turn === color;
    };
    const atMove2 = (m: unknown) =>
      ((m as { state?: { moveNumber?: number } }).state?.moveNumber ?? 0) >= 2;
    white.send({ type: 'move', from: 'e2', to: 'e4' });
    await black.waitFor(turnIs('black'));
    black.send({ type: 'move', from: 'e7', to: 'e5' });
    await Promise.all([white.waitFor(atMove2), black.waitFor(atMove2)]);
    white.send({ type: 'resign' });

    const finished = (m: unknown) =>
      (m as { state?: { status?: { type: string } } }).state?.status?.type === 'finished';
    await Promise.all([a.waitFor(finished), b.waitFor(finished)]);

    // The decisive proof: both accounts have a rating row that moved off 1500,
    // in the ladder for THIS pace. (Ratings only write for account-bound user
    // seats, so rows existing proves the seats bound to accounts and the game
    // recorded rated.)
    const { rows } = await db.query<{
      user_id: string;
      time_class: string;
      elo_rating: number;
      games_played: number;
    }>(
      `SELECT user_id, time_class, elo_rating, games_played FROM user_ratings
       WHERE user_id = ANY($1) AND variant = 'fog'`,
      [[alice.userId, bob.userId]],
    );
    assert.equal(rows.length, 2, 'both signed-in players got a rating row');
    for (const row of rows) {
      assert.equal(
        row.time_class,
        pace.timeClass,
        `${row.user_id} rated in the ${pace.label} pool`,
      );
      assert.equal(row.games_played, 1, `${row.user_id} played 1 rated game`);
      assert.notEqual(row.elo_rating, 1500, `${row.user_id} rating moved off the 1500 base`);
    }

    // And the game itself recorded rated.
    const { rows: gameRows } = await db.query<{ rated: boolean }>(
      `SELECT rated FROM games WHERE room_id = $1`,
      [roomId],
    );
    assert.equal(gameRows[0]?.rated, true, 'game recorded as rated');

    await a.disconnect();
    await b.disconnect();
  }
}
