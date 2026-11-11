import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  ATOMIC_XIANGQI_SPEC_ID,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  type AtomicXiangqiPlayerView,
  applyAtomicXiangqiMove,
  createInitialAtomicXiangqiState,
  getAtomicXiangqiPlayerView,
} from '@mistboard/game';
import { atomicXiangqiRooms } from '../atomic-xiangqi-registration.js';
import { type AtomicXiangqiEvent, atomicXiangqiTenant } from '../atomic-xiangqi-tenant.js';
import { collectCurrentGames, currentGameBoardPayload } from '../current-games.js';
import type { RecentEveGameRecord } from '../persistence.js';
import {
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
} from '../variant-tenant/runtime.js';
import { hasLiveWatchPayloadBuilder } from '../watch-live.js';
import {
  type AtomicXiangqiPostgamePersistence,
  atomicXiangqiLiveWatchPayloadFor,
  atomicXiangqiPostgameForApi,
  resolveAtomicXiangqiAnalysis,
  tryHandle,
} from './atomic-xiangqi-games.js';
import type { HttpApiContext } from './lib.js';

const ROOM_ID = 'axq_postgame';

// A scripted line with one capture in it:
//   1. Che3 (b3e3)   a6 (a7a6)
//   2. Cxe7 (e3e7)   the cannon takes the black soldier on e7 over Red's own e4
// A cannon's capture takes only its target (D13), so the aftermath is one point.
// Then Red resigns, so the game is finished without anyone being blown up.
const LINE: AtomicXiangqiMove[] = [
  { from: 'b3', to: 'e3' },
  { from: 'a7', to: 'a6' },
  { from: 'e3', to: 'e7' },
];

function finishedGameEvents(): AtomicXiangqiEvent[] {
  const events: AtomicXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: ROOM_ID, gameSpecId: ATOMIC_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
  ];
  let state: AtomicXiangqiGameState = createInitialAtomicXiangqiState(ROOM_ID);
  let at = 4;
  for (const move of LINE) {
    if (state.status.type !== 'playing') break;
    const color = state.status.turn;
    events.push({ type: 'move-played', at: at++, roomId: ROOM_ID, color, move });
    state = applyAtomicXiangqiMove(state, move);
  }
  events.push({ type: 'seat-resigned', at, roomId: ROOM_ID, color: 'red' });
  return events;
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: ATOMIC_XIANGQI_SPEC_ID,
    mode: 'pvp',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: LINE.length,
    startedAt: new Date(1),
    endedAt: new Date(100),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'private',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
    ...overrides,
  };
}

function deps(
  record: RecentEveGameRecord | null,
  events: AtomicXiangqiEvent[] | null,
): AtomicXiangqiPostgamePersistence {
  return {
    getGameSummary: async () => record,
    loadRoomEvents: async () => events,
  };
}

function historicalRoom(events: AtomicXiangqiEvent[]) {
  const hydrated = createTenantRuntimeRoomFromEvents(atomicXiangqiTenant, events);
  assert.ok(hydrated.ok);
  return hydrated.room;
}

test('Atomic Xiangqi postgame returns the finished-game envelope with a truth view', async () => {
  const payload = await atomicXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedGameEvents()),
  );
  assert.ok(payload);
  assert.equal(payload.game.roomId, ROOM_ID);
  assert.equal(payload.game.variant, ATOMIC_XIANGQI_SPEC_ID);
  assert.equal(payload.game.result, 'black-wins');
  assert.deepEqual(payload.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
  assert.equal(
    payload.timeline.filter((entry) => entry.type === 'move-played').length,
    LINE.length,
  );
  // Open information: one view, from Red's perspective, and it IS `views.truth`.
  assert.equal(payload.view.perspective, 'red');
  assert.deepEqual(payload.views.truth, payload.view);
  const resign = payload.timeline.find((entry) => entry.type === 'seat-resigned');
  assert.ok(resign);
  assert.equal(resign.winner, 'black');
});

