#!/usr/bin/env node
// Fill games.initial_ms / increment_ms for finished Fog Xiangqi games.
//
// buildDarkXiangqiGameSummary never wrote the clock, so every dark-xiangqi row
// stored NULL and the review header, the /database time-control filter,
// profile lists and exports all read those 5+5 games as untimed. The room's
// own room-created event still carries the time control it was played at;
// this copies that onto the games row. Rows whose room-created event has no
// initialMs (untimed or correspondence) stay NULL, as the fixed builder
// would leave them.
//
//   node scripts/backfill-dark-xiangqi-clocks.mjs            # dry run
//   node scripts/backfill-dark-xiangqi-clocks.mjs --apply    # writes
//
// Idempotent: only rows with initial_ms IS NULL are touched. Against
// production, hand the connection to Railway rather than your shell:
//
//   railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/backfill-dark-xiangqi-clocks.mjs --apply'

import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
  },
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const CANDIDATES = `
  SELECT g.room_id,
         (e.payload -> 'timeControl' ->> 'initialMs')::int   AS initial_ms,
         (e.payload -> 'timeControl' ->> 'incrementMs')::int AS increment_ms
  FROM games g
  JOIN LATERAL (
    SELECT payload FROM events
    WHERE room_id = g.room_id AND type = 'room-created'
    ORDER BY seq ASC LIMIT 1
  ) e ON true
  WHERE g.variant = 'dark-xiangqi'
    AND g.initial_ms IS NULL`;

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  const nullRows = await pool.query(
    `SELECT count(*)::int AS n FROM games WHERE variant = 'dark-xiangqi' AND initial_ms IS NULL`,
  );
  const candidates = await pool.query(CANDIDATES);
  const fillable = candidates.rows.filter((row) => row.initial_ms !== null);
  const byControl = new Map();
  for (const row of fillable) {
    const key = `${row.initial_ms / 60_000}+${(row.increment_ms ?? 0) / 1000}`;
    byControl.set(key, (byControl.get(key) ?? 0) + 1);
  }
  console.log(`dark-xiangqi rows with NULL clock: ${nullRows.rows[0].n}`);
  console.log(`  with a room-created event: ${candidates.rows.length}`);
  console.log(`  fillable (event has a time control): ${fillable.length}`);
  for (const [key, n] of [...byControl].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${key}: ${n}`);
  }
  if (!values.apply) {
    console.log('dry run; pass --apply to write');
  } else {
    const updated = await pool.query(
      `UPDATE games g
       SET initial_ms = c.initial_ms, increment_ms = c.increment_ms
       FROM (${CANDIDATES}) c
       WHERE g.room_id = c.room_id
         AND g.initial_ms IS NULL
         AND c.initial_ms IS NOT NULL`,
    );
    console.log(`updated ${updated.rowCount} rows`);
  }
} finally {
  await pool.end();
}
