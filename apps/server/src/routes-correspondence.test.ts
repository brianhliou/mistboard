import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import { correspondenceTimeControl, DAY_MS, type RoomTimeControl } from '@mistboard/game';
import {
  createDarkChessCorrespondenceGameForSeek,
  createDarkChessCorrespondenceRoom,
  darkChessTenantRooms,
  sweepDarkChessDueDeadline,
} from './dark-chess-registration.js';
import { type DarkChessTenantEvent, darkChessTenant } from './dark-chess-tenant.js';
import type { UserAccount } from './persistence.js';
import {
  type CorrespondenceCreateContext,
  handleCorrespondenceCreate,
  requestsCorrespondence,
} from './routes/correspondence-rooms.js';
import { tenantDurableDeadlineFor } from './variant-tenant/lifecycle.js';
import { variantTenantForRoomId } from './variant-tenant/registry.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { assignTenantSeat } from './variant-tenant/seat-session.js';

process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';

function fakeResponse() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const response = {
    writeHead(status: number) {
      captured.status = status;
      return response;
    },
    setHeader() {
      return response;
    },
    end(payload?: string) {
      if (payload) captured.body = JSON.parse(payload) as Record<string, unknown>;
    },
  } as unknown as ServerResponse;
  return { response, captured };
}

function createContext(
  overrides: Partial<CorrespondenceCreateContext> = {},
): CorrespondenceCreateContext & {
  created: Array<{ timeControl: RoomTimeControl; creatorPreference?: string }>;
} {
  const created: Array<{ timeControl: RoomTimeControl; creatorPreference?: string }> = [];
  return {
    created,
    databaseRequired: false,
    refusesCreate: () => false,
    drainDeadlineMs: () => null,
    isPersistenceInitialized: () => true,
    createCorrespondenceRoom: async (timeControl, creatorPreference) => {
      created.push({ timeControl, creatorPreference });
      return { ok: true, room: { id: 'dchx_test-room', gameSpecId: 'dark-chess' } };
    },
    ...overrides,
  };
}

const signedIn = { id: 'user-1', handle: 'tester', displayName: 'Tester' } as UserAccount;

test('correspondence matcher claims every explicit correspondence request', () => {
  assert.equal(requestsCorrespondence({ gameSpecId: 'dark-chess', mode: 'correspondence' }), true);
  // Every spec's correspondence create routes here since #1059; the handler
  // answers 501 for a spec with no invite room.
  assert.equal(requestsCorrespondence({ gameSpecId: 'xiangqi', mode: 'correspondence' }), true);
  // Plain creates stay on their tenant or chess fallback path.
  assert.equal(requestsCorrespondence({ gameSpecId: 'dark-chess', mode: 'pvp' }), false);
  assert.equal(requestsCorrespondence({ gameSpecId: 'dark-chess' }), false);
});

test('correspondence create is flag-gated', async () => {
  process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'false';
  try {
    const { response, captured } = fakeResponse();
    await handleCorrespondenceCreate(createContext(), response, {
      gameSpecId: 'dark-chess',
      mode: 'correspondence',
      daysPerMove: 3,
    });
    assert.equal(captured.status, 404);
    assert.equal(captured.body?.error, 'correspondence_disabled');
  } finally {
    process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';
  }
});

test('a guest creates a correspondence invite room (#1059)', async () => {
  // No account is read on create: the creator's browser takes its seat with the
  // bearer token, and the friend's seat is the one that needs an account.
  const ctx = createContext();
  ctx.createCorrespondenceRoom = async (timeControl, creatorPreference) => {
    ctx.created.push({ timeControl, creatorPreference });
    return { ok: true, room: { id: 'xq_guest-invite', gameSpecId: 'xiangqi' } };
  };
  const { response, captured } = fakeResponse();
  await handleCorrespondenceCreate(ctx, response, {
    gameSpecId: 'xiangqi',
    mode: 'correspondence',
    daysPerMove: 3,
    preferredColor: 'red',
  });
  assert.equal(captured.status, 201);
  assert.equal(captured.body?.url, '/room/xq_guest-invite');
  assert.equal(captured.body?.rated, false);
  assert.deepEqual(ctx.created, [
    { timeControl: correspondenceTimeControl(3), creatorPreference: 'red' },
  ]);
});

