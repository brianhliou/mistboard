#!/usr/bin/env node
// Grade the xiangqi puzzle gate against solve-rate data (#336). Read-only.
//
// Joins puzzle_quality_sessions (sub-2 s sessions excluded, matching the
// report), puzzle_attempts, puzzle_ratings, each candidate's scan_evidence and
// its latest passing audit judgment, then buckets outcomes by the difficulty
// prior, uniqueness reason, solver-ahead margin, audit gap, goal, depth, and
// free-material key move. Prints markdown tables. Recomputes the prior at run
// time so a prior change can be graded before it ships.
//
//   railway run -s Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//     node scripts/xiangqi-puzzle-grade.mjs'
//
// First run 2026-09-10 (503 terminal sessions): the prior does not order solve
// rate (r = -0.08); solver plies and reveal rate do. Findings on #336.
import pg from 'pg';
import { deriveXiangqiPuzzleDifficulty } from '../packages/game/dist/puzzles-xiangqi-difficulty.js';

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows } = await c.query(`
  WITH q AS (
    SELECT puzzle_id,
           count(*)::int sessions,
           count(*) FILTER (WHERE started_at IS NOT NULL)::int starts,
           count(*) FILTER (WHERE outcome='solved')::int solves,
           count(*) FILTER (WHERE outcome='revealed')::int reveals,
           count(*) FILTER (WHERE outcome='abandoned' AND started_at IS NOT NULL)::int abandons,
           count(*) FILTER (WHERE outcome='abandoned' AND started_at IS NULL)::int bounces,
           COALESCE(sum(wrong_attempts),0)::int wrong,
           COALESCE(sum(hint_count),0)::int hints
    FROM puzzle_quality_sessions
    WHERE completed_at IS NULL OR completed_at - viewed_at >= interval '2 seconds'
    GROUP BY puzzle_id
  ), a AS (
    SELECT puzzle_id, count(*)::int attempts, count(*) FILTER (WHERE solved)::int solved
    FROM puzzle_attempts GROUP BY puzzle_id
  ), j AS (
    SELECT DISTINCT ON (candidate_id) candidate_id, evidence
    FROM xiangqi_puzzle_mining_judgments
    WHERE stage='audit' AND verdict='pass'
    ORDER BY candidate_id, id DESC
  )
  SELECT p.id, p.data, p.goal_type, p.solution_plies, p.source_kind,
         cand.run_id, cand.scan_evidence, j.evidence audit,
         r.rating glicko, r.rating_deviation rd,
         COALESCE(q.sessions,0) sessions, COALESCE(q.starts,0) starts, COALESCE(q.solves,0) solves,
         COALESCE(q.reveals,0) reveals, COALESCE(q.abandons,0) abandons, COALESCE(q.bounces,0) bounces, COALESCE(q.wrong,0) wrong,
         COALESCE(q.hints,0) hints, COALESCE(a.attempts,0) attempts, COALESCE(a.solved,0) attempt_solves
  FROM puzzles p
  LEFT JOIN xiangqi_puzzle_mining_candidates cand ON cand.id = p.mining_candidate_id
  LEFT JOIN j ON j.candidate_id = p.mining_candidate_id
  LEFT JOIN q ON q.puzzle_id = p.id
  LEFT JOIN a ON a.puzzle_id = p.id
  LEFT JOIN puzzle_ratings r ON r.puzzle_id = p.id
  WHERE p.variant='xiangqi'`);
await c.end();

