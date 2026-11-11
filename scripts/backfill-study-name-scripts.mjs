#!/usr/bin/env node
// Operator: npm run prod:db -- node scripts/backfill-study-name-scripts.mjs --study ID [--apply]
// Dry-run by default. Decision: 2026-11-06. Never runs on import.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { repairStudyNameOverlays } from './lib/study-name-scripts.mjs';

const FIRST_PARTY_STUDIES = new Map([
  ['Every Xiangqi Champion', '/blog/xiangqi-champions'],
  ['Every Xiangqi World Champion', '/blog/xiangqi-world-championship'],
]);

export async function backfillStudyNames(client, { study, apply = false }) {
  await client.query('BEGIN');
  try {
    const { rows: studies } = await client.query(
      `SELECT s.id, s.name, s.description, s.i18n, u.account_role
       FROM studies s JOIN users u ON u.id = s.owner_id WHERE s.id = $1 FOR UPDATE OF s`,
      [study],
    );
    const source = studies[0];
    const companion = source && FIRST_PARTY_STUDIES.get(source.name);
    if (!companion || source.account_role !== 'admin' || !source.description.includes(companion)) {
      throw new Error('study must be an identified first-party companion study owned by an admin');
    }
    const changes = [];
    const meta = repairStudyNameOverlays(source);
    if (meta.changes.length) {
      changes.push({ study, changes: meta.changes });
      if (apply)
        await client.query(
          'UPDATE studies SET i18n = $2::jsonb, updated_at = now() WHERE id = $1',
          [study, JSON.stringify(meta.next.i18n)],
        );
    }
    const { rows } = await client.query(
      `SELECT id, variant, tags, i18n, root, version FROM study_chapters WHERE study_id = $1 AND variant = 'xiangqi' ORDER BY ordinal, id FOR UPDATE`,
      [study],
    );
    for (const chapter of rows) {
      if (chapter.variant !== 'xiangqi') continue;
      const { next, changes: edits } = repairStudyNameOverlays(chapter);
      if (!edits.length) continue;
      changes.push({ chapter: chapter.id, changes: edits });
      if (apply) {
        await client.query(
          `UPDATE study_chapters SET i18n = $3::jsonb, root = $4::jsonb,
           version = version + 1, updated_at = now() WHERE study_id = $1 AND id = $2`,
          [study, chapter.id, JSON.stringify(next.i18n ?? {}), JSON.stringify(next.root)],
        );
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { study, mode: apply ? 'apply' : 'dry-run', changes };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: { study: { type: 'string' }, apply: { type: 'boolean', default: false } },
  });
  if (!values.study) throw new Error('Usage: --study ID [--apply]');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    console.log(JSON.stringify(await backfillStudyNames(client, values), null, 2));
  } finally {
    await client.end();
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(() => {
    console.error('study name backfill failed; verify the study identity and database connection');
    process.exitCode = 1;
  });
}
