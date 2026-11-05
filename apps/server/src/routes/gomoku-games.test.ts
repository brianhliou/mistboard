import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  exportFormatsForVariant,
  GOMOKU_OPENINGS,
  GOMOKU_SPEC_ID,
  type GomokuOpening,
  type GomokuSquare,
  gameSpecForId,
  getGomokuPlayerView,
} from '@mistboard/game';
import { gomokuEnabled } from '../feature-flags.js';
import { resolveGameExport } from '../game-export-tenant.js';
import { resolveGomokuAnalysis } from '../gomoku-analysis.js';
import { gomokuRooms } from '../gomoku-registration.js';
import { type GomokuEvent, gomokuTenant } from '../gomoku-tenant.js';
import { handleApiRequest } from '../http-api.js';
import type { RecentEveGameRecord, UserAccount } from '../persistence.js';
import { variantTenantForSpecId } from '../variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoom,
  replayTenantEvents,
} from '../variant-tenant/runtime.js';
import {
  collectLiveTvCandidates,
  hasLiveWatchPayloadBuilder,
  liveWatchPayloadForFeatured,
} from '../watch-live.js';
import type { HttpApiContext } from './lib.js';

const ROOM_ID = 'gmk_replay';
const TC = { initialMs: 60_000, incrementMs: 1_000 };
const previousFlag = process.env.MISTBOARD_GOMOKU_ENABLED;
before(() => {
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
});
after(() => {
  if (previousFlag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
  else process.env.MISTBOARD_GOMOKU_ENABLED = previousFlag;
  gomokuRooms.clear();
});

function room(opening: GomokuOpening = GOMOKU_OPENINGS[0]!, timed = true) {
  const created = createTenantRuntimeRoom(
    { ...gomokuTenant, rules: { ...gomokuTenant.rules, createSetup: () => opening } },
    ROOM_ID,
    { now: 1_000, ...(timed ? { timeControl: TC } : {}) },
  );
  assert.ok(created.ok);
  const live = created.room;
  for (const seat of gomokuTenant.colors) {
    appendTenantRuntimeEvent(gomokuTenant, live, {
      type: 'seat-assigned',
      at: 1_100,
      roomId: ROOM_ID,
      seat,
      clientId: `${seat}-player`,
    });
  }
  for (const [i, to] of ['a1', 'b1', 'a2'].entries()) {
    const status = live.projection.state.status;
    assert.equal(status.type, 'playing');
    if (status.type !== 'playing') throw new Error('unexpected terminal state');
    assert.notEqual(
      appendTenantRuntimeEvent(gomokuTenant, live, {
        type: 'move-played',
        at: 2_000 + i * 2_000,
        roomId: ROOM_ID,
        color: status.turn,
        move: { to: to as GomokuSquare },
      }),
      -1,
    );
  }
  return live;
}

function finish(live = room(), type: 'seat-resigned' | 'seat-forfeited' = 'seat-resigned') {
  appendTenantRuntimeEvent(gomokuTenant, live, {
    type,
    at: 9_000,
    roomId: ROOM_ID,
    color: 'white',
  });
  return live;
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: GOMOKU_SPEC_ID,
    mode: 'pvp',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: 3,
    startedAt: new Date(1_000),
    endedAt: new Date(9_000),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: TC.initialMs,
    incrementMs: TC.incrementMs,
    ...overrides,
  };
}

function deps(
  events: readonly unknown[] | null,
  record: RecentEveGameRecord | null = gameRecord(),
) {
  return { getGameSummary: async () => record, loadRoomEvents: async () => events };
}

const api = () => import('./gomoku-games.js');

