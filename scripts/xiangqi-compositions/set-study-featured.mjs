#!/usr/bin/env node
/**
 * Set the Staff picks list, by study id.
 *
 *   DATABASE_URL=... node set-study-featured.mjs --ids a,b,c [--apply]
 *   DATABASE_URL=... node set-study-featured.mjs --ids a,b --add [--apply]
 *
 * Default is the WHOLE list: any study featured today and absent from --ids is
 * unfeatured, so the flag describes the shelf rather than appending to it. The
 * picks are a doorway, and a doorway that only ever grows stops being one.
 * --add leaves the existing picks alone and only adds.
 *
 * featured_at is set with COALESCE, so re-running does not reorder a pick that
 * is already there (Staff picks sorts by featured_at DESC). Only a public study
 * can be featured, which mirrors setStudyFeatured in persistence-studies.ts.
 * Prints what would change; nothing moves without --apply.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    ids: { type: 'string' },
    add: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
  },
});
if (!values.ids || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=... set-study-featured.mjs --ids a,b,c [--add] [--apply]');
  process.exit(2);
}

const wanted = values.ids
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let changed = 0;
try {
  const { rows: current } = await client.query(
    'SELECT id, name FROM studies WHERE featured_at IS NOT NULL ORDER BY featured_at DESC',
  );
  const featured = new Set(current.map((row) => row.id));

  for (const id of wanted) {
    const { rows } = await client.query('SELECT id, name, visibility FROM studies WHERE id = $1', [
      id,
    ]);
    if (rows.length !== 1) {
      console.log(`${id}: not found`);
      continue;
    }
    const study = rows[0];
    if (study.visibility !== 'public') {
      console.log(`${id}: NOT public (${study.visibility}) — skipped  (${study.name})`);
      continue;
    }
    if (featured.has(id)) {
      console.log(`${id}: already featured  (${study.name})`);
      continue;
    }
    console.log(`${id}: feature  (${study.name})`);
    changed += 1;
    if (values.apply) {
      await client.query(
        'UPDATE studies SET featured_at = COALESCE(featured_at, now()) WHERE id = $1',
        [id],
      );
    }
  }

  if (!values.add) {
    for (const row of current) {
      if (wanted.includes(row.id)) continue;
      console.log(`${row.id}: unfeature  (${row.name})`);
      changed += 1;
      if (values.apply) {
        await client.query('UPDATE studies SET featured_at = NULL WHERE id = $1', [row.id]);
      }
    }
  }
} finally {
  await client.end();
}
console.log(`${changed} study(ies) ${values.apply ? 'updated' : 'would change (pass --apply)'}`);
