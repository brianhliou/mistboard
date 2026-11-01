import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import {
  GOMOKU_OPENINGS,
  GOMOKU_SPEC_ID,
  type GomokuOpening,
  type GomokuSquare,
  gameSpecForId,
  getGomokuPlayerView,
} from '@mistboard/game';
import { gomokuEnabled } from '../feature-flags.js';
import { gomokuRooms } from '../gomoku-registration.js';
import { type GomokuEvent, gomokuTenant } from '../gomoku-tenant.js';
import { handleApiRequest } from '../http-api.js';
import type { RecentEveGameRecord } from '../persistence.js';
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

async function request(path = `/api/gomoku/games/${ROOM_ID}`, method = 'GET') {
  let status = 0;
  let body = '';
  await handleApiRequest(
    {} as HttpApiContext,
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

test('Gomoku live payload builder is registered without opening watch or rated play', () => {
  assert.equal(hasLiveWatchPayloadBuilder('gomoku'), true);
  const registration = variantTenantForSpecId(GOMOKU_SPEC_ID)!;
  assert.equal(registration.watch, null);
  assert.equal(registration.export, null);
  assert.equal(registration.lobby?.supportsRated, false);
  assert.equal(gameSpecForId(GOMOKU_SPEC_ID).publicSurface, 'hidden');
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

test('Gomoku zero-move endings retain a terminal ply zero and unrated logs are required', async () => {
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
  assert.equal(
    await gomokuPostgameForApi(ROOM_ID, deps([{ ...created, rated: true }, resigned])),
    null,
  );
});

test('Gomoku live and finished payloads retain the browser Rapfi engine on either seat', async () => {
  const { gomokuPostgameForApi, gomokuLiveWatchPayload } = await api();
  for (const seat of gomokuTenant.colors) {
    const live = room();
    const assignment = live.events.find(
      (event) => event.type === 'seat-assigned' && event.seat === seat,
    )!;
    assert.equal(assignment.type, 'seat-assigned');
    if (assignment.type !== 'seat-assigned') throw new Error('missing seat');
    assignment.clientId = 'rapfi-level-5';
    gomokuRooms.set(ROOM_ID, live);
    try {
      const snapshot = await gomokuLiveWatchPayload(ROOM_ID);
      assert.ok(snapshot);
      assert.equal(snapshot.game.mode, 'pve');
      assert.equal(snapshot.game.pveEngineId, 'rapfi-level-5');
      finish(live);
      const payload = await gomokuPostgameForApi(
        ROOM_ID,
        deps(live.events, gameRecord({ mode: 'pve' })),
      );
      assert.ok(payload);
      assert.equal(payload.game.pveEngineId, 'rapfi-level-5');
      assert.equal(payload.game.rated, false);
      assert.equal(JSON.stringify(payload).includes('"clientId"'), false);
    } finally {
      gomokuRooms.clear();
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