test('Gomoku analysis admission protects GET, POST and job polls before any data reads', async () => {
  const { tryHandle } = await api();
  const previous = process.env.MISTBOARD_GOMOKU_ENABLED;
  process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
  try {
    for (const user of [null, { id: 'member', accountRole: 'user' }]) {
      for (const [method, suffix] of [
        ['GET', 'analysis'],
        ['POST', 'analysis'],
        ['GET', 'analysis/jobs/private'],
      ] as const) {
        const path = `/api/gomoku/games/${ROOM_ID}/${suffix}`;
        let status = 0;
        let body = '';
        const handled = await tryHandle(
          {} as HttpApiContext,
          { method } as IncomingMessage,
          {
            writeHead(value: number) {
              status = value;
              return this;
            },
            end(value = '') {
              body = value;
            },
          } as unknown as ServerResponse,
          path,
          new URL(path, 'http://localhost'),
          {
            getGameSummary: async () => {
              throw new Error('denied read');
            },
            loadRoomEvents: async () => {
              throw new Error('denied read');
            },
            currentAccountUser: async () => user as UserAccount | null,
          },
        );
        assert.equal(handled, true);
        assert.equal(status, 404);
        assert.deepEqual(JSON.parse(body), { error: 'not_found' });
      }
    }
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = previous;
  }
});

test('Gomoku analysis serves an admin the persisted series with the flag off', async () => {
  const { tryHandle } = await api();
  const previous = process.env.MISTBOARD_GOMOKU_ENABLED;
  process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
  const plies = [{ ply: 0, cp: 414, mate: null, best: 'f7' }];
  let reads = 0;
  try {
    const path = `/api/gomoku/games/${ROOM_ID}/analysis`;
    let status = 0;
    let body = '';
    const handled = await tryHandle(
      {} as HttpApiContext,
      { method: 'GET' } as IncomingMessage,
      {
        writeHead(value: number) {
          status = value;
          return this;
        },
        end(value = '') {
          body = value;
        },
      } as unknown as ServerResponse,
      path,
      new URL(path, 'http://localhost'),
      {
        ...deps(finish().events),
        currentAccountUser: async () => ({ id: 'admin', accountRole: 'admin' }) as UserAccount,
        resolveAnalysis: async (roomId, moves, opening, _cache, _analyze, compute) => {
          assert.equal(roomId, ROOM_ID);
          assert.deepEqual(
            moves.map((m) => m.to),
            ['a1', 'b1', 'a2'],
          );
          assert.deepEqual(opening?.stones, GOMOKU_OPENINGS[0]!.stones);
          assert.equal(compute, false);
          return resolveGomokuAnalysis(
            roomId,
            moves,
            opening,
            {
              get: async () => {
                reads++;
                return plies;
              },
              save: async () => {
                throw new Error('cached GET wrote');
              },
            },
            async () => {
              throw new Error('cached GET searched');
            },
            compute,
          );
        },
      },
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(body).plies, plies);
    assert.equal(reads, 1);
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = previous;
  }
});

test('Gomoku analysis route is registered and rejects unfinished or invalid logs', async () => {
  // Exercise real HTTP dispatch without sockets, persistence or an engine.
  const path = `/api/gomoku/games/${ROOM_ID}/analysis`;
  const live = room();
  gomokuRooms.set(ROOM_ID, live);
  assert.equal((await request(path)).status, 404);
  const { tryHandle } = await api();
  let status = 0;
  await tryHandle(
    {} as HttpApiContext,
    { method: 'GET' } as IncomingMessage,
    {
      writeHead(value: number) {
        status = value;
        return this;
      },
      end() {},
    } as unknown as ServerResponse,
    path,
    new URL(path, 'http://localhost'),
    {
      ...deps([...finish().events, { type: 'invalid' }]),
      currentAccountUser: async () => ({ id: 'admin', accountRole: 'admin' }) as UserAccount,
    },
  );
  assert.equal(status, 404);
  assert.equal((await request(`/api/gomoku/games/%ZZ/analysis`)).status, 404);
  gomokuRooms.clear();
});

async function request(
  path = `/api/gomoku/games/${ROOM_ID}`,
  method = 'GET',
  ctx = {} as HttpApiContext,
) {
  let status = 0;
  let body = '';
  await handleApiRequest(
    ctx,
    { url: path, method } as IncomingMessage,
    {
      writeHead: (value: number) => {
        status = value;
      },
      end: (value: string) => {
        body = value;
      },
    } as unknown as ServerResponse,
  );
  return { status, body: JSON.parse(body) };
}

