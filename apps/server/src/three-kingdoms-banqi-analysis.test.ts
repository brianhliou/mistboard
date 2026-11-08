import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyThreeKingdomsBanqiMove,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiLegalMoves,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  THREE_KINGDOMS_BANQI_SPEC_ID,
} from '@mistboard/game';
import type { AnalysisProgress, AnalysisProgressStore } from './game-analysis-kernel.js';
import { type SweepPlyEval, VacuousAnalysisError } from './game-analysis-sweep.js';
import {
  analyzeThreeKingdomsBanqiPostgame,
  evaluateThreeKingdomsBanqiPosition,
  resolveThreeKingdomsBanqiAnalysis,
  THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH,
  THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID,
  type ThreeKingdomsBanqiAnalysisCache,
} from './three-kingdoms-banqi-analysis.js';
import {
  buildThreeKingdomsBanqiEngineCommands,
  type ThreeKingdomsBanqiEngineProvider,
  type ThreeKingdomsBanqiEngineRequest,
} from './three-kingdoms-banqi-engine.js';
import {
  type ThreeKingdomsBanqiEvent,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

const ROOM = 'tkb_analysis';
let seed = 929;
const deal = createThreeKingdomsBanqiSetup(() => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}).deal;
const created = {
  type: 'room-created',
  at: 1,
  roomId: ROOM,
  gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
  setup: { deal },
} as const;
const events: ThreeKingdomsBanqiEvent[] = [created];
let state = createThreeKingdomsBanqiStateFromSetup(ROOM, { deal });
for (let ply = 0; ply < 48 && state.status.type === 'playing'; ply += 1) {
  const legal = getThreeKingdomsBanqiLegalMoves(state);
  const captures = legal.filter((move) => move.from !== move.to && state.board[move.to]);
  const quiet = legal.filter((move) => move.from !== move.to && !state.board[move.to]);
  const flips = legal.filter((move) => move.from === move.to);
  const move =
    captures[0] ??
    (ply % 4 !== 0 ? quiet[(ply * 7) % Math.max(quiet.length, 1)] : undefined) ??
    flips[(ply * 5) % Math.max(flips.length, 1)] ??
    legal[0]!;
  events.push({ type: 'move-played', at: ply + 2, roomId: ROOM, color: state.status.turn, move });
  state = applyThreeKingdomsBanqiMove(state, move);
}
const finished: ThreeKingdomsBanqiEvent[] = [
  ...events,
  { type: 'seat-resigned', at: 100, roomId: ROOM, color: 'black' },
];
const score: ThreeKingdomsBanqiEngineProvider = async () => ({
  cp: 42,
  mate: null,
  best: 'a1a1',
  depth: 1,
});

// No real subprocess is launched. A readable file stands in for the NNUE path
// so the exact L8 request (including EvalFile) is exercised by the provider spy.
const previousNet = process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET;
before(() => {
  process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET = fileURLToPath(import.meta.url);
});
after(() => {
  if (previousNet === undefined) delete process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET;
  else process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET = previousNet;
});

test('replays N+1 positions at L8 and normalizes scores to the red seat', async () => {
  const requests: ThreeKingdomsBanqiEngineRequest[] = [];
  const result = await analyzeThreeKingdomsBanqiPostgame(finished, async (request) => {
    requests.push(request);
    return score(request);
  });
  assert.equal(result.plies.length, events.length);
  assert.equal(result.engineId, THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID);
  assert.equal(result.depth, THREE_KINGDOMS_BANQI_ANALYSIS_DEPTH);
  assert.deepEqual(
    result.plies.map((entry) => entry.cp),
    result.plies.map((_, ply) => (ply % 2 === 0 ? 42 : -42)),
  );
  assert.ok(
    requests.some((request) => request.moves.length > 0),
    'quiet repetition history',
  );
  assert.ok(state.captures.length > 0, 'the line includes captures');
  for (const request of requests) {
    assert.equal(request.nodes, 2_048_000);
    assert.equal(request.movetimeCapMs, 3_000);
    assert.equal(request.chance, 'mix');
    assert.equal(request.evalFile, fileURLToPath(import.meta.url));
  }
});

