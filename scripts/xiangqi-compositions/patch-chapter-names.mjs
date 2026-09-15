#!/usr/bin/env node
/**
 * Rename seeded chapters whose English title changed in the edits file after
 * seeding (the 120-character abridgements), matching by study slug + the
 * chapter's leading number. Root comments are left alone: they quote the full
 * title, which is the point of keeping the full form there.
 *
 *   DATABASE_URL=... node patch-chapter-names.mjs --edits <slug>.edits.json --data <slug>.json --slugs a,b [--apply]
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    edits: { type: 'string' },
    data: { type: 'string' },
    slugs: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
if (!values.edits || !values.data || !values.slugs || !process.env.DATABASE_URL) {
  console.error(
    'usage: DATABASE_URL=... patch-chapter-names.mjs --edits <file> --data <file> --slugs a,b [--apply]',
  );
  process.exit(2);
}
const edits = JSON.parse(readFileSync(values.edits, 'utf8'));
const single = edits.book?.singleStudy === true;
const volById = new Map(
  JSON.parse(readFileSync(values.data, 'utf8')).map((r) => [String(r.id), single ? 1 : r.vol]),
);
const want = new Map();
for (const [id, r] of Object.entries(edits.records ?? {})) {
  if (r && typeof r === 'object' && r.publish)
    want.set(`${volById.get(id) ?? 1}:${r.n}`, `${r.n}. ${r.en}`);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let changed = 0;
try {
  for (const [vi, slug] of values.slugs.split(',').filter(Boolean).entries()) {
    const study = await client.query('SELECT id FROM studies WHERE slug = $1', [slug]);
    if (study.rows.length !== 1) throw new Error(`${slug}: study not found`);
    const chapters = await client.query('SELECT id, name FROM study_chapters WHERE study_id = $1', [
      study.rows[0].id,
    ]);
    for (const c of chapters.rows) {
      const m = /^(\d+)\.\s/.exec(c.name);
      if (!m) continue;
      const next = want.get(`${vi + 1}:${Number(m[1])}`);
      if (!next || next === c.name) continue;
      console.log(`${slug}: "${c.name}"\n  -> "${next}"`);
      changed += 1;
      if (values.apply)
        await client.query(
          'UPDATE study_chapters SET name = $2, updated_at = now() WHERE id = $1',
          [c.id, next],
        );
    }
  }
} finally {
  await client.end();
}
console.log(
  `${changed} chapter name(s) ${values.apply ? 'updated' : 'would change (pass --apply)'}`,
);