test('Gomoku finished endpoint is registered in HTTP dispatch', async () => {
  const live = finish();
  gomokuRooms.set(ROOM_ID, live);
  try {
    const result = await request();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.view.status, live.projection.state.status);
    assert.equal(result.body.game.rated, false);
    assert.equal((await request(undefined, 'POST')).status, 405);
    assert.equal((await request('/api/gomoku/games/%ZZ')).status, 404);
  } finally {
    gomokuRooms.clear();
  }
});

test('Gomoku finished games link to their tenant review instead of the live room', () => {
  const registration = variantTenantForSpecId(GOMOKU_SPEC_ID)!;
  assert.equal(registration.reviewRouteBase, '/gomoku/game');
  assert.equal(registration.finishedGameOpensRoom, undefined);
});

test('Gomoku JSON export preserves recorded openings and replays every placement', () => {
  assert.deepEqual(exportFormatsForVariant('gomoku'), ['json']);
  for (const opening of [
    { stones: [], turn: 'black' } as GomokuOpening,
    ...[3, 4, 5].map((count) => GOMOKU_OPENINGS.find((entry) => entry.stones.length === count)!),
  ]) {
    const live = finish(room(opening));
    const firstMove = live.events.find((event) => event.type === 'move-played')!;
    firstMove.clock = {
      initialMs: TC.initialMs,
      incrementMs: TC.incrementMs,
      remainingMs: { black: 58_123, white: 59_456 },
      activeColor: gomokuTenant.oppositeColor(firstMove.color),
      runningSince: firstMove.at,
    };
    const resolved = resolveGameExport({
      roomId: ROOM_ID,
      format: 'json',
      summary: gameRecord(),
      events: live.events,
    });
    assert.equal(resolved.status, 200);
    if (resolved.status !== 200) throw new Error('missing JSON export');
    const payload = JSON.parse(resolved.body);
    assert.deepEqual(payload.opening, { stones: opening.stones, turn: opening.turn });
    assert.equal(payload.source.game_url, `https://mistboard.com/gomoku/game/${ROOM_ID}`);
    assert.deepEqual(Object.keys(payload.players), ['black', 'white']);
    assert.equal(payload.result, 'black');
    assert.equal(payload.ply_count, 3);
    assert.deepEqual(
      payload.plies.map((ply: { uci: string }) => ply.uci),
      ['a1', 'b1', 'a2'],
    );
    let replay = createGomokuRoomState(ROOM_ID, payload.opening);
    for (const ply of payload.plies) {
      assert.equal(replay.status.type === 'playing' && replay.status.turn, ply.mover);
      const next = applyGomokuRoomMove(replay, { to: ply.uci });
      assert.notEqual(next, replay);
      replay = next;
    }
    assert.deepEqual(replay.board, live.projection.state.board);
    assert.equal(payload.plies[0].black_clock_ms_after, 58_123);
    assert.equal(payload.plies[0].white_clock_ms_after, 59_456);
    assert.equal(
      resolveGameExport({
        roomId: ROOM_ID,
        format: 'pgn',
        summary: gameRecord(),
        events: live.events,
      }).status,
      501,
    );
  }
});

test('Gomoku legacy export uses an empty opening; live, aborted and flag-off logs export no data', () => {
  const legacy = finish(room({ stones: [], turn: 'black' }));
  const created = legacy.events[0];
  assert.equal(created?.type, 'room-created');
  if (created?.type !== 'room-created') throw new Error('missing room-created');
  delete created.setup;
  const resolve = (events: readonly unknown[]) =>
    resolveGameExport({
      roomId: ROOM_ID,
      format: 'json',
      summary: gameRecord(),
      events,
    });
  const result = resolve(legacy.events);
  assert.equal(result.status, 200);
  if (result.status !== 200) throw new Error('missing legacy export');
  assert.deepEqual(JSON.parse(result.body).opening, { stones: [], turn: 'black' });
  const playing = room();
  assert.deepEqual(resolve(playing.events), { status: 403, body: { error: 'game_not_public' } });
  assert.deepEqual(
    resolve(
      playing.events.slice(0, 1).concat({
        type: 'game-aborted',
        at: 10_000,
        roomId: ROOM_ID,
        reason: 'user-abort',
      } as GomokuEvent),
    ),
    { status: 403, body: { error: 'game_not_public' } },
  );
  process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
  try {
    assert.deepEqual(resolve(legacy.events), { status: 403, body: { error: 'game_not_public' } });
  } finally {
    process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  }
});

