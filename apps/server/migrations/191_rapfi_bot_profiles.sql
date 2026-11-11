-- Rapfi's eight Gomoku levels use the shared bot directory and profile pages.
-- Public discovery and play still require Gomoku's publicSurface and launch flag.
-- No rating snapshots are seeded: the native ladder is not yet measured.
INSERT INTO bot_profiles
  (id, display_name, bio, active_engine_id, default_game_spec_id,
   supported_game_spec_ids, play_initial_ms, play_increment_ms, visibility)
SELECT
  'rapfi-level-' || level,
  'Rapfi Level ' || level,
  'Rapfi plays freestyle Gomoku at level ' || level || ' of 8. An open-source engine by dhbloo and the Rapfi contributors.',
  'rapfi-level-' || level,
  'gomoku',
  ARRAY['gomoku'],
  600000,
  5000,
  'public'
FROM generate_series(1, 8) AS levels(level)
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

-- Earlier PvE games stored Rapfi as an engine-version subject, without a bot
-- identity. Keep the engine attribution while making those names and histories
-- resolve to the new profiles. EvE engine-version seats remain engine subjects.
UPDATE game_participants AS participant
SET subject_type = 'bot',
    engine_id = participant.subject_id
FROM games
WHERE games.room_id = participant.game_id
  AND games.variant = 'gomoku'
  AND games.mode = 'pve'
  AND participant.subject_type = 'engine-version'
  AND participant.subject_id ~ '^rapfi-level-[1-8]$';