const puzzles = rows.map((r) => {
  const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  let prior = null;
  let motifs = [];
  try {
    const d = deriveXiangqiPuzzleDifficulty(data);
    prior = d.score;
    motifs = d.motifs;
  } catch {}
  const ply0 = r.audit?.plies?.[0] ?? null;
  const terminal = r.solves + r.reveals + r.abandons;
  return {
    id: r.id,
    seed: r.source_kind === 'seed',
    run: r.run_id ? (r.run_id.includes('dae53626') ? 'pilot' : 'remainder') : 'seed',
    goal: r.goal_type,
    solverPlies: Math.ceil(r.solution_plies / 2),
    prior,
    motifs,
    free: motifs.includes('free-material'),
    solverAhead: r.scan_evidence ? -(r.scan_evidence.preBestCp ?? 0) : null,
    reason: ply0?.uniquenessReason ?? (r.seed ? 'seed' : 'none'),
    gapCp: ply0?.gapCp ?? null,
    gapWinrate: ply0?.gapWinrate ?? null,
    glicko: r.glicko,
    rd: r.rd,
    sessions: r.sessions,
    starts: r.starts,
    terminal,
    solves: r.solves,
    reveals: r.reveals,
    abandons: r.abandons,
    bounces: r.bounces,
    wrong: r.wrong,
    hints: r.hints,
    attempts: r.attempts,
    attemptSolves: r.attempt_solves,
  };
});

const pct = (n, d) => (d > 0 ? `${((100 * n) / d).toFixed(0)}%` : '-');
function table(title, keyFn, order) {
  const groups = new Map();
  for (const p of puzzles) {
    const k = keyFn(p);
    if (k === undefined || k === null) continue;
    const g = groups.get(k) ?? {
      key: k,
      puzzles: 0,
      sessions: 0,
      starts: 0,
      terminal: 0,
      solves: 0,
      reveals: 0,
      abandons: 0,
      bounces: 0,
      wrong: 0,
      attempts: 0,
      attemptSolves: 0,
    };
    g.puzzles += 1;
    for (const f of [
      'sessions',
      'starts',
      'terminal',
      'solves',
      'reveals',
      'abandons',
      'bounces',
      'wrong',
      'attempts',
      'attemptSolves',
    ])
      g[f] += p[f];
    groups.set(k, g);
  }
  const keys = order ?? [...groups.keys()].sort();
  console.log(`\n## ${title}`);
  console.log(
    '| bucket | puzzles | sessions | starts | terminal | solve | reveal | abandon | bounce | wrong/start | signed-in solve |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const k of keys) {
    const g = groups.get(k);
    if (!g) continue;
    console.log(
      `| ${k} | ${g.puzzles} | ${g.sessions} | ${g.starts} | ${g.terminal} | ${pct(g.solves, g.terminal)} | ${pct(g.reveals, g.terminal)} | ${pct(g.abandons, g.starts)} | ${pct(g.bounces, g.sessions)} | ${g.starts ? (g.wrong / g.starts).toFixed(2) : '-'} | ${pct(g.attemptSolves, g.attempts)} (n=${g.attempts}) |`,
    );
  }
}

const priorBucket = (p) =>
  p.prior === null
    ? null
    : p.prior < 1300
      ? '1 <1300'
      : p.prior < 1500
        ? '2 1300-1499'
        : p.prior < 1700
          ? '3 1500-1699'
          : p.prior < 1900
            ? '4 1700-1899'
            : '5 1900+';
const aheadBucket = (p) =>
  p.solverAhead === null
    ? null
    : p.solverAhead < 0
      ? '1 behind'
      : p.solverAhead < 300
        ? '2 0-299'
        : p.solverAhead < 800
          ? '3 300-799'
          : '4 800+';
const gapBucket = (p) =>
  p.gapCp === null
    ? null
    : p.gapCp >= 20000
      ? '4 mate'
      : p.gapCp < 300
        ? '1 <300'
        : p.gapCp < 600
          ? '2 300-599'
          : '3 600+';

console.log(
  `puzzles ${puzzles.length}; with any session ${puzzles.filter((p) => p.sessions > 0).length}; with a terminal session ${puzzles.filter((p) => p.terminal > 0).length}; with 3+ terminal ${puzzles.filter((p) => p.terminal >= 3).length}`,
);
table('Difficulty prior vs outcome', priorBucket);
table('Uniqueness reason (first solver ply, audit)', (p) => p.reason);
table('Solver already ahead before the blunder (cp)', aheadBucket);
table('Audit gap on ply 0 (cp)', gapBucket);
table('Goal', (p) => p.goal);
table('Solver plies', (p) => String(p.solverPlies));
table('Free-material first move', (p) => (p.free ? 'free capture' : 'not free'));
table('Ahead 300+ x free capture', (p) =>
  p.solverAhead === null
    ? null
    : `${p.solverAhead >= 300 ? 'ahead300' : 'not-ahead'} / ${p.free ? 'free' : 'not-free'}`,
);
table('Run', (p) => p.run);

