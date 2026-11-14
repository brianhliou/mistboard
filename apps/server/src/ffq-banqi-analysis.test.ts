import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyFFQBanqiMove,
  createFFQBanqiDeal,
  createFFQBanqiStateFromSetup,
  FFQ_BANQI_SPEC_ID,
  getFFQBanqiLegalMoves,
} from '@mistboard/game';
import {
  analyzeFFQBanqiPostgame,
  evaluateFFQBanqiPosition,
  FFQ_BANQI_ANALYSIS_DEPTH,
  FFQ_BANQI_ANALYSIS_ENGINE_ID,
  type FFQBanqiAnalysisCache,
  resolveFFQBanqiAnalysis,
} from './ffq-banqi-analysis.js';
import {
  buildFFQBanqiEngineCommands,
  FFQ_BANQI_ENGINE_VERSION,
  type FFQBanqiEngineProvider,
  type FFQBanqiEngineRequest,
  ffqBanqiMoveToUci,
} from './ffq-banqi-engine.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import type { AnalysisProgress, AnalysisProgressStore } from './game-analysis-kernel.js';
import { type SweepPlyEval, VacuousAnalysisError } from './game-analysis-sweep.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

const ROOM = 'ffq_analysis';
const deal = createFFQBanqiDeal(800);
const created = {
  type: 'room-created',
  at: 1,
  roomId: ROOM,
  gameSpecId: FFQ_BANQI_SPEC_ID,
  setup: { deal },
} as const;
const events: FFQBanqiEvent[] = [created];
let state = createFFQBanqiStateFromSetup(ROOM, { deal });
for (let ply = 0; ply < 24 && state.status.type === 'playing'; ply += 1) {
  const legal = getFFQBanqiLegalMoves(state);
  const captures = legal.filter((move) => move.from !== move.to && state.board[move.to]);
  const quiet = legal.filter((move) => move.from !== move.to && !state.board[move.to]);
  const flips = legal.filter((move) => move.from === move.to);
  const move =
    captures[0] ??
    (ply % 4 !== 0 ? quiet[(ply * 7) % Math.max(quiet.length, 1)] : undefined) ??
    flips[(ply * 5) % Math.max(flips.length, 1)] ??
    legal[0]!;
  events.push({ type: 'move-played', at: ply + 2, roomId: ROOM, color: state.status.turn, move });
  state = applyFFQBanqiMove(state, move);
}
const finished: FFQBanqiEvent[] = [
  ...events,
  { type: 'seat-resigned', at: 100, roomId: ROOM, color: 'black' },
];
const score: FFQBanqiEngineProvider = async (request) => ({
  protocolVersion: request.protocolVersion,
  gameId: request.gameId,
  sessionId: request.sessionId,
  move: request.legalMoves[0]!,
  cp: 42,
  mate: null,
});

test('replays N+1 positions at classical L7 and normalizes scores to the red seat', async () => {
  const requests: FFQBanqiEngineRequest[] = [];
  const result = await analyzeFFQBanqiPostgame(finished, async (request) => {
    requests.push(request);
    return score(request);
  });
  assert.equal(result.plies.length, events.length);
  assert.equal(result.engineId, FFQ_BANQI_ANALYSIS_ENGINE_ID);
  assert.equal(result.depth, FFQ_BANQI_ANALYSIS_DEPTH);
  assert.ok(
    result.engineId.includes(
      `@${FFQ_BANQI_ENGINE_VERSION}+misty-ffq-banqi-level-7-n25000-classical`,
    ),
  );
  assert.deepEqual(
    result.plies.map((entry) => entry.cp),
    result.plies.map((_, ply) => (ply % 2 === 0 ? 42 : -42)),
  );
  assert.ok(state.captures.length > 0, 'the line includes captures');
  for (const request of requests) {
    assert.equal(request.engineId, 'misty-ffq-banqi-level-7');
    assert.equal(request.nodes, 25_000);
    assert.equal(request.movetimeCapMs, 3_000);
    assert.equal(request.position.view.perspective, request.color === 'white' ? 'red' : 'black');
  }
});

test('swapping two still-covered identities changes no engine input or analysis payload', async () => {
  const covered = state.board.flatMap((piece, index) => (piece?.faceDown ? [index] : []));
  const i = covered[0]!;
  const j = covered.find(
    (index) => deal[index]!.color !== deal[i]!.color || deal[index]!.role !== deal[i]!.role,
  );
  assert.notEqual(j, undefined, 'the swap changes two distinct pieces');
  const swappedDeal = [...deal];
  [swappedDeal[i], swappedDeal[j!]] = [swappedDeal[j!]!, swappedDeal[i]!];
  const swapped = [{ ...created, setup: { deal: swappedDeal } }, ...finished.slice(1)];
  assert.notDeepEqual(
    replayTenantEvents(ffqBanqiTenant, finished).state.board,
    replayTenantEvents(ffqBanqiTenant, swapped).state.board,
  );
  const inputs: string[][] = [[], []];
  const results = [];
  for (const [index, log] of [finished, swapped].entries()) {
    results.push(
      await analyzeFFQBanqiPostgame(log, async (request) => {
        inputs[index]!.push(
          JSON.stringify({ request, commands: buildFFQBanqiEngineCommands(request) }),
        );
        return score(request);
      }),
    );
  }
  assert.equal(inputs[0]!.length, events.length);
  assert.deepEqual(inputs[0], inputs[1], 'every serialized request and stdin block');
  assert.equal(JSON.stringify(results[0]), JSON.stringify(results[1]), 'whole analysis payload');
});

