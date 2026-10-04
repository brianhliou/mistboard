import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
} from '@mistboard/game';
import {
  type CrazyhouseXiangqiEvent,
  crazyhouseXiangqiTenant,
} from './crazyhouse-xiangqi-tenant.js';
import { logger } from './obs.js';
import type { RecentEveGameRecord } from './persistence.js';
import {
  filterReplayableGames,
  markUnavailableGames,
  type ReplayableGameDeps,
} from './replayable-games.js';
import { crazyhouseXiangqiPostgameForApi } from './routes/crazyhouse-xiangqi-games.js';
import { answerApiFailure } from './server-http.js';
import {
  isKnownUnreplayableGame,
  resetTenantReplayGuardForTests,
  UnreplayableTenantGameError,
} from './variant-tenant/replay-guard.js';
import { createTenantRuntimeRoomFromEvents, tenantReplayCheck } from './variant-tenant/runtime.js';

// Crazyhouse Xiangqi's rules changed on 2026-10-02: advisors and elephants now
// start in hand. A game played under the old rules opened with the elephant on
// c1 stepping to e3; under the new rules c1 is empty and the stored move is
// illegal, so the replay throws. That is the fixture: a finished game whose
// stored log no longer replays.
const GOOD_ID = 'chx_replays';
const LEGACY_ID = 'chx_legacy_rules';

function finishedEvents(roomId: string, line: readonly CrazyhouseXiangqiMove[]) {
  const events: CrazyhouseXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: CRAZYHOUSE_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
  let state: CrazyhouseXiangqiGameState = createInitialCrazyhouseXiangqiState(roomId);
  let at = 4;
  for (const move of line) {
    const color = state.status.type === 'playing' ? state.status.turn : 'red';
    events.push({ type: 'move-played', at: at++, roomId, color, move });
    try {
      state = applyCrazyhouseXiangqiMove(state, move);
    } catch {
      // The legacy move: stored as played, illegal under today's rules.
      state = { ...state, status: { type: 'playing', turn: color === 'red' ? 'black' : 'red' } };
    }
  }
  events.push({ type: 'seat-resigned', at, roomId, color: 'black' });
  return events;
}

const goodEvents = () => finishedEvents(GOOD_ID, [{ from: 'h3', to: 'h10' }]);
const legacyEvents = () =>
  finishedEvents(LEGACY_ID, [
    { from: 'c1', to: 'e3' },
    { from: 'h8', to: 'h1' },
  ]);

function record(roomId: string): RecentEveGameRecord {
  return {
    roomId,
    variant: CRAZYHOUSE_XIANGQI_SPEC_ID,
    mode: 'pvp',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: 2,
    startedAt: new Date(1),
    endedAt: new Date(100),
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
    initialMs: null,
    incrementMs: null,
  };
}

function fakeResponse() {
  const sent: { status: number | null; body: string | null } = { status: null, body: null };
  return {
    sent,
    response: {
      headersSent: false,
      writeHead(status: number) {
        sent.status = status;
        return this;
      },
      end(body?: string) {
        sent.body = body ?? null;
        return this;
      },
    } as unknown as Parameters<typeof answerApiFailure>[0],
  };
}

beforeEach(() => resetTenantReplayGuardForTests());

test('a stored game the current rules refuse is a 410 from the postgame route, not a 404 or 500', async () => {
  const loadLegacy = async () => {
    try {
      await crazyhouseXiangqiPostgameForApi(LEGACY_ID, {
        getGameSummary: async () => record(LEGACY_ID),
        loadRoomEvents: async () => legacyEvents(),
      });
    } catch (err) {
      return err;
    }
    return null;
  };
  const warn = logger.warn;
  let warns = 0;
  logger.warn = (() => {
    warns += 1;
  }) as typeof logger.warn;
  let thrown: unknown = null;
  try {
    thrown = await loadLegacy();
    await loadLegacy();
  } finally {
    logger.warn = warn;
  }
  assert.equal(warns, 1, 'one warn per game id, however often it is opened');
  assert.ok(thrown instanceof UnreplayableTenantGameError, 'the replay boundary names the failure');
  assert.equal(thrown.roomId, LEGACY_ID);
  assert.match(thrown.message, /illegal move/);
  assert.equal(isKnownUnreplayableGame(LEGACY_ID), true);

  // The API catch-all answers it as a game that is gone for good, and says
  // why, so the postgame page can tell the reader rather than "not found".
  const { sent, response } = fakeResponse();
  answerApiFailure(response, `/api/crazyhouse-xiangqi/games/${LEGACY_ID}`, thrown);
  assert.equal(sent.status, 410);
  assert.deepEqual(JSON.parse(sent.body ?? 'null'), { error: 'retired_rules' });

  // Any other failure is still a 500.
  const other = fakeResponse();
  const consoleError = console.error;
  console.error = () => {};
  try {
    answerApiFailure(other.response, '/api/x', new Error('boom'));
  } finally {
    console.error = consoleError;
  }
  assert.equal(other.sent.status, 500);
});

