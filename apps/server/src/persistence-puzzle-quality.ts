import type pg from 'pg';
import { getPool, isInitialized } from './persistence-db.js';

export type PuzzleQualityEvent =
  | 'view'
  | 'start'
  | 'wrong'
  | 'solve'
  | 'hint'
  | 'reveal'
  | 'abandon';

export type PuzzleQualityVote = 'up' | 'down' | null;

export type PuzzleQualityAggregate = {
  puzzleId: string;
  variant: string;
  sourceKind: string;
  miningCandidateId: string | null;
  miningRunId: string | null;
  sessions: number;
  starts: number;
  solves: number;
  cleanSolves: number;
  reveals: number;
  abandons: number;
  inProgress: number;
  wrongAttempts: number;
  hints: number;
  votesUp: number;
  votesDown: number;
  averageCompletionSeconds: number | null;
  signedInAttempts: number;
  signedInSolves: number;
  rating: number | null;
  ratingDeviation: number | null;
};

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPuzzleQualitySessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export async function recordPuzzleQualityEvent(input: {
  puzzleId: string;
  sessionId: string;
  variant: string;
  event: PuzzleQualityEvent;
}): Promise<void> {
  if (!isInitialized()) return;
  if (!isPuzzleQualitySessionId(input.sessionId)) {
    throw new Error('invalid puzzle quality session id');
  }
  const pool = getPool();
  await ensureSession(pool, input);
  switch (input.event) {
    case 'view':
      return;
    case 'start':
      await pool.query(
        `UPDATE puzzle_quality_sessions
         SET started_at = COALESCE(started_at, now()), updated_at = now()
         WHERE puzzle_id = $1 AND session_id = $2::uuid`,
        [input.puzzleId, input.sessionId],
      );
      return;
    case 'wrong':
      await pool.query(
        `UPDATE puzzle_quality_sessions
         SET started_at = COALESCE(started_at, now()),
             wrong_attempts = wrong_attempts + 1,
             updated_at = now()
         WHERE puzzle_id = $1 AND session_id = $2::uuid AND outcome IS NULL`,
        [input.puzzleId, input.sessionId],
      );
      return;
    case 'solve':
      await pool.query(
        `UPDATE puzzle_quality_sessions
         SET started_at = COALESCE(started_at, now()), outcome = 'solved',
             completed_at = COALESCE(completed_at, now()), updated_at = now()
         WHERE puzzle_id = $1 AND session_id = $2::uuid AND outcome IS NULL`,
        [input.puzzleId, input.sessionId],
      );
      return;
    case 'hint':
      await pool.query(
        `UPDATE puzzle_quality_sessions
         SET started_at = COALESCE(started_at, now()), hint_count = hint_count + 1,
             updated_at = now()
         WHERE puzzle_id = $1 AND session_id = $2::uuid AND outcome IS NULL`,
        [input.puzzleId, input.sessionId],
      );
      return;
    case 'reveal':
      await pool.query(
        `UPDATE puzzle_quality_sessions
         SET started_at = COALESCE(started_at, now()), outcome = 'revealed',
             completed_at = COALESCE(completed_at, now()), updated_at = now()
         WHERE puzzle_id = $1 AND session_id = $2::uuid AND outcome IS NULL`,
        [input.puzzleId, input.sessionId],
      );
      return;
    case 'abandon':
      await pool.query(
        `UPDATE puzzle_quality_sessions
         SET outcome = 'abandoned', completed_at = COALESCE(completed_at, now()),
             updated_at = now()
         WHERE puzzle_id = $1 AND session_id = $2::uuid AND outcome IS NULL`,
        [input.puzzleId, input.sessionId],
      );
      return;
  }
}

export async function recordPuzzleQualityVote(input: {
  puzzleId: string;
  sessionId: string;
  variant: string;
  vote: PuzzleQualityVote;
}): Promise<void> {
  if (!isInitialized()) return;
  if (!isPuzzleQualitySessionId(input.sessionId)) {
    throw new Error('invalid puzzle quality session id');
  }
  const pool = getPool();
  await ensureSession(pool, input);
  await pool.query(
    `UPDATE puzzle_quality_sessions
     SET vote = $3, updated_at = now()
     WHERE puzzle_id = $1 AND session_id = $2::uuid`,
    [input.puzzleId, input.sessionId, input.vote === 'up' ? 1 : input.vote === 'down' ? -1 : null],
  );
}

async function ensureSession(
  db: Queryable,
  input: { puzzleId: string; sessionId: string; variant: string },
): Promise<void> {
  await db.query(
    `INSERT INTO puzzle_quality_sessions (puzzle_id, session_id, variant)
     VALUES ($1, $2::uuid, $3)
     ON CONFLICT (puzzle_id, session_id) DO NOTHING`,
    [input.puzzleId, input.sessionId, input.variant],
  );
}

/**
 * A terminal session shorter than this was not a person reading a position:
 * it is an API loop or a browser smoke. Ten such reveals, all from one
 * embed-testing session on 2026-09-08, flagged that day's daily as high-reveal
 * and pinned the readout at ACTION with no way for humans to outvote them.
 * Sessions under the floor never reach any rate the quality gate reads.
 */
