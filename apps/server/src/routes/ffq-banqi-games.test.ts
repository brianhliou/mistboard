import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  applyFFQBanqiMove,
  type BanqiDeal,
  createFFQBanqiDeal,
  createFFQBanqiStateFromSetup,
  FFQ_BANQI_DAMAGE,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiMove,
  getFFQBanqiLegalMoves,
} from '@mistboard/game';
import { ffqBanqiAdmits } from '../ffq-banqi-access.js';
import {
  FFQ_BANQI_ANALYSIS_DEPTH,
  FFQ_BANQI_ANALYSIS_ENGINE_ID,
  type FFQBanqiGameAnalysis,
} from '../ffq-banqi-analysis.js';
import { ffqBanqiCardFen } from '../ffq-banqi-publication.js';
import { ffqBanqiPostgameHistory } from '../ffq-banqi-replay.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from '../ffq-banqi-tenant.js';
import { getAnalysisJob, resetAnalysisJobsForTests } from '../game-analysis-jobs.js';
import { resolveGameExport } from '../game-export-tenant.js';
import { type TenantGameCardStore, tenantGameCard, tenantGamePageMeta } from '../og-game-tenant.js';
import { resolvePositionOg } from '../og-position.js';
import type { GameRecord } from '../persistence.js';
import { variantTenantForRoomId } from '../variant-tenant/registry.js';
import { replayTenantEvents } from '../variant-tenant/runtime.js';
import '../ffq-banqi-registration.js';
import {
  createFFQBanqiAnalysisRoutes,
  type FFQBanqiPostgameRouteDeps,
  ffqBanqiPostgameForApi,
  handleFFQBanqiPostgame,
  tryHandle,
} from './ffq-banqi-games.js';

const ROOM = 'ffq_review';
const deal = createFFQBanqiDeal(800);
let state = createFFQBanqiStateFromSetup(ROOM, { deal });
const moves: FFQBanqiMove[] = [];
while (state.status.type === 'playing' && moves.length < 100) {
  const legal = getFFQBanqiLegalMoves(state);
  const move =
    legal.find((m) => m.from !== m.to && state.board[m.to]) ??
    legal.find((m) => m.from === m.to) ??
    legal[0];
  assert.ok(move);
  moves.push(move);
  state = applyFFQBanqiMove(state, move);
}
assert.equal(state.status.type, 'finished');
const i = state.board.findIndex((piece) => piece?.faceDown);
const j = state.board.findIndex(
  (piece, square) =>
    piece?.faceDown &&
    square !== i &&
    (piece.role !== state.board[i]!.role || piece.color !== state.board[i]!.color),
);
assert.ok(i >= 0 && j >= 0, 'plant two different, never-visible on-board identities');
const swapped = deal.map((piece) => ({ ...piece }));
[swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];

function events(setup: BanqiDeal = deal): FFQBanqiEvent[] {
  return [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM,
      gameSpecId: FFQ_BANQI_SPEC_ID,
      setup: { deal: setup },
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM, clientId: 'b', seat: 'black' },
    ...moves.map(
      (move, ply): FFQBanqiEvent => ({
        type: 'move-played',
        at: ply + 10,
        roomId: ROOM,
        color: ply % 2 === 0 ? 'red' : 'black',
        move,
      }),
    ),
  ];
}
const game: GameRecord = {
  roomId: ROOM,
  variant: FFQ_BANQI_SPEC_ID,
  mode: 'pvp',
  result: 'red-wins',
  termination: 'points',
  plyCount: moves.length,
  startedAt: new Date(1),
  endedAt: new Date(100),
  whiteName: null,
  blackName: null,
  corpusId: null,
  rated: false,
  visibility: 'public',
  participants: ['red', 'black'].map((color) => ({
    color: color as 'red' | 'black',
    subjectType: 'user',
    subjectId: color,
    displayName: color,
    visibility: 'public',
  })),
};
const store = (log = events()): TenantGameCardStore => ({
  summary: async () => game,
  events: async () => log,
  analysis: async () => null,
});
const deps = (log = events()): FFQBanqiPostgameRouteDeps => ({
  getGameSummary: async () => ({
    ...game,
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
  }),
  loadRoomEvents: async () => log,
  admits: async () => true,
  persistenceReady: () => true,
});
function serialized(value: unknown): string {
  const json = JSON.stringify(value);
  JSON.parse(json, (key, entry) => {
    assert.ok(
      !['setup', 'deal', 'seed', 'revealed', 'deal_fen'].includes(key),
      `secret field ${key}`,
    );
    if (entry?.faceDown === true) assert.deepEqual(entry, { faceDown: true });
    return entry;
  });
  return json;
}

