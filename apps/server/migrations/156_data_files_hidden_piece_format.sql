-- #484: the hidden-piece game format. Every export changes bytes: the schema
-- moves to 1.1 (every JSON line's schema_version, every PGN's MistboardSchema
-- tag), jieqi, banqi and jungle-flip plies gain their reveals and their games
-- the deal, and those three variants join /data (their own monthly files, the
-- all-variants files, and the jieqi engine match collection, which also gains a
-- PGN). A stored file is served as stored, so every file built before this
-- change is stale: drop them all, and each rebuilds on its next download. The
-- download URLs carry the content hash, so a rebuilt file gets a new URL and no
-- cache can answer it with the old bytes.
--
-- Idempotent: once the rows are gone a re-run deletes nothing.

DELETE FROM game_data_files;
