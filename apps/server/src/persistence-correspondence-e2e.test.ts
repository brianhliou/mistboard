/**
 * Correspondence end-to-end against real Postgres: the full durable loop from
 * room creation through writer-maintained deadline rows to sweeper
 * enforcement. Time is real, not injected — rooms are created with a
 * sub-second compressed days-per-move allowance (the same lever as
 * MISTBOARD_DEV_CORRESPONDENCE_TC manual testing) and the test waits past the
 * deadline, so the sweeper's own clock comparisons run unmocked. The
 * in-memory room cache is cleared before each sweep, so every enforcement
 * here also proves the server-restart path (hydration from the event log +
 * seat tokens).
 */

import { DAY_MS, type RoomTimeControl, type Square } from '@mistboard/game';
import {
  createDarkChessCorrespondenceRoom,
  darkChessTenantRooms,
  getOrLoadDarkChessTenantRoom,
} from './dark-chess-registration.js';
import { type DarkChessTenantEvent, darkChessTenant } from './dark-chess-tenant.js';
import { createUser, getGameSummary, loadRoom, type UserAccount } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { hashSeatToken } from './server-seat-session.js';
import { startTenantDeadlineSweeper } from './variant-tenant/deadline-sweeper.js';
import { appendTenantEvent, appendTenantSeatAssigned } from './variant-tenant/events.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';
import { assignTenantSeat, type TenantSeatAssignment } from './variant-tenant/seat-session.js';
import type { TenantSeatTokenState } from './variant-tenant/tenant.js';

// Long enough that room setup (a handful of single-row writes) always fits
// inside the first allowance window; short enough to keep the suite fast.
const ALLOWANCE_MS = 900;
const SETTLE_MS = 1_400;

const COMPRESSED_TC: RoomTimeControl = {
  initialMs: ALLOWANCE_MS,
  incrementMs: 0,
  daysPerMove: ALLOWANCE_MS / DAY_MS,
};