// Serializes the entire result, with a real hidden-identity permutation that
// changes canonical state. A leak anywhere in the envelope breaks equality.
test('finished FFQ API is masked at every ply with exact HP and capture damage', async () => {
  assert.notDeepEqual(
    replayTenantEvents(ffqBanqiTenant, events()).state.board,
    replayTenantEvents(ffqBanqiTenant, events(swapped)).state.board,
  );
  const payload = await ffqBanqiPostgameForApi(ROOM, deps());
  assert.ok(payload);
  assert.equal(
    serialized(payload),
    serialized(await ffqBanqiPostgameForApi(ROOM, deps(events(swapped)))),
  );
  assert.equal(payload.history.truth.length, moves.length + 1);
  let before = createFFQBanqiStateFromSetup(ROOM, { deal });
  for (const [index, move] of moves.entries()) {
    const after = applyFFQBanqiMove(before, move);
    const frame: (typeof payload.history.truth)[number] = payload.history.truth[index + 1]!;
    assert.deepEqual(frame.view.hp, after.hp);
    assert.equal(after.hp.red, Math.max(0, before.hp.red - frame.damage.red));
    assert.equal(after.hp.black, Math.max(0, before.hp.black - frame.damage.black));
    const capture = after.captures.at(-1);
    if (after.captures.length > before.captures.length) {
      assert.ok(capture);
      assert.equal(frame.damage.red + frame.damage.black, FFQ_BANQI_DAMAGE[capture.role]);
      assert.deepEqual(frame.view.captured.at(-1), capture, 'covered victims stay public');
    }
    before = after;
  }
});

test('FFQ exports remain unavailable for both hidden deals', () => {
  for (const format of ['pgn', 'json'] as const) {
    const args = { roomId: ROOM, format };
    const summary = {
      ...game,
      jobId: null,
      gameIndex: null,
      whiteEngineId: null,
      blackEngineId: null,
      timeControl: null,
      initialMs: null,
      incrementMs: null,
    };
    const a = resolveGameExport({ ...args, summary, events: events() });
    const b = resolveGameExport({ ...args, summary, events: events(swapped) });
    assert.equal(a.status, 501);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.ok(!JSON.stringify(a).includes('deal_fen'));
    assert.deepEqual(a, {
      status: 501,
      body: { error: 'export_not_supported_for_variant', variant: FFQ_BANQI_SPEC_ID },
    });
  }
});

test('FFQ has no share card or page meta for either hidden deal', async () => {
  assert.equal(variantTenantForRoomId(ROOM)?.export, null);
  assert.equal(variantTenantForRoomId(ROOM)?.card, null);
  for (const log of [events(), events(swapped)]) {
    assert.equal(await tenantGameCard(ROOM, store(log)), null);
    assert.equal(await tenantGamePageMeta(`/ffq-banqi/game/${ROOM}`, store(log)), null);
  }
  // The unused card projection must still mask every covered on-board piece.
  const fen = ffqBanqiCardFen(state);
  assert.equal(fen, ffqBanqiCardFen(replayTenantEvents(ffqBanqiTenant, events(swapped)).state));
  const board = resolvePositionOg('banqi', fen);
  assert.ok(board && board.board.kind === 'grid');
  assert.equal(
    board.board.tiles.filter((tile) => tile.hidden).length,
    state.board.filter((piece) => piece?.faceDown).length,
  );
});

