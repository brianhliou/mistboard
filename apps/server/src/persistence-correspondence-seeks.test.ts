import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { DAY_MS } from '@mistboard/game';
import {
  type AccountSession,
  CORRESPONDENCE_SEEK_TTL_MS,
  closeUserAccount,
  correspondenceStartRecipient,
  countOpenSeeksForUser,
  createAccountSession,
  createCorrespondenceSeek,
  createUser,
  deleteCorrespondenceSeek,
  deleteExpiredCorrespondenceSeeks,
  getCorrespondenceSeek,
  listChallengesForUser,
  listOpenCorrespondenceSeeks,
  listOutgoingSeeksForUser,
  updateUserAccountPreference,
  userExists,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { tryHandle as tryHandleSeekRoute } from './routes/correspondence-seeks.js';
import type { HttpApiContext } from './routes/lib.js';

definePersistenceTests('correspondence seeks', () => {
  const at = new Date('2026-06-13T12:00:00Z');
  const seedUser = (id: string, handle: string, displayName: string) =>
    createUser({
      id,
      email: `${id}@example.com`,
      emailVerifiedAt: at,
      handle,
      displayName,
      now: at,
    });

  // #353: before listOutgoingSeeksForUser, a private link challenge appeared in
  // NO listing its creator could reach. listOpenCorrespondenceSeeks is
  // `visibility = 'public' AND target_user_id IS NULL` and listChallengesForUser
  // matches on target_user_id, so a link the player sent was invisible to them,
  // uncancellable, and still held one of the six slots for its whole TTL.
  test("outgoing seeks include a creator's private link and directed challenges", async () => {
    const carol = await seedUser('out-carol', 'carol', 'Carol');
    const dave = await seedUser('out-dave', 'dave', 'Dave');
    const later = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await createCorrespondenceSeek({
      id: 'out-public',
      creatorUserId: carol.id,
      gameSpecId: 'xiangqi',
      daysPerMove: 3,
      preferredColor: 'random',
      targetUserId: null,
      visibility: 'public',
      expiresAt: null,
    });
    await createCorrespondenceSeek({
      id: 'out-link',
      creatorUserId: carol.id,
      gameSpecId: 'xiangqi',
      daysPerMove: 3,
      preferredColor: 'random',
      targetUserId: null,
      visibility: 'private',
      expiresAt: later,
    });
    await createCorrespondenceSeek({
      id: 'out-directed',
      creatorUserId: carol.id,
      gameSpecId: 'xiangqi',
      daysPerMove: 1,
      preferredColor: 'first',
      targetUserId: dave.id,
      visibility: 'private',
      expiresAt: later,
    });

    // The two listings that existed before could not see the link challenge.
    const board = await listOpenCorrespondenceSeeks();
    assert.equal(
      board.some((seek) => seek.id === 'out-link'),
      false,
      'the public board must never surface a private link',
    );
    assert.equal(
      (await listChallengesForUser(carol.id)).length,
      0,
      'her own challenges are not challenges TO her',
    );

    const mine = await listOutgoingSeeksForUser(carol.id);
    assert.deepEqual(
      mine.map((seek) => seek.id).sort(),
      ['out-directed', 'out-link', 'out-public'],
      'every standing invitation she created, whatever its visibility',
    );
    assert.equal(mine.find((seek) => seek.id === 'out-directed')?.targetName, 'Dave');
    assert.equal(mine.find((seek) => seek.id === 'out-link')?.targetName, null);
    // Someone else's invitations are not hers.
    assert.equal((await listOutgoingSeeksForUser(dave.id)).length, 0);

    // And the cancel path that was unreachable now has a row to act on.
    assert.equal(await deleteCorrespondenceSeek('out-link', carol.id), true);
    assert.equal((await listOutgoingSeeksForUser(carol.id)).length, 2);
  });

  // The cap must count exactly what the player can see and cancel, or an expired
  // row blocks a create with nothing on screen explaining why.
  test('the outstanding-invitation count ignores expired challenges', async () => {
    const erin = await seedUser('out-erin', 'erin', 'Erin');
    await createCorrespondenceSeek({
      id: 'out-expired',
      creatorUserId: erin.id,
      gameSpecId: 'xiangqi',
      daysPerMove: 3,
      preferredColor: 'random',
      targetUserId: null,
      visibility: 'private',
      expiresAt: new Date(Date.now() - 60_000),
    });
    assert.equal(await countOpenSeeksForUser(erin.id), 0);
    assert.equal((await listOutgoingSeeksForUser(erin.id)).length, 0);
  });

  test('create, count, list with creator name, get, and delete-wins-the-race', async () => {
    const alice = await seedUser('seek-alice', 'alice', 'Alice');
    const bob = await seedUser('seek-bob', 'bob', 'Bob');

    await createCorrespondenceSeek({
      id: 'seek-1',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 3,
      preferredColor: 'first',
      targetUserId: null,
      visibility: 'public',
      expiresAt: null,
    });
    await createCorrespondenceSeek({
      id: 'seek-2',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 1,
      preferredColor: 'random',
      targetUserId: null,
      visibility: 'public',
      expiresAt: null,
    });
    await createCorrespondenceSeek({
      id: 'seek-3',
      creatorUserId: bob.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 7,
      preferredColor: 'second',
      targetUserId: null,
      visibility: 'public',
      expiresAt: null,
    });

    assert.equal(await countOpenSeeksForUser(alice.id), 2);
    assert.equal(await countOpenSeeksForUser(bob.id), 1);

    const open = await listOpenCorrespondenceSeeks();
    assert.equal(open.length, 3);
    assert.equal(open[0]?.id, 'seek-3'); // newest first
    const aliceSeek = open.find((seek) => seek.id === 'seek-1');
    assert.equal(aliceSeek?.creatorName, 'Alice');
    // Round-trips the neutral move-order value the fixture inserted (migration 106).
    assert.equal(aliceSeek?.preferredColor, 'first');
    assert.equal(aliceSeek?.daysPerMove, 3);

    assert.equal((await getCorrespondenceSeek('seek-1'))?.creatorUserId, alice.id);
    assert.equal(await getCorrespondenceSeek('missing'), null);

    // First delete wins (true); a second delete of the same id loses (false) —
    // the guard the accept flow relies on when two players accept at once.
    assert.equal(await deleteCorrespondenceSeek('seek-1'), true);
    assert.equal(await deleteCorrespondenceSeek('seek-1'), false);
    assert.equal(await countOpenSeeksForUser(alice.id), 1);
  });

  test('owner-scoped cancel removes only the creator-owned seek', async () => {
    const alice = await seedUser('cancel-alice', 'calice', 'Alice');
    const bob = await seedUser('cancel-bob', 'cbob', 'Bob');
    await createCorrespondenceSeek({
      id: 'cseek',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 3,
      preferredColor: 'first',
      targetUserId: null,
      visibility: 'public',
      expiresAt: null,
    });

    // Bob cannot cancel Alice's seek; Alice can.
    assert.equal(await deleteCorrespondenceSeek('cseek', bob.id), false);
    assert.notEqual(await getCorrespondenceSeek('cseek'), null);
    assert.equal(await deleteCorrespondenceSeek('cseek', alice.id), true);
    assert.equal(await getCorrespondenceSeek('cseek'), null);
  });

  test('challenges: board hides directed + link seeks; incoming lists directed', async () => {
    const alice = await seedUser('ch-alice', 'chalice', 'Alice');
    const bob = await seedUser('ch-bob', 'chbob', 'Bob');

    // A plain public board seek.
    await createCorrespondenceSeek({
      id: 'ch-public',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 3,
      preferredColor: 'first',
      targetUserId: null,
      visibility: 'public',
      expiresAt: null,
    });
    // A link challenge (off-board, no target).
    await createCorrespondenceSeek({
      id: 'ch-link',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 3,
      preferredColor: 'random',
      targetUserId: null,
      visibility: 'private',
      expiresAt: null,
    });
    // A directed challenge to Bob.
    await createCorrespondenceSeek({
      id: 'ch-direct',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 1,
      preferredColor: 'second',
      targetUserId: bob.id,
      visibility: 'private',
      expiresAt: null,
    });

    // The public board shows only the public, untargeted seek.
    const board = await listOpenCorrespondenceSeeks();
    assert.deepEqual(
      board.map((s) => s.id),
      ['ch-public'],
    );

    // Bob's incoming challenges are the directed ones addressed to him.
    const incoming = await listChallengesForUser(bob.id);
    assert.deepEqual(
      incoming.map((s) => s.id),
      ['ch-direct'],
    );
    assert.equal(incoming[0]?.creatorName, 'Alice');
    assert.equal(incoming[0]?.visibility, 'private');
    assert.equal(await listChallengesForUser(alice.id).then((r) => r.length), 0);

    // getCorrespondenceSeek round-trips the new dimensions.
    const direct = await getCorrespondenceSeek('ch-direct');
    assert.equal(direct?.targetUserId, bob.id);
    assert.equal(direct?.visibility, 'private');
    const link = await getCorrespondenceSeek('ch-link');
    assert.equal(link?.targetUserId, null);
    assert.equal(link?.visibility, 'private');

    // The cap counts every outstanding invitation, board or challenge.
    assert.equal(await countOpenSeeksForUser(alice.id), 3);

    // userExists validates challenge targets.
    assert.equal(await userExists(bob.id), true);
    assert.equal(await userExists('nobody'), false);
  });

  test('expiry: lapsed challenges drop from incoming and get swept', async () => {
    const alice = await seedUser('exp-alice', 'expalice', 'Alice');
    const bob = await seedUser('exp-bob', 'expbob', 'Bob');
    // The list filter and the sweep compare against the DB's real clock, so the
    // fixtures are relative to real now — not the fixed `at` used elsewhere.
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 60_000);

    // A lapsed direct challenge, a still-live one, and a never-expiring board seek.
    await createCorrespondenceSeek({
      id: 'exp-lapsed',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 3,
      preferredColor: 'first',
      targetUserId: bob.id,
      visibility: 'private',
      expiresAt: past,
    });
    await createCorrespondenceSeek({
      id: 'exp-live',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 3,
      preferredColor: 'first',
      targetUserId: bob.id,
      visibility: 'private',
      expiresAt: future,
    });
    await createCorrespondenceSeek({
      id: 'exp-board',
      creatorUserId: alice.id,
      gameSpecId: 'dark-chess',
      daysPerMove: 3,
      preferredColor: 'first',
      targetUserId: null,
      visibility: 'public',
      expiresAt: null,
    });

    // Incoming hides the lapsed challenge, keeps the live one.
    const incoming = await listChallengesForUser(bob.id);
    assert.deepEqual(
      incoming.map((s) => s.id),
      ['exp-live'],
    );

    // The sweep removes only rows past their expiry — never the live challenge
    // or the never-expiring board seek. It reports the count removed.
    assert.equal(await deleteExpiredCorrespondenceSeeks(now), 1);
    assert.equal(await getCorrespondenceSeek('exp-lapsed'), null);
    assert.notEqual(await getCorrespondenceSeek('exp-live'), null);
    assert.notEqual(await getCorrespondenceSeek('exp-board'), null);
    // Idempotent: nothing left to reap.
    assert.equal(await deleteExpiredCorrespondenceSeeks(now), 0);
  });

  test('correspondenceStartRecipient honours the opt-out and skips closed accounts', async () => {
    const player = await seedUser('start-mail-player', 'startmail', 'Start Mail');

    // Never-touched preference: the key is absent from the JSON entirely, and
    // the query must read that as opted IN. This is the case every real
    // account is in until it visits the settings page, so a fail-closed
    // COALESCE here would silently mute the email for everybody.
    assert.equal((await correspondenceStartRecipient(player.id))?.email, player.email);

    await updateUserAccountPreference(player.id, 'correspondenceStartEmail', false, at);
    assert.equal(await correspondenceStartRecipient(player.id), null);

    // The two correspondence emails opt out independently.
    await updateUserAccountPreference(player.id, 'correspondenceStartEmail', true, at);
    await updateUserAccountPreference(player.id, 'correspondenceDeadlineEmail', false, at);
    assert.equal((await correspondenceStartRecipient(player.id))?.email, player.email);

    assert.equal(await correspondenceStartRecipient('nobody-at-all'), null);

    const quitter = await seedUser('start-mail-quitter', 'quitter', 'Quitter');
    await closeUserAccount(
      quitter.id,
      {
        closedEmailHash: 'hash-quitter',
        closedHandle: 'closed-quitter',
        placeholderEmail: 'closed-quitter@example.invalid',
      },
      at,
    );
    assert.equal(await correspondenceStartRecipient(quitter.id), null);
  });
  // Public board seeks used to stand forever: prod's board was two identical
  // month-old Fog Chess posts from one player, the main content of an otherwise
  // empty /games page. A board seek now lapses CORRESPONDENCE_SEEK_TTL_MS after
  // it was posted, judged from created_at at read time, so rows posted before
  // the rule existed lapse too without a migration.
  test('public board seeks lapse 14 days after posting, everywhere they are read', async () => {
    assert.equal(CORRESPONDENCE_SEEK_TTL_MS, 14 * DAY_MS);
    const fay = await seedUser('ttl-fay', 'ttlfay', 'Fay');
    for (const id of ['ttl-old', 'ttl-recent']) {
      await createCorrespondenceSeek({
        id,
        creatorUserId: fay.id,
        gameSpecId: 'dark-chess',
        daysPerMove: 7,
        preferredColor: 'random',
        targetUserId: null,
        visibility: 'public',
        expiresAt: null,
      });
    }
    await backdateSeek('ttl-old', 15);
    await backdateSeek('ttl-recent', 13);

    const board = (await listOpenCorrespondenceSeeks()).map((seek) => seek.id);
    assert.deepEqual(board, ['ttl-recent'], 'a 15-day-old board seek is off the board');
    assert.equal(await countOpenSeeksForUser(fay.id), 1, 'a lapsed seek holds no cap slot');
    assert.deepEqual(
      (await listOutgoingSeeksForUser(fay.id)).map((seek) => seek.id),
      ['ttl-recent'],
      "the creator's own list hides it too",
    );
    // The accept gate reads expiresAt: the effective expiry must be reported
    // even though the row's own expires_at column is NULL.
    const now = Date.now();
    const old = await getCorrespondenceSeek('ttl-old');
    assert.ok(old?.expiresAt && old.expiresAt.getTime() <= now, 'old seek reports a past expiry');
    const recent = await getCorrespondenceSeek('ttl-recent');
    assert.ok(
      recent?.expiresAt && recent.expiresAt.getTime() > now,
      'recent seek reports a future expiry',
    );
    // Housekeeping reaps it on the same rule.
    assert.equal(await deleteExpiredCorrespondenceSeeks(new Date()), 1);
    assert.equal(await getCorrespondenceSeek('ttl-old'), null);
    assert.notEqual(await getCorrespondenceSeek('ttl-recent'), null);
  });

  test('accepting a public seek past the TTL is refused; one inside it is not', async () => {
    await withCorrespondenceEnabled(async () => {
      const gus = await seedUser('ttl-gus', 'ttlgus', 'Gus');
      const hal = await seedUser('ttl-hal', 'ttlhal', 'Hal');
      for (const id of ['acc-old', 'acc-recent']) {
        await createCorrespondenceSeek({
          id,
          creatorUserId: gus.id,
          gameSpecId: 'dark-chess',
          daysPerMove: 7,
          preferredColor: 'random',
          targetUserId: null,
          visibility: 'public',
          expiresAt: null,
        });
      }
      await backdateSeek('acc-old', 15);
      await backdateSeek('acc-recent', 13);
      const cookie = await makeSessionCookie(hal.id);

      const old = await callSeekRoute('POST', '/api/correspondence/seeks/acc-old/accept', cookie);
      assert.equal(old.status, 410);
      assert.equal(old.json.error, 'challenge_expired');
      assert.notEqual(
        await getCorrespondenceSeek('acc-old'),
        null,
        'a refused accept consumes nothing',
      );

      const recent = await callSeekRoute(
        'POST',
        '/api/correspondence/seeks/acc-recent/accept',
        cookie,
      );
      // Past the expiry gate the accept consumes the row. No tenant is registered
      // in this file, so the seat step answers 501; the point is that it got there.
      assert.notEqual(recent.status, 410, 'a 13-day-old seek is still acceptable');
      assert.equal(await getCorrespondenceSeek('acc-recent'), null, 'the accept took the seek');
    });
  });

  test('re-posting an identical open public seek returns the existing one', async () => {
    await withCorrespondenceEnabled(async () => {
      const ivy = await seedUser('dup-ivy', 'dupivy', 'Ivy');
      const cookie = await makeSessionCookie(ivy.id);
      const body = { gameSpecId: 'dark-chess', daysPerMove: 7, preferredColor: 'random' };

      const first = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, body);
      assert.equal(first.status, 201);
      const firstId = (first.json.seek as { id: string }).id;

      const again = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, body);
      assert.equal(again.status, 200, 'no error to the player, and nothing new created');
      assert.equal((again.json.seek as { id: string }).id, firstId);
      assert.equal(await countOpenSeeksForUser(ivy.id), 1);

      // Any differing dimension is a different offer.
      const otherDays = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
        ...body,
        daysPerMove: 3,
      });
      assert.equal(otherDays.status, 201);
      const otherColor = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
        ...body,
        preferredColor: 'first',
      });
      assert.equal(otherColor.status, 201);
      // A private link challenge is never folded into a board post.
      const link = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
        ...body,
        visibility: 'private',
      });
      assert.equal(link.status, 201);
      assert.equal(await countOpenSeeksForUser(ivy.id), 4);

      // A lapsed duplicate does not count: the player gets a fresh post.
      await backdateSeek(firstId, 15);
      const fresh = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, body);
      assert.equal(fresh.status, 201);
      assert.notEqual((fresh.json.seek as { id: string }).id, firstId);
    });
  });

  test('an identical re-post at the open-seek cap returns the existing seek, not 409', async () => {
    await withCorrespondenceEnabled(async () => {
      const jo = await seedUser('dup-jo', 'dupjo', 'Jo');
      const cookie = await makeSessionCookie(jo.id);
      let firstId = '';
      for (const preferredColor of ['first', 'second']) {
        for (const daysPerMove of [1, 3, 7]) {
          const res = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
            gameSpecId: 'dark-chess',
            daysPerMove,
            preferredColor,
          });
          assert.equal(res.status, 201, `post ${preferredColor} ${daysPerMove}`);
          if (!firstId) firstId = (res.json.seek as { id: string }).id;
        }
      }
      const capped = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
        gameSpecId: 'dark-chess',
        daysPerMove: 1,
        preferredColor: 'random',
      });
      assert.equal(capped.status, 409, 'a new offer at the cap is still refused');
      const dup = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
        gameSpecId: 'dark-chess',
        daysPerMove: 1,
        preferredColor: 'first',
      });
      assert.equal(dup.status, 200);
      assert.equal((dup.json.seek as { id: string }).id, firstId);
    });
  });
});

