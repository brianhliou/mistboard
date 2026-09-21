#!/usr/bin/env node
// Read-only: where first bot games are abandoned (#421). SELECTs only; the
// `db-read-` prefix is the contract the permission rule in
// .claude/settings.local.json relies on, so nothing in this file may write.
//
//   env -u RAILWAY_API_TOKEN railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/db-read-aborts.mjs [--days 42]'
//
// The schema has no per-move timestamps, so "wall-clock since the last move"
// and "clock remaining" from the issue are not answerable; what is: abort rate
// by variant / bot tier / time class / guest-vs-account, the ply at which
// aborted games stopped, game duration, and the whale as a control.

import pg from 'pg';

const days = Number(process.argv[process.argv.indexOf('--days') + 1] || 42) || 42;
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Same exclusions as persistence-counted-games.ts, minus the ply floor (the
// ply-0/1 rows are exactly the bounces this read wants to see).
const HUMAN = `
  g.mode IN ('pvp','pve')
  AND g.started_at >= now() - interval '${days} days'
  AND g.ended_at >= '2026-06-01'::timestamptz
  AND NOT EXISTS (
    SELECT 1 FROM game_participants xp
    WHERE xp.game_id = g.room_id AND (
      (xp.subject_type = 'user' AND EXISTS (SELECT 1 FROM users xu WHERE xu.id = xp.subject_id AND xu.stats_excluded_at IS NOT NULL))
      OR (xp.subject_type = 'guest' AND xp.subject_id IS NOT NULL AND EXISTS (SELECT 1 FROM stats_excluded_devices xd WHERE xd.device_id = xp.subject_id))
    ))`;

// Per game: the human seat(s) and the engine seat, flattened.
const BASE = `
  WITH g2 AS (
    SELECT g.*,
      (SELECT string_agg(p.subject_type, '+' ORDER BY p.color) FROM game_participants p WHERE p.game_id = g.room_id AND p.subject_type IN ('guest','user')) AS human_kinds,
      (SELECT p.subject_id FROM game_participants p WHERE p.game_id = g.room_id AND p.subject_type = 'engine-version' LIMIT 1) AS engine,
      (SELECT p.display_name FROM game_participants p WHERE p.game_id = g.room_id AND p.subject_type = 'user' LIMIT 1) AS user_name,
      CASE WHEN g.initial_ms IS NULL THEN 'untimed'
           WHEN g.initial_ms < 180000 THEN 'bullet'
           WHEN g.initial_ms < 480000 THEN 'blitz'
           WHEN g.initial_ms < 1500000 THEN 'rapid'
           ELSE 'classical' END AS time_class,
      EXTRACT(EPOCH FROM (g.ended_at - g.started_at)) AS secs
    FROM games g WHERE ${HUMAN}
  )`;

async function table(title, sql) {
  const r = await c.query(sql);
  console.log(`\n== ${title} (${r.rowCount} rows)`);
  console.table(r.rows);
}

const whaleFilter = `AND COALESCE(user_name,'') NOT ILIKE 'tonghuiqu'`;
const pct = `round(100.0 * count(*) FILTER (WHERE status='aborted') / NULLIF(count(*),0), 1) AS abort_pct`;

await table(
  'status × termination, all human games',
  `${BASE}
  SELECT status, termination, count(*)::int AS n FROM g2 GROUP BY 1,2 ORDER BY 3 DESC`,
);

await table(
  'abort rate by variant (whale excluded)',
  `${BASE}
  SELECT variant, mode, count(*)::int AS games, count(*) FILTER (WHERE status='aborted')::int AS aborted, ${pct}
  FROM g2 WHERE true ${whaleFilter} GROUP BY 1,2 ORDER BY games DESC`,
);

await table(
  'abort rate by engine tier, pve (whale excluded)',
  `${BASE}
  SELECT engine, count(*)::int AS games, count(*) FILTER (WHERE status='aborted')::int AS aborted, ${pct}
  FROM g2 WHERE mode='pve' ${whaleFilter} GROUP BY 1 ORDER BY games DESC`,
);

await table(
  'abort rate by time class (whale excluded)',
  `${BASE}
  SELECT time_class, mode, count(*)::int AS games, count(*) FILTER (WHERE status='aborted')::int AS aborted, ${pct}
  FROM g2 WHERE true ${whaleFilter} GROUP BY 1,2 ORDER BY games DESC`,
);

await table(
  'abort rate guest vs account (whale excluded)',
  `${BASE}
  SELECT human_kinds, mode, count(*)::int AS games, count(*) FILTER (WHERE status='aborted')::int AS aborted, ${pct}
  FROM g2 WHERE true ${whaleFilter} GROUP BY 1,2 ORDER BY games DESC`,
);

await table(
  'aborted pve games: ply histogram (whale excluded)',
  `${BASE}
  SELECT variant,
    CASE WHEN ply_count <= 2 THEN '0-2 bounce' WHEN ply_count <= 9 THEN '3-9' WHEN ply_count <= 19 THEN '10-19'
         WHEN ply_count <= 39 THEN '20-39' ELSE '40+' END AS ply_band,
    count(*)::int AS n,
    round(avg(secs))::int AS avg_secs,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY secs))::int AS median_secs
  FROM g2 WHERE status='aborted' AND mode='pve' ${whaleFilter} GROUP BY 1,2 ORDER BY 1, min(ply_count)`,
);

await table(
  'aborted pve games: whose turn at the stop (ply parity) and termination',
  `${BASE}
  SELECT variant, CASE WHEN ply_count % 2 = 0 THEN 'red/white to move' ELSE 'black to move' END AS to_move,
    termination, count(*)::int AS n, round(avg(ply_count),1) AS avg_ply
  FROM g2 WHERE status='aborted' AND mode='pve' ${whaleFilter} GROUP BY 1,2,3 ORDER BY 1, n DESC`,
);

await table(
  'completed pve games for contrast: ply + duration (whale excluded)',
  `${BASE}
  SELECT variant, count(*)::int AS n, round(avg(ply_count),1) AS avg_ply,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY secs))::int AS median_secs
  FROM g2 WHERE status='completed' AND mode='pve' ${whaleFilter} GROUP BY 1 ORDER BY n DESC`,
);

await table(
  'the whale as control',
  `${BASE}
  SELECT variant, status, termination, count(*)::int AS n, round(avg(ply_count),1) AS avg_ply,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY secs))::int AS median_secs
  FROM g2 WHERE user_name ILIKE 'tonghuiqu' GROUP BY 1,2,3 ORDER BY n DESC`,
);

await table(
  'first game per human seat: abort rate (guest device or account, whale excluded)',
  `${BASE}
  , firsts AS (
    SELECT DISTINCT ON (p.subject_type, p.subject_id) p.subject_type, p.subject_id, g2.room_id, g2.status, g2.ply_count, g2.variant, g2.engine
    FROM g2 JOIN game_participants p ON p.game_id = g2.room_id AND p.subject_type IN ('guest','user')
    WHERE g2.mode='pve' ${whaleFilter}
    ORDER BY p.subject_type, p.subject_id, g2.started_at ASC)
  SELECT variant, count(*)::int AS first_games, count(*) FILTER (WHERE status='aborted')::int AS aborted,
    round(100.0 * count(*) FILTER (WHERE status='aborted') / NULLIF(count(*),0),1) AS abort_pct,
    round(avg(ply_count) FILTER (WHERE status='aborted'),1) AS avg_ply_when_aborted
  FROM firsts GROUP BY 1 ORDER BY first_games DESC`,
);

// The rows with status='aborted' turned out to be ply-0, untimed, seatless
// rooms (smoke probes), so the human "quit mid-game" signal is
// termination='abandonment' on a COMPLETED game: someone left and forfeited.
await table(
  'completed games ending by abandonment = the real mid-game quit (whale excluded)',
  `${BASE}
  SELECT variant, mode, human_kinds, count(*)::int AS games,
    count(*) FILTER (WHERE termination='abandonment')::int AS abandoned,
    round(100.0 * count(*) FILTER (WHERE termination='abandonment') / NULLIF(count(*),0),1) AS abandon_pct,
    round(avg(ply_count) FILTER (WHERE termination='abandonment'),1) AS avg_ply_abandoned,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FILTER (WHERE termination='abandonment'))::int AS median_secs_abandoned
  FROM g2 WHERE human_kinds IS NOT NULL ${whaleFilter} GROUP BY 1,2,3 ORDER BY games DESC`,
);

await table(
  'abandonment by engine tier, human pve (whale excluded)',
  `${BASE}
  SELECT variant, engine, count(*)::int AS games, count(*) FILTER (WHERE termination='abandonment')::int AS abandoned,
    round(avg(ply_count) FILTER (WHERE termination='abandonment'),1) AS avg_ply_abandoned
  FROM g2 WHERE mode='pve' AND human_kinds IS NOT NULL ${whaleFilter} GROUP BY 1,2 ORDER BY games DESC`,
);

await table(
  'abandonment ply histogram, human pve (whale excluded)',
  `${BASE}
  SELECT CASE WHEN ply_count <= 2 THEN '0-2' WHEN ply_count <= 9 THEN '3-9' WHEN ply_count <= 19 THEN '10-19'
              WHEN ply_count <= 39 THEN '20-39' ELSE '40+' END AS ply_band,
    count(*) FILTER (WHERE termination='abandonment')::int AS abandoned,
    count(*)::int AS all_games
  FROM g2 WHERE mode='pve' AND human_kinds IS NOT NULL ${whaleFilter} GROUP BY 1 ORDER BY min(ply_count)`,
);

await table(
  'first human pve game per seat: how it ended (whale excluded)',
  `${BASE}
  , firsts AS (
    SELECT DISTINCT ON (p.subject_type, p.subject_id) p.subject_type, g2.termination, g2.ply_count, g2.variant
    FROM g2 JOIN game_participants p ON p.game_id = g2.room_id AND p.subject_type IN ('guest','user')
    WHERE g2.mode='pve' ${whaleFilter}
    ORDER BY p.subject_type, p.subject_id, g2.started_at ASC)
  SELECT termination, count(*)::int AS n, round(avg(ply_count),1) AS avg_ply FROM firsts GROUP BY 1 ORDER BY n DESC`,
);

await c.end();
