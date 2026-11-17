import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { GOMOKU_DEALT_OPENINGS } from '@mistboard/game';
import { collectCurrentGames } from './current-games.js';
import { gomokuRooms } from './gomoku-registration.js';
import { gomokuTenant } from './gomoku-tenant.js';
import { getBotGamesPage, listPublicBots } from './persistence-bots.js';
import {
  countedAbortedGame,
  countedHumanGame,
  countedPublicGame,
  internalHumanGame,
  preLaunchHumanGame,
  shortHumanGame,
} from './persistence-counted-games.js';
import { close, getPool, init } from './persistence-db.js';
import {
  getEngineProfile,
  listEngineVersionStats,
  listRecentPublicGames,
  listShowcaseGames,
  listWatchUnlockedGames,
  recordGameEnd,
} from './persistence-games.js';
import { getUserGamesPage } from './persistence-profiles.js';
import { isReleaseSmokeRoom } from './release-smoke.js';
import { tryHandle } from './routes/games.js';
import type { HttpApiContext } from './routes/lib.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
} from './variant-tenant/runtime.js';
import { collectLiveTvCandidates, registerLiveWatchPayloadBuilder } from './watch-live.js';
import { clearWatchRailCache } from './watch-rail-cache.js';

function finishedGame(clientId: string, opponent = 'rapfi-level-1') {
  const opening = GOMOKU_DEALT_OPENINGS.find(
    (deal) => deal.turn === 'black' && !deal.stones.some((stone) => stone.square === 'a1'),
  );
  assert.ok(opening);
  const tenant = {
    ...gomokuTenant,
    rules: { ...gomokuTenant.rules, createSetup: () => opening },
  };
  const created = createTenantRuntimeRoom(tenant, `gmk_${clientId}`);
  assert.ok(created.ok);
  const room = created.room;
  const at = Date.now();
  for (const [seat, id] of [
    ['white', opponent],
    ['black', clientId],
  ] as const) {
    appendTenantRuntimeEvent(tenant, room, {
      type: 'seat-assigned',
      roomId: room.id,
      at,
      seat,
      clientId: id,
    });
  }
  for (const [color, to] of [
    ['black', 'a1'],
    ['white', 'o15'],
  ] as const) {
    appendTenantRuntimeEvent(tenant, room, {
      type: 'move-played',
      roomId: room.id,
      at,
      color,
      move: { to },
    });
  }
  assert.equal(room.events.filter((event) => event.type === 'move-played').length, 2);
  appendTenantRuntimeEvent(tenant, room, {
    type: 'seat-resigned',
    roomId: room.id,
    at,
    color: 'black',
  });
  return { room, summary: buildTenantGameSummary(tenant, room) };
}

test('release smoke engine reply and resignation persist privately; identical normal guest games stay public', () => {
  const smoke = finishedGame('prod-gomoku-smoke-1794874000000');
  assert.equal(smoke.summary.plyCount, 2);
  assert.equal(smoke.summary.termination, 'resignation');
  assert.equal(smoke.summary.visibility, 'private');
  assert.equal(smoke.summary.corpusId, 'release-smoke');
  assert.ok(smoke.summary.participants?.every((seat) => seat.visibility === 'private'));
  const hydrated = createTenantRuntimeRoomFromEvents(gomokuTenant, smoke.room.events);
  assert.ok(hydrated.ok);
  assert.equal(buildTenantGameSummary(gomokuTenant, hydrated.room).visibility, 'private');
  const normal = finishedGame('real-guest');
  assert.equal(normal.summary.visibility, 'public');
  assert.equal(normal.summary.corpusId, null);
  const pvp = finishedGame('prod-gomoku-smoke-1794874000001', 'real-opponent');
  assert.equal(pvp.summary.visibility, 'public');
});

test('forged smoke ids cannot hide an account seat or a human opponent', () => {
  const { room } = finishedGame('prod-gomoku-smoke-1794874000002');
  const isEngine = (id: string) => gomokuTenant.engine!.isEngineClientId(id);
  assert.equal(isReleaseSmokeRoom(room, isEngine), true);
  assert.equal(
    isReleaseSmokeRoom(
      {
        ...room,
        seatTokens: { black: { userId: 'real-account' } },
      },
      isEngine,
    ),
    false,
  );
  room.projection.seats.white = 'another-person';
  assert.equal(isReleaseSmokeRoom(room, isEngine), false);
});

