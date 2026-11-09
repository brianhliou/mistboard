// GET /api/three-kingdoms-banqi/games/:roomId (#628, admin playtest #684).
//
// Banqi's finished-game policy: the payload exists only for a log that replays
// to 'finished', and its masked track ('history.truth') carries no identity for
// a tile still face down at that ply. The planted failures: a live and an
// aborted game must 404 like an unknown one, a non-admin must get that same 404
// before any lookup, and the masked track must stay byte-identical when two
// never-flipped tiles swap places while the revealed track changes (so the swap
// is real and a masked track that carried the deal would be caught).
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  applyThreeKingdomsBanqiMove,
  BANQI_SPEC_ID,
  type BanqiDeal,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiLegalMoves,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  type ThreeKingdomsBanqiMove,
} from '@mistboard/game';
import { getAnalysisJob, resetAnalysisJobsForTests } from '../game-analysis-jobs.js';
import type { RecentEveGameRecord } from '../persistence.js';
import {
  THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH,
  THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID,
  type ThreeKingdomsBanqiGameAnalysis,
} from '../three-kingdoms-banqi-analysis.js';
import type { ThreeKingdomsBanqiDecision } from '../three-kingdoms-banqi-decisions.js';
import type { ThreeKingdomsBanqiEvent } from '../three-kingdoms-banqi-tenant.js';
import type { HttpApiContext } from './lib.js';
import {
  createThreeKingdomsBanqiAnalysisRoutes,
  handleThreeKingdomsBanqiPostgame,
  type ThreeKingdomsBanqiPostgameRouteDeps,
  threeKingdomsBanqiPostgameForApi,
  tryHandle,
} from './three-kingdoms-banqi-games.js';

const ROOM_ID = 'tkb_review';
const PATH = `/api/three-kingdoms-banqi/games/${ROOM_ID}`;
const PLIES = 6;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const DEAL: BanqiDeal = createThreeKingdomsBanqiSetup(seeded(7)).deal;

/** The first legal move at each ply, preferring a flip (from === to). */
function line(deal: BanqiDeal, plies: number): ThreeKingdomsBanqiMove[] {
  let state = createThreeKingdomsBanqiStateFromSetup(ROOM_ID, { deal });
  const moves: ThreeKingdomsBanqiMove[] = [];
  for (let ply = 0; ply < plies && state.status.type === 'playing'; ply += 1) {
    const legal = getThreeKingdomsBanqiLegalMoves(state);
    const move = legal.find((m) => m.from === m.to) ?? legal[0];
    assert.ok(move, `no legal move at ply ${ply}`);
    moves.push(move);
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  return moves;
}

const MOVES = line(DEAL, PLIES);

function liveEvents(deal: BanqiDeal = DEAL): ThreeKingdomsBanqiEvent[] {
  let state = createThreeKingdomsBanqiStateFromSetup(ROOM_ID, { deal });
  const events: ThreeKingdomsBanqiEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM_ID,
      gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
      setup: { deal },
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
  ];
  for (const [index, move] of MOVES.entries()) {
    const color = index % 2 === 0 ? 'red' : 'black';
    events.push({ type: 'move-played', at: 10 + index, roomId: ROOM_ID, color, move });
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  assert.equal(state.status.type, 'playing');
  return events;
}

function finishedEvents(deal: BanqiDeal = DEAL): ThreeKingdomsBanqiEvent[] {
  return [...liveEvents(deal), { type: 'seat-resigned', at: 100, roomId: ROOM_ID, color: 'black' }];
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: THREE_KINGDOMS_BANQI_SPEC_ID,
    mode: 'pvp',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: MOVES.length,
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
    ...overrides,
  };
}

type Calls = { lookups: number };

function deps(
  record: RecentEveGameRecord | null,
  events: ThreeKingdomsBanqiEvent[] | null,
  options: { admits?: boolean; persistenceReady?: boolean } = {},
  calls: Calls = { lookups: 0 },
): ThreeKingdomsBanqiPostgameRouteDeps {
  return {
    getGameSummary: async () => {
      calls.lookups += 1;
      return record;
    },
    loadRoomEvents: async () => {
      calls.lookups += 1;
      return events;
    },
    persistenceReady: () => options.persistenceReady ?? true,
    admits: async () => options.admits ?? true,
  };
}

type Captured = { status: number | null; body: unknown };

