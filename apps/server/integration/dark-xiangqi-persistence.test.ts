import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/migrate.js';
import { TENANT_LIVE_GAME_NO_SEAT_REASON } from '../src/variant-tenant/ws.js';
import {
  connectClient,
  startTestServer,
  type TestServer,
  withProductionRuntime,
} from './harness.js';

const testDbUrl = process.env.TEST_DATABASE_URL;
const darkXiangqiKey = 'MISTBOARD_DARK_XIANGQI_ENABLED';

if (!testDbUrl) {
  test('dark-xiangqi-persistence (skipped - set TEST_DATABASE_URL to enable)', {
    skip: true,
  }, () => {});
} else {
  const beforeDatabaseUrl = process.env.DATABASE_URL;
  const beforeDarkXiangqiFlag = process.env[darkXiangqiKey];
  process.env.DATABASE_URL = testDbUrl;
  process.env[darkXiangqiKey] = 'true';

  let serverInstance: TestServer;
  let db: pg.Client;

  before(async () => {
    db = new pg.Client({ connectionString: testDbUrl });
    await db.connect();
    await runMigrations(db);
    await truncateTestTables(db);
    serverInstance = await startTestServer();
  });

  after(async () => {
    await serverInstance?.close();
    await db?.end();
    restoreEnv('DATABASE_URL', beforeDatabaseUrl);
    restoreEnv(darkXiangqiKey, beforeDarkXiangqiFlag);
  });

  test('Dark Xiangqi room hydrates from persisted events after restart', async () => {
    const createdResponse = await createDarkXiangqiRoom(serverInstance);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as { roomId: string };

    const red = await connectClient({
      url: serverInstance.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    const black = await connectClient({
      url: serverInstance.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    assert.equal(red.seat, 'red');
    assert.equal(black.seat, 'black');
    assert.ok(red.seatToken);
    assert.ok(black.seatToken);

    red.send({ type: 'move', from: 'b3', to: 'b4' });
    await black.waitFor(
      (msg) =>
        msg.type === 'event-appended' &&
        (msg as { state?: { status?: { turn?: string } } }).state?.status?.turn === 'black',
    );
    await red.disconnect();
    await black.disconnect();
    await serverInstance.close();

    serverInstance = await startTestServer();
    assert.equal(serverInstance.darkXiangqiRooms.has(created.roomId), false);
    assert.equal(serverInstance.rooms.has(created.roomId), false);

    // The tenant WS runtime admits a tokenless visitor as a read-only spectator
    // in non-production; pin the production fail-closed path so the private room
    // rejects with 1008 (otherwise the connection is admitted and the await hangs).
    await withProductionRuntime(serverInstance.url, async () => {
      const uncredentialed = await connectClient({
        url: serverInstance.url,
        room: created.roomId,
        gameSpecId: 'dark-xiangqi',
        awaitHello: false,
      });
      await uncredentialed.closed;
      assert.equal(uncredentialed.isClosed(), true);
      assert.equal(uncredentialed.closeCode(), 1008);
      assert.equal(uncredentialed.closeReason(), TENANT_LIVE_GAME_NO_SEAT_REASON);
    });

    const hydratedRed = await connectClient({
      url: serverInstance.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
      seatToken: red.seatToken,
    });

    assert.equal(hydratedRed.seat, 'red');
    const hello = hydratedRed.messages.find((msg) => (msg as { type?: string }).type === 'hello') as
      | {
          gameSpecId?: string;
          events?: Array<{
            type: string;
            color?: string;
            move?: { from: string; to: string };
            roomId?: string;
          }>;
          state?: {
            board?: Record<string, unknown>;
            status?: { type: string; turn?: string };
            lastMove?: { from: string; to: string };
          };
        }
      | undefined;
    assert.equal(hello?.gameSpecId, 'dark-xiangqi');
    const moveEvents = hello?.events?.filter((event) => event.type === 'move-played') ?? [];
    assert.equal(moveEvents.length, 1);
    assert.equal(moveEvents[0]?.roomId, created.roomId);
    assert.equal(moveEvents[0]?.color, 'red');
    assert.deepEqual(moveEvents[0]?.move, { from: 'b3', to: 'b4' });
    assert.equal(hello?.state?.status?.turn, 'black');
    assert.deepEqual(hello?.state?.lastMove, { from: 'b3', to: 'b4' });
    assert.deepEqual(hello?.state?.board?.b8, { color: 'black', shrouded: true });
    assert.equal(serverInstance.darkXiangqiRooms.has(created.roomId), true);
    assert.equal(serverInstance.rooms.has(created.roomId), false);

    const hydratedBlack = await connectClient({
      url: serverInstance.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
      seatToken: black.seatToken,
    });
    const blackHello = hydratedBlack.messages.find(
      (msg) => (msg as { type?: string }).type === 'hello',
    ) as
      | {
          events?: Array<{ type: string }>;
          state?: {
            status?: { type: string; turn?: string };
            lastMove?: { from: string; to: string };
          };
        }
      | undefined;
    assert.equal(hydratedBlack.seat, 'black');
    assert.equal(blackHello?.state?.status?.turn, 'black');
    assert.equal(blackHello?.state?.lastMove, undefined);
    assert.equal(
      blackHello?.events?.some((event) => event.type === 'move-played'),
      false,
    );
    assert.doesNotMatch(JSON.stringify(blackHello), /"lastMove"/);

    await hydratedRed.disconnect();
    await hydratedBlack.disconnect();
  });

  test('Dark Xiangqi completion records a public family-native game summary', async () => {
    const createdResponse = await createDarkXiangqiRoom(serverInstance);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as { roomId: string };

    const red = await connectClient({
      url: serverInstance.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    const black = await connectClient({
      url: serverInstance.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });

    red.send({ type: 'move', from: 'b3', to: 'b4' });
    await black.waitFor(
      (msg) =>
        msg.type === 'event-appended' &&
        (msg as { state?: { status?: { turn?: string } } }).state?.status?.turn === 'black',
    );

    black.send({ type: 'move', from: 'b8', to: 'b7' });
    await red.waitFor(
      (msg) =>
        msg.type === 'event-appended' &&
        (msg as { state?: { status?: { turn?: string } } }).state?.status?.turn === 'red',
    );

    black.send({ type: 'resign' });
    await red.waitFor(
      (msg) =>
        msg.type === 'snapshot' &&
        (msg as { state?: { status?: { type?: string; reason?: string } } }).state?.status?.type ===
          'finished' &&
        (msg as { state?: { status?: { reason?: string } } }).state?.status?.reason ===
          'resignation',
    );

    const { rows: games } = await db.query<{
      variant: string;
      result: string;
      termination: string;
      ply_count: number;
      mode: string;
      status: string;
      visibility: string;
      rated: boolean;
      white_client: string | null;
      black_client: string | null;
    }>(
      `SELECT variant, result, termination, ply_count, mode, status, visibility,
              COALESCE(rated, true) AS rated, white_client, black_client
       FROM games
       WHERE room_id = $1`,
      [created.roomId],
    );
    assert.deepEqual(games[0], {
      variant: 'dark-xiangqi',
      result: 'red-wins',
      termination: 'resignation',
      ply_count: 2,
      mode: 'pvp',
      status: 'completed',
      // Human PvP games are public now (no more private games); fog live-view
      // stays gated by the spec policy, not by this concluded-row visibility.
      visibility: 'public',
      rated: false,
      white_client: null,
      black_client: null,
    });

    const { rows: participants } = await db.query<{
      color: string;
      subject_type: string;
      subject_id: string | null;
      display_name: string;
      visibility: string;
    }>(
      `SELECT color, subject_type, subject_id, display_name, visibility
       FROM game_participants
       WHERE game_id = $1
       ORDER BY color`,
      [created.roomId],
    );
    assert.deepEqual(participants, [
      {
        color: 'black',
        subject_type: 'guest',
        subject_id: null,
        // Anonymous seats are named 'Guest', not a color word (which read as a
        // side label and mislabeled the seat on watch thumbnails / reviews).
        display_name: 'Guest',
        visibility: 'public',
      },
      {
        color: 'red',
        subject_type: 'guest',
        subject_id: null,
        display_name: 'Guest',
        visibility: 'public',
      },
    ]);

    await red.disconnect();
    await black.disconnect();
  });

  test('Dark Xiangqi postgame API is family-native and public truth review', async () => {
    const createdResponse = await createDarkXiangqiRoom(serverInstance);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as { roomId: string };

    const red = await connectClient({
      url: serverInstance.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });
    const black = await connectClient({
      url: serverInstance.url,
      room: created.roomId,
      gameSpecId: 'dark-xiangqi',
    });

    red.send({ type: 'move', from: 'b3', to: 'b4' });
    await black.waitFor(
      (msg) =>
        msg.type === 'event-appended' &&
        (msg as { state?: { status?: { turn?: string } } }).state?.status?.turn === 'black',
    );

    black.send({ type: 'move', from: 'b8', to: 'b7' });
    await red.waitFor(
      (msg) =>
        msg.type === 'event-appended' &&
        (msg as { state?: { status?: { turn?: string } } }).state?.status?.turn === 'red',
    );

    black.send({ type: 'resign' });
    await red.waitFor(
      (msg) =>
        msg.type === 'snapshot' &&
        (msg as { state?: { status?: { type?: string; reason?: string } } }).state?.status?.type ===
          'finished',
    );

    const genericReplayResponse = await fetch(
      `http://127.0.0.1:${serverInstance.port}/api/games/${encodeURIComponent(created.roomId)}/events`,
    );
    assert.equal(genericReplayResponse.status, 403);

    const publicResponse = await fetchDarkXiangqiPostgame(serverInstance, created.roomId);
    assert.equal(publicResponse.status, 200);
    const publicPostgame = (await publicResponse.json()) as DarkXiangqiPostgameResponse;
    assert.equal(publicPostgame.game.variant, 'dark-xiangqi');
    assert.equal(publicPostgame.game.visibility, 'public');
    assert.equal(publicPostgame.view.perspective, 'red');
    assert.deepEqual(publicPostgame.views?.red?.board.b4, {
      piece: { color: 'red', role: 'cannon' },
      shrouded: false,
    });
    assert.deepEqual(publicPostgame.views?.truth?.board.b4, {
      piece: { color: 'red', role: 'cannon' },
      shrouded: false,
    });
    assert.deepEqual(publicPostgame.views?.truth?.board.b7, {
      piece: { color: 'black', role: 'cannon' },
      shrouded: false,
    });
    assert.equal(publicPostgame.views?.truth?.visibleSquares.length, 90);
    assert.equal(publicPostgame.views?.black?.perspective, 'black');
    assert.equal(shroudedEntriesCarryPieceIdentity(publicPostgame.views?.red?.board ?? {}), false);
    assert.equal(
      shroudedEntriesCarryPieceIdentity(publicPostgame.views?.black?.board ?? {}),
      false,
    );
    assert.equal(
      Object.values(publicPostgame.views?.truth?.board ?? {}).some(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as { shrouded?: unknown }).shrouded === true,
      ),
      false,
    );
    assert.deepEqual(
      publicPostgame.history?.red?.map((snapshot) => snapshot.ply),
      [0, 1, 2],
    );
    assert.deepEqual(
      publicPostgame.history?.truth?.map((snapshot) => snapshot.ply),
      [0, 1, 2],
    );
    assert.deepEqual(
      publicPostgame.history?.black?.map((snapshot) => snapshot.ply),
      [0, 1, 2],
    );
    assert.equal(
      publicPostgame.history?.black?.some((snapshot) =>
        shroudedEntriesCarryPieceIdentity(snapshot.view.board),
      ),
      false,
    );
    assert.deepEqual(
      publicPostgame.timeline
        .filter((entry) => entry.type === 'move-played')
        .map((entry) => ({
          color: entry.color,
          move: entry.move,
        })),
      [
        { color: 'red', move: { from: 'b3', to: 'b4' } },
        { color: 'black', move: { from: 'b8', to: 'b7' } },
      ],
    );
    assert.doesNotMatch(JSON.stringify(publicPostgame), /clientId|seat-assigned|seat-vacated/);

    const invalidTokenResponse = await fetchDarkXiangqiPostgame(
      serverInstance,
      created.roomId,
      'not-a-valid-seat-token',
    );
    assert.equal(invalidTokenResponse.status, 200);

    process.env[darkXiangqiKey] = 'false';
    try {
      const disabledResponse = await fetchDarkXiangqiPostgame(serverInstance, created.roomId);
      assert.equal(disabledResponse.status, 404);
    } finally {
      process.env[darkXiangqiKey] = 'true';
    }

    await red.disconnect();
    await black.disconnect();
  });
}

async function createDarkXiangqiRoom(server: TestServer): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'pvp', gameSpecId: 'dark-xiangqi' }),
  });
}

