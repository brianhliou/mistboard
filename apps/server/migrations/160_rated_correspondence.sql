-- 160_rated_correspondence.sql
-- Rated correspondence (Brian, 2026-10-02): a correspondence seek or challenge is
-- casual or rated, chosen when it is created, and a rated correspondence game
-- rates in its OWN pool, separate from every live ladder.
--
-- 1. correspondence_seeks.rated carries the choice from the seek to the room the
--    accept creates (the room keeps it durably in its room-created event).
--    Default false: every seek posted before this migration was casual.
-- 2. user_ratings gains the 'correspondence' time class. A pool is keyed by
--    (variant, time_class), so a player's correspondence xiangqi rating is the
--    row (xiangqi, correspondence) and never mixes with (xiangqi, blitz) etc.
--    Same drop-and-re-add shape as 026: a CHECK cannot be extended in place.
--    bot_rating_snapshots keeps its live-only CHECK: no bot plays correspondence.

ALTER TABLE correspondence_seeks
  ADD COLUMN IF NOT EXISTS rated BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE user_ratings
  DROP CONSTRAINT IF EXISTS user_ratings_time_class_check;

ALTER TABLE user_ratings
  ADD CONSTRAINT user_ratings_time_class_check
  CHECK (time_class IN ('bullet', 'blitz', 'rapid', 'correspondence'));
