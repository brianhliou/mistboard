// Puzzle streak: consecutive player-calendar days with a puzzle solved, for a
// signed-in account. The fold is play-streak.ts; the day source is
// puzzle_attempts, which holds one row per (user, puzzle) for the
// FIRST terminal outcome (073), so a day counts when the account solved a
// puzzle it had not attempted before. Guests record no attempts and have no
// streak here.

import { getPool } from './persistence-db.js';
import { calendarDay, computePlayStreak, type PlayStreak, resolveTimeZone } from './play-streak.js';

export type PuzzleStreakOptions = {
  timeZone?: string | null;
  now?: Date;
};

export async function getPuzzleStreak(
  userId: string,
  options: PuzzleStreakOptions = {},
): Promise<PlayStreak> {
  const timeZone = resolveTimeZone(options.timeZone);
  const now = options.now ?? new Date();
  const result = await getPool().query<{ day: string }>(
    `SELECT DISTINCT to_char((created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day
     FROM puzzle_attempts
     WHERE user_id = $1 AND solved`,
    [userId, timeZone],
  );
  return computePlayStreak(
    result.rows.map((row) => row.day),
    calendarDay(now, timeZone),
  );
}
