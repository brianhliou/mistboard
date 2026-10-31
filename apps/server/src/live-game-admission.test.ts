import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  type AdmissionRoom,
  LiveGameAdmission,
  type LiveGameIdentity,
  liveGameIdentityForRequest,
} from './live-game-admission.js';
import { roomFixture } from './test-builders.js';

const player = { userId: 'account-776', deviceId: 'browser-776' };

function room(id: string, identity: LiveGameIdentity = player): AdmissionRoom {
  return {
    id,
    projection: { state: { status: { type: 'playing' } } },
    seatTokens: { red: { ...identity, revokedAt: null } },
  };
}

test('admission finds a disconnected account across devices and a guest across rooms', async () => {
  const rooms = new Map([['xq_live', room('xq_live')]]);
  const admission = new LiveGameAdmission({ rooms, tenantRooms: () => [] });
  assert.equal(
    await admission.find({ userId: player.userId, deviceId: 'other-browser' }),
    'xq_live',
  );
  assert.equal(await admission.find({ deviceId: player.deviceId }), 'xq_live');
  assert.equal(await admission.find({ userId: 'someone-else', deviceId: 'other-browser' }), null);
  // The entire result is a room id: no board, event, seat or hidden setup data.
  assert.equal(JSON.stringify(await admission.find(player)), '"xq_live"');
});

test('admission scans both the legacy room map and tenant maps without needing a socket', async () => {
  const legacy = roomFixture({ id: 'legacy-776' });
  legacy.seatTokens.white = {
    clientId: 'per-room-client',
    deviceId: player.deviceId,
    userId: null,
    userHandle: null,
    userDisplayName: null,
    seat: 'white',
    tokenHash: 'not-a-raw-token',
    issuedAt: new Date(0),
    lastSeenAt: new Date(0),
    revokedAt: null,
  };
  const tenantRooms = new Map([['xq_live', room('xq_live', { userId: player.userId })]]);
  const admission = new LiveGameAdmission({
    rooms: new Map([[legacy.id, legacy]]),
    tenantRooms: () => [tenantRooms],
  });
  assert.equal(await admission.find({ deviceId: player.deviceId }), legacy.id);
  assert.equal(await admission.find({ userId: player.userId }), 'xq_live');
});

test('correspondence, terminal rooms, revoked seats and spectators never count', async () => {
  for (const stack of ['legacy', 'tenant']) {
    for (const status of ['finished', 'aborted']) {
      const candidate = room('terminal');
      candidate.projection!.state.status.type = status;
      const admission = new LiveGameAdmission({ rooms: new Map([[candidate.id, candidate]]) });
      assert.equal(await admission.find(player), null);
    }
    const candidate = room('correspondence');
    if (stack === 'legacy') candidate.timeControl = { daysPerMove: 3 };
    else candidate.projection!.timeControl = { daysPerMove: 3 };
    const admission = new LiveGameAdmission({ rooms: new Map([[candidate.id, candidate]]) });
    assert.equal(await admission.find(player), null);
  }
  const revoked = room('revoked');
  revoked.seatTokens!.red!.revokedAt = new Date();
  const admission = new LiveGameAdmission({ rooms: new Map([[revoked.id, revoked]]) });
  assert.equal(await admission.find(player), null);
  revoked.seatTokens = {};
  assert.equal(await admission.find(player), null);
  assert.equal(await admission.find({}), null);
});

test('a new admission service finds persisted running rooms after restart', async () => {
  const reads: LiveGameIdentity[] = [];
  const persistedRoomIds = async (identity: LiveGameIdentity) => {
    reads.push(identity);
    return identity.userId === player.userId || identity.deviceId === player.deviceId
      ? ['persisted-running']
      : [];
  };
  for (let restart = 0; restart < 2; restart += 1) {
    const admission = new LiveGameAdmission({ rooms: new Map(), persistedRoomIds });
    assert.equal(await admission.find({ userId: player.userId }), 'persisted-running');
    assert.equal(await admission.find({ deviceId: player.deviceId }), 'persisted-running');
  }
  assert.equal(reads.length, 4);
});

test('loaded terminal and correspondence rooms override stale persisted running rows', async () => {
  const finished = room('finished');
  finished.projection!.state.status.type = 'finished';
  const correspondence = room('correspondence');
  correspondence.projection!.timeControl = { daysPerMove: 1 };
  const admission = new LiveGameAdmission({
    rooms: new Map([[finished.id, finished]]),
    tenantRooms: () => [new Map([[correspondence.id, correspondence]])],
    persistedRoomIds: async () => [finished.id, correspondence.id, 'not-loaded-running'],
  });
  assert.equal(await admission.find(player), 'not-loaded-running');
});

test('two concurrent reservations leave exactly one winner even across account/device aliases', async () => {
  for (const competingIdentity of [{ userId: player.userId }, { deviceId: player.deviceId }]) {
    const admission = new LiveGameAdmission({
      rooms: new Map(),
      persistedRoomIds: async () => {
        await setImmediate();
        return [];
      },
    });
    const results = await Promise.all([
      admission.reserve(player, 'created-first'),
      admission.reserve(competingIdentity, 'created-second'),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.deepEqual(results[1], { ok: false, roomId: 'created-first' });
    assert.equal(await admission.find(player), 'created-first');
  }
});

test('reservation release permits a retry after failure and cannot erase a later reservation', async () => {
  const admission = new LiveGameAdmission({ rooms: new Map() });
  const first = await admission.reserve(player, 'failed-create');
  assert.ok(first.ok);
  first.reservation.release();
  const second = await admission.reserve(player, 'retry-create');
  assert.ok(second.ok);
  first.reservation.release();
  assert.equal(await admission.find(player), 'retry-create');
  second.reservation.release();
  second.reservation.release();
  assert.equal(await admission.find(player), null);
});

test('releasing after room publication keeps the player occupied', async () => {
  const rooms = new Map<string, AdmissionRoom>();
  const admission = new LiveGameAdmission({ rooms });
  const first = await admission.reserve(player, 'published');
  assert.ok(first.ok);
  rooms.set('published', room('published'));
  first.reservation.release();
  assert.deepEqual(await admission.reserve(player, 'duplicate'), {
    ok: false,
    roomId: 'published',
  });
});

test('persistence errors fail closed and do not wedge subsequent reservations', async () => {
  let fail = true;
  const admission = new LiveGameAdmission({
    rooms: new Map(),
    persistedRoomIds: async () => {
      if (fail) throw new Error('database unavailable');
      return [];
    },
  });
  await assert.rejects(admission.reserve(player, 'not-created'), /database unavailable/);
  fail = false;
  assert.ok((await admission.reserve(player, 'retry')).ok);
  await assert.rejects(admission.reserve({}, 'anonymous'), /requires identity/);
});

test('HTTP guest identity is parsed from the browser header, account only from the session', () => {
  const request = { headers: { 'x-mistboard-device-id': player.deviceId, 'x-user-id': 'spoofed' } };
  assert.deepEqual(liveGameIdentityForRequest(request, null), {
    userId: null,
    deviceId: player.deviceId,
  });
  assert.deepEqual(liveGameIdentityForRequest(request, { id: player.userId }), player);
  for (const value of [
    undefined,
    '',
    'short',
    'bad browser id',
    'a'.repeat(81),
    [player.deviceId],
  ]) {
    assert.equal(
      liveGameIdentityForRequest({ headers: { 'x-mistboard-device-id': value } }, null).deviceId,
      null,
    );
  }
});