test('canonical Gomoku export HTTP surface serves JSON only while its flag is on', async () => {
  const live = finish();
  const ctx = {
    rooms: new Map([[ROOM_ID, { events: live.events }]]),
    inMemoryGameSummary: () => gameRecord(),
  } as unknown as HttpApiContext;
  const path = `/api/games/${ROOM_ID}/export.json`;
  const result = await request(path, 'GET', ctx);
  assert.equal(result.status, 200);
  assert.equal(result.body.variant, 'gomoku');
  assert.deepEqual(result.body.opening, live.projection.state.opening);
  assert.equal((await request(path, 'POST', ctx)).status, 405);
  process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
  try {
    assert.deepEqual(await request(path, 'GET', ctx), {
      status: 403,
      body: { error: 'game_not_public' },
    });
  } finally {
    process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  }
});

test('Gomoku live payload builder and watch capability support public listings and rated play', () => {
  assert.equal(hasLiveWatchPayloadBuilder('gomoku'), true);
  const registration = variantTenantForSpecId(GOMOKU_SPEC_ID)!;
  assert.equal(registration.watch?.channelId, GOMOKU_SPEC_ID);
  assert.equal(registration.export?.gameRouteBase, '/gomoku/game');
  assert.equal(registration.lobby?.supportsRated, true);
  assert.equal(gameSpecForId(GOMOKU_SPEC_ID).publicSurface, 'casual');
  const live = room();
  gomokuRooms.set(ROOM_ID, live);
  try {
    assert.equal(
      collectLiveTvCandidates({ rooms: new Map() } as HttpApiContext).some(
        (candidate) => candidate.gameSpecId === GOMOKU_SPEC_ID,
      ),
      false,
    );
  } finally {
    gomokuRooms.clear();
  }
});

test('Gomoku flag off denies HTTP, replay helpers and live snapshots before reading data', async () => {
  const { gomokuPostgameForApi, gomokuLiveWatchPayload } = await api();
  const live = finish();
  gomokuRooms.set(ROOM_ID, live);
  delete process.env.MISTBOARD_GOMOKU_ENABLED;
  try {
    assert.equal(gomokuEnabled(), false);
    assert.deepEqual(await request(), { status: 404, body: { error: 'not_found' } });
    const noReads = {
      getGameSummary: async () => {
        throw new Error('must not read');
      },
      loadRoomEvents: async () => {
        throw new Error('must not read');
      },
      getLiveRoom: () => {
        throw new Error('must not read');
      },
    };
    assert.equal(await gomokuPostgameForApi(ROOM_ID, noReads), null);
    assert.equal(await gomokuLiveWatchPayload(ROOM_ID), null);
  } finally {
    process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
    gomokuRooms.clear();
  }
});