async function backdateSeek(id: string, days: number): Promise<void> {
  await getPool().query(
    `UPDATE correspondence_seeks SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
    [id, days],
  );
}

async function withCorrespondenceEnabled(run: () => Promise<void>): Promise<void> {
  const prior = process.env.MISTBOARD_CORRESPONDENCE_ENABLED;
  process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';
  try {
    await run();
  } finally {
    if (prior === undefined) delete process.env.MISTBOARD_CORRESPONDENCE_ENABLED;
    else process.env.MISTBOARD_CORRESPONDENCE_ENABLED = prior;
  }
}

async function makeSessionCookie(userId: string): Promise<string> {
  const sessionId = `sess_${userId}`;
  const token = `tok_${userId}`;
  // currentAccountUser validates expiry against the real wall clock.
  const session: AccountSession = {
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  await createAccountSession(session);
  return `mistboard_session=${sessionId}.${token}`;
}

const notDraining = {
  isDraining: () => false,
  drainDeadlineMs: () => null,
} as unknown as HttpApiContext;

async function callSeekRoute(
  method: string,
  path: string,
  cookie: string,
  body?: Record<string, unknown>,
): Promise<{ status: number | null; json: Record<string, unknown> }> {
  const request = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
    method,
    headers: { cookie },
  }) as unknown as IncomingMessage;
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  const handled = await tryHandleSeekRoute(
    notDraining,
    request,
    capture as unknown as ServerResponse,
    path,
  );
  assert.equal(handled, true, `${method} ${path} should be claimed`);
  return { status: capture.status, json: JSON.parse(capture.body || '{}') };
}
