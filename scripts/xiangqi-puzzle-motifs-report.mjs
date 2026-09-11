#!/usr/bin/env node
// Coverage of the named kill patterns (杀法) over the served xiangqi puzzles
// (#324). Read-only. Runs detectXiangqiPuzzleMotifs over every checkmate
// puzzle in the database and prints the count per motif with sample ids, so a
// detector change is measured against the corpus before it ships.
//
//   railway run -s Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//     node scripts/xiangqi-puzzle-motifs-report.mjs'
//   ... --served-only      count only puzzles with hidden_reason IS NULL
//   ... --show <motif> [n] print the final position and line for n matches
//
// First run 2026-09-11: 965 mate puzzles, 589 tagged (61%).
import pg from 'pg';
import {
  applyStandardXiangqiMove,
  detectXiangqiPuzzleMotifs,
  standardXiangqiFen,
  XIANGQI_MOTIFS,
} from '../packages/game/dist/index.js';

const args = process.argv.slice(2);
const servedOnly = args.includes('--served-only');
const showAt = args.indexOf('--show');
const show = showAt >= 0 ? args[showAt + 1] : null;
const showCount = showAt >= 0 ? Number(args[showAt + 2] ?? 3) : 0;

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(
  `SELECT id, data FROM puzzles
    WHERE variant = 'xiangqi' AND goal_type = 'checkmate'
      ${servedOnly ? 'AND hidden_reason IS NULL' : ''}
    ORDER BY seq`,
);
await client.end();

const byMotif = new Map(XIANGQI_MOTIFS.map((motif) => [motif.id, []]));
let tagged = 0;
let shown = 0;
for (const row of rows) {
  const puzzle = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const motifs = detectXiangqiPuzzleMotifs(puzzle);
  if (motifs.length > 0) tagged += 1;
  for (const motif of motifs) byMotif.get(motif).push(row.id);
  if (show && motifs.includes(show) && shown < showCount) {
    shown += 1;
    let state = puzzle.initial;
    for (const move of puzzle.solution) state = applyStandardXiangqiMove(state, move);
    console.log(`${row.id}  [${motifs.join(', ')}]`);
    console.log(`  line:  ${puzzle.solution.map((move) => move.from + move.to).join(' ')}`);
    console.log(`  final: ${standardXiangqiFen(state)}`);
  }
}

console.log(
  `mate puzzles ${rows.length}${servedOnly ? ' (served)' : ''}; tagged ${tagged} (${((100 * tagged) / rows.length).toFixed(0)}%)`,
);
for (const motif of XIANGQI_MOTIFS) {
  const ids = byMotif.get(motif.id);
  console.log(
    `${motif.id.padEnd(18)} ${motif.hanzi.padEnd(5)} ${String(ids.length).padStart(4)}  ${ids.slice(0, 2).join(' ')}`,
  );
}
