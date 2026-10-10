/**
 * #527: a dead /challenge/<id> link says what happened to the offer. Accept,
 * cancel, decline and the expiry sweep each leave one correspondence_seek_outcomes
 * row (migration 165), and the view route turns it into a 410 for anyone who may
 * know, while a stranger to a private challenge still gets the plain 404.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import {
  type AccountSession,
  createAccountSession,
  createCorrespondenceSeek,
  createUser,
  deleteExpiredCorrespondenceSeeks,
  getCorrespondenceSeekOutcome,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { tryHandle as tryHandleSeekRoute } from './routes/correspondence-seeks.js';
import type { HttpApiContext } from './routes/lib.js';
// Side-effect import: registers every tenant, so the accept route finds the xiangqi factory.
import './variant-tenant/register-tenants.js';

process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';
process.env.MISTBOARD_XIANGQI_ENABLED = 'true';

definePersistenceTests('correspondence seek outcomes', () => {
  test('a taken public seek tells anyone who took it and links the game', async () => {
    const ann = await seedUser('so-ann', 'Ann');
    const bo = await seedUser('so-bo', 'Bo');
    const cy = await seedUser('so-cy', 'Cy');
    const [annCookie, boCookie, cyCookie] = await Promise.all(
      [ann, bo, cy].map((id) => makeSessionCookie(id)),
    );
    const posted = await callSeekRoute('POST', '/api/correspondence/seeks', annCookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      preferredColor: 'first',
    });
    assert.equal(posted.status, 201);
    const seekId = (posted.json.seek as { id: string }).id;

    const accepted = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      boCookie,
    );
    assert.equal(accepted.status, 201);
    const roomId = accepted.json.roomId as string;

    const outcome = await getCorrespondenceSeekOutcome(seekId);
    assert.equal(outcome?.outcome, 'taken');
    assert.equal(outcome?.roomId, roomId);
    assert.equal(outcome?.accepterUserId, bo);

    const stranger = await callSeekRoute('GET', `/api/correspondence/seeks/${seekId}`, cyCookie);
    assert.equal(stranger.status, 410);
    assert.deepEqual(stranger.json, {
      error: 'seek_gone',
      reason: 'taken',
      roomId,
      accepterName: 'Bo',
      youPlay: false,
    });
    const creator = await callSeekRoute('GET', `/api/correspondence/seeks/${seekId}`, annCookie);
    assert.equal(creator.status, 410);
    assert.equal(creator.json.youPlay, true);
  });

  test('a withdrawn public seek reads as withdrawn; an unknown id stays 404', async () => {
    const dee = await seedUser('so-dee', 'Dee');
    const eli = await seedUser('so-eli', 'Eli');
    const deeCookie = await makeSessionCookie(dee);
    const eliCookie = await makeSessionCookie(eli);
    const posted = await callSeekRoute('POST', '/api/correspondence/seeks', deeCookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 7,
    });
    const seekId = (posted.json.seek as { id: string }).id;

    // Someone else's cancel removes nothing and records nothing.
    const notMine = await callSeekRoute('DELETE', `/api/correspondence/seeks/${seekId}`, eliCookie);
    assert.equal(notMine.status, 404);
    assert.equal(await getCorrespondenceSeekOutcome(seekId), null);

    const cancelled = await callSeekRoute(
      'DELETE',
      `/api/correspondence/seeks/${seekId}`,
      deeCookie,
    );
    assert.equal(cancelled.status, 200);
    const view = await callSeekRoute('GET', `/api/correspondence/seeks/${seekId}`, eliCookie);
    assert.equal(view.status, 410);
    assert.equal(view.json.reason, 'withdrawn');

    const unknown = await callSeekRoute('GET', '/api/correspondence/seeks/seek_nope', eliCookie);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.error, 'seek_not_found');
  });

  test('a declined direct challenge: the two players see it, a stranger gets 404', async () => {
    const fox = await seedUser('so-fox', 'Fox');
    const gil = await seedUser('so-gil', 'Gil');
    const hal = await seedUser('so-hal', 'Hal');
    const [foxCookie, gilCookie, halCookie] = await Promise.all(
      [fox, gil, hal].map((id) => makeSessionCookie(id)),
    );
    const posted = await callSeekRoute('POST', '/api/correspondence/seeks', foxCookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      targetHandle: 'so-gil',
    });
    assert.equal(posted.status, 201);
    const seekId = (posted.json.seek as { id: string }).id;

    const declined = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/decline`,
      gilCookie,
    );
    assert.equal(declined.status, 200);
    assert.equal((await getCorrespondenceSeekOutcome(seekId))?.outcome, 'declined');

    for (const cookie of [foxCookie, gilCookie]) {
      const view = await callSeekRoute('GET', `/api/correspondence/seeks/${seekId}`, cookie);
      assert.equal(view.status, 410);
      assert.equal(view.json.reason, 'declined');
    }
    const stranger = await callSeekRoute('GET', `/api/correspondence/seeks/${seekId}`, halCookie);
    assert.equal(stranger.status, 404);
    assert.deepEqual(stranger.json, { error: 'seek_not_found' });
  });

  test('a taken link challenge is told to its players, never to another link holder', async () => {
    const ida = await seedUser('so-ida', 'Ida');
    const jay = await seedUser('so-jay', 'Jay');
    const kit = await seedUser('so-kit', 'Kit');
    const [idaCookie, jayCookie, kitCookie] = await Promise.all(
      [ida, jay, kit].map((id) => makeSessionCookie(id)),
    );
    const posted = await callSeekRoute('POST', '/api/correspondence/seeks', idaCookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 1,
      visibility: 'private',
    });
    const seekId = (posted.json.seek as { id: string }).id;
    const accepted = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      jayCookie,
    );
    assert.equal(accepted.status, 201);

    const accepter = await callSeekRoute('GET', `/api/correspondence/seeks/${seekId}`, jayCookie);
    assert.equal(accepter.status, 410);
    assert.equal(accepter.json.roomId, accepted.json.roomId);
    assert.equal(accepter.json.youPlay, true);
    const other = await callSeekRoute('GET', `/api/correspondence/seeks/${seekId}`, kitCookie);
    assert.equal(other.status, 404);
  });

  test('the sweep records expiry for every lapsed seek; old public notices still read', async () => {
    const lou = await seedUser('so-lou', 'Lou');
    const mo = await seedUser('so-mo', 'Mo');
    const ned = await seedUser('so-ned', 'Ned');
    const [louCookie, moCookie, nedCookie] = await Promise.all(
      [lou, mo, ned].map((id) => makeSessionCookie(id)),
    );
    const past = new Date(Date.now() - 60_000);
    await createCorrespondenceSeek({
      id: 'so-board',
      creatorUserId: lou,
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      preferredColor: 'random',
      targetUserId: null,
      visibility: 'public',
      expiresAt: null,
    });
    await getPool().query(
      `UPDATE correspondence_seeks SET created_at = now() - interval '15 days' WHERE id = $1`,
      ['so-board'],
    );
    await createCorrespondenceSeek({
      id: 'so-direct',
      creatorUserId: lou,
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      preferredColor: 'random',
      targetUserId: mo,
      visibility: 'private',
      expiresAt: past,
    });
    assert.equal(await deleteExpiredCorrespondenceSeeks(new Date()), 2);

    const board = await callSeekRoute('GET', '/api/correspondence/seeks/so-board', nedCookie);
    assert.equal(board.status, 410);
    assert.equal(board.json.reason, 'expired');
    const target = await callSeekRoute('GET', '/api/correspondence/seeks/so-direct', moCookie);
    assert.equal(target.status, 410);
    assert.equal(target.json.reason, 'expired');
    const creator = await callSeekRoute('GET', '/api/correspondence/seeks/so-direct', louCookie);
    assert.equal(creator.json.reason, 'expired');
    const stranger = await callSeekRoute('GET', '/api/correspondence/seeks/so-direct', nedCookie);
    assert.equal(stranger.status, 404);

    // A public seek swept before migration 165 has only its 161 notice.
    await getPool().query('DELETE FROM correspondence_seek_outcomes WHERE seek_id = $1', [
      'so-board',
    ]);
    const legacy = await callSeekRoute('GET', '/api/correspondence/seeks/so-board', nedCookie);
    assert.equal(legacy.status, 410);
    assert.deepEqual(legacy.json, { error: 'seek_gone', reason: 'expired' });
  });
});

async function seedUser(handle: string, displayName: string): Promise<string> {
  const id = `user-${handle}`;
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: new Date(),
    handle,
    displayName,
    now: new Date(),
  });
  return id;
}

async function makeSessionCookie(userId: string): Promise<string> {
  const sessionId = `sess_${userId}`;
  const token = `tok_${userId}`;
  const session: AccountSession = {
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  await createAccountSession(session);
  return `mistboard_session=${sessionId}.${token}`;
}

const notDraining = {
  isDraining: () => false,
  drainDeadlineMs: () => null,
} as unknown as HttpApiContext;

async function callSeekRoute(
  method: string,
  path: string,
  cookie: string,
  body?: Record<string, unknown>,
): Promise<{ status: number | null; json: Record<string, unknown> }> {
  const request = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
    method,
    headers: { cookie },
  }) as unknown as IncomingMessage;
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  const handled = await tryHandleSeekRoute(
    notDraining,
    request,
    capture as unknown as ServerResponse,
    path,
  );
  assert.equal(handled, true, `${method} ${path} should be claimed`);
  return { status: capture.status, json: JSON.parse(capture.body || '{}') };
}
