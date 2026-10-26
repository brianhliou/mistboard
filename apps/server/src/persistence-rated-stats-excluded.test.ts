/**
 * A stats-excluded account never plays rated (2026-10-26), against real Postgres.
 *
 * An operator or QA account (users.stats_excluded_at) is not counted, so a game
 * it plays must not move a counted player's rating: on 10-26 a rated xiangqi
 * mahjong game against @brianhliou-dev took a counted opponent from 1500 to
 * 1338. Every server entry point that can start a rated game refuses it with
 * 403 `rated_requires_counted_account` (or the opponent/target form), driven
 * here through the real routes and a real session cookie. Casual stays open.
 * The friend-room and seat gates are pinned in variant-tenant/lobby-rated.test.ts
 * and room-manager.test.ts; the rematch downgrade in rematch.test.ts and
 * jieqi-rematch.test.ts.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import {
  type AccountSession,
  createAccountSession,
  createUser,
  getCorrespondenceSeek,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { tryHandle as tryHandleSeekRoute } from './routes/correspondence-seeks.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle as tryHandleLobby } from './routes/lobby.js';
import { tryHandle as tryHandleRooms } from './routes/rooms.js';
import type { Room } from './server-types.js';
// Side-effect import: registers every tenant, so the lobby and accept routes find xiangqi.
import './variant-tenant/register-tenants.js';
import { xiangqiRooms } from './xiangqi-registration.js';

process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';
process.env.MISTBOARD_RATED_ENABLED = 'true';
// Rated correspondence is held in prod; the gate must hold even with it on.
process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED = 'true';
process.env.MISTBOARD_XIANGQI_ENABLED = 'true';

const BLITZ = { initialMs: 180_000, incrementMs: 2_000 };
const COUNTED_ERROR = 'rated_requires_counted_account';

definePersistenceTests('rated stats-excluded', () => {
  test('lobby: an excluded account cannot post a rated seek; casual is open', async () => {
    const ex = await seedUser('rx-ex', { excluded: true });
    const ctx = lobbyContext();
    const rated = await callLobby(ctx, await makeSessionCookie(ex), {
      gameSpecId: XIANGQI_SPEC_ID,
      timeControl: BLITZ,
      rated: true,
    });
    assert.equal(rated.status, 403);
    assert.deepEqual(rated.json, { error: COUNTED_ERROR });
    assert.equal(ctx.lobbyQueue.length, 0, 'no rated ticket was queued');

    const casual = await callLobby(ctx, await makeSessionCookie(ex), {
      gameSpecId: XIANGQI_SPEC_ID,
      timeControl: BLITZ,
    });
    assert.equal(casual.status, 202, 'casual seeks are untouched');
  });

  test('lobby: an excluded account cannot accept a counted player rated seek', async () => {
    const counted = await seedUser('rx-counted');
    const ex = await seedUser('rx-ex2', { excluded: true });
    const ctx = lobbyContext();
    const waiting = await callLobby(ctx, await makeSessionCookie(counted), {
      gameSpecId: XIANGQI_SPEC_ID,
      timeControl: BLITZ,
      rated: true,
    });
    assert.equal(waiting.status, 202, 'the counted rated seek waits');

    const accept = await callLobby(ctx, await makeSessionCookie(ex), {
      gameSpecId: XIANGQI_SPEC_ID,
      timeControl: BLITZ,
      rated: true,
    });
    assert.equal(accept.status, 403);
    assert.deepEqual(accept.json, { error: COUNTED_ERROR });
    assert.equal(ctx.lobbyQueue.length, 1, 'the counted seek is still waiting');
    assert.equal(xiangqiRooms.size, 0, 'no rated room was created');

    // A casual seek from the excluded account never pairs into the rated pool.
    const casual = await callLobby(ctx, await makeSessionCookie(ex), {
      gameSpecId: XIANGQI_SPEC_ID,
      timeControl: BLITZ,
    });
    assert.equal(casual.status, 202, 'casual waits on its own, not matched rated');
    assert.equal(xiangqiRooms.size, 0);
  });

  test('legacy rooms: an excluded account gets a casual room by default and 403 on rated', async () => {
    const ex = await seedUser('rx-legacy', { excluded: true });
    const counted = await seedUser('rx-legacy-counted');
    const calls: unknown[][] = [];
    const ctx = lobbyContext({
      createRoom: async (...args: unknown[]) => {
        calls.push(args);
        return { id: `room_chess_${calls.length}`, region: 'global' } as unknown as Room;
      },
    } as Partial<HttpApiContext>);

    const refused = await callRooms(ctx, await makeSessionCookie(ex), { mode: 'pvp', rated: true });
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.json, { error: COUNTED_ERROR });
    assert.equal(calls.length, 0);

    const byDefault = await callRooms(ctx, await makeSessionCookie(ex), { mode: 'pvp' });
    assert.equal(byDefault.status, 201);
    assert.equal(calls[0]?.[4], false, 'the signed-in default is casual for an excluded account');

    const countedDefault = await callRooms(ctx, await makeSessionCookie(counted), { mode: 'pvp' });
    assert.equal(countedDefault.status, 201);
    assert.equal(calls[1]?.[4], true, 'a counted account still defaults to rated');
  });

  test('correspondence: an excluded account cannot post a rated seek; casual is open', async () => {
    const ex = await seedUser('rx-cx', { excluded: true });
    const cookie = await makeSessionCookie(ex);
    const rated = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      rated: true,
    });
    assert.equal(rated.status, 403);
    assert.equal(rated.json.error, COUNTED_ERROR);
    const casual = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
    });
    assert.equal(casual.status, 201);
    assert.equal((casual.json.seek as { rated: boolean }).rated, false);
  });

  test('correspondence: a rated seek accepted by an excluded account is refused', async () => {
    const counted = await seedUser('rx-cc');
    const ex = await seedUser('rx-ca', { excluded: true });
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
    assert.equal(accept.status, 403);
    assert.equal(accept.json.error, COUNTED_ERROR);
    assert.equal(await seekOpen(seekId), true, 'the refused accept took nothing');
  });

  test('correspondence: a rated seek whose creator became excluded cannot be accepted', async () => {
    const creator = await seedUser('rx-cr');
    const accepter = await seedUser('rx-ac');
    const posted = await callSeekRoute(
      'POST',
      '/api/correspondence/seeks',
      await makeSessionCookie(creator),
      { gameSpecId: XIANGQI_SPEC_ID, daysPerMove: 3, rated: true },
    );
    assert.equal(posted.status, 201);
    const seekId = (posted.json.seek as { id: string }).id;
    // A seek posted before the flag was set (or by a stale client) stays unacceptable.
    await getPool().query('UPDATE users SET stats_excluded_at = now() WHERE id = $1', [creator]);
    const accept = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      await makeSessionCookie(accepter),
    );
    assert.equal(accept.status, 409);
    assert.equal(accept.json.error, 'opponent_rated_requires_counted_account');
    assert.equal(await seekOpen(seekId), true);
  });

  test('correspondence: a rated challenge cannot name an excluded account', async () => {
    const counted = await seedUser('rx-ch');
    await seedUser('rx-tg', { excluded: true });
    const cookie = await makeSessionCookie(counted);
    const rated = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      rated: true,
      targetHandle: 'rx-tg',
    });
    assert.equal(rated.status, 403);
    assert.equal(rated.json.error, 'target_rated_requires_counted_account');
    const casual = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      targetHandle: 'rx-tg',
    });
    assert.equal(casual.status, 201, 'a casual challenge to the same account is open');
  });
});

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
