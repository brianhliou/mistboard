// Rating store — the persistence surface for the human PvP Glicko-2 ladder.
//
// Carved out of persistence.ts as the rating concern got its own algorithm
// (glicko.ts). Follows the shell-helper-inversion pattern: this module takes the
// transaction client from persistence rather than owning the pool, so there's no
// circular import and the rating write stays inside the caller's game-end
// transaction. persistence.ts keeps shrinking; rating logic lives in one place.

import type pg from 'pg';
import { defaultRating, type Glicko2, rate } from './glicko.js';
import type { RatingBucket } from './rating-buckets.js';

export type RatedResult = 'white-wins' | 'black-wins' | 'draw';
export type RatedParticipantColor = 'white' | 'black' | 'red' | 'east' | 'west';

/**
 * Apply one finished rated PvP game to both players' Glicko-2 ratings, inside
 * the caller's transaction. Reads each side's current rating (locked), rates
 * each against the OPPONENT'S pre-game rating (simultaneous update), upserts the
 * new values, and records before/after rating+RD on game_participants (the
 * immutable per-game rating-event log).
 *
 * Caller guarantees this is a rated PvP game with two real user seats.
 */
export async function applyRatedGameResult(
  client: pg.PoolClient,
  roomId: string,
  whiteUserId: string,
  blackUserId: string,
  result: RatedResult,
  bucket: RatingBucket,
  participantColors: {
    white: RatedParticipantColor;
    black: RatedParticipantColor;
  } = { white: 'white', black: 'black' },
): Promise<void> {
  const { rows } = await client.query<{
    user_id: string;
    elo_rating: number;
    rating_deviation: number;
    volatility: number;
  }>(
    `SELECT user_id, elo_rating, rating_deviation, volatility FROM user_ratings
     WHERE user_id = ANY($1) AND variant = $2 AND time_class = $3
     FOR UPDATE`,
    [[whiteUserId, blackUserId], bucket.variant, bucket.timeClass],
  );

  const before = (id: string): Glicko2 => {
    const row = rows.find((r) => r.user_id === id);
    return row
      ? { rating: row.elo_rating, rd: row.rating_deviation, volatility: row.volatility }
      : defaultRating();
  };

  const white = before(whiteUserId);
  const black = before(blackUserId);
  const whiteScore = result === 'white-wins' ? 1 : result === 'draw' ? 0.5 : 0;
  const blackScore = 1 - whiteScore;

  const newWhite = rate(white, [
    { opponentRating: black.rating, opponentRd: black.rd, score: whiteScore },
  ]);
  const newBlack = rate(black, [
    { opponentRating: white.rating, opponentRd: white.rd, score: blackScore },
  ]);

  await upsertRating(client, whiteUserId, bucket, newWhite);
  await upsertRating(client, blackUserId, bucket, newBlack);

  await recordParticipantRating(client, roomId, participantColors.white, white, newWhite);
  await recordParticipantRating(client, roomId, participantColors.black, black, newBlack);
}

async function upsertRating(
  client: pg.PoolClient,
  userId: string,
  bucket: RatingBucket,
  next: Glicko2,
): Promise<void> {
  await client.query(
    `INSERT INTO user_ratings
       (user_id, variant, time_class, elo_rating, rating_deviation, volatility,
        games_played, last_rated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, now(), now())
     ON CONFLICT (user_id, variant, time_class) DO UPDATE
       SET elo_rating       = EXCLUDED.elo_rating,
           rating_deviation = EXCLUDED.rating_deviation,
           volatility       = EXCLUDED.volatility,
           games_played     = user_ratings.games_played + 1,
           last_rated_at    = now(),
           updated_at       = now()`,
    [userId, bucket.variant, bucket.timeClass, Math.round(next.rating), next.rd, next.volatility],
  );
}

async function recordParticipantRating(
  client: pg.PoolClient,
  roomId: string,
  color: RatedParticipantColor,
  before: Glicko2,
  after: Glicko2,
): Promise<void> {
  await client.query(
    `UPDATE game_participants
     SET elo_before = $2, elo_after = $3, rd_before = $4, rd_after = $5
     WHERE game_id = $1 AND color = $6`,
    [roomId, Math.round(before.rating), Math.round(after.rating), before.rd, after.rd, color],
  );
}
