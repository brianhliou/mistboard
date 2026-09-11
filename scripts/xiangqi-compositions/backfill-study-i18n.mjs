/**
 * Backfill study-level zh overlays (name + description) onto the classical-manual
 * studies.
 *
 * `seed-v2.mjs` never passed an `i18n` to `createStudy`, so these six studies
 * carried `{}` and served an English name and a 650-character English blurb to
 * every locale, Simplified included, while their chapters were already Chinese.
 *
 *   command railway run -s Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node backfill-study-i18n.mjs --patch <file>'
 *   ... add --apply to write.
 *
 * The column is a whole-object REPLACE (`i18n = COALESCE($n::jsonb, i18n)`), so
 * this merges per locale against what is already there rather than overwriting
 * the object. It also refuses a study whose name has moved since the patch was
 * built: the name is the identity the patch was reviewed against.
 *
 * Note `parseStudyI18n` drops a locale entry whose fields are all blank, so an
 * overlay must carry a real string or it writes and then silently vanishes on
 * read.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: { patch: { type: 'string' }, apply: { type: 'boolean', default: false } },
});
if (!values.patch) {
  console.error('usage: backfill-study-i18n.mjs --patch <file.json> [--apply]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set; run through `command railway run -s Postgres`');
  process.exit(1);
}

const patch = JSON.parse(readFileSync(values.patch, 'utf8'));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let written = 0;
const refused = [];

try {
  for (const row of patch) {
    const { rows } = await client.query(
      `SELECT id, slug, name, i18n FROM studies WHERE id = $1 AND slug = $2`,
      [row.studyId, row.slug],
    );
    const current = rows[0];
    if (!current) {
      refused.push(`${row.slug}: study not found`);
      continue;
    }
    const next = { ...(current.i18n ?? {}) };
    for (const [locale, fields] of Object.entries(row.i18n)) {
      if (!fields.name?.trim() || !fields.description?.trim()) {
        refused.push(`${row.slug}: ${locale} overlay is blank and would be dropped on read`);
        continue;
      }
      next[locale] = { ...(next[locale] ?? {}), ...fields };
    }
    const before = Object.keys(current.i18n ?? {});
    console.log(
      `${row.slug}  locales ${before.length ? before.join(',') : '(none)'} -> ${Object.keys(next).join(',')}`,
    );
    console.log(`   zh-Hans name: ${row.i18n['zh-Hans'].name}`);
    console.log(`   zh-Hant name: ${row.i18n['zh-Hant'].name}`);
    if (!values.apply) continue;
    await client.query(`UPDATE studies SET i18n = $2::jsonb, updated_at = now() WHERE id = $1`, [
      row.studyId,
      JSON.stringify(next),
    ]);
    written += 1;
  }

  console.log(
    `\n${patch.length} in patch: ${values.apply ? `${written} written` : 'dry run'}, ` +
      `${refused.length} refused`,
  );
  for (const r of refused) console.log(`  REFUSED ${r}`);
  if (!values.apply) console.log('nothing written. Re-run with --apply.');
} finally {
  await client.end();
}