test('mate scores use seat POV; terminal positions bypass the engine', async () => {
  const black = replayTenantEvents(ffqBanqiTenant, events.slice(0, 2)).state;
  assert.deepEqual(
    await evaluateFFQBanqiPosition(black, async (request) => ({
      ...(await score(request)),
      cp: null,
      mate: 3,
    })),
    { cp: null, mate: -3, best: ffqBanqiMoveToUci(getFFQBanqiLegalMoves(black)[0]!) },
  );
  const terminal = replayTenantEvents(ffqBanqiTenant, finished).state;
  for (const winner of ['red', 'black', null] as const) {
    assert.deepEqual(
      await evaluateFFQBanqiPosition(
        {
          ...terminal,
          status: { type: 'finished', winner, reason: winner ? 'hp' : 'no-progress' },
        },
        async () => {
          throw new Error('terminal position must not query engine');
        },
      ),
      { cp: winner === 'red' ? 30_000 : winner === 'black' ? -30_000 : 0, mate: null, best: null },
    );
  }
});

test('checkpoints resume without re-evaluating completed positions; missing deal fails closed', async () => {
  let checkpoint: AnalysisProgress<SweepPlyEval> | null = null;
  const progress: AnalysisProgressStore<SweepPlyEval> = {
    load: async () => checkpoint,
    save: async (value) => {
      checkpoint = { ...value, items: [...value.items] };
    },
  };
  let calls = 0;
  await assert.rejects(
    analyzeFFQBanqiPostgame(
      events.slice(0, 4),
      async (request) => {
        calls += 1;
        if (calls === 3) throw new Error('interrupted');
        return score(request);
      },
      progress,
    ),
    /interrupted/,
  );
  calls = 0;
  const result = await analyzeFFQBanqiPostgame(
    events.slice(0, 4),
    async (request) => {
      calls += 1;
      return score(request);
    },
    progress,
  );
  assert.equal(calls, 2);
  assert.equal(result.plies.length, 4);
  await assert.rejects(
    analyzeFFQBanqiPostgame([{ ...created, setup: undefined }], score),
    /missing_deal/,
  );
});

test('cache reads never compute; concurrent requests coalesce and reload uses cache', async () => {
  let stored: SweepPlyEval[] | null = null;
  let saves = 0;
  const cache: FFQBanqiAnalysisCache = {
    get: async () => stored,
    save: async (_room, _engine, _depth, plies) => {
      saves += 1;
      stored = plies;
    },
  };
  let calls = 0;
  const analyze = async () => {
    calls += 1;
    return analyzeFFQBanqiPostgame(events.slice(0, 3), score);
  };
  assert.equal(await resolveFFQBanqiAnalysis(ROOM, events, cache, analyze, false), null);
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([
    resolveFFQBanqiAnalysis(ROOM, events, cache, analyze),
    resolveFFQBanqiAnalysis(ROOM, events, cache, analyze),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal(saves, 1);
  assert.deepEqual(await resolveFFQBanqiAnalysis(ROOM, events, cache, analyze, false), a);
  assert.equal(calls, 1);
});

test('an all-null engine sweep is rejected and never cached', async () => {
  let saves = 0;
  const cache: FFQBanqiAnalysisCache = {
    get: async () => null,
    save: async () => {
      saves += 1;
    },
  };
  await assert.rejects(
    resolveFFQBanqiAnalysis('ffq_vacuous', events, cache, (log) =>
      analyzeFFQBanqiPostgame(log, async (request) => ({
        ...(await score(request)),
        cp: null,
        mate: null,
      })),
    ),
    VacuousAnalysisError,
  );
  assert.equal(saves, 0);
});

test('a board ending includes the terminal point without an engine request', async () => {
  let current = createFFQBanqiStateFromSetup(ROOM, { deal });
  const log: FFQBanqiEvent[] = [created];
  while (current.status.type === 'playing' && current.ply < 100) {
    const legal = getFFQBanqiLegalMoves(current);
    const move =
      legal.find((m) => m.from !== m.to && current.board[m.to]) ??
      legal.find((m) => m.from === m.to) ??
      legal[0]!;
    log.push({
      type: 'move-played',
      at: current.ply + 2,
      roomId: ROOM,
      color: current.status.turn,
      move,
    });
    current = applyFFQBanqiMove(current, move);
  }
  assert.equal(current.status.type, 'finished');
  let calls = 0;
  const result = await analyzeFFQBanqiPostgame(log, async (request) => {
    calls++;
    return score(request);
  });
  assert.equal(calls, current.ply);
  assert.equal(result.plies.length, current.ply + 1);
  assert.deepEqual(result.plies.at(-1), {
    ply: current.ply,
    ...(await evaluateFFQBanqiPosition(current)),
  });
});