function fakeResponse(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = { status: null, body: null };
  const response = {
    writeHead(status: number) {
      captured.status = status;
      return response;
    },
    end(body?: string) {
      captured.body = body ? JSON.parse(body) : null;
    },
  } as unknown as ServerResponse;
  return { response, captured };
}

const GET = { method: 'GET', headers: {} } as IncomingMessage;

/** Two setup squares no move in MOVES touches: face down at every ply. */
function neverFlippedPair(): [number, number] {
  const touched = new Set(MOVES.flatMap((move) => [move.from, move.to]));
  const indices: number[] = [];
  for (const [index, square] of THREE_KINGDOMS_BANQI_SETUP_SQUARES.entries()) {
    if (touched.has(square)) continue;
    const a = DEAL[index]!;
    const b = indices.length ? DEAL[indices[0]!]! : null;
    if (b && a.color === b.color && a.role === b.role) continue;
    indices.push(index);
    if (indices.length === 2) return [indices[0]!, indices[1]!];
  }
  throw new Error('no swappable pair of never-flipped tiles');
}

test('a finished game replays every ply with covered identities masked', async () => {
  const payload = await threeKingdomsBanqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedEvents()),
  );
  assert.ok(payload);
  assert.equal(payload.game.variant, THREE_KINGDOMS_BANQI_SPEC_ID);
  assert.equal(payload.state.status.type, 'finished');
  assert.equal(payload.history.truth.length, MOVES.length + 1);
  assert.equal(payload.history.revealed.length, MOVES.length + 1);
  assert.deepEqual(
    payload.history.truth.map((snapshot) => snapshot.ply),
    Array.from({ length: MOVES.length + 1 }, (_, ply) => ply),
  );
  const timelineMoves = payload.timeline.filter((entry) => entry.type === 'move-played');
  assert.equal(timelineMoves.length, MOVES.length);
  assert.deepEqual(payload.timeline.at(-1), {
    type: 'seat-resigned',
    at: 100,
    color: 'black',
    winner: 'red',
  });
  const start = payload.history.truth[0]!.view.board;
  for (const square of THREE_KINGDOMS_BANQI_SETUP_SQUARES) {
    assert.deepEqual(start[square], { faceDown: true }, `masked ${square}`);
  }
  assert.deepEqual(payload.history.revealed, payload.history.truth);
  assert.ok(Object.values(payload.view.board).some((entry) => entry?.faceDown));
  // The stored setup never goes out as such.
  const json = JSON.stringify(payload);
  assert.equal(json.includes('"setup"'), false);
  assert.equal(json.includes('"deal"'), false);
});

test('the masked track carries no identity for a tile still face down', async () => {
  const [i, j] = neverFlippedPair();
  const swapped = [...DEAL];
  [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
  const a = await threeKingdomsBanqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedEvents()));
  const b = await threeKingdomsBanqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedEvents(swapped)),
  );
  assert.ok(a && b);
  assert.equal(JSON.stringify(a.history.truth), JSON.stringify(b.history.truth));
  assert.notDeepEqual(DEAL, swapped, 'the hidden swap is real');
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'the entire review payload stays masked');
});

test('a live game is not found', async () => {
  assert.equal(
    await threeKingdomsBanqiPostgameForApi(ROOM_ID, deps(gameRecord(), liveEvents())),
    null,
  );
});

test('an aborted game is not found', async () => {
  const events: ThreeKingdomsBanqiEvent[] = [
    ...liveEvents().slice(0, 3),
    { type: 'game-aborted', at: 5, roomId: ROOM_ID, reason: 'user-abort' },
  ];
  assert.equal(await threeKingdomsBanqiPostgameForApi(ROOM_ID, deps(gameRecord(), events)), null);
});

test('a variant mismatch is not found', async () => {
  assert.equal(
    await threeKingdomsBanqiPostgameForApi(
      ROOM_ID,
      deps(gameRecord({ variant: BANQI_SPEC_ID }), finishedEvents()),
    ),
    null,
  );
  assert.equal(await threeKingdomsBanqiPostgameForApi(ROOM_ID, deps(null, finishedEvents())), null);
  assert.equal(await threeKingdomsBanqiPostgameForApi(ROOM_ID, deps(gameRecord(), null)), null);
});

