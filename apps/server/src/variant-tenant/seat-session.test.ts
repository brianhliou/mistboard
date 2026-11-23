import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserAccount } from '../persistence.js';
import {
  assignTenantSeat,
  mintTenantSeatToken,
  type TenantSeatRoom,
  tenantSeatTokenStatesFromPersistence,
} from './seat-session.js';
import type { TenantSeatTokenState } from './tenant.js';

type Color = 'white' | 'black';

const tenant = { colors: ['white', 'black'] as const };

function emptyRoom(): TenantSeatRoom<Color> {
  return { clients: new Set(), projection: { seats: {} }, seatTokens: {} };
}

function account(overrides: Partial<UserAccount> = {}): UserAccount {
  return { id: 'user-1', handle: 'tester', displayName: 'Tester', ...overrides } as UserAccount;
}

function seatToken(userId: string): TenantSeatTokenState<Color> {
  return {
    clientId: 'old-client',
    seat: 'white',
    tokenHash: 'hash',
    userId,
    userHandle: 'tester',
    userDisplayName: 'Tester',
    issuedAt: new Date(0),
    lastSeenAt: new Date(0),
    revokedAt: null,
  };
}

// The per-account play lock (126). Every tenant reaches a seat through this
// function, so these three cases are the whole tenant-side contract: a locked
// account takes no new seat, keeps one it already holds, and locks nobody else.

test('assignTenantSeat: a play-disabled account is refused a new seat', () => {
  const assignment = assignTenantSeat(
    tenant,
    emptyRoom(),
    'locked-client',
    undefined,
    account({ playDisabledAt: new Date() }),
  );

  assert.deepEqual(assignment, { ok: false, reason: 'play disabled' });
});

test('assignTenantSeat: a play-disabled account keeps the seat it already holds', () => {
  const room = emptyRoom();
  room.seatTokens.white = seatToken('user-1');

  const assignment = assignTenantSeat(
    tenant,
    room,
    'new-client',
    undefined,
    account({ playDisabledAt: new Date() }),
  );

  assert.ok(assignment.ok, 'the account re-attaches to its own seat by identity');
  assert.equal(assignment.seat, 'white');
});

test('assignTenantSeat: the play lock leaves a signed-out player alone', () => {
  const assignment = assignTenantSeat(tenant, emptyRoom(), 'guest-client', undefined, null);

  assert.ok(assignment.ok);
  assert.equal(assignment.seat, 'white');
});

// The browser device id (migration 137): stored on a new seat, and learned by
// a pre-issued seat on the first reconnect that carries one.

test('assignTenantSeat: a new guest seat records the device id', () => {
  const room = emptyRoom();
  const assignment = assignTenantSeat(tenant, room, 'guest-client', undefined, null, 'dev-1');

  assert.ok(assignment.ok);
  assert.equal(assignment.tokenState.deviceId, 'dev-1');
  assert.equal(room.seatTokens.white?.deviceId, 'dev-1');
});

test('assignTenantSeat: a reclaimed seat keeps its device and a pre-issued one learns it', () => {
  const room = emptyRoom();
  room.seatTokens.white = seatToken('user-1');
  const learned = assignTenantSeat(tenant, room, 'c2', undefined, account(), 'dev-2');
  assert.ok(learned.ok);
  assert.equal(learned.tokenState.deviceId, 'dev-2');

  const kept = assignTenantSeat(tenant, room, 'c3', undefined, account(), 'dev-other');
  assert.ok(kept.ok);
  assert.equal(kept.tokenState.deviceId, 'dev-2', 'the first device wins');
});

test('assignTenantSeat: no device id leaves the seat anonymous', () => {
  const assignment = assignTenantSeat(tenant, emptyRoom(), 'guest-client', undefined, null);
  assert.ok(assignment.ok);
  assert.equal(assignment.tokenState.deviceId, null);
});

