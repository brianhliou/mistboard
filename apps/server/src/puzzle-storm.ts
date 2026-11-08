import { randomUUID } from 'node:crypto';
import type { XiangqiMove } from '@mistboard/game';
import { getPool, isInitialized, withTransaction } from './persistence-db.js';

export const STORM_DURATION_MS = 180_000;
export const STORM_PENALTY_MS = 10_000;

// Consecutive correct solver moves, including moves within a puzzle. Scripted
// replies do not count. After 30, every ten moves earns another ten seconds.
export function stormComboBonusMs(combo: number): number {
  if (combo === 5) return 3_000;
  if (combo === 12) return 5_000;
  if (combo === 20) return 7_000;
  return combo >= 30 && combo % 10 === 0 ? 10_000 : 0;
}

export type StormState = {
  ids: string[];
  startedAt: number | null;
  deadlineAt: number | null;
  score: number;
  combo: number;
  finished: boolean;
  moves: XiangqiMove[];
  results: { id: string; outcome: 'solved' | 'failed' }[];
};
export type StormRun = {
  id: string;
  userId: string | null;
  // UTC day at the start of the run; a run crossing midnight stays on this day.
  day: string;
  version: number;
  state: StormState;
};

export function stormRemainingMs(state: StormState, now: number): number {
  if (state.finished) return 0;
  return state.deadlineAt === null ? STORM_DURATION_MS : Math.max(0, state.deadlineAt - now);
}

export function expirePuzzleStorm(state: StormState, now: number): boolean {
  if (state.finished || state.deadlineAt === null || now < state.deadlineAt) return false;
  state.finished = true;
  return true;
}

// Called only after the server grades the move. Returning false means no move
// was accepted (including a move arriving exactly at the deadline).
export function advancePuzzleStorm(
  state: StormState,
  move: XiangqiMove,
  outcome: 'correct' | 'solved' | 'failed',
  now: number,
): boolean {
  expirePuzzleStorm(state, now);
  if (state.finished) return false;
  if (state.deadlineAt === null) {
    state.startedAt = now;
    state.deadlineAt = now + STORM_DURATION_MS;
  }
  const id = state.ids[state.results.length]!;
  if (outcome === 'failed') {
    state.deadlineAt -= STORM_PENALTY_MS;
    state.combo = 0;
  } else {
    state.combo++;
    state.deadlineAt += stormComboBonusMs(state.combo);
  }
  if (outcome === 'correct') {
    state.moves.push(move);
  } else {
    if (outcome === 'solved') state.score++;
    state.results.push({ id, outcome });
    state.moves = [];
  }
  state.finished = state.results.length >= state.ids.length || now >= state.deadlineAt;
  return true;
}

const memoryRuns = new Map<string, StormRun>();
const memoryBests = new Map<string, Map<string, number>>();

export async function startPuzzleStorm(
  ids: string[],
  userId: string | null,
  now = Date.now(),
): Promise<StormRun> {
  const run: StormRun = {
    id: randomUUID(),
    userId,
    day: new Date(now).toISOString().slice(0, 10),
    version: 0,
    state: {
      ids: [...ids],
      startedAt: null,
      deadlineAt: null,
      score: 0,
      combo: 0,
      finished: ids.length === 0,
      moves: [],
      results: [],
    },
  };
  if (isInitialized()) {
    await getPool().query(
      'INSERT INTO puzzle_storm_runs (id, user_id, day, state) VALUES ($1, $2, $3::date, $4::jsonb)',
      [run.id, userId, run.day, JSON.stringify(run.state)],
    );
  } else {
    if (memoryRuns.size >= 1000) memoryRuns.delete(memoryRuns.keys().next().value!);
    memoryRuns.set(run.id, structuredClone(run));
  }
  return run;
}

export async function loadPuzzleStorm(id: string): Promise<StormRun | null> {
  if (!isInitialized()) return structuredClone(memoryRuns.get(id) ?? null);
  const result = await getPool().query<{
    user_id: string | null;
    day: string;
    version: number;
    state: StormState;
  }>(
    `SELECT user_id, to_char(day, 'YYYY-MM-DD') AS day, version, state
     FROM puzzle_storm_runs WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row
    ? { id, userId: row.user_id, day: row.day, version: row.version, state: row.state }
    : null;
}

// The score and daily best commit together. A stale submit cannot write either;
// GREATEST also prevents a lower or repeated run from lowering the saved best.
export async function savePuzzleStorm(run: StormRun): Promise<boolean> {
  if (!isInitialized()) {
    if (memoryRuns.get(run.id)?.version !== run.version) return false;
    memoryRuns.set(run.id, structuredClone({ ...run, version: run.version + 1 }));
    if (run.userId) {
      const days = memoryBests.get(run.userId) ?? new Map<string, number>();
      days.set(run.day, Math.max(days.get(run.day) ?? 0, run.state.score));
      memoryBests.set(run.userId, days);
    }
  } else {
    const saved = await withTransaction(async (client) => {
      const result = await client.query<{ user_id: string | null; day: string }>(
        `UPDATE puzzle_storm_runs SET state = $2::jsonb, version = version + 1
         WHERE id = $1 AND version = $3
         RETURNING user_id, to_char(day, 'YYYY-MM-DD') AS day`,
        [run.id, JSON.stringify(run.state), run.version],
      );
      const row = result.rows[0];
      if (!row) return false;
      if (row.user_id) {
        await client.query(
          `INSERT INTO puzzle_storm_bests (user_id, day, score) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, day) DO UPDATE
           SET score = GREATEST(puzzle_storm_bests.score, EXCLUDED.score)`,
          [row.user_id, row.day, run.state.score],
        );
      }
      return true;
    });
    if (!saved) return false;
  }
  run.version++;
  return true;
}

export async function bestPuzzleStorm(
  userId: string | null,
  day: string,
): Promise<{ best: number | null; dailyBest: number | null }> {
  if (!userId) return { best: null, dailyBest: null };
  if (!isInitialized()) {
    const days = memoryBests.get(userId);
    return { best: Math.max(0, ...(days?.values() ?? [])), dailyBest: days?.get(day) ?? 0 };
  }
  const result = await getPool().query<{ best: number; daily_best: number }>(
    `SELECT COALESCE(MAX(score), 0) AS best,
            COALESCE(MAX(score) FILTER (WHERE day = $2::date), 0) AS daily_best
     FROM puzzle_storm_bests WHERE user_id = $1`,
    [userId, day],
  );
  return { best: result.rows[0]!.best, dailyBest: result.rows[0]!.daily_best };
}

export async function recentStormPuzzleIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  if (!isInitialized()) {
    const recent = [...memoryRuns.values()].filter((r) => r.userId === userId).slice(-5);
    return new Set(recent.flatMap((r) => r.state.results.map((result) => result.id)));
  }
  const result = await getPool().query<{ id: string }>(
    `SELECT DISTINCT r.value->>'id' AS id
     FROM (SELECT state FROM puzzle_storm_runs WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 5) recent,
     LATERAL jsonb_array_elements(recent.state->'results') AS r(value)`,
    [userId],
  );
  return new Set(result.rows.map((row) => row.id));
}
