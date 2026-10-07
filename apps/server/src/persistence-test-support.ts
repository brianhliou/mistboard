import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import nodeTest, { after, before, beforeEach } from 'node:test';
import pg from 'pg';
import { runMigrations } from './migrate.js';
import { close, init, isInitialized } from './persistence.js';
import { testDatabaseUrlFromEnv } from './test-database-url.js';

export const TEST_DATABASE_URL = testDatabaseUrlFromEnv();

export const test = nodeTest;
export { assert, pg };

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function definePersistenceTests(area: string, registerTests: () => void): void {
  if (!TEST_DATABASE_URL) {
    test(`persistence ${area} (skipped - set TEST_DATABASE_URL or DATABASE_URL to enable)`, {
      skip: true,
    }, () => {});
    return;
  }

  before(async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await runMigrations(client);
    } finally {
      await client.end();
    }
    init(TEST_DATABASE_URL);
  });

  after(async () => {
    await close();
  });

  beforeEach(async () => {
    if (!isInitialized()) return;
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      // Mining runs cascade through shards/candidates/judgments/reviews. Clear
      // the optional promoted-puzzle backlink first so cleanup does not need to
      // TRUNCATE the persistent seed-backed puzzles table through FK CASCADE.
      await client.query(
        `UPDATE puzzles SET mining_candidate_id = NULL WHERE mining_candidate_id IS NOT NULL`,
      );
      // ...then drop the promoted rows themselves. The publication test's whole
      // job is to insert 'mined' rows into this table, and puzzles is (rightly)
      // held out of the TRUNCATE below because reseeding it is expensive — so
      // without this the promoted rows outlive the run and the NEXT run sees
      // more puzzles than the committed seed has, failing the seed round-trip.
      // Hosted CI never caught it: it starts from a fresh database every time,
      // while every local worktree shares one long-lived test DB.
      await client.query(`DELETE FROM puzzles WHERE source_kind <> 'seed'`);
      await client.query(`DELETE FROM xiangqi_puzzle_mining_runs`);
      // Keep the historical-library tables out of the CASCADE truncate below.
      // Mining runs reference that library, and Postgres follows TRUNCATE's FK
      // graph by schema rather than by whether rows currently exist. Leaving
      // these tables in the truncate would therefore reach candidates and the
      // seed-backed puzzles table through mining_candidate_id.
      await client.query(`DELETE FROM historical_xiangqi_games`);
      await client.query(`DELETE FROM historical_xiangqi_import_batches`);
      await client.query(`DELETE FROM historical_xiangqi_players`);
      await client.query(`DELETE FROM historical_xiangqi_sources`);
      await client.query(
        `TRUNCATE
           auth_rate_limit_buckets,
           game_data_files,
           stripe_events,
           engine_move_jobs,
           live_engine_games,
           puzzle_attempts,
           puzzle_quality_sessions,
           ops_readout_snapshots,
           feedback_submissions,
           user_puzzle_ratings,
           puzzle_ratings,
           puzzle_daily_selections,
           xiangqi_broadcast_sync_logs,
           xiangqi_broadcast_boards,
           xiangqi_broadcast_rounds,
           xiangqi_broadcast_tours,
           room_deadlines,
           room_lifecycle_audit,
           email_login_challenges,
           account_sessions,
           user_handle_reservations,
           forum_translations,
           forum_topic_watches,
           forum_post_quotes,
           forum_posts,
           forum_topics,
           bot_rating_snapshots,
           bot_profiles,
           artifact_owners,
           game_participants,
           room_seat_tokens,
           game_debug_artifacts,
           eve_games,
           engine_game_tasks,
           engine_worker_runs,
           eve_jobs,
           engine_versions,
           engines,
           users,
           events,
           games
         RESTART IDENTITY CASCADE`,
      );
    } finally {
      await client.end();
    }
  });

  registerTests();
}
