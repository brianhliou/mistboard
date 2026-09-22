#!/usr/bin/env node
// Read-only: how humans fare against each bot tier. SELECTs only; the
// `db-read-` prefix is the contract the permission rule in
// .claude/settings.local.json relies on, so nothing in this file may write.
//
//   env -u RAILWAY_API_TOKEN railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/db-read-pve-levels.mjs [--variant xiangqi] [--days 120]'
//
// The EvE ladder rates tiers against a random mover; this is the human-relative
// number: win / draw / loss per tier, split by how the game ended (a flag is
// not a bot win on the board) and guest vs account.

import pg from 'pg';

const argv = process.argv;
const arg = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i === -1 ? dflt : argv[i + 1];
};
const days = Number(arg('--days', 120)) || 120;
const variant = arg('--variant', 'xiangqi');

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Same exclusions as persistence-counted-games.ts.
const HUMAN = `
  g.mode = 'pve'
  AND g.status = 'completed'
  AND g.variant = $1
  AND g.started_at >= now() - interval '${days} days'
  AND g.ended_at >= '2026-06-01'::timestamptz
  AND g.ply_count >= 2
  AND NOT EXISTS (
    SELECT 1 FROM game_participants xp
    WHERE xp.game_id = g.room_id AND (
      (xp.subject_type = 'user' AND EXISTS (SELECT 1 FROM users xu WHERE xu.id = xp.subject_id AND xu.stats_excluded_at IS NOT NULL))
      OR (xp.subject_type = 'guest' AND xp.subject_id IS NOT NULL AND EXISTS (SELECT 1 FROM stats_excluded_devices xd WHERE xd.device_id = xp.subject_id))
    ))`;

const BASE = `
  WITH g2 AS (
    SELECT g.room_id, g.result, g.termination, g.ply_count, g.initial_ms, g.started_at,
      e.subject_id AS engine, e.color AS engine_color,
      (SELECT string_agg(p.subject_type, '+' ORDER BY p.color) FROM game_participants p WHERE p.game_id = g.room_id AND p.subject_type IN ('guest','user')) AS human_kinds,
      (SELECT p.subject_id FROM game_participants p WHERE p.game_id = g.room_id AND p.subject_type IN ('guest','user') LIMIT 1) AS human_id
    FROM games g
    JOIN game_participants e ON e.game_id = g.room_id AND e.subject_type IN ('engine-version','bot')
    WHERE ${HUMAN}
  ), g3 AS (
    SELECT *,
      CASE WHEN result = 'draw' THEN 'draw'
           WHEN result = engine_color || '-wins' THEN 'bot'
           WHEN result = 'white-wins' AND engine_color = 'red' THEN 'bot'
           ELSE 'human' END AS outcome
    FROM g2
  )`;

async function table(title, sql) {
  if (argv.includes('--list')) return;
  const r = await c.query(sql, [variant]);
  console.log(`\n== ${title} (${r.rowCount} rows)`);
  console.table(r.rows);
}

// Sanity: results are '<colour>-wins' in the seat's own colour name (xiangqi
// writes 'red-wins'); a red seat is also matched against 'white-wins' in case
// an older row used the chess name. Every 'bot' row must have matching names.
await table(
  'engine colour × result (sanity)',
  `${BASE} SELECT engine_color, result, outcome, count(*)::int AS n FROM g3 GROUP BY 1,2,3 ORDER BY 1,2`,
);

const W = `count(*) FILTER (WHERE outcome='human')::int AS human_wins`;
const D = `count(*) FILTER (WHERE outcome='draw')::int AS draws`;
const L = `count(*) FILTER (WHERE outcome='bot')::int AS bot_wins`;
const PCT = `round(100.0 * count(*) FILTER (WHERE outcome='human') / NULLIF(count(*),0), 1) AS human_win_pct`;

await table(
  `human score per tier, ${variant}, last ${days} days`,
  `${BASE} SELECT engine, count(*)::int AS games, ${W}, ${D}, ${L}, ${PCT},
     round(avg(ply_count),1) AS avg_ply
   FROM g3 GROUP BY 1 ORDER BY 1`,
);

await table(
  'per tier, on-the-board endings only (no timeouts)',
  `${BASE} SELECT engine, count(*)::int AS games, ${W}, ${D}, ${L}, ${PCT}
   FROM g3 WHERE termination <> 'timeout' GROUP BY 1 ORDER BY 1`,
);

await table(
  'per tier × termination',
  `${BASE} SELECT engine, termination, outcome, count(*)::int AS n
   FROM g3 GROUP BY 1,2,3 ORDER BY 1,2,3`,
);

await table(
  'per tier, guest vs account',
  `${BASE} SELECT engine, human_kinds, count(*)::int AS games, ${W}, ${D}, ${L}, ${PCT}
   FROM g3 GROUP BY 1,2 ORDER BY 1,2`,
);

// Guest seats before migration 137 (2026-09-11) carry a NULL subject_id and
// are not people; they are counted as games but not as humans here.
await table(
  'distinct humans per tier and how the heaviest one skews it',
  `${BASE} SELECT engine, count(DISTINCT human_id)::int AS humans,
     count(*) FILTER (WHERE human_id IS NULL)::int AS unidentified_guest_games,
     count(*)::int AS games,
     COALESCE((SELECT max(cnt) FROM (SELECT count(*) AS cnt FROM g3 g4 WHERE g4.engine = g3.engine AND g4.human_id IS NOT NULL GROUP BY g4.human_id) t), 0)::int AS top_human_games
   FROM g3 GROUP BY 1 ORDER BY 1`,
);

await table(
  'per tier by month',
  `${BASE} SELECT to_char(date_trunc('month', started_at), 'YYYY-MM') AS month, engine,
     count(*)::int AS games, ${W}, ${L}, ${PCT}
   FROM g3 GROUP BY 1,2 ORDER BY 1,2`,
);

// --list: one JSON line per game for downstream replay/eval scripts.
if (argv.includes('--list')) {
  const r = await c.query(
    `${BASE} SELECT room_id, engine, engine_color, human_kinds, termination, outcome, ply_count, initial_ms, started_at FROM g3 ORDER BY started_at`,
    [variant],
  );
  for (const row of r.rows) console.log(JSON.stringify(row));
}

await c.end();
