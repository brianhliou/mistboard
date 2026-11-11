import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { XiangqiMove } from '@mistboard/game';
import { VacuousAnalysisError } from './../game-analysis-sweep.js';
import { type PlyEval, XIANGQI_ANALYSIS_ENGINE_ID } from './../xiangqi-analysis.js';
import { XIANGQI_DEFAULT_ENGINE_ID } from './../xiangqi-pikafish-engine.js';
import {
  analyzeXiangqiPostgame,
  resolveXiangqiAnalysis,
  type XiangqiAnalysisCache,
} from './xiangqi-games.js';

// In-memory cache double + an analyze spy, so the resolver's cache/coalesce
// logic is exercised without Postgres or a real engine.
function memoryCache(): XiangqiAnalysisCache & { saved: number } {
  const store = new Map<string, PlyEval[]>();
  const cache = {
    saved: 0,
    get: async (roomId: string, engineId: string, depth: number) =>
      store.get(`${roomId}:${engineId}:${depth}`) ?? null,
    save: async (roomId: string, engineId: string, depth: number, plies: PlyEval[]) => {
      cache.saved += 1;
      store.set(`${roomId}:${engineId}:${depth}`, plies);
    },
  };
  return cache;
}

const onePly = async (moves: string[]): Promise<PlyEval[]> =>
  moves.map((_, i) => ({ ply: i + 1, cp: 0, mate: null, best: null }));

const oneMovePayload: { timeline: { type: string; move?: XiangqiMove }[] } = {
  timeline: [{ type: 'move-played', move: { from: 'h3', to: 'e3' } }],
};

test('analyzeXiangqiPostgame extracts moves, converts to Pikafish UCI, runs the job', async () => {
  let seen: string[] = [];
  const result = await analyzeXiangqiPostgame(
    {
      timeline: [
        { type: 'move-played', move: { from: 'h3', to: 'e3' } },
        { type: 'clock-expired' }, // non-move terminal, skipped
        { type: 'move-played', move: { from: 'h10', to: 'g8' } },
      ],
    },
    async (moves) => {
      seen = moves;
      return moves.map((_, i) => ({ ply: i + 1, cp: 0, mate: null, best: null }));
    },
  );
  // Pikafish rank-1 shift applied; the non-move entry is dropped.
  assert.deepEqual(seen, ['h2e2', 'h9g7']);
  assert.equal(result.plies.length, 2);
  assert.equal(result.engineId.length > 0, true);
  assert.equal(result.depth, 12);
});

test('analysis rows carry the dedicated versioned id, never the PvE bot id', async () => {
  // Regression for #169: caching under XIANGQI_DEFAULT_ENGINE_ID orphaned every
  // stored analysis when the PvE ladder renamed its default. The cache id must be
  // the dedicated versioned analysis id (the sibling-variant pattern).
  assert.match(XIANGQI_ANALYSIS_ENGINE_ID, /^pikafish-xiangqi-analysis@\d+$/);
  assert.notEqual(XIANGQI_ANALYSIS_ENGINE_ID, XIANGQI_DEFAULT_ENGINE_ID);
  const result = await analyzeXiangqiPostgame(oneMovePayload, onePly);
  assert.equal(result.engineId, XIANGQI_ANALYSIS_ENGINE_ID);
  // The resolver keys the cache under the same id.
  const cache = memoryCache();
  const resolved = await resolveXiangqiAnalysis('room-id-pin', oneMovePayload, cache, onePly);
  assert.equal(resolved?.engineId, XIANGQI_ANALYSIS_ENGINE_ID);
  const hit = await cache.get('room-id-pin', XIANGQI_ANALYSIS_ENGINE_ID, 12);
  assert.ok(hit, 'the row is stored under the versioned analysis id');
});

test('resolveXiangqiAnalysis fails closed on a scoreless (vacuous) sweep', async () => {
  const cache = memoryCache();
  // Every ply carries neither cp nor mate: the engine produced moves but no score.
  const vacuous = async (moves: string[]): Promise<PlyEval[]> =>
    moves.map((_, i) => ({ ply: i + 1, cp: null, mate: null, best: 'h2e2' }));
  await assert.rejects(
    resolveXiangqiAnalysis('room-vacuous', oneMovePayload, cache, vacuous),
    VacuousAnalysisError,
  );
  assert.equal(cache.saved, 0, 'a vacuous sweep is never cached');
  // The in-flight key is cleared, so a later (fixed-engine) pass recomputes fine.
  const recovered = await resolveXiangqiAnalysis('room-vacuous', oneMovePayload, cache, onePly);
  assert.ok(recovered);
  assert.equal(cache.saved, 1, 'the recomputed sweep persists');
});

