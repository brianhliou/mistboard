#!/usr/bin/env node
// npm run prod:db -- node scripts/study-chapter-decisions.mjs --study ID --chapter ID --file luck.json [--apply]
// Dry run by default. Luck grades the reveal only, never a face-down victim.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { tsImport } from 'tsx/esm/api';

const { validateStudyDecisions } = await tsImport(
  '../apps/server/src/study-chapter-decisions.ts',
  import.meta.url,
);
const { values } = parseArgs({
  options: {
    study: { type: 'string' },
    chapter: { type: 'string' },
    file: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
if (!values.study || !values.chapter || !values.file)
  throw new Error('Usage: --study ID --chapter ID --file JSON [--apply]');
const input = JSON.parse(await readFile(values.file, 'utf8'));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  const { rows } = await client.query(
    'SELECT variant, root FROM study_chapters WHERE id = $1 AND study_id = $2 FOR UPDATE',
    [values.chapter, values.study],
  );
  if (!rows[0]) throw new Error('chapter not found in study');
  const checked = validateStudyDecisions(rows[0].variant, rows[0].root, input);
  const previous = await client.query(
    'SELECT engine_id, source, decisions FROM study_chapter_decisions WHERE chapter_id = $1',
    [values.chapter],
  );
  // Summarize old data without logging arbitrary legacy fields or hidden identities.
  const old = previous.rows[0];
  let before = null;
  if (old) {
    try {
      before = validateStudyDecisions(rows[0].variant, rows[0].root, {
        engineId: old.engine_id,
        source: old.source,
        decisions: old.decisions,
      });
    } catch {
      before = { invalid: true };
    }
  }
  console.log(
    JSON.stringify(
      {
        study: values.study,
        chapter: values.chapter,
        mode: values.apply ? 'apply' : 'dry-run',
        before,
        after: checked,
      },
      null,
      2,
    ),
  );
  if (values.apply) {
    await client.query(
      `INSERT INTO study_chapter_decisions (chapter_id, engine_id, source, decisions) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (chapter_id) DO UPDATE SET engine_id=EXCLUDED.engine_id, source=EXCLUDED.source, decisions=EXCLUDED.decisions, updated_at=now()`,
      [values.chapter, checked.engineId, checked.source, JSON.stringify(checked.decisions)],
    );
    await client.query('COMMIT');
  } else await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  // Do not print connection details from a provider error.
  console.error(error instanceof Error ? error.message : 'decision import failed');
  process.exitCode = 1;
} finally {
  await client.end();
}
