import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type AccountSession,
  blockUser,
  countFollowing,
  createAccountSession,
  createUser,
  followUser,
  getUserByAccountSession,
  hasBlock,
  listFollowers,
  listFollowingIds,
  listRelations,
  recordGameEnd,
  unblockUser,
  unfollowUser,
  viewerRelationForHandle,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  sha256,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { clearPresence, type PresenceVisibility, touchPresence } from './presence.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle as tryHandleRelationsRoute } from './routes/relations.js';

type ResponseCapture = {
  body: string;
  headers: Record<string, string | string[]>;
  status: number | null;
};

definePersistenceTests('relations', () => {
  test('follow creates a directed edge with self-only lists and counts', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_ana', 'ana', now);
    await makeUser('rel_user_bo', 'bo', now);

    const followed = await followUser({ actorId: 'rel_user_ana', targetHandle: 'bo', now });
    assert.equal(followed.ok, true);
    // Idempotent: a second follow neither errors nor duplicates.
    const again = await followUser({ actorId: 'rel_user_ana', targetHandle: 'BO', now });
    assert.equal(again.ok, true);

    assert.equal(await countFollowing('rel_user_ana'), 1);
    assert.equal(await countFollowing('rel_user_bo'), 0);

    const following = await listRelations('rel_user_ana', 'follow', 0, 30);
    assert.equal(following.total, 1);
    assert.equal(following.entries[0]?.handle, 'bo');

    const anaView = await viewerRelationForHandle('rel_user_ana', 'bo');
    assert.deepEqual(anaView, { following: true, blocked: false, blockedBy: false });
    // Follow is one-directional and invisible to the target: bo sees no edge.
    const boView = await viewerRelationForHandle('rel_user_bo', 'ana');
    assert.deepEqual(boView, { following: false, blocked: false, blockedBy: false });
  });

  test('unknown handles and self-relations are rejected', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_solo', 'solo', now);

    const unknown = await followUser({ actorId: 'rel_user_solo', targetHandle: 'ghost', now });
    assert.deepEqual(unknown, { ok: false, error: 'unknown_user' });
    const self = await followUser({ actorId: 'rel_user_solo', targetHandle: 'solo', now });
    assert.deepEqual(self, { ok: false, error: 'self_relation' });
  });

  test('block overwrites follow and severs the reverse follow', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_cara', 'cara', now);
    await makeUser('rel_user_dan', 'dan', now);

    // Mutual follows first.
    assert.equal(
      (await followUser({ actorId: 'rel_user_cara', targetHandle: 'dan', now })).ok,
      true,
    );
    assert.equal(
      (await followUser({ actorId: 'rel_user_dan', targetHandle: 'cara', now })).ok,
      true,
    );

    // Cara blocks Dan: her follow flips to block, his follow of her is deleted.
    assert.equal(
      (await blockUser({ actorId: 'rel_user_cara', targetHandle: 'dan', now })).ok,
      true,
    );
    assert.equal(await countFollowing('rel_user_cara'), 0);
    assert.equal(await countFollowing('rel_user_dan'), 0);
    assert.equal(await hasBlock('rel_user_cara', 'rel_user_dan'), true);
    assert.equal(await hasBlock('rel_user_dan', 'rel_user_cara'), false);

    const caraView = await viewerRelationForHandle('rel_user_cara', 'dan');
    assert.deepEqual(caraView, { following: false, blocked: true, blockedBy: false });
    const danView = await viewerRelationForHandle('rel_user_dan', 'cara');
    assert.deepEqual(danView, { following: false, blocked: false, blockedBy: true });
  });

  test('following someone who blocked you silently no-ops', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_eve', 'eve', now);
    await makeUser('rel_user_finn', 'finn', now);

    assert.equal(
      (await blockUser({ actorId: 'rel_user_finn', targetHandle: 'eve', now })).ok,
      true,
    );

    // Eve's follow reports ok (so she can't probe who blocked her) but writes
    // no edge.
    const result = await followUser({ actorId: 'rel_user_eve', targetHandle: 'finn', now });
    assert.equal(result.ok, true);
    assert.equal(await countFollowing('rel_user_eve'), 0);

    // After Finn unblocks, the same follow lands.
    assert.equal((await unblockUser({ actorId: 'rel_user_finn', targetHandle: 'eve' })).ok, true);
    assert.equal(
      (await followUser({ actorId: 'rel_user_eve', targetHandle: 'finn', now })).ok,
      true,
    );
    assert.equal(await countFollowing('rel_user_eve'), 1);
  });

  test('unfollow and unblock delete only the matching relation', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_gil', 'gil', now);
    await makeUser('rel_user_hana', 'hana', now);

    assert.equal(
      (await followUser({ actorId: 'rel_user_gil', targetHandle: 'hana', now })).ok,
      true,
    );
    // Unblock is a no-op against a follow edge.
    assert.equal((await unblockUser({ actorId: 'rel_user_gil', targetHandle: 'hana' })).ok, true);
    assert.equal(await countFollowing('rel_user_gil'), 1);

    assert.equal((await unfollowUser({ actorId: 'rel_user_gil', targetHandle: 'hana' })).ok, true);
    assert.equal(await countFollowing('rel_user_gil'), 0);
  });

  test('listFollowingIds returns the follow targets only', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_nia', 'nia', now);
    await makeUser('rel_user_omar', 'omar', now);
    await makeUser('rel_user_pia', 'pia', now);

    assert.equal(
      (await followUser({ actorId: 'rel_user_nia', targetHandle: 'omar', now })).ok,
      true,
    );
    assert.equal((await blockUser({ actorId: 'rel_user_nia', targetHandle: 'pia', now })).ok, true);

    const ids = await listFollowingIds('rel_user_nia');
    assert.deepEqual(ids, ['rel_user_omar']);
    assert.deepEqual(await listFollowingIds('rel_user_omar'), []);
  });

  test('the follow cap refuses new follows', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_ida', 'ida', now);
    await makeUser('rel_user_jo', 'jo', now);
    await makeUser('rel_user_kim', 'kim', now);

    assert.equal(
      (await followUser({ actorId: 'rel_user_ida', targetHandle: 'jo', now, followCap: 1 })).ok,
      true,
    );
    const capped = await followUser({
      actorId: 'rel_user_ida',
      targetHandle: 'kim',
      now,
      followCap: 1,
    });
    assert.deepEqual(capped, { ok: false, error: 'follow_limit_reached' });
  });

  test('relation routes require an account session', async () => {
    const followResponse = captureResponse();
    const handled = await tryHandleRelationsRoute(
      {} as unknown as HttpApiContext,
      { method: 'POST', headers: {} } as unknown as IncomingMessage,
      followResponse,
      '/api/users/somebody/follow',
      new URL('http://localhost/api/users/somebody/follow'),
    );
    assert.equal(handled, true);
    assert.equal(followResponse.status, 401);
    assert.equal(JSON.parse(followResponse.body).error, 'not_signed_in');

    const listResponse = captureResponse();
    const listHandled = await tryHandleRelationsRoute(
      {} as unknown as HttpApiContext,
      { method: 'GET', headers: {} } as unknown as IncomingMessage,
      listResponse,
      '/api/relations/following',
      new URL('http://localhost/api/relations/following'),
    );
    assert.equal(listHandled, true);
    assert.equal(listResponse.status, 401);

    const badMethod = captureResponse();
    const badMethodHandled = await tryHandleRelationsRoute(
      {} as unknown as HttpApiContext,
      { method: 'PUT', headers: {} } as unknown as IncomingMessage,
      badMethod,
      '/api/users/somebody/follow',
      new URL('http://localhost/api/users/somebody/follow'),
    );
    assert.equal(badMethodHandled, true);
    assert.equal(badMethod.status, 405);
  });

  test('online-following returns enriched rows and hides private followed profiles', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_viewer', 'viewer', now);
    await makeUser('rel_user_alice', 'alice', now);
    await makeUser('rel_user_bob', 'bob', now);
    await makeUser('rel_user_carol', 'carol', now);

    // The viewer follows alice (public, playing) and bob (private). carol is
    // online and public but unfollowed, so she must not leak in.
    assert.equal(
      (await followUser({ actorId: 'rel_user_viewer', targetHandle: 'alice', now })).ok,
      true,
    );
    assert.equal(
      (await followUser({ actorId: 'rel_user_viewer', targetHandle: 'bob', now })).ok,
      true,
    );

    const cookie = await makeSessionCookie('rel_user_viewer');
    clearPresence();
    presence('rel_user_alice', 'alice', 'public');
    presence('rel_user_bob', 'bob', 'private');
    presence('rel_user_carol', 'carol', 'public');

    // alice holds a color seat in a playing legacy room, so `playing` is true.
    const ctx = playingRoomContext('rel_user_alice');
    const response = captureResponse();
    const handled = await tryHandleRelationsRoute(
      ctx,
      { method: 'GET', headers: { cookie } } as unknown as IncomingMessage,
      response,
      '/api/relations/online-following',
      new URL('http://localhost/api/relations/online-following'),
    );
    assert.equal(handled, true);
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body as string) as {
      players: Array<{ handle: string; displayName: string; rating: unknown; playing: boolean }>;
      count: number;
    };
    // Only alice: bob is private, carol is unfollowed, the viewer never self-lists.
    assert.deepEqual(
      body.players.map((p) => p.handle),
      ['alice'],
    );
    assert.equal(body.count, 1);
    const alice = body.players[0]!;
    assert.equal(alice.playing, true, 'seated in a playing room');
    // Rating is decoration; with no rated games it resolves to null but the
    // field is always present in the enriched shape.
    assert.ok('rating' in alice);
    assert.equal(alice.rating, null);
  });

  test('following list is enriched with best rating, games total, and last seen', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_fviewer', 'fviewer', now);
    await makeUser('rel_user_falice', 'falice', now);
    await makeUser('rel_user_fbob', 'fbob', now);

    assert.equal(
      (await followUser({ actorId: 'rel_user_fviewer', targetHandle: 'falice', now })).ok,
      true,
    );
    assert.equal(
      (await followUser({ actorId: 'rel_user_fviewer', targetHandle: 'fbob', now })).ok,
      true,
    );

    // falice's best rating lives in the BULLET pool (1650 > her blitz 1500),
    // proving the enrichment spans time classes, unlike getBestRatings (blitz
    // only). fbob's single settled-count-2 row has RD 300 → provisional.
    await runSql(
      `INSERT INTO user_ratings (user_id, variant, time_class, elo_rating, rating_deviation, volatility, games_played)
       VALUES
        ('rel_user_falice','fog','blitz',1500,60,0.06,12),
        ('rel_user_falice','fog','bullet',1650,60,0.06,4),
        ('rel_user_fbob','fog','blitz',1900,300,0.06,2)`,
    );

    // One public completed game for falice plus one PRIVATE one, which must not
    // count: the Friends page shows what the viewer would see on her profile.
    await recordGameEnd('rel-follow-game-public', gameSummary('rel_user_falice', now, 'public'));
    await recordGameEnd('rel-follow-game-private', gameSummary('rel_user_falice', now, 'private'));

    const aliceSeen = new Date('2026-07-09T12:00:00Z');
    await runSql(`UPDATE users SET last_seen_at = $1 WHERE id = 'rel_user_falice'`, [aliceSeen]);

    const cookie = await makeSessionCookie('rel_user_fviewer');
    const response = captureResponse();
    const handled = await tryHandleRelationsRoute(
      {} as unknown as HttpApiContext,
      { method: 'GET', headers: { cookie } } as unknown as IncomingMessage,
      response,
      '/api/relations/following',
      new URL('http://localhost/api/relations/following'),
    );
    assert.equal(handled, true);
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body) as {
      entries: Array<{
        handle: string;
        displayName: string;
        createdAt: string;
        bestRating: { variant: string; eloRating: number; provisional: boolean } | null;
        gamesTotal: number;
        lastSeenAt: string | null;
      }>;
      total: number;
    };
    assert.equal(body.total, 2);
    // Same created_at → handle ASC tie-break.
    assert.deepEqual(
      body.entries.map((entry) => entry.handle),
      ['falice', 'fbob'],
    );
    const [alice2, bob] = body.entries;
    assert.equal(alice2!.createdAt, now.toISOString(), 'pre-enrichment field survives');
    assert.deepEqual(alice2!.bestRating, { variant: 'fog', eloRating: 1650, provisional: false });
    assert.equal(alice2!.gamesTotal, 1, 'private game excluded');
    assert.equal(alice2!.lastSeenAt, aliceSeen.toISOString());
    assert.deepEqual(bob!.bestRating, { variant: 'fog', eloRating: 1900, provisional: true });
    assert.equal(bob!.gamesTotal, 0);
    assert.equal(bob!.lastSeenAt, null, 'no recorded activity renders as null, not an error');
  });

  test('followers list is self-only, newest first, and leaves out blocked and closed followers', async () => {
    const t0 = new Date('2026-07-01T00:00:00Z');
    const at = (hours: number) => new Date(t0.getTime() + hours * 60 * 60 * 1000);
    for (const [id, handle] of [
      ['rel_fl_owner', 'flowner'],
      ['rel_fl_old', 'flold'],
      ['rel_fl_new', 'flnew'],
      ['rel_fl_priv', 'flpriv'],
      ['rel_fl_blocked', 'flblocked'],
      ['rel_fl_closed', 'flclosed'],
      ['rel_fl_other', 'flother'],
    ] as const) {
      await makeUser(id, handle, t0);
    }
    const follow = async (actorId: string, targetHandle: string, now: Date) =>
      assert.equal((await followUser({ actorId, targetHandle, now })).ok, true);
    await follow('rel_fl_old', 'flowner', at(0));
    await follow('rel_fl_priv', 'flowner', at(1));
    await follow('rel_fl_new', 'flowner', at(2));
    await follow('rel_fl_blocked', 'flowner', at(3));
    await follow('rel_fl_closed', 'flowner', at(4));
    // Edges that are not follows OF the owner must stay out of the owner's list:
    // the owner's own follow, and someone else's follower.
    await follow('rel_fl_owner', 'flother', at(0));
    await follow('rel_fl_old', 'flother', at(5));

    await runSql(`UPDATE users SET profile_visibility = 'private' WHERE id = 'rel_fl_priv'`);
    // blockUser severs the reverse follow, so a blocked follower cannot arise
    // through the API today. Write the legacy shape (both edges present)
    // directly: the list must still hide them.
    await runSql(
      `INSERT INTO user_relations (actor_id, target_id, relation, created_at)
       VALUES ('rel_fl_owner', 'rel_fl_blocked', 'block', $1)`,
      [at(6)],
    );
    // Closure deletes relations; a stale row for a closed account stays hidden.
    await runSql(`UPDATE users SET closed_at = $1 WHERE id = 'rel_fl_closed'`, [at(7)]);

    const page = await listFollowers('rel_fl_owner', 0, 30);
    assert.equal(page.total, 3);
    assert.deepEqual(
      page.entries.map((entry) => [entry.handle, entry.displayName]),
      [
        ['flnew', 'flnew'],
        // Private profile: named, but the handle is withheld so it never links.
        [null, 'flpriv'],
        ['flold', 'flold'],
      ],
    );
    const second = await listFollowers('rel_fl_owner', 1, 1);
    assert.equal(second.total, 3);
    assert.deepEqual(
      second.entries.map((entry) => entry.displayName),
      ['flpriv'],
    );

    const fetchFollowers = async (cookie: string | null, query = '') => {
      const response = captureResponse();
      const handled = await tryHandleRelationsRoute(
        {} as unknown as HttpApiContext,
        { method: 'GET', headers: cookie ? { cookie } : {} } as unknown as IncomingMessage,
        response,
        '/api/relations/followers',
        new URL(`http://localhost/api/relations/followers${query}`),
      );
      assert.equal(handled, true);
      return response;
    };

    const anonymous = await fetchFollowers(null);
    assert.equal(anonymous.status, 401);

    const owner = await fetchFollowers(await makeSessionCookie('rel_fl_owner'));
    assert.equal(owner.status, 200);
    const ownerBody = JSON.parse(owner.body) as {
      entries: Array<{ handle: string | null; displayName: string; createdAt: string }>;
      total: number;
    };
    assert.equal(ownerBody.total, 3);
    assert.deepEqual(
      ownerBody.entries.map((entry) => entry.handle),
      ['flnew', null, 'flold'],
    );
    assert.equal(ownerBody.entries[0]?.createdAt, at(2).toISOString());
    assert.ok(!owner.body.includes('rel_fl_'), 'user ids never reach the client');

    // Another account cannot read the owner's followers, even by naming them:
    // the endpoint has no handle parameter and answers for the session only.
    const other = await fetchFollowers(await makeSessionCookie('rel_fl_other'), '?handle=flowner');
    assert.equal(other.status, 200);
    const otherBody = JSON.parse(other.body) as {
      entries: Array<{ handle: string | null }>;
      total: number;
    };
    assert.deepEqual(
      otherBody.entries.map((entry) => entry.handle),
      ['flold', 'flowner'],
    );
    assert.equal(otherBody.total, 2);
  });

  test('session validation bumps users.last_seen_at with a five-minute throttle', async () => {
    const t0 = new Date('2026-07-01T00:00:00Z');
    await makeUser('rel_user_seen', 'seen', t0);
    const session: AccountSession = {
      id: 'sess_rel_user_seen',
      userId: 'rel_user_seen',
      tokenHash: sha256('tok_rel_user_seen'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    await createAccountSession(session);

    const lastSeen = async (): Promise<Date | null> => {
      const rows = await runSql<{ last_seen_at: Date | null }>(
        `SELECT last_seen_at FROM users WHERE id = 'rel_user_seen'`,
      );
      return rows[0]?.last_seen_at ?? null;
    };

    assert.ok(await getUserByAccountSession(session.id, session.tokenHash, t0));
    assert.equal((await lastSeen())?.toISOString(), t0.toISOString());

    // Two minutes later: the session row is touched but the durable user-row
    // bump is throttled, so last_seen_at stays put (no per-request writes).
    const t1 = new Date(t0.getTime() + 2 * 60 * 1000);
    assert.ok(await getUserByAccountSession(session.id, session.tokenHash, t1));
    assert.equal((await lastSeen())?.toISOString(), t0.toISOString());
    const sessionRows = await runSql<{ last_seen_at: Date }>(
      `SELECT last_seen_at FROM account_sessions WHERE id = $1`,
      [session.id],
    );
    assert.equal(sessionRows[0]?.last_seen_at.toISOString(), t1.toISOString());

    // Past the throttle window, the bump lands.
    const t2 = new Date(t0.getTime() + 6 * 60 * 1000);
    assert.ok(await getUserByAccountSession(session.id, session.tokenHash, t2));
    assert.equal((await lastSeen())?.toISOString(), t2.toISOString());
  });
});

