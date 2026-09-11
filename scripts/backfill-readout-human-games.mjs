#!/usr/bin/env node
// Recompute the game counts inside stored readout snapshots with the
// human-only filter, so the 7-point weekly trend and the /readouts history
// stop mixing bot-vs-bot games into the player-facing number.
//
// Until b303034f (2026-09-07) `collectProduct` counted every completed game
// regardless of mode, so every snapshot from 2026-07-22 to 2026-09-07 carries
// EvE games in `completedGames`, `previousCompletedGames`, `abortedGames`, and
// `completedGamesByVariant`. Later snapshots read those older rows back as
// their trend. This rewrites just those four product fields, in place, from
// the `games` table using each snapshot's own period columns; verdicts,
// actions, fingerprints, and everything else in the payload stay as they were
// (they are what was decided at the time, and a decision is not backfilled).
//
//   node scripts/backfill-readout-human-games.mjs            # dry run: prints what would change
//   node scripts/backfill-readout-human-games.mjs --apply    # writes
//
// Idempotent: a snapshot already carrying `product.humanOnlyBackfilledAt` is
// skipped, and a second run after that reports nothing to do. Against
// production, hand the connection to Railway rather than putting it in your
// shell:
//
//   railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/backfill-readout-human-games.mjs --apply'

import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
  },
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const HUMAN = `status = 'completed' AND mode IN ('pvp', 'pve')`;

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
try {
  const snapshots = await pool.query(
    `SELECT id, trigger, period_start, period_end,
            (payload -> 'product') AS product
     FROM ops_readout_snapshots
     WHERE payload -> 'product' IS NOT NULL
       AND jsonb_typeof(payload -> 'product') = 'object'
       AND (payload -> 'product' ->> 'humanOnlyBackfilledAt') IS NULL
     ORDER BY period_end ASC`,
  );
  let changed = 0;
  for (const row of snapshots.rows) {
    const periodStart = row.period_start;
    const periodEnd = row.period_end;
    const previousPeriodStart = new Date(periodStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const counts = await pool.query(
      `SELECT
         (SELECT count(*) FROM games WHERE ${HUMAN}
            AND ended_at >= $1 AND ended_at < $2)::int AS completed_games,
         (SELECT count(*) FROM games WHERE ${HUMAN}
            AND ended_at >= $3 AND ended_at < $1)::int AS previous_completed_games,
         (SELECT count(*) FROM games WHERE status = 'aborted' AND mode IN ('pvp', 'pve')
            AND ended_at >= $1 AND ended_at < $2)::int AS aborted_games`,
      [periodStart, periodEnd, previousPeriodStart],
    );
    const variants = await pool.query(
      `SELECT variant, count(*)::int AS count
       FROM games
       WHERE ${HUMAN} AND ended_at >= $1 AND ended_at < $2
       GROUP BY variant ORDER BY count DESC, variant`,
      [periodStart, periodEnd],
    );
    const next = counts.rows[0];
    const before = row.product;
    const same =
      before.completedGames === next.completed_games &&
      before.previousCompletedGames === next.previous_completed_games &&
      before.abortedGames === next.aborted_games;
    const label = `${row.id} ${row.trigger} ending ${periodEnd.toISOString().slice(0, 10)}`;
    if (same) {
      console.log(`unchanged ${label}: ${before.completedGames} games`);
    } else {
      changed += 1;
      console.log(
        `${values.apply ? 'rewrite' : 'would rewrite'} ${label}: ` +
          `${before.completedGames} -> ${next.completed_games} games, ` +
          `previous ${before.previousCompletedGames} -> ${next.previous_completed_games}, ` +
          `aborted ${before.abortedGames} -> ${next.aborted_games}`,
      );
    }
    if (!values.apply) continue;
    // Stamp even the unchanged ones so the next run has nothing to revisit.
    await pool.query(
      `UPDATE ops_readout_snapshots
       SET payload = jsonb_set(
         payload,
         '{product}',
         (payload -> 'product') || $2::jsonb
       )
       WHERE id = $1`,
      [
        row.id,
        JSON.stringify({
          completedGames: next.completed_games,
          previousCompletedGames: next.previous_completed_games,
          abortedGames: next.aborted_games,
          completedGamesByVariant: variants.rows,
          humanOnlyBackfilledAt: new Date().toISOString(),
          humanOnlyBackfillFrom: {
            completedGames: before.completedGames,
            previousCompletedGames: before.previousCompletedGames,
            abortedGames: before.abortedGames,
          },
        }),
      ],
    );
  }
  console.log(
    `${snapshots.rows.length} snapshots examined, ${changed} ${values.apply ? 'rewritten' : 'would change'}` +
      (values.apply ? '' : ' (dry run; pass --apply to write)'),
  );
} finally {
  await pool.end();
}