function fetchDarkXiangqiPostgame(
  server: TestServer,
  roomId: string,
  seatToken?: string,
): Promise<Response> {
  const url = new URL(
    `http://127.0.0.1:${server.port}/api/dark-xiangqi/games/${encodeURIComponent(roomId)}`,
  );
  if (seatToken) url.searchParams.set('seatToken', seatToken);
  return fetch(url);
}

type DarkXiangqiPostgameResponse = {
  game: {
    variant: string;
    visibility: string;
  };
  timeline: Array<{
    type: string;
    color?: string;
    move?: { from: string; to: string };
  }>;
  view: {
    perspective: 'red' | 'black';
    board: Record<string, unknown>;
  };
  views?: {
    red?: {
      perspective: 'red' | 'black';
      board: Record<string, unknown>;
      visibleSquares: string[];
    };
    truth?: {
      perspective: 'red' | 'black';
      board: Record<string, unknown>;
      visibleSquares: string[];
    };
    black?: {
      perspective: 'red' | 'black';
      board: Record<string, unknown>;
      visibleSquares: string[];
    };
  };
  history?: {
    red?: Array<{ ply: number; view: { board: Record<string, unknown> } }>;
    truth?: Array<{ ply: number; view: { board: Record<string, unknown> } }>;
    black?: Array<{ ply: number; view: { board: Record<string, unknown> } }>;
  };
};

function shroudedEntriesCarryPieceIdentity(board: Record<string, unknown>): boolean {
  return Object.values(board).some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { shrouded?: unknown }).shrouded === true &&
      'piece' in entry,
  );
}

async function truncateTestTables(client: pg.Client): Promise<void> {
  await client.query(
    `TRUNCATE
       room_lifecycle_audit,
       email_login_challenges,
       account_sessions,
       user_handle_reservations,
       artifact_owners,
       game_participants,
       room_seat_tokens,
       game_debug_artifacts,
       eve_games,
       engine_game_tasks,
       engine_worker_runs,
       eve_jobs,
       engine_versions,
       engines,
       users,
       events,
       games
     RESTART IDENTITY CASCADE`,
  );
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
