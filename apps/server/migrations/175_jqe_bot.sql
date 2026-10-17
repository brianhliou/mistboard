-- 175_jqe_bot.sql
-- jqe (2026-10): a jieqi slot above AB-JChess. An open-source jieqi engine with its
-- own NNUE by Devin O'Keefe (devinokeefe/jieqi, MIT). Its engine id and binary are in
-- jieqi-engine.ts (JIEQI_JQE_ENGINE_ID). The row is public, but the bot is unplayable,
-- so off every public bot surface, until MISTBOARD_JQE_ENABLED is on and the binary
-- and net resolve (routes/bots.ts botPlayOptions, jqeAvailable).

INSERT INTO bot_profiles
  (id, display_name, bio, active_engine_id, default_game_spec_id,
   supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
VALUES (
  'jqe',
  'jqe',
  'An open-source jieqi engine with its own neural network, by Devin O''Keefe, played here with his permission: github.com/devinokeefe/jieqi',
  'jqe-jieqi',
  'jieqi',
  ARRAY['jieqi'],
  600000,
  5000,
  'public'
)
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
