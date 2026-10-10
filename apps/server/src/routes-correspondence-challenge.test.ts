import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowsAnonymousAccess,
  challengeAcceptError,
  challengeViewModel,
  openSeekPayload,
  parseSeekVisibility,
  seekGoneView,
} from './routes/correspondence-seeks.js';

const T0 = 1_000_000; // fixed "now" for view-model tests
const future = new Date(T0 + 60_000);
const past = new Date(T0 - 60_000);

test('parseSeekVisibility accepts the enum and rejects everything else', () => {
  assert.equal(parseSeekVisibility('public'), 'public');
  assert.equal(parseSeekVisibility('private'), 'private');
  // Absent → undefined so the caller applies its own default.
  assert.equal(parseSeekVisibility(undefined), undefined);
  assert.equal(parseSeekVisibility(null), undefined);
  // Anything unrecognized is undefined, never a silent fallthrough.
  assert.equal(parseSeekVisibility('secret'), undefined);
  assert.equal(parseSeekVisibility(2), undefined);
});

test('challengeAcceptError: creator can never accept their own seek', () => {
  assert.equal(
    challengeAcceptError({ creatorUserId: 'a', targetUserId: null }, 'a'),
    'cannot_accept_own_seek',
  );
  assert.equal(
    challengeAcceptError({ creatorUserId: 'a', targetUserId: 'b' }, 'a'),
    'cannot_accept_own_seek',
  );
});

test('challengeAcceptError: link challenge (no target) admits anyone but the creator', () => {
  assert.equal(challengeAcceptError({ creatorUserId: 'a', targetUserId: null }, 'b'), null);
  assert.equal(challengeAcceptError({ creatorUserId: 'a', targetUserId: null }, 'z'), null);
});

test('challengeAcceptError: directed challenge admits only its target', () => {
  assert.equal(challengeAcceptError({ creatorUserId: 'a', targetUserId: 'b' }, 'b'), null);
  assert.equal(
    challengeAcceptError({ creatorUserId: 'a', targetUserId: 'b' }, 'c'),
    'not_your_challenge',
  );
});

test('challengeViewModel: the target of a live direct challenge can accept and decline', () => {
  const v = challengeViewModel(
    { creatorUserId: 'a', targetUserId: 'b', expiresAt: future },
    'b',
    T0,
  );
  assert.deepEqual(v, {
    visible: true,
    isMine: false,
    expired: false,
    canAccept: true,
    canDecline: true,
  });
});

test('challengeViewModel: the creator sees their own challenge but cannot accept/decline it', () => {
  const v = challengeViewModel(
    { creatorUserId: 'a', targetUserId: 'b', expiresAt: future },
    'a',
    T0,
  );
  assert.equal(v.visible, true);
  assert.equal(v.isMine, true);
  assert.equal(v.canAccept, false);
  assert.equal(v.canDecline, false);
});

test('challengeViewModel: a stranger cannot see a directed challenge', () => {
  const v = challengeViewModel(
    { creatorUserId: 'a', targetUserId: 'b', expiresAt: future },
    'c',
    T0,
  );
  assert.equal(v.visible, false);
  assert.equal(v.canAccept, false);
});

test('challengeViewModel: a link challenge is visible and acceptable by anyone but its creator', () => {
  const anyone = challengeViewModel(
    { creatorUserId: 'a', targetUserId: null, expiresAt: future },
    'z',
    T0,
  );
  assert.equal(anyone.visible, true);
  assert.equal(anyone.canAccept, true);
  // A link has no one to decline it.
  assert.equal(anyone.canDecline, false);
});

test('challengeViewModel: an expired challenge is visible but not acceptable', () => {
  const v = challengeViewModel({ creatorUserId: 'a', targetUserId: 'b', expiresAt: past }, 'b', T0);
  assert.equal(v.visible, true);
  assert.equal(v.expired, true);
  assert.equal(v.canAccept, false);
  assert.equal(v.canDecline, false);
});

// The anonymous surface is exactly one request. Enumerated rather than spot
// -checked: a future verb added to this router must not inherit public access by
// sitting on the same path.
test('allowsAnonymousAccess: only the public board GET is served without an account', () => {
  assert.equal(allowsAnonymousAccess('/api/correspondence/seeks', 'GET'), true);
  for (const method of ['POST', 'DELETE', 'PUT', 'PATCH']) {
    assert.equal(allowsAnonymousAccess('/api/correspondence/seeks', method), false);
  }
  for (const pathname of [
    '/api/correspondence/seeks/incoming',
    '/api/correspondence/seeks/seek_1',
    '/api/correspondence/seeks/seek_1/accept',
    '/api/correspondence/seeks/seek_1/decline',
  ]) {
    assert.equal(allowsAnonymousAccess(pathname, 'GET'), false);
    assert.equal(allowsAnonymousAccess(pathname, 'POST'), false);
  }
});

