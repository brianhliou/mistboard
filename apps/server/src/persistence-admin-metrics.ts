import {
  COUNTED_USER,
  countedAccountSeat,
  countedHumanGame,
  excludedSeatExists,
  internalHumanGame,
  preLaunchHumanGame,
  STATS_COUNTED_FROM,
  sinceLaunch,
} from './persistence-counted-games.js';
import { getPool } from './persistence-db.js';
import { PATRON_ACTIVE_STATUSES } from './persistence-patron.js';

// Admin /metrics, Postgres-true. Everything in `weekly` and the headline
// figures is COUNTED play only (persistence-counted-games.ts): completed
// pvp/pve games with no seat held by a stats-excluded account. Engine-vs-engine
// (mode 'eve'), the corpus modes ('imported', 'manual'), and the excluded
// accounts' own games are reported separately in `engines`, never folded into
// a player number. See docs-private/metrics-roadmap.md.
//
// GUESTS ARE NOT PEOPLE HERE. A guest seat is persisted as subject_type
// 'guest' with subject_id NULL (room-manager.ts, variant-tenant/events.ts) and
// the client id is minted per room, so there is no durable guest identity to
// count. Every "player" figure below is SIGNED-IN players; the guest side is
// `guestGames`, games with at least one guest seat, which is a game count and
// not a person count. Making guests countable needs a device id on the seat
// (roadmap phase 7).
//
// Weeks are ISO (Monday start), oldest first, the current partial week last.
// Postgres' date_trunc('week') is Monday-based, which is what the readout and
// the PostHog tiles use, so a week here can be checked against either.

export const ADMIN_METRICS_WEEKS = 26;

export interface AdminMetricsWeek {
  weekStart: string;
  humanGames: number;
  pvpGames: number;
  pveGames: number;
  // Distinct signed-in accounts that finished a human game this week.
  players: number;
  newPlayers: number;
  returningPlayers: number;
  // Distinct signed-in players over the 28 days ending at this week's end (or
  // at `now` for the current week). A rolling MAU sampled once per week.
  activePlayers28d: number;
  // Human games this week with at least one guest seat: the only guest figure
  // the database can give.
  guestGames: number;
  newAccounts: number;
  puzzleSessions: number;
  puzzleSolves: number;
  puzzleAttempts: number;
  studiesCreated: number;
  studyChaptersCreated: number;
  practiceSolves: number;
  chatLines: number;
  dmMessages: number;
  correspondenceSeeks: number;
  newPatrons: number;
  eveGames: number;
  internalGames: number;
}

export interface AdminMetricsEngines {
  eveGames: number;
  eveGamesLast7d: number;
  importedGames: number;
  manualGames: number;
  // Completed human games with a seat held by a stats-excluded account (the
  // operator's own). Left out of every count above this block.
  internalGames: number;
  internalGamesLast7d: number;
  // Completed human games before STATS_COUNTED_FROM with no excluded seat:
  // the operator's pre-launch guest-seat testing, unreachable by any flag.
  preLaunchGames: number;
  countedFrom: string;
  eveByVariant: Record<string, number>;
}

export interface AdminMetrics {
  generatedAt: string;
  weekCount: number;
  accounts: number;
  accountsLast7d: number;
  accountsLast30d: number;
  humanGames: number;
  humanGamesLast7d: number;
  publicHumanGames: number;
  activePlayers28d: number;
  previousActivePlayers28d: number;
  activePatrons: number;
  humanGamesByResult: Record<string, number>;
  humanGamesByVariant: Record<string, number>;
  weekly: AdminMetricsWeek[];
  engines: AdminMetricsEngines;
}

export type AdminMetricsOptions = {
  now?: Date;
  weeks?: number;
};

type Queryable = { query: <R>(text: string, params?: unknown[]) => Promise<{ rows: R[] }> };

// Both fragments assume `games g` and `game_participants p`; the exclusion
// of flagged accounts (users.stats_excluded_at) lives inside them.
const HUMAN_GAME = countedHumanGame('g');
const SIGNED_IN_SEAT = countedAccountSeat('p');
const INTERNAL_GAME = internalHumanGame('g');
const EXCLUDED_SEAT = excludedSeatExists('g');
const PRE_LAUNCH_GAME = preLaunchHumanGame('g');
const SINCE_LAUNCH = sinceLaunch('g');
// Start of the oldest week in the window; $1 is `now`, $2 the week count.
const WINDOW_START = `date_trunc('week', $1::timestamptz) - ($2::int - 1) * INTERVAL '1 week'`;