test('retired atomic finished payloads and cached analysis survive without native search', async () => {
  const engineId = 'fairy-stockfish-atomic-xiangqi-level-4';
  const events = finishedGameEvents().map((event) =>
    event.type === 'seat-assigned' && event.seat === 'black'
      ? { ...event, clientId: engineId }
      : event,
  );
  const payload = await atomicXiangqiPostgameForApi(ROOM_ID, {
    ...deps(null, null),
    isPersistenceEnabled: () => false,
    getLiveRoom: () => historicalRoom(events),
  });
  assert.ok(payload);
  const serialized = JSON.parse(JSON.stringify(payload)) as typeof payload;
  assert.equal(serialized.game.mode, 'pve');
  assert.equal(serialized.game.pveEngineId, engineId);
  assert.equal(serialized.game.blackName, 'Fairy-Stockfish Level 4');
  assert.equal(serialized.state.status.type, 'finished');
  assert.equal(serialized.history.truth.length, LINE.length + 1);
  assert.deepEqual(serialized.view, serialized.views.truth);
  assert.deepEqual(serialized.history.truth.at(-1)?.view.lastBlast, serialized.view.lastBlast);
  assert.deepEqual(
    serialized.timeline.filter((entry) => entry.type === 'move-played').map((entry) => entry.move),
    LINE,
  );

  const plies = [{ ply: 0, cp: 42, mate: null, best: 'b3e3', depth: 12 }];
  const cache = {
    get: async (roomId: string, cachedEngineId: string, depth: number) => {
      assert.equal(roomId, ROOM_ID);
      assert.equal(cachedEngineId, 'fairy-stockfish-atomic-xiangqi-analysis@0.1.0');
      assert.equal(depth, 12);
      return plies;
    },
    save: async () => assert.fail('retired analysis must never write a new sweep'),
  };
  assert.deepEqual(await resolveAtomicXiangqiAnalysis(ROOM_ID, payload, cache), {
    engineId: 'fairy-stockfish-atomic-xiangqi-analysis@0.1.0',
    depth: 12,
    plies,
  });
  const previous = process.env.MISTBOARD_FSF_ATOMIC_XIANGQI_PATH;
  process.env.MISTBOARD_FSF_ATOMIC_XIANGQI_PATH = '/nonexistent/retired-atomic-engine';
  try {
    assert.equal(
      await resolveAtomicXiangqiAnalysis(ROOM_ID, payload, { ...cache, get: async () => null }),
      null,
      'a cache miss must not start native analysis for a retired variant',
    );
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_FSF_ATOMIC_XIANGQI_PATH;
    else process.env.MISTBOARD_FSF_ATOMIC_XIANGQI_PATH = previous;
  }
});

test('retired atomic HTTP history works with the launch flag off and analysis never enqueues', async () => {
  const previous = process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
  delete process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
  atomicXiangqiRooms.set(ROOM_ID, historicalRoom(finishedGameEvents()));
  const basePath = `/api/atomic-xiangqi/games/${ROOM_ID}`;
  try {
    for (const [method, path, expectedStatus] of [
      ['GET', basePath, 200],
      ['GET', `${basePath}/analysis`, 204],
      ['POST', `${basePath}/analysis`, 410],
      ['DELETE', `${basePath}/analysis`, 405],
      ['GET', '/api/atomic-xiangqi/games/axq_missing/analysis', 404],
    ] as const) {
      let status = 0;
      let body = '';
      const response = {
        writeHead(code: number) {
          status = code;
          return this;
        },
        end(value = '') {
          body = value;
        },
      } as unknown as ServerResponse;
      assert.equal(
        await tryHandle(
          {} as HttpApiContext,
          { method } as IncomingMessage,
          response,
          path,
          new URL(path, 'http://localhost'),
        ),
        true,
      );
      assert.equal(status, expectedStatus, `${method} ${path}`);
      if (status === 410) assert.deepEqual(JSON.parse(body), { error: 'retired_game_spec' });
      if (status === 200) assert.equal(JSON.parse(body).state.status.type, 'finished');
    }
  } finally {
    atomicXiangqiRooms.delete(ROOM_ID);
    if (previous === undefined) delete process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
    else process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED = previous;
  }
});