test('Gomoku replay uses recorded 3/4/5-stone openings and numbers only played plies', async () => {
  const { gomokuPostgameForApi } = await api();
  for (const count of [3, 4, 5]) {
    const opening = GOMOKU_OPENINGS.find((opening) => opening.stones.length === count)!;
    assert.ok(opening);
    const live = finish(room(opening));
    const payload = await gomokuPostgameForApi(ROOM_ID, deps(live.events));
    assert.ok(payload);
    assert.equal(payload.game.variant, GOMOKU_SPEC_ID);
    assert.equal(payload.game.startedAt, new Date(1_000).toISOString());
    assert.equal(payload.game.endedAt, new Date(9_000).toISOString());
    assert.equal(payload.game.plyCount, 3);
    assert.equal(payload.state.moveNumber, 2);
    assert.deepEqual(
      payload.history.truth.map(({ ply }) => ply),
      [0, 1, 2, 3],
    );
    assert.deepEqual(
      payload.history.truth.map(({ view }) => view.ply),
      [count, count + 1, count + 2, count + 3],
    );
    assert.deepEqual(payload.history.truth[0]!.view.opening, {
      stones: opening.stones,
      turn: opening.turn,
    });
    assert.equal(payload.history.truth[0]!.view.board.filter(Boolean).length, count);
    const moves = payload.timeline.filter((entry) => entry.type === 'move-played');
    assert.deepEqual(
      moves.map(({ ply, at }) => [ply, at]),
      [
        [1, 2_000],
        [2, 4_000],
        [3, 6_000],
      ],
    );
    assert.equal(moves[0]!.color, opening.turn);
    assert.deepEqual(payload.view, getGomokuPlayerView(live.projection.state, 'black', true));
    assert.deepEqual(payload.views.truth, payload.view);
    assert.ok(payload.history.truth.every(({ view }) => view.legalMoves.length === 0));
    assert.deepEqual(payload.history.truth.at(-1)!.view.status, payload.state.status);
    assert.deepEqual(payload.history.truth.at(-1)!.clock, live.projection.clock);
    assert.equal(payload.history.truth.at(-1)!.at, 9_000);
    assert.deepEqual(payload.state.clock, live.projection.clock);
    assert.deepEqual(payload.state.timeControl, TC);
    const json = JSON.stringify(payload);
    for (const field of ['clientId', 'setup', 'screening', 'winrate', 'score'])
      assert.equal(json.includes(`"${field}"`), false, field);
  }
});

test('Gomoku final history preserves untimed resignation, forfeit and agreed draw', async () => {
  const { gomokuPostgameForApi } = await api();
  for (const type of ['seat-resigned', 'seat-forfeited', 'draw-agreed'] as const) {
    const live = room(undefined, false);
    if (type === 'draw-agreed') {
      appendTenantRuntimeEvent(gomokuTenant, live, {
        type: 'draw-offered',
        at: 8_000,
        roomId: ROOM_ID,
        color: 'black',
      });
    }
    appendTenantRuntimeEvent(gomokuTenant, live, {
      type,
      at: 9_000,
      roomId: ROOM_ID,
      color: 'white',
    });
    const payload = await gomokuPostgameForApi(ROOM_ID, deps(live.events));
    assert.ok(payload);
    assert.deepEqual(payload.history.truth.at(-1)!.view.status, live.projection.state.status);
    assert.equal(payload.history.truth.at(-1)!.at, 9_000);
    assert.ok(payload.history.truth.every(({ clock }) => clock === undefined));
    assert.equal(payload.state.clock, undefined);
    assert.equal(payload.timeline.at(-1)!.type, type);
    assert.equal(payload.timeline.at(-1)!.at, 9_000);
  }
});

test('Gomoku timeout preserves the recorded flag clock in the terminal history', async () => {
  const { gomokuPostgameForApi } = await api();
  const live = room();
  const clock = {
    ...live.projection.clock!,
    remainingMs: { black: 50_000, white: 0 },
    activeColor: null,
    runningSince: null,
  };
  appendTenantRuntimeEvent(gomokuTenant, live, {
    type: 'clock-expired',
    at: 70_000,
    roomId: ROOM_ID,
    color: 'white',
    clock,
  });
  const payload = await gomokuPostgameForApi(ROOM_ID, deps(live.events));
  assert.ok(payload);
  assert.deepEqual(payload.state.status, { type: 'finished', winner: 'black', reason: 'timeout' });
  assert.deepEqual(payload.history.truth.at(-1)!.clock, clock);
  assert.deepEqual(payload.history.truth.at(-1)!.view.status, payload.state.status);
  assert.equal(payload.history.truth.at(-1)!.at, 70_000);
  assert.deepEqual(payload.timeline.at(-1), {
    type: 'clock-expired',
    at: 70_000,
    color: 'white',
    winner: 'black',
  });
});

