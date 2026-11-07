import { LiveGameAdmission } from './live-game-admission.js';
import {
  appendRoomEvent,
  createUser,
  loadRoomSeatTokens,
  recordGameStart,
  replaceRoomSeatTokens,
  touchRoomSeatToken,
  upsertRoomSeatToken,
} from './persistence.js';
import { close, getPool, init, isInitialized } from './persistence-db.js';
import { listLiveRoomIdsForIdentity } from './persistence-seat-tokens.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

test('durable admission uses only account identity for signed-in requesters and device for guests', async (t) => {
  const ownsPool = !isInitialized();
  if (ownsPool) init('postgres://localhost/admission-unit-test');
  const query = t.mock.method(getPool(), 'query', async () => ({ rows: [] }));
  try {
    await listLiveRoomIdsForIdentity({ userId: 'account-a', deviceId: 'shared-browser' });
    await listLiveRoomIdsForIdentity({ userId: 'account-b', deviceId: 'shared-browser' });
    await listLiveRoomIdsForIdentity({ deviceId: 'shared-browser' });
    await listLiveRoomIdsForIdentity({ userId: null, deviceId: 'shared-browser' });
    // Account requests must never fall through to another account's browser seat.
    assert.deepEqual(
      query.mock.calls.map((call) => call.arguments[1]),
      [
        ['account-a', null],
        ['account-b', null],
        [null, 'shared-browser'],
        [null, 'shared-browser'],
      ],
    );
  } finally {
    if (ownsPool) await close();
  }
});

test('durable admission bounds stale event-only rooms using the last event and clock budget', async (t) => {
  const now = new Date('2026-11-03T12:00:00Z').getTime();
  t.mock.method(Date, 'now', () => now);
  const ownsPool = !isInitialized();
  if (ownsPool) init('postgres://localhost/admission-unit-test');
  const candidate = (room_id: string, ageMs: number, last_event_seq = 0) => ({
    room_id,
    time_control: { initialMs: 60_000, incrementMs: 5_000 },
    last_event_at_ms: now - ageMs,
    last_event_seq,
  });
  t.mock.method(getPool(), 'query', async () => ({
    rows: [
      candidate('banked-increment', 65_000, 4),
      candidate('expired-boundary', 80_000, 4),
      candidate('fresh-event-only', 59_999),
      { ...candidate('legacy-default', 299_999), time_control: null },
      { ...candidate('stale-legacy-default', 300_000), time_control: null },
      candidate('stale-event-only', 86_400_000),
    ],
  }));
  try {
    assert.deepEqual(await listLiveRoomIdsForIdentity({ deviceId: 'browser' }), [
      'banked-increment',
      'fresh-event-only',
      'legacy-default',
    ]);
  } finally {
    if (ownsPool) await close();
  }
});

