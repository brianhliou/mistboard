// Persistence for the Glicko-2 puzzle rating pool (schema in migration 073).
//
// The rating math lives in puzzle-rating.ts (which wraps glicko.ts); this module
// owns the reads/writes and the transactional idempotency. A rated attempt is
// applied to BOTH the user and the puzzle inside one transaction, guarded by the
// puzzle_attempts primary key so only a user's FIRST attempt at a puzzle moves
// ratings — retries are no-ops.

import type pg from 'pg';
import { emitAchievementTrigger } from './achievement-triggers.js';
import { type Glicko2, isProvisional } from './glicko.js';
import { getPool, isInitialized, withTransaction } from './persistence-db.js';
import { newPlayerPuzzleRating, ratePuzzleAttempt } from './puzzle-rating.js';

export type UserPuzzleRating = {
  glicko: Glicko2;
  rating: number;
  provisional: boolean;
  solved: number;
  attempts: number;
};

export type PuzzleRating = {
  glicko: Glicko2;
  rating: number;
  provisional: boolean;
  plays: number;
  solves: number;
};

export type PuzzleRatingSummary = {
  rating: number;
  provisional: boolean;
};

export type RecordPuzzleAttemptInput = {
  userId: string;
  puzzleId: string;
  variant: string;
  solved: boolean;
  rated: boolean;
  // Seed rating applied to the puzzle only if it has no row yet (from the
  // puzzle's difficulty; see seedPuzzleRating). Ignored once the puzzle exists.
  seedRating: Glicko2;
};

export type RecordPuzzleAttemptResult = {
  firstAttempt: boolean;
  ratingChanged: boolean;
  userRating: number;
  userRatingDelta: number;
  provisional: boolean;
};

type RatingRow = { rating: number; rating_deviation: number; volatility: number };

const toGlicko = (row: RatingRow): Glicko2 => ({
  rating: row.rating,
  rd: row.rating_deviation,
  volatility: row.volatility,
});

export async function getUserPuzzleRating(
  userId: string,
  variant: string,
): Promise<UserPuzzleRating | null> {
  if (!isInitialized()) return null;
  const { rows } = await getPool().query<RatingRow & { solved: number; attempts: number }>(
    `SELECT rating, rating_deviation, volatility, solved, attempts
       FROM user_puzzle_ratings WHERE user_id = $1 AND variant = $2`,
    [userId, variant],
  );
  const row = rows[0];
  if (!row) return null;
  const glicko = toGlicko(row);
  return {
    glicko,
    rating: Math.round(glicko.rating),
    provisional: isProvisional(glicko.rd),
    solved: row.solved,
    attempts: row.attempts,
  };
}

export async function getPuzzleRating(puzzleId: string): Promise<PuzzleRating | null> {
  if (!isInitialized()) return null;
  const { rows } = await getPool().query<RatingRow & { plays: number; solves: number }>(
    `SELECT rating, rating_deviation, volatility, plays, solves
       FROM puzzle_ratings WHERE puzzle_id = $1`,
    [puzzleId],
  );
  const row = rows[0];
  if (!row) return null;
  const glicko = toGlicko(row);
  return {
    glicko,
    rating: Math.round(glicko.rating),
    provisional: isProvisional(glicko.rd),
    plays: row.plays,
    solves: row.solves,
  };
}

export async function listPuzzleRatingSummaries(
  puzzleIds: readonly string[],
): Promise<ReadonlyMap<string, PuzzleRatingSummary>> {
  if (!isInitialized() || puzzleIds.length === 0) return new Map();
  const { rows } = await getPool().query<RatingRow & { puzzle_id: string }>(
    `SELECT puzzle_id, rating, rating_deviation, volatility
     FROM puzzle_ratings WHERE puzzle_id = ANY($1::text[])`,
    [puzzleIds],
  );
  return new Map(
    rows.map((row) => [
      row.puzzle_id,
      { rating: Math.round(row.rating), provisional: isProvisional(row.rating_deviation) },
    ]),
  );
}

// Puzzles this user has already finished. Rotation is otherwise driven by a
// localStorage seen-set, which does not survive a cleared browser, a second
// device, or a reinstall -- and puzzle_attempts has held the answer the whole
// time without anything reading it. Signed-in visitors should not be handed a
// puzzle they have already solved just because they switched machines.
export async function listAttemptedPuzzleIds(
  userId: string,
  variant?: string,
): Promise<readonly string[]> {
  if (!isInitialized()) return [];
  const { rows } = await getPool().query<{ puzzle_id: string }>(
    variant
      ? `SELECT puzzle_id FROM puzzle_attempts WHERE user_id = $1 AND variant = $2`
      : `SELECT puzzle_id FROM puzzle_attempts WHERE user_id = $1`,
    variant ? [userId, variant] : [userId],
  );
  return rows.map((row) => row.puzzle_id);
}

