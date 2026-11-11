import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withAnalysisJobProgress } from './analysis-job-progress.js';
import {
  type GameAnalysisCacheOps,
  inflightComputationCount,
  liveAnalysisProgressStore,
  mapWithConcurrency,
  resolveCachedComputation,
} from './game-analysis-kernel.js';

function memoryCache<T>(): GameAnalysisCacheOps<T> & { saves: number } {
  const store = new Map<string, T>();
  const cache = {
    saves: 0,
    async get(roomId: string, engineId: string, depth: number) {
      return store.get(`${roomId}:${engineId}:${depth}`) ?? null;
    },
    async save(roomId: string, engineId: string, depth: number, value: T) {
      cache.saves += 1;
      store.set(`${roomId}:${engineId}:${depth}`, value);
    },
  };
  return cache;
}

let keySeq = 0;
// Unique engine id per test so the process-wide in-flight registry never
// cross-talks between cases.
function uniqueEngineId(): string {
  keySeq += 1;
  return `kernel-test-engine@${keySeq}`;
}

test('resolveCachedComputation serves a cache hit without computing', async () => {
  const cache = memoryCache<number[]>();
  const engineId = uniqueEngineId();
  await cache.save('room', engineId, 12, [1, 2, 3]);
  let computes = 0;
  const result = await resolveCachedComputation<number[]>({
    roomId: 'room',
    engineId,
    depth: 12,
    cache,
    computeIfMissing: true,
    compute: async () => {
      computes += 1;
      return [9];
    },
  });
  assert.deepEqual(result, [1, 2, 3]);
  assert.equal(computes, 0);
});

test('resolveCachedComputation with computeIfMissing=false is a pure cache read', async () => {
  const cache = memoryCache<number[]>();
  let computes = 0;
  const result = await resolveCachedComputation<number[]>({
    roomId: 'room',
    engineId: uniqueEngineId(),
    depth: 12,
    cache,
    computeIfMissing: false,
    compute: async () => {
      computes += 1;
      return [9];
    },
  });
  assert.equal(result, null);
  assert.equal(computes, 0);
  assert.equal(cache.saves, 0);
});

test('resolveCachedComputation computes once, persists, then serves from cache', async () => {
  const cache = memoryCache<number[]>();
  const engineId = uniqueEngineId();
  let computes = 0;
  const args = {
    roomId: 'room',
    engineId,
    depth: 12,
    cache,
    computeIfMissing: true,
    compute: async () => {
      computes += 1;
      return [7];
    },
  };
  const first = await resolveCachedComputation(args);
  assert.deepEqual(first, [7]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
  const second = await resolveCachedComputation(args);
  assert.deepEqual(second, [7]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
});

test('resolveCachedComputation coalesces concurrent callers into one compute', async () => {
  const cache = memoryCache<number[]>();
  const engineId = uniqueEngineId();
  let computes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const args = {
    roomId: 'room',
    engineId,
    depth: 12,
    cache,
    computeIfMissing: true,
    compute: async () => {
      computes += 1;
      await gate;
      return [5];
    },
  };
  const a = resolveCachedComputation(args);
  const b = resolveCachedComputation(args);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(computes, 1);
  assert.equal(cache.saves, 1);
  assert.deepEqual(ra, rb);
});

test('resolveCachedComputation validate hook fails closed: nothing cached, key cleared', async () => {
  const cache = memoryCache<number[]>();
  const engineId = uniqueEngineId();
  class Vacuous extends Error {}
  await assert.rejects(
    resolveCachedComputation<number[]>({
      roomId: 'room',
      engineId,
      depth: 12,
      cache,
      computeIfMissing: true,
      compute: async () => [0],
      validate: () => {
        throw new Vacuous('vacuous');
      },
    }),
    Vacuous,
  );
  assert.equal(cache.saves, 0);
  assert.equal(inflightComputationCount(), 0);
  // A later (fixed) compute succeeds — the key was not wedged.
  const recovered = await resolveCachedComputation<number[]>({
    roomId: 'room',
    engineId,
    depth: 12,
    cache,
    computeIfMissing: true,
    compute: async () => [1],
  });
  assert.deepEqual(recovered, [1]);
  assert.equal(cache.saves, 1);
});

test('resolveCachedComputation clears the in-flight key when compute rejects', async () => {
  const cache = memoryCache<number[]>();
  const engineId = uniqueEngineId();
  await assert.rejects(
    resolveCachedComputation<number[]>({
      roomId: 'room',
      engineId,
      depth: 12,
      cache,
      computeIfMissing: true,
      compute: async () => {
        throw new Error('engine died');
      },
    }),
    /engine died/,
  );
  assert.equal(inflightComputationCount(), 0);
});

test('resolveCachedComputation keys on (room, engine, depth) — no cross-talk', async () => {
  const cache = memoryCache<number[]>();
  const engineId = uniqueEngineId();
  const compute = (value: number) => async () => [value];
  const a = await resolveCachedComputation({
    roomId: 'room-a',
    engineId,
    depth: 12,
    cache,
    computeIfMissing: true,
    compute: compute(1),
  });
  const b = await resolveCachedComputation({
    roomId: 'room-a',
    engineId,
    depth: 10,
    cache,
    computeIfMissing: true,
    compute: compute(2),
  });
  const c = await resolveCachedComputation({
    roomId: 'room-b',
    engineId,
    depth: 12,
    cache,
    computeIfMissing: true,
    compute: compute(3),
  });
  assert.deepEqual([a, b, c], [[1], [2], [3]]);
  assert.equal(cache.saves, 3);
});

test('mapWithConcurrency preserves order and caps in-flight calls', async () => {
  const items = [0, 1, 2, 3, 4, 5, 6];
  let inFlight = 0;
  let peak = 0;
  const results = await mapWithConcurrency(items, 2, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return item * 10;
  });
  assert.deepEqual(
    results,
    items.map((i) => i * 10),
  );
  assert.ok(peak <= 2, `peak in-flight ${peak} must be <= 2`);
});

test('mapWithConcurrency rejects when any call rejects', async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('boom');
      return item;
    }),
    /boom/,
  );
});

test('mapWithConcurrency handles empty input and clamps concurrency to >= 1', async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async (x) => x), []);
  assert.deepEqual(await mapWithConcurrency([1, 2], 0, async (x) => x), [1, 2]);
});

test('checkpoint observation carries only cursor counts and is scoped to the async computation', async () => {
  const seen: unknown[] = [];
  const store = liveAnalysisProgressStore('numeric-progress', 'test', 1);
  await withAnalysisJobProgress(
    (update) => seen.push(update),
    async () => {
      await store.save({ nextIndex: 2, items: [{ hiddenDeal: 'do-not-expose' }] });
      await new Promise((resolve) => setImmediate(resolve));
      await store.save({ nextIndex: 3, items: [] });
    },
  );
  await store.save({ nextIndex: 4, items: [] });
  assert.deepEqual(seen, [{ completed: 2 }, { completed: 3 }]);
  assert.doesNotMatch(JSON.stringify(seen), /hiddenDeal|do-not-expose|items/);
});
