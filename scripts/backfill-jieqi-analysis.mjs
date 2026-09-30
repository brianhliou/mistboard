#!/usr/bin/env node
// Warm the jieqi analysis + decisions caches for finished games, OFF-BOX.
//
//   npm run build --workspace @mistboard/server   # this reads dist/
//   node scripts/backfill-jieqi-analysis.mjs --dry-run
//   node scripts/backfill-jieqi-analysis.mjs --room <roomId>
//   node scripts/backfill-jieqi-analysis.mjs --limit 5 [--no-decisions]
//
// Against prod, via the pattern that never prints the credential:
//   railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/backfill-jieqi-analysis.mjs --limit 1'
//
// WHY THIS EXISTS. Analysis compute on prod runs on a global FIFO chain with
// concurrency 1, shared across every variant (game-analysis-jobs.ts). A 55-game
// backfill through the HTTP route would hold that single lane for hours, so every
// user opening any review would queue behind it, and the per-account pending cap of
// 2 makes mass-enqueueing impossible anyway. This script sidesteps both: it computes
// on the machine that runs it and writes the results into the same `game_analysis`
// rows prod would have written.
//
// That substitution is only legitimate because the analysis path is deterministic:
// fixed Hash 256, Threads 1, and a movetime cap that never binds at these depths, so
// the same (room, engine, depth) yields the same evals on any box. Threads is what
// would break it, which is why analysis pins its own resources instead of inheriting
// the live path's env-tunable knobs. Raising the pool size below is safe (it gates
// slots, not search); raising MISTBOARD_PIKAFISH_JIEQI_THREADS is NOT, and would
// poison the cache with box-specific numbers.
//
// ARCHITECTURE IS A HARD REQUIREMENT, not a caveat. Measured 2026-08-28: the same
// pinned engine commit built arm64/NEON and x86-64-sse41-popcnt produces different
// evals AND different node counts (depth 20 on one midgame position: 1043 cp over
// 1,106,314 nodes vs 1050 cp over 851,161). The cache key carries the engine ref and
// the depth, not the ARCH, so rows written by a non-x86-64 build are indistinguishable
// from prod's own and permanently wrong. railpack builds x86-64-sse41-popcnt, so this
// script refuses to run anywhere else. --allow-foreign-arch exists only for computing
// into a THROWAWAY database (a local comparison run); never point it at prod.
//
// The engine commit itself is pinned in pikafish-jieqi.ref and its short sha is part of
// the cache key, so a future engine bump invalidates instead of silently reusing rows
// (jieqi-engine-ref.test.ts enforces the two stay in step).
//
// Idempotent: a game whose cache row already exists is served from cache and skipped,
// so re-running after an interrupt only does the remaining work.

import { resolveJieqiAnalysis, resolveJieqiDecisions } from '../apps/server/dist/jieqi-analysis.js';
import { getPool, init as initPersistence } from '../apps/server/dist/persistence-db.js';
import { loadFinishedJieqiGameInputs } from '../apps/server/dist/routes/jieqi-games.js';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const flagValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};

const dryRun = has('--dry-run');
const withDecisions = !has('--no-decisions');
const onlyRoom = flagValue('--room');
const limit = Number(flagValue('--limit')) || null;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (see the railway run pattern in this file).');
  process.exit(1);
}

// Fail closed on the one mistake that cannot be detected after the fact: a foreign-arch
// row looks exactly like a prod-computed one. --dry-run is exempt: it writes nothing, and
// the listing is the normal way to pick games from a workstation.
if (process.arch !== 'x64' && !has('--allow-foreign-arch') && !dryRun) {
  console.error(
    `refusing to run on ${process.arch}: prod builds PikaJieQi as x86-64-sse41-popcnt and a\n` +
      'different architecture produces different evals under an identical cache key.\n' +
      'Run this on an x86-64 host, or pass --allow-foreign-arch when writing to a\n' +
      'throwaway database you are about to discard.',
  );
  process.exit(1);
}

initPersistence(process.env.DATABASE_URL);
const pool = getPool();

// Finished games only: the loader rejects anything else, so filtering here keeps the
// dry-run count honest rather than reporting work that would be skipped.
const { rows } = onlyRoom
  ? await pool.query(
      `SELECT room_id, ply_count, result FROM games WHERE room_id = $1 AND variant = 'jieqi'`,
      [onlyRoom],
    )
  : await pool.query(
      `SELECT room_id, ply_count, result FROM games
        WHERE variant = 'jieqi' AND ended_at IS NOT NULL
          -- Imported games (off-site engine matches) were not played here: on request only.
          AND mode <> 'imported'
        ORDER BY ply_count ASC
        LIMIT $1`,
      [limit ?? null],
    );

if (rows.length === 0) {
  console.log('no finished jieqi games matched');
  await pool.end();
  process.exit(0);
}

const totalPlies = rows.reduce((sum, r) => sum + (r.ply_count ?? 0), 0);
console.log(
  `${rows.length} finished jieqi game(s), ${totalPlies} plies total` +
    `${withDecisions ? '' : ' (analysis only, decisions skipped)'}`,
);
// Shortest-first, so an interrupted run has still finished whole games and a bad
// binary shows up on a cheap one rather than after the longest sweep on the list.
if (dryRun) {
  for (const row of rows) console.log(`  ${row.room_id}  ${row.ply_count} plies  ${row.result}`);
  console.log('\n--dry-run: nothing computed');
  await pool.end();
  process.exit(0);
}

let done = 0;
let failed = 0;
const startedAll = Date.now();

for (const row of rows) {
  const roomId = row.room_id;
  const started = Date.now();
  try {
    const inputs = await loadFinishedJieqiGameInputs(roomId);
    if (!inputs) {
      console.log(`  ${roomId}  SKIP (not a finished jieqi event log)`);
      continue;
    }
    await resolveJieqiAnalysis(roomId, inputs.moves, inputs.deal, undefined, undefined, true);
    const afterSweep = Date.now();
    let decisionsMs = 0;
    if (withDecisions) {
      await resolveJieqiDecisions(roomId, inputs.moves, inputs.deal, undefined, undefined, true);
      decisionsMs = Date.now() - afterSweep;
    }
    done++;
    const sweepMs = afterSweep - started;
    console.log(
      `  ${roomId}  ${row.ply_count} plies  sweep ${(sweepMs / 1000).toFixed(1)}s` +
        `${withDecisions ? `  decisions ${(decisionsMs / 1000).toFixed(1)}s` : ''}` +
        `  total ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    failed++;
    console.error(`  ${roomId}  FAILED: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(
  `\n${done} computed, ${failed} failed, ${((Date.now() - startedAll) / 1000 / 60).toFixed(1)} min total`,
);
await pool.end();
process.exit(failed > 0 ? 1 : 0);
