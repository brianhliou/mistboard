#!/usr/bin/env node
// npm run prod:db -- node scripts/study-chapter-decisions.mjs --study ID --chapter ID --file luck.json [--apply]
// Dry run by default. Luck grades the reveal only, never a face-down victim.
//
// Analysis on a study embed
// 1. Compute one side's win chances for every MAINLINE POSITION (start included),
//    then pass a plan to npm run study:edit (dry run first; --apply writes):
//    {"study":"STUDY_ID","ops":[{"op":"series","chapter":"CHAPTER_ID",
//      "scoreSeries":{"side":"red","series":[
//        {"name":"Engine","color":"a","values":[0.5,0.62,0.48]}]}}]}
//    The shape is identical for Banqi and Jieqi (and every other embed board).
//    side: red|black; color: a|b|c|d; values: [0,1], exactly mainline plies + 1.
// 2. Compute flip/reveal decisions offline, save the following JSON to luck.json,
//    then use the command above (dry run first; --apply writes). All scores below
//    are mover/SEAT-POV percentages [0,100], ply 1 = the first mainline move.
//    Banqi (a1a1 played, b1b1 preferred; candidate UCI uses ranks 0..3):
//    {"engineId":"banqi-engine","source":"offline pool sweep","decisions":[
//      {"ply":1,"mover":"red","bestWin":70,"playedWin":50,"realizedWin":62,
//       "playedRank":2,"candidates":[{"move":"b0b0","win":70},
//         {"move":"a0a0","win":50,"played":true}]}]}
//    bestWin: expected score BEFORE the flip / best available move's expectation;
//    playedWin: played flip averaged over every tile in its public pool, BEFORE
//    seeing the draw; realizedWin: score AFTER the tile turned. Choice cost is
//    max(0, bestWin - playedWin); draw luck is realizedWin - playedWin. Candidates
//    are best first; include the preferred move and its bestWin. playedRank is a
//    positive integer or null. No deal, hidden identity or captured role belongs here.
//    Jieqi (luck-only rendering; optional bestWin, playedRank and candidates):
//    {"engineId":"jieqi-engine","source":"offline pool sweep","decisions":[
//      {"ply":1,"mover":"red","playedWin":50,"realizedWin":62}]}
//    Optional candidates: [{"move":"i3i4","win":50,"played":true}] (ranks 0..9).
//    Jieqi grades only the mover's face-down reveal, never a hidden captured victim.
//    Decisions may cover a subset of mainline chance plies; tree edits invalidate them.
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
