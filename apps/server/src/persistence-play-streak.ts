// Play-streak read: the distinct player-calendar days on which a subject (an
// account or a guest browser device) finished a counted game, folded by
// play-streak.ts. Same counted-game filter as every other aggregate, so a
// stats-excluded operator account has no streak and an aborted or one-ply
// game does not extend one.

import { countedHumanGame } from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';
import { calendarDay, computePlayStreak, type PlayStreak, resolveTimeZone } from './play-streak.js';

export type PlayStreakSubject = { type: 'user' | 'guest'; id: string };

export type PlayStreakOptions = {
  // IANA zone from the browser; anything unknown resolves to UTC.
  timeZone?: string | null;
  now?: Date;
};

const COUNTED = countedHumanGame('g');

export async function getPlayStreak(
  subject: PlayStreakSubject,
  options: PlayStreakOptions = {},
): Promise<PlayStreak> {
  const timeZone = resolveTimeZone(options.timeZone);
  const now = options.now ?? new Date();
  const result = await getPool().query<{ day: string }>(
    `SELECT DISTINCT to_char((g.ended_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day
     FROM game_participants p
     JOIN games g ON g.room_id = p.game_id
     WHERE p.subject_type = $1
       AND p.subject_id = $2
       AND ${COUNTED}`,
    [subject.type, subject.id, timeZone],
  );
  return computePlayStreak(
    result.rows.map((row) => row.day),
    calendarDay(now, timeZone),
  );
}
