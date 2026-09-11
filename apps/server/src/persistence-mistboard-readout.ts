import { randomUUID } from 'node:crypto';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import type pg from 'pg';
import { buildElephantChessPuzzleQualityReport } from './elephantchess-puzzle-quality-report.js';
import {
  buildMistboardReadout,
  ELEPHANTCHESS_PILOT_RUN_ID,
  type MistboardReadoutCollectorError,
  type MistboardReadoutEngines,
  type MistboardReadoutFacts,
  type MistboardReadoutMining,
  type MistboardReadoutProduct,
  type MistboardReadoutRuntime,
  type MistboardReadoutTrendPoint,
  type MistboardReadoutTrigger,
  type MistboardReadoutV1,
  readoutPeriods,
  readoutSnapshotKey,
  SUPPORTED_MISTBOARD_READOUT_SCHEMA_VERSIONS,
} from './mistboard-readout.js';
import { getPool } from './persistence-db.js';
import { listPuzzleQualityAggregates } from './persistence-puzzle-quality.js';
import {
  getXiangqiPuzzleMiningRun,
  listXiangqiPuzzleEditorialCandidates,
} from './persistence-xiangqi-puzzle-mining.js';
import { xiangqiEditorialCandidateSignals } from './xiangqi-puzzle-editorial-ranking.js';

type Queryable = Pick<pg.Pool, 'query'>;

