#!/usr/bin/env node
// Delete one xiangqi broadcast tour: a stray import (a partial copy of a real
// event made from a single game link, a test tour) that clutters the index.
// Without --yes it only shows what the tour holds; with it, the tour, its
// rounds, its boards and its sync logs go in one transaction, the same four
// tables as persistence.deleteXiangqiBroadcastTour and the admin route
// DELETE /api/admin/xiangqi/broadcasts/<slug>.
//
//   node scripts/delete-broadcast-tour.mjs <slug>          # show it, change nothing
//   node scripts/delete-broadcast-tour.mjs <slug> --yes    # delete it
//
// Against production, hand the connection to Railway rather than putting it in
// your shell. The connection string is referenced by name inside the child and
// never enters this process or the terminal:
//
//   railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/delete-broadcast-tour.mjs <slug>'
//
// A real event is not a stray, even with no games yet: an empty tour is how an
// event's page exists before its first record.

import { parseArgs } from 'node:util';
import pg from 'pg';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { yes: { type: 'boolean', default: false } },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const slug = positionals[0];
if (!slug || positionals.length > 1) {
  fail('Usage: node scripts/delete-broadcast-tour.mjs <slug> [--yes]');
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL is not set.');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const tour = await client.query(
    'SELECT slug, name, source_url, starts_at, ends_at FROM xiangqi_broadcast_tours WHERE slug = $1',
    [slug],
  );
  if (tour.rowCount === 0) fail(`No broadcast tour ${slug}.`);
  // One client runs one query at a time.
  const counts = [];
  for (const table of [
    'xiangqi_broadcast_rounds',
    'xiangqi_broadcast_boards',
    'xiangqi_broadcast_sync_logs',
  ]) {
    const result = await client.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE tour_slug = $1`,
      [slug],
    );
    counts.push(result.rows[0].n);
  }
  const [rounds, boards, logs] = counts;
  const row = tour.rows[0];
  console.log(
    JSON.stringify({
      slug: row.slug,
      name: row.name,
      sourceUrl: row.source_url,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      rounds,
      boards,
      syncLogs: logs,
    }),
  );
  if (!values.yes) {
    console.log('Nothing changed. Pass --yes to delete it.');
  } else {
    await client.query('BEGIN');
    for (const table of [
      'xiangqi_broadcast_sync_logs',
      'xiangqi_broadcast_boards',
      'xiangqi_broadcast_rounds',
    ]) {
      await client.query(`DELETE FROM ${table} WHERE tour_slug = $1`, [slug]);
    }
    await client.query('DELETE FROM xiangqi_broadcast_tours WHERE slug = $1', [slug]);
    await client.query('COMMIT');
    console.log(`Deleted ${slug}: ${rounds} rounds, ${boards} boards, ${logs} sync logs.`);
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  await client.end();
}
