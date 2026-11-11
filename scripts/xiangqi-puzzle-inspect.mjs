#!/usr/bin/env node
// Inspect the standard-xiangqi puzzle corpus and the mining candidates behind
// it. Written during the 2026-09-02 puzzle-mining article and committed because
// three separate questions that session needed exactly these queries, and each
// one was rebuilt from scratch after the last had been thrown away.
//
//   railway run -s Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//     node scripts/xiangqi-puzzle-inspect.mjs <command> [args]'
//
// Commands:
//   spec <puzzleId>...   xq-replay spec for an article: startFen + iccs, plus a
//                        capture trace and the material swing over the line.
//   reject <candidateId> Rebuild a REJECTED candidate's position by replaying
//                        its source game to the post-blunder ply, and print the
//                        scan and verify evidence that decided it.
//   quality              Corpus-wide quality scan: how many published puzzles
//                        open with a capture nothing defends, and how many of
//                        those also had the solver already winning.
//
// Why a script and not a query: the interesting parts (was the capture
// answerable, does this line actually mate, what is the material swing) need the
// rules kernel, not SQL.
import pg from 'pg';
import { deriveXiangqiPuzzleDifficulty } from '../packages/game/dist/puzzles-xiangqi-difficulty.js';
import { createInitialXiangqiState } from '../packages/game/dist/variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  applyXiangqiRecordMove,
  getStandardXiangqiLegalMoves,
} from '../packages/game/dist/variants-xiangqi-standard.js';
import { standardXiangqiFen } from '../packages/game/dist/xiangqi-position.js';

const MATERIAL = {
  chariot: 900,
  cannon: 450,
  horse: 450,
  elephant: 200,
  advisor: 200,
  soldier: 100,
  general: 0,
};

/** ICCS ranks are 0-9; ours are 1-10. */
const iccs = (square) => `${square[0]}${Number(square.slice(1)) - 1}`;

const balance = (board, side) => {
  let diff = 0;
  for (const piece of Object.values(board)) {
    diff += (MATERIAL[piece.role] ?? 0) * (piece.color === side ? 1 : -1);
  }
  return diff;
};

/** True when nothing can recapture on the square the move landed on. A capture
 *  that MATES also leaves no legal replies, so the caller must only ask this of
 *  a position that is still playing. */
const isFreeCapture = (state, move) => {
  const captured = state.board[move.to];
  if (!captured) return false;
  const after = applyStandardXiangqiMove(state, move);
  if (after.status.type !== 'playing') return false;
  return getStandardXiangqiLegalMoves(after).every((reply) => reply.to !== move.to);
};

async function withClient(fn) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function spec(ids) {
  const rows = await withClient((c) =>
    c.query(`SELECT id, data FROM puzzles WHERE id = ANY($1)`, [ids]).then((r) => r.rows),
  );
  for (const row of rows) {
    const puzzle = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const solver = puzzle.initial.status.turn;
    let state = puzzle.initial;
    const trace = [];
    for (const move of puzzle.solution) {
      const taken = state.board[move.to];
      trace.push(`${move.from}-${move.to}${taken ? ` x${taken.color[0]}${taken.role}` : ''}`);
      state = applyStandardXiangqiMove(state, move);
    }
    const derived = deriveXiangqiPuzzleDifficulty(puzzle);
    console.log(`\n--- ${row.id} ---`);
    console.log(
      `goal=${puzzle.goal?.type} cp=${puzzle.goal?.centipawns ?? '-'} solver=${solver} ` +
        `rating=${derived.score} plies=${puzzle.solution.length}`,
    );
    console.log(
      `material ${balance(puzzle.initial.board, solver)} -> ${balance(state.board, solver)}  ` +
        `endsInMate=${state.status.type === 'finished'}  motifs=[${derived.motifs}]`,
    );
    console.log(`line: ${trace.join('  ')}`);
    console.log(`startFen: ${standardXiangqiFen(puzzle.initial)}`);
    console.log(`iccs: ${puzzle.solution.map((m) => `${iccs(m.from)}${iccs(m.to)}`).join(' ')}`);
  }
}

