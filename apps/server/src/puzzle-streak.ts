import { randomUUID } from 'node:crypto';
import type { XiangqiMove } from '@mistboard/game';
import { getPool, isInitialized } from './persistence-db.js';

// Fixed rungs, independent of the solver's rating. Pick the nearest available
// rating at each rung, never going backwards or repeating a puzzle. Sparse
// corpora can jump a rung; once no harder puzzles remain the run is complete.
export function orderedPuzzleRamp<T extends { id: string; rating: number }>(pool: T[]): T[] {
  const remaining = [...pool].sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
  const ramp: T[] = [];
  let floor = -Infinity;
  for (let rung = 0; remaining.length; rung++) {
    const target = 800 + rung * 50;
    let pick = -1;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i]!;
      if (p.rating < floor) continue;
      if (pick < 0 || Math.abs(p.rating - target) < Math.abs(remaining[pick]!.rating - target)) {
        pick = i;
      }
    }
    if (pick < 0) break;
    const [puzzle] = remaining.splice(pick, 1);
    ramp.push(puzzle!);
    floor = puzzle!.rating;
  }
  return ramp;
}

// A run's own sequence. The pool, easiest first, is cut into about ten
// difficulty steps; each run plays the steps in order and shuffles inside
// each one, so two runs do not replay one fixed list. A puzzle from the
// player's recent runs (`avoid`) moves to the end of the next step, so a new
// run opens on puzzles not met yet where the pool has them, at the cost of
// one step of the climb. Every puzzle is still in the run once.
const RAMP_STEPS = 10;
const MIN_STEP_SIZE = 3;
export function shuffledPuzzleRamp<T extends { id: string; rating: number }>(
  pool: readonly T[],
  opts: { avoid?: ReadonlySet<string>; random?: () => number } = {},
): T[] {
  const avoid = opts.avoid ?? new Set<string>();
  const random = opts.random ?? Math.random;
  const shuffle = (items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };
  const sorted = [...pool].sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
  const size = Math.max(MIN_STEP_SIZE, Math.ceil(sorted.length / RAMP_STEPS));
  const ramp: T[] = [];
  let deferred: T[] = [];
  for (let at = 0; at < sorted.length; at += size) {
    const step = sorted.slice(at, at + size);
    ramp.push(...shuffle(step.filter((p) => !avoid.has(p.id))), ...shuffle(deferred));
    deferred = step.filter((p) => avoid.has(p.id));
  }
  ramp.push(...shuffle(deferred));
  return ramp;
}

export type StreakResult = { id: string; outcome: 'solved' | 'skipped' | 'failed' };
export type StreakState = {
  ids: string[];
  score: number;
  skipUsed: boolean;
  finished: boolean;
  moves: XiangqiMove[];
  results: StreakResult[];
};
export type StreakRun = { id: string; userId: string | null; version: number; state: StreakState };

// The persistence-off development server still supports anonymous runs. Prod
// keeps the same state in Postgres, surviving deployments. Version checks make
// overlapping clicks/retries count at most once, also across server processes.
const memoryRuns = new Map<string, StreakRun>();

export async function startPuzzleStreak(ids: string[], userId: string | null): Promise<StreakRun> {
  const run: StreakRun = {
    id: randomUUID(),
    userId,
    version: 0,
    state: { ids, score: 0, skipUsed: false, finished: ids.length === 0, moves: [], results: [] },
  };
  if (isInitialized()) {
    await getPool().query(
      'INSERT INTO puzzle_streak_runs (id, user_id, state) VALUES ($1, $2, $3::jsonb)',
      [run.id, userId, JSON.stringify(run.state)],
    );
  } else {
    if (memoryRuns.size >= 1000) memoryRuns.delete(memoryRuns.keys().next().value!);
    memoryRuns.set(run.id, structuredClone(run));
  }
  return run;
}

export async function loadPuzzleStreak(id: string): Promise<StreakRun | null> {
  if (!isInitialized()) return structuredClone(memoryRuns.get(id) ?? null);
  const result = await getPool().query<{
    user_id: string | null;
    version: number;
    state: StreakState;
  }>('SELECT user_id, version, state FROM puzzle_streak_runs WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? { id, userId: row.user_id, version: row.version, state: row.state } : null;
}

export async function savePuzzleStreak(run: StreakRun): Promise<boolean> {
  if (!isInitialized()) {
    if (memoryRuns.get(run.id)?.version !== run.version) return false;
    memoryRuns.set(run.id, structuredClone({ ...run, version: run.version + 1 }));
    return true;
  }
  const result = await getPool().query(
    `UPDATE puzzle_streak_runs SET state = $2::jsonb, version = version + 1
     WHERE id = $1 AND version = $3`,
    [run.id, JSON.stringify(run.state), run.version],
  );
  return result.rowCount === 1;
}

// The puzzles a signed-in player met in their last few runs (only those
// reached, not the rest of each run's list), for the next run to avoid.
export async function recentStreakPuzzleIds(userId: string | null, runs = 5): Promise<Set<string>> {
  if (!userId) return new Set();
  if (!isInitialized()) {
    const owned = [...memoryRuns.values()].filter((r) => r.userId === userId).slice(-runs);
    return new Set(owned.flatMap((r) => r.state.results.map((result) => result.id)));
  }
  const result = await getPool().query<{ id: string }>(
    `SELECT DISTINCT r.value->>'id' AS id
     FROM (SELECT state FROM puzzle_streak_runs WHERE user_id = $1
           ORDER BY created_at DESC LIMIT $2) recent,
     LATERAL jsonb_array_elements(recent.state->'results') AS r(value)`,
    [userId, runs],
  );
  return new Set(result.rows.map((row) => row.id));
}

export async function bestPuzzleStreak(userId: string | null): Promise<number | null> {
  if (!userId) return null;
  if (!isInitialized()) {
    return Math.max(
      0,
      ...[...memoryRuns.values()].filter((r) => r.userId === userId).map((r) => r.state.score),
    );
  }
  const result = await getPool().query<{ best: number }>(
    `SELECT COALESCE(MAX((state->>'score')::integer), 0) AS best
     FROM puzzle_streak_runs WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0]!.best;
}
