import assert from 'node:assert/strict';
import test from 'node:test';
import { collectLiveRoomStats } from './live-room-stats.js';
import { onlineFollowingEntries, onlineFollowingRows } from './online-following.js';
import type { BestRatingEntry } from './persistence.js';
import type { PresenceEntry, PresenceVisibility } from './presence.js';
import type { HttpApiContext } from './routes/lib.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';

type FakeClient = { id: string; userId?: string; seat: string };

function legacyRoom(clients: FakeClient[], opts: { status?: string; paused?: boolean } = {}) {
  return {
    mode: 'pvp',
    projection: {
      state: { status: { type: opts.status ?? 'playing' } },
      ...(opts.paused ? { paused: true } : {}),
    },
    clients: new Set(clients),
  };
}

function context(rooms: Record<string, unknown>): HttpApiContext {
  return { rooms: new Map(Object.entries(rooms)) } as unknown as HttpApiContext;
}

// Two fake tenants: one enabled, one switched off. Their rooms are filled per
// test; the registry is process-global, so the prefixes are unique to this file.
const enabledRooms = new Map<string, TenantManagedRoom>();
const disabledRooms = new Map<string, TenantManagedRoom>();
for (const [kind, prefix, rooms, enabled] of [
  ['fake-friends-on', 'ffon_', enabledRooms, true],
  ['fake-friends-off', 'ffoff_', disabledRooms, false],
] as const) {
  registerVariantTenant({
    kind,
    gameSpecId: 'xiangqi',
    roomIdPrefix: prefix,
    enabled: () => enabled,
    rooms,
    activeGameCount: () => 0,
  } as unknown as VariantTenantRegistration);
}

function tenantRoom(clients: FakeClient[]): TenantManagedRoom {
  return {
    projection: { state: { status: { type: 'playing' } } },
    clients: new Set(clients),
  } as unknown as TenantManagedRoom;
}

test('live room stats map a seated player to their room, never a spectator', () => {
  enabledRooms.clear();
  disabledRooms.clear();
  const stats = collectLiveRoomStats(
    context({
      'room-a': legacyRoom([
        { id: 'c1', userId: 'u_alice', seat: 'white' },
        { id: 'c2', userId: 'u_watcher', seat: 'spectator' },
      ]),
      'room-done': legacyRoom([{ id: 'c3', userId: 'u_bob', seat: 'white' }], {
        status: 'finished',
      }),
    }),
  );
  assert.equal(stats.playingRoomByUserId.get('u_alice'), 'room-a');
  assert.equal(stats.playingRoomByUserId.has('u_watcher'), false);
  assert.equal(stats.playingRoomByUserId.has('u_bob'), false, 'a finished room is not linked');
});

test('a player in a paused room and a live one is linked to the live one', () => {
  enabledRooms.clear();
  disabledRooms.clear();
  const stats = collectLiveRoomStats(
    context({
      'room-paused': legacyRoom([{ id: 'c1', userId: 'u_alice', seat: 'white' }], {
        paused: true,
      }),
      'room-live': legacyRoom([{ id: 'c2', userId: 'u_alice', seat: 'black' }]),
    }),
  );
  assert.equal(stats.playingRoomByUserId.get('u_alice'), 'room-live');
});

test('a tenant room is linked only while its tenant is enabled', () => {
  enabledRooms.clear();
  disabledRooms.clear();
  enabledRooms.set('ffon_1', tenantRoom([{ id: 'c1', userId: 'u_on', seat: 'red' }]));
  disabledRooms.set('ffoff_1', tenantRoom([{ id: 'c2', userId: 'u_off', seat: 'red' }]));
  const stats = collectLiveRoomStats(context({}));
  assert.equal(stats.playingRoomByUserId.get('u_on'), 'ffon_1');
  // Still playing (presence), but no Watch link onto a closed surface.
  assert.equal(stats.playingUserIds.has('u_off'), true);
  assert.equal(stats.playingRoomByUserId.has('u_off'), false);
  enabledRooms.clear();
  disabledRooms.clear();
});

function presence(
  userId: string,
  handle: string,
  profileVisibility: PresenceVisibility,
): PresenceEntry {
  return {
    userId,
    handle,
    displayName: handle.toUpperCase(),
    title: null,
    profileVisibility,
    lastSeenMs: 0,
  };
}

test('online-following rows: followed, non-private only, sorted by handle', () => {
  const listed = onlineFollowingEntries(
    [
      presence('u_zed', 'zed', 'public'),
      presence('u_priv', 'priv', 'private'),
      presence('u_amy', 'amy', 'unlisted'),
      presence('u_stranger', 'stranger', 'public'),
    ],
    new Set(['u_zed', 'u_priv', 'u_amy']),
  );
  assert.deepEqual(
    listed.map((entry) => entry.handle),
    ['amy', 'zed'],
    'a private followed profile never appears; an unfollowed one never leaks in',
  );
});

test('online-following rows carry only the listed fields, and a room only when playing', () => {
  const rating: BestRatingEntry = { variant: 'xiangqi', eloRating: 1800, provisional: false };
  const rows = onlineFollowingRows(
    [presence('u_amy', 'amy', 'public'), presence('u_zed', 'zed', 'public')],
    {
      playingUserIds: new Set(['u_amy']),
      // zed has a stale map entry but is not playing: no link.
      playingRoomByUserId: new Map([
        ['u_amy', 'room/with space'],
        ['u_zed', 'room-old'],
      ]),
    },
    new Map([['u_amy', rating]]),
  );
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      'displayName',
      'handle',
      'playing',
      'rating',
      'roomUrl',
      'title',
    ]);
  }
  assert.deepEqual(rows[0], {
    handle: 'amy',
    displayName: 'AMY',
    title: null,
    rating,
    playing: true,
    roomUrl: '/room/room%2Fwith%20space',
  });
  assert.equal(rows[1]?.playing, false);
  assert.equal(rows[1]?.roomUrl, null);
  assert.equal(rows[1]?.rating, null);
});
