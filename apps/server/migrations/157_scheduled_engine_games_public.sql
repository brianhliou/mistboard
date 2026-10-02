-- #488: the bot-vs-bot scheduler's games are public data. From this release
-- the scheduler asks the worker for visibility 'public' on every game it queues
-- (bot-vs-bot-scheduler.ts botVsBotTaskConfig); this backfills the games it
-- queued before, which took the column default 'link' without anyone choosing
-- it. They are the same kind of game (two of the site's own bots, on the
-- site's own worker) and were already shown to everyone on /watch Engines,
-- which ignores visibility, so nothing private becomes visible.
--
-- Only scheduler games: rating tournaments (engine:enqueue-tournament) stay
-- 'link'. Public engine games are listed only by the Engine games source of
-- /games/search and the engine-game files of /data; every human count still
-- requires mode pvp/pve (persistence-counted-games.ts).
--
-- Idempotent: a re-run changes only scheduler games still at 'link' (or still
-- rated), which is
-- also how to pick up any game a not-yet-redeployed engine-worker wrote as
-- 'link' after this release.

-- `rated` goes false with it: that column means a rated game between people,
-- and its default (true, migration 015) is what every EvE row was given. No
-- rating ever read it for an EvE game; the export and the search would.
UPDATE games
SET visibility = 'public', rated = false
WHERE mode = 'eve'
  AND (visibility = 'link' OR rated)
  AND room_id IN (
    SELECT eve.game_id
    FROM eve_games eve
    JOIN eve_jobs job ON job.id = eve.job_id
    WHERE job.config->>'source' = 'bot-vs-bot-scheduler'
  );

-- The /data engine-game files (game-data-files.ts, kind 'engine-monthly') are
-- stored beside the human monthly files under their own key prefix.
ALTER TABLE game_data_files DROP CONSTRAINT IF EXISTS game_data_files_kind_check;
ALTER TABLE game_data_files
  ADD CONSTRAINT game_data_files_kind_check
  CHECK (kind IN ('monthly', 'collection', 'engine-monthly'));
