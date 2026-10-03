/**
 * Rated correspondence (2026-10-02) against real Postgres: a seek or challenge carries
 * `rated`, the accept creates a rated room, and a finished rated correspondence game
 * moves ONLY the variant's 'correspondence' pool, never a live ladder. Driven through the
 * real seek route and the real xiangqi tenant writer, so the rating write is the same
 * recordGameEnd path a live rated game takes (resign, deadline forfeit, abort).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { correspondenceTimeControl, DAY_MS, XIANGQI_SPEC_ID } from '@mistboard/game';
import {
  type AccountSession,
  createAccountSession,
  createUser,
  getCorrespondenceSeek,
  listCorrespondenceGamesForUser,
  listOpenCorrespondenceSeeks,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { getUserProfileByHandle, getUserRatingHistory } from './persistence-profiles.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { tryHandle as tryHandleSeekRoute } from './routes/correspondence-seeks.js';
import type { HttpApiContext } from './routes/lib.js';
import { startTenantDeadlineSweeper } from './variant-tenant/deadline-sweeper.js';
import { appendTenantEvent } from './variant-tenant/events.js';
// Side-effect import: registers every tenant, so the accept route finds the xiangqi factory.
import './variant-tenant/register-tenants.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';
import { getOrLoadXiangqiRoom, xiangqiRooms } from './xiangqi-registration.js';
import type { XiangqiEvent } from './xiangqi-runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';
process.env.MISTBOARD_RATED_ENABLED = 'true';
// Rated correspondence is held by default (feature-flags.ts); this file tests it ON,
// except where a test turns it off to pin the held behaviour.
process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED = 'true';
process.env.MISTBOARD_XIANGQI_ENABLED = 'true';

type RatingRow = {
  user_id: string;
  variant: string;
  time_class: string;
  elo_rating: number;
  games_played: number;
};

definePersistenceTests('rated correspondence', () => {
  test('a seek round-trips its rated flag, and rated is not a duplicate of casual', async () => {
    const ann = await seedUser('rc-ann');
    const cookie = await makeSessionCookie(ann);
    const terms = { gameSpecId: XIANGQI_SPEC_ID, daysPerMove: 3, preferredColor: 'random' };

    const rated = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
      ...terms,
      rated: true,
    });
    assert.equal(rated.status, 201);
    const ratedSeek = rated.json.seek as { id: string; rated: boolean };
    assert.equal(ratedSeek.rated, true);
    assert.equal((await getCorrespondenceSeek(ratedSeek.id))?.rated, true);

    // Same terms, casual: a different offer, not the rated one handed back.
    const casual = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, terms);
    assert.equal(casual.status, 201);
    const casualSeek = casual.json.seek as { id: string; rated: boolean };
    assert.notEqual(casualSeek.id, ratedSeek.id);
    assert.equal(casualSeek.rated, false);

    // Re-posting the rated offer returns the existing rated row.
    const again = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
      ...terms,
      rated: true,
    });
    assert.equal(again.status, 200);
    assert.equal((again.json.seek as { id: string }).id, ratedSeek.id);

    const board = await listOpenCorrespondenceSeeks();
    assert.equal(board.find((seek) => seek.id === ratedSeek.id)?.rated, true);
    assert.equal(board.find((seek) => seek.id === casualSeek.id)?.rated, false);
    const listed = await callSeekRoute('GET', '/api/correspondence/seeks', cookie);
    const rows = listed.json.seeks as Array<{ id: string; rated: boolean }>;
    assert.equal(rows.find((row) => row.id === ratedSeek.id)?.rated, true);
  });

  test('a rated seek is refused, never downgraded, when it cannot be rated', async () => {
    const bea = await seedUser('rc-bea');
    const cookie = await makeSessionCookie(bea);
    const prior = process.env.MISTBOARD_RATED_ENABLED;
    process.env.MISTBOARD_RATED_ENABLED = 'false';
    try {
      const off = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
        gameSpecId: XIANGQI_SPEC_ID,
        daysPerMove: 3,
        rated: true,
      });
      assert.equal(off.status, 403);
      assert.equal(off.json.error, 'rated_disabled');
    } finally {
      process.env.MISTBOARD_RATED_ENABLED = prior;
    }
    const { rows } = await getPool().query('SELECT 1 FROM correspondence_seeks');
    assert.equal(rows.length, 0, 'a refused rated seek writes nothing');
  });

  test('held (correspondence flag off): a rated post is refused, a rated seek cannot be accepted', async () => {
    const cy = await seedUser('rc-cy');
    const di = await seedUser('rc-di');
    const cyCookie = await makeSessionCookie(cy);
    const diCookie = await makeSessionCookie(di);
    // A rated seek posted while the flag was on...
    const posted = await callSeekRoute('POST', '/api/correspondence/seeks', cyCookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      rated: true,
    });
    assert.equal(posted.status, 201);
    const seekId = (posted.json.seek as { id: string }).id;
    process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED = 'false';
    try {
      // ...a new rated post is refused (403, nothing stored), never stored casual...
      const refused = await callSeekRoute('POST', '/api/correspondence/seeks', diCookie, {
        gameSpecId: XIANGQI_SPEC_ID,
        daysPerMove: 3,
        rated: true,
      });
      assert.equal(refused.status, 403);
      assert.equal(refused.json.error, 'rated_disabled');
      // ...a casual post is unaffected...
      const casual = await callSeekRoute('POST', '/api/correspondence/seeks', diCookie, {
        gameSpecId: XIANGQI_SPEC_ID,
        daysPerMove: 3,
      });
      assert.equal(casual.status, 201);
      assert.equal((casual.json.seek as { rated: boolean }).rated, false);
      // ...and the earlier rated seek cannot become a game, so no room is created rated.
      const accept = await callSeekRoute(
        'POST',
        `/api/correspondence/seeks/${seekId}/accept`,
        diCookie,
      );
      assert.equal(accept.status, 403);
      assert.equal(accept.json.error, 'rated_disabled');
      assert.notEqual(await getCorrespondenceSeek(seekId), null, 'the refused accept took nothing');
    } finally {
      process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED = 'true';
    }
    const { rows } = await getPool().query(
      'SELECT rated FROM correspondence_seeks WHERE creator_user_id = $1',
      [di],
    );
    assert.deepEqual(rows, [{ rated: false }]);
  });

  test('rated accept creates a rated game; resignation moves ONLY the correspondence pool', async () => {
    const cal = await seedUser('rc-cal');
    const dot = await seedUser('rc-dot');
    // A pre-existing LIVE xiangqi rating that must not move.
    await getPool().query(
      `INSERT INTO user_ratings (user_id, variant, time_class, elo_rating, rating_deviation,
         volatility, games_played, updated_at)
       VALUES ($1, 'xiangqi', 'blitz', 1612, 80, 0.06, 12, now())`,
      [cal],
    );
    const calCookie = await makeSessionCookie(cal);
    const dotCookie = await makeSessionCookie(dot);
    const posted = await callSeekRoute('POST', '/api/correspondence/seeks', calCookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 1,
      preferredColor: 'first',
      rated: true,
    });
    assert.equal(posted.status, 201);
    const seekId = (posted.json.seek as { id: string }).id;

    const accepted = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      dotCookie,
    );
    assert.equal(accepted.status, 201);
    assert.equal(accepted.json.rated, true);
    const roomId = accepted.json.roomId as string;

    // Durable rated room: survives a cold cache (hydration from the event log).
    xiangqiRooms.clear();
    const room = await getOrLoadXiangqiRoom(roomId);
    assert.ok(room);
    assert.equal(room.rated, true);

    // The inbox marks it rated for both players.
    for (const userId of [cal, dot]) {
      const inbox = await listCorrespondenceGamesForUser(userId);
      assert.equal(inbox.find((game) => game.roomId === roomId)?.rated, true);
    }

    await appendTenantEvent(xiangqiTenant, room, move(roomId, 'red', 'b3', 'b4'));
    await appendTenantEvent(xiangqiTenant, room, move(roomId, 'black', 'b8', 'b7'));
    await appendTenantEvent(xiangqiTenant, room, {
      type: 'seat-resigned',
      at: Date.now(),
      roomId,
      color: 'black',
    });
    await room.pendingWrites;

    const game = await queryOne<{ rated: boolean; status: string; result: string }>(
      'SELECT rated, status, result FROM games WHERE room_id = $1',
      [roomId],
    );
    assert.deepEqual(game, { rated: true, status: 'completed', result: 'red-wins' });

    const ratings = await ratingRows([cal, dot]);
    const corr = ratings.filter((row) => row.time_class === 'correspondence');
    assert.equal(corr.length, 2, 'both players get a correspondence rating');
    const calCorr = corr.find((row) => row.user_id === cal);
    const dotCorr = corr.find((row) => row.user_id === dot);
    assert.equal(calCorr?.variant, 'xiangqi');
    assert.ok(calCorr && calCorr.elo_rating > 1500, 'the winner gained');
    assert.ok(dotCorr && dotCorr.elo_rating < 1500, 'the resigner lost');
    assert.equal(calCorr.games_played, 1);
    // The live ladder is untouched, and no live row appeared for the other player.
    const live = ratings.filter((row) => row.time_class !== 'correspondence');
    assert.deepEqual(
      live.map((row) => [row.user_id, row.time_class, row.elo_rating, row.games_played]),
      [[cal, 'blitz', 1612, 12]],
    );

    // The profile graph finds the game on the correspondence ladder only.
    const history = await getUserRatingHistory('rc-cal', cal, 'xiangqi', 'correspondence');
    assert.deepEqual(
      history?.points.map((point) => point.roomId),
      [roomId],
    );
    const blitzHistory = await getUserRatingHistory('rc-cal', cal, 'xiangqi', 'blitz');
    assert.deepEqual(blitzHistory?.points, []);

    // The profile shows the correspondence rating only while the flag is on.
    const shown = await getUserProfileByHandle('rc-cal', null);
    assert.ok(shown?.ratings.some((rating) => rating.timeClass === 'correspondence'));
    process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED = 'false';
    try {
      const held = await getUserProfileByHandle('rc-cal', null);
      assert.equal(
        held?.ratings.some((rating) => rating.timeClass === 'correspondence'),
        false,
      );
      assert.ok(held?.ratings.some((rating) => rating.timeClass === 'blitz'));
    } finally {
      process.env.MISTBOARD_CORRESPONDENCE_RATED_ENABLED = 'true';
    }
    xiangqiRooms.clear();
  });

  test('a casual correspondence game rates nobody', async () => {
    const eve = await seedUser('rc-eve');
    const fay = await seedUser('rc-fay');
    const created = await createXiangqiSeekGame({
      timeControl: correspondenceTimeControl(3),
      first: { userId: eve },
      second: { userId: fay },
    });
    assert.ok(created.ok);
    assert.equal(created.room.rated, false);
    const room = await getOrLoadXiangqiRoom(created.room.id);
    assert.ok(room);
    await appendTenantEvent(xiangqiTenant, room, move(room.id, 'red', 'b3', 'b4'));
    await appendTenantEvent(xiangqiTenant, room, move(room.id, 'black', 'b8', 'b7'));
    await appendTenantEvent(xiangqiTenant, room, {
      type: 'seat-resigned',
      at: Date.now(),
      roomId: room.id,
      color: 'red',
    });
    await room.pendingWrites;
    const game = await queryOne<{ rated: boolean; status: string }>(
      'SELECT rated, status FROM games WHERE room_id = $1',
      [room.id],
    );
    assert.deepEqual(game, { rated: false, status: 'completed' });
    assert.deepEqual(await ratingRows([eve, fay]), []);
    xiangqiRooms.clear();
  });

  test('a deadline forfeit rates through the sweeper; a first-move no-show aborts unrated', async () => {
    const gil = await seedUser('rc-gil');
    const hal = await seedUser('rc-hal');
    const ida = await seedUser('rc-ida');
    const jon = await seedUser('rc-jon');
    const forfeit = await createXiangqiSeekGame({
      timeControl: correspondenceTimeControl(1),
      first: { userId: gil },
      second: { userId: hal },
      rated: true,
    });
    const noShow = await createXiangqiSeekGame({
      timeControl: correspondenceTimeControl(1),
      first: { userId: ida },
      second: { userId: jon },
      rated: true,
    });
    assert.ok(forfeit.ok && noShow.ok);
    const room = await getOrLoadXiangqiRoom(forfeit.room.id);
    assert.ok(room);
    await appendTenantEvent(xiangqiTenant, room, move(room.id, 'red', 'b3', 'b4'));
    await appendTenantEvent(xiangqiTenant, room, move(room.id, 'black', 'b8', 'b7'));
    await room.pendingWrites;

    // Two days on: red's one-day allowance and the no-show's first-move window lapsed.
    // The tenant re-derives the deadline from Date.now, so the clock is moved, not the
    // rows; a cold cache proves the restart path too.
    xiangqiRooms.clear();
    const realNow = Date.now;
    const later = realNow() + 2 * DAY_MS;
    Date.now = () => later;
    const sweeper = startTenantDeadlineSweeper({
      intervalMs: 60_000,
      now: () => later,
      warnDeadlines: async () => {},
      digestTurns: async () => {},
      sweepExpiredSeeks: async () => 0,
    });
    try {
      await sweeper.tick();
    } finally {
      sweeper.stop();
      Date.now = realNow;
    }

    const forfeited = await queryOne<{ rated: boolean; termination: string; result: string }>(
      'SELECT rated, termination, result FROM games WHERE room_id = $1',
      [forfeit.room.id],
    );
    assert.deepEqual(forfeited, { rated: true, termination: 'timeout', result: 'black-wins' });
    const moved = await ratingRows([gil, hal]);
    assert.deepEqual(moved.map((row) => [row.user_id, row.time_class]).sort(), [
      [gil, 'correspondence'],
      [hal, 'correspondence'],
    ]);
    assert.ok((moved.find((row) => row.user_id === hal)?.elo_rating ?? 0) > 1500);

    // The no-show is an abort, exactly as a live rated game: no result, no rating.
    const aborted = await queryOne<{ status: string } | null>(
      'SELECT status FROM games WHERE room_id = $1',
      [noShow.room.id],
    );
    assert.notEqual(aborted?.status, 'completed');
    assert.deepEqual(await ratingRows([ida, jon]), []);
    xiangqiRooms.clear();
  });

  test('a play-locked player cannot enter a rated correspondence game', async () => {
    const kim = await seedUser('rc-kim');
    const lou = await seedUser('rc-lou');
    const kimCookie = await makeSessionCookie(kim);
    const louCookie = await makeSessionCookie(lou);
    const posted = await callSeekRoute('POST', '/api/correspondence/seeks', kimCookie, {
      gameSpecId: XIANGQI_SPEC_ID,
      daysPerMove: 3,
      rated: true,
    });
    assert.equal(posted.status, 201);
    const seekId = (posted.json.seek as { id: string }).id;

    // The creator is locked after posting: accepting would seat them, so it is refused
    // and the seek is not consumed.
    await getPool().query('UPDATE users SET play_disabled_at = now() WHERE id = $1', [kim]);
    const refused = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      louCookie,
    );
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, 'opponent_play_disabled');
    assert.notEqual(await getCorrespondenceSeek(seekId), null);

    // A locked accepter is refused by the existing gate.
    await getPool().query('UPDATE users SET play_disabled_at = NULL WHERE id = $1', [kim]);
    await getPool().query('UPDATE users SET play_disabled_at = now() WHERE id = $1', [lou]);
    const locked = await callSeekRoute(
      'POST',
      `/api/correspondence/seeks/${seekId}/accept`,
      louCookie,
    );
    assert.equal(locked.status, 403);
    assert.equal(locked.json.error, 'play_disabled');
    assert.deepEqual(await ratingRows([kim, lou]), []);
  });
});

function move(roomId: string, color: 'red' | 'black', from: string, to: string): XiangqiEvent {
  return { type: 'move-played', at: Date.now(), roomId, color, move: { from, to } } as XiangqiEvent;
}

// The registered seek factory (the shared tenantCorrespondenceBinding), exactly what the
// accept route calls.
function createXiangqiSeekGame(
  args: Parameters<
    NonNullable<
      NonNullable<
        ReturnType<typeof correspondenceTenantForSpecId>
      >['createCorrespondenceGameForSeek']
    >
  >[0],
) {
  const create = correspondenceTenantForSpecId(XIANGQI_SPEC_ID)?.createCorrespondenceGameForSeek;
  if (!create) throw new Error('xiangqi has no correspondence seek factory');
  return create(args);
}

async function seedUser(handle: string): Promise<string> {
  const id = `user-${handle}`;
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: new Date(),
    handle,
    displayName: handle,
    now: new Date(),
  });
  return id;
}

async function ratingRows(userIds: string[]): Promise<RatingRow[]> {
  const { rows } = await getPool().query<RatingRow>(
    `SELECT user_id, variant, time_class, elo_rating, games_played FROM user_ratings
     WHERE user_id = ANY($1) ORDER BY user_id, time_class`,
    [userIds],
  );
  return rows;
}

async function queryOne<T>(sql: string, values: unknown[]): Promise<T | null> {
  const { rows } = await getPool().query(sql, values);
  return (rows[0] as T) ?? null;
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