test('resolveXiangqiAnalysis serves a cache hit without touching the engine', async () => {
  const cache = memoryCache();
  // Populate via a miss, then assert the follow-up hit never calls analyze.
  const seeded = await resolveXiangqiAnalysis('room-hit', oneMovePayload, cache, onePly);
  let analyzed = false;
  const result = await resolveXiangqiAnalysis('room-hit', oneMovePayload, cache, async (moves) => {
    analyzed = true;
    return onePly(moves);
  });
  assert.equal(analyzed, false, 'cache hit must not run the engine');
  assert.ok(seeded && result);
  assert.deepEqual(result.plies, seeded.plies);
});

test('resolveXiangqiAnalysis computes + persists on a cache miss', async () => {
  const cache = memoryCache();
  const result = await resolveXiangqiAnalysis('room-miss', oneMovePayload, cache, onePly);
  assert.ok(result);
  assert.equal(result.plies.length, 1);
  assert.equal(cache.saved, 1, 'a miss persists exactly once');
  // Second call is now a hit: no new save.
  await resolveXiangqiAnalysis('room-miss', oneMovePayload, cache, onePly);
  assert.equal(cache.saved, 1, 'the second call is a cache hit');
});

test('resolveXiangqiAnalysis with computeIfMissing=false is a pure cache read', async () => {
  const cache = memoryCache();
  let analyzed = false;
  const spy = async (moves: string[]) => {
    analyzed = true;
    return onePly(moves);
  };
  // Miss + no-compute → null, engine untouched.
  const miss = await resolveXiangqiAnalysis('room-ro', oneMovePayload, cache, spy, false);
  assert.equal(miss, null, 'cache-only read returns null on a miss');
  assert.equal(analyzed, false, 'cache-only read never runs the engine');
  // Populate, then the cache-only read returns it.
  await resolveXiangqiAnalysis('room-ro', oneMovePayload, cache, onePly);
  const hit = await resolveXiangqiAnalysis('room-ro', oneMovePayload, cache, spy, false);
  assert.ok(hit);
  assert.equal(hit.plies.length, 1);
});

test('resolveXiangqiAnalysis coalesces concurrent misses into one compute', async () => {
  const cache = memoryCache();
  let computes = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slowAnalyze = async (moves: string[]): Promise<PlyEval[]> => {
    computes += 1;
    await gate; // hold both callers in-flight together
    return onePly(moves);
  };
  const a = resolveXiangqiAnalysis('room-coalesce', oneMovePayload, cache, slowAnalyze);
  const b = resolveXiangqiAnalysis('room-coalesce', oneMovePayload, cache, slowAnalyze);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(computes, 1, 'concurrent callers share one engine pass');
  assert.equal(cache.saved, 1, 'and one save');
  assert.ok(ra && rb);
  assert.deepEqual(ra.plies, rb.plies);
});

test('CC0 @6 recomputes on demand while retaining the historical @5 cache row', async () => {
  const cache = memoryCache();
  const old: PlyEval[] = [{ ply: 1, cp: 999, mate: null, best: null }];
  const room = 'room-cc0-invalidation';
  await cache.save(room, 'pikafish-xiangqi-analysis@5', 12, old);
  let calls = 0;
  const analyze = async (moves: string[]) => {
    calls += 1;
    return onePly(moves);
  };
  assert.equal(await resolveXiangqiAnalysis(room, oneMovePayload, cache, analyze, false), null);
  assert.equal(calls, 0, 'GET must not start an engine pass');
  const fresh = await resolveXiangqiAnalysis(room, oneMovePayload, cache, analyze);
  assert.equal(fresh?.engineId, 'pikafish-xiangqi-analysis@6');
  assert.equal(calls, 1);
  assert.deepEqual(await cache.get(room, 'pikafish-xiangqi-analysis@5', 12), old);
  assert.deepEqual(await cache.get(room, 'pikafish-xiangqi-analysis@6', 12), fresh?.plies);
  assert.deepEqual(await resolveXiangqiAnalysis(room, oneMovePayload, cache, analyze), fresh);
  assert.equal(calls, 1, 'subsequent @6 requests reuse the fresh row');
});