test('Gomoku snapshots retain recorded move clocks and clock pause/resume events', async () => {
  const { gomokuPostgameForApi } = await api();
  const live = room();
  const moves = live.events.filter((event) => event.type === 'move-played');
  const first = moves[0]!;
  // Persisted clock snapshots are authoritative, including values that cannot
  // be recovered just by subtracting adjacent event timestamps.
  first.clock = {
    initialMs: TC.initialMs,
    incrementMs: TC.incrementMs,
    remainingMs: { black: 58_123, white: 59_456 },
    activeColor: gomokuTenant.oppositeColor(first.color),
    runningSince: first.at,
  };
  live.projection = replayTenantEvents(gomokuTenant, live.events);
  const paused = { ...live.projection.clock!, activeColor: null, runningSince: null };
  appendTenantRuntimeEvent(gomokuTenant, live, {
    type: 'clock-paused',
    at: 7_000,
    roomId: ROOM_ID,
    activeColor: live.projection.clock!.activeColor,
    clock: paused,
    reason: 'shutdown',
  });
  const resumed = { ...paused, activeColor: 'black' as const, runningSince: 8_000 };
  appendTenantRuntimeEvent(gomokuTenant, live, {
    type: 'clock-resumed',
    at: 8_000,
    roomId: ROOM_ID,
    clock: resumed,
    reason: 'players-returned',
  });
  finish(live);
  const payload = await gomokuPostgameForApi(ROOM_ID, deps(live.events));
  assert.ok(payload);
  assert.deepEqual(payload.history.truth[0]!.clock?.remainingMs, { black: 60_000, white: 60_000 });
  assert.deepEqual(payload.history.truth[1]!.clock, first.clock);
  const secondIndex = live.events.indexOf(moves[1]!);
  assert.deepEqual(
    payload.history.truth[2]!.clock,
    replayTenantEvents(gomokuTenant, live.events.slice(0, secondIndex + 1)).clock,
  );
  assert.deepEqual(payload.history.truth.at(-1)!.clock, live.projection.clock);
  assert.equal(payload.history.truth.length, 4);
});

test('Gomoku zero-move endings retain a terminal ply zero and rated logs replay', async () => {
  const { gomokuPostgameForApi } = await api();
  const created: GomokuEvent = {
    type: 'room-created',
    at: 1_000,
    roomId: ROOM_ID,
    gameSpecId: GOMOKU_SPEC_ID,
  };
  const resigned: GomokuEvent = {
    type: 'seat-resigned',
    at: 2_000,
    roomId: ROOM_ID,
    color: 'white',
  };
  const payload = await gomokuPostgameForApi(
    ROOM_ID,
    deps([created, resigned], gameRecord({ plyCount: 0 })),
  );
  assert.ok(payload);
  assert.equal(payload.history.truth.length, 1);
  assert.equal(payload.history.truth[0]!.ply, 0);
  assert.equal(payload.history.truth[0]!.at, 2_000);
  assert.deepEqual(payload.history.truth[0]!.view.status, payload.state.status);
  const rated = await gomokuPostgameForApi(
    ROOM_ID,
    deps([{ ...created, rated: true }, resigned], gameRecord({ plyCount: 0, rated: true })),
  );
  assert.ok(rated);
  assert.equal(rated.game.rated, true);
  assert.equal(rated.history.truth[0]!.ply, 0);
  assert.equal(
    await gomokuPostgameForApi(
      ROOM_ID,
      deps([{ ...created, rated: true }, resigned], gameRecord({ plyCount: 0, rated: false })),
    ),
    null,
  );
});