// Session-weighted correlation between prior and solve outcome.
function weightedCorr(xs, ys, ws) {
  const W = ws.reduce((a, b) => a + b, 0);
  const mx = xs.reduce((a, x, i) => a + x * ws[i], 0) / W;
  const my = ys.reduce((a, y, i) => a + y * ws[i], 0) / W;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += ws[i] * (xs[i] - mx) * (ys[i] - my);
    sxx += ws[i] * (xs[i] - mx) ** 2;
    syy += ws[i] * (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
const withTerminal = puzzles.filter((p) => p.terminal > 0 && p.prior !== null);
console.log(
  `\nSession-weighted correlation, prior vs solve rate (n=${withTerminal.length} puzzles, ${withTerminal.reduce((a, p) => a + p.terminal, 0)} terminal sessions): r = ${weightedCorr(
    withTerminal.map((p) => p.prior),
    withTerminal.map((p) => p.solves / p.terminal),
    withTerminal.map((p) => p.terminal),
  ).toFixed(3)}`,
);
const withGlicko = puzzles.filter((p) => p.glicko !== null && p.prior !== null && p.attempts >= 3);
if (withGlicko.length > 2) {
  console.log(
    `Glicko (3+ signed-in attempts, n=${withGlicko.length}) vs prior: r = ${weightedCorr(
      withGlicko.map((p) => p.prior),
      withGlicko.map((p) => p.glicko),
      withGlicko.map(() => 1),
    ).toFixed(
      3,
    )}; mean drift glicko-prior = ${(withGlicko.reduce((a, p) => a + (p.glicko - p.prior), 0) / withGlicko.length).toFixed(0)}`,
  );
}

console.log('\n## Puzzles with prior 1900+');
console.log(
  '| id | prior | motifs | goal | plies | ahead | reason | gapCp | sessions | terminal | solves | reveals | glicko |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const p of puzzles
  .filter((p) => p.prior !== null && p.prior >= 1900)
  .sort((a, b) => b.prior - a.prior)) {
  console.log(
    `| ${p.id} | ${p.prior} | ${p.motifs.join(',')} | ${p.goal} | ${p.solverPlies} | ${p.solverAhead} | ${p.reason} | ${p.gapCp} | ${p.sessions} | ${p.terminal} | ${p.solves} | ${p.reveals} | ${p.glicko ? Math.round(p.glicko) : '-'} |`,
  );
}

console.log('\n## Gate-wrong candidates: 3+ terminal sessions, solve rate <= 34%, reveal >= 1');
console.log(
  '| id | prior | reason | gapCp | ahead | free | terminal | solves | reveals | abandons | wrong |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const p of puzzles
  .filter((p) => p.terminal >= 3 && p.solves / p.terminal <= 0.34 && p.reveals >= 1)
  .sort((a, b) => b.terminal - a.terminal)) {
  console.log(
    `| ${p.id} | ${p.prior} | ${p.reason} | ${p.gapCp} | ${p.solverAhead} | ${p.free} | ${p.terminal} | ${p.solves} | ${p.reveals} | ${p.abandons} | ${p.wrong} |`,
  );
}

console.log('\n## Coverage: sessions per puzzle');
const dist = {};
for (const p of puzzles) {
  const k = p.terminal === 0 ? '0' : p.terminal < 3 ? '1-2' : p.terminal < 10 ? '3-9' : '10+';
  dist[k] = (dist[k] ?? 0) + 1;
}
console.log(JSON.stringify(dist));
