import { fairPlayMovesFromEvents } from './fair-play-game-inputs.js';
import { FAIR_PLAY_ANALYZED_GAME_LIMIT, type FairPlaySummaryGame } from './fair-play-summary.js';
import { getPool } from './persistence-db.js';
import type { StoredPlyEval } from './persistence-game-analysis.js';
import { bucketForGame, type RatingTimeClass } from './rating-buckets.js';

export type FairPlaySummaryDb = {
  query<T extends object>(sql: string, values: unknown[]): Promise<{ rows: T[] }>;
};

type GameRow = {
  room_id: string;
  variant: string;
  ended_at: Date;
  initial_ms: number | null;
  increment_ms: number | null;
  player_color: string;
  engine_id: string | null;
  depth: number | null;
  plies: StoredPlyEval[] | { plies: StoredPlyEval[] } | null;
};

/** The newest 40 ANALYZED finished rated games, plus every missing-analysis
 * game encountered back to that cutoff. If fewer than 40 are analyzed, the
 * account's entire rated history is covered. Never let gaps disappear or
 * consume the 40 analyzed-game allowance. The chosen final cache key is
 * returned with each game; historical engine versions remain identifiable. */
export async function loadFairPlaySummaryInputs(
  accountId: string,
  db: FairPlaySummaryDb = getPool(),
): Promise<FairPlaySummaryGame[] | null> {
  const account = await db.query<{ id: string }>('SELECT id FROM users WHERE id = $1', [accountId]);
  if (!account.rows.length) return null;
  const { rows } = await db.query<GameRow>(
    `WITH candidates AS (
       SELECT g.room_id, g.variant, g.ended_at, g.initial_ms, g.increment_ms,
              p.color AS player_color, a.engine_id, a.depth, a.plies
       FROM game_participants p
       JOIN games g ON g.room_id = p.game_id
       LEFT JOIN LATERAL (
         SELECT engine_id, depth, plies FROM game_analysis
         WHERE room_id = g.room_id
           AND (engine_id LIKE '%-analysis@%' OR engine_id LIKE 'misty-analysis@%')
           AND engine_id NOT LIKE '%!progress'
           AND (jsonb_typeof(plies) = 'array' OR jsonb_typeof(plies->'plies') = 'array')
         ORDER BY created_at DESC, depth DESC, engine_id LIMIT 1
       ) a ON TRUE
       WHERE p.subject_type = 'user' AND p.subject_id = $1
         AND g.rated = TRUE AND g.status = 'completed' AND g.mode = 'pvp'
     ), ranked AS (
       SELECT *, SUM(CASE WHEN engine_id IS NULL THEN 0 ELSE 1 END)
         OVER (ORDER BY ended_at DESC, room_id DESC ROWS UNBOUNDED PRECEDING) AS analyzed_count
       FROM candidates
     )
     SELECT * FROM ranked
     WHERE analyzed_count < $2 OR (analyzed_count = $2 AND engine_id IS NOT NULL)
     ORDER BY ended_at DESC, room_id DESC`,
    [accountId, FAIR_PLAY_ANALYZED_GAME_LIMIT],
  );
  if (!rows.length) return [];
  const [ratings, events] = await Promise.all([
    db.query<{ variant: string; time_class: RatingTimeClass; elo_rating: number }>(
      'SELECT variant, time_class, elo_rating FROM user_ratings WHERE user_id = $1',
      [accountId],
    ),
    db.query<{ room_id: string; payload: unknown }>(
      'SELECT room_id, payload FROM events WHERE room_id = ANY($1::text[]) ORDER BY room_id, seq',
      [rows.filter((row) => row.plies !== null).map((row) => row.room_id)],
    ),
  ]);
  const logs = new Map<string, unknown[]>();
  for (const event of events.rows) {
    const log = logs.get(event.room_id) ?? [];
    log.push(event.payload);
    logs.set(event.room_id, log);
  }
  return rows.map((row) => {
    const bucket = bucketForGame({
      variant: row.variant,
      initialMs: row.initial_ms,
      incrementMs: row.increment_ms,
    });
    const rating = ratings.rows.find(
      (r) => r.variant === bucket?.variant && r.time_class === bucket?.timeClass,
    );
    const analysis = Array.isArray(row.plies) ? row.plies : (row.plies?.plies ?? null);
    return {
      roomId: row.room_id,
      variant: row.variant,
      timeClass: bucket?.timeClass ?? null,
      rating: rating?.elo_rating ?? null,
      playerColor: row.player_color,
      endedAt: row.ended_at.toISOString(),
      engineId: row.engine_id,
      depth: row.depth,
      analysis,
      moves: analysis
        ? fairPlayMovesFromEvents(row.variant, logs.get(row.room_id) ?? [], row.room_id)
        : null,
    };
  });
}