test('assignTenantSeat: a seat pre-issued without a name learns it from the reclaiming account', () => {
  // Correspondence seek accept mints both seats by user id only; until this, the
  // room and the /games card called the opponent "Guest" until a server restart.
  const room = emptyRoom();
  room.seatTokens.white = { ...seatToken('user-1'), userHandle: null, userDisplayName: null };
  const assignment = assignTenantSeat(tenant, room, 'new-client', undefined, account());
  assert.ok(assignment.ok);
  assert.equal(room.seatTokens.white?.userHandle, 'tester');
  assert.equal(room.seatTokens.white?.userDisplayName, 'Tester');
  // A name already on the seat is kept, never overwritten by the connection.
  room.seatTokens.black = { ...seatToken('user-2'), seat: 'black', userDisplayName: 'Kept' };
  assignTenantSeat(tenant, room, 'c2', undefined, account({ id: 'user-2', displayName: 'New' }));
  assert.equal(room.seatTokens.black?.userDisplayName, 'Kept');
});

// Title and flair (#1085) ride with the seat under the linkable-handle gate: a
// public account's seat carries them, a private or closed account's and a
// guest's never do, and every path that copies a seat keeps them.

const decorated = { title: 'xgm', flair: 'variant-xiangqi' } as const;

test('assignTenantSeat: a new seat carries a public account title and flair', () => {
  const room = emptyRoom();
  const assignment = assignTenantSeat(
    tenant,
    room,
    'c1',
    undefined,
    account({ ...decorated, profileVisibility: 'public', closedAt: null }),
  );
  assert.ok(assignment.ok);
  assert.equal(assignment.tokenState.userTitle, 'xgm');
  assert.equal(assignment.tokenState.userFlair, 'variant-xiangqi');
});

test('assignTenantSeat: private and closed accounts and guests carry no title or flair', () => {
  for (const user of [
    account({ ...decorated, profileVisibility: 'private', closedAt: null }),
    account({ ...decorated, profileVisibility: 'public', closedAt: new Date(0) }),
    null,
  ]) {
    const assignment = assignTenantSeat(tenant, emptyRoom(), 'c1', undefined, user);
    assert.ok(assignment.ok);
    const wire = JSON.stringify(assignment.tokenState);
    assert.doesNotMatch(wire, /userTitle|userFlair|xgm|variant-xiangqi/);
  }
});

test('assignTenantSeat: an account reclaiming its seat refreshes its gated decorations', () => {
  const room = emptyRoom();
  room.seatTokens.white = { ...seatToken('user-1'), userHandle: null, userDisplayName: null };
  assignTenantSeat(
    tenant,
    room,
    'c1',
    undefined,
    account({ ...decorated, profileVisibility: 'unlisted' }),
  );
  assert.equal(room.seatTokens.white?.userTitle, 'xgm');
  assert.equal(room.seatTokens.white?.userFlair, 'variant-xiangqi');
  // The same account gone private loses them on its next reconnect.
  assignTenantSeat(
    tenant,
    room,
    'c2',
    undefined,
    account({ ...decorated, profileVisibility: 'private' }),
  );
  assert.equal(room.seatTokens.white?.userTitle, undefined);
  assert.equal(room.seatTokens.white?.userFlair, undefined);
  assert.equal('userTitle' in (room.seatTokens.white ?? {}), false);
});

test('mintTenantSeatToken and hydration keep decorations and leave plain seats unchanged', () => {
  const room = emptyRoom();
  const { state } = mintTenantSeatToken(room, 'white', {
    userId: 'user-1',
    userHandle: 'tester',
    userDisplayName: 'Tester',
    userTitle: 'xim',
    userFlair: 'variant-jieqi',
  });
  assert.equal(state.userTitle, 'xim');
  assert.equal(state.userFlair, 'variant-jieqi');
  const plain = mintTenantSeatToken(room, 'black', {
    userId: null,
    userHandle: null,
    userDisplayName: null,
  }).state;
  assert.equal('userTitle' in plain || 'userFlair' in plain, false);

  const hydrated = tenantSeatTokenStatesFromPersistence({
    white: { ...state, deviceId: null, revokedAt: null },
    black: { ...plain, deviceId: null, revokedAt: null },
  });
  assert.equal(hydrated.white?.userTitle, 'xim');
  assert.equal(hydrated.white?.userFlair, 'variant-jieqi');
  assert.equal('userTitle' in (hydrated.black ?? {}), false);
});