// Record a user's first outcome for a puzzle and, if rated, apply the Glicko-2
// update to both sides. Idempotent: a repeat attempt returns firstAttempt=false
// and changes nothing. Returns null if persistence is disabled.
export async function recordPuzzleAttempt(
  input: RecordPuzzleAttemptInput,
): Promise<RecordPuzzleAttemptResult | null> {
  if (!isInitialized()) return null;
  const { userId, puzzleId, variant, solved, rated, seedRating } = input;

  const result = await withTransaction(async (client) => {
    const user = await lockUserRating(client, userId, variant);
    const puzzle = await lockPuzzleRating(client, puzzleId, variant, seedRating);

    const change = rated ? ratePuzzleAttempt(user, puzzle, solved) : { user, puzzle };
    const before = Math.round(user.rating);
    const after = Math.round(change.user.rating);

    const inserted = await client.query(
      `INSERT INTO puzzle_attempts
         (user_id, puzzle_id, variant, solved, rated, user_rating_before, user_rating_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, puzzle_id) DO NOTHING`,
      [userId, puzzleId, variant, solved, rated, before, after],
    );

    if (inserted.rowCount === 0) {
      // Already attempted (or a concurrent first attempt won the race): no change.
      return {
        firstAttempt: false,
        ratingChanged: false,
        userRating: before,
        userRatingDelta: 0,
        provisional: isProvisional(user.rd),
      };
    }

    await updateUserRating(client, userId, variant, change.user, solved, rated);
    await updatePuzzleRating(client, puzzleId, change.puzzle, solved, rated);

    return {
      firstAttempt: true,
      ratingChanged: rated,
      userRating: after,
      userRatingDelta: rated ? after - before : 0,
      provisional: isProvisional(change.user.rd),
    };
  });
  // A first solve is the only attempt that can earn (after commit, off path).
  if (result.firstAttempt && solved) {
    emitAchievementTrigger({ trigger: 'puzzle_attempt', userIds: [userId] });
  }
  return result;
}

// Seed the row if absent (so FOR UPDATE has something to lock and concurrent
// attempts serialize), then return the locked current rating.
async function lockUserRating(
  client: pg.PoolClient,
  userId: string,
  variant: string,
): Promise<Glicko2> {
  // A first row starts at the new-player rating (#712), not the column
  // default of 1500, so the queue and the first rated attempt agree.
  const start = newPlayerPuzzleRating();
  await client.query(
    `INSERT INTO user_puzzle_ratings (user_id, variant, rating, rating_deviation, volatility)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, variant) DO NOTHING`,
    [userId, variant, start.rating, start.rd, start.volatility],
  );
  const { rows } = await client.query<RatingRow>(
    `SELECT rating, rating_deviation, volatility FROM user_puzzle_ratings
     WHERE user_id = $1 AND variant = $2 FOR UPDATE`,
    [userId, variant],
  );
  return toGlicko(rows[0]!);
}

async function lockPuzzleRating(
  client: pg.PoolClient,
  puzzleId: string,
  variant: string,
  seed: Glicko2,
): Promise<Glicko2> {
  await client.query(
    `INSERT INTO puzzle_ratings (puzzle_id, variant, rating, rating_deviation, volatility)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (puzzle_id) DO NOTHING`,
    [puzzleId, variant, seed.rating, seed.rd, seed.volatility],
  );
  const { rows } = await client.query<RatingRow>(
    `SELECT rating, rating_deviation, volatility FROM puzzle_ratings
     WHERE puzzle_id = $1 FOR UPDATE`,
    [puzzleId],
  );
  return toGlicko(rows[0]!);
}

async function updateUserRating(
  client: pg.PoolClient,
  userId: string,
  variant: string,
  next: Glicko2,
  solved: boolean,
  rated: boolean,
): Promise<void> {
  await client.query(
    `UPDATE user_puzzle_ratings SET
       rating = $3, rating_deviation = $4, volatility = $5,
       attempts = attempts + 1,
       solved = solved + $6,
       last_rated_at = CASE WHEN $7 THEN now() ELSE last_rated_at END
     WHERE user_id = $1 AND variant = $2`,
    [userId, variant, next.rating, next.rd, next.volatility, solved ? 1 : 0, rated],
  );
}

async function updatePuzzleRating(
  client: pg.PoolClient,
  puzzleId: string,
  next: Glicko2,
  solved: boolean,
  rated: boolean,
): Promise<void> {
  await client.query(
    `UPDATE puzzle_ratings SET
       rating = $2, rating_deviation = $3, volatility = $4,
       plays = plays + 1,
       solves = solves + $5,
       updated_at = CASE WHEN $6 THEN now() ELSE updated_at END
     WHERE puzzle_id = $1`,
    [puzzleId, next.rating, next.rd, next.volatility, solved ? 1 : 0, rated],
  );
}
