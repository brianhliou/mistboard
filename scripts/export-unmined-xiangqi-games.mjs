#!/usr/bin/env node
// Export cleared historical xiangqi games that no mining run has touched, as
// the { games } file the local miner reads (`--source json --games <file>`).
//
// Read only: the session is opened READ ONLY, so a mistake here cannot write.
// Run against production through the tunnel:
//
//   npm run prod:db -- node scripts/export-unmined-xiangqi-games.mjs \
//     --out ../xiangqi-corpus/elephantchess-unmined/unmined.json
//
// "Unmined" is the same definition scripts/mine-remainder.mjs uses: a
// cleared source, a completed import batch, a source game id, no quality
// flags, and no xiangqi_puzzle_mining_games row in a run that did not fail or
// get canceled. The games stay outside git (their source's license travels
// with the corpus, not the repo).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    'source-slug': { type: 'string', default: 'elephantchess-pvp' },
    limit: { type: 'string', default: '0' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || !values.out) {
  console.log(
    'usage: node scripts/export-unmined-xiangqi-games.mjs --out <file.json> [--source-slug elephantchess-pvp] [--limit N]',
  );
  process.exit(values.help ? 0 : 1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (run through npm run prod:db -- ...)');
  process.exit(1);
}

const limit = Number.parseInt(values.limit, 10) || 0;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const { rows } = await client.query(
    `SELECT g.id, g.source_game_id, g.source_url, g.moves, g.event_name,
            to_char(g.played_on, 'YYYY-MM-DD') AS played_on, g.result,
            g.red_name_raw, g.black_name_raw, s.slug
       FROM historical_xiangqi_games g
       JOIN historical_xiangqi_sources s ON s.id = g.source_id
       JOIN historical_xiangqi_import_batches b ON b.id = g.import_batch_id
      WHERE s.slug = $1 AND s.license_status = 'cleared'
        AND b.status = 'completed' AND g.source_game_id IS NOT NULL
        AND cardinality(g.quality_flags) = 0
        AND NOT EXISTS (
          SELECT 1 FROM xiangqi_puzzle_mining_games mg
            JOIN xiangqi_puzzle_mining_runs mr ON mr.id = mg.run_id
           WHERE mg.historical_game_id = g.id
             AND mr.status NOT IN ('failed', 'canceled'))
      ORDER BY g.id
      ${limit > 0 ? 'LIMIT $2' : ''}`,
    limit > 0 ? [values['source-slug'], limit] : [values['source-slug']],
  );
  await client.query('ROLLBACK');
  const games = rows.map((row) => ({
    id: row.id,
    moves: row.moves,
    meta: {
      event: row.event_name,
      playedOn: row.played_on,
      result: row.result,
      redName: row.red_name_raw,
      blackName: row.black_name_raw,
      sourceSlug: row.slug,
      sourceUrl: row.source_url,
      sourceGameId: row.source_game_id,
    },
  }));
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), sourceSlug: values['source-slug'], games })}\n`,
  );
  console.log(JSON.stringify({ out, games: games.length }));
} finally {
  await client.end();
}