export async function getAdminMetrics(options: AdminMetricsOptions = {}): Promise<AdminMetrics> {
  const now = options.now ?? new Date();
  const weeks = options.weeks ?? ADMIN_METRICS_WEEKS;
  const pool = getPool() as unknown as Queryable;

  const [axis, headline, engines, gamesByWeek, playersByWeek, mauByWeek, activity] =
    await Promise.all([
      weekAxis(pool, now, weeks),
      collectHeadline(pool, now),
      collectEngines(pool, now),
      collectGamesByWeek(pool, now, weeks),
      collectPlayersByWeek(pool, now, weeks),
      collectActive28dByWeek(pool, now, weeks),
      collectActivityByWeek(pool, now, weeks),
    ]);

  const weekly = axis.map((weekStart): AdminMetricsWeek => {
    const games = gamesByWeek.get(weekStart);
    const players = playersByWeek.get(weekStart);
    const act = activity.get(weekStart);
    return {
      weekStart,
      humanGames: (games?.pvp ?? 0) + (games?.pve ?? 0),
      pvpGames: games?.pvp ?? 0,
      pveGames: games?.pve ?? 0,
      players: players?.players ?? 0,
      newPlayers: players?.newPlayers ?? 0,
      returningPlayers: (players?.players ?? 0) - (players?.newPlayers ?? 0),
      activePlayers28d: mauByWeek.get(weekStart) ?? 0,
      guestGames: games?.guest ?? 0,
      newAccounts: act?.newAccounts ?? 0,
      puzzleSessions: act?.puzzleSessions ?? 0,
      puzzleSolves: act?.puzzleSolves ?? 0,
      puzzleAttempts: act?.puzzleAttempts ?? 0,
      studiesCreated: act?.studiesCreated ?? 0,
      studyChaptersCreated: act?.studyChaptersCreated ?? 0,
      practiceSolves: act?.practiceSolves ?? 0,
      chatLines: act?.chatLines ?? 0,
      dmMessages: act?.dmMessages ?? 0,
      correspondenceSeeks: act?.correspondenceSeeks ?? 0,
      newPatrons: act?.newPatrons ?? 0,
      eveGames: games?.eve ?? 0,
      internalGames: games?.internal ?? 0,
    };
  });

  return {
    generatedAt: now.toISOString(),
    weekCount: weeks,
    ...headline,
    weekly,
    engines,
  };
}

// Monday-start weeks, oldest first, ending with the week containing `now`.
async function weekAxis(db: Queryable, now: Date, weeks: number): Promise<string[]> {
  const result = await db.query<{ week: Date | string }>(
    `SELECT generate_series(
       ${WINDOW_START},
       date_trunc('week', $1::timestamptz),
       INTERVAL '1 week'
     )::date::text AS week`,
    [now, weeks],
  );
  return result.rows.map((row) => isoDate(row.week));
}

async function collectHeadline(
  db: Queryable,
  now: Date,
): Promise<
  Pick<
    AdminMetrics,
    | 'accounts'
    | 'accountsLast7d'
    | 'accountsLast30d'
    | 'humanGames'
    | 'humanGamesLast7d'
    | 'publicHumanGames'
    | 'activePlayers28d'
    | 'previousActivePlayers28d'
    | 'activePatrons'
    | 'humanGamesByResult'
    | 'humanGamesByVariant'
  >