test('Gomoku live and finished payloads retain the browser Rapfi engine on either seat', async () => {
  const { gomokuPostgameForApi, gomokuLiveWatchPayload } = await api();
  for (const level of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const seat of gomokuTenant.colors) {
      const live = room();
      const assignment = live.events.find(
        (event) => event.type === 'seat-assigned' && event.seat === seat,
      )!;
      assert.equal(assignment.type, 'seat-assigned');
      if (assignment.type !== 'seat-assigned') throw new Error('missing seat');
      assignment.clientId = `rapfi-level-${level}`;
      gomokuRooms.set(ROOM_ID, live);
      try {
        const snapshot = await gomokuLiveWatchPayload(ROOM_ID);
        assert.ok(snapshot);
        assert.equal(snapshot.game.mode, 'pve');
        assert.equal(snapshot.game.pveEngineId, `rapfi-level-${level}`);
        assert.equal(JSON.stringify(snapshot).includes('"clientId"'), false);
        finish(live);
        const payload = await gomokuPostgameForApi(
          ROOM_ID,
          deps(live.events, gameRecord({ mode: 'pve' })),
        );
        assert.ok(payload);
        assert.equal(payload.game.pveEngineId, `rapfi-level-${level}`);
        assert.equal(payload.game.rated, false);
        assert.equal(JSON.stringify(payload).includes('"clientId"'), false);
      } finally {
        gomokuRooms.clear();
      }
    }
  }
});

