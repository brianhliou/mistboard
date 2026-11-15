-- engine_id (148) preserves an explicit level id, but the unnumbered Misty
-- engine ids have changed rung labels over time. Snapshot the selected level
-- for future games; never attribute an old unnumbered id using today's ladder.
ALTER TABLE game_participants ADD COLUMN bot_level SMALLINT
  CHECK (bot_level IS NULL OR bot_level > 0);

-- Only an explicitly numbered engine id proves a historical level. Older
-- NULLs, unnumbered ids and unrecognised engines remain "level not recorded".
UPDATE game_participants p
SET bot_level = substring(p.engine_id FROM '-level-([1-8])$')::smallint
FROM games g
WHERE g.room_id = p.game_id
  AND p.subject_type = 'bot' AND p.subject_id = 'misty'
  AND ((g.variant = 'banqi' AND p.engine_id ~ '^misty-banqi-level-[1-8]$')
    OR (g.variant = 'jungle-flip' AND p.engine_id ~ '^misty-jungle-flip-level-[1-8]$'));
