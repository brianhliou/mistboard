-- 152_ab_jchess_bot.sql
-- AB-JChess (2026-10): the top jieqi slot above Pikafish Level 8. An open-source
-- jieqi engine with its own NNUE by Huorongrong and Laoxu (Kouza), served with the
-- authors' permission (lxsgx23/AB-JChess#1). Its engine id and binary are in
-- jieqi-engine.ts (JIEQI_ABJCHESS_ENGINE_ID); the slot names the engine instead of
-- taking a level number, so a later engine can replace it without redefining one.

INSERT INTO bot_profiles
  (id, display_name, bio, active_engine_id, default_game_spec_id,
   supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
VALUES (
  'ab-jchess',
  'AB-JChess',
  'An open-source jieqi engine with its own neural network, by Huorongrong and Laoxu (Kouza), played here with their permission: github.com/lxsgx23/AB-JChess',
  'ab-jchess-jieqi',
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
