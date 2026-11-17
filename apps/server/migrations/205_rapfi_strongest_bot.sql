-- The unnumbered Gomoku opponent above Rapfi Levels 1-8, named for its engine.
-- The native time-only policy is distinct from every existing ladder level.
-- No rating is seeded or copied from the ladder.
INSERT INTO bot_profiles
  (id, display_name, bio, active_engine_id, default_game_spec_id,
   supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
VALUES (
  'rapfi',
  'Rapfi',
  'Rapfi plays freestyle Gomoku with its strongest native search policy. An open-source engine by dhbloo and the Rapfi contributors (GPL-3.0), using their CC0 neural networks: github.com/dhbloo/rapfi',
  'rapfi-strongest',
  'gomoku',
  ARRAY['gomoku'],
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