test('FFQ route gates before reads and rejects live, aborted, foreign and missing games', async () => {
  for (const admitted of [false, true]) {
    let reads = 0;
    let status = 0;
    let body = '';
    const routeDeps = {
      ...deps(),
      admits: async () => admitted,
      getGameSummary: async () => {
        reads++;
        return deps().getGameSummary(ROOM);
      },
      loadRoomEvents: async () => {
        reads++;
        return events();
      },
    };
    const response = {
      setHeader: () => {},
      writeHead: (code: number) => {
        status = code;
      },
      end: (value: string) => {
        body = value;
      },
    } as unknown as ServerResponse;
    assert.equal(
      await handleFFQBanqiPostgame(
        { method: 'GET' } as IncomingMessage,
        response,
        `/api/ffq-banqi/games/${ROOM}`,
        routeDeps,
      ),
      true,
    );
    assert.equal(status, admitted ? 200 : 404);
    if (!admitted) {
      assert.equal(reads, 0);
      assert.equal(body, '{"error":"not_found"}');
    } else serialized(JSON.parse(body));
  }
  assert.equal(await ffqBanqiPostgameForApi(ROOM, deps(events().slice(0, 4))), null);
  assert.equal(
    await ffqBanqiPostgameForApi(
      ROOM,
      deps([
        ...events().slice(0, 4),
        { type: 'game-aborted', at: 90, roomId: ROOM, reason: 'user-abort' } as FFQBanqiEvent,
      ]),
    ),
    null,
  );
  assert.equal(
    await ffqBanqiPostgameForApi(ROOM, { ...deps(), getGameSummary: async () => null }),
    null,
  );
  assert.equal(
    await ffqBanqiPostgameForApi(ROOM, {
      ...deps(),
      getGameSummary: async () => ({ ...(await deps().getGameSummary(ROOM))!, variant: 'banqi' }),
    }),
    null,
  );
});

function fakeResponse() {
  const captured = { status: 0, body: undefined as unknown };
  const response = {
    setHeader: () => {},
    writeHead: (code: number) => {
      captured.status = code;
      return response;
    },
    end: (body?: string) => {
      captured.body = body ? JSON.parse(body) : undefined;
    },
  } as unknown as ServerResponse;
  return { response, captured };
}
const analysisPath = `/api/ffq-banqi/games/${ROOM}/analysis`;
const GET = { method: 'GET', headers: {} } as IncomingMessage;

test('FFQ analysis refuses non-admin and flag-off callers before any read, compute or job poll', async () => {
  const flag = process.env.MISTBOARD_FFQ_BANQI_ENABLED;
  try {
    for (const enabled of [false, true]) {
      process.env.MISTBOARD_FFQ_BANQI_ENABLED = String(enabled);
      for (const account of [
        null,
        { accountRole: 'player' as const },
        { accountRole: 'admin' as const },
      ]) {
        if (enabled && account?.accountRole === 'admin') continue;
        const forbidden = async (): Promise<never> => {
          throw new Error('denied request reached dependency');
        };
        const handler = createFFQBanqiAnalysisRoutes(
          {
            ...deps(),
            admits: async () => ffqBanqiAdmits(account),
            persistenceReady: () => {
              throw new Error('denied request checked persistence');
            },
            getGameSummary: forbidden,
            loadRoomEvents: forbidden,
          },
          {
            engineAvailable: () => {
              throw new Error('denied request checked engine');
            },
            analyze: forbidden,
          },
        );
        for (const path of [
          analysisPath,
          `${analysisPath}/jobs/private-job`,
          analysisPath.replace('/analysis', '/decisions'),
          `${analysisPath.replace('/analysis', '/decisions')}/jobs/private-job`,
        ]) {
          for (const method of ['GET', 'POST']) {
            const res = fakeResponse();
            assert.equal(
              await handler({ ...GET, method } as IncomingMessage, res.response, path),
              true,
            );
            assert.equal(res.captured.status, 404);
            assert.deepEqual(res.captured.body, { error: 'not_found' });
          }
        }
      }
    }
    // Exercise the real tryHandle dispatch/default admission with flag on as a guest.
    const res = fakeResponse();
    await tryHandle(
      {} as Parameters<typeof tryHandle>[0],
      GET,
      res.response,
      analysisPath,
      new URL(analysisPath, 'http://local'),
    );
    assert.equal(res.captured.status, 404);
  } finally {
    if (flag === undefined) delete process.env.MISTBOARD_FFQ_BANQI_ENABLED;
    else process.env.MISTBOARD_FFQ_BANQI_ENABLED = flag;
  }
});