test('swapping two still-covered identities changes no engine input or analysis payload', async () => {
  const covered = THREE_KINGDOMS_BANQI_SETUP_SQUARES.flatMap((square, index) =>
    state.board[square]?.faceDown ? [index] : [],
  );
  const i = covered[0]!;
  const j = covered.find(
    (index) => deal[index]!.color !== deal[i]!.color || deal[index]!.role !== deal[i]!.role,
  );
  assert.notEqual(j, undefined, 'the swap changes two distinct pieces');
  const swappedDeal = [...deal];
  [swappedDeal[i], swappedDeal[j!]] = [swappedDeal[j!]!, swappedDeal[i]!];
  const swapped = [{ ...created, setup: { deal: swappedDeal } }, ...finished.slice(1)];
  assert.notDeepEqual(
    replayTenantEvents(threeKingdomsBanqiTenant, finished).state.board,
    replayTenantEvents(threeKingdomsBanqiTenant, swapped).state.board,
  );
  const inputs: string[][] = [[], []];
  const results = [];
  for (const [index, log] of [finished, swapped].entries()) {
    results.push(
      await analyzeThreeKingdomsBanqiPostgame(log, async (request) => {
        inputs[index]!.push(
          JSON.stringify({ request, commands: buildThreeKingdomsBanqiEngineCommands(request) }),
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
  const black = replayTenantEvents(threeKingdomsBanqiTenant, events.slice(0, 2)).state;
  assert.deepEqual(
    await evaluateThreeKingdomsBanqiPosition(black, events.slice(0, 2), async () => ({
      cp: null,
      mate: 3,
      best: 'a1a1',
      depth: 1,
    })),
    { cp: null, mate: -3, best: 'a1a1' },
  );
  const terminal = replayTenantEvents(threeKingdomsBanqiTenant, finished).state;
  assert.deepEqual(
    await evaluateThreeKingdomsBanqiPosition(terminal, finished, async () => {
      throw new Error('terminal position must not query engine');
    }),
    { cp: 30_000, mate: null, best: null },
  );
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
    analyzeThreeKingdomsBanqiPostgame(
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
  const result = await analyzeThreeKingdomsBanqiPostgame(
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
    analyzeThreeKingdomsBanqiPostgame([{ ...created, setup: undefined }], score),
    /missing_deal/,
  );
});

test('cache reads never compute; concurrent requests coalesce and reload uses cache', async () => {
  let stored: SweepPlyEval[] | null = null;
  let saves = 0;
  const cache: ThreeKingdomsBanqiAnalysisCache = {
    get: async () => stored,
    save: async (_room, _engine, _depth, plies) => {
      saves += 1;
      stored = plies;
    },
  };
  let calls = 0;
  const analyze = async () => {
    calls += 1;
    return analyzeThreeKingdomsBanqiPostgame(events.slice(0, 3), score);
  };
  assert.equal(await resolveThreeKingdomsBanqiAnalysis(ROOM, events, cache, analyze, false), null);
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([
    resolveThreeKingdomsBanqiAnalysis(ROOM, events, cache, analyze),
    resolveThreeKingdomsBanqiAnalysis(ROOM, events, cache, analyze),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal(saves, 1);
  assert.deepEqual(await resolveThreeKingdomsBanqiAnalysis(ROOM, events, cache, analyze, false), a);
  assert.equal(calls, 1);
});

test('an all-null engine sweep is rejected and never cached', async () => {
  let saves = 0;
  const cache: ThreeKingdomsBanqiAnalysisCache = {
    get: async () => null,
    save: async () => {
      saves += 1;
    },
  };
  await assert.rejects(
    resolveThreeKingdomsBanqiAnalysis('tkb_vacuous', events, cache, (log) =>
      analyzeThreeKingdomsBanqiPostgame(log, async () => ({
        cp: null,
        mate: null,
        best: 'a1a1',
        depth: 1,
      })),
    ),
    VacuousAnalysisError,
  );
  assert.equal(saves, 0);
});
