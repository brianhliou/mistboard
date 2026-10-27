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
