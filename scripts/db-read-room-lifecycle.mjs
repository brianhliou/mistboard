#!/usr/bin/env node
import fs from 'node:fs';
// Read-only: room_lifecycle_audit rows (server shutdowns, pauses, resumes,
// orphan recovery) for a set of room ids, plus every shutdown that had games
// live. SELECTs only (db-read- prefix contract).
//
//   env -u RAILWAY_API_TOKEN railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/db-read-room-lifecycle.mjs <ids.json>'
import pg from 'pg';

const ids = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const t = async (title, sql, params = []) => {
  const r = await c.query(sql, params);
  console.log(`\n== ${title} (${r.rowCount})`);
  for (const row of r.rows) console.log(JSON.stringify(row));
};
await t(
  'audit kinds overall',
  `SELECT kind, count(*)::int n, min(occurred_at) first, max(occurred_at) last FROM room_lifecycle_audit GROUP BY 1 ORDER BY n DESC`,
);
await t(
  'rows for the listed rooms',
  `SELECT room_id, kind, occurred_at, payload FROM room_lifecycle_audit WHERE room_id = ANY($1) ORDER BY occurred_at`,
  [ids],
);
await t(
  'shutdowns with live games, by day',
  `SELECT date_trunc('day', occurred_at)::date d, count(*)::int shutdowns, sum((payload->>'activeGames')::int)::int active_games_sum FROM room_lifecycle_audit WHERE kind='server_shutdown_requested' GROUP BY 1 ORDER BY 1 DESC LIMIT 40`,
);
await t(
  'listed rooms whose [started, ended] window contains a shutdown',
  `
  SELECT g.room_id, g.termination, g.ended_at, a.occurred_at AS shutdown_at, a.payload->>'activeGames' AS active
  FROM games g JOIN room_lifecycle_audit a ON a.kind='server_shutdown_requested' AND a.occurred_at BETWEEN g.started_at AND g.ended_at
  WHERE g.room_id = ANY($1) ORDER BY g.ended_at`,
  [ids],
);
await c.end();