test('openSeekPayload: an anonymous reader owns nothing on the public board', () => {
  const seek = {
    id: 'seek_1',
    gameSpecId: 'xiangqi',
    daysPerMove: 3,
    preferredColor: 'random',
    creatorName: 'someone',
    createdAt: new Date(T0),
    creatorUserId: 'user_a',
  };
  assert.equal(openSeekPayload(seek, null).isMine, false);
  assert.equal(openSeekPayload(seek, 'user_b').isMine, false);
  assert.equal(openSeekPayload(seek, 'user_a').isMine, true);
  // The row carries no viewer-specific field beyond isMine, and no user id.
  assert.deepEqual(Object.keys(openSeekPayload(seek, null)).sort(), [
    'createdAt',
    // The linkable profile handle (null when the account is closed or private).
    'creatorHandle',
    'creatorName',
    'daysPerMove',
    'gameSpecId',
    'id',
    'isMine',
    'preferredColor',
    // Rated correspondence (2026-10-02): a seek-level fact, the same for every reader.
    'rated',
  ]);
  assert.equal(openSeekPayload(seek, null).rated, false);
  assert.equal(openSeekPayload({ ...seek, rated: true }, null).rated, true);
  // No handle from the read means no link: null, never the display name.
  assert.equal(openSeekPayload(seek, null).creatorHandle, null);
  assert.equal(
    openSeekPayload({ ...seek, creatorHandle: 'someone_h' }, null).creatorHandle,
    'someone_h',
  );
});

// #527: a dead seek link says what happened, but only to someone who may know.
const goneBase = {
  creatorUserId: 'creator',
  targetUserId: null as string | null,
  visibility: 'public' as const,
  roomId: null as string | null,
  accepterUserId: null as string | null,
  accepterName: null as string | null,
};

test('seekGoneView: a public seek tells anyone who took it, and links the game', () => {
  const taken = {
    ...goneBase,
    outcome: 'taken' as const,
    roomId: 'room_1',
    accepterUserId: 'accepter',
    accepterName: 'Ann',
  };
  assert.deepEqual(seekGoneView(taken, 'stranger'), {
    reason: 'taken',
    roomId: 'room_1',
    accepterName: 'Ann',
    youPlay: false,
  });
  // The two players get "Open game" rather than "Watch".
  assert.equal(seekGoneView(taken, 'creator')?.youPlay, true);
  assert.equal(seekGoneView(taken, 'accepter')?.youPlay, true);
});

test('seekGoneView: withdrawn, declined and expired map to their reasons', () => {
  assert.deepEqual(seekGoneView({ ...goneBase, outcome: 'cancelled' }, 'stranger'), {
    reason: 'withdrawn',
  });
  assert.deepEqual(seekGoneView({ ...goneBase, outcome: 'expired' }, 'stranger'), {
    reason: 'expired',
  });
  const declined = {
    ...goneBase,
    outcome: 'declined' as const,
    visibility: 'private' as const,
    targetUserId: 'target',
  };
  assert.deepEqual(seekGoneView(declined, 'creator'), { reason: 'declined' });
  assert.deepEqual(seekGoneView(declined, 'target'), { reason: 'declined' });
});

test('seekGoneView: a private challenge stays a plain 404 to a stranger', () => {
  const direct = {
    ...goneBase,
    visibility: 'private' as const,
    targetUserId: 'target',
  };
  for (const outcome of ['taken', 'cancelled', 'declined', 'expired'] as const) {
    const row = {
      ...direct,
      outcome,
      roomId: outcome === 'taken' ? 'room_2' : null,
      accepterUserId: outcome === 'taken' ? 'target' : null,
      accepterName: outcome === 'taken' ? 'Tia' : null,
    };
    assert.equal(seekGoneView(row, 'stranger'), null, `direct ${outcome}`);
    assert.notEqual(seekGoneView(row, 'creator'), null, `creator sees direct ${outcome}`);
    assert.notEqual(seekGoneView(row, 'target'), null, `target sees direct ${outcome}`);
  }
  // A link challenge (private, no target): a stranger holding the link learns
  // nothing; the creator and whoever took it do.
  const link = {
    ...goneBase,
    visibility: 'private' as const,
    outcome: 'taken' as const,
    roomId: 'room_3',
    accepterUserId: 'friend',
    accepterName: 'Fay',
  };
  assert.equal(seekGoneView(link, 'stranger'), null);
  assert.equal(seekGoneView(link, 'creator')?.reason, 'taken');
  assert.equal(seekGoneView(link, 'friend')?.roomId, 'room_3');
});
