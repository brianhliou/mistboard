-- Jieqi level 8 (engine version pikafish-jieqi-strongest) kept its pre-ladder
-- name 'PikaJieQi - Strongest' after levels 1-7 became 'Pikafish Level N', so
-- an engine game card read "PikaJieQi - Strongest" against "Pikafish Level 7".
-- The tier is now 'Pikafish Level 8'. game_participants stores the name at
-- write time, so rename the stored seats too; engine_versions.name follows on
-- the next boot's builtin upsert, and is renamed here so it agrees before then.
--
-- Idempotent: only rows still carrying the old name change.

UPDATE game_participants
SET display_name = 'Pikafish Level 8'
WHERE subject_type = 'engine-version'
  AND subject_id = 'pikafish-jieqi-strongest'
  AND display_name = 'PikaJieQi - Strongest';

UPDATE engine_versions
SET name = 'Pikafish Level 8'
WHERE id = 'pikafish-jieqi-strongest'
  AND name = 'PikaJieQi - Strongest';
