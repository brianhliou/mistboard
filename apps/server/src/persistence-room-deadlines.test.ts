import {
  createUser,
  deleteRoomDeadline,
  listActiveCorrespondenceRoomIds,
  listCorrespondenceGamesForUser,
  listDeadlineWarningCandidates,
  listDueRoomDeadlines,
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

definePersistenceTests('room deadlines', () => {
  test('upsert + listDue roundtrip with due filtering, ordering, and limit', async () => {
    const now = new Date('2026-06-11T12:00:00Z');
    await upsertRoomDeadline({
      roomId: 'dchx_due_late',
      gameSpecId: 'dark-chess',
      seat: 'white',
      seatUserId: null,
      dueAt: new Date(now.getTime() - 1_000),
    });
    await upsertRoomDeadline({
      roomId: 'dchx_due_early',
      gameSpecId: 'dark-chess',
      seat: 'black',
      seatUserId: 'user-1',
      dueAt: new Date(now.getTime() - 60_000),
    });
    await upsertRoomDeadline({
      roomId: 'dchx_not_due',
      gameSpecId: 'dark-chess',
      seat: 'white',
      seatUserId: null,
      dueAt: new Date(now.getTime() + 60_000),
    });

    const due = await listDueRoomDeadlines(now);
    assert.deepEqual(
      due.map((row) => row.roomId),
      ['dchx_due_early', 'dchx_due_late'],
    );
    assert.equal(due[0]?.seat, 'black');
    assert.equal(due[0]?.gameSpecId, 'dark-chess');

    const limited = await listDueRoomDeadlines(now, 1);
    assert.deepEqual(
      limited.map((row) => row.roomId),
      ['dchx_due_early'],
    );
  });

  test('a changed due_at re-arms the warning; an unchanged one keeps it', async () => {
    const dueAt = new Date('2026-06-15T12:00:00Z');
    await upsertRoomDeadline({
      roomId: 'dchx_warned',
      gameSpecId: 'dark-chess',
      seat: 'white',
      seatUserId: null,
      dueAt,
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `UPDATE room_deadlines SET warned_at = now() WHERE room_id = 'dchx_warned'`,
      );

      // Same due_at: the warning state survives the idempotent re-upsert.
      await upsertRoomDeadline({
        roomId: 'dchx_warned',
        gameSpecId: 'dark-chess',
        seat: 'white',
        seatUserId: null,
        dueAt,
      });
      const kept = await client.query(
        `SELECT warned_at FROM room_deadlines WHERE room_id = 'dchx_warned'`,
      );
      assert.notEqual(kept.rows[0]?.warned_at, null);

      // New due_at (the player moved): the next warning re-arms.
      await upsertRoomDeadline({
        roomId: 'dchx_warned',
        gameSpecId: 'dark-chess',
        seat: 'black',
        seatUserId: null,
        dueAt: new Date(dueAt.getTime() + 60_000),
      });
      const rearmed = await client.query(
        `SELECT warned_at, seat FROM room_deadlines WHERE room_id = 'dchx_warned'`,
      );
      assert.equal(rearmed.rows[0]?.warned_at, null);
      assert.equal(rearmed.rows[0]?.seat, 'black');
    } finally {
      await client.end();
    }
  });

  test('deadline warning candidates honor the recipient email preference', async () => {
    const now = new Date('2026-07-13T12:00:00Z');
    const user = await createUser({
      id: 'user-deadline-email-pref',
      email: 'deadline-email-pref@example.com',
      emailVerifiedAt: now,
      handle: 'deadline-email-pref',
      displayName: 'Deadline Email Pref',
      now,
    });
    const dueAt = new Date(now.getTime() + 60 * 60 * 1000);
    await upsertRoomDeadline({
      roomId: 'dchx_deadline_email_pref',
      gameSpecId: 'dark-chess',
      seat: 'white',
      seatUserId: user.id,
      dueAt,
    });
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO events (room_id, seq, type, payload)
         VALUES ($1, 0, 'room-created', $2)`,
        [
          'dchx_deadline_email_pref',
          {
            type: 'room-created',
            roomId: 'dchx_deadline_email_pref',
            at: now.getTime(),
            variant: 'dark-chess',
            timeControl: { initialMs: 86_400_000, incrementMs: 0, daysPerMove: 1 },
          },
        ],
      );
    } finally {
      await client.end();
    }

    assert.deepEqual(
      (await listDeadlineWarningCandidates(now, 2 * 60 * 60 * 1000)).map(
        (candidate) => candidate.roomId,
      ),
      ['dchx_deadline_email_pref'],
    );

    await updateUserAccountPreference(
      user.id,
      'correspondenceDeadlineEmail',
      false,
      new Date(now.getTime() + 1),
    );
    assert.deepEqual(await listDeadlineWarningCandidates(now, 2 * 60 * 60 * 1000), []);
  });

  test('your correspondence games: enriched, your-move-first, inactive rooms excluded', async () => {
    const now = new Date('2026-06-11T12:00:00Z');
    const alice = await createUser({
      id: 'user-alice',
      email: 'alice@example.com',
      emailVerifiedAt: now,
      handle: 'alice',
      displayName: 'Alice',
      now,
    });
    const bob = await createUser({
      id: 'user-bob',
      email: 'bob@example.com',
      emailVerifiedAt: now,
      handle: 'bob',
      displayName: 'Bob',
      now,
    });

    // Seats Alice=white/Bob=black in r1 and r3; Bob=white/Alice=black in r2.
    const seat = async (roomId: string, color: 'white' | 'black', userId: string, tag: string) =>
      upsertRoomSeatToken(roomId, {
        seat: color,
        clientId: `c-${tag}`,
        tokenHash: sha256(tag),
        userId,
        userHandle: null,
        userDisplayName: null,
        issuedAt: now,
        lastSeenAt: now,
      });
    await seat('dchx_r1', 'white', alice.id, 'r1w');
    await seat('dchx_r1', 'black', bob.id, 'r1b');
    await seat('dchx_r2', 'white', bob.id, 'r2w');
    await seat('dchx_r2', 'black', alice.id, 'r2b');
    await seat('dchx_r3', 'white', alice.id, 'r3w');
    await seat('dchx_r3', 'black', bob.id, 'r3b');

    // r1 is Alice's move (due later); r2 is Bob's move so Alice is waiting (due
    // sooner). r3 has no deadline row — a finished/inactive room — so it must
    // not surface despite Alice holding a seat there.
    await upsertRoomDeadline({
      roomId: 'dchx_r1',
      gameSpecId: 'dark-chess',
      seat: 'white',
      seatUserId: alice.id,
      dueAt: new Date(now.getTime() + 2 * 86_400_000),
    });
    await upsertRoomDeadline({
      roomId: 'dchx_r2',
      gameSpecId: 'dark-chess',
      seat: 'white',
      seatUserId: bob.id,
      dueAt: new Date(now.getTime() + 1 * 86_400_000),
    });

    // Alice: r1 (her move) sorts before r2 (waiting) despite r2's sooner
    // deadline — your-move-first is the primary sort. Opponent is Bob in both.
    const forAlice = await listCorrespondenceGamesForUser(alice.id);
    assert.deepEqual(
      forAlice.map((g) => ({
        roomId: g.roomId,
        mySeat: g.mySeat,
        isYourMove: g.isYourMove,
        opponentName: g.opponentName,
      })),
      [
        { roomId: 'dchx_r1', mySeat: 'white', isYourMove: true, opponentName: 'Bob' },
        { roomId: 'dchx_r2', mySeat: 'black', isYourMove: false, opponentName: 'Bob' },
      ],
    );

    // Bob: mirror — r2 (his move) first, then r1 (waiting); opponent Alice.
    const forBob = await listCorrespondenceGamesForUser(bob.id);
    assert.deepEqual(
      forBob.map((g) => ({
        roomId: g.roomId,
        isYourMove: g.isYourMove,
        opponentName: g.opponentName,
      })),
      [
        { roomId: 'dchx_r2', isYourMove: true, opponentName: 'Alice' },
        { roomId: 'dchx_r1', isYourMove: false, opponentName: 'Alice' },
      ],
    );

    // A user seated in nothing gets an empty list.
    const carol = await createUser({
      id: 'user-carol',
      email: 'carol@example.com',
      emailVerifiedAt: now,
      handle: 'carol',
      displayName: 'Carol',
      now,
    });
    assert.deepEqual(await listCorrespondenceGamesForUser(carol.id), []);

    // The opponent's handle rides along so the inbox can link the name, and is
    // withheld (name kept) once that account's profile goes private.
    assert.deepEqual(
      forAlice.map((g) => g.opponentHandle),
      ['bob', 'bob'],
    );
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(`UPDATE users SET profile_visibility = 'private' WHERE id = $1`, [bob.id]);
    } finally {
      await client.end();
    }
    const privateBob = await listCorrespondenceGamesForUser(alice.id);
    assert.deepEqual(
      privateBob.map((g) => ({ name: g.opponentName, handle: g.opponentHandle })),
      [
        { name: 'Bob', handle: null },
        { name: 'Bob', handle: null },
      ],
    );
  });

  test('active correspondence room ids: every deadline row, gone after delete', async () => {
    const now = new Date('2026-06-11T12:00:00Z');
    await upsertRoomDeadline({
      roomId: 'dxq_corr_a',
      gameSpecId: 'xiangqi',
      seat: 'red',
      seatUserId: null,
      dueAt: new Date(now.getTime() + 86_400_000),
    });
    await upsertRoomDeadline({
      roomId: 'dxq_corr_b',
      gameSpecId: 'xiangqi',
      seat: 'black',
      seatUserId: 'user-1',
      // Past due but still active (not yet swept): it is a game in play.
      dueAt: new Date(now.getTime() - 86_400_000),
    });

    assert.deepEqual((await listActiveCorrespondenceRoomIds()).sort(), [
      'dxq_corr_a',
      'dxq_corr_b',
    ]);

    await deleteRoomDeadline('dxq_corr_a');
    assert.deepEqual(await listActiveCorrespondenceRoomIds(), ['dxq_corr_b']);
  });

  test('delete removes the row', async () => {
    const now = new Date();
    await upsertRoomDeadline({
      roomId: 'dchx_deleted',
      gameSpecId: 'dark-chess',
      seat: 'white',
      seatUserId: null,
      dueAt: new Date(now.getTime() - 1_000),
    });
    await deleteRoomDeadline('dchx_deleted');
    const due = await listDueRoomDeadlines(now);
    assert.deepEqual(
      due.filter((row) => row.roomId === 'dchx_deleted'),
      [],
    );
  });
});