test('Gomoku five-in-a-row and legacy empty-board logs preserve winning-line evidence', async () => {
  const { gomokuPostgameForApi } = await api();
  const events: GomokuEvent[] = [
    { type: 'room-created', roomId: ROOM_ID, at: 1_000, gameSpecId: GOMOKU_SPEC_ID },
  ];
  for (const [i, to] of ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e1'].entries())
    events.push({
      type: 'move-played',
      at: 2_000 + i,
      roomId: ROOM_ID,
      color: i % 2 ? 'white' : 'black',
      move: { to: to as GomokuSquare },
    });
  const payload = await gomokuPostgameForApi(
    ROOM_ID,
    deps(events, gameRecord({ plyCount: 9, termination: 'race' })),
  );
  assert.ok(payload);
  assert.equal(payload.history.truth[0]!.view.ply, 0);
  assert.deepEqual(payload.view.status, { type: 'finished', winner: 'black', reason: 'five' });
  assert.deepEqual(payload.view.winningLine, ['a1', 'b1', 'c1', 'd1', 'e1']);
  assert.deepEqual(payload.history.truth.at(-1)!.view, payload.view);
});

test('Gomoku rejects missing, unfinished, aborted, foreign and invalid logs and records', async () => {
  const { gomokuPostgameForApi } = await api();
  const live = finish();
  const events = live.events;
  for (const record of [
    null,
    gameRecord({ variant: 'xiangqi' }),
    gameRecord({ roomId: 'gmk_other' }),
    gameRecord({ rated: true }),
  ])
    assert.equal(await gomokuPostgameForApi(ROOM_ID, deps(events, record)), null);
  const created = events[0]!;
  const invalidLogs: Array<readonly unknown[] | null> = [
    null,
    [],
    events.slice(0, -1),
    [{ ...created, setup: null }, ...events.slice(1)],
    [{ ...created, gameSpecId: 'xiangqi' }, ...events.slice(1)],
    [...events, created],
    events.map((event) => ({ ...event, roomId: 'gmk_other' })),
    [...events.slice(0, -1), { type: 'unknown', at: 9_000, roomId: ROOM_ID }],
    [
      ...events,
      { type: 'move-played', at: 10_000, roomId: ROOM_ID, color: 'white', move: { to: 'c1' } },
    ],
    [
      created,
      { type: 'move-played', at: 2_000, roomId: ROOM_ID, color: 'black', move: { to: 'p1' } },
      ...events.slice(-1),
    ],
    [
      created,
      {
        type: 'move-played',
        at: 2_000,
        roomId: ROOM_ID,
        color:
          created.type === 'room-created' && (created.setup as GomokuOpening).turn === 'black'
            ? 'white'
            : 'black',
        move: { to: 'a1' },
      },
      ...events.slice(-1),
    ],
    [created, { type: 'game-aborted', at: 1_500, roomId: ROOM_ID, reason: 'pregame-timeout' }],
    [created, { ...events.at(-1), at: Number.NaN }],
  ];
  for (const log of invalidLogs)
    assert.equal(await gomokuPostgameForApi(ROOM_ID, deps(log)), null, JSON.stringify(log));
  // A syntactically valid move on an occupied opening point fails during replay.
  const opening = (created as Extract<GomokuEvent, { type: 'room-created' }>)
    .setup as GomokuOpening;
  assert.equal(
    await gomokuPostgameForApi(
      ROOM_ID,
      deps([
        created,
        {
          type: 'move-played',
          at: 2_000,
          roomId: ROOM_ID,
          color: opening.turn,
          move: { to: opening.stones[0]!.square },
        },
        ...events.slice(-1),
      ]),
    ),
    null,
  );
});

test('Gomoku live builder replays events into spectator snapshots and preserves clocks', async () => {
  const { gomokuLiveWatchPayload } = await api();
  const live = room();
  const projection = replayTenantEvents(gomokuTenant, live.events);
  // An unrecorded projection must not become the spectator's source of truth.
  live.projection = { ...projection, state: { ...projection.state, board: Array(225).fill(null) } };
  gomokuRooms.set(ROOM_ID, live);
  try {
    const payload = await gomokuLiveWatchPayload(ROOM_ID);
    assert.ok(payload);
    assert.equal(payload.game.plyCount, 3);
    assert.equal(payload.game.rated, false);
    assert.equal(payload.game.result, 'in-progress');
    assert.equal(payload.game.endedAt, null);
    assert.deepEqual(payload.view, getGomokuPlayerView(projection.state, 'black', true));
    assert.deepEqual(payload.state.clock, projection.clock);
    assert.deepEqual(payload.history.truth.at(-1)!.clock, projection.clock);
    assert.deepEqual(
      payload.history.truth.map(({ ply }) => ply),
      [0, 1, 2, 3],
    );
    assert.ok(payload.history.truth.every(({ view }) => view.legalMoves.length === 0));
    assert.deepEqual(
      await liveWatchPayloadForFeatured({
        roomId: ROOM_ID,
        gameSpecId: GOMOKU_SPEC_ID,
        channelId: 'gomoku',
      } as Parameters<typeof liveWatchPayloadForFeatured>[0]),
      payload,
    );
    assert.equal(await gomokuLiveWatchPayload('gmk_missing'), null);
    // The awaited write ends the game before the builder takes its snapshot.
    live.projection = projection;
    live.pendingWrites = Promise.resolve().then(() => {
      finish(live);
    });
    assert.equal(await gomokuLiveWatchPayload(ROOM_ID), null);
    live.events[0] = { ...live.events[0]!, roomId: 'gmk_other' };
    assert.equal(await gomokuLiveWatchPayload(ROOM_ID), null);
  } finally {
    gomokuRooms.clear();
  }
});

test('rated Gomoku live and memory-only finished summaries retain replayed rating state', async () => {
  const { gomokuLiveWatchPayload, gomokuPostgameForApi } = await api();
  const created = createTenantRuntimeRoom(gomokuTenant, ROOM_ID, {
    now: 1000,
    rated: true,
    timeControl: { initialMs: 300_000, incrementMs: 5_000 },
  });
  assert.ok(created.ok);
  gomokuRooms.set(ROOM_ID, created.room);
  try {
    const live = await gomokuLiveWatchPayload(ROOM_ID);
    assert.ok(live);
    assert.equal(JSON.parse(JSON.stringify(live)).game.rated, true);
    appendTenantRuntimeEvent(gomokuTenant, created.room, {
      type: 'seat-resigned',
      at: 2000,
      roomId: ROOM_ID,
      color: 'white',
    });
    const finished = await gomokuPostgameForApi(ROOM_ID, {
      ...deps([]),
      isPersistenceEnabled: () => false,
      getLiveRoom: () => created.room,
    });
    assert.ok(finished);
    assert.equal(JSON.parse(JSON.stringify(finished)).game.rated, true);
  } finally {
    gomokuRooms.clear();
  }
});
