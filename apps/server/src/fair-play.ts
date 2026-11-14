import type pg from 'pg';
import { isProvisional } from './glicko.js';
import { seatWonGame } from './persistence-counted-games.js';
import { getPool, isInitialized } from './persistence-db.js';
import { bucketForGame, type RatingBucket } from './rating-buckets.js';

export function isFairPlayMarked(user: { fairPlayMarkedAt?: Date | null } | null): boolean {
  return user?.fairPlayMarkedAt != null;
}

export async function isUserIdFairPlayMarked(userId: string): Promise<boolean> {
  if (!isInitialized()) return false;
  const { rows } = await getPool().query<{ marked: boolean }>(
    `SELECT (fair_play_marked_at IS NOT NULL OR closed_at IS NOT NULL) AS marked
     FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.marked ?? true;
}

export type RefundGame = {
  gameId: string;
  beneficiaryId: string | null;
  handle: string | null;
  bucket: RatingBucket | null;
  outcome: 'win' | 'draw' | 'loss';
  before: number | null;
  after: number | null;
  currentRd: number | null;
  refunded?: number;
};

export type FairPlayRefund = RatingBucket & {
  gameId: string;
  beneficiaryId: string;
  handle: string;
  points: number;
};

// Games arrive newest first, including games that do not qualify for a refund.
// Prior refunds consume the same pool cap on an unmark/re-mark, but never pay twice.
export function calculateFairPlayRefunds(games: readonly RefundGame[]): FairPlayRefund[] {
  // The window is 40 games; a game with several opponents arrives as several rows.
  const windowIds = new Set<string>();
  const window = games.filter((game) => {
    if (windowIds.has(game.gameId)) return true;
    if (windowIds.size >= 40) return false;
    windowIds.add(game.gameId);
    return true;
  });
  const paid = new Map<string, number>();
  const keyFor = (game: RefundGame) =>
    JSON.stringify([game.beneficiaryId, game.bucket?.variant, game.bucket?.timeClass]);
  for (const game of window) {
    paid.set(keyFor(game), (paid.get(keyFor(game)) ?? 0) + (game.refunded ?? 0));
  }
  const refunds: FairPlayRefund[] = [];
  for (const game of window) {
    if (
      !game.beneficiaryId ||
      !game.handle ||
      !game.bucket ||
      game.refunded ||
      game.outcome !== 'loss' ||
      game.before === null ||
      game.after === null ||
      game.currentRd === null ||
      isProvisional(game.currentRd)
    )
      continue;
    const key = keyFor(game);
    const points = Math.min(Math.max(0, game.before - game.after), 150 - (paid.get(key) ?? 0));
    if (points <= 0) continue;
    paid.set(key, (paid.get(key) ?? 0) + points);
    refunds.push({
      ...game.bucket,
      gameId: game.gameId,
      beneficiaryId: game.beneficiaryId,
      handle: game.handle,
      points,
    });
  }
  return refunds;
}

// Caller owns BEGIN/COMMIT (or ROLLBACK). The mark and every refund are atomic.
// Dry run issues no writes, including no temporary writes rolled back later.
export async function markFairPlay(
  client: pg.PoolClient | pg.Client,
  userId: string,
  dryRun = false,
): Promise<FairPlayRefund[]> {
  const { rows: users } = await client.query<{ fair_play_marked_at: Date | null }>(
    'SELECT fair_play_marked_at FROM users WHERE id = $1 FOR NO KEY UPDATE',
    [userId],
  );
  if (!users[0]) throw new Error('Account not found');
  if (users[0].fair_play_marked_at) return [];
  const { rows: games } = await client.query<{
    game_id: string;
    variant: string;
    initial_ms: number | null;
    increment_ms: number | null;
    beneficiary_id: string | null;
    handle: string | null;
    outcome: RefundGame['outcome'];
    elo_before: number | null;
    elo_after: number | null;
    refunded: number | null;
  }>(
    `WITH recent AS (
       SELECT g.* FROM games g
       WHERE EXISTS (SELECT 1 FROM game_participants p
         WHERE p.game_id = g.room_id AND p.subject_type = 'user' AND p.subject_id = $1
           AND p.elo_before IS NOT NULL AND p.elo_after IS NOT NULL)
       ORDER BY g.ended_at DESC NULLS LAST, g.room_id DESC LIMIT 40
     )
     SELECT g.room_id AS game_id, g.variant, g.initial_ms, g.increment_ms,
            u.id AS beneficiary_id, u.handle, o.elo_before, o.elo_after, f.points AS refunded,
            CASE WHEN g.result = 'draw' THEN 'draw'
                 WHEN ${seatWonGame('o', 'g')} THEN 'win' ELSE 'loss' END AS outcome
     FROM recent g
     LEFT JOIN game_participants o ON o.game_id = g.room_id
       AND o.subject_type = 'user' AND o.subject_id <> $1
     LEFT JOIN users u ON u.id = o.subject_id
     LEFT JOIN fair_play_refunds f ON f.marked_user_id = $1 AND f.game_id = g.room_id
       AND f.beneficiary_user_id = u.id
     ORDER BY g.ended_at DESC NULLS LAST, g.room_id DESC`,
    [userId],
  );
  // Stable locking order across marks; a concurrent game result cannot overwrite
  // the increment or change the provisional check between planning and writing.
  const { rows: ratings } = await client.query<{
    user_id: string;
    variant: string;
    time_class: string;
    rating_deviation: number;
  }>(
    `SELECT user_id, variant, time_class, rating_deviation FROM user_ratings
     WHERE user_id = ANY($1) ORDER BY user_id, variant, time_class FOR UPDATE`,
    [games.flatMap((game) => (game.beneficiary_id ? [game.beneficiary_id] : []))],
  );
  const refunds = calculateFairPlayRefunds(
    games.map((game) => {
      const bucket = bucketForGame({
        variant: game.variant,
        initialMs: game.initial_ms,
        incrementMs: game.increment_ms,
      });
      const rating = ratings.find(
        (r) =>
          r.user_id === game.beneficiary_id &&
          r.variant === bucket?.variant &&
          r.time_class === bucket?.timeClass,
      );
      return {
        gameId: game.game_id,
        beneficiaryId: game.beneficiary_id,
        handle: game.handle,
        bucket,
        outcome: game.outcome,
        before: game.elo_before,
        after: game.elo_after,
        currentRd: rating?.rating_deviation ?? null,
        refunded: game.refunded ?? 0,
      };
    }),
  );
  if (dryRun) return refunds;
  await client.query(
    'UPDATE users SET fair_play_marked_at = now(), updated_at = now() WHERE id = $1',
    [userId],
  );
  const applied: FairPlayRefund[] = [];
  for (const refund of refunds) {
    const inserted = await client.query(
      `INSERT INTO fair_play_refunds
       (marked_user_id, game_id, beneficiary_user_id, variant, time_class, points)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING points`,
      [
        userId,
        refund.gameId,
        refund.beneficiaryId,
        refund.variant,
        refund.timeClass,
        refund.points,
      ],
    );
    if (!inserted.rowCount) continue;
    await client.query(
      `UPDATE user_ratings SET elo_rating = elo_rating + $4, updated_at = now()
       WHERE user_id = $1 AND variant = $2 AND time_class = $3`,
      [refund.beneficiaryId, refund.variant, refund.timeClass, refund.points],
    );
    applied.push(refund);
  }
  return applied;
}

export async function unmarkFairPlay(
  client: pg.PoolClient | pg.Client,
  userId: string,
): Promise<void> {
  await client.query(
    'UPDATE users SET fair_play_marked_at = NULL, updated_at = now() WHERE id = $1',
    [userId],
  );
}