test('Atomic Xiangqi postgame history snapshots every ply with its aftermath', async () => {
  const payload = await atomicXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedGameEvents()),
  );
  assert.ok(payload);
  const truth = payload.history.truth;
  assert.deepEqual(
    truth.map((snapshot) => snapshot.ply),
    Array.from({ length: LINE.length + 1 }, (_, i) => i),
  );
  // Quiet plies carry an empty aftermath; the cannon shot carries its target
  // and nothing else (D13), and the cannon itself is gone from the board.
  assert.deepEqual(truth[1]?.view.lastBlast, []);
  assert.deepEqual(truth[2]?.view.lastBlast, []);
  assert.deepEqual(
    truth[3]?.view.lastBlast.map((victim) => `${victim.square}:${victim.piece.role}`),
    ['e7:soldier'],
  );
  assert.equal(truth[3]?.view.board.e7, undefined);
  assert.equal(truth[3]?.view.board.e3, undefined);
  assert.equal(truth[3]?.view.board.e4?.role, 'soldier', 'the screen survives a cannon shot');
});

test('Atomic Xiangqi postgame returns null for an unfinished game', async () => {
  const events = finishedGameEvents().slice(0, -1);
  assert.equal(await atomicXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), events)), null);
});

test('Atomic Xiangqi postgame rejects a record from another variant', async () => {
  const payload = await atomicXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord({ variant: 'xiangqi' }), finishedGameEvents()),
  );
  assert.equal(payload, null);
});

test('Atomic Xiangqi postgame returns null when there is no game or event log', async () => {
  assert.equal(await atomicXiangqiPostgameForApi(ROOM_ID, deps(null, finishedGameEvents())), null);
  assert.equal(await atomicXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), null)), null);
});

test('Atomic Xiangqi postgame rejects an event log belonging to another room', async () => {
  const foreign = finishedGameEvents().map((event) => ({ ...event, roomId: 'axq_other' }));
  assert.equal(
    await atomicXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), foreign as AtomicXiangqiEvent[])),
    null,
  );
});

test('Atomic Xiangqi postgame does not require the launch env flag', async () => {
  const previous = process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
  delete process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
  try {
    const payload = await atomicXiangqiPostgameForApi(
      ROOM_ID,
      deps(gameRecord(), finishedGameEvents()),
    );
    assert.ok(payload);
    assert.equal(payload.game.variant, ATOMIC_XIANGQI_SPEC_ID);
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
    else process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED = previous;
  }
});

// ---------------------------------------------------------------------------
// Live board (/games, Watch live, the correspondence inbox). The payload is the
// kernel's own post-explosion position, never a re-simulation.
// ---------------------------------------------------------------------------

const LIVE_ROOM_ID = 'axq_live';
const LIVE_NOW = 1_800_000_000_000;

// The b-file clears, then Red's chariot takes the horse on b10. A chariot
// capture blows up the target, the capturer and the orthogonal neighbours: the
// black chariot on a10 and the elephant on c10 go with the horse.
const EXPLOSION_LINE: AtomicXiangqiMove[] = [
  { from: 'b3', to: 'e3' },
  { from: 'b8', to: 'e8' },
  { from: 'a1', to: 'a3' },
  { from: 'a7', to: 'a6' },
  { from: 'a3', to: 'b3' },
  { from: 'i7', to: 'i6' },
  { from: 'b3', to: 'b10' },
];

function liveGameEvents(): { events: AtomicXiangqiEvent[]; state: AtomicXiangqiGameState } {
  let at = LIVE_NOW - 60_000;
  const events: AtomicXiangqiEvent[] = [
    {
      type: 'room-created',
      at: at++,
      roomId: LIVE_ROOM_ID,
      gameSpecId: ATOMIC_XIANGQI_SPEC_ID,
    },
    { type: 'seat-assigned', at: at++, roomId: LIVE_ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: at++, roomId: LIVE_ROOM_ID, clientId: 'b', seat: 'black' },
  ];
  let state: AtomicXiangqiGameState = createInitialAtomicXiangqiState(LIVE_ROOM_ID);
  for (const move of EXPLOSION_LINE) {
    assert.equal(state.status.type, 'playing');
    if (state.status.type !== 'playing') break;
    events.push({
      type: 'move-played',
      at: at++,
      roomId: LIVE_ROOM_ID,
      color: state.status.turn,
      move,
    });
    state = applyAtomicXiangqiMove(state, move);
  }
  return { events, state };
}

