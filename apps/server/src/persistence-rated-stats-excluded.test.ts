/**
 * Rated play for stats-excluded accounts (2026-11-26), against real Postgres.
 *
 * An operator or QA account (users.stats_excluded_at) plays rated against real
 * people like any signed-in account, and its ratings move with its opponent's.
 * A rated game is never formed between two stats-excluded accounts: where the
 * second one arrives (the lobby match, a correspondence accept or directed
 * challenge, the legacy seat) it is refused, driven here through the real
 * routes and a real session cookie. Where the opponent is unknown (posting a
 * seek, creating a room) it is open. The tenant seat gate is pinned in
 * variant-tenant/lobby-rated.test.ts, the rematch downgrade in rematch.test.ts
 * and jieqi-rematch.test.ts, live invites in routes/live-invites*.test.ts.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import { markFairPlay, unmarkFairPlay } from './fair-play.js';
import {
  type AccountSession,
  createAccountSession,
  createUser,
  findUserByHandle,
  getCorrespondenceSeek,
} from './persistence.js';
import { getPool, withTransaction } from './persistence-db.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { ratedSeatPairsTwoExcluded } from './rated-stats-excluded.js';
import { tryHandle as tryHandleSeekRoute } from './routes/correspondence-seeks.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle as tryHandleLobby } from './routes/lobby.js';
import { tryHandle as tryHandleRooms } from './routes/rooms.js';
import { assignSeat } from './server-seat-session.js';
import type { Room, SeatTokenState } from './server-types.js';
import { roomFixture } from './test-builders.js';
import { appendTenantEvent } from './variant-tenant/events.js';
// Side-effect import: registers every tenant, so the lobby and accept routes find xiangqi.
import './variant-tenant/register-tenants.js';
import { getOrLoadXiangqiRoom, xiangqiRooms } from './xiangqi-registration.js';
import type { XiangqiEvent } from './xiangqi-runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';
process.env.MISTBOARD_RATED_ENABLED = 'true';
process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED = 'true';
process.env.MISTBOARD_XIANGQI_ENABLED = 'true';

const BLITZ = { initialMs: 180_000, incrementMs: 2_000 };

definePersistenceTests('rated stats-excluded', () => {
  test('fair play: marked rated seek post/accept and live entry refuse; unmark reopens rated', async () => {
    const markedId = await seedUser('fp-marked');
    const otherId = await seedUser('fp-other');
    const markedCookie = await makeSessionCookie(markedId);
    const otherCookie = await makeSessionCookie(otherId);
    const body = { gameSpecId: XIANGQI_SPEC_ID, daysPerMove: 3, rated: true };
    const existing = await callSeekRoute('POST', '/api/correspondence/seeks', markedCookie, body);
    assert.equal(existing.status, 201);
    const existingId = (existing.json.seek as { id: string }).id;
    await withTransaction((client) => markFairPlay(client, markedId));
    const posted = await callSeekRoute('POST', '/api/correspondence/seeks', markedCookie, body);
    assert.equal(posted.status, 403);
    assert.equal(posted.json.error, 'rated_account_marked');
    const acceptMarkedCreator = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${existingId}/accept`,
      otherCookie,
    );
    assert.equal(acceptMarkedCreator.status, 403);
    assert.equal(acceptMarkedCreator.json.error, 'rated_account_marked');
    assert.equal(await seekOpen(existingId), true);
    const otherSeek = await callSeekRoute('POST', '/api/correspondence/seeks', otherCookie, body);
    assert.equal(otherSeek.status, 201);
    const otherSeekId = (otherSeek.json.seek as { id: string }).id;
    const accept = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${otherSeekId}/accept`,
      markedCookie,
    );
    assert.equal(accept.status, 403);
    assert.equal(accept.json.error, 'rated_account_marked');
    assert.equal(await seekOpen(otherSeekId), true);
    const casual = await callSeekRoute('POST', '/api/correspondence/seeks', markedCookie, {
      ...body,
      rated: false,
    });
    assert.equal(casual.status, 201);
    for (const call of [callLobby, callRooms]) {
      const refused = await call(lobbyContext(), markedCookie, {
        gameSpecId: XIANGQI_SPEC_ID,
        timeControl: BLITZ,
        mode: 'pvp',
        rated: true,
      });
      assert.equal(refused.status, 403);
      assert.equal(refused.json.error, 'rated_account_marked');
    }
    const challenge = await callSeekRoute('POST', '/api/correspondence/seeks', otherCookie, {
      ...body,
      targetHandle: 'fp-marked',
    });
    assert.equal(challenge.status, 403);
    assert.equal(challenge.json.error, 'rated_account_marked');
    await withTransaction((client) => unmarkFairPlay(client, markedId));
    const reopened = await callSeekRoute('POST', '/api/correspondence/seeks', markedCookie, body);
    assert.equal(reopened.status, 200);
    const accepted = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${otherSeekId}/accept`,
      markedCookie,
    );
    assert.equal(accepted.status, 201);
  });
  test('lobby: an excluded account seeks rated and pairs with a counted one, never another excluded one', async () => {
    const ex = await seedUser('rx-ex', { excluded: true });
    const ex2 = await seedUser('rx-ex2', { excluded: true });
    const counted = await seedUser('rx-counted');
    const ctx = lobbyContext();
    const rated = { gameSpecId: XIANGQI_SPEC_ID, timeControl: BLITZ, rated: true };
    const waiting = await callLobby(ctx, await makeSessionCookie(ex), rated);
    assert.equal(waiting.status, 202, 'the excluded rated seek waits');

    // A second excluded account does not take it; it waits for someone else.
    const second = await callLobby(ctx, await makeSessionCookie(ex2), rated);
    assert.equal(second.status, 202);
    assert.equal(ctx.lobbyQueue.length, 2, 'both excluded seeks are still waiting');
    assert.equal(xiangqiRooms.size, 0, 'no rated room was created');

    // A counted account pairs with the first excluded seek into a rated room.
    const matched = await callLobby(ctx, await makeSessionCookie(counted), rated);
    assert.equal(matched.status, 201);
    const room = xiangqiRooms.get(matched.json.roomId as string);
    assert.equal(room?.rated, true, 'the excluded vs counted game is rated');
    assert.equal(ctx.lobbyQueue.length, 1, 'the second excluded seek still waits');
  });

  test('legacy rooms: an excluded account gets a rated room by default and on request', async () => {
    const ex = await seedUser('rx-legacy', { excluded: true });
    const calls: unknown[][] = [];
    const ctx = lobbyContext({
      createRoom: async (...args: unknown[]) => {
        calls.push(args);
        return { id: `room_chess_${calls.length}`, region: 'global' } as unknown as Room;
      },
    } as Partial<HttpApiContext>);

    const requested = await callRooms(ctx, await makeSessionCookie(ex), {
      mode: 'pvp',
      rated: true,
    });
    assert.equal(requested.status, 201);
    assert.equal(calls[0]?.[4], true);
    const byDefault = await callRooms(ctx, await makeSessionCookie(ex), { mode: 'pvp' });
    assert.equal(byDefault.status, 201);
    assert.equal(calls[1]?.[4], true, 'the signed-in default is rated for an excluded account too');
  });

  test('legacy seat: a rated room seats an excluded account beside a counted one, refuses a second excluded one', async () => {
    await seedUser('rx-seat-a', { excluded: true });
    await seedUser('rx-seat-b', { excluded: true });
    await seedUser('rx-seat-c');
    const exA = await account('rx-seat-a');
    const exB = await account('rx-seat-b');
    const counted = await account('rx-seat-c');
    // The default lookup reads the opponent's flag from the database.
    const facing = (userId: string) => ({ white: seatHolder(userId) });
    assert.equal(await ratedSeatPairsTwoExcluded(exB, facing(exA.id)), true);
    assert.equal(await ratedSeatPairsTwoExcluded(exB, facing(counted.id)), false);
    assert.equal(await ratedSeatPairsTwoExcluded(counted, facing(exA.id)), false);

    // The second excluded account is refused before anything is written.
    const room = roomFixture({ id: 'room-rx-seat', rated: true });
    room.seatTokens.white = seatHolder(exA.id);
    const ctx = { send() {}, recordPersistenceError() {} } as never;
    const refused = await assignSeat(ctx, room, 'client-b', undefined, exB);
    assert.equal(refused.seat, 'spectator');
    assert.equal(refused.deniedReason, 'rated-requires-counted-account');
    assert.equal(room.seatTokens.black, undefined, 'no seat was taken');
  });

  test('correspondence: an excluded seek accepted by a counted account is rated and moves both ratings', async () => {
    const ex = await seedUser('rx-cx', { excluded: true });
    const counted = await seedUser('rx-cc');
    const posted = await callSeekRoute(
      'POST',
      '/api/correspondence/seeks',
      await makeSessionCookie(ex),
      {
        gameSpecId: XIANGQI_SPEC_ID,
        daysPerMove: 3,
        preferredColor: 'first',
        rated: true,
      },
    );
    assert.equal(posted.status, 201);
    assert.equal((posted.json.seek as { rated: boolean }).rated, true);
    const seekId = (posted.json.seek as { id: string }).id;
    const accepted = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      await makeSessionCookie(counted),
    );
    assert.equal(accepted.status, 201);
    assert.equal(accepted.json.rated, true);
    const roomId = accepted.json.roomId as string;

    xiangqiRooms.clear();
    const room = await getOrLoadXiangqiRoom(roomId);
    assert.ok(room);
    assert.equal(room.rated, true);
    await appendTenantEvent(xiangqiTenant, room, move(roomId, 'red', 'b3', 'b4'));
    await appendTenantEvent(xiangqiTenant, room, move(roomId, 'black', 'b8', 'b7'));
    await appendTenantEvent(xiangqiTenant, room, {
      type: 'seat-resigned',
      at: Date.now(),
      roomId,
      color: 'black',
    });
    await room.pendingWrites;

    const { rows } = await getPool().query<{ user_id: string; elo_rating: number }>(
      `SELECT user_id, elo_rating FROM user_ratings
       WHERE user_id = ANY($1) AND variant = 'xiangqi' AND time_class = 'correspondence'`,
      [[ex, counted]],
    );
    const exRating = rows.find((row) => row.user_id === ex)?.elo_rating;
    const countedRating = rows.find((row) => row.user_id === counted)?.elo_rating;
    assert.ok(exRating !== undefined && exRating > 1500, 'the excluded winner gained');
    assert.ok(countedRating !== undefined && countedRating < 1500, 'the counted resigner lost');
    xiangqiRooms.clear();
  });

  test('correspondence: an excluded account accepts a counted rated seek', async () => {
    const counted = await seedUser('rx-cc2');
    const ex = await seedUser('rx-ca2', { excluded: true });
    const posted = await callSeekRoute(
      'POST',
      '/api/correspondence/seeks',
      await makeSessionCookie(counted),
      { gameSpecId: XIANGQI_SPEC_ID, daysPerMove: 3, rated: true },
    );
    assert.equal(posted.status, 201);
    const seekId = (posted.json.seek as { id: string }).id;
    const accept = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      await makeSessionCookie(ex),
    );
    assert.equal(accept.status, 201);
    assert.equal(accept.json.rated, true);
    xiangqiRooms.clear();
  });

  test('correspondence: an excluded account cannot accept another excluded rated seek', async () => {
    const creator = await seedUser('rx-cr', { excluded: true });
    const accepter = await seedUser('rx-ac', { excluded: true });
    const posted = await callSeekRoute(
      'POST',
      '/api/correspondence/seeks',
      await makeSessionCookie(creator),
      { gameSpecId: XIANGQI_SPEC_ID, daysPerMove: 3, rated: true },
    );
    assert.equal(posted.status, 201);
    const seekId = (posted.json.seek as { id: string }).id;
    const accept = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      await makeSessionCookie(accepter),
    );
    assert.equal(accept.status, 409);
    assert.equal(accept.json.error, 'opponent_rated_requires_counted_account');
    assert.equal(await seekOpen(seekId), true, 'the refused accept took nothing');
  });

  test('correspondence: an excluded account cannot challenge another excluded account rated', async () => {
    await seedUser('rx-ch', { excluded: true });
    const counted = await seedUser('rx-ch-counted');
    await seedUser('rx-tg', { excluded: true });
    const body = {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      rated: true,
      targetHandle: 'rx-tg',
    };
    const exCookie = await makeSessionCookie(`user-rx-ch`);
    const rated = await callSeekRoute('POST', '/api/correspondence/seeks', exCookie, body);
    assert.equal(rated.status, 403);
    assert.equal(rated.json.error, 'target_rated_requires_counted_account');
    const casual = await callSeekRoute('POST', '/api/correspondence/seeks', exCookie, {
      ...body,
      rated: false,
    });
    assert.equal(casual.status, 201, 'a casual challenge between them is open');
    const fromCounted = await callSeekRoute(
      'POST',
      '/api/correspondence/seeks',
      await makeSessionCookie(counted),
      body,
    );
    assert.equal(fromCounted.status, 201, 'a counted account challenges an excluded one rated');
  });
});

async function account(handle: string) {
  const user = await findUserByHandle(handle);
  if (!user) throw new Error(`no account ${handle}`);
  return user;
}

function seatHolder(userId: string): SeatTokenState {
  const now = new Date();
  return {
    clientId: `client-${userId}`,
    deviceId: null,
    seat: 'white',
    tokenHash: `hash-${userId}`,
    userId,
    userHandle: null,
    userDisplayName: null,
    issuedAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
}

function move(roomId: string, color: 'red' | 'black', from: string, to: string): XiangqiEvent {
  return { type: 'move-played', at: Date.now(), roomId, color, move: { from, to } } as XiangqiEvent;
}

async function seedUser(handle: string, opts: { excluded?: boolean } = {}): Promise<string> {
  const id = `user-${handle}`;
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: new Date(),
    handle,
    displayName: handle,
    now: new Date(),
  });
  if (opts.excluded) {
    await getPool().query('UPDATE users SET stats_excluded_at = now() WHERE id = $1', [id]);
  }
  return id;
}

let sessionSeq = 0;
async function makeSessionCookie(userId: string): Promise<string> {
  sessionSeq += 1;
  const sessionId = `sess_${userId}_${sessionSeq}`;
  const token = `tok_${userId}_${sessionSeq}`;
  const session: AccountSession = {
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  await createAccountSession(session);
  return `mistboard_session=${sessionId}.${token}`;
}

// An accepted seek row is deleted (043_correspondence_seeks.sql), so a refused
// accept leaves it in place.
async function seekOpen(seekId: string): Promise<boolean> {
  return (await getCorrespondenceSeek(seekId)) !== null;
}

function lobbyContext(overrides: Partial<HttpApiContext> = {}): HttpApiContext {
  xiangqiRooms.clear();
  return {
    abandonRoom: async () => ({ ok: false, error: 'not_found' }),
    activeGameCount: () => 0,
    annotationsFile: '',
    createRoom: async () => {
      throw new Error('chess createRoom is not expected here');
    },
    databaseRequired: false,
    drainDeadlineMs: () => null,
    inMemoryGameSummary: () => null,
    refusesCreate: () => false,
    liveClockIncrementMs: 2000,
    liveClockInitialMs: 180000,
    lobbyQueue: [],
    lobbyTickets: new Map(),
    pveBuiltinEngineClientId: 'engine',
    releaseLiveEngineReservation: () => {},
    reserveLiveEngineSeat: async () => null,
    rooms: new Map(),
    ...overrides,
  } as unknown as HttpApiContext;
}

type Result = { status: number | null; json: Record<string, unknown> };

function capture(): { response: ServerResponse; result: () => Result } {
  const state = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      state.status = status;
      return state;
    },
    setHeader() {
      return state;
    },
    end(chunk?: string) {
      state.body += chunk ?? '';
      return state;
    },
  };
  return {
    response: state as unknown as ServerResponse,
    result: () => ({ status: state.status, json: JSON.parse(state.body || '{}') }),
  };
}

function jsonRequest(method: string, cookie: string, body?: Record<string, unknown>) {
  return Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
    method,
    headers: { cookie },
  }) as unknown as IncomingMessage;
}

async function callLobby(
  ctx: HttpApiContext,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Result> {
  const { response, result } = capture();
  const handled = await tryHandleLobby(
    ctx,
    jsonRequest('POST', cookie, body),
    response,
    '/api/lobby',
  );
  assert.equal(handled, true);
  return result();
}

async function callRooms(
  ctx: HttpApiContext,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Result> {
  const { response, result } = capture();
  const handled = await tryHandleRooms(
    ctx,
    jsonRequest('POST', cookie, body),
    response,
    '/api/rooms',
  );
  assert.equal(handled, true);
  return result();
}

const notDraining = {
  refusesCreate: () => false,
  drainDeadlineMs: () => null,
} as unknown as HttpApiContext;

async function callSeekRoute(
  method: string,
  path: string,
  cookie: string,
  body?: Record<string, unknown>,
): Promise<Result> {
  const { response, result } = capture();
  const handled = await tryHandleSeekRoute(
    notDraining,
    jsonRequest(method, cookie, body),
    response,
    path,
  );
  assert.equal(handled, true, `${method} ${path} should be claimed`);
  return result();
}
