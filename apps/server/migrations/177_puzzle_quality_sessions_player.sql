-- 177_puzzle_quality_sessions_player.sql
-- Who opened the puzzle, so /metrics can count puzzle players, not puzzles.
--
-- Migration 112 kept puzzle_quality_sessions identity-free on purpose: a fresh
-- random session id per puzzle opened, no account and no browser. That made
-- the puzzle line a count of puzzles started (one person solving ten puzzles
-- was ten), with no way to leave the operator's own puzzle testing out. On
-- 2026-10-25 about 70% of rows were signed-out opens.
--
-- Two nullable columns, the same identity the game counts already use:
--   user_id   the signed-in account, filled by the server from the session
--             cookie, never from the request body.
--   device_id the browser's random localStorage id (`mistboard.device`,
--             migration 137), sent by the client. Redacted on every read
--             that reaches a browser; only aggregate queries see it.
-- Rows before this migration stay NULL in both and are not people. The
-- session id itself is unchanged: still per puzzle opened, still the key the
-- mining quality loop aggregates on.

ALTER TABLE puzzle_quality_sessions
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_id TEXT;

-- The weekly /metrics scans read started rows by week.
CREATE INDEX IF NOT EXISTS puzzle_quality_sessions_started_idx
  ON puzzle_quality_sessions (started_at)
  WHERE started_at IS NOT NULL;
