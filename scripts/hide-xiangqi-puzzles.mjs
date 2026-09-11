#!/usr/bin/env node
// Withhold mined xiangqi puzzles that ask the solver nothing.
//
// The set: BOTH already won before the blunder (solver ahead by >= 300cp, from
// the run's own scan evidence) AND answered by capturing a piece that nothing
// can recapture. Either condition alone is fine. A free capture can be the
// payoff of a real combination, and a tactic in an already-good position is
// still a tactic. Together they are a player noticing a hanging piece in a game
// they had already won.
//
// This is deliberately NOT a gate change. Rejecting at mine time destroys the
// candidate and needs a re-mine to undo; this sets a column, and clearing it
// serves the puzzle again. It is also not a rating change: the difficulty prior
// already learned about free captures, which fixed "too easy". It cannot fix
// "teaches nothing", because that is true at every rating.
//
//   railway run -s Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//     node scripts/hide-xiangqi-puzzles.mjs'            # dry run, prints the set
//   ... node scripts/hide-xiangqi-puzzles.mjs --apply    # writes hidden_reason
//   ... node scripts/hide-xiangqi-puzzles.mjs --unhide   # clears this reason
//
// A second set, selected with --pre-gate: the xiangqi puzzles committed in
// packages/game/seed/puzzles/xiangqi.json before the Modal audit profile
// existed. They have no candidate or judgment rows, so nothing has ever checked
// their uniqueness, and the #336 grading run (2026-09-10) measured them at 30%
// solve and 42% signed-in solve against 66-78% for every audited run. Withheld
// until they pass the current profile; --pre-gate --unhide serves them again.
// The seed sync's upsert does not touch hidden_reason, so this survives a
// seed-hash change.
//
// A third set, --runner-up-mates: checkmate puzzles whose audit found a second
// mating move at a solver ply where the stored move does NOT mate in one. The
// gate admitted them as "strictly fastest of two mates" until 2026-09-11, when
// it adopted the lichess rule (a mate puzzle needs a unique mating move at
// every ply except a mate-in-one; the grader rescues a mate on the spot and
// nothing else). Under that rule these are traps: a solver who plays the other
// mate is marked wrong. A second mate on a mate-in-one ply is fine, the grader
// accepts it, and 661 of 965 mate puzzles have one, mostly on the last ply.
// The audit's per-ply evidence is the source, not the verify record, because
// the verify record only covers the first ply.
import pg from 'pg';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
} from '../packages/game/dist/variants-xiangqi-standard.js';

const AHEAD_CP = 300;

const apply = process.argv.includes('--apply');
const unhide = process.argv.includes('--unhide');
const preGate = process.argv.includes('--pre-gate');
const runnerUpMates = process.argv.includes('--runner-up-mates');
const REASON = preGate
  ? 'pre-gate-seed-unaudited'
  : runnerUpMates
    ? 'runner-up-mates'
    : 'already-won-free-capture';

/** Nothing can recapture on the square the move landed on. Only meaningful
 *  while the game is still running: a capture that MATES also leaves the
 *  opponent no legal replies, and that is not a free capture. */
