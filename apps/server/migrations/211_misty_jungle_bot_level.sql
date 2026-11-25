-- Classical Jungle joined Misty's level table (mistyLevelForEngine) with the
-- seven-level ladder (2026-11-16), so Jungle seats finished before it carry no
-- bot_level and sit in no per-level record on /bots. Give them the level the
-- server writes today, from the engine id the seat recorded.
--
-- The map is JUNGLE_CLASSICAL_POLICIES (packages/game jungle-classical-levels.ts):
--   * misty-jungle-classical-level-N is Level N (1-6);
--   * misty-jungle-level-2 is Level 7, NOT 2: it is the unchanged full-strength
--     id, so the '-level-N' pattern migration 204 used would mislabel it. Every
--     row carrying it was written after engine ids were recorded (migration
--     148, 2026-09-21), and it has run 5M nodes with a 6000ms cap since
--     2026-09-06, which is today's Level 7 policy.
-- Left NULL ("level not recorded"): rows with no engine id (before 2026-09-21)
-- and the retired misty-jungle-level-1 / misty-jungle-level-3 ids, which are
-- no rung of the current ladder. A level already stored is never overwritten.
-- Re-running is a no-op.
UPDATE game_participants p
SET bot_level = m.level
FROM games g,
  (VALUES
    ('misty-jungle-classical-level-1', 1),
    ('misty-jungle-classical-level-2', 2),
    ('misty-jungle-classical-level-3', 3),
    ('misty-jungle-classical-level-4', 4),
    ('misty-jungle-classical-level-5', 5),
    ('misty-jungle-classical-level-6', 6),
    ('misty-jungle-level-2', 7)
  ) AS m (engine_id, level)
WHERE g.room_id = p.game_id
  AND g.variant = 'jungle'
  AND p.subject_type = 'bot' AND p.subject_id = 'misty'
  AND p.bot_level IS NULL
  AND p.engine_id = m.engine_id;
