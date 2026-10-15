-- The /correspondence "Recently finished" list marks a game that ended since
-- the player last opened the page. One more users.*_seen_at watermark beside
-- followers_seen_at and forum_replies_seen_at (121); no per-game table.
-- DEFAULT now() so existing accounts start with nothing marked new.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS correspondence_finished_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
