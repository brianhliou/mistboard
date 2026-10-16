-- 151_jieqi_ladder_bots.sql
-- The jieqi ladder (2026-09-29): Pikafish Level 1..7, one bot per level, each
-- playing jieqi on the PikaJieQi build with Stockfish's Skill Level pick applied
-- server-side (jieqi-engine.ts). Level 8 is the existing Pikafish bot, whose
-- jieqi engine (pikafish-jieqi-strongest) and history are unchanged.

INSERT INTO bot_profiles
  (id, display_name, bio, active_engine_id, default_game_spec_id,
   supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
SELECT
  'pikafish-level-' || level,
  'Pikafish Level ' || level,
  'Level ' || level || ' of Mistboard''s jieqi ladder, backed by the Pikafish jieqi engine. Level 8 is Pikafish at full strength.',
  'pikafish-jieqi-level-' || level,
  'jieqi',
  ARRAY['jieqi'],
  600000,
  5000,
  'public'
FROM generate_series(1, 7) AS levels(level)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  bio = EXCLUDED.bio,
  active_engine_id = EXCLUDED.active_engine_id,
  default_game_spec_id = EXCLUDED.default_game_spec_id,
  supported_game_spec_ids = EXCLUDED.supported_game_spec_ids,
  play_initial_ms = EXCLUDED.play_initial_ms,
  play_increment_ms = EXCLUDED.play_increment_ms,
  visibility = EXCLUDED.visibility,
  updated_at = now();
