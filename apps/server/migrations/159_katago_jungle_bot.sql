-- 159_katago_jungle_bot.sql
-- KataGo (2026-10): the top jungle seat above Misty. hzyhhzy's KataGomo
-- (AnimalChess2025 branch, MIT, built on lightvector's KataGo) with the b10c384
-- net from Kouza's (lxsgx23) Dandelion 4. It won the jungle challenge on
-- brianhliou.com/challenges (82-0-118 against MistyJungle at 1,000 visits; the
-- seat runs 150, which scored 0.690 over 50 games), and hzyhhzy agreed to the
-- site running it (hzyhhzy/KataGomo#12). Its engine id and tier are in
-- jungle-katago-engine.ts (KATAGO_JUNGLE_ENGINE_ID); the slot names the engine
-- instead of taking a level number, like AB-JChess (152).

INSERT INTO bot_profiles
  (id, display_name, bio, active_engine_id, default_game_spec_id,
   supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
VALUES (
  'katago',
  'KataGo',
  'KataGomo by hzyhhzy, built on KataGo by lightvector, with the neural network from Kouza''s (lxsgx23) Dandelion 4: the strongest jungle engine we know of, played here with hzyhhzy''s permission. It searches 150 visits a move here, below the 1,000 visits it set the challenge record at.',
  'katago-jungle',
  'jungle',
  ARRAY['jungle'],
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
