import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, test } from 'node:test';
import {
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
} from '@mistboard/game';
import {
  CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH,
  CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID,
  crazyhouseXiangqiAnalysisPositionCommand,
  withCrazyhouseXiangqiAnalysisSession,
} from '../crazyhouse-xiangqi-fsf-engine.js';
import type { CrazyhouseXiangqiEvent } from '../crazyhouse-xiangqi-tenant.js';
import { type SweepPlyEval, VacuousAnalysisError } from '../game-analysis-sweep.js';
import { logger } from '../obs.js';
import type { RecentEveGameRecord } from '../persistence.js';
import { fairyStockfishPath } from '../uci-engine-harness.js';
import { resetTenantReplayGuardForTests } from '../variant-tenant/replay-guard.js';
import {
  analyzeCrazyhouseXiangqiPostgame,
  type CrazyhouseXiangqiAnalysisCache,
  type CrazyhouseXiangqiPostgamePersistence,
  crazyhouseXiangqiAnalysisInputs,
  createCrazyhouseXiangqiAnalysisRoutes,
  resolveCrazyhouseXiangqiAnalysis,
} from './crazyhouse-xiangqi-games.js';

// Server whole-game analysis for Crazyhouse Xiangqi, mirroring the fortress and
// atomic route tests: an in-memory cache double and an analyze spy exercise the
// resolver without Postgres or a real engine; one test drives the real stock
// Fairy-Stockfish when it is on the box.

const ROOM_ID = 'chx_analysis';
const LEGACY_ID = 'chx_analysis_legacy';

// Cxh10 Rxh10 (a capture each way), then Red drops the captured horse on e5.
const LINE: CrazyhouseXiangqiMove[] = [
  { from: 'h3', to: 'h10' },
  { from: 'i10', to: 'h10' },
  { drop: 'horse', to: 'e5' },
];

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
      // A move from the retired rules: stored as played, illegal today.
      state = { ...state, status: { type: 'playing', turn: color === 'red' ? 'black' : 'red' } };
    }
  }
  events.push({ type: 'seat-resigned', at, roomId, color: 'black' });
  return events;
}