definePersistenceTests('seat tokens', () => {
  test('live admission finds durable account and guest seats after a restart', async () => {
    const now = new Date();
    const identity = { userId: 'admission-account', deviceId: 'admission-browser' };
    await createUser({
      id: identity.userId,
      email: 'admission@example.com',
      emailVerifiedAt: now,
      handle: 'admission-player',
      displayName: 'admission-player',
      now,
    });
    for (const id of [
      'running',
      'event-only',
      'correspondence',
      'completed',
      'aborted',
      'revoked',
      'stale-running',
      'stale-event-only',
    ]) {
      await appendRoomEvent(id, 0, {
        type: 'room-created',
        roomId: id,
        at: now.getTime() - (id.startsWith('stale-') ? 86_400_000 : 0),
        gameSpecId: 'xiangqi',
        timeControl:
          id === 'correspondence'
            ? { initialMs: 259_200_000, incrementMs: 0, daysPerMove: 3 }
            : { initialMs: 300_000, incrementMs: 5_000 },
      });
      for (const seat of ['red', 'black'] as const) {
        await upsertRoomSeatToken(id, {
          seat,
          clientId: `per-room-${id}-${seat}`,
          userId: seat === 'red' ? identity.userId : null,
          deviceId: seat === 'black' ? identity.deviceId : null,
          tokenHash: `hash-${id}-${seat}`,
          userHandle: null,
          userDisplayName: null,
          issuedAt: now,
          lastSeenAt: now,
          revokedAt: id === 'revoked' ? now : null,
        });
      }
      if (!id.endsWith('event-only') && id !== 'aborted') {
        await recordGameStart(id, {
          variant: 'xiangqi',
          mode: 'pvp',
          startedAt: now,
          whiteClient: null,
          blackClient: null,
          whiteName: null,
          blackName: null,
          corpusId: null,
        });
      }
    }
    // Aborted tenants need not have a games row at all.
    await appendRoomEvent('aborted', 1, { type: 'game-aborted', roomId: 'aborted' });
    await getPool().query(
      `UPDATE games SET status = 'completed', result = 'red-wins',
         termination = 'resignation', ended_at = $1 WHERE room_id = 'completed'`,
      [now],
    );
    for (const lookup of [{ userId: identity.userId }, { deviceId: identity.deviceId }]) {
      assert.deepEqual(await listLiveRoomIdsForIdentity(lookup), ['event-only', 'running']);
      // No hydrated rooms, clients or reservation cache survive this restart.
      const admission = new LiveGameAdmission({ rooms: new Map(), tenantRooms: () => [] });
      assert.equal(await admission.find(lookup), 'event-only');
      await getPool().query('UPDATE room_seat_tokens SET revoked_at = $1 WHERE room_id = $2', [
        now,
        'event-only',
      ]);
      const restarted = new LiveGameAdmission({ rooms: new Map(), tenantRooms: () => [] });
      assert.equal(await restarted.find(lookup), 'running');
      await getPool().query('UPDATE room_seat_tokens SET revoked_at = NULL WHERE room_id = $1', [
        'event-only',
      ]);
    }
    assert.deepEqual(await listLiveRoomIdsForIdentity({ deviceId: 'other-browser' }), []);
    assert.deepEqual(
      await listLiveRoomIdsForIdentity({ userId: 'other-account', deviceId: identity.deviceId }),
      [],
    );
    assert.deepEqual(
      await listLiveRoomIdsForIdentity({ userId: identity.userId, deviceId: 'other-browser' }),
      ['event-only', 'running'],
    );
  });

  test('live admission uses the last event rather than creation time and retains earned increments', async (t) => {
    const now = new Date('2026-11-03T12:00:00Z');
    t.mock.method(Date, 'now', () => now.getTime());
    for (const [id, ageMs, moves] of [
      ['banked-increment', 65_000, 4],
      ['expired-boundary', 80_000, 4],
      ['fresh-event-only', 59_999, 1],
      ['stale-event-only', 86_400_000, 1],
    ] as const) {
      await appendRoomEvent(id, 0, {
        type: 'room-created',
        roomId: id,
        at: now.getTime() - 86_400_000,
        gameSpecId: 'xiangqi',
        timeControl: { initialMs: 60_000, incrementMs: 5_000 },
      });
      for (let seq = 1; seq <= moves; seq += 1) {
        await appendRoomEvent(id, seq, {
          type: 'move-played',
          roomId: id,
          at: now.getTime() - ageMs,
          color: seq % 2 ? 'red' : 'black',
          move: { from: 'a0', to: 'a1' },
        });
      }
      await upsertRoomSeatToken(id, {
        seat: 'red',
        clientId: `${id}-client`,
        deviceId: 'shared-browser',
        userId: null,
        tokenHash: `${id}-hash`,
        userHandle: null,
        userDisplayName: null,
        issuedAt: now,
        lastSeenAt: now,
      });
    }
    assert.deepEqual(await listLiveRoomIdsForIdentity({ deviceId: 'shared-browser' }), [
      'banked-increment',
      'fresh-event-only',
    ]);
  });

  test('room seat tokens carry the browser device id and survive a reload', async () => {
    const at = new Date('2026-09-11T10:00:00.000Z');
    await upsertRoomSeatToken('device-room', {
      seat: 'black',
      clientId: 'black-client',
      deviceId: 'device-abc-123',
      tokenHash: 'hash-black',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt: at,
      lastSeenAt: at,
      revokedAt: null,
    });
    const loaded = await loadRoomSeatTokens('device-room');
    assert.equal(loaded.black?.deviceId, 'device-abc-123');
    // A later upsert without a device (a pre-issued rematch seat) clears it.
    await upsertRoomSeatToken('device-room', {
      seat: 'black',
      clientId: 'black-client',
      tokenHash: 'hash-black-2',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt: at,
      lastSeenAt: at,
      revokedAt: null,
    });
    assert.equal((await loadRoomSeatTokens('device-room')).black?.deviceId, null);
  });

  test('room seat tokens persist only token hashes and seat metadata', async () => {
    const issuedAt = new Date('2026-05-08T10:00:00.000Z');
    const lastSeenAt = new Date('2026-05-08T10:00:01.000Z');
    await upsertRoomSeatToken('token-room', {
      seat: 'white',
      clientId: 'white-client',
      deviceId: null,
      tokenHash: 'hash-white',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt,
      lastSeenAt,
      revokedAt: null,
    });

    assert.deepEqual(await loadRoomSeatTokens('token-room'), {
      white: {
        seat: 'white',
        clientId: 'white-client',
        deviceId: null,
        tokenHash: 'hash-white',
        userId: null,
        userHandle: null,
        userDisplayName: null,
        issuedAt,
        lastSeenAt,
        revokedAt: null,
      },
    });
  });

  test('room seat tokens can carry signed-in attribution without raw account secrets', async () => {
    const now = new Date('2026-05-08T10:00:00.000Z');
    await createUser({
      id: 'user_token',
      email: 'token@example.com',
      emailVerifiedAt: now,
      handle: 'token-player',
      displayName: 'Token Player',
      now,
    });
    await upsertRoomSeatToken('signed-token-room', {
      seat: 'white',
      clientId: 'white-client',
      deviceId: null,
      tokenHash: 'hash-white',
      userId: 'user_token',
      userHandle: null,
      userDisplayName: null,
      issuedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    });

    assert.deepEqual(await loadRoomSeatTokens('signed-token-room'), {
      white: {
        seat: 'white',
        clientId: 'white-client',
        deviceId: null,
        tokenHash: 'hash-white',
        userId: 'user_token',
        userHandle: 'token-player',
        userDisplayName: 'Token Player',
        issuedAt: now,
        lastSeenAt: now,
        revokedAt: null,
      },
    });
  });

  test('room seat token last seen and replacement are durable', async () => {
    const issuedAt = new Date('2026-05-08T10:00:00.000Z');
    await upsertRoomSeatToken('replace-token-room', {
      seat: 'white',
      clientId: 'white-client',
      deviceId: null,
      tokenHash: 'hash-white',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt,
      lastSeenAt: issuedAt,
      revokedAt: null,
    });

    const touchedAt = new Date('2026-05-08T10:05:00.000Z');
    await touchRoomSeatToken('replace-token-room', 'white', 'hash-white', touchedAt);
    assert.equal(
      (await loadRoomSeatTokens('replace-token-room')).white?.lastSeenAt.getTime(),
      touchedAt.getTime(),
    );

    await replaceRoomSeatTokens('replace-token-room', {
      black: {
        seat: 'black',
        clientId: 'white-client',
        deviceId: null,
        tokenHash: 'hash-white',
        userId: null,
        userHandle: null,
        userDisplayName: null,
        issuedAt,
        lastSeenAt: touchedAt,
        revokedAt: null,
      },
    });

    assert.deepEqual(await loadRoomSeatTokens('replace-token-room'), {
      black: {
        seat: 'black',
        clientId: 'white-client',
        deviceId: null,
        tokenHash: 'hash-white',
        userId: null,
        userHandle: null,
        userDisplayName: null,
        issuedAt,
        lastSeenAt: touchedAt,
        revokedAt: null,
      },
    });
  });

  test('room seat tokens support Dark Xiangqi red seats', async () => {
    const issuedAt = new Date('2026-05-25T10:00:00.000Z');
    await upsertRoomSeatToken('dxq-token-room', {
      seat: 'red',
      clientId: 'red-client',
      deviceId: null,
      tokenHash: 'hash-red',
      userId: null,
      userHandle: null,
      userDisplayName: null,
      issuedAt,
      lastSeenAt: issuedAt,
      revokedAt: null,
    });

    assert.deepEqual(await loadRoomSeatTokens('dxq-token-room'), {
      red: {
        seat: 'red',
        clientId: 'red-client',
        deviceId: null,
        tokenHash: 'hash-red',
        userId: null,
        userHandle: null,
        userDisplayName: null,
        issuedAt,
        lastSeenAt: issuedAt,
        revokedAt: null,
      },
    });
  });
});