> {
  const [scalar, byResult, byVariant] = await Promise.all([
    db.query<{
      accounts: number;
      accounts_last7d: number;
      accounts_last30d: number;
      human_games: number;
      human_games_last7d: number;
      public_human_games: number;
      active_28d: number;
      previous_active_28d: number;
      active_patrons: number;
    }>(
      `WITH human_players AS (
         SELECT p.subject_id AS user_id, g.ended_at
         FROM game_participants p
         JOIN games g ON g.room_id = p.game_id
         WHERE ${SIGNED_IN_SEAT} AND ${HUMAN_GAME}
           AND g.ended_at >= $1::timestamptz - INTERVAL '56 days'
           AND g.ended_at < $1::timestamptz
       )
       SELECT
         (SELECT count(*) FROM users WHERE ${COUNTED_USER})::int AS accounts,
         (SELECT count(*) FROM users WHERE ${COUNTED_USER}
            AND created_at > $1::timestamptz - INTERVAL '7 days')::int AS accounts_last7d,
         (SELECT count(*) FROM users WHERE ${COUNTED_USER}
            AND created_at > $1::timestamptz - INTERVAL '30 days')::int AS accounts_last30d,
         (SELECT count(*) FROM games g WHERE ${HUMAN_GAME})::int AS human_games,
         (SELECT count(*) FROM games g WHERE ${HUMAN_GAME}
            AND ended_at > $1::timestamptz - INTERVAL '7 days')::int AS human_games_last7d,
         (SELECT count(*) FROM games g WHERE ${HUMAN_GAME}
            AND visibility = 'public')::int AS public_human_games,
         (SELECT count(DISTINCT user_id) FROM human_players
            WHERE ended_at >= $1::timestamptz - INTERVAL '28 days')::int AS active_28d,
         (SELECT count(DISTINCT user_id) FROM human_players
            WHERE ended_at < $1::timestamptz - INTERVAL '28 days')::int AS previous_active_28d,
         (SELECT count(DISTINCT account_id) FROM patron_subscriptions
            WHERE is_lifetime = true OR status = ANY($2::text[]))::int AS active_patrons`,
      [now, PATRON_ACTIVE_STATUSES],
    ),
    db.query<{ result: string | null; n: number }>(
      `SELECT result, count(*)::int AS n FROM games g WHERE ${HUMAN_GAME}
       GROUP BY result ORDER BY n DESC`,
    ),
    db.query<{ variant: string; n: number }>(
      `SELECT variant, count(*)::int AS n FROM games g WHERE ${HUMAN_GAME}
       GROUP BY variant ORDER BY n DESC, variant ASC`,
    ),
  ]);
  const row = scalar.rows[0];
  return {
    accounts: row?.accounts ?? 0,
    accountsLast7d: row?.accounts_last7d ?? 0,
    accountsLast30d: row?.accounts_last30d ?? 0,
    humanGames: row?.human_games ?? 0,
    humanGamesLast7d: row?.human_games_last7d ?? 0,
    publicHumanGames: row?.public_human_games ?? 0,
    activePlayers28d: row?.active_28d ?? 0,
    previousActivePlayers28d: row?.previous_active_28d ?? 0,
    activePatrons: row?.active_patrons ?? 0,
    humanGamesByResult: Object.fromEntries(byResult.rows.map((r) => [String(r.result), r.n])),
    humanGamesByVariant: Object.fromEntries(byVariant.rows.map((r) => [r.variant, r.n])),
  };
}