export const MIN_HUMAN_SESSION_SECONDS = 2;

export async function listPuzzleQualityAggregates(
  db: Queryable,
  variant: string,
): Promise<PuzzleQualityAggregate[]> {
  const { rows } = await db.query<{
    puzzle_id: string;
    variant: string;
    source_kind: string;
    mining_candidate_id: string | null;
    mining_run_id: string | null;
    sessions: number;
    starts: number;
    solves: number;
    clean_solves: number;
    reveals: number;
    abandons: number;
    in_progress: number;
    wrong_attempts: number;
    hints: number;
    votes_up: number;
    votes_down: number;
    average_completion_seconds: number | null;
    signed_in_attempts: number;
    signed_in_solves: number;
    rating: number | null;
    rating_deviation: number | null;
  }>(
    `WITH quality AS (
       SELECT puzzle_id,
              count(*)::int AS sessions,
              count(*) FILTER (WHERE started_at IS NOT NULL)::int AS starts,
              count(*) FILTER (WHERE outcome = 'solved')::int AS solves,
              count(*) FILTER (
                WHERE outcome = 'solved' AND wrong_attempts = 0 AND hint_count = 0
              )::int AS clean_solves,
              count(*) FILTER (WHERE outcome = 'revealed')::int AS reveals,
              count(*) FILTER (WHERE outcome = 'abandoned')::int AS abandons,
              count(*) FILTER (WHERE outcome IS NULL)::int AS in_progress,
              COALESCE(sum(wrong_attempts), 0)::int AS wrong_attempts,
              COALESCE(sum(hint_count), 0)::int AS hints,
              count(*) FILTER (WHERE vote = 1)::int AS votes_up,
              count(*) FILTER (WHERE vote = -1)::int AS votes_down,
              avg(EXTRACT(epoch FROM (completed_at - viewed_at)))
                FILTER (WHERE completed_at IS NOT NULL) AS average_completion_seconds
       FROM puzzle_quality_sessions
       WHERE completed_at IS NULL
          OR completed_at - viewed_at >= make_interval(secs => $2)
       GROUP BY puzzle_id
     ), attempts AS (
       SELECT puzzle_id, count(*)::int AS attempts,
              count(*) FILTER (WHERE solved)::int AS solves
       FROM puzzle_attempts
       GROUP BY puzzle_id
     )
     SELECT puzzle.id AS puzzle_id, puzzle.variant, puzzle.source_kind,
            puzzle.mining_candidate_id, candidate.run_id AS mining_run_id,
            COALESCE(quality.sessions, 0)::int AS sessions,
            COALESCE(quality.starts, 0)::int AS starts,
            COALESCE(quality.solves, 0)::int AS solves,
            COALESCE(quality.clean_solves, 0)::int AS clean_solves,
            COALESCE(quality.reveals, 0)::int AS reveals,
            COALESCE(quality.abandons, 0)::int AS abandons,
            COALESCE(quality.in_progress, 0)::int AS in_progress,
            COALESCE(quality.wrong_attempts, 0)::int AS wrong_attempts,
            COALESCE(quality.hints, 0)::int AS hints,
            COALESCE(quality.votes_up, 0)::int AS votes_up,
            COALESCE(quality.votes_down, 0)::int AS votes_down,
            quality.average_completion_seconds::double precision,
            COALESCE(attempts.attempts, 0)::int AS signed_in_attempts,
            COALESCE(attempts.solves, 0)::int AS signed_in_solves,
            rating.rating, rating.rating_deviation
     FROM puzzles puzzle
     LEFT JOIN quality ON quality.puzzle_id = puzzle.id
     LEFT JOIN attempts ON attempts.puzzle_id = puzzle.id
     LEFT JOIN puzzle_ratings rating ON rating.puzzle_id = puzzle.id
     LEFT JOIN xiangqi_puzzle_mining_candidates candidate
       ON candidate.id = puzzle.mining_candidate_id
     WHERE puzzle.variant = $1
     ORDER BY puzzle.seq, puzzle.id`,
    [variant, MIN_HUMAN_SESSION_SECONDS],
  );
  return rows.map((row) => ({
    puzzleId: row.puzzle_id,
    variant: row.variant,
    sourceKind: row.source_kind,
    miningCandidateId: row.mining_candidate_id,
    miningRunId: row.mining_run_id,
    sessions: row.sessions,
    starts: row.starts,
    solves: row.solves,
    cleanSolves: row.clean_solves,
    reveals: row.reveals,
    abandons: row.abandons,
    inProgress: row.in_progress,
    wrongAttempts: row.wrong_attempts,
    hints: row.hints,
    votesUp: row.votes_up,
    votesDown: row.votes_down,
    averageCompletionSeconds: row.average_completion_seconds,
    signedInAttempts: row.signed_in_attempts,
    signedInSolves: row.signed_in_solves,
    rating: row.rating,
    ratingDeviation: row.rating_deviation,
  }));
}