export async function generateMistboardReadout(input: {
  trigger: MistboardReadoutTrigger;
  now?: Date;
  runtime: MistboardReadoutRuntime;
  dryRun?: boolean;
  db?: pg.Pool;
}): Promise<{ report: MistboardReadoutV1; reused: boolean; previousAlertKey: string | null }> {
  const db = input.db ?? getPool();
  const now = input.now ?? new Date();
  const snapshotKey = readoutSnapshotKey(input.trigger, now);

  if (input.dryRun) {
    const [facts, previousReport] = await Promise.all([
      collectMistboardReadoutFacts(db, now),
      latestMistboardReadout(db),
    ]);
    return {
      report: buildMistboardReadout({
        snapshotId: `readout_dry_${randomUUID()}`,
        trigger: input.trigger,
        now,
        runtime: input.runtime,
        facts,
        previousReport,
      }),
      reused: false,
      previousAlertKey: previousReport?.alertKey ?? null,
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('mistboard:readout-generation'))`);
    if (snapshotKey) {
      const existing = await client.query<{ payload: unknown }>(
        `SELECT payload FROM ops_readout_snapshots WHERE snapshot_key = $1`,
        [snapshotKey],
      );
      if (existing.rows[0]) {
        const report = parseStoredReadout(existing.rows[0].payload);
        await client.query('COMMIT');
        return { report, reused: true, previousAlertKey: null };
      }
    }

    // Keep the advisory lock on this transaction while independent read-only
    // collectors use the pool. Parallel query() calls on one PoolClient rely on
    // pg's deprecated implicit queuing and will stop working in pg 9.
    const [facts, previousReport] = await Promise.all([
      collectMistboardReadoutFacts(db, now),
      latestMistboardReadout(db),
    ]);
    const report = buildMistboardReadout({
      snapshotId: `readout_${randomUUID()}`,
      trigger: input.trigger,
      now,
      runtime: input.runtime,
      facts,
      previousReport,
    });
    await client.query(
      `INSERT INTO ops_readout_snapshots
         (id, schema_version, trigger, snapshot_key, period_start, period_end,
          verdict, decision_fingerprint, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        report.snapshotId,
        report.schemaVersion,
        report.trigger,
        report.snapshotKey,
        report.periodStart,
        report.periodEnd,
        report.verdict,
        report.decisionFingerprint,
        JSON.stringify(report),
      ],
    );
    await client.query('COMMIT');
    return { report, reused: false, previousAlertKey: previousReport?.alertKey ?? null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type MistboardReadoutSummary = {
  snapshotId: string;
  snapshotKey: string | null;
  trigger: MistboardReadoutTrigger;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  verdict: MistboardReadoutV1['verdict'];
  completedGames: number | null;
  humanPlayers: number | null;
  actions: number;
};

// Row-shaped rather than full payloads: the history view needs one line per
// snapshot, and the payloads are large enough that sending 50 of them to a
// browser to render 50 table rows would be the wrong trade.
export async function listMistboardReadoutSummaries(
  db: Queryable = getPool(),
  options: { limit?: number; trigger?: MistboardReadoutTrigger } = {},
): Promise<MistboardReadoutSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const result = await db.query<{
    id: string;
    snapshot_key: string | null;
    trigger: MistboardReadoutTrigger;
    period_start: Date;
    period_end: Date;
    generated_at: string | null;
    verdict: MistboardReadoutV1['verdict'];
    completed_games: number | null;
    human_players: number | null;
    actions: number;
  }>(
    `SELECT id, snapshot_key, trigger, period_start, period_end, verdict,
            payload ->> 'generatedAt' AS generated_at,
            (payload -> 'product' ->> 'completedGames')::int AS completed_games,
            (payload -> 'product' ->> 'humanPlayers')::int AS human_players,
            COALESCE(jsonb_array_length(payload -> 'actions'), 0)::int AS actions
     FROM ops_readout_snapshots
     WHERE ($2::text IS NULL OR trigger = $2)
     ORDER BY period_end DESC, created_at DESC
     LIMIT $1`,
    [limit, options.trigger ?? null],
  );
  return result.rows.map((row) => ({
    snapshotId: row.id,
    snapshotKey: row.snapshot_key,
    trigger: row.trigger,
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    generatedAt: row.generated_at ?? row.period_end.toISOString(),
    verdict: row.verdict,
    completedGames: row.completed_games ?? null,
    humanPlayers: row.human_players ?? null,
    actions: row.actions,
  }));
}

export async function latestMistboardReadout(
  db: Queryable = getPool(),
): Promise<MistboardReadoutV1 | null> {
  const result = await db.query<{ payload: unknown }>(
    `SELECT payload FROM ops_readout_snapshots ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  return result.rows[0] ? parseStoredReadout(result.rows[0].payload) : null;
}

// Weekly snapshots only: the daily ones share the same rolling window, so
// mixing them in would draw the same week six times and call it a trend.
export async function recentWeeklyTrend(
  db: Queryable = getPool(),
  limit = 6,
): Promise<MistboardReadoutTrendPoint[]> {
  const result = await db.query<{
    period_end: Date;
    completed_games: number | null;
    human_players: number | null;
  }>(
    `SELECT period_end,
            (payload -> 'product' ->> 'completedGames')::int AS completed_games,
            (payload -> 'product' ->> 'humanPlayers')::int AS human_players
     FROM ops_readout_snapshots
     WHERE trigger = 'weekly'
     ORDER BY period_end DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows
    .map((row) => ({
      periodEnd: row.period_end.toISOString(),
      completedGames: row.completed_games ?? null,
      humanPlayers: row.human_players ?? null,
    }))
    .reverse();
}

export async function collectMistboardReadoutFacts(
  db: Queryable,
  now: Date,
): Promise<MistboardReadoutFacts> {
  const [collectors, trend] = await Promise.all([
    Promise.allSettled([
      collectProduct(db, now),
      collectPuzzles(db, now),
      collectMining(db),
      collectEngines(db, now),
    ] as const),
    // Context, not a graded section: losing the trend line must not turn a
    // healthy readout into an unknown one.
    recentWeeklyTrend(db).catch(() => []),
  ]);
  const sections: MistboardReadoutCollectorError['section'][] = [
    'product',
    'puzzles',
    'mining',
    'engines',
  ];
  const collectorErrors = collectors.flatMap((result, index) =>
    result.status === 'rejected'
      ? [{ section: sections[index]!, code: 'collector_failed' as const }]
      : [],
  );
  return {
    product: settledValue(collectors[0]),
    puzzles: settledValue(collectors[1]),
    mining: settledValue(collectors[2]),
    engines: settledValue(collectors[3]),
    collectorErrors,
    trend,
  };
}

async function collectProduct(db: Queryable, now: Date): Promise<MistboardReadoutProduct> {
  const { periodStart, periodEnd, previousPeriodStart } = readoutPeriods(now);
  const [counts, modes, variants, players] = await Promise.all([
    db.query<{
      accounts_created: number;
      previous_accounts_created: number;
      completed_games: number;
      previous_completed_games: number;
      aborted_games: number;
    }>(
      `SELECT
         (SELECT count(*) FROM users WHERE created_at >= $1 AND created_at < $2)::int
           AS accounts_created,
         (SELECT count(*) FROM users WHERE created_at >= $3 AND created_at < $1)::int
           AS previous_accounts_created,
         (SELECT count(*) FROM games
            WHERE status = 'completed' AND mode IN ('pvp', 'pve')
              AND ended_at >= $1 AND ended_at < $2)::int AS completed_games,
         (SELECT count(*) FROM games
            WHERE status = 'completed' AND mode IN ('pvp', 'pve')
              AND ended_at >= $3 AND ended_at < $1)::int AS previous_completed_games,
         (SELECT count(*) FROM games
            WHERE status = 'aborted' AND mode IN ('pvp', 'pve')
              AND ended_at >= $1 AND ended_at < $2)::int AS aborted_games`,
      [periodStart, periodEnd, previousPeriodStart],
    ),
    db.query<{ mode: string; count: number }>(
      `SELECT mode, count(*)::int AS count
       FROM games
       WHERE status = 'completed' AND ended_at >= $1 AND ended_at < $2
       GROUP BY mode ORDER BY mode`,
      [periodStart, periodEnd],
    ),
    db.query<{ variant: string; count: number }>(
      `SELECT variant, count(*)::int AS count
       FROM games
       WHERE status = 'completed' AND mode IN ('pvp', 'pve')
         AND ended_at >= $1 AND ended_at < $2
       GROUP BY variant ORDER BY count DESC, variant`,
      [periodStart, periodEnd],
    ),
    collectPlayers(db, { periodStart, periodEnd, previousPeriodStart }),
  ]);
  const row = counts.rows[0];
  return {
    accountsCreated: row?.accounts_created ?? 0,
    previousAccountsCreated: row?.previous_accounts_created ?? 0,
    completedGames: row?.completed_games ?? 0,
    previousCompletedGames: row?.previous_completed_games ?? 0,
    completedGamesByMode: Object.fromEntries(modes.rows.map((entry) => [entry.mode, entry.count])),
    completedGamesByVariant: variants.rows,
    abortedGames: row?.aborted_games ?? 0,
    ...players,
  };
}

// Distinct people rather than distinct games. A week can double on one player
// grinding the bot, and the game count cannot tell that apart from a week that
// doubled because eight new people arrived.
//
// SIGNED-IN people only. A guest seat is persisted with subject_id NULL and
// the client id is per room, so the `subject_id IS NOT NULL` filter below
// drops every guest: `humanPlayers` is the account count, and a week of
// guest-only play reads as zero players here. Guests are visible in the game
// count and on /metrics as games with a guest seat, nowhere as people, until a
// seat carries a device id (docs-private/metrics-roadmap.md, phase 7).
async function collectPlayers(
  db: Queryable,
  period: { periodStart: Date; periodEnd: Date; previousPeriodStart: Date },
): Promise<{
  humanPlayers: number;
  previousHumanPlayers: number;
  returningPlayers: number;
  signedInPlayers: number;
}> {
  const result = await db.query<{
    human_players: number;
    previous_human_players: number;
    returning_players: number;
    signed_in_players: number;
  }>(
    `WITH current_players AS (
       SELECT DISTINCT p.subject_type, p.subject_id
       FROM game_participants p
       JOIN games g ON g.room_id = p.game_id
       WHERE p.subject_type IN ('guest', 'user') AND p.subject_id IS NOT NULL
         AND g.status = 'completed' AND g.mode IN ('pvp', 'pve')
         AND g.ended_at >= $1 AND g.ended_at < $2
     ), previous_players AS (
       SELECT DISTINCT p.subject_type, p.subject_id
       FROM game_participants p
       JOIN games g ON g.room_id = p.game_id
       WHERE p.subject_type IN ('guest', 'user') AND p.subject_id IS NOT NULL
         AND g.status = 'completed' AND g.mode IN ('pvp', 'pve')
         AND g.ended_at >= $3 AND g.ended_at < $1
     )
     SELECT
       (SELECT count(*) FROM current_players)::int AS human_players,
       (SELECT count(*) FROM previous_players)::int AS previous_human_players,
       (SELECT count(*) FROM current_players WHERE subject_type = 'user')::int
         AS signed_in_players,
       (SELECT count(*) FROM current_players c WHERE EXISTS (
          SELECT 1 FROM game_participants p
          JOIN games g ON g.room_id = p.game_id
          WHERE p.subject_type = c.subject_type AND p.subject_id = c.subject_id
            AND g.status = 'completed' AND g.ended_at < $1
        ))::int AS returning_players`,
    [period.periodStart, period.periodEnd, period.previousPeriodStart],
  );
  const row = result.rows[0];
  return {
    humanPlayers: row?.human_players ?? 0,
    previousHumanPlayers: row?.previous_human_players ?? 0,
    returningPlayers: row?.returning_players ?? 0,
    signedInPlayers: row?.signed_in_players ?? 0,
  };
}

async function collectPuzzles(db: Queryable, now: Date) {
  const [aggregates, entries] = await Promise.all([
    listPuzzleQualityAggregates(db, XIANGQI_SPEC_ID),
    listXiangqiPuzzleEditorialCandidates(db, {
      runId: ELEPHANTCHESS_PILOT_RUN_ID,
      statuses: ['published'],
    }),
  ]);
  const signalsByCandidateId = new Map(
    entries.map((entry) => [entry.candidate.id, xiangqiEditorialCandidateSignals(entry)]),
  );
  return buildElephantChessPuzzleQualityReport({
    aggregates,
    pilotRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    signalsByCandidateId,
    generatedAt: now.toISOString(),
  });
}

async function collectMining(db: Queryable): Promise<MistboardReadoutMining> {
  const [run, shards, candidates] = await Promise.all([
    getXiangqiPuzzleMiningRun(db, ELEPHANTCHESS_PILOT_RUN_ID),
    db.query<{
      status: string;
      count: number;
      remaining_games: number;
      stale_leases: number;
    }>(
      `SELECT status, count(*)::int AS count,
              COALESCE(sum(selection_end - next_selection_index), 0)::int AS remaining_games,
              count(*) FILTER (
                WHERE status = 'running' AND lease_expires_at <= now()
              )::int AS stale_leases
       FROM xiangqi_puzzle_mining_shards
       WHERE run_id = $1
       GROUP BY status ORDER BY status`,
      [ELEPHANTCHESS_PILOT_RUN_ID],
    ),
    db.query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count
       FROM xiangqi_puzzle_mining_candidates
       WHERE run_id = $1
       GROUP BY status ORDER BY status`,
      [ELEPHANTCHESS_PILOT_RUN_ID],
    ),
  ]);
  return {
    runId: run.id,
    status: run.status,
    selectedGames: run.selectedGames,
    shards: Object.fromEntries(shards.rows.map((row) => [row.status, row.count])),
    remainingGames: shards.rows.reduce((sum, row) => sum + row.remaining_games, 0),
    candidates: Object.fromEntries(candidates.rows.map((row) => [row.status, row.count])),
    staleLeases: shards.rows.reduce((sum, row) => sum + row.stale_leases, 0),
  };
}

async function collectEngines(db: Queryable, now: Date): Promise<MistboardReadoutEngines> {
  const { periodStart } = readoutPeriods(now);
  const [tasks, workers] = await Promise.all([
    db.query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count
       FROM engine_game_tasks
       WHERE status IN ('queued', 'running') OR finished_at >= $1
       GROUP BY status ORDER BY status`,
      [periodStart],
    ),
    db.query<{ active_workers: number; stale_workers: number }>(
      `SELECT
         count(*) FILTER (
           WHERE status IN ('running', 'draining')
             AND heartbeat_at >= $1::timestamptz - interval '2 minutes'
         )::int AS active_workers,
         count(*) FILTER (
           WHERE status IN ('running', 'draining')
             AND heartbeat_at < $1::timestamptz - interval '2 minutes'
         )::int AS stale_workers
       FROM engine_worker_runs`,
      [now],
    ),
  ]);
  const taskMap = Object.fromEntries(tasks.rows.map((row) => [row.status, row.count]));
  return {
    tasks: taskMap,
    failedTasks: taskMap.failed ?? 0,
    activeWorkers: workers.rows[0]?.active_workers ?? 0,
    staleWorkers: workers.rows[0]?.stale_workers ?? 0,
  };
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

// Reads accept every supported schema version, not just the current one. The
// previous report is the comparison baseline for every transition rule, so
// rejecting the version written yesterday would break the readout for a day
// after each schema bump and silently re-fire every crossing.
function parseStoredReadout(value: unknown): MistboardReadoutV1 {
  if (!value || typeof value !== 'object') throw new Error('stored readout payload is invalid');
  const payload = value as Partial<MistboardReadoutV1> & { schemaVersion?: number };
  const version = payload.schemaVersion;
  if (
    payload.kind !== 'mistboard-readout' ||
    typeof version !== 'number' ||
    !(SUPPORTED_MISTBOARD_READOUT_SCHEMA_VERSIONS as readonly number[]).includes(version) ||
    typeof payload.snapshotId !== 'string' ||
    typeof payload.decisionFingerprint !== 'string'
  ) {
    throw new Error('stored readout payload has an unsupported schema');
  }
  // Keep the stored version: a v1 payload really does lack the player counts,
  // and rewriting the version would hide that from every reader. Only the two
  // additions that every consumer touches get a default.
  return {
    ...payload,
    trend: payload.trend ?? [],
    alertKey: payload.alertKey ?? '',
  } as MistboardReadoutV1;
}