test('FFQ analysis GET is cache-only, POST queues, poll completes, reload uses the cache', async () => {
  await resetAnalysisJobsForTests();
  const analysis: FFQBanqiGameAnalysis = {
    engineId: FFQ_BANQI_ANALYSIS_ENGINE_ID,
    depth: FFQ_BANQI_ANALYSIS_DEPTH,
    plies: Array.from({ length: moves.length + 1 }, (_, ply) => ({
      ply,
      cp: 42,
      mate: null,
      best: null,
    })),
  };
  let cached: typeof analysis.plies | null = null;
  let computes = 0;
  const handler = createFFQBanqiAnalysisRoutes(deps(), {
    route: { currentUser: async () => ({ id: 'ffq-admin' }) },
    engineAvailable: () => true,
    cache: {
      get: async () => cached,
      save: async (_room, _engine, _depth, plies) => {
        cached = plies;
      },
    },
    analyze: async (log) => {
      computes++;
      assert.deepEqual(log, events());
      return analysis;
    },
  });
  try {
    const miss = fakeResponse();
    await handler(GET, miss.response, analysisPath);
    assert.equal(miss.captured.status, 204);
    assert.equal(computes, 0);
    const post = fakeResponse();
    await handler(
      { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage,
      post.response,
      analysisPath,
    );
    assert.equal(post.captured.status, 202);
    const jobId = (post.captured.body as { jobId: string }).jobId;
    for (let i = 0; i < 30 && getAnalysisJob(jobId)?.status === 'pending'; i++)
      await new Promise((resolve) => setImmediate(resolve));
    const poll = fakeResponse();
    await handler(GET, poll.response, `${analysisPath}/jobs/${jobId}`);
    assert.equal(poll.captured.status, 200);
    const frames = ffqBanqiPostgameHistory(events()).truth;
    const chancePlies = moves.flatMap((move, i) =>
      frames[i]!.view.board[move.to]?.faceDown ? [i + 1] : [],
    );
    assert.ok(
      moves.some((move, i) => move.from !== move.to && chancePlies.includes(i + 1)),
      'covered capture fixture',
    );
    assert.deepEqual(poll.captured.body, { status: 'done', result: { ...analysis, chancePlies } });
    serialized(poll.captured.body);
    const reload = fakeResponse();
    await handler(GET, reload.response, analysisPath);
    assert.equal(reload.captured.status, 200);
    assert.deepEqual(reload.captured.body, (poll.captured.body as { result: unknown }).result);
    assert.equal(computes, 1);
    const wrongGame = fakeResponse();
    await handler(
      GET,
      wrongGame.response,
      `${analysisPath.replace(ROOM, 'ffq_other')}/jobs/${jobId}`,
    );
    assert.equal(wrongGame.captured.status, 404);
  } finally {
    await resetAnalysisJobsForTests();
  }
});

test('FFQ analysis rejects unfinished, aborted, foreign and missing games and missing engine', async () => {
  for (const routeDeps of [
    deps(events().slice(0, 4)),
    deps([
      ...events().slice(0, 4),
      { type: 'game-aborted', at: 90, roomId: ROOM, reason: 'user-abort' },
    ]),
    { ...deps(), getGameSummary: async () => null },
    {
      ...deps(),
      getGameSummary: async () => ({ ...(await deps().getGameSummary(ROOM))!, variant: 'banqi' }),
    },
  ]) {
    const handler = createFFQBanqiAnalysisRoutes(routeDeps);
    const res = fakeResponse();
    await handler(GET, res.response, analysisPath);
    assert.equal(res.captured.status, 404);
  }
  const handler = createFFQBanqiAnalysisRoutes(deps(), {
    route: { currentUser: async () => ({ id: 'ffq-admin' }) },
    engineAvailable: () => false,
  });
  const unavailable = fakeResponse();
  await handler({ ...GET, method: 'POST' } as IncomingMessage, unavailable.response, analysisPath);
  assert.equal(unavailable.captured.status, 503);
  assert.deepEqual(unavailable.captured.body, { error: 'analysis_engine_unavailable' });
});

test('FFQ decisions are finished-only, cache-first and checkpoint-job compatible behind the same gate', async () => {
  await resetAnalysisJobsForTests();
  const { analyzeFFQBanqiDecisions, ffqBanqiPublicTrack, FFQ_BANQI_DECISIONS_ENGINE_ID } =
    await import('../ffq-banqi-decisions.js');
  const { ffqBanqiMoveToUci } = await import('../ffq-banqi-engine.js');
  const path = analysisPath.replace('/analysis', '/decisions');
  for (const log of [
    events().slice(0, 4),
    [
      ...events().slice(0, 4),
      { type: 'game-aborted', at: 90, roomId: ROOM, reason: 'user-abort' } as FFQBanqiEvent,
    ],
  ]) {
    const handler = createFFQBanqiAnalysisRoutes(deps(log));
    for (const endpoint of [path, `${path}/jobs/private-job`]) {
      const response = fakeResponse();
      assert.equal(await handler(GET, response.response, endpoint), true);
      assert.equal(response.captured.status, 404);
    }
  }
  const results: string[] = [];
  try {
    for (const log of [events(), events(swapped)]) {
      let stored: import('../banqi-analysis.js').BanqiDecision[] | null = null;
      let computes = 0;
      const handler = createFFQBanqiAnalysisRoutes(deps(log), {
        route: { currentUser: async () => ({ id: 'ffq-decisions-admin' }) },
        engineAvailable: () => true,
        cache: {
          get: async () => [{ ply: 0, cp: 0, mate: null, best: null }],
          save: async () => {},
        },
        decisionsCache: {
          get: async () => stored,
          save: async (_r, _e, _d, rows) => {
            stored = rows;
          },
        },
        analyzeDecisions: async (track) => {
          computes++;
          assert.deepEqual(track, ffqBanqiPublicTrack(log));
          const best = new Map(
            track.moves.map((move, i) => [track.frames[i]!.fen, ffqBanqiMoveToUci(move)]),
          );
          return analyzeFFQBanqiDecisions(track, async (fen) => ({
            cp: 10,
            mate: null,
            best: best.get(fen) ?? 'a0a0',
          }));
        },
      });
      const miss = fakeResponse();
      await handler(GET, miss.response, path);
      assert.equal(miss.captured.status, 204);
      assert.equal(computes, 0);
      const post = fakeResponse();
      await handler(
        { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage,
        post.response,
        path,
      );
      assert.equal(post.captured.status, 202);
      const jobId = (post.captured.body as { jobId: string }).jobId;
      for (let n = 0; n < 100 && getAnalysisJob(jobId)?.status === 'pending'; n++)
        await new Promise((resolve) => setImmediate(resolve));
      const poll = fakeResponse();
      await handler(GET, poll.response, `${path}/jobs/${jobId}`);
      assert.equal(poll.captured.status, 200);
      assert.equal((poll.captured.body as { status: string }).status, 'done');
      const reload = fakeResponse();
      await handler(GET, reload.response, path);
      assert.equal(reload.captured.status, 200);
      assert.equal(computes, 1);
      const body = reload.captured.body as { engineId: string; decisions: unknown[] };
      assert.equal(body.engineId, FFQ_BANQI_DECISIONS_ENGINE_ID);
      assert.ok(body.decisions.length > 0);
      serialized(body);
      results.push(JSON.stringify(body));
      await resetAnalysisJobsForTests();
    }
    assert.equal(
      results[0],
      results[1],
      'named planted never-visible deal swap survives the whole decisions route',
    );
  } finally {
    await resetAnalysisJobsForTests();
  }
});