test('a non-admin gets the unknown-game 404 before any lookup', async () => {
  const calls: Calls = { lookups: 0 };
  const { response, captured } = fakeResponse();
  const handled = await handleThreeKingdomsBanqiPostgame(
    GET,
    response,
    PATH,
    deps(gameRecord(), finishedEvents(), { admits: false }, calls),
  );
  assert.equal(handled, true);
  assert.equal(captured.status, 404);
  assert.deepEqual(captured.body, { error: 'not_found' });
  assert.equal(calls.lookups, 0);

  // Same answer with the database down: a refused caller learns nothing.
  const down = fakeResponse();
  await handleThreeKingdomsBanqiPostgame(
    GET,
    down.response,
    PATH,
    deps(gameRecord(), finishedEvents(), { admits: false, persistenceReady: false }),
  );
  assert.equal(down.captured.status, 404);
});

test('an admitted caller gets the finished game, and a live one 404s', async () => {
  const ok = fakeResponse();
  await handleThreeKingdomsBanqiPostgame(
    GET,
    ok.response,
    PATH,
    deps(gameRecord(), finishedEvents()),
  );
  assert.equal(ok.captured.status, 200);
  assert.equal(
    (ok.captured.body as { history: { truth: unknown[] } }).history.truth.length,
    MOVES.length + 1,
  );

  const live = fakeResponse();
  await handleThreeKingdomsBanqiPostgame(
    GET,
    live.response,
    PATH,
    deps(gameRecord(), liveEvents()),
  );
  assert.equal(live.captured.status, 404);
  assert.deepEqual(live.captured.body, { error: 'not_found' });

  const post = fakeResponse();
  await handleThreeKingdomsBanqiPostgame(
    { method: 'POST', headers: {} } as IncomingMessage,
    post.response,
    PATH,
    deps(gameRecord(), finishedEvents()),
  );
  assert.equal(post.captured.status, 405);

  const other = fakeResponse();
  assert.equal(
    await handleThreeKingdomsBanqiPostgame(
      GET,
      other.response,
      '/api/banqi/games/x',
      deps(gameRecord(), finishedEvents()),
    ),
    false,
  );
});

test('the wired route refuses a guest with the flag off (the prod gate)', async () => {
  const FLAG = 'MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED';
  const before = process.env[FLAG];
  try {
    delete process.env[FLAG];
    const guest = fakeResponse();
    await tryHandle({} as HttpApiContext, GET, guest.response, PATH, new URL(PATH, 'http://x'));
    assert.equal(guest.captured.status, 404);
    assert.deepEqual(guest.captured.body, { error: 'not_found' });
    for (const suffix of ['/analysis', '/analysis/jobs/private-job']) {
      for (const method of ['GET', 'POST']) {
        const denied = fakeResponse();
        assert.equal(
          await tryHandle(
            {} as HttpApiContext,
            { ...GET, method } as IncomingMessage,
            denied.response,
            PATH + suffix,
            new URL(PATH + suffix, 'http://x'),
          ),
          true,
        );
        assert.equal(denied.captured.status, 404);
        assert.deepEqual(denied.captured.body, { error: 'not_found' });
      }
    }

    // With the local flag on the gate admits, and this test has no database.
    process.env[FLAG] = 'true';
    const local = fakeResponse();
    await tryHandle({} as HttpApiContext, GET, local.response, PATH, new URL(PATH, 'http://x'));
    assert.equal(local.captured.status, 503);
  } finally {
    if (before === undefined) delete process.env[FLAG];
    else process.env[FLAG] = before;
  }
});

test('analysis GET, POST and job polls apply the playtest gate before any lookup', async () => {
  const calls = { lookups: 0 };
  let engineChecks = 0;
  const handler = createThreeKingdomsBanqiAnalysisRoutes(
    deps(gameRecord(), finishedEvents(), { admits: false }, calls),
    {
      engineAvailable: () => {
        engineChecks += 1;
        return false;
      },
    },
  );
  for (const suffix of ['/analysis', '/analysis/jobs/sensitive-id']) {
    for (const method of ['GET', 'POST']) {
      const res = fakeResponse();
      assert.equal(
        await handler({ ...GET, method } as IncomingMessage, res.response, PATH + suffix),
        true,
      );
      assert.equal(res.captured.status, 404);
      assert.deepEqual(res.captured.body, { error: 'not_found' });
    }
  }
  assert.equal(calls.lookups, 0);
  assert.equal(engineChecks, 0);
});

const analysis: ThreeKingdomsBanqiGameAnalysis = {
  engineId: THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID,
  depth: THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH,
  plies: Array.from({ length: MOVES.length + 1 }, (_, ply) => ({
    ply,
    cp: 42,
    mate: null,
    best: null,
  })),
};