async function reject(candidateId) {
  const row = await withClient((c) =>
    c
      .query(
        `SELECT cand.id, cand.status, cand.rejection_reason, cand.post_blunder_ply,
                cand.scan_evidence, g.moves, g.played_on,
                json_agg(json_build_object('stage', j.stage, 'verdict', j.verdict,
                                           'reason', j.reason, 'evidence', j.evidence)) AS judgments
           FROM xiangqi_puzzle_mining_candidates cand
           JOIN historical_xiangqi_games g ON g.id = cand.historical_game_id
           LEFT JOIN xiangqi_puzzle_mining_judgments j ON j.candidate_id = cand.id
          WHERE cand.id = $1
          GROUP BY cand.id, g.moves, g.played_on`,
        [candidateId],
      )
      .then((r) => r.rows[0]),
  );
  if (!row) throw new Error(`no candidate ${candidateId}`);
  const moves = typeof row.moves === 'string' ? JSON.parse(row.moves) : row.moves;
  let state = createInitialXiangqiState('replay');
  for (let i = 0; i < row.post_blunder_ply; i += 1) {
    state = applyXiangqiRecordMove(state, { from: moves[i].from, to: moves[i].to });
  }
  const legal = getStandardXiangqiLegalMoves(state);
  const mating = legal.filter((m) => {
    const next = applyStandardXiangqiMove(state, m);
    return next.status.type === 'finished' && next.status.winner === state.status.turn;
  });
  console.log(`--- ${row.id} ---`);
  console.log(`status=${row.status} reason=${row.rejection_reason} played=${row.played_on}`);
  console.log(`scan: ${JSON.stringify(row.scan_evidence)}`);
  for (const j of row.judgments ?? []) {
    if (j?.stage) console.log(`${j.stage}/${j.verdict}: ${JSON.stringify(j.evidence)}`);
  }
  console.log(`\nposition after ply ${row.post_blunder_ply}, ${state.status.turn} to move`);
  console.log(`startFen: ${standardXiangqiFen(state)}`);
  console.log(`legal moves: ${legal.length}`);
  console.log(
    `moves that win at once: ${
      mating.map((m) => `${m.from}-${m.to} (${iccs(m.from)}${iccs(m.to)})`).join(', ') || 'none'
    }`,
  );
}

async function quality() {
  const rows = await withClient((c) =>
    c
      .query(
        `SELECT p.id, p.data, cand.scan_evidence
           FROM puzzles p
           JOIN xiangqi_puzzle_mining_candidates cand
             ON p.id = 'xq-mined-' || cand.historical_game_id || '-' || cand.post_blunder_ply
          WHERE p.variant = 'xiangqi'`,
      )
      .then((r) => r.rows),
  );
  let free = 0;
  let ahead = 0;
  let both = 0;
  for (const row of rows) {
    const puzzle = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const isFree = isFreeCapture(puzzle.initial, puzzle.solution[0]);
    // preBestCp is from the blunderer's point of view, so negate for the solver.
    const solverAhead = -(row.scan_evidence?.preBestCp ?? 0);
    if (isFree) free += 1;
    if (solverAhead >= 300) ahead += 1;
    if (isFree && solverAhead >= 300) both += 1;
  }
  const pct = (n) => `${((n / rows.length) * 100).toFixed(1)}%`;
  console.log(`published mined puzzles: ${rows.length}`);
  console.log(`key move is an unanswerable capture: ${free} (${pct(free)})`);
  console.log(`solver already ahead 300cp+ before the blunder: ${ahead} (${pct(ahead)})`);
  console.log(`both at once (the puzzle asks nothing): ${both} (${pct(both)})`);
}

const [command, ...args] = process.argv.slice(2);
const commands = { spec: () => spec(args), reject: () => reject(args[0]), quality };
if (!commands[command]) {
  console.error('usage: xiangqi-puzzle-inspect.mjs <spec|reject|quality> [args]');
  process.exit(1);
}
await commands[command]();