test('correspondence create refuses specs with no public invite room', async () => {
  for (const gameSpecId of ['ffq-banqi', 'xiangqi-mahjong', 'not-a-spec', 42]) {
    const { response, captured } = fakeResponse();
    await handleCorrespondenceCreate(createContext(), response, {
      gameSpecId,
      mode: 'correspondence',
      daysPerMove: 3,
    });
    assert.equal(captured.status, 501, String(gameSpecId));
    assert.equal(captured.body?.error, 'correspondence_unsupported_spec');
  }
  // An eligible spec whose registration supplies no create is refused the same way.
  const { response, captured } = fakeResponse();
  await handleCorrespondenceCreate(
    createContext({ createCorrespondenceRoom: undefined }),
    response,
    { gameSpecId: 'dark-chess', mode: 'correspondence', daysPerMove: 3 },
  );
  assert.equal(captured.status, 501);
});

test('correspondence create rejects off-menu allowances', async () => {
  for (const daysPerMove of [5, 0, -1, 'three', undefined, 0.5]) {
    const { response, captured } = fakeResponse();
    await handleCorrespondenceCreate(createContext(), response, {
      gameSpecId: 'dark-chess',
      mode: 'correspondence',
      daysPerMove,
    });
    assert.equal(captured.status, 400, `daysPerMove=${String(daysPerMove)}`);
    assert.equal(captured.body?.error, 'invalid_days_per_move');
  }
});

test('correspondence create requires persistence', async () => {
  const { response, captured } = fakeResponse();
  await handleCorrespondenceCreate(
    createContext({ isPersistenceInitialized: () => false }),
    response,
    { gameSpecId: 'dark-chess', mode: 'correspondence', daysPerMove: 3 },
  );
  assert.equal(captured.status, 503);
  assert.equal(captured.body?.error, 'persistence_disabled');
});

test('correspondence create succeeds for a signed-in user with an official allowance', async () => {
  const ctx = createContext();
  const { response, captured } = fakeResponse();
  await handleCorrespondenceCreate(ctx, response, {
    gameSpecId: 'dark-chess',
    mode: 'correspondence',
    daysPerMove: 3,
    preferredColor: 'white',
  });
  assert.equal(captured.status, 201);
  assert.equal(captured.body?.roomId, 'dchx_test-room');
  assert.equal(captured.body?.mode, 'correspondence');
  assert.equal(captured.body?.rated, false);
  assert.deepEqual(ctx.created, [
    { timeControl: correspondenceTimeControl(3), creatorPreference: 'white' },
  ]);
});

test('compressed dev allowances are accepted only behind the dev flag', async () => {
  const body = { gameSpecId: 'dark-chess', mode: 'correspondence', daysPerMove: 0.002 };
  {
    const { response, captured } = fakeResponse();
    await handleCorrespondenceCreate(createContext(), response, body);
    assert.equal(captured.status, 400);
  }
  process.env.MISTBOARD_DEV_CORRESPONDENCE_TC = 'true';
  try {
    const ctx = createContext();
    const { response, captured } = fakeResponse();
    await handleCorrespondenceCreate(ctx, response, body);
    assert.equal(captured.status, 201);
    assert.equal(ctx.created[0]?.timeControl.daysPerMove, 0.002);
    assert.equal(ctx.created[0]?.timeControl.initialMs, Math.round(0.002 * DAY_MS));
  } finally {
    delete process.env.MISTBOARD_DEV_CORRESPONDENCE_TC;
  }
});

test('the dark-chess registration claims the dchx_ prefix with correspondence identity', () => {
  const registration = variantTenantForRoomId('dchx_anything');
  assert.ok(registration);
  assert.equal(registration.kind, 'dark-chess');
  assert.equal(registration.errorPrefix, 'correspondence');
  assert.equal(registration.lobby, null);
  assert.notEqual(registration.sweepDueDeadline, null);
});