definePersistenceTests('correspondence e2e', () => {
  test('deadline lapse: writer rows, cold-cache sweep, timeout result', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const created = await createDarkChessCorrespondenceRoom(COMPRESSED_TC, 'white');
    assert.ok(created.ok);
    const room = created.room;

    await appendTenantSeatAssigned(
      darkChessTenant,
      room,
      { event: seatAssigned(room.id, 'white', 'w-client'), tokenState: token('white', alice) },
      {},
    );
    await appendTenantSeatAssigned(
      darkChessTenant,
      room,
      { event: seatAssigned(room.id, 'black', 'b-client'), tokenState: token('black', bob) },
      {},
    );
    await appendTenantEvent(darkChessTenant, room, move(room.id, 'white', 'e2', 'e4'));
    await appendTenantEvent(darkChessTenant, room, move(room.id, 'black', 'e7', 'e5'));

    // The writer maintained the durable row: white is on move with the
    // allowance running, and the row carries the seat's account for the C2
    // notification queue.
    const armed = await deadlineRow(room.id);
    assert.ok(armed, 'expected a room_deadlines row after the second move');
    assert.equal(armed.seat, 'white');
    assert.equal(armed.seat_user_id, alice);
    assert.ok(armed.due_at.getTime() > Date.now() - ALLOWANCE_MS);

    // Restart path: nothing in memory when the deadline lapses.
    darkChessTenantRooms.clear();
    await sleep(SETTLE_MS);
    await sweepOnce();

    const hydrated = await getOrLoadDarkChessTenantRoom(room.id);
    assert.ok(hydrated);
    const status = hydrated.projection.state.status;
    assert.equal(status.type, 'finished');
    assert.ok(status.type === 'finished');
    assert.equal(status.winner, 'black');
    assert.equal(status.reason, 'timeout');

    const summary = await getGameSummary(room.id);
    assert.ok(summary, 'expected a completed games row');
    assert.equal(summary.result, 'black-wins');
    assert.equal(summary.termination, 'timeout');

    const events = await loadRoom(room.id);
    assert.ok(events);
    assert.equal(events[events.length - 1]?.type, 'clock-expired');

    assert.equal(await deadlineRow(room.id), null);
    darkChessTenantRooms.clear();
  });

  test('first-move no-show: no row while a seat is open, abort once due', async () => {
    const carol = await makeUser('carol');
    const dan = await makeUser('dan');
    const created = await createDarkChessCorrespondenceRoom(COMPRESSED_TC, 'white');
    assert.ok(created.ok);
    const room = created.room;

    await appendTenantSeatAssigned(
      darkChessTenant,
      room,
      { event: seatAssigned(room.id, 'white', 'w-client'), tokenState: token('white', carol) },
      {},
    );
    // An outstanding invite is not a countdown: with one seat open there is no
    // enforceable deadline and no durable row.
    assert.equal(await deadlineRow(room.id), null);

    await appendTenantSeatAssigned(
      darkChessTenant,
      room,
      { event: seatAssigned(room.id, 'black', 'b-client'), tokenState: token('black', dan) },
      {},
    );
    const armed = await deadlineRow(room.id);
    assert.ok(armed, 'expected a row once both seats are claimed');
    assert.equal(armed.seat, 'white');

    darkChessTenantRooms.clear();
    await sleep(SETTLE_MS);
    await sweepOnce();

    const hydrated = await getOrLoadDarkChessTenantRoom(room.id);
    assert.ok(hydrated);
    assert.equal(hydrated.projection.state.status.type, 'aborted');

    // Aborts flip the running games row instead of recording a result.
    const gamesRow = await queryOne(
      `SELECT status, termination, result FROM games WHERE room_id = $1`,
      [room.id],
    );
    assert.ok(gamesRow);
    assert.equal(gamesRow.status, 'aborted');
    assert.equal(gamesRow.termination, 'abandoned');
    assert.equal(gamesRow.result, null);

    const events = await loadRoom(room.id);
    assert.ok(events);
    assert.equal(events[events.length - 1]?.type, 'game-aborted');

    assert.equal(await deadlineRow(room.id), null);
    darkChessTenantRooms.clear();
  });

  // #1059: a signed-out visitor creates a friend invite, sits as a guest, and
  // is asked to sign in once the friend (an account) has sat. These drive the
  // real create binding and the real seat assignment, then append the seat the
  // way the WebSocket connect does on every (re)connect. (One
  // definePersistenceTests per file: each registers its own migration hook.)
  test('a guest invite: account joins, the guest signs in and keeps the seat', async () => {
    const room = await createGuestInvite();
    const guest = assignTenantSeat(darkChessTenant, room, 'g-client', undefined, null);
    assert.ok(guest.ok);
    assert.equal(guest.seat, 'white');
    assert.ok(guest.seatToken, 'a guest seat is a bearer token like any live guest seat');
    await appendSeat(room, guest);
    // One seat open: no countdown yet, so nothing for the sweeper or digest.
    assert.equal(await deadlineRow(room.id), null);

    const friend = await makeAccount('frank');
    const joined = assignTenantSeat(darkChessTenant, room, 'f-client', undefined, friend);
    assert.ok(joined.ok);
    assert.equal(joined.seat, 'black');
    await appendSeat(room, joined);
    const armed = await deadlineRow(room.id);
    assert.ok(armed, 'both seats taken arms the first-move window');
    assert.equal(armed.seat, 'white');
    // The guest's seat has no account yet: the digest skips a null seat user.
    assert.equal(armed.seat_user_id, null);

    // A third browser, signed in, cannot take the guest's seat.
    const stranger = await makeAccount('sly');
    const refused = assignTenantSeat(darkChessTenant, room, 's-client', undefined, stranger);
    assert.deepEqual(refused, { ok: false, reason: 'private room' });

    // The guest signs in; the same browser reconnects with its token and the
    // seat binds to the account, durably.
    const gina = await makeAccount('gina');
    const bound = assignTenantSeat(darkChessTenant, room, 'g-client-2', guest.seatToken, gina);
    assert.ok(bound.ok);
    assert.equal(bound.seat, 'white');
    await appendSeat(room, bound);
    const rebound = await deadlineRow(room.id);
    assert.equal(rebound?.seat_user_id, gina.id);
    const tokenRow = await queryOne<{ user_id: string | null }>(
      `SELECT user_id FROM room_seat_tokens WHERE room_id = $1 AND seat = 'white'`,
      [room.id],
    );
    assert.equal(tokenRow?.user_id, gina.id);

    // Restart path: the hydrated room knows the seat's account, so the account
    // reclaims it from any device with no token.
    darkChessTenantRooms.clear();
    const hydrated = await getOrLoadDarkChessTenantRoom(room.id);
    assert.ok(hydrated);
    assert.equal(hydrated.seatTokens.white?.userId, gina.id);
    const phone = assignTenantSeat(darkChessTenant, hydrated, 'phone', undefined, gina);
    assert.ok(phone.ok);
    assert.equal(phone.seat, 'white');
    darkChessTenantRooms.clear();
  });

  test('a guest invite nobody moves in aborts on sweep (pregame-timeout)', async () => {
    const room = await createGuestInvite();
    const guest = assignTenantSeat(darkChessTenant, room, 'g-client', undefined, null);
    assert.ok(guest.ok);
    await appendSeat(room, guest);
    const joined = assignTenantSeat(
      darkChessTenant,
      room,
      'f-client',
      undefined,
      await makeAccount('fay'),
    );
    assert.ok(joined.ok);
    await appendSeat(room, joined);
    assert.ok(await deadlineRow(room.id));

    darkChessTenantRooms.clear();
    await sleep(SETTLE_MS);
    await sweepOnce();

    const events = await loadRoom(room.id);
    assert.ok(events);
    const last = events[events.length - 1] as { type: string; reason?: string };
    assert.equal(last.type, 'game-aborted');
    assert.equal(last.reason, 'pregame-timeout');
    const hydrated = await getOrLoadDarkChessTenantRoom(room.id);
    assert.equal(hydrated?.projection.state.status.type, 'aborted');
    assert.equal(await deadlineRow(room.id), null);
    darkChessTenantRooms.clear();
  });
});