function isFreeCapture(state, move) {
  if (!state.board[move.to]) return false;
  const after = applyStandardXiangqiMove(state, move);
  if (after.status.type !== 'playing') return false;
  return getStandardXiangqiLegalMoves(after).every((reply) => reply.to !== move.to);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  if (unhide) {
    const { rowCount } = await client.query(
      `UPDATE puzzles SET hidden_reason = NULL WHERE hidden_reason = $1`,
      [REASON],
    );
    console.log(`un-hid ${rowCount} puzzles`);
    process.exit(0);
  }

  if (runnerUpMates) {
    const { rows } = await client.query(
      `WITH audit AS (
         SELECT DISTINCT ON (candidate_id) candidate_id, evidence
           FROM xiangqi_puzzle_mining_judgments
          WHERE stage = 'audit' AND verdict = 'pass'
          ORDER BY candidate_id, id DESC
       )
       SELECT p.id, p.hidden_reason, p.solution_plies,
              (SELECT count(*) FROM jsonb_array_elements(audit.evidence->'plies') ply
                WHERE (ply->>'secondMate')::int > 0 AND (ply->>'bestMate')::int > 1)::int AS ambiguous_plies
         FROM puzzles p
         JOIN audit ON audit.candidate_id = p.mining_candidate_id
        WHERE p.variant = 'xiangqi' AND p.goal_type = 'checkmate'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(audit.evidence->'plies') ply
             WHERE (ply->>'secondMate')::int > 0 AND (ply->>'bestMate')::int > 1)
        ORDER BY p.seq`,
    );
    const byLength = {};
    for (const row of rows) byLength[row.solution_plies] = (byLength[row.solution_plies] ?? 0) + 1;
    console.log(
      `checkmate puzzles with a second mate at a ply that is not mate-in-one: ${rows.length}`,
    );
    console.log(`by solution length (plies): ${JSON.stringify(byLength)}`);
    console.log(`already hidden: ${rows.filter((row) => row.hidden_reason).length}`);
    for (const row of rows.slice(0, 5)) console.log(`  ${row.id}`);
    if (rows.length > 5) console.log(`  ... ${rows.length - 5} more`);
    if (!apply) {
      console.log('\ndry run. pass --apply to write hidden_reason.');
      process.exit(0);
    }
    const { rowCount } = await client.query(
      `UPDATE puzzles SET hidden_reason = $1
        WHERE id = ANY($2::text[]) AND hidden_reason IS NULL`,
      [REASON, rows.map((row) => row.id)],
    );
    console.log(`\nhid ${rowCount} puzzles with reason "${REASON}"`);
    process.exit(0);
  }

  if (preGate) {
    const { rows } = await client.query(
      `SELECT id, hidden_reason FROM puzzles
        WHERE variant = 'xiangqi' AND mining_candidate_id IS NULL
        ORDER BY seq`,
    );
    console.log(`pre-gate seed puzzles (no mining candidate): ${rows.length}`);
    console.log(`already hidden: ${rows.filter((row) => row.hidden_reason).length}`);
    for (const row of rows.slice(0, 5)) console.log(`  ${row.id}`);
    if (rows.length > 5) console.log(`  ... ${rows.length - 5} more`);
    if (!apply) {
      console.log('\ndry run. pass --apply to write hidden_reason.');
      process.exit(0);
    }
    const { rowCount } = await client.query(
      `UPDATE puzzles SET hidden_reason = $1
        WHERE variant = 'xiangqi' AND mining_candidate_id IS NULL AND hidden_reason IS NULL`,
      [REASON],
    );
    console.log(`\nhid ${rowCount} puzzles with reason "${REASON}"`);
    process.exit(0);
  }

  const { rows } = await client.query(
    `SELECT p.id, p.data, p.hidden_reason, cand.scan_evidence
       FROM puzzles p
       JOIN xiangqi_puzzle_mining_candidates cand
         ON p.id = 'xq-mined-' || cand.historical_game_id || '-' || cand.post_blunder_ply
      WHERE p.variant = 'xiangqi'`,
  );

  const hide = [];
  for (const row of rows) {
    const puzzle = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    // preBestCp is from the blunderer's point of view, so negate for the solver.
    const solverAhead = -(row.scan_evidence?.preBestCp ?? 0);
    if (solverAhead < AHEAD_CP) continue;
    if (!isFreeCapture(puzzle.initial, puzzle.solution[0])) continue;
    hide.push({ id: row.id, ahead: solverAhead, already: row.hidden_reason });
  }

  console.log(`examined ${rows.length} mined puzzles`);
  console.log(
    `match (already ahead >= ${AHEAD_CP}cp AND key move is a free capture): ${hide.length}`,
  );
  console.log(`already hidden: ${hide.filter((h) => h.already).length}`);
  for (const h of hide.slice(0, 5)) console.log(`  ${h.id}  solver ahead ${h.ahead}cp`);
  if (hide.length > 5) console.log(`  ... ${hide.length - 5} more`);

  if (!apply) {
    console.log('\ndry run. pass --apply to write hidden_reason.');
    process.exit(0);
  }
  const { rowCount } = await client.query(
    `UPDATE puzzles SET hidden_reason = $1 WHERE id = ANY($2::text[])`,
    [REASON, hide.map((h) => h.id)],
  );
  console.log(`\nhid ${rowCount} puzzles with reason "${REASON}"`);
} finally {
  await client.end();
}