async function collectEngines(db: Queryable, now: Date): Promise<AdminMetricsEngines> {
  const [scalar, byVariant] = await Promise.all([
    db.query<{
      eve_games: number;
      eve_games_last7d: number;
      imported_games: number;
      manual_games: number;
      internal_games: number;
      internal_games_last7d: number;
      pre_launch_games: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE g.mode = 'eve')::int AS eve_games,
         count(*) FILTER (WHERE g.mode = 'eve'
           AND g.ended_at > $1::timestamptz - INTERVAL '7 days')::int AS eve_games_last7d,
         count(*) FILTER (WHERE g.mode = 'imported')::int AS imported_games,
         count(*) FILTER (WHERE g.mode = 'manual')::int AS manual_games,
         count(*) FILTER (WHERE ${INTERNAL_GAME})::int AS internal_games,
         count(*) FILTER (WHERE ${INTERNAL_GAME}
           AND g.ended_at > $1::timestamptz - INTERVAL '7 days')::int AS internal_games_last7d,
         count(*) FILTER (WHERE ${PRE_LAUNCH_GAME})::int AS pre_launch_games
       FROM games g
       WHERE g.status = 'completed'`,
      [now],
    ),
    db.query<{ variant: string; n: number }>(
      `SELECT variant, count(*)::int AS n FROM games
       WHERE status = 'completed' AND mode = 'eve'
       GROUP BY variant ORDER BY n DESC, variant ASC`,
    ),
  ]);
  const row = scalar.rows[0];
  return {
    eveGames: row?.eve_games ?? 0,
    eveGamesLast7d: row?.eve_games_last7d ?? 0,
    importedGames: row?.imported_games ?? 0,
    manualGames: row?.manual_games ?? 0,
    internalGames: row?.internal_games ?? 0,
    internalGamesLast7d: row?.internal_games_last7d ?? 0,
    preLaunchGames: row?.pre_launch_games ?? 0,
    countedFrom: STATS_COUNTED_FROM,
    eveByVariant: Object.fromEntries(byVariant.rows.map((r) => [r.variant, r.n])),
  };
}

async function collectGamesByWeek(
  db: Queryable,
  now: Date,
  weeks: number,
): Promise<
  Map<string, { pvp: number; pve: number; eve: number; guest: number; internal: number }>
> {
  // Human-mode rows split into counted (no excluded seat) and internal; EvE
  // rows are never internal. `guest` is counted rows with a guest seat.
  const result = await db.query<{
    week: Date | string;
    mode: string;
    n: number;
    guest: number;
    internal: number;
  }>(
    `SELECT date_trunc('week', g.ended_at)::date::text AS week, g.mode,
            count(*) FILTER (WHERE NOT ${EXCLUDED_SEAT} AND ${SINCE_LAUNCH})::int AS n,
            count(*) FILTER (WHERE NOT ${EXCLUDED_SEAT} AND ${SINCE_LAUNCH} AND EXISTS (
              SELECT 1 FROM game_participants p
              WHERE p.game_id = g.room_id AND p.subject_type = 'guest'
            ))::int AS guest,
            count(*) FILTER (WHERE g.mode <> 'eve' AND ${EXCLUDED_SEAT})::int AS internal
     FROM games g
     WHERE g.status = 'completed' AND g.mode IN ('pvp', 'pve', 'eve')
       AND g.ended_at >= ${WINDOW_START} AND g.ended_at < $1::timestamptz
     GROUP BY week, g.mode`,
    [now, weeks],
  );
  const out = new Map<
    string,
    { pvp: number; pve: number; eve: number; guest: number; internal: number }
  >();
  for (const row of result.rows) {
    const key = isoDate(row.week);
    const entry = out.get(key) ?? { pvp: 0, pve: 0, eve: 0, guest: 0, internal: 0 };
    if (row.mode === 'pvp') entry.pvp = row.n;
    else if (row.mode === 'pve') entry.pve = row.n;
    else if (row.mode === 'eve') entry.eve = row.n;
    if (row.mode !== 'eve') {
      entry.guest += row.guest;
      entry.internal += row.internal;
    }
    out.set(key, entry);
  }
  return out;
}

// A player is "new" in the week of their first completed human game ever,
// not just within the window, so the first week of the window does not read
// as an all-new cohort.
async function collectPlayersByWeek(
  db: Queryable,
  now: Date,
  weeks: number,
): Promise<Map<string, { players: number; newPlayers: number }>> {
  const result = await db.query<{
    week: Date | string;
    players: number;
    new_players: number;
  }>(
    `WITH human AS (
       SELECT p.subject_id AS user_id, g.ended_at
       FROM game_participants p
       JOIN games g ON g.room_id = p.game_id
       WHERE ${SIGNED_IN_SEAT} AND ${HUMAN_GAME}
     ),
     first_seen AS (
       SELECT user_id, date_trunc('week', min(ended_at))::date::text AS first_week
       FROM human
       GROUP BY user_id
     ),
     weekly AS (
       SELECT DISTINCT date_trunc('week', ended_at)::date::text AS week, user_id
       FROM human
       WHERE ended_at >= ${WINDOW_START} AND ended_at < $1::timestamptz
     )
     SELECT w.week,
       count(*)::int AS players,
       count(*) FILTER (WHERE f.first_week = w.week)::int AS new_players
     FROM weekly w
     JOIN first_seen f USING (user_id)
     GROUP BY w.week`,
    [now, weeks],
  );
  return new Map(
    result.rows.map((row) => [
      isoDate(row.week),
      { players: row.players, newPlayers: row.new_players },
    ]),
  );
}

// Rolling 28-day distinct signed-in players, sampled at each week's end (the
// current week samples at `now`). One correlated count per week; fine at this
// table size, revisit if games passes a few hundred thousand rows.
async function collectActive28dByWeek(
  db: Queryable,
  now: Date,
  weeks: number,
): Promise<Map<string, number>> {
  const result = await db.query<{ week: Date | string; n: number }>(
    `WITH weeks AS (
       SELECT generate_series(
         ${WINDOW_START},
         date_trunc('week', $1::timestamptz),
         INTERVAL '1 week'
       ) AS week_start
     )
     SELECT weeks.week_start::date::text AS week,
       (SELECT count(DISTINCT p.subject_id)
          FROM game_participants p
          JOIN games g ON g.room_id = p.game_id
          WHERE ${SIGNED_IN_SEAT} AND ${HUMAN_GAME}
            AND g.ended_at < LEAST(weeks.week_start + INTERVAL '1 week', $1::timestamptz)
            AND g.ended_at >= LEAST(weeks.week_start + INTERVAL '1 week', $1::timestamptz)
                              - INTERVAL '28 days')::int AS n
     FROM weeks
     ORDER BY weeks.week_start`,
    [now, weeks],
  );
  return new Map(result.rows.map((row) => [isoDate(row.week), row.n]));
}

type ActivityWeek = {
  newAccounts: number;
  puzzleSessions: number;
  puzzleSolves: number;
  puzzleAttempts: number;
  studiesCreated: number;
  studyChaptersCreated: number;
  practiceSolves: number;
  chatLines: number;
  dmMessages: number;
  correspondenceSeeks: number;
  newPatrons: number;
};

// One UNION of per-table weekly counts rather than eleven round trips. Each
// arm is (week, metric, n); the map is assembled here.
async function collectActivityByWeek(
  db: Queryable,
  now: Date,
  weeks: number,
): Promise<Map<string, ActivityWeek>> {
  const arm = (metric: string, table: string, column: string, where = 'true') =>
    `SELECT date_trunc('week', ${column})::date::text AS week, '${metric}' AS metric, count(*)::int AS n
     FROM ${table}
     WHERE ${where} AND ${column} >= ${WINDOW_START} AND ${column} < $1::timestamptz
     GROUP BY week`;
  const result = await db.query<{ week: Date | string; metric: keyof ActivityWeek; n: number }>(
    [
      arm('newAccounts', 'users', 'created_at', COUNTED_USER),
      // Distinct visits that started at least one puzzle, not rows: a session
      // that views five puzzles is one session.
      `SELECT date_trunc('week', started_at)::date::text AS week, 'puzzleSessions' AS metric,
              count(DISTINCT session_id)::int AS n
       FROM puzzle_quality_sessions
       WHERE started_at IS NOT NULL
         AND started_at >= ${WINDOW_START} AND started_at < $1::timestamptz
       GROUP BY week`,
      arm('puzzleSolves', 'puzzle_quality_sessions', 'completed_at', `outcome = 'solved'`),
      arm('puzzleAttempts', 'puzzle_attempts', 'created_at'),
      arm('studiesCreated', 'studies', 'created_at'),
      arm('studyChaptersCreated', 'study_chapters', 'created_at'),
      arm('practiceSolves', 'practice_progress', 'solved_at'),
      arm('chatLines', 'chat_lines', 'created_at', 'hidden_at IS NULL AND shadow = false'),
      arm('dmMessages', 'dm_messages', 'created_at'),
      arm('correspondenceSeeks', 'correspondence_seeks', 'created_at'),
      arm('newPatrons', 'users', 'patron_since', `patron_since IS NOT NULL AND ${COUNTED_USER}`),
    ].join('\nUNION ALL\n'),
    [now, weeks],
  );
  const out = new Map<string, ActivityWeek>();
  for (const row of result.rows) {
    const key = isoDate(row.week);
    const entry = out.get(key) ?? {
      newAccounts: 0,
      puzzleSessions: 0,
      puzzleSolves: 0,
      puzzleAttempts: 0,
      studiesCreated: 0,
      studyChaptersCreated: 0,
      practiceSolves: 0,
      chatLines: 0,
      dmMessages: 0,
      correspondenceSeeks: 0,
      newPatrons: 0,
    };
    entry[row.metric] = row.n;
    out.set(key, entry);
  }
  return out;
}

// Every week column is cast to text in SQL so a non-UTC process (local dev on a
// laptop) cannot shift a Monday to the Sunday before it through a Date round
// trip. The Date branch is a guard for a driver type parser we do not set.
function isoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}
