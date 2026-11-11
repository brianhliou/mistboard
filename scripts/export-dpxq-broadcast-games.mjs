#!/usr/bin/env node
// Export finished xiangqi broadcast boards whose tour came from DPXQ
// (东萍象棋网) as the { games } file the local miner reads
// (`--source json --games <file>`), for puzzle mining under DPXQ's terms:
// every puzzle credits 东萍象棋网 with an http link to the game (#712).
//
// Read only: the session is opened READ ONLY, so a mistake here cannot write.
//
//   npm run prod:db -- node scripts/export-dpxq-broadcast-games.mjs \
//     --out ../xiangqi-corpus/dpxq-broadcasts/boards.json
//
// A board's own source_url is the link the credit points at; a board without
// one still exports, and the miner refuses to build a puzzle from it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || !values.out) {
  console.log('usage: node scripts/export-dpxq-broadcast-games.mjs --out <file.json>');
  process.exit(values.help ? 0 : 1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (run through npm run prod:db -- ...)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const { rows } = await client.query(
    `SELECT b.id, b.source_board_id, b.source_url, b.moves, b.result, b.ply_count,
            b.red, b.black, t.slug AS tour_slug, t.name AS tour_name, t.source_url AS tour_url,
            to_char(coalesce(r.starts_at, t.starts_at), 'YYYY-MM-DD') AS played_on
       FROM xiangqi_broadcast_boards b
       JOIN xiangqi_broadcast_tours t ON t.slug = b.tour_slug
       JOIN xiangqi_broadcast_rounds r ON r.id = b.round_id
      WHERE (t.source_url ILIKE '%dpxq%' OR b.source_url ILIKE '%dpxq.com%')
        AND b.ply_count > 0
      ORDER BY t.slug, b.id`,
  );
  await client.query('ROLLBACK');
  const name = (side) => (side && typeof side === 'object' ? (side.name ?? null) : null);
  const games = rows.map((row) => ({
    id: `xqb_${row.id}`,
    moves: row.moves,
    meta: {
      event: row.tour_name,
      playedOn: row.played_on,
      result: row.result === '*' ? null : row.result,
      redName: name(row.red),
      blackName: name(row.black),
      sourceSlug: 'dpxq',
      sourceUrl: row.source_url,
      sourceGameId: row.source_board_id,
    },
  }));
  const tours = new Set(rows.map((row) => row.tour_slug));
  const withLink = rows.filter((row) => /dpxq\.com/i.test(row.source_url ?? '')).length;
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), sourceSlug: 'dpxq', games })}\n`,
  );
  console.log(JSON.stringify({ out, tours: tours.size, games: games.length, withLink }));
} finally {
  await client.end();
}
