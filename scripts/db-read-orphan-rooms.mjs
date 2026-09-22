#!/usr/bin/env node
// Read-only: rooms that have move events but no games row (a game that was
// never finalised: the server that held it went away). SELECTs only
// (db-read- prefix contract).
//
//   env -u RAILWAY_API_TOKEN railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/db-read-orphan-rooms.mjs [--days 90]'
import pg from 'pg';

const days = Number(process.argv[process.argv.indexOf('--days') + 1] || 90) || 90;
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const t = async (title, sql) => {
  const r = await c.query(sql);
  console.log(`\n== ${title} (${r.rowCount})`);
  console.table(r.rows);
};
await t(
  'event types (sample of names)',
  `SELECT type, count(*)::int n FROM events WHERE created_at >= now() - interval '${days} days' GROUP BY 1 ORDER BY n DESC LIMIT 25`,
);
const ORPH = `
  WITH r AS (
    SELECT e.room_id, count(*) FILTER (WHERE e.type ILIKE '%move%')::int AS moves, min(e.created_at) AS first_at, max(e.created_at) AS last_at,
           split_part(e.room_id, '_', 1) AS prefix
    FROM events e LEFT JOIN games g ON g.room_id = e.room_id
    WHERE g.room_id IS NULL AND e.created_at >= now() - interval '${days} days'
    GROUP BY e.room_id)`;
await t(
  'orphan rooms by prefix and move band',
  `${ORPH}
  SELECT prefix, CASE WHEN moves = 0 THEN '0' WHEN moves <= 2 THEN '1-2' WHEN moves <= 9 THEN '3-9' ELSE '10+' END AS moves_band,
         count(*)::int rooms FROM r GROUP BY 1,2 ORDER BY 1,2`,
);
await t(
  'orphan rooms with 3+ moves, by week',
  `${ORPH}
  SELECT date_trunc('week', last_at)::date wk, prefix, count(*)::int rooms, round(avg(moves))::int avg_moves FROM r WHERE moves >= 3 GROUP BY 1,2 ORDER BY 1 DESC, 2 LIMIT 40`,
);
await t(
  'orphan xiangqi/jieqi/banqi rooms with 3+ moves (latest 40)',
  `${ORPH}
  SELECT room_id, moves, first_at, last_at FROM r WHERE moves >= 3 AND prefix IN ('xq','jq','bq','fxq','dxq') ORDER BY last_at DESC LIMIT 40`,
);
await c.end();
