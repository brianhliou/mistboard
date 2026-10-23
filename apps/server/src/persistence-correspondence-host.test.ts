/**
 * Play the host, end to end against Postgres: a player's POST starts a real
 * casual 2-day game with the host account in the seat the player did not pick,
 * the host's challenge seek is gone afterwards, and countHostCorrespondenceGames
 * sees the game toward both caps.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import {
  type AccountSession,
  countHostCorrespondenceGames,
  countOpenSeeksForUser,
  createAccountSession,
  createUser,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { HOST_PATH, tryHandle as tryHandleHostRoute } from './routes/correspondence-host.js';
import type { HttpApiContext } from './routes/lib.js';
// Side-effect import: registers every tenant, so the accept route finds the xiangqi factory.
import './variant-tenant/register-tenants.js';

process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';
process.env.MISTBOARD_XIANGQI_ENABLED = 'true';
process.env.MISTBOARD_CORRESPONDENCE_HOST_HANDLE = '@ch-host';

definePersistenceTests('correspondence host', () => {
  test('a player starts a casual 2-day game against the host, who takes the other side', async () => {
    const host = await seedUser('ch-host', 'Host');
    const ann = await seedUser('ch-ann', 'Ann');
    const bo = await seedUser('ch-bo', 'Bo');
    const [hostCookie, annCookie, boCookie] = await Promise.all(
      [host, ann, bo].map((id) => makeSessionCookie(id)),
    );

    const guestInfo = await callHostRoute('GET', '');
    assert.equal(guestInfo.status, 200);
    assert.equal(guestInfo.json.signedIn, false);
    assert.deepEqual(guestInfo.json.host, { handle: 'ch-host', displayName: 'Host' });
    assert.ok((guestInfo.json.gameSpecIds as string[]).includes(XIANGQI_SPEC_ID));
    assert.equal((await callHostRoute('POST', '', { gameSpecId: XIANGQI_SPEC_ID })).status, 401);
    assert.equal(
      (await callHostRoute('POST', hostCookie, { gameSpecId: XIANGQI_SPEC_ID })).status,
      400,
    );

    const started = await callHostRoute('POST', annCookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      side: 'first',
    });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.equal(started.json.rated, false);
    assert.equal(started.json.daysPerMove, 2);
    const roomId = started.json.roomId as string;

    const { rows: seats } = await getPool().query<{ user_id: string; seat: string }>(
      `SELECT user_id, seat FROM room_seat_tokens WHERE room_id = $1 AND revoked_at IS NULL
       ORDER BY seat`,
      [roomId],
    );
    const seatOf = new Map(seats.map((row) => [row.user_id, row.seat]));
    assert.equal(seats.length, 2);
    assert.ok(seatOf.has(host) && seatOf.has(ann));
    // Ann asked to move first; xiangqi's first mover is red.
    assert.equal(seatOf.get(ann), 'red');
    assert.equal(seatOf.get(host), 'black');

    // The challenge seek was consumed by the accept, not left on the host's list.
    assert.equal(await countOpenSeeksForUser(host), 0);
    assert.deepEqual(await countHostCorrespondenceGames(host, ann), { total: 1, withPlayer: 1 });
    assert.deepEqual(await countHostCorrespondenceGames(host, bo), { total: 1, withPlayer: 0 });

    const annInfo = await callHostRoute('GET', annCookie);
    assert.equal(annInfo.json.activeWithYou, 1);
    assert.equal(annInfo.json.canPlay, true);

    const second = await callHostRoute('POST', annCookie, { gameSpecId: XIANGQI_SPEC_ID });
    assert.equal(second.status, 201);
    const third = await callHostRoute('POST', annCookie, { gameSpecId: XIANGQI_SPEC_ID });
    assert.equal(third.status, 409);
    assert.equal(third.json.error, 'player_limit_reached');
    // Another player still gets in.
    const boGame = await callHostRoute('POST', boCookie, { gameSpecId: XIANGQI_SPEC_ID });
    assert.equal(boGame.status, 201);
    assert.deepEqual(await countHostCorrespondenceGames(host, bo), { total: 3, withPlayer: 1 });
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
  refusesCreate: () => false,
  drainDeadlineMs: () => null,
} as unknown as HttpApiContext;

async function callHostRoute(
  method: string,
  cookie: string,
  body?: Record<string, unknown>,
): Promise<{ status: number | null; json: Record<string, unknown> }> {
  const request = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
    method,
    headers: cookie ? { cookie } : {},
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
  const handled = await tryHandleHostRoute(
    notDraining,
    request,
    capture as unknown as ServerResponse,
    HOST_PATH,
  );
  assert.equal(handled, true);
  return { status: capture.status, json: JSON.parse(capture.body || '{}') };
}
