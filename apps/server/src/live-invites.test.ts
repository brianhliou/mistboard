import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIVE_INVITE_PENDING_CAP,
  LIVE_INVITE_RETENTION_MS,
  LIVE_INVITE_SEND_LIMIT,
  LIVE_INVITE_TTL_MS,
  LiveInviteStore,
  type LiveInviteTerms,
  liveInviteView,
} from './live-invites.js';
import {
  clearPresence,
  heartbeatLiveInvites,
  LIVE_INVITE_LEASE_MS,
  leaveLiveInvites,
  liveInviteReachable,
  refreshPresence,
  touchPresence,
} from './presence.js';

const party = (userId: string) => ({ userId, handle: userId, displayName: userId });
const terms: LiveInviteTerms = {
  gameSpecId: 'dark-chess',
  timeControl: { initialMs: 180000, incrementMs: 2000 },
  preferredColor: 'random',
  rated: false,
};
const at = 1700000000000;

test('live invites expire at sixty seconds, release pending slots and eventually forget outcomes', () => {
  const store = new LiveInviteStore();
  const result = store.create(party('a'), party('b'), terms, at);
  assert.ok(result.ok);
  assert.equal(store.getFor(result.invite.id, 'a', at + LIVE_INVITE_TTL_MS - 1)?.status, 'pending');
  assert.equal(store.getFor(result.invite.id, 'a', at + LIVE_INVITE_TTL_MS)?.status, 'expired');
  assert.equal(store.getFor(result.invite.id, 'stranger', at), null);
  assert.deepEqual(store.listFor('b', at + LIVE_INVITE_TTL_MS), []);
  assert.equal(
    store.getFor(result.invite.id, 'a', at + LIVE_INVITE_TTL_MS + LIVE_INVITE_RETENTION_MS),
    null,
  );
  assert.ok(store.create(party('a'), party('b'), terms, at + LIVE_INVITE_TTL_MS).ok);
});

test('live invite caps include both directions and opposite-direction duplicates, with atomic insertion', () => {
  const store = new LiveInviteStore();
  for (let i = 0; i < LIVE_INVITE_PENDING_CAP; i++)
    assert.ok(store.create(party(`sender${i}`), party('target'), terms, at).ok);
  assert.deepEqual(store.create(party('target'), party('sender0'), terms, at), {
    ok: false,
    error: 'duplicate_invite',
  });
  assert.deepEqual(store.create(party('target'), party('other'), terms, at), {
    ok: false,
    error: 'pending_invite_limit',
  });
  assert.deepEqual(store.create(party('other'), party('target'), terms, at), {
    ok: false,
    error: 'pending_invite_limit',
  });
  const id = store.listFor('target', at)[0]!.id;
  assert.equal(store.closeFor(id, 'sender1', 'cancelled', at), null);
  assert.equal(store.closeFor(id, 'sender0', 'declined', at), null);
  assert.equal(store.closeFor(id, 'target', 'declined', at)?.status, 'declined');
  assert.equal(store.closeFor(id, 'sender0', 'cancelled', at + 1)?.status, 'declined');
  assert.ok(store.create(party('other'), party('target'), terms, at).ok);
});

test('live invite storage and send buckets have global bounds and recover after expiry', () => {
  const store = new LiveInviteStore(2);
  const a = store.create(party('a'), party('b'), terms, at);
  assert.ok(a.ok);
  assert.ok(store.create(party('c'), party('d'), terms, at).ok);
  assert.deepEqual(store.create(party('e'), party('f'), terms, at), {
    ok: false,
    error: 'invite_capacity',
  });
  store.closeFor(a.invite.id, 'a', 'cancelled', at);
  assert.ok(store.create(party('e'), party('f'), terms, at).ok);
  assert.equal(store.getFor(a.invite.id, 'a', at), null);
  for (let i = 0; i < LIVE_INVITE_SEND_LIMIT; i++) assert.equal(store.allowSend('a', at), true);
  assert.equal(store.allowSend('a', at), false);
  assert.equal(store.allowSend('b', at), true);
  assert.equal(store.allowSend('c', at), false);
  assert.equal(store.allowSend('c', at + LIVE_INVITE_TTL_MS), true);
  assert.ok(store.create(party('g'), party('h'), terms, at + LIVE_INVITE_TTL_MS).ok);
});

test('live invite snapshots and serialized views cannot mutate state or expose internal identities', () => {
  const store = new LiveInviteStore();
  const result = store.create(party('a'), party('b'), terms, at);
  assert.ok(result.ok);
  result.invite.target.userId = 'intruder';
  result.invite.timeControl.initialMs = 1;
  const stored = store.getFor(result.invite.id, 'b', at)!;
  assert.equal(stored.target.userId, 'b');
  assert.equal(stored.timeControl.initialMs, 180000);
  assert.deepEqual(
    Object.keys(liveInviteView(stored, 'b')).sort(),
    [
      'id',
      'sender',
      'target',
      'gameSpecId',
      'timeControl',
      'preferredColor',
      'rated',
      'createdAt',
      'expiresAt',
      'status',
      'isMine',
      'canAccept',
      'canCancel',
      'canDecline',
    ].sort(),
  );
  assert.equal(JSON.stringify(liveInviteView(stored, 'b')).includes('userId'), false);
  store.invalidate(stored.id, at);
  assert.equal(store.getFor(stored.id, 'b', at)?.status, 'unavailable');
});

test('ordinary five-minute presence and socket refreshes never renew the short invite lease', () => {
  clearPresence();
  const user = { id: 'a', handle: 'a', displayName: 'a', profileVisibility: 'public' as const };
  touchPresence(user, at);
  assert.equal(liveInviteReachable('a', at), false);
  assert.equal(heartbeatLiveInvites('a', at), true);
  assert.equal(liveInviteReachable('a', at + LIVE_INVITE_LEASE_MS - 1), true);
  touchPresence(user, at + LIVE_INVITE_LEASE_MS);
  refreshPresence('a', at + LIVE_INVITE_LEASE_MS);
  assert.equal(liveInviteReachable('a', at + LIVE_INVITE_LEASE_MS), false);
  heartbeatLiveInvites('a', at + LIVE_INVITE_LEASE_MS);
  leaveLiveInvites('a');
  assert.equal(liveInviteReachable('a', at + LIVE_INVITE_LEASE_MS), false);
  clearPresence();
});