function record(roomId: string): RecentEveGameRecord {
  return {
    roomId,
    variant: CRAZYHOUSE_XIANGQI_SPEC_ID,
    mode: 'pve',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: LINE.length,
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

function deps(
  roomId: string,
  events: CrazyhouseXiangqiEvent[] | null,
): CrazyhouseXiangqiPostgamePersistence {
  return {
    getGameSummary: async () => record(roomId),
    loadRoomEvents: async () => events,
  };
}

function memoryCache(): CrazyhouseXiangqiAnalysisCache & { saved: number } {
  const store = new Map<string, SweepPlyEval[]>();
  const cache = {
    saved: 0,
    get: async (roomId: string, engineId: string, depth: number) =>
      store.get(`${roomId}:${engineId}:${depth}`) ?? null,
    save: async (roomId: string, engineId: string, depth: number, plies: SweepPlyEval[]) => {
      cache.saved += 1;
      store.set(`${roomId}:${engineId}:${depth}`, plies);
    },
  };
  return cache;
}

const flat = async (moves: string[]): Promise<SweepPlyEval[]> =>
  [0, ...moves.map((_, i) => i + 1)].map((ply) => ({ ply, cp: 0, mate: null, best: null }));

const oneMovePayload: { timeline: { type: string; move?: CrazyhouseXiangqiMove }[] } = {
  timeline: [{ type: 'move-played', move: { from: 'h3', to: 'h10' } }],
};

function captureResponse(): ServerResponse & { body: string; status: number | null } {
  const capture = {
    body: '',
    status: null as number | null,
    headersSent: false,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & { body: string; status: number | null };
}

function request(method: string): IncomingMessage {
  return {
    method,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

beforeEach(() => resetTenantReplayGuardForTests());

test('analyzeCrazyhouseXiangqiPostgame sends board moves and drops as FSF UCI', async () => {
  let seen: string[] = [];
  const result = await analyzeCrazyhouseXiangqiPostgame(
    {
      timeline: [
        { type: 'move-played', move: { from: 'h3', to: 'h10' } },
        { type: 'move-played', move: { from: 'i10', to: 'h10' } },
        { type: 'seat-resigned' }, // a terminal, skipped
        { type: 'move-played', move: { drop: 'horse', to: 'e5' } },
        { type: 'move-played', move: { drop: 'advisor', to: 'd10' } },
      ],
    },
    async (moves) => {
      seen = moves;
      return flat(moves);
    },
  );
  // The hands are implied by the move list: no FEN, the drop letters are FSF's.
  assert.deepEqual(seen, ['h3h10', 'i10h10', 'N@e5', 'A@d10']);
  assert.equal(result.plies.length, 5);
  assert.equal(result.engineId, CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID);
  assert.equal(result.depth, CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH);
});

test('the analysis position command replays the drop from the start position', () => {
  assert.equal(crazyhouseXiangqiAnalysisPositionCommand([]), 'position startpos');
  assert.equal(
    crazyhouseXiangqiAnalysisPositionCommand(['h3h10', 'i10h10', 'N@e5']),
    'position startpos moves h3h10 i10h10 N@e5',
  );
});

test('resolveCrazyhouseXiangqiAnalysis serves a cache hit without touching the engine', async () => {
  const cache = memoryCache();
  const seeded = await resolveCrazyhouseXiangqiAnalysis('room-hit', oneMovePayload, cache, flat);
  let analyzed = false;
  const result = await resolveCrazyhouseXiangqiAnalysis(
    'room-hit',
    oneMovePayload,
    cache,
    async (moves) => {
      analyzed = true;
      return flat(moves);
    },
  );
  assert.equal(analyzed, false, 'cache hit must not run the engine');
  assert.ok(seeded && result);
  assert.deepEqual(result.plies, seeded.plies);
});

test('resolveCrazyhouseXiangqiAnalysis computes and persists once on a miss', async () => {
  const cache = memoryCache();
  const result = await resolveCrazyhouseXiangqiAnalysis('room-miss', oneMovePayload, cache, flat);
  assert.ok(result);
  assert.equal(cache.saved, 1);
  await resolveCrazyhouseXiangqiAnalysis('room-miss', oneMovePayload, cache, flat);
  assert.equal(cache.saved, 1, 'the second call is a cache hit');
  const readOnly = await resolveCrazyhouseXiangqiAnalysis(
    'room-other',
    oneMovePayload,
    cache,
    flat,
    false,
  );
  assert.equal(readOnly, null, 'a cache-only read never computes');
});

test('resolveCrazyhouseXiangqiAnalysis never caches a scoreless sweep', async () => {
  const cache = memoryCache();
  const vacuous = async (moves: string[]): Promise<SweepPlyEval[]> =>
    moves.map((_, i) => ({ ply: i + 1, cp: null, mate: null, best: null }));
  await assert.rejects(
    resolveCrazyhouseXiangqiAnalysis('room-vacuous', oneMovePayload, cache, vacuous),
    VacuousAnalysisError,
  );
  assert.equal(cache.saved, 0);
});

test('analysis inputs: a finished game loads, a game under retired rules is missing (no throw)', async () => {
  const good = await crazyhouseXiangqiAnalysisInputs(
    ROOM_ID,
    deps(ROOM_ID, finishedEvents(ROOM_ID, LINE)),
  );
  assert.ok(good);
  assert.equal(good.timeline.filter((entry) => entry.type === 'move-played').length, 3);

  const warn = logger.warn;
  logger.warn = (() => {}) as typeof logger.warn;
  try {
    // Under the old rules the elephant started on c1; today c1 is empty.
    const legacy = finishedEvents(LEGACY_ID, [
      { from: 'c1', to: 'e3' },
      { from: 'h8', to: 'h1' },
    ]);
    assert.equal(await crazyhouseXiangqiAnalysisInputs(LEGACY_ID, deps(LEGACY_ID, legacy)), null);
  } finally {
    logger.warn = warn;
  }
});

test('the analysis route answers a retired-rules game 404 and a fresh game 204, then 200 from cache', async () => {
  const prevFlag = process.env.MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED;
  process.env.MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED = 'true';
  const warn = logger.warn;
  logger.warn = (() => {}) as typeof logger.warn;
  try {
    const legacyEvents = finishedEvents(LEGACY_ID, [
      { from: 'c1', to: 'e3' },
      { from: 'h8', to: 'h1' },
    ]);
    const goodEvents = finishedEvents(ROOM_ID, LINE);
    const cache = memoryCache();
    const handler = createCrazyhouseXiangqiAnalysisRoutes({
      persistence: {
        getGameSummary: async (roomId) => record(roomId),
        loadRoomEvents: async (roomId) => (roomId === LEGACY_ID ? legacyEvents : goodEvents),
      },
      cache,
      analyze: flat,
      route: { currentUser: async () => null },
    });

    const legacy = captureResponse();
    assert.equal(
      await handler(request('GET'), legacy, `/api/crazyhouse-xiangqi/games/${LEGACY_ID}/analysis`),
      true,
    );
    assert.equal(legacy.status, 404);

    const miss = captureResponse();
    await handler(request('GET'), miss, `/api/crazyhouse-xiangqi/games/${ROOM_ID}/analysis`);
    assert.equal(miss.status, 204, 'GET never computes');

    await resolveCrazyhouseXiangqiAnalysis(ROOM_ID, { timeline: [] }, cache, flat);
    const hit = captureResponse();
    await handler(request('GET'), hit, `/api/crazyhouse-xiangqi/games/${ROOM_ID}/analysis`);
    assert.equal(hit.status, 200);
    const body = JSON.parse(hit.body) as { engineId: string; depth: number };
    assert.equal(body.engineId, CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID);
    assert.equal(body.depth, CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH);

    const anon = captureResponse();
    await handler(request('POST'), anon, `/api/crazyhouse-xiangqi/games/${ROOM_ID}/analysis`);
    assert.equal(anon.status, 401, 'computing is account-gated');
  } finally {
    logger.warn = warn;
    if (prevFlag === undefined) delete process.env.MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED;
    else process.env.MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED = prevFlag;
  }
});

function stockFsfPresent(): boolean {
  try {
    return existsSync(fairyStockfishPath());
  } catch {
    return false;
  }
}

test('the real stock Fairy-Stockfish scores a position with pieces in hand after a drop', async (t) => {
  if (!stockFsfPresent()) {
    t.skip('stock Fairy-Stockfish not on this box');
    return;
  }
  const evals = await withCrazyhouseXiangqiAnalysisSession(
    async (evaluate) => [
      await evaluate([]),
      await evaluate(['h3h10', 'i10h10']),
      await evaluate(['h3h10', 'i10h10', 'N@e5']),
    ],
    { depth: 6 },
  );
  for (const evaluation of evals) {
    assert.ok(evaluation.cp !== null || evaluation.mate !== null, 'every position is scored');
    assert.ok(evaluation.best, 'and has a best move');
  }
  // After the drop it is Black to move: Black's best move is a legal board
  // move or a drop from Black's pocket (advisors, elephants, the cannon).
  assert.match(evals[2]?.best ?? '', /^([a-i]\d{1,2}[a-i]\d{1,2}|[ABCaebc]@[a-i]\d{1,2})$/i);
});
