import type { Color, GameEvent } from '@mistboard/game';
import type { MistyDecisionRecord, MistyLossGame } from './misty-loss-report.js';
import { countedHumanGame, seatWonGame } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';
import { LIVE_ENGINE_DECISION_ARTIFACT_TYPE } from './persistence-game-lifecycle.js';

/** Narrow injectable query seam; all three reads are SELECTs, never writes. */
export type MistyLossQuery = <T extends Record<string, unknown>>(
  sql: string,
  values: unknown[],
) => Promise<{ rows: T[] }>;

export async function loadMistyLosses(
  since: Date,
  until: Date,
  gamePrefix: string | null = null,
  query: MistyLossQuery = <T extends Record<string, unknown>>(sql: string, values: unknown[]) =>
    getPool().query<T>(sql, values),
): Promise<MistyLossGame[]> {
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until) {
    throw new Error('invalid report time window');
  }
  if (gamePrefix !== null && !/^[a-zA-Z0-9-]{8,64}$/.test(gamePrefix)) {
    throw new Error('game prefix must contain 8 to 64 letters, digits or hyphens');
  }
  const { rows } = await query<{ game_id: string; engine_color: Color }>(
    `SELECT g.room_id AS game_id, b.color AS engine_color
     FROM games g
     JOIN game_participants b ON b.game_id = g.room_id
     JOIN game_participants h ON h.game_id = g.room_id AND h.color <> b.color
     WHERE ${countedHumanGame('g')}
       AND g.variant = 'dark-chess' AND g.mode = 'pve'
       AND h.subject_type IN ('user', 'guest') AND ${seatWonGame('h', 'g')}
       AND ((b.subject_type = 'bot' AND b.subject_id IN ('misty', 'misty-dark-chess'))
         OR (b.subject_type = 'engine-version' AND b.subject_id LIKE 'python-v2%'))
       AND g.ended_at >= $1 AND g.ended_at < $2
       AND ($3::text IS NULL OR g.room_id LIKE $3 || '%')
     ORDER BY g.room_id`,
    [since, until, gamePrefix],
  );
  const games: MistyLossGame[] = [];
  // One game at a time: bounded read size and no parallel engine fanout.
  for (const row of rows) {
    const events = await query<{ payload: GameEvent }>(
      'SELECT payload FROM events WHERE room_id = $1 ORDER BY seq ASC',
      [row.game_id],
    );
    const decisions = await query<{
      ply: number | null;
      engine_color: Color | null;
      payload: MistyDecisionRecord['payload'];
    }>(
      `SELECT ply, engine_color, payload FROM game_debug_artifacts
       WHERE game_id = $1 AND artifact_type = $2 AND storage = 'jsonb'
         AND engine_color = $3 ORDER BY ply, id`,
      [row.game_id, LIVE_ENGINE_DECISION_ARTIFACT_TYPE, row.engine_color],
    );
    games.push({
      gameId: row.game_id,
      engineColor: row.engine_color,
      events: events.rows.map((event) => event.payload),
      decisions: decisions.rows.map((d) => ({
        ply: d.ply,
        engineColor: d.engine_color,
        payload: d.payload,
      })),
    });
  }
  return games;
}
