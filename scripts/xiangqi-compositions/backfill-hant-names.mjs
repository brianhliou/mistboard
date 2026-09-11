/**
 * Backfill zh-Hant chapter names onto the classical-manual studies.
 *
 * Why this exists: `localizedField` falls back to the BASE field when a locale
 * overlay is missing, and these chapters' base names are English. So a
 * Traditional reader was served an English page while a Simplified reader got
 * Chinese -- verified live on /zh-hant/study/0Qi14WbN.
 *
 * The Traditional forms come from OpenCC s2tw run outside the repo, then a fork
 * audit, which is how apps/web/src/article-i18n.ts's Hant block was produced
 * (see its note at the top of the zh-Hant section). The repo deliberately has no
 * general S->T converter: study-tag-i18n.mjs calls blanket sentence conversion
 * "exactly the bug this is repairing", because person names must not convert.
 * That hazard does not apply to four-character composition titles, but the audit
 * still ran and still found four wrong characters in 547 names.
 *
 * Takes the audited patch as input rather than converting here, so what ships is
 * reviewable as data.
 *
 *   command railway run -s Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node backfill-hant-names.mjs --patch <file>'
 *   ... add --apply to write.
 *
 * i18n is a whole-object REPLACE in both the route and the column
 * (`i18n = COALESCE($n::jsonb, i18n)`), never a merge, so every write here is a
 * read-modify-write of the existing overlay. Dropping zh-Hans would be silent.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: { patch: { type: 'string' }, apply: { type: 'boolean', default: false } },
});
if (!values.patch) {
  console.error('usage: backfill-hant-names.mjs --patch <file.json> [--apply]');
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
let already = 0;
const refused = [];

try {
  for (const row of patch) {
    const { rows } = await client.query(
      `SELECT c.id, c.name, c.i18n
         FROM study_chapters c JOIN studies s ON s.id = c.study_id
        WHERE c.id = $1 AND s.id = $2`,
      [row.chapterId, row.studyId],
    );
    const current = rows[0];
    if (!current) {
      refused.push(`${row.slug}/${row.name}: chapter not found`);
      continue;
    }
    // Refuse a row whose content has moved since the patch was generated. The
    // patch names the exact base name and Simplified overlay it was built from.
    if (current.name !== row.name) {
      refused.push(`${row.slug}/${row.name}: base name is now ${current.name}`);
      continue;
    }
    const i18n = current.i18n ?? {};
    if (i18n['zh-Hans']?.name !== row.hans) {
      refused.push(
        `${row.slug}/${row.name}: zh-Hans is ${i18n['zh-Hans']?.name}, expected ${row.hans}`,
      );
      continue;
    }
    if (i18n['zh-Hant']?.name === row.hant) {
      already += 1;
      continue;
    }
    const next = { ...i18n, 'zh-Hant': { ...(i18n['zh-Hant'] ?? {}), name: row.hant } };
    if (!values.apply) {
      if (written < 5) console.log(`  ${row.hans}  ->  ${row.hant}   [${row.name}]`);
      written += 1;
      continue;
    }
    await client.query(
      `UPDATE study_chapters SET i18n = $2::jsonb, updated_at = now() WHERE id = $1`,
      [row.chapterId, JSON.stringify(next)],
    );
    written += 1;
  }

  console.log(
    `\n${patch.length} in patch: ${written} ${values.apply ? 'written' : 'would write'}, ` +
      `${already} already correct, ${refused.length} refused`,
  );
  for (const r of refused.slice(0, 20)) console.log(`  REFUSED ${r}`);
  if (!values.apply) console.log('dry run: nothing written. Re-run with --apply.');
} finally {
  await client.end();
}
