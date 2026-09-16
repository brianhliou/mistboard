import {
  createUser,
  listCorrespondenceDigestCandidates,
  markCorrespondenceDigestSent,
  updateUserAccountPreference,
  upsertRoomDeadline,
  upsertRoomSeatToken,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  sha256,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

const HOUR_MS = 60 * 60 * 1000;

definePersistenceTests('correspondence digest', () => {
  test('digest candidates: stalled games per idle account, with every exclusion', async () => {
    const now = new Date('2026-09-20T14:30:00Z');
    const idleSince = new Date(now.getTime() - 12 * HOUR_MS);
    const sentBefore = new Date('2026-09-20T14:00:00Z');
    const dueAt = new Date(now.getTime() + 2 * 24 * HOUR_MS);
    const stale = new Date(now.getTime() - 20 * HOUR_MS);
    const fresh = new Date(now.getTime() - HOUR_MS);

    const mk = (id: string) =>
      createUser({
        id,
        email: `${id}@example.com`,
        emailVerifiedAt: now,
        handle: id,
        displayName: id,
        now,
      });
    const idle = await mk('digest-idle');
    const optedOut = await mk('digest-optout');
    const seenLately = await mk('digest-seen');
    const sentToday = await mk('digest-sent');
    const opponent = await mk('digest-opp');

    const arm = async (roomId: string, seatUserId: string, at: Date, seat = 'red') => {
      await upsertRoomDeadline({ roomId, gameSpecId: 'xiangqi', seat, seatUserId, dueAt });
      await upsertRoomSeatToken(roomId, {
        seat: seat === 'red' ? 'black' : 'red',
        clientId: `client-${roomId}`,
        tokenHash: sha256(`token-${roomId}`),
        userId: opponent.id,
        userHandle: opponent.handle,
        userDisplayName: opponent.displayName,
        issuedAt: now,
        lastSeenAt: now,
      });
      const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await client.connect();
      try {
        await client.query(`UPDATE room_deadlines SET updated_at = $2 WHERE room_id = $1`, [
          roomId,
          at,
        ]);
      } finally {
        await client.end();
      }
    };

    // The idle account: two stalled games (one already warned), one that only
    // just became their move, and one that is already due.
    await arm('xq_digest_a', idle.id, stale);
    await arm('xq_digest_b', idle.id, stale);
    await arm('xq_digest_fresh', idle.id, fresh);
    await upsertRoomDeadline({
      roomId: 'xq_digest_due',
      gameSpecId: 'xiangqi',
      seat: 'red',
      seatUserId: idle.id,
      dueAt: new Date(now.getTime() - 1000),
    });
    // The exclusions, one stalled game each.
    await arm('xq_digest_optout', optedOut.id, stale);
    await arm('xq_digest_seen', seenLately.id, stale);
    await arm('xq_digest_sent', sentToday.id, stale);

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(`UPDATE room_deadlines SET warned_at = $1 WHERE room_id = 'xq_digest_b'`, [
        stale,
      ]);
      await client.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [
        seenLately.id,
        fresh,
      ]);
      await client.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [idle.id, stale]);
    } finally {
      await client.end();
    }
    await updateUserAccountPreference(optedOut.id, 'correspondenceTurnDigest', false, now);
    await markCorrespondenceDigestSent(sentToday.id, new Date('2026-09-20T14:05:00Z'));

    const candidates = await listCorrespondenceDigestCandidates({ now, sentBefore, idleSince });
    assert.deepEqual(
      candidates.map((candidate) => ({
        userId: candidate.userId,
        email: candidate.email,
        games: candidate.games.map((game) => [game.roomId, game.opponentName, game.warned]),
      })),
      [
        {
          userId: idle.id,
          email: 'digest-idle@example.com',
          games: [
            ['xq_digest_a', 'digest-opp', false],
            ['xq_digest_b', 'digest-opp', true],
          ],
        },
      ],
    );
    assert.equal(candidates[0]?.games[0]?.gameSpecId, 'xiangqi');
    assert.equal(candidates[0]?.games[0]?.dueAt.getTime(), dueAt.getTime());

    // Yesterday's send does not block today's window; a send inside it does.
    await markCorrespondenceDigestSent(idle.id, new Date('2026-09-19T14:05:00Z'));
    assert.equal(
      (await listCorrespondenceDigestCandidates({ now, sentBefore, idleSince })).length,
      1,
    );
    await markCorrespondenceDigestSent(idle.id, now);
    assert.deepEqual(await listCorrespondenceDigestCandidates({ now, sentBefore, idleSince }), []);
  });
});
