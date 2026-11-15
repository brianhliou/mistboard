-- engine_id (148) preserves an explicit level id, but a level picker can later
-- renumber its rungs. Snapshot the selected level when each game finishes.
ALTER TABLE game_participants ADD COLUMN bot_level SMALLINT
  CHECK (bot_level IS NULL OR bot_level > 0);

-- Backfill from engine ids whose playing configuration is known:
--   * a numbered id (misty-banqi-level-N, misty-jungle-flip-level-N) is level N;
--   * the unnumbered misty-banqi and misty-jungle-flip ids are Level 7. On prod
--     each ran only the classical full-strength bot (Banqi 3.5M nodes, Flip
--     Jungle 2.5M nodes, unchanged since 2026-09-06), which is today's Level 7:
--     the eight-level ladders shipped on 2026-11-08 with the unnumbered id kept
--     on that configuration and the nets given new Level 8 ids.
-- Rows with no engine id (before 2026-09-22) stay NULL: "level not recorded".
UPDATE game_participants p
SET bot_level = CASE
    WHEN p.engine_id IN ('misty-banqi', 'misty-jungle-flip') THEN 7
    ELSE substring(p.engine_id FROM '-level-([1-8])$')::smallint
  END
FROM games g
WHERE g.room_id = p.game_id
  AND p.subject_type = 'bot' AND p.subject_id = 'misty'
  AND ((g.variant = 'banqi' AND p.engine_id ~ '^misty-banqi(-level-[1-8])?$')
    OR (g.variant = 'jungle-flip' AND p.engine_id ~ '^misty-jungle-flip(-level-[1-8])?$'));
