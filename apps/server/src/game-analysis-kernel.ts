// Shared plumbing for the per-variant whole-game analysis/decisions resolvers.
//
// Every variant's resolver (banqi/jieqi/jungle/jungle-flip/fortress/xiangqi, both
// the Layer-1 eval sweep and the Layer-2 decision decomposition) had the same
// ~40-line skeleton: cache lookup keyed (room, engine, depth), in-flight
// coalescing so concurrent viewers share one compute, an optional fail-closed
// validation (the vacuous-sweep guard), and an idempotent cache write. That
// skeleton was copy-pasted 9x and each fix (e.g. #221) had to be hand-applied
// per copy. It now lives here once. The per-variant modules keep ONLY their
// math (position reconstruction, POV normalization, pool-mean decomposition)
// and their cache/engine-id constants — this kernel is plumbing, not math.

import { reportAnalysisJobProgress } from './analysis-job-progress.js';
import * as persistence from './persistence.js';

export type GameAnalysisCacheOps<T> = {
  get(roomId: string, engineId: string, depth: number): Promise<T | null>;
  save(roomId: string, engineId: string, depth: number, value: T): Promise<void>;
};

// ── Incremental progress (repo rule: persist expensive output incrementally) ──

/** A resumable computation checkpoint: `items` produced so far (in order) and
 *  the input index the next step should start from. For a plain sweep,
 *  nextIndex === items.length; for a decisions pass (which emits an item only
 *  on chance plies), nextIndex tracks the MOVE cursor independently. */
export type AnalysisProgress<T> = {
  nextIndex: number;
  items: T[];
};

export type AnalysisProgressStore<T> = {
  load(): Promise<AnalysisProgress<T> | null>;
  save(progress: AnalysisProgress<T>): Promise<void>;
};

/**
 * Persistence-backed checkpoint store for one (room, engine, depth) computation.
 * Backed by the game_analysis table under a derived `<engineId>!progress` id
 * (mutable upserts, unlike final rows); all ops no-op when persistence is
 * disabled, so memory-only dev just recomputes on failure.
 */
export function liveAnalysisProgressStore<T>(
  roomId: string,
  engineId: string,
  depth: number,
): AnalysisProgressStore<T> & { clear(): Promise<void> } {
  return {
    load: async () => {
      const progress = await persistence.getGameAnalysisProgress<AnalysisProgress<T>>(
        roomId,
        engineId,
        depth,
      );
      if (progress) reportAnalysisJobProgress({ completed: progress.nextIndex });
      return progress;
    },
    save: async (progress) => {
      await persistence.saveGameAnalysisProgress(roomId, engineId, depth, progress);
      reportAnalysisJobProgress({ completed: progress.nextIndex });
    },
    clear: () => persistence.deleteGameAnalysisProgress(roomId, engineId, depth),
  };
}

// One in-flight compute per (room, engine, depth) so concurrent viewers don't
// run a whole-game sweep twice; cleared in `finally` so a failed compute never
// wedges the key. A single process-wide registry is safe because engine ids are
// globally unique across variants and tiers — no two resolvers share a key.
const inflightComputations = new Map<string, Promise<unknown>>();

/** Visible for tests only: the number of computations currently in flight. */
export function inflightComputationCount(): number {
  return inflightComputations.size;
}

export type ResolveCachedComputationArgs<T> = {
  roomId: string;
  engineId: string;
  depth: number;
  cache: GameAnalysisCacheOps<T>;
  /** false = pure cache read (the GET/204 path): a miss returns null, never computes. */
  computeIfMissing: boolean;
  /** The expensive whole-game compute; runs at most once per key at a time. */
  compute(): Promise<T>;
  /**
   * Fail-closed hook, called on the computed value BEFORE the cache write.
   * Throw (e.g. VacuousAnalysisError) to reject the result: nothing is cached,
   * the in-flight key is cleared, and the error propagates to every coalesced
   * caller — so a fixed engine can recompute later.
   */
  validate?(value: T): void;
  /** Runs after the cache write landed (e.g. clear the incremental-progress
   *  checkpoint, which is only safe once the final row is durable). */
  afterSave?(value: T): Promise<void>;
};

/**
 * Cache-first, coalesced resolution of an expensive, immutable, per-game
 * computation. A finished game's analysis is deterministic given
 * (room, engine, depth): serve a stored result immediately, else compute once
 * (sharing one in-flight promise across concurrent callers), validate,
 * persist, and return. Returns null only on a miss with computeIfMissing=false.
 */
export async function resolveCachedComputation<T>(
  args: ResolveCachedComputationArgs<T>,
): Promise<T | null> {
  const { roomId, engineId, depth, cache, computeIfMissing } = args;

  const cached = await cache.get(roomId, engineId, depth);
  if (cached) return cached;
  if (!computeIfMissing) return null;

  const key = `${roomId}\0${engineId}\0${depth}`;
  const existing = inflightComputations.get(key);
  // The registry is heterogeneous (unknown), but a key is only ever written by
  // the resolver that owns its engine id, so the promise is a Promise<T> here.
  if (existing) return existing as Promise<T>;

  const compute = (async () => {
    const value = await args.compute();
    args.validate?.(value);
    await cache.save(roomId, engineId, depth, value);
    await args.afterSave?.(value);
    return value;
  })();
  inflightComputations.set(key, compute);
  try {
    return await compute;
  } finally {
    inflightComputations.delete(key);
  }
}

/**
 * Map `items` through an async `fn` with at most `concurrency` calls in flight,
 * preserving input order in the result. The decisions fan-outs (a pool-mean is
 * one eval per distinct hidden identity, ~14 for an early flip) used a bare
 * Promise.all into a 1-2 slot engine pool: every call past the slot count sat
 * in the pool queue burning its queue-timeout, and ONE timeout rejected the
 * whole batch. Capping launch concurrency at the pool's slot count keeps the
 * pool queue empty (headroom), so a slow eval delays the batch instead of
 * detonating it.
 */
export async function mapWithConcurrency<In, Out>(
  items: readonly In[],
  concurrency: number,
  fn: (item: In, index: number) => Promise<Out>,
): Promise<Out[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<Out>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