test('analysis GET misses, POST queues, job fills, and a reload reads the saved analysis', async () => {
  await resetAnalysisJobsForTests();
  let cached: typeof analysis.plies | null = null;
  let computes = 0;
  const handler = createThreeKingdomsBanqiAnalysisRoutes(deps(gameRecord(), finishedEvents()), {
    route: { currentUser: async () => ({ id: 'tk-admin' }) },
    engineAvailable: () => true,
    cache: {
      get: async () => cached,
      save: async (_room, _engine, _depth, plies) => {
        cached = plies;
      },
    },
    analyze: async (events) => {
      computes += 1;
      assert.deepEqual(
        events[0],
        finishedEvents()[0],
        'the room-created deal reaches reconstruction',
      );
      return analysis;
    },
  });
  try {
    const miss = fakeResponse();
    await handler(GET, miss.response, `${PATH}/analysis`);
    assert.equal(miss.captured.status, 204);
    assert.equal(computes, 0);
    const post = fakeResponse();
    await handler(
      { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage,
      post.response,
      `${PATH}/analysis`,
    );
    assert.equal(post.captured.status, 202);
    const jobId = (post.captured.body as { jobId: string }).jobId;
    for (let i = 0; i < 20 && getAnalysisJob(jobId)?.status === 'pending'; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const poll = fakeResponse();
    await handler(GET, poll.response, `${PATH}/analysis/jobs/${jobId}`);
    assert.equal(poll.captured.status, 200);
    assert.deepEqual(poll.captured.body, {
      status: 'done',
      result: { ...analysis, chancePlies: MOVES.map((_, i) => i + 1) },
    });
    const reload = fakeResponse();
    await handler(GET, reload.response, `${PATH}/analysis`);
    assert.equal(reload.captured.status, 200);
    assert.deepEqual(reload.captured.body, (poll.captured.body as { result: unknown }).result);
    assert.equal(computes, 1);
    const wrongGame = fakeResponse();
    await handler(
      GET,
      wrongGame.response,
      `${PATH.replace(ROOM_ID, 'tkb_other')}/analysis/jobs/${jobId}`,
    );
    assert.equal(wrongGame.captured.status, 404);
  } finally {
    await resetAnalysisJobsForTests();
  }
});

test('analysis and decisions reject live, aborted, missing and wrong-variant games', async () => {
  for (const [record, log] of [
    [gameRecord(), liveEvents()],
    [
      gameRecord(),
      [
        ...liveEvents().slice(0, 3),
        { type: 'game-aborted', at: 4, roomId: ROOM_ID, reason: 'user-abort' },
      ],
    ],
    [null, null],
    [gameRecord({ variant: BANQI_SPEC_ID }), finishedEvents()],
  ] as const) {
    const handler = createThreeKingdomsBanqiAnalysisRoutes(deps(record, log ? [...log] : null));
    const res = fakeResponse();
    await handler(GET, res.response, `${PATH}/analysis`);
    assert.equal(res.captured.status, 404);
    const decisions = fakeResponse();
    assert.equal(await handler(GET, decisions.response, `${PATH}/decisions`), true);
    assert.equal(decisions.captured.status, 404);
  }
});

test('decisions answer only to the playtest; GET is cache-only; POST needs an account and follows base analysis', async () => {
  await resetAnalysisJobsForTests();
  let cachedAnalysis: typeof analysis.plies | null = null;
  let cachedDecisions: ThreeKingdomsBanqiDecision[] | null = null;
  let runs = 0;
  let signedIn = false;
  let admitted = false;
  let engineAvailable = true;
  const order: string[] = [];
  const decision: ThreeKingdomsBanqiDecision = {
    ply: 1,
    mover: 'red',
    bestWin: 80,
    playedWin: 50,
    realizedWin: 40,
    playedRank: 2,
  };
  const handler = createThreeKingdomsBanqiAnalysisRoutes(
    {
      ...deps(gameRecord(), finishedEvents()),
      admits: async () => admitted,
    },
    {
      cache: {
        get: async () => cachedAnalysis,
        save: async (_r, _e, _d, value) => {
          cachedAnalysis = value;
        },
      },
      decisionsCache: {
        get: async () => cachedDecisions,
        save: async (_r, _e, _d, value) => {
          cachedDecisions = value;
        },
      },
      analyze: async () => {
        order.push('analysis');
        return analysis;
      },
      analyzeDecisions: async () => {
        order.push('decisions');
        runs += 1;
        return [decision];
      },
      engineAvailable: () => engineAvailable,
      route: { currentUser: async () => (signedIn ? { id: 'tk-decision-account' } : null) },
    },
  );
  try {
    // Outside the playtest, a decisions read is the unknown-game 404.
    const outsider = fakeResponse();
    await handler(GET, outsider.response, `${PATH}/decisions`);
    assert.equal(outsider.captured.status, 404);
    admitted = true;
    const miss = fakeResponse();
    await handler(GET, miss.response, `${PATH}/decisions`);
    assert.equal(miss.captured.status, 204);
    assert.equal(runs, 0);
    // Once admitted to the playtest, a guest still cannot enqueue work.
    const refused = fakeResponse();
    await handler(
      { method: 'POST', headers: {} } as IncomingMessage,
      refused.response,
      `${PATH}/decisions`,
    );
    assert.equal(refused.captured.status, 401);
    assert.equal(runs, 0);
    signedIn = true;
    const post = fakeResponse();
    await handler(
      { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage,
      post.response,
      `${PATH}/decisions`,
    );
    assert.equal(post.captured.status, 202);
    const jobId = (post.captured.body as { jobId: string }).jobId;
    for (let i = 0; i < 20 && getAnalysisJob(jobId)?.status === 'pending'; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(getAnalysisJob(jobId)?.status, 'done');
    assert.deepEqual(order, ['analysis', 'decisions']);
    signedIn = engineAvailable = false;
    for (let i = 0; i < 2; i += 1) {
      const get = fakeResponse();
      await handler(GET, get.response, `${PATH}/decisions`);
      assert.equal(get.captured.status, 200);
      assert.deepEqual((get.captured.body as { decisions: unknown }).decisions, [decision]);
    }
    const poll = fakeResponse();
    await handler(GET, poll.response, `${PATH}/decisions/jobs/${jobId}`);
    assert.equal(poll.captured.status, 200);
    assert.equal(runs, 1);
    admitted = false;
    const closed = fakeResponse();
    await handler(GET, closed.response, `${PATH}/decisions`);
    assert.equal(closed.captured.status, 404);
  } finally {
    await resetAnalysisJobsForTests();
  }
});

test('analysis fails closed for a missing strongest engine and a vacuous sweep', async () => {
  const calls = { lookups: 0 };
  const missing = createThreeKingdomsBanqiAnalysisRoutes(
    deps(gameRecord(), finishedEvents(), {}, calls),
    {
      route: { currentUser: async () => ({ id: 'admin' }) },
      engineAvailable: () => false,
    },
  );
  const post = fakeResponse();
  await missing(
    { method: 'POST', headers: {} } as IncomingMessage,
    post.response,
    `${PATH}/analysis`,
  );
  assert.equal(post.captured.status, 503);
  assert.deepEqual(post.captured.body, { error: 'analysis_engine_unavailable' });
  assert.equal(calls.lookups, 0);

  await resetAnalysisJobsForTests();
  let saves = 0;
  const vacuous = createThreeKingdomsBanqiAnalysisRoutes(deps(gameRecord(), finishedEvents()), {
    route: { currentUser: async () => ({ id: 'admin' }) },
    engineAvailable: () => true,
    cache: {
      get: async () => null,
      save: async () => {
        saves += 1;
      },
    },
    analyze: async () => ({
      ...analysis,
      plies: analysis.plies.map((entry) => ({ ...entry, cp: null })),
    }),
  });
  try {
    const queued = fakeResponse();
    await vacuous(
      { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage,
      queued.response,
      `${PATH}/analysis`,
    );
    assert.equal(queued.captured.status, 202);
    const jobId = (queued.captured.body as { jobId: string }).jobId;
    for (let i = 0; i < 20 && getAnalysisJob(jobId)?.status === 'pending'; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const poll = fakeResponse();
    await vacuous(GET, poll.response, `${PATH}/analysis/jobs/${jobId}`);
    assert.deepEqual(poll.captured.body, {
      status: 'failed',
      error: 'analysis_engine_unavailable',
    });
    assert.equal(saves, 0);
    assert.equal(getAnalysisJob(jobId)?.error, 'analysis_engine_unavailable');
  } finally {
    await resetAnalysisJobsForTests();
  }
});