test('the TV picker skips a game whose stored log no longer replays, and checks each game once', async () => {
  const eventsByRoom = new Map<string, readonly unknown[]>([
    [GOOD_ID, goodEvents()],
    [LEGACY_ID, legacyEvents()],
  ]);
  const loads: string[][] = [];
  const deps: ReplayableGameDeps = {
    registrationForRoomId: (roomId) =>
      roomId.startsWith('chx_') ? { replays: tenantReplayCheck(crazyhouseXiangqiTenant) } : null,
    loadRoomsEvents: async (roomIds) => {
      loads.push([...roomIds]);
      return new Map(
        roomIds.flatMap((id) => (eventsByRoom.has(id) ? [[id, eventsByRoom.get(id)!]] : [])),
      );
    },
  };
  // A showcase pool: the legacy game sits between a good tenant game and a
  // chess-stack game (no tenant registration, passes through untouched).
  const pool = [
    record(GOOD_ID),
    record(LEGACY_ID),
    { ...record('chess-room'), variant: 'dark-chess' },
  ];

  const first = await filterReplayableGames(pool, deps);
  assert.deepEqual(
    first.map((row) => row.roomId),
    [GOOD_ID, 'chess-room'],
  );
  assert.deepEqual(loads, [[GOOD_ID, LEGACY_ID]], 'one batched load for the unverified rows');

  const second = await filterReplayableGames(pool, deps);
  assert.deepEqual(
    second.map((row) => row.roomId),
    [GOOD_ID, 'chess-room'],
  );
  assert.equal(loads.length, 1, 'both verdicts are cached; nothing is reloaded');
});

test("a person's list keeps a game it cannot open and says why", async () => {
  const eventsByRoom = new Map<string, readonly unknown[]>([
    [GOOD_ID, goodEvents()],
    [LEGACY_ID, legacyEvents()],
  ]);
  const loads: string[][] = [];
  const deps: ReplayableGameDeps = {
    registrationForRoomId: (roomId) =>
      roomId.startsWith('chx_') || roomId.startsWith('mj_')
        ? { replays: tenantReplayCheck(crazyhouseXiangqiTenant) }
        : null,
    loadRoomsEvents: async (roomIds) => {
      loads.push([...roomIds]);
      return new Map(
        roomIds.flatMap((id) => (eventsByRoom.has(id) ? [[id, eventsByRoom.get(id)!]] : [])),
      );
    },
    // Mahjong has no game page; everything else here does.
    gamePageUrl: (roomId, variant) => (variant === 'mahjong' ? null : `/x/${roomId}`),
  };
  const history = [
    record(GOOD_ID),
    record(LEGACY_ID),
    { ...record('mj_table'), variant: 'mahjong' },
    { ...record('chess-room'), variant: 'dark-chess' },
  ];

  const marked = await markUnavailableGames(history, deps);
  assert.deepEqual(
    marked.map((row) => [row.roomId, row.unavailable ?? null]),
    [
      [GOOD_ID, null],
      [LEGACY_ID, 'old-rules'],
      ['mj_table', 'unsupported-variant'],
      ['chess-room', null],
    ],
    'every row stays, in order; only the ones that cannot open are marked',
  );
  assert.ok(!('unavailable' in marked[0]!), 'an openable row carries no key at all');
  assert.deepEqual(
    loads,
    [[GOOD_ID, LEGACY_ID]],
    'a variant with no game page is not replayed to find out',
  );

  // The discovery filter agrees on the old-rules game and still drops it.
  assert.deepEqual(
    (await filterReplayableGames(history, deps)).map((row) => row.roomId),
    [GOOD_ID, 'mj_table', 'chess-room'],
  );
});

test('the live game-page check reads the tenant registry', async () => {
  // Side-effect import, as index.ts does: every tenant registers itself.
  await import('./variant-tenant/register-tenants.js');
  const noLoads: ReplayableGameDeps = {
    registrationForRoomId: () => null,
    loadRoomsEvents: async () => new Map(),
  };
  const marked = await markUnavailableGames(
    [
      { ...record('chx_live'), variant: CRAZYHOUSE_XIANGQI_SPEC_ID },
      { ...record('mj_841ccc75'), variant: 'mahjong' },
      { ...record('dchx_corr'), variant: 'dark-chess' },
      { ...record('3745d020'), variant: 'dark-chess' },
      { ...record('mxq_gone'), variant: 'mini-xiangqi' },
    ],
    noLoads,
  );
  assert.deepEqual(
    marked.map((row) => [row.roomId, row.unavailable ?? null]),
    [
      ['chx_live', null],
      ['mj_841ccc75', 'unsupported-variant'],
      ['dchx_corr', null],
      ['3745d020', null],
      ['mxq_gone', 'unsupported-variant'],
    ],
  );
});

test('a failed event load lists the games as before rather than hiding them', async () => {
  const pool = [record(GOOD_ID), record(LEGACY_ID)];
  const kept = await filterReplayableGames(pool, {
    registrationForRoomId: () => ({ replays: tenantReplayCheck(crazyhouseXiangqiTenant) }),
    loadRoomsEvents: async () => {
      throw new Error('db down');
    },
  });
  assert.deepEqual(
    kept.map((row) => row.roomId),
    [GOOD_ID, LEGACY_ID],
  );
});

test('hydrating a room whose log no longer replays fails soft', () => {
  const hydrated = createTenantRuntimeRoomFromEvents(crazyhouseXiangqiTenant, legacyEvents());
  assert.deepEqual(hydrated, { ok: false, error: 'unreplayable_event_log' });
  const good = createTenantRuntimeRoomFromEvents(crazyhouseXiangqiTenant, goodEvents());
  assert.equal(good.ok, true);
});