test('smoke rooms are absent from live TV and current games before resignation', (t) => {
  const previous = process.env.MISTBOARD_GOMOKU_ENABLED;
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  t.after(() => {
    gomokuRooms.clear();
    if (previous === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = previous;
  });
  const smoke = finishedGame('prod-gomoku-smoke-1794874000003').room;
  const normal = finishedGame('normal-live-guest').room;
  for (const room of [smoke, normal]) {
    // Rebuild the real room's log just before its resignation.
    const created = createTenantRuntimeRoomFromEvents(gomokuTenant, room.events.slice(0, -1));
    assert.ok(created.ok);
    gomokuRooms.set(room.id, created.room);
  }
  registerLiveWatchPayloadBuilder('gomoku', async () => null);
  const ctx = { rooms: new Map() } as unknown as HttpApiContext;
  for (const rows of [collectCurrentGames(ctx), collectLiveTvCandidates(ctx)]) {
    assert.deepEqual(
      rows.map((game) => game.roomId),
      [normal.id],
    );
    assert.equal(JSON.stringify(rows).includes(smoke.id), false);
  }
});

test('readout guest players, public totals and abort counts exclude smoke provenance', () => {
  for (const predicate of [
    countedHumanGame,
    countedPublicGame,
    countedAbortedGame,
    preLaunchHumanGame,
    shortHumanGame,
  ])
    assert.match(predicate(), /g\.corpus_id IS DISTINCT FROM 'release-smoke'/);
  assert.match(internalHumanGame(), /g\.corpus_id IS NOT DISTINCT FROM 'release-smoke'/);
});

test('finished smoke persistence and public listing queries enforce private visibility', async (t) => {
  const previous = process.env.MISTBOARD_GOMOKU_ENABLED;
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = previous;
  });
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  const smoke = finishedGame('prod-gomoku-smoke-1794874000004');
  const normal = finishedGame('public-guest');
  const inserted = new Map<string, unknown[]>();
  const queries: string[] = [];
  let serveListings = false;
  const query = async (sql: string, params: unknown[] = []) => {
    queries.push(sql);
    if (sql.includes('INSERT INTO games')) inserted.set(params[0] as string, params);
    if (sql.includes('FROM users') && sql.includes('lower(handle)'))
      return { rows: [{ id: 'profile-user', handle: 'player', profile_visibility: 'public' }] };
    if (serveListings && sql.includes('eve_games.time_control')) {
      // A small query adapter at the DB boundary: the SQL contract above pins
      // the actual PostgreSQL visibility predicate; use the actual inserted
      // values to exercise the HTTP serializer without opening a local socket.
      assert.match(sql, /games\.visibility (?:<> 'private'|= 'public')/);
      return {
        rows: [...inserted.values()]
          .filter((values) => values[14] !== 'private')
          .map((values) => ({
            room_id: values[0],
            variant: values[1],
            result: values[2],
            termination: values[3],
            ply_count: values[4],
            started_at: values[5],
            ended_at: values[6],
            white_name: values[9],
            black_name: values[10],
            corpus_id: values[11],
            mode: values[12],
            visibility: values[14],
            rated: values[15],
            initial_ms: values[16],
            increment_ms: values[17],
          })),
      };
    }
    return { rows: [] };
  };
  t.mock.method(getPool(), 'query', query);
  t.mock.method(getPool(), 'connect', async () => ({ query, release() {} }));
  for (const game of [smoke, normal]) await recordGameEnd(game.room.id, game.summary);
  assert.equal(inserted.get(smoke.room.id)?.[14], 'private');
  assert.equal(inserted.get(normal.room.id)?.[14], 'public');
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['watch Gomoku', () => listWatchUnlockedGames({ variants: ['gomoku'], modes: ['pve'] })],
    ['recents', () => listRecentPublicGames()],
    ['homepage rail', () => listShowcaseGames({ variants: ['gomoku'] })],
    ['bot record', () => getBotGamesPage('rapfi', 'gomoku', 0, 15)],
    ['bot directory counts', () => listPublicBots()],
    ['public profile games', () => getUserGamesPage('player', null, 0, 15)],
    ['engine directory', () => listEngineVersionStats()],
    ['engine record', () => getEngineProfile('rapfi-level-1')],
  ];
  for (const [label, run] of cases) {
    queries.length = 0;
    await run();
    const gameQueries = queries.filter((sql) => /(?:FROM|JOIN) games\b/.test(sql));
    assert.ok(gameQueries.length > 0, `${label} exercises production SQL`);
    for (const sql of gameQueries)
      assert.match(sql, /games\.visibility (?:<> 'private'|= 'public')/, label);
  }
  serveListings = true;
  clearWatchRailCache();
  t.after(clearWatchRailCache);
  const ctx = { rooms: new Map(), inMemoryGameSummary: () => null } as unknown as HttpApiContext;
  for (const path of ['/api/watch?channel=gomoku', '/api/games/recent']) {
    let body = '';
    const response = {
      setHeader() {},
      writeHead(status: number) {
        assert.equal(status, 200);
      },
      end(chunk: string) {
        body = chunk;
      },
    } as unknown as ServerResponse;
    const url = new URL(path, 'http://localhost');
    assert.equal(
      await tryHandle(
        ctx,
        { method: 'GET', headers: {} } as IncomingMessage,
        response,
        url.pathname,
        url,
      ),
      true,
    );
    const payload = JSON.parse(body);
    const games = payload.unlocked ?? payload.games;
    assert.deepEqual(
      games.map((game: { roomId: string }) => game.roomId),
      [normal.room.id],
    );
    assert.equal(body.includes(smoke.room.id), false);
  }
});
