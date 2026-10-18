-- 174_general_blunder_bot.sql
-- General Blunder (2026-10): a xiangqi bot that plays the worst move it can
-- find. Fairy-Stockfish on the CC0 xiangqi net scores every legal move and the bot plays the lowest
-- for itself, so it walks into the player's mates (after Lichess's Worstfish).
-- A beginner's opponent, not a ladder rung. Its engine id and tier are in
-- xiangqi-worst-engine.ts (XIANGQI_WORST_ENGINE_ID).

INSERT INTO bot_profiles
  (id, display_name, bio, active_engine_id, default_game_spec_id,
   supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
VALUES (
  'general-blunder',
  'General Blunder',
  'A strong engine trying its hardest to lose. It looks at every move and plays the one that is worst for itself, so most turns there is a checkmate or a free piece waiting for you. Find it. Runs on Fairy-Stockfish.',
  'fairy-stockfish-xiangqi-worst',
  'xiangqi',
  ARRAY['xiangqi'],
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
