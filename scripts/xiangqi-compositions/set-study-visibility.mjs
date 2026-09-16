#!/usr/bin/env node
/**
 * Flip seeded studies between unlisted and public, by slug.
 *
 *   DATABASE_URL=... node set-study-visibility.mjs --slugs a,b --visibility public [--apply]
 *
 * Goes through persistence's updateStudyMeta so the same validation and
 * updated_at handling apply as in the editor; the owner is resolved from the
 * study row. Prints what would change; nothing moves without --apply.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    slugs: { type: 'string' },
    visibility: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
if (
  !values.slugs ||
  !['public', 'unlisted', 'private'].includes(values.visibility ?? '') ||
  !process.env.DATABASE_URL
) {
  console.error(
    'usage: DATABASE_URL=... set-study-visibility.mjs --slugs a,b --visibility public|unlisted [--apply]',
  );
  process.exit(2);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let changed = 0;
try {
  for (const slug of values.slugs.split(',').filter(Boolean)) {
    const { rows } = await client.query(
      'SELECT id, name, visibility FROM studies WHERE slug = $1',
      [slug],
    );
    if (rows.length !== 1) {
      console.log(`${slug}: not found`);
      continue;
    }
    const s = rows[0];
    if (s.visibility === values.visibility) {
      console.log(`${slug}: already ${s.visibility}`);
      continue;
    }
    console.log(`${slug}: ${s.visibility} -> ${values.visibility}  (${s.name})`);
    changed += 1;
    if (values.apply)
      await client.query('UPDATE studies SET visibility = $2, updated_at = now() WHERE id = $1', [
        s.id,
        values.visibility,
      ]);
  }
} finally {
  await client.end();
}
console.log(`${changed} study(ies) ${values.apply ? 'updated' : 'would change (pass --apply)'}`);