// The registration's invite create, as POST /api/rooms calls it.
async function createGuestInvite() {
  const registration = registeredVariantTenants().find(
    (entry) => entry.gameSpecId === 'dark-chess',
  );
  assert.ok(registration?.createCorrespondenceRoom);
  const created = await registration.createCorrespondenceRoom(COMPRESSED_TC, 'white');
  assert.ok(created.ok);
  const room = await getOrLoadDarkChessTenantRoom(created.room.id);
  assert.ok(room);
  return room;
}

async function appendSeat(
  room: NonNullable<Awaited<ReturnType<typeof getOrLoadDarkChessTenantRoom>>>,
  assignment: Extract<TenantSeatAssignment<'white' | 'black'>, { ok: true }>,
): Promise<void> {
  await appendTenantSeatAssigned(
    darkChessTenant,
    room,
    {
      event: seatAssigned(room.id, assignment.seat, assignment.tokenState.clientId),
      tokenState: assignment.tokenState,
    },
    {},
  );
}

async function makeAccount(handle: string): Promise<UserAccount> {
  const id = await makeUser(handle);
  return { id, handle, displayName: capitalize(handle) } as UserAccount;
}

async function sweepOnce(): Promise<void> {
  // Real listDue + real registry routing; only the interval is parked so the
  // single tick below is the only sweep.
  const sweeper = startTenantDeadlineSweeper({ intervalMs: 3_600_000 });
  try {
    await sweeper.tick();
  } finally {
    sweeper.stop();
  }
}

async function makeUser(handle: string): Promise<string> {
  const id = `user-${handle}`;
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: new Date(),
    handle,
    displayName: capitalize(handle),
    now: new Date(),
  });
  return id;
}

function seatAssigned(
  roomId: string,
  seat: 'white' | 'black',
  clientId: string,
): Extract<DarkChessTenantEvent, { type: 'seat-assigned' }> {
  return { type: 'seat-assigned', at: Date.now(), roomId, clientId, seat };
}

function move(
  roomId: string,
  color: 'white' | 'black',
  from: Square,
  to: Square,
): DarkChessTenantEvent {
  return {
    type: 'move-played',
    at: Date.now(),
    roomId,
    color,
    move: { from, to },
  };
}

function token(seat: 'white' | 'black', userId: string): TenantSeatTokenState<'white' | 'black'> {
  const now = new Date();
  return {
    clientId: `${seat}-client`,
    seat,
    tokenHash: hashSeatToken(`${seat}-token-${userId}`),
    userId,
    userHandle: userId.replace(/^user-/, ''),
    userDisplayName: capitalize(userId.replace(/^user-/, '')),
    issuedAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
}

// Direct row read: listDueRoomDeadlines filters on due_at, but these
// assertions need to see not-yet-due rows (and seat_user_id) too.
async function deadlineRow(
  roomId: string,
): Promise<{ seat: string; seat_user_id: string | null; due_at: Date } | null> {
  return queryOne(`SELECT seat, seat_user_id, due_at FROM room_deadlines WHERE room_id = $1`, [
    roomId,
  ]);
}

async function queryOne<T extends Record<string, unknown>>(
  sql: string,
  values: unknown[],
): Promise<T | null> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(sql, values);
    return (rows[0] as T) ?? null;
  } finally {
    await client.end();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
