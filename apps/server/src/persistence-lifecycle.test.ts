import {
  abortStaleGuestPrestartGames,
  appendEvent,
  createUser,
  finalizeStalePausedRooms,
  type GameSummary,
  getRoomLifecycleTimeline,
  listActiveRoomIds,
  listRoomLifecycleAudit,
  recordGameEnd,
  recordGameStart,
  recordRoomLifecycleAudit,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  sha256,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

definePersistenceTests('lifecycle', () => {
  test('listActiveRoomIds excludes finished games', async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);

    await appendEvent('active-room', 0, {
      type: 'room-created',
      at: now.getTime(),
      roomId: 'active-room',
      variant: 'dark-chess',
    });
    await appendEvent('finished-room', 0, {
      type: 'room-created',
      at: now.getTime(),
      roomId: 'finished-room',
      variant: 'dark-chess',
    });
    await recordGameEnd('finished-room', {
      variant: 'dark-chess',
      result: 'white-wins',
      termination: 'king-captured',
      plyCount: 12,
      startedAt: now,
      endedAt: now,
      whiteClient: 'client-w',
      blackClient: 'client-b',
      whiteName: null,
      blackName: null,
      corpusId: null,
    } satisfies GameSummary);

    const active = await listActiveRoomIds(earlier);
    assert.deepEqual(active, ['active-room']);
  });

  test('listActiveRoomIds includes running games', async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);

    await appendEvent('running-room', 0, {
      type: 'room-created',
      at: now.getTime(),
      roomId: 'running-room',
      variant: 'dark-chess',
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at, mode, status)
         VALUES ($1, 'dark-chess', NULL, NULL, 0, $2, NULL, 'eve', 'running')`,
        ['running-room', now],
      );
    } finally {
      await client.end();
    }

    const active = await listActiveRoomIds(earlier);
    assert.deepEqual(active, ['running-room']);
  });

  test('recordGameStart creates a durable running game row', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    await recordGameStart('started-pve', {
      variant: 'dark-chess',
      mode: 'pve',
      startedAt: now,
      whiteClient: null,
      blackClient: 'builtin-random-legal',
      whiteName: null,
      blackName: null,
      corpusId: null,
    });

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{
        mode: string;
        status: string;
        result: string | null;
        termination: string | null;
        ended_at: Date | null;
        visibility: string;
        region: string;
      }>(
        'SELECT mode, status, result, termination, ended_at, visibility, region FROM games WHERE room_id = $1',
        ['started-pve'],
      );
      assert.deepEqual(rows, [
        {
          mode: 'pve',
          status: 'running',
          result: null,
          termination: null,
          ended_at: null,
          visibility: 'public',
          region: 'global',
        },
      ]);
    } finally {
      await client.end();
    }
  });

  test('room lifecycle audit stores public-safe room timeline metadata', async () => {
    const startedAt = new Date('2026-05-22T10:00:00.000Z');
    const pauseAt = startedAt.getTime() + 60_000;
    await recordGameStart('audit-room', {
      variant: 'dark-chess',
      mode: 'pvp',
      startedAt,
      whiteClient: 'white-client',
      blackClient: 'black-client',
      whiteName: null,
      blackName: null,
      corpusId: null,
    });
    await appendEvent('audit-room', 0, {
      type: 'room-created',
      at: startedAt.getTime(),
      roomId: 'audit-room',
      variant: 'dark-chess',
    });
    await appendEvent('audit-room', 1, {
      type: 'pause',
      at: pauseAt,
      roomId: 'audit-room',
      reason: 'shutdown',
    });
    await recordRoomLifecycleAudit({
      roomId: 'audit-room',
      kind: 'pause_on_shutdown',
      atMs: pauseAt,
      eventSeq: 1,
      payload: { mode: 'pvp', clockFrozen: true },
    });

    const audit = await listRoomLifecycleAudit({ roomId: 'audit-room' });
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.kind, 'pause_on_shutdown');
    assert.equal(audit[0]?.roomId, 'audit-room');
    assert.equal(audit[0]?.atMs, pauseAt);
    assert.equal(audit[0]?.eventSeq, 1);
    assert.deepEqual(audit[0]?.payload, { mode: 'pvp', clockFrozen: true });

    const timeline = await getRoomLifecycleTimeline('audit-room');
    assert.equal(timeline.game?.status, 'running');
    assert.deepEqual(
      timeline.events.map((event) => ({
        seq: event.seq,
        type: event.type,
        atMs: event.atMs,
        reason: event.reason,
      })),
      [
        { seq: 0, type: 'room-created', atMs: startedAt.getTime(), reason: null },
        { seq: 1, type: 'pause', atMs: pauseAt, reason: 'shutdown' },
      ],
    );
    assert.equal(timeline.audit[0]?.kind, 'pause_on_shutdown');
  });

  test('abortStaleGuestPrestartGames aborts guest rooms where no move was ever played', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    const stale = new Date(now.getTime() - 20 * 60_000);
    const fresh = new Date(now.getTime() - 2 * 60_000);
    const user = await createUser({
      id: 'abort-policy-user',
      email: 'abort-policy@example.com',
      emailVerifiedAt: null,
      handle: 'abortpolicy',
      displayName: 'Abort Policy',
      now,
    });
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status)
         VALUES
           ('stale-guest-prestart', 'dark-chess', NULL, NULL, 0, $1, NULL,
            NULL, NULL, NULL, NULL, 'pvp', 'running'),
           ('fresh-guest-prestart', 'dark-chess', NULL, NULL, 0, $2, NULL,
            NULL, NULL, NULL, NULL, 'pvp', 'running'),
           ('stale-signed-in-prestart', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'signed-client', NULL, NULL, NULL, 'pvp', 'running'),
           ('stale-started-clock', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'clock-white', 'clock-black', NULL, NULL, 'pvp', 'running'),
           ('stale-started-move', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'move-white', 'move-black', NULL, NULL, 'pvp', 'running'),
           ('stale-correspondence', 'dark-chess', NULL, NULL, 0, $1, NULL,
            NULL, NULL, NULL, NULL, 'pvp', 'running')`,
        [stale, fresh],
      );
      await client.query(
        `INSERT INTO events (room_id, seq, type, payload)
         VALUES
           ('stale-guest-prestart', 0, 'room-created', $1),
           ('fresh-guest-prestart', 0, 'room-created', $2),
           ('stale-signed-in-prestart', 0, 'room-created', $3),
           ('stale-started-clock', 0, 'room-created', $4),
           ('stale-started-clock', 1, 'clock-started', $5),
           ('stale-started-move', 0, 'room-created', $6),
           ('stale-started-move', 1, 'move-played', $7),
           ('stale-correspondence', 0, 'room-created', $8)`,
        [
          {
            type: 'room-created',
            at: stale.getTime(),
            roomId: 'stale-guest-prestart',
            variant: 'dark-chess',
          },
          {
            type: 'room-created',
            at: fresh.getTime(),
            roomId: 'fresh-guest-prestart',
            variant: 'dark-chess',
          },
          {
            type: 'room-created',
            at: stale.getTime(),
            roomId: 'stale-signed-in-prestart',
            variant: 'dark-chess',
          },
          {
            type: 'room-created',
            at: stale.getTime(),
            roomId: 'stale-started-clock',
            variant: 'dark-chess',
          },
          {
            type: 'clock-started',
            at: stale.getTime() + 1000,
            roomId: 'stale-started-clock',
            clock: {
              initialMs: 30000,
              incrementMs: 2000,
              remainingMs: { white: 30000, black: 30000 },
              activeColor: 'white',
              runningSince: stale.getTime() + 1000,
            },
          },
          {
            type: 'room-created',
            at: stale.getTime(),
            roomId: 'stale-started-move',
            variant: 'dark-chess',
          },
          {
            type: 'move-played',
            at: stale.getTime() + 1000,
            roomId: 'stale-started-move',
            color: 'white',
            move: { from: 'e2', to: 'e4' },
          },
          {
            type: 'room-created',
            at: stale.getTime(),
            roomId: 'stale-correspondence',
            variant: 'dark-chess',
          },
        ],
      );
      // room_deadlines holds exactly one row per in-flight correspondence
      // room, so its presence is how this sweep recognises days-per-move and
      // leaves it alone: an open correspondence challenge sitting unfilled for
      // days is normal, and the deadline sweeper owns its enforcement.
      await client.query(
        `INSERT INTO room_deadlines (room_id, game_spec_id, seat, due_at)
         VALUES ('stale-correspondence', 'dark-chess', 'white', $1)`,
        [new Date(now.getTime() + 3 * 24 * 60 * 60_000)],
      );
      await client.query(
        `INSERT INTO room_seat_tokens
           (room_id, seat, client_id, token_hash, user_id, issued_at, last_seen_at, revoked_at)
         VALUES
           ('stale-signed-in-prestart', 'white', 'signed-client', $1, $2, $3, $3, NULL)`,
        [sha256('signed-seat-token'), user.id, stale],
      );
    } finally {
      await client.end();
    }

    const result = await abortStaleGuestPrestartGames(now, 15 * 60_000);
    // 'stale-started-clock' is the room this sweep used to miss. A clock-started
    // event meant "both seats filled" on the legacy stack, but the tenant
    // runtime emits it at ROOM CREATION, so excluding on it disarmed the sweep
    // for every timed tenant room. The predicate keys on move-played now, so a
    // stale guest room with a clock but no moves is correctly abandoned.
    assert.deepEqual(result, {
      aborted: 2,
      roomIds: ['stale-guest-prestart', 'stale-started-clock'],
    });

    const verifyClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await verifyClient.connect();
    try {
      const { rows } = await verifyClient.query<{
        room_id: string;
        status: string;
        termination: string | null;
      }>(
        `SELECT room_id, status, termination
         FROM games
         WHERE room_id LIKE '%prestart'
            OR room_id LIKE 'stale-started-%'
            OR room_id = 'stale-correspondence'
         ORDER BY room_id`,
      );
      assert.deepEqual(rows, [
        { room_id: 'fresh-guest-prestart', status: 'running', termination: null },
        { room_id: 'stale-correspondence', status: 'running', termination: null },
        { room_id: 'stale-guest-prestart', status: 'aborted', termination: 'abandoned' },
        { room_id: 'stale-signed-in-prestart', status: 'running', termination: null },
        { room_id: 'stale-started-clock', status: 'aborted', termination: 'abandoned' },
        { room_id: 'stale-started-move', status: 'running', termination: null },
      ]);
    } finally {
      await verifyClient.end();
    }
  });

  test('finalizeStalePausedRooms only touches rooms whose last event is a stale pause', async () => {
    const now = new Date('2026-05-22T12:00:00.000Z');
    const stalePauseMs = 24 * 60 * 60 * 1000;
    const stalePauseAt = now.getTime() - 25 * 60 * 60 * 1000; // older than window
    const freshPauseAt = now.getTime() - 1 * 60 * 60 * 1000; // within window
    const startedAt = new Date(stalePauseAt - 60 * 60 * 1000);

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO games
           (room_id, variant, result, termination, ply_count, started_at, ended_at,
            white_client, black_client, white_name, black_name, mode, status)
         VALUES
           ('stale-paused-pvp', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'cw', 'cb', 'Alice', 'Bob', 'pvp', 'running'),
           ('stale-paused-then-resumed', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'cw', 'cb', 'Alice', 'Bob', 'pvp', 'running'),
           ('fresh-paused', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'cw', 'cb', 'Alice', 'Bob', 'pvp', 'running'),
           ('running-no-pause', 'dark-chess', NULL, NULL, 0, $1, NULL,
            'cw', 'cb', 'Alice', 'Bob', 'pvp', 'running'),
           ('stale-paused-already-completed', 'dark-chess', 'white-wins', 'king-captured', 12, $1, $2,
            'cw', 'cb', 'Alice', 'Bob', 'pvp', 'completed')`,
        [startedAt, now],
      );

      // Events: each stale-paused room gets a move + a pause as its last event.
      // The resumed room has pause + resume after the pause.
      await client.query(
        `INSERT INTO events (room_id, seq, type, payload)
         VALUES
           ('stale-paused-pvp', 0, 'room-created', $1),
           ('stale-paused-pvp', 1, 'move-played', $2),
           ('stale-paused-pvp', 2, 'move-played', $3),
           ('stale-paused-pvp', 3, 'pause', $4),
           ('stale-paused-then-resumed', 0, 'room-created', $5),
           ('stale-paused-then-resumed', 1, 'pause', $6),
           ('stale-paused-then-resumed', 2, 'resume', $7),
           ('fresh-paused', 0, 'room-created', $8),
           ('fresh-paused', 1, 'pause', $9),
           ('running-no-pause', 0, 'room-created', $10),
           ('running-no-pause', 1, 'move-played', $11),
           ('stale-paused-already-completed', 0, 'room-created', $12),
           ('stale-paused-already-completed', 1, 'pause', $13)`,
        [
          {
            type: 'room-created',
            at: startedAt.getTime(),
            roomId: 'stale-paused-pvp',
            variant: 'dark-chess',
          },
          {
            type: 'move-played',
            at: startedAt.getTime() + 1000,
            roomId: 'stale-paused-pvp',
            color: 'white',
            move: { from: 'e2', to: 'e4' },
          },
          {
            type: 'move-played',
            at: startedAt.getTime() + 2000,
            roomId: 'stale-paused-pvp',
            color: 'black',
            move: { from: 'e7', to: 'e5' },
          },
          { type: 'pause', at: stalePauseAt, roomId: 'stale-paused-pvp', reason: 'shutdown' },
          {
            type: 'room-created',
            at: startedAt.getTime(),
            roomId: 'stale-paused-then-resumed',
            variant: 'dark-chess',
          },
          {
            type: 'pause',
            at: stalePauseAt,
            roomId: 'stale-paused-then-resumed',
            reason: 'shutdown',
          },
          {
            type: 'resume',
            at: stalePauseAt + 1000,
            roomId: 'stale-paused-then-resumed',
            reason: 'both-present',
          },
          {
            type: 'room-created',
            at: startedAt.getTime(),
            roomId: 'fresh-paused',
            variant: 'dark-chess',
          },
          { type: 'pause', at: freshPauseAt, roomId: 'fresh-paused', reason: 'shutdown' },
          {
            type: 'room-created',
            at: startedAt.getTime(),
            roomId: 'running-no-pause',
            variant: 'dark-chess',
          },
          {
            type: 'move-played',
            at: startedAt.getTime() + 1000,
            roomId: 'running-no-pause',
            color: 'white',
            move: { from: 'e2', to: 'e4' },
          },
          {
            type: 'room-created',
            at: startedAt.getTime(),
            roomId: 'stale-paused-already-completed',
            variant: 'dark-chess',
          },
          {
            type: 'pause',
            at: stalePauseAt,
            roomId: 'stale-paused-already-completed',
            reason: 'shutdown',
          },
        ],
      );
    } finally {
      await client.end();
    }

    const result = await finalizeStalePausedRooms(now, stalePauseMs);
    assert.equal(result.finalized, 1, 'exactly one room should finalize');
    assert.equal(result.rooms[0]?.roomId, 'stale-paused-pvp');
    assert.equal(result.rooms[0]?.mode, 'pvp');
    assert.equal(result.rooms[0]?.pauseSeq, 3);
    assert.equal(result.rooms[0]?.pausedAtMs, stalePauseAt);
    assert.equal(result.rooms[0]?.pauseReason, 'shutdown');
    assert.equal(result.rooms[0]?.plyCount, 2, 'ply_count should reflect move-played events');

    const verify = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await verify.connect();
    try {
      const { rows } = await verify.query<{
        room_id: string;
        status: string;
        result: string | null;
        termination: string | null;
        ply_count: number;
      }>(
        `SELECT room_id, status, result, termination, ply_count
         FROM games
         WHERE room_id IN (
           'stale-paused-pvp', 'stale-paused-then-resumed', 'fresh-paused',
           'running-no-pause', 'stale-paused-already-completed'
         )
         ORDER BY room_id`,
      );
      assert.deepEqual(rows, [
        {
          room_id: 'fresh-paused',
          status: 'running',
          result: null,
          termination: null,
          ply_count: 0,
        },
        {
          room_id: 'running-no-pause',
          status: 'running',
          result: null,
          termination: null,
          ply_count: 0,
        },
        // Already-completed row is untouched by the sweep.
        {
          room_id: 'stale-paused-already-completed',
          status: 'completed',
          result: 'white-wins',
          termination: 'king-captured',
          ply_count: 12,
        },
        {
          room_id: 'stale-paused-pvp',
          status: 'completed',
          result: 'draw',
          termination: 'server-restarted',
          ply_count: 2,
        },
        {
          room_id: 'stale-paused-then-resumed',
          status: 'running',
          result: null,
          termination: null,
          ply_count: 0,
        },
      ]);
      const auditRows = await verify.query<{
        room_id: string;
        kind: string;
        at_ms: string | null;
        event_seq: number | null;
        payload: Record<string, unknown>;
      }>(
        `SELECT room_id, kind, at_ms, event_seq, payload
         FROM room_lifecycle_audit
         WHERE room_id = 'stale-paused-pvp'
         ORDER BY id`,
      );
      assert.deepEqual(auditRows.rows, [
        {
          room_id: 'stale-paused-pvp',
          kind: 'stale_paused_finalized',
          at_ms: String(now.getTime()),
          event_seq: 3,
          payload: {
            mode: 'pvp',
            pauseReason: 'shutdown',
            pausedAtMs: stalePauseAt,
            pausedDurationMs: now.getTime() - stalePauseAt,
            startedAtMs: startedAt.getTime(),
            plyCount: 2,
          },
        },
      ]);
    } finally {
      await verify.end();
    }

    // Idempotency — second sweep finds nothing.
    const repeat = await finalizeStalePausedRooms(now, stalePauseMs);
    assert.deepEqual(repeat, { finalized: 0, rooms: [] });
  });
});
