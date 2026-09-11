import {
  createUser,
  loadRoomSeatTokens,
  replaceRoomSeatTokens,
  touchRoomSeatToken,
  upsertRoomSeatToken,
} from './persistence.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

definePersistenceTests('seat tokens', () => {
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