async function makeSessionCookie(userId: string): Promise<string> {
  const sessionId = `sess_${userId}`;
  const token = `tok_${userId}`;
  // currentAccountUser validates expiry against the real wall clock, so the
  // session must outlive `new Date()` regardless of any fixed test date.
  const session: AccountSession = {
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  await createAccountSession(session);
  return `mistboard_session=${sessionId}.${token}`;
}

function presence(id: string, handle: string, profileVisibility: PresenceVisibility): void {
  touchPresence({ id, handle, displayName: handle, profileVisibility });
}

// Minimal HttpApiContext with one playing legacy room seating `seatUserId`, so
// collectLiveRoomStats reports that user as playing. No tenants are registered
// in this test file, so the tenant walk is a no-op.
function playingRoomContext(seatUserId: string): HttpApiContext {
  const room = {
    mode: 'pvp',
    projection: { state: { status: { type: 'playing' } } },
    clients: new Set([{ id: 'client-1', userId: seatUserId, seat: 'white' }]),
  };
  return { rooms: new Map([['room-1', room]]) } as unknown as HttpApiContext;
}

async function makeUser(id: string, handle: string, now: Date): Promise<void> {
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: now,
    handle,
    displayName: handle,
    now,
  });
}

// Direct SQL escape hatch for fixture rows (ratings) and column reads that have
// no persistence-layer writer, mirroring persistence-ratings.test.ts.
async function runSql<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(sql, params);
    return rows as T[];
  } finally {
    await client.end();
  }
}

// Minimal completed pvp game seating `userId` as white vs a guest, with the
// game + participant rows at `visibility`.
function gameSummary(
  userId: string,
  now: Date,
  visibility: 'public' | 'private',
): Parameters<typeof recordGameEnd>[1] {
  return {
    variant: 'dark-chess',
    mode: 'pvp',
    result: 'white-wins',
    termination: 'king-captured',
    plyCount: 9,
    startedAt: now,
    endedAt: new Date(now.getTime() + 60_000),
    whiteClient: 'browser-a',
    blackClient: 'browser-b',
    whiteName: null,
    blackName: null,
    corpusId: null,
    visibility,
    participants: [
      {
        color: 'white',
        displayName: 'Player',
        subjectType: 'user',
        subjectId: userId,
        visibility,
      },
      {
        color: 'black',
        displayName: 'Guest',
        subjectType: 'guest',
        subjectId: null,
        visibility,
      },
    ],
  };
}

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string | string[]>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}