function liveRoom(events: AtomicXiangqiEvent[]) {
  return {
    id: LIVE_ROOM_ID,
    events,
    projection: replayTenantEvents(atomicXiangqiTenant, events),
    clients: [],
    seatTokens: {},
    pendingWrites: Promise.resolve(),
  };
}

type LivePayload = {
  game: { result: string; endedAt: string | null; plyCount: number; variant: string };
  view: AtomicXiangqiPlayerView;
  views: { truth: AtomicXiangqiPlayerView };
  history: { truth: Array<{ ply: number; view: AtomicXiangqiPlayerView }> };
};

test('Atomic Xiangqi live payload draws the post-explosion position the kernel holds', () => {
  const { events, state } = liveGameEvents();
  assert.equal(state.status.type, 'playing', 'the line leaves the game in progress');
  const payload = atomicXiangqiLiveWatchPayloadFor(
    LIVE_ROOM_ID,
    liveRoom(events),
  ) as LivePayload | null;
  assert.ok(payload);
  assert.equal(payload.game.result, 'in-progress');
  assert.equal(payload.game.endedAt, null);
  assert.equal(payload.game.variant, ATOMIC_XIANGQI_SPEC_ID);
  assert.equal(payload.game.plyCount, EXPLOSION_LINE.length);

  // The board is the kernel's own state, explosion applied.
  assert.deepEqual(payload.view, getAtomicXiangqiPlayerView(state, 'red'));
  assert.deepEqual(payload.views.truth, payload.view);
  assert.equal(payload.view.board.b10, undefined, 'the target and the capturer are gone');
  assert.equal(payload.view.board.a10, undefined, 'the neighbouring chariot is gone');
  assert.equal(payload.view.board.c10, undefined, 'the neighbouring elephant is gone');
  assert.equal(payload.view.board.b3, undefined, 'the capturer left its square');
  assert.deepEqual(payload.view.lastBlast.map((victim) => victim.square).sort(), [
    'a10',
    'b10',
    'c10',
  ]);

  // Every ply up to now, the last one carrying the same aftermath.
  assert.equal(payload.history.truth.length, EXPLOSION_LINE.length + 1);
  assert.deepEqual(payload.history.truth.at(-1)?.view, payload.view);
});

test('Atomic Xiangqi live payload is withheld for a finished game or another room', () => {
  const { events } = liveGameEvents();
  const resigned: AtomicXiangqiEvent[] = [
    ...events,
    { type: 'seat-resigned', at: LIVE_NOW, roomId: LIVE_ROOM_ID, color: 'black' },
  ];
  assert.equal(atomicXiangqiLiveWatchPayloadFor(LIVE_ROOM_ID, liveRoom(resigned)), null);
  assert.equal(atomicXiangqiLiveWatchPayloadFor('axq_other', liveRoom(events)), null);
});

test('an in-progress Atomic Xiangqi game on /games carries its live board', async () => {
  const previous = process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
  process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED = 'true';
  const { events, state } = liveGameEvents();
  atomicXiangqiRooms.set(LIVE_ROOM_ID, liveRoom(events) as never);
  try {
    assert.equal(hasLiveWatchPayloadBuilder('atomic-xiangqi'), true);
    const listed = collectCurrentGames({ rooms: new Map() } as unknown as HttpApiContext, LIVE_NOW);
    const game = listed.find((entry) => entry.roomId === LIVE_ROOM_ID);
    assert.ok(game, 'the live room is listed');
    assert.equal(game.observe, 'open');
    assert.equal(game.channelId, 'atomic-xiangqi');
    const payload = (await currentGameBoardPayload(game)) as LivePayload | null;
    assert.ok(payload, 'the card gets a board, not the variant icon');
    assert.deepEqual(payload.view, getAtomicXiangqiPlayerView(state, 'red'));
  } finally {
    atomicXiangqiRooms.delete(LIVE_ROOM_ID);
    if (previous === undefined) delete process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED;
    else process.env.MISTBOARD_ATOMIC_XIANGQI_ENABLED = previous;
  }
});
