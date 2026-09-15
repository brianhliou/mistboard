#!/usr/bin/env node
// Resolve repeated positions in a mining run so it can be published.
//
//   node scripts/resolve-duplicate-positions.mjs --run-id RUN            # dry run
//   node scripts/resolve-duplicate-positions.mjs --run-id RUN --apply
//
// Also rejects a candidate whose position an EARLIER run already published
// (the published puzzle wins); publication refuses those the same way, and the
// September batches hit it because they mine the same corpus the July and
// August runs did and the same games reach the same positions.
//
// The miner dedups positions in-process, per worker. With 40-100 shards spread
// across separate containers, two shards can each reach the same position and
// neither can see the other, so cross-shard duplicates are expected at scale
// rather than a defect. Publication refuses a set containing repeats, which is
// correct but leaves no way forward; this is the way forward.
//
// Keeps the candidate with the lowest selection_index for each position and
// rejects the rest with the editorial `duplicate` reason, so the survivor is a
// deterministic function of the frozen manifest rather than of scan timing.
// Rejection is reversible: the row keeps its judgments and can be re-reviewed.

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    'run-id': { type: 'string' },
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('Usage: --run-id RUN [--apply]');
  process.exit(0);
}

const runId = values['run-id']?.trim();
if (!runId) {
  console.error('--run-id is required');
  process.exit(1);
}
if (!/^xqpmr_[0-9a-f]{24}$/.test(runId)) {
  console.error(`--run-id does not look like a mining run id: ${runId}`);
  process.exit(1);
}

const snippet = `
const pg = require('pg');
const RUN = ${JSON.stringify(runId)};
const APPLY = ${values.apply ? 'true' : 'false'};
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const q = async (sql, params) => (await pool.query(sql, params)).rows;

  // Losers only: everything except the lowest selection_index per position.
  const losers = await q(\`
    SELECT candidate_id, position_key, selection_index FROM (
      SELECT c.id AS candidate_id, c.position_key, g.selection_index,
             row_number() OVER (PARTITION BY c.position_key
                                ORDER BY g.selection_index, c.id) AS rank
        FROM xiangqi_puzzle_mining_candidates c
        JOIN xiangqi_puzzle_mining_games g
          ON g.run_id = c.run_id AND g.historical_game_id = c.historical_game_id
       WHERE c.run_id = $1 AND c.status IN ('review','approved')
    ) ranked
     WHERE rank > 1
     ORDER BY position_key, selection_index\`, [RUN]);

  // Cross-RUN repeats: a position this run reached that an earlier run already
  // published. Publication refuses these too (it checks every published
  // position, not just this run's), and the published puzzle always wins.
  const published = await q(\`
    SELECT c.id AS candidate_id, c.position_key, puzzle.id AS puzzle_id
      FROM xiangqi_puzzle_mining_candidates c
      JOIN xiangqi_puzzle_mining_candidates prior
        ON prior.position_key = c.position_key AND prior.run_id <> c.run_id
      JOIN puzzles puzzle ON puzzle.mining_candidate_id = prior.id
     WHERE c.run_id = $1 AND c.status IN ('review','approved')
     ORDER BY c.position_key\`, [RUN]);
  for (const row of published) {
    losers.push({ candidate_id: row.candidate_id, position_key: row.position_key, selection_index: null, note: \`Position already published as puzzle \${row.puzzle_id} by an earlier run.\` });
  }

  console.log(JSON.stringify({ runId: RUN, apply: APPLY, wouldReject: losers.length, withinRun: losers.length - published.length, alreadyPublished: published.length }));
  for (const row of losers) {
    console.log(\`  reject \${row.candidate_id}  position \${row.position_key}  \${row.note ?? \`selection \${row.selection_index}\`}\`);
  }
  if (!APPLY || losers.length === 0) {
    console.log(APPLY ? 'nothing to do' : 'dry run: nothing was changed');
    await pool.end();
    return;
  }

  let rejected = 0;
  for (const row of losers) {
    const updated = await q(\`
      UPDATE xiangqi_puzzle_mining_candidates
         SET status = 'rejected', rejection_reason = 'editorial:duplicate', updated_at = now()
       WHERE id = $1 AND status IN ('review','approved')
       RETURNING id\`, [row.candidate_id]);
    if (updated.length === 0) continue;
    await q(\`
      INSERT INTO xiangqi_puzzle_editorial_reviews
        (candidate_id, reviewer_user_id, verdict, reason, notes)
      VALUES ($1, NULL, 'reject', 'duplicate', $2)\`,
      [row.candidate_id, row.note ?? 'Repeated position within the run; kept the lowest selection_index.']);
    rejected += 1;
  }
  console.log(JSON.stringify({ rejected }));

  const left = await q(\`
    SELECT count(*)::int AS n FROM (
      SELECT position_key FROM xiangqi_puzzle_mining_candidates
       WHERE run_id = $1 AND status IN ('review','approved')
       GROUP BY position_key HAVING count(*) > 1) d\`, [RUN]);
  console.log(JSON.stringify({ remainingDuplicatePositions: left[0].n }));
  await pool.end();
})().catch((error) => { console.error(error.message); process.exit(1); });
`;

const queryFile = join(REPO_ROOT, 'node_modules', '.mistboard-dedupe-query.cjs');
writeFileSync(queryFile, snippet, 'utf8');
try {
  const result = spawnSync(
    'railway',
    [
      'run',
      '-s',
      'Postgres',
      '--',
      'sh',
      '-c',
      `DATABASE_URL="$DATABASE_PUBLIC_URL" node "${queryFile}"`,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
} finally {
  if (existsSync(queryFile)) rmSync(queryFile, { force: true });
}