test('correspondence rooms never count against the drain gate', async () => {
  const registration = variantTenantForRoomId('dchx_drain');
  assert.ok(registration);
  const created = await createDarkChessCorrespondenceRoom(correspondenceTimeControl(3));
  assert.ok(created.ok);
  try {
    assert.equal(created.room.projection.state.status.type, 'playing');
    assert.equal(registration.activeGameCount(), 0);
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('sweepDarkChessDueDeadline flags a due in-memory room through the ws runtime', async () => {
  const roomId = 'dchx_due_sweep';
  const tc = correspondenceTimeControl(1);
  const events: DarkChessTenantEvent[] = [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'dark-chess', timeControl: tc },
    {
      type: 'clock-started',
      at: 1_000,
      roomId,
      clock: {
        activeColor: null,
        incrementMs: 0,
        initialMs: tc.initialMs,
        remainingMs: { black: tc.initialMs, white: tc.initialMs },
        runningSince: null,
      },
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'w', seat: 'white' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'b', seat: 'black' },
    { type: 'move-played', at: 4_000, roomId, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: 5_000, roomId, color: 'black', move: { from: 'e7', to: 'e5' } },
  ];
  const hydrated = createTenantRuntimeRoomFromEvents(darkChessTenant, events);
  assert.ok(hydrated.ok);
  darkChessTenantRooms.set(roomId, hydrated.room);
  try {
    // The epoch-era timestamps make the one-day allowance long overdue.
    await sweepDarkChessDueDeadline(roomId);
    const status = hydrated.room.projection.state.status;
    assert.equal(status.type, 'finished');
    assert.ok(status.type === 'finished');
    assert.equal(status.winner, 'black');
    assert.equal(status.reason, 'timeout');
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('a guest may take only the first seat of a correspondence room (#1059)', async () => {
  const created = await createDarkChessCorrespondenceRoom(correspondenceTimeControl(3));
  assert.ok(created.ok);
  const room = created.room;
  try {
    // The invite's creator, signed out, sits as a guest with a bearer token.
    const creator = assignTenantSeat(darkChessTenant, room, 'guest-client', undefined, null);
    assert.ok(creator.ok);
    assert.equal(creator.tokenState.userId, null);
    // A second guest (the friend, signed out) is refused; the close reason gives
    // the web shell its sign-in copy.
    const friendGuest = assignTenantSeat(darkChessTenant, room, 'anon-client', undefined, null);
    assert.deepEqual(friendGuest, { ok: false, reason: 'correspondence requires account' });
    const friend = assignTenantSeat(darkChessTenant, room, 'acct-client', undefined, signedIn);
    assert.ok(friend.ok);
    assert.notEqual(friend.seat, creator.seat);
    assert.equal(friend.tokenState.userId, signedIn.id);
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('signing in binds a guest correspondence seat; another browser cannot claim it (#1059)', async () => {
  const created = await createDarkChessCorrespondenceRoom(correspondenceTimeControl(3));
  assert.ok(created.ok);
  const room = created.room;
  try {
    const creator = assignTenantSeat(darkChessTenant, room, 'guest-client', undefined, null);
    assert.ok(creator.ok);
    assert.ok(creator.seatToken);
    const friendAccount = {
      id: 'friend-1',
      handle: 'friend',
      displayName: 'Friend',
    } as UserAccount;
    const friend = assignTenantSeat(
      darkChessTenant,
      room,
      'friend-client',
      undefined,
      friendAccount,
    );
    assert.ok(friend.ok);

    // Another browser, signed in or not, with no token gets no seat: both seats are held.
    const intruder = { id: 'intruder', handle: 'x', displayName: 'X' } as UserAccount;
    const stolen = assignTenantSeat(darkChessTenant, room, 'other-client', undefined, intruder);
    assert.deepEqual(stolen, { ok: false, reason: 'private room' });
    const stolenGuest = assignTenantSeat(darkChessTenant, room, 'other-guest', undefined, null);
    assert.equal(stolenGuest.ok, false);

    // The friend's account cannot fold the guest's seat into its own: no one plays both sides.
    const doubled = assignTenantSeat(
      darkChessTenant,
      room,
      'friend-2',
      creator.seatToken,
      friendAccount,
    );
    assert.ok(doubled.ok);
    assert.equal(room.seatTokens[creator.seat]?.userId, null);

    // The creator's browser signs in and reconnects with its token: the seat binds.
    const bound = assignTenantSeat(darkChessTenant, room, 'guest-2', creator.seatToken, signedIn);
    assert.ok(bound.ok);
    assert.equal(bound.seat, creator.seat);
    assert.equal(bound.tokenState.userId, signedIn.id);
    assert.equal(bound.tokenState.userHandle, signedIn.handle);
    // Once bound, the token alone no longer seats a different account or a guest.
    const replayed = assignTenantSeat(darkChessTenant, room, 'guest-3', creator.seatToken, null);
    assert.deepEqual(replayed, { ok: false, reason: 'private room' });
    // And the account reclaims the seat from any device without the token.
    const reclaimed = assignTenantSeat(darkChessTenant, room, 'phone', undefined, signedIn);
    assert.ok(reclaimed.ok);
    assert.equal(reclaimed.seat, creator.seat);
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('correspondence snapshots carry the chess-shell bridge extras', async () => {
  const roomId = 'dchx_extras';
  const created = await createDarkChessCorrespondenceRoom(correspondenceTimeControl(3));
  assert.ok(created.ok);
  const room = created.room;
  try {
    room.seatTokens.white = {
      clientId: 'w-client',
      seat: 'white',
      tokenHash: 'hash',
      userId: 'user-w',
      userHandle: 'whitey',
      userDisplayName: 'White Player',
      issuedAt: new Date(1_000),
      lastSeenAt: new Date(1_000),
      revokedAt: null,
    };
    const payload = tenantSnapshotPayload(darkChessTenant, room, {
      id: 'w-client',
      seat: 'white',
      solo: false,
    });
    assert.equal(payload.mode, 'correspondence');
    // The shell defaults rated to TRUE when absent; the extra keeps casual
    // correspondence labeled casual.
    assert.equal(payload.rated, false);
    assert.deepEqual(payload.seatDisplayNames, { white: 'White Player' });
    assert.equal(payload.timeControl?.daysPerMove, 3);
    void roomId;
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('accepting a seek seats both accounts and the game is live at once', async () => {
  const created = await createDarkChessCorrespondenceGameForSeek({
    timeControl: correspondenceTimeControl(3),
    first: { userId: 'creator-1' },
    second: { userId: 'accepter-2' },
  });
  assert.ok(created.ok);
  const room = darkChessTenantRooms.get(created.room.id);
  assert.ok(room);
  try {
    // Both seats are account-bound before either player connects, so each
    // reclaims by user id on connect (no raw token handed back).
    assert.equal(room.seatTokens.white?.userId, 'creator-1');
    assert.equal(room.seatTokens.black?.userId, 'accepter-2');
    assert.ok(room.projection.seats.white);
    assert.ok(room.projection.seats.black);

    // Live the instant the seek is accepted: status playing with an enforceable
    // deadline on white. Before the first move that's the first-move (abort)
    // window, not an armed clock — but it's the exact value the sweeper and the
    // deadline-row writer key off, so a non-null deadline proves white is on the
    // hook to move and the game can't sit idle forever.
    assert.equal(room.projection.state.status.type, 'playing');
    const deadline = tenantDurableDeadlineFor(darkChessTenant, room);
    assert.ok(deadline);
    assert.equal(deadline.seat, 'white');

    // Fog holds on an accept-created room: each seat gets a DIFFERENT redacted
    // view. A redaction bypass (sending canonical state) would make these equal.
    const whiteView = tenantSnapshotPayload(darkChessTenant, room, {
      id: room.seatTokens.white?.clientId ?? 'w',
      seat: 'white',
      solo: false,
    });
    const blackView = tenantSnapshotPayload(darkChessTenant, room, {
      id: room.seatTokens.black?.clientId ?? 'b',
      seat: 'black',
      solo: false,
    });
    assert.notDeepEqual(whiteView.state, blackView.state);
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('the seek game seats exactly the colors it is handed (creator-chose-black case)', async () => {
  // Color resolution lives in the route; the game function seats per its
  // explicit white/black args, so a creator who chose black lands on black.
  const created = await createDarkChessCorrespondenceGameForSeek({
    timeControl: correspondenceTimeControl(1),
    first: { userId: 'accepter' },
    second: { userId: 'creator' },
  });
  assert.ok(created.ok);
  const room = darkChessTenantRooms.get(created.room.id);
  assert.ok(room);
  try {
    assert.equal(room.seatTokens.white?.userId, 'accepter');
    assert.equal(room.seatTokens.black?.userId, 'creator');
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('ratedSeekError: the one rated gate for correspondence create and accept', async () => {
  const { ratedSeekError } = await import('./routes/correspondence-seeks.js');
  const threeDays = correspondenceTimeControl(3);
  assert.equal(ratedSeekError('xiangqi', threeDays, true), null);
  assert.equal(ratedSeekError('dark-chess', threeDays, true), null);
  // The server-wide rated switch, as the live lobby.
  assert.equal(ratedSeekError('xiangqi', threeDays, false), 'rated_disabled');
  // Not correspondence-rated (casual-only or not eligible): refused, never downgraded.
  assert.equal(ratedSeekError('mahjong', threeDays, true), 'rated_unsupported_spec');
  assert.equal(ratedSeekError('nope', threeDays, true), 'rated_unsupported_spec');
  // A compressed dev allowance has no pool, so it cannot be called rated.
  const devPace: RoomTimeControl = { initialMs: 900, incrementMs: 0, daysPerMove: 900 / DAY_MS };
  assert.equal(ratedSeekError('xiangqi', devPace, true), 'rated_unsupported_time_control');
});

test('a rated seek accept creates a rated room that stays rated through hydration', async () => {
  const created = await createDarkChessCorrespondenceGameForSeek({
    timeControl: correspondenceTimeControl(3),
    first: { userId: 'creator-r' },
    second: { userId: 'accepter-r' },
    rated: true,
  });
  assert.ok(created.ok);
  assert.equal(created.room.rated, true);
  const room = darkChessTenantRooms.get(created.room.id);
  assert.ok(room);
  try {
    assert.equal(room.rated, true);
    // Durable: the flag rides the room-created event, so a server restart keeps it.
    const hydrated = createTenantRuntimeRoomFromEvents(darkChessTenant, room.events);
    assert.ok(hydrated.ok);
    assert.equal(hydrated.room.rated, true);
    // And the casual default is unchanged.
    const casual = await createDarkChessCorrespondenceGameForSeek({
      timeControl: correspondenceTimeControl(3),
      first: { userId: 'creator-c' },
      second: { userId: 'accepter-c' },
    });
    assert.ok(casual.ok);
    assert.equal(casual.room.rated, false);
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('rated correspondence is held by default: the flag off refuses every rated seek', async () => {
  const { ratedSeekError } = await import('./routes/correspondence-seeks.js');
  const prior = {
    rated: process.env.MISTBOARD_RATED_ENABLED,
    corr: process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED,
  };
  process.env.MISTBOARD_RATED_ENABLED = 'true';
  try {
    delete process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED;
    assert.equal(ratedSeekError('xiangqi', correspondenceTimeControl(3)), 'rated_disabled');
    process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED = 'true';
    assert.equal(ratedSeekError('xiangqi', correspondenceTimeControl(3)), null);
    // The correspondence switch alone is not enough: live rated must be on too.
    process.env.MISTBOARD_RATED_ENABLED = 'false';
    assert.equal(ratedSeekError('xiangqi', correspondenceTimeControl(3)), 'rated_disabled');
  } finally {
    for (const [key, value] of [
      ['MISTBOARD_RATED_ENABLED', prior.rated],
      ['MISTBOARD_CORRESPONDENCE_RATED_ENABLED', prior.corr],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
